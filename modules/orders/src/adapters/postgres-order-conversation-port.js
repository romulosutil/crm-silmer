import { decryptContactIdentityEnvelope } from '@crm-silmer/contacts/identity-envelope';

import { decryptJson } from './envelope.js';

/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable
 */

const MIN_PHONE_DIGITS = 4;

/** @param {unknown} value */
function foldText(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    : '';
}

/**
 * What an order needs from the conversation it belongs to: who owns it, the
 * customer shown on the ficha, the agent's pre-ficha and the list search.
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

  /**
   * `envelopeKey` is the n8n pre-ficha key (`N8N_INTEGRATION_ENVELOPE_KEY`);
   * `contactEnvelopeKey` opens the channel identity (`CONTACT_IDENTITY_ENVELOPE_KEY`).
   *
   * @param {{database: Queryable, envelopeKey: Buffer, contactEnvelopeKey: Buffer}} options
   */
  constructor({ contactEnvelopeKey, database, envelopeKey }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    for (const [key, name] of /** @type {const} */ ([
      [envelopeKey, 'envelopeKey'],
      [contactEnvelopeKey, 'contactEnvelopeKey'],
    ])) {
      if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new TypeError(`${name} must be a 32-byte Buffer`);
      }
    }
    this.#database = database;
    this.#envelopeKey = Buffer.from(envelopeKey);
    this.#contactEnvelopeKey = Buffer.from(contactEnvelopeKey);
  }

  /**
   * @param {string} conversationId
   * @returns {Promise<{assignedUserId: string|null}|null>}
   */
  async readAssignment(conversationId) {
    const result = await this.#database.query(
      'SELECT assigned_user_id FROM crm.conversations WHERE id = $1',
      [conversationId],
    );
    const row = result.rows[0];
    return row ? { assignedUserId: row.assigned_user_id ?? null } : null;
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
   * @param {string} conversationId
   * @returns {Promise<import('../application/order-service.js').OrderConversationContext|null>}
   */
  async readOrderContext(conversationId) {
    const result = await this.#database.query(
      `SELECT conversation.id, conversation.briefing_version,
              conversation.briefing_envelope, contact.display_name,
              identity.identity_envelope, identity.external_identity_lookup_hash
       FROM crm.conversations conversation
       JOIN crm.contact_identities identity
         ON identity.id = conversation.contact_identity_id
       JOIN crm.contacts contact ON contact.id = identity.current_contact_id
       WHERE conversation.id = $1`,
      [conversationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const identity = this.#identity(row);
    return {
      briefing: row.briefing_envelope
        ? decryptJson(
            row.briefing_envelope,
            `n8n-briefing:${row.id}:${row.briefing_version}`,
            this.#envelopeKey,
          )
        : null,
      // Same precedence as the Inbox label, without falling back to the phone.
      customerName: row.display_name ?? identity.displayHandle ?? null,
    };
  }

  /**
   * Conversations with orders whose customer name, handle or phone matches.
   * Phone matching compares digits only, so "(11) 98765" finds 5511987650000.
   *
   * @param {string} query
   * @returns {Promise<string[]>}
   */
  async searchConversationIds(query) {
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
       JOIN crm.contacts contact ON contact.id = identity.current_contact_id`,
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
