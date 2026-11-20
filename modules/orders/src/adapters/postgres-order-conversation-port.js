import {
  personalIdentityVisible,
  contactConversationVisible,
} from '@crm-silmer/contacts';
import { randomUUID } from 'node:crypto';
import { contactReadable, orderReadable } from './order-contact-access.js';

import { decryptContactIdentityEnvelope } from '@crm-silmer/contacts/identity-envelope';
import { contactPhoneHash, normalizeContactPhone } from '@crm-silmer/contacts';

import { decryptJson } from './envelope.js';
import { OrderConflictError, OrderNotFoundError } from '../domain/errors.js';

/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable
 */

const MIN_PHONE_DIGITS = 4;
// ADR 016: who may name the customer on an order. `manual` is a person
// renaming the contact; `automation` is the name the customer gave the bot,
// promoted from the briefing's `customer_name`. The channel handle (an
// Instagram "@handle") or a WhatsApp profile name never is.
const CONFIRMED_NAME_SOURCES = new Set(['automation', 'manual']);

/** @param {unknown} value */
function foldText(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    : '';
}

/**
 * What an order needs from the conversation it belongs to: who owns it, the
 * customer's confirmed name, the agent's pre-ficha and the list search.
 * Names and phones live in encrypted envelopes, so they are matched here
 * after decryption and never through SQL text.
 */
export class PostgresOrderConversationPort {
  /** @type {Queryable} */
  #database;
  /** @type {Buffer} */
  #envelopeKey;
  /** @type {Buffer} */
  #contactEnvelopeKey;
  /** @type {Buffer} */
  #contactLookupKey;

