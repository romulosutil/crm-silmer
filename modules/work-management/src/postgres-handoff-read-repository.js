import { decryptContactIdentityEnvelope } from '@crm-silmer/contacts/identity-envelope';
import { contactConversationVisible } from '@crm-silmer/contacts';

import { decryptHandoffSummary } from './cipher.js';

export class PostgresHandoffReadRepository {
  /** @param {{contactEnvelopeKey: Buffer, database: {query: Function, transaction?: Function}, handoffEnvelopeKey: Buffer, n8nEnvelopeKey?: Buffer}} options */
  constructor({
    contactEnvelopeKey,
    database,
    handoffEnvelopeKey,
    n8nEnvelopeKey,
  }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    for (const [value, name] of [
      [contactEnvelopeKey, 'contactEnvelopeKey'],
      [handoffEnvelopeKey, 'handoffEnvelopeKey'],
    ]) {
      if (!Buffer.isBuffer(value) || value.length !== 32) {
        throw new TypeError(`${name} must be a 32-byte Buffer`);
      }
    }
    this.contactEnvelopeKey = Buffer.from(contactEnvelopeKey);
    this.database = database;
    this.handoffEnvelopeKey = Buffer.from(handoffEnvelopeKey);
    if (
      n8nEnvelopeKey !== undefined &&
      (!Buffer.isBuffer(n8nEnvelopeKey) || n8nEnvelopeKey.length !== 32)
    ) {
      throw new TypeError('n8nEnvelopeKey must be a 32-byte Buffer');
    }
    this.n8nEnvelopeKey = n8nEnvelopeKey && Buffer.from(n8nEnvelopeKey);
  }

  /** @param {{after: null|{id: string, updatedAt: string}, limit: number}} input @param {{actorId?:string|null,visibilityActorId?: string}} [reader] */
  async listOpen(input, reader = {}) {
    return this.#snapshot(async (database) => {
      const scopedReader = await this.#currentReader(database, reader);
      const values = [];
      const predicates = ["handoff.status = 'pending'"];
      if (scopedReader.visibilityActorId) {
        values.push(scopedReader.visibilityActorId);
        predicates.push(
          contactConversationVisible('conversation', `$${values.length}`),
        );
      }
      const countValues = [...values];
      const countWhere = predicates.join(' AND ');
      if (input.after) {
        values.push(input.after.updatedAt, input.after.id);
        predicates.push(
          `(handoff.updated_at, handoff.id) < ($${values.length - 1}, $${values.length})`,
        );
      }
      const where = predicates.join(' AND ');
      values.push(input.limit + 1);
      const [page, count] = await Promise.all([
        database.query(
          `SELECT handoff.id, handoff.deal_id, handoff.conversation_id,
                  handoff.status, handoff.version, handoff.reason_code,
                  handoff.summary_envelope, handoff.target_role, handoff.due_at,
                  handoff.sla_minutes, handoff.created_at, handoff.updated_at,
                  conversation.version conversation_version,
                  conversation.automation_epoch, identity.channel,
                  identity.external_identity_lookup_hash, identity.identity_envelope,
                  contact.id contact_id, contact.display_name
           FROM crm.handoffs handoff
           JOIN crm.conversations conversation
             ON conversation.id = handoff.conversation_id
           JOIN crm.contact_identities identity
             ON identity.id = conversation.contact_identity_id
           JOIN crm.contacts contact ON contact.id = identity.current_contact_id
           WHERE ${where}
           ORDER BY handoff.updated_at DESC, handoff.id DESC
           LIMIT $${values.length}`,
          values,
        ),
        database.query(
          `SELECT count(*)::integer count FROM crm.handoffs handoff
           JOIN crm.conversations conversation ON conversation.id=handoff.conversation_id
           WHERE ${countWhere}`,
          countValues,
        ),
      ]);
      const hasMore = page.rows.length > input.limit;
      return {
        hasMore,
        items: page.rows
          .slice(0, input.limit)
          .map((/** @type {any} */ row) => mapHandoff(row, this)),
        totalCount: Number(count.rows[0]?.count ?? 0),
      };
    });
  }

  /**
   * INBOX-HANDOFF-01: the summary of the conversation's open handoff (pending
   * or accepted), for the Inbox. At most one is open per conversation; null
   * when there is none.
   *
   * @param {string} conversationId @param {{actorId?:string|null,visibilityActorId?: string}} [reader]
   */
  async getOpenForConversation(conversationId, reader = {}) {
    return this.#snapshot(async (database) => {
      const scopedReader = await this.#currentReader(database, reader);
      const result = await database.query(
        `SELECT handoff.id, handoff.deal_id, handoff.conversation_id,
                handoff.status, handoff.version, handoff.reason_code,
                handoff.summary_envelope, handoff.created_at,
                preferred.id preferred_id,
                split_part(preferred.name, ' ', 1) preferred_first_name
         FROM crm.handoffs handoff
         JOIN crm.conversations conversation ON conversation.id=handoff.conversation_id
         LEFT JOIN crm.users preferred ON preferred.id = handoff.preferred_user_id
         WHERE handoff.conversation_id = $1
           AND ($2::text IS NULL OR ${contactConversationVisible('conversation', '$2')})
           AND handoff.status IN ('pending', 'accepted')
         ORDER BY handoff.created_at DESC, handoff.id DESC
         LIMIT 1`,
        [conversationId, scopedReader.visibilityActorId ?? null],
      );
      const row = result.rows[0];
      if (!row) return null;
      return Object.freeze({
        createdAt: iso(row.created_at),
        id: row.id,
        // INBOX-HANDOFF-02: who the customer asked for, first name only.
        preferredSeller: row.preferred_id
          ? Object.freeze({
              firstName: row.preferred_first_name,
              id: row.preferred_id,
            })
          : null,
        reasonCode: row.reason_code,
        status: row.status,
        summary: summaryText(row, this),
        version: Number(row.version),
      });
    });
  }

  /** @param {any} database @param {any} reader @returns {Promise<any>} */
  async #currentReader(database, reader) {
    if (!reader.actorId) return reader;
    const user = (
      await database.query(
        `SELECT actor.disabled_at,role.function_name,
         EXISTS(SELECT 1 FROM crm.user_capabilities WHERE user_id=actor.id AND capability='COMMERCIAL_ADMIN') is_admin
       FROM crm.users actor LEFT JOIN crm.user_functions role ON role.user_id=actor.id WHERE actor.id=$1`,
        [reader.actorId],
      )
    ).rows[0];
    if (!user || user.disabled_at || user.function_name !== 'Vendedor')
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    return {
      ...reader,
      visibilityActorId: user.is_admin ? undefined : reader.actorId,
    };
  }

  /** @template T @param {(database: any) => Promise<T>} work */
  async #snapshot(work) {
    if (typeof this.database.transaction !== 'function') {
      return work(this.database);
    }
    return this.database.transaction(async (/** @type {any} */ client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      return work(client);
    });
  }
}