  /**
   * `envelopeKey` is the n8n pre-ficha key (`N8N_INTEGRATION_ENVELOPE_KEY`);
   * `contactEnvelopeKey` opens the channel identity (`CONTACT_IDENTITY_ENVELOPE_KEY`).
   *
   * @param {{database: Queryable, envelopeKey: Buffer, contactEnvelopeKey: Buffer, contactLookupKey: Buffer}} options
   */
  constructor({ contactEnvelopeKey, contactLookupKey, database, envelopeKey }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    for (const [key, name] of /** @type {const} */ ([
      [envelopeKey, 'envelopeKey'],
      [contactEnvelopeKey, 'contactEnvelopeKey'],
      [contactLookupKey, 'contactLookupKey'],
    ])) {
      if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new TypeError(`${name} must be a 32-byte Buffer`);
      }
    }
    this.#database = database;
    this.#envelopeKey = Buffer.from(envelopeKey);
    this.#contactEnvelopeKey = Buffer.from(contactEnvelopeKey);
    this.#contactLookupKey = Buffer.from(contactLookupKey);
  }

  /**
   * The owner and the version a command must have seen.
   *
   * @param {string} conversationId
   * @returns {Promise<{assignedUserId: string|null, version: number}|null>}
   */
  async readAssignment(conversationId) {
    const result = await this.#database.query(
      'SELECT assigned_user_id, version FROM crm.conversations WHERE id = $1',
      [conversationId],
    );
    const row = result.rows[0];
    return row
      ? {
          assignedUserId: row.assigned_user_id ?? null,
          version: Number(row.version),
        }
      : null;
  }

  /**
   * Current owner of each existing conversation; unknown ids are left out.
   *
   * @param {string[]} conversationIds
   * @returns {Promise<Map<string, string|null>>}
   */
  async readAssignments(conversationIds) {
    if (conversationIds.length === 0) return new Map();
    const result = await this.#database.query(
      `SELECT id, assigned_user_id FROM crm.conversations
       WHERE id = ANY($1::text[])`,
      [conversationIds],
    );
    return new Map(
      result.rows.map((row) => [row.id, row.assigned_user_id ?? null]),
    );
  }

  /** Private chat visibility is independent of commercial ownership.
   * @param {string[]} conversationIds @param {{id:string}} actor
   * @returns {Promise<Set<string>>} */
  async readVisibleConversationIds(conversationIds, actor) {
    if (!conversationIds.length) return new Set();
    const result = await this.#database.query(
      `SELECT conversation.id FROM crm.conversations conversation
       WHERE conversation.id=ANY($1::text[])
         AND EXISTS (SELECT 1 FROM crm.users reader JOIN crm.user_functions role ON role.user_id=reader.id
           WHERE reader.id=$2 AND reader.disabled_at IS NULL AND role.function_name='Vendedor')
         AND ${contactConversationVisible('conversation', '$2', "EXISTS (SELECT 1 FROM crm.user_capabilities WHERE user_id=$2 AND capability='COMMERCIAL_ADMIN')")}`,
      [conversationIds, actor.id],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  /**
   * Painel ("Meus pedidos"): the conversations with an order that are
   * assigned to this user now.
   *
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async listAssignedOrderConversationIds(userId) {
    const result = await this.#database.query(
      `SELECT DISTINCT conversation.id FROM crm.orders orders
       JOIN crm.conversations conversation
         ON conversation.id = orders.conversation_id
       WHERE conversation.assigned_user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Display names of the people an order mentions (seller, confirmer,
   * reopener); unknown ids are left out.
   *
   * @param {string[]} userIds
   * @returns {Promise<Map<string, string|null>>}
   */
  async readUserNames(userIds) {
    if (userIds.length === 0) return new Map();
    const result = await this.#database.query(
      'SELECT id, name FROM crm.users WHERE id = ANY($1::text[])',
      [userIds],
    );
    return new Map(result.rows.map((row) => [row.id, row.name ?? null]));
  }

  /**
   * Last message metadata for an order card. The query never reads content,
   * contact identity or recipient information.
   * @param {string[]} conversationIds
   * @returns {Promise<Map<string, {direction: string, occurredAt: string, sentAt: string|null, deliveryStatus: string|null, status: string}>>}
   */
  async readLatestMessageStates(conversationIds) {
    if (conversationIds.length === 0) return new Map();
    const result = await this.#database.query(
      `SELECT DISTINCT ON (message.conversation_id)
              message.conversation_id, message.direction, message.status,
              message.delivery_status, message.occurred_at,
              message.sent_at
       FROM crm.messages AS message
       WHERE message.conversation_id = ANY($1::text[])
       ORDER BY message.conversation_id, message.occurred_at DESC, message.id DESC`,
      [conversationIds],
    );
    return new Map(
      result.rows.map((row) => [
        row.conversation_id,
        {
          direction: row.direction,
          occurredAt: new Date(row.occurred_at).toISOString(),
          // Message creation may precede an actual send by hours or days.
          // A later delivered/read receipt does not move the confirmed send.
          sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
          deliveryStatus: row.delivery_status ?? null,
          status: row.status,
        },
      ]),
    );
  }

  /**
   * What each existing conversation says about its order, read in one query:
   * a new order is built from it, and a pending one reads its client from it
   * again (ADR 018). The contact is the one the identity points to now, so a
   * rename or a merge reaches the order. Unknown ids are left out.
   *
   * @param {string[]} conversationIds
   * @returns {Promise<Map<string, import('../application/order-service.js').OrderConversationContext>>}
   */
  async readOrderContexts(conversationIds) {
    if (conversationIds.length === 0) return new Map();
    const result = await this.#database.query(
      `SELECT conversation.id, conversation.briefing_version,
              conversation.briefing_envelope, conversation.opened_at,
              contact.display_name, contact.display_name_source
       FROM crm.conversations conversation
       JOIN crm.contact_identities identity
         ON identity.id = conversation.contact_identity_id
       JOIN crm.contacts contact ON contact.id = identity.current_contact_id
       WHERE conversation.id = ANY($1::text[])`,
      [conversationIds],
    );
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          briefing: row.briefing_envelope
            ? decryptJson(
                row.briefing_envelope,
                `n8n-briefing:${row.id}:${row.briefing_version}`,
                this.#envelopeKey,
              )
            : null,
          // ADR 016: only a confirmed name. Without one the order falls back
          // to the briefing's `customer_name`, then stays blank for the seller.
          customerName: CONFIRMED_NAME_SOURCES.has(row.display_name_source)
            ? (row.display_name ?? null)
            : null,
          // The first inbound message of this conversation opened it.
          openedAt: new Date(row.opened_at).toISOString(),
        },
      ]),
    );
  }

  /** WAP-33: absence of an explicit target is safe only with zero/one subject.
   * WAP-E11: consulted only by creation, and without a pair only while
   * creation by Subject is available; readers do not count Subjects.
   * Callers that mutate bind this port to the command transaction and already
   * hold conversation/Contact authority locks.
   * @param {string} conversationId @param {string|undefined} subjectId
   * @param {number|undefined} expectedSubjectVersion
   */
  async resolveOrderTarget(conversationId, subjectId, expectedSubjectVersion) {
    const { rows } = await this.#database.query(
      `SELECT subject.id,subject.order_id,subject.version,subject.contact_id,
              identity.current_contact_id
       FROM crm.conversation_subjects subject
       JOIN crm.conversations conversation ON conversation.id=subject.conversation_id
       JOIN crm.contact_identities identity ON identity.id=conversation.contact_identity_id
       WHERE subject.conversation_id=$1 ORDER BY subject.id`,
      [conversationId],
    );
    if (!subjectId && rows.length > 1)
      throw new OrderConflictError(
        'An explicit subject is required',
        'ORDER_TARGET_REQUIRED',
      );
    const subject = subjectId
      ? rows.find((row) => row.id === subjectId)
      : rows[0];
    if (subjectId && !subject)
      throw new OrderNotFoundError(
        'Subject was not found',
        'SUBJECT_NOT_FOUND',
      );
    if (subject && subject.contact_id !== subject.current_contact_id)
      throw new OrderConflictError(
        'Subject Contact changed',
        'ORDER_TARGET_REQUIRED',
      );
    if (subjectId && Number(subject.version) !== expectedSubjectVersion)
      throw new OrderConflictError('Subject version changed');
    return {
      subjectId: subject?.id ?? null,
      orderId: subject?.order_id ?? null,
    };
  }

  /**
   * WAP-31/WAP-33 (P2-1): with creation by Subject available, an order on a
   * conversation without any Subject gets its own target in the same
   * transaction, as a current "geral" Subject the order then promotes. It is
   * never created over an existing Subject; the caller is bound to the
   * creation transaction and holds the conversation lock.
   *
   * @param {string} conversationId
   * @param {{actorId: string, correlationId: string, now: Date}} input
   * @returns {Promise<string>}
   */
  async createOrderSubject(conversationId, input) {
    const subjectId = randomUUID();
    const at = input.now.toISOString();
    const created = await this.#database.query(
      `INSERT INTO crm.conversation_subjects
         (id, conversation_id, contact_id, order_id, kind, position,
          is_current, selected_source, selected_by, selected_at,
          created_by, created_by_kind, version, created_at, updated_at)
       SELECT $1, conversation.id, identity.current_contact_id, NULL, 'geral',
              1, true, 'human', $3, $4::timestamptz, $3, 'human', 1, $4, $4
       FROM crm.conversations conversation
       JOIN crm.contact_identities identity
         ON identity.id = conversation.contact_identity_id
       WHERE conversation.id = $2
         AND NOT EXISTS (SELECT 1 FROM crm.conversation_subjects existing
                         WHERE existing.conversation_id = conversation.id)
       RETURNING id`,
      [subjectId, conversationId, input.actorId, at],
    );
    if (!created.rows[0]) throw new OrderConflictError('Subjects changed');
    // The Inbox rereads Subjects on this event, as after "Adicionar assunto".
    await this.#database.query(
      `INSERT INTO crm.domain_events
         (id, aggregate_type, aggregate_id, aggregate_version, event_type,
          payload, correlation_id, occurred_at)
       SELECT $1, 'conversation', $2,
              COALESCE((SELECT max(existing.aggregate_version)
                        FROM crm.domain_events existing
                        WHERE existing.aggregate_type='conversation'
                          AND existing.aggregate_id=$2), 0)+1,
              'conversation.subjects_changed', $3::jsonb, $4, $5`,
      [
        `event-${randomUUID()}`,
        conversationId,
        JSON.stringify({
          conversationId,
          subjectId,
          orderId: null,
          previousSubjectId: null,
        }),
        input.correlationId,
        at,
      ],
    );
    await this.#database.query(
      `INSERT INTO crm.audit_events
         (id, actor_id, action, target_type, target_id, version, reason,
          correlation_id, occurred_at)
       VALUES ($1, $2, 'conversation.subject_created', 'conversation_subject',
               $3, '1', 'ORDER_TARGET_CREATED', $4, $5)`,
      [randomUUID(), input.actorId, subjectId, input.correlationId, at],
    );
    return subjectId;
  }

  /** @param {string[]} subjectIds
   * @returns {Promise<Map<string, import('../application/order-service.js').OrderConversationContext>>} */
  async readSubjectOrderContexts(subjectIds) {
    if (!subjectIds.length) return new Map();
    const result = await this.#database.query(
      `SELECT subject.id,conversation.opened_at,contact.display_name,contact.display_name_source,
              briefing.version,briefing.envelope,briefing.legacy_conversation_id
       FROM crm.conversation_subjects subject
       JOIN crm.conversations conversation ON conversation.id=subject.conversation_id
       JOIN crm.contact_identities identity ON identity.id=conversation.contact_identity_id
       JOIN crm.contacts contact ON contact.id=identity.current_contact_id
       LEFT JOIN crm.subject_briefings briefing ON briefing.subject_id=subject.id
       WHERE subject.id=ANY($1::text[])`,
      [subjectIds],
    );
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          briefing: row.envelope
            ? decryptJson(
                row.envelope,
                row.legacy_conversation_id
                  ? `n8n-briefing:${row.legacy_conversation_id}:${row.version}`
                  : `n8n-subject-briefing:${row.id}:${row.version}`,
                this.#envelopeKey,
              )
            : null,
          customerName: CONFIRMED_NAME_SOURCES.has(row.display_name_source)
            ? (row.display_name ?? null)
            : null,
          openedAt: new Date(row.opened_at).toISOString(),
        },
      ]),
    );
  }

  /**
   * Read-only display lookup: each contact id mapped to the contact that
   * survives its merges. It follows the ACTIVE identity links (source to
   * target, immutable history) one hop per step, taking the latest link when a
   * contact has several, with a depth cap and a visited-path guard against
   * cycles. Nothing is written, so an unmerge (link no longer active) resolves
   * the id back to itself. Writes and authorization keep using the stored
   * `orders.contact_id`.
   *
   * @param {string[]} contactIds
   * @returns {Promise<Map<string, string>>}
   */
  async readCurrentContactIds(contactIds) {
    if (contactIds.length === 0) return new Map();
    const result = await this.#database.query(
      `WITH RECURSIVE walk(start_id, contact_id, depth, path) AS (
         SELECT id, id, 0, ARRAY[id]::text[]
         FROM unnest($1::text[]) AS id
         UNION ALL
         SELECT walk.start_id, hop.target_contact_id, walk.depth + 1,
                walk.path || hop.target_contact_id
         FROM walk
         CROSS JOIN LATERAL (
           SELECT link.target_contact_id
           FROM crm.identity_links AS link
           WHERE link.status = 'active'
             AND link.source_contact_id = walk.contact_id
           ORDER BY link.merged_at DESC, link.id DESC
           LIMIT 1
         ) AS hop
         WHERE walk.depth < 8
           AND NOT hop.target_contact_id = ANY(walk.path)
       )
       SELECT DISTINCT ON (start_id) start_id, contact_id
       FROM walk
       ORDER BY start_id, depth DESC`,
      [contactIds],
    );
    return new Map(result.rows.map((row) => [row.start_id, row.contact_id]));
  }

  /**
   * Current operator-entered names of contacts used by manual orders. With a
   * `visibilityActorId` only the Contacts that person may read are returned
   * (WAP-07), using the predicate of `GET /api/v1/contacts/:id`.
   *
   * @param {string[]} contactIds @param {{visibilityActorId?: string}} [reader]
   */
  async readContactNames(contactIds, reader = {}) {
    if (contactIds.length === 0) return new Map();
    const result = await this.#database.query(
      `SELECT contact.id, contact.display_name, contact.display_name_source
       FROM crm.contacts contact WHERE contact.id = ANY($1::text[])
         AND ($2::text IS NULL OR ${contactReadable('contact', '$2')})`,
      [contactIds, reader.visibilityActorId ?? null],
    );
    return new Map(
      result.rows.map((row) => [
        row.id,
        CONFIRMED_NAME_SOURCES.has(row.display_name_source)
          ? (row.display_name ?? null)
          : null,
      ]),
    );
  }

  /** The list search includes a manual order even without a conversation.
   * WAP-07/08: every branch, the name one included, keeps to the Contacts
   * with an order the reader may read (the Contact rule, or the reader is
   * that order's seller); the order list applies the same rule again. */
  /** @param {string} query @param {any} [reader] */
  async searchContactIds(query, reader = {}) {
    const text = String(query).trim();
    if (!text) return [];
    const phone = normalizeContactPhone(text);
    const phoneHash = phone
      ? contactPhoneHash(phone, this.#contactLookupKey)
      : null;
    const result = await this.#database.query(
      `SELECT contact.id FROM crm.contacts AS contact
       WHERE ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM crm.orders contact_order
           WHERE contact_order.contact_id = contact.id
             AND ${orderReadable('contact_order', '$3')}))
         AND (contact.display_name ILIKE $1 ESCAPE '\\'
          OR ($2::text IS NOT NULL AND (
            contact.contact_phone_hash = $2
            OR EXISTS (
              SELECT 1 FROM crm.contact_phone_lookup AS phone_lookup
              LEFT JOIN crm.contact_identities AS phone_identity
                ON phone_identity.id = phone_lookup.identity_id
              WHERE phone_lookup.phone_hash = $2
                AND ((phone_lookup.source = 'manual'
                      AND phone_lookup.contact_id = contact.id)
                     OR (phone_lookup.source = 'whatsapp'
                         AND phone_identity.current_contact_id = contact.id
                         AND ${personalIdentityVisible('phone_identity', '$4')}))
            ) OR EXISTS (
              SELECT 1 FROM crm.site_contact_claims AS claim
              JOIN crm.conversations AS conversation
                ON conversation.id = claim.conversation_id
              JOIN crm.contact_identities AS identity
                ON identity.id = conversation.contact_identity_id
              WHERE claim.phone_hash = $2
                AND identity.current_contact_id = contact.id
                AND ${contactConversationVisible('conversation', '$4', '$3::text IS NULL')}
            )
          )))
       ORDER BY contact.id`,
      [
        `%${text.replace(/[\\%_]/gu, '\\$&')}%`,
        phoneHash,
        reader.readAll ? null : (reader.actorId ?? null),
        reader.actorId ?? null,
      ],
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Conversations with orders whose customer name, handle or phone matches.
   * Phone matching compares digits only, so "(11) 98765" finds 5511987650000.
   *
   * @param {string} query
   * @param {any} [reader]
   * @returns {Promise<string[]>}
   */
  async searchConversationIds(query, reader = {}) {
    const text = foldText(query);
    const digits = String(query).replace(/\D/gu, '');
    if (text === '') return [];
    const result = await this.#database.query(
      `SELECT DISTINCT conversation.id, contact.display_name,
              identity.identity_kind, identity.identity_envelope,
              identity.external_identity_lookup_hash
       FROM crm.orders orders
       JOIN crm.conversations conversation
         ON conversation.id = orders.conversation_id
       JOIN crm.contact_identities identity
         ON identity.id = conversation.contact_identity_id
       JOIN crm.contacts contact ON contact.id = identity.current_contact_id
       WHERE ${personalIdentityVisible('identity', '$1')}`,
      [reader.actorId ?? null],
    );
    return result.rows
      .filter((row) => {
        const identity = this.#identity(row);
        if (
          [row.display_name, identity.displayHandle].some((name) =>
            foldText(name).includes(text),
          )
        ) {
          return true;
        }
        return (
          digits.length >= MIN_PHONE_DIGITS &&
          row.identity_kind === 'phone' &&
          String(identity.externalIdentityId ?? '')
            .replace(/\D/gu, '')
            .includes(digits)
        );
      })
      .map((row) => row.id)
      .sort();
  }

  /** @param {any} row */
  #identity(row) {
    return decryptContactIdentityEnvelope(
      row.identity_envelope,
      row.external_identity_lookup_hash,
      this.#contactEnvelopeKey,
    );
  }
}