/** @param {any} row @param {PostgresHandoffReadRepository} repository */
function mapHandoff(row, repository) {
  const identity = decryptContactIdentityEnvelope(
    row.identity_envelope,
    row.external_identity_lookup_hash,
    repository.contactEnvelopeKey,
  );
  return Object.freeze({
    automationEpoch: Number(row.automation_epoch),
    contact: {
      externalId: identity.externalIdentityId,
      id: row.contact_id,
      label:
        row.display_name ??
        identity.displayHandle ??
        identity.externalIdentityId ??
        `Contato ${row.contact_id}`,
    },
    conversationId: row.conversation_id,
    conversationVersion: Number(row.conversation_version),
    createdAt: iso(row.created_at),
    dueAt: iso(row.due_at),
    id: row.id,
    reasonCode: row.reason_code,
    slaMinutes: Number(row.sla_minutes),
    status: row.status,
    summary: summaryText(row, repository),
    targetRole: row.target_role,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  });
}

/**
 * The work-management service binds the plain summary to its Deal. The n8n
 * handoff exists before a Deal does (`deal_id` NULL): it binds the summary to
 * the conversation with the integration key and stores it JSON-encoded
 * (`encryptJson`), so the quotes
 * and escapes are removed here instead of reaching the seller.
 *
 * @param {{conversation_id: string, deal_id?: string|null, summary_envelope: unknown}} row
 * @param {PostgresHandoffReadRepository} repository
 */
function summaryText(row, repository) {
  if (row.deal_id) {
    return decryptHandoffSummary(
      row.summary_envelope,
      `${row.deal_id}:${row.conversation_id}:handoff:summary`,
      repository.handoffEnvelopeKey,
    );
  }
  if (!repository.n8nEnvelopeKey) {
    throw new Error('The n8n integration key is required to read its handoff');
  }
  const text = decryptHandoffSummary(
    row.summary_envelope,
    `${row.conversation_id}:handoff:summary`,
    repository.n8nEnvelopeKey,
  );
  try {
    const value = JSON.parse(text);
    return typeof value === 'string' ? value : text;
  } catch {
    return text;
  }
}

/** @param {any} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
