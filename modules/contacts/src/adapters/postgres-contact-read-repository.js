import { decryptContactIdentityEnvelope } from './contact-identity-envelope.js';

export class PostgresContactReadRepository {
  /** @param {{database: {query: Function, transaction?: Function}, envelopeKey: Buffer}} options */
  constructor({ database, envelopeKey }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
      throw new TypeError('envelopeKey must be a 32-byte Buffer');
    }
    this.database = database;
    this.envelopeKey = Buffer.from(envelopeKey);
  }

  /** @param {{after: null|{updatedAt: string, id: string}, limit: number}} input */
  async list(input) {
    return this.#snapshot(async (database) => {
      const values = [];
      const predicate = input.after
        ? (() => {
            values.push(input.after.updatedAt, input.after.id);
            return '(contact.updated_at, contact.id) < ($1, $2)';
          })()
        : 'true';
      values.push(input.limit + 1);
      const [page, count] = await Promise.all([
        database.query(
          `WITH contact_page AS (
             SELECT contact.* FROM crm.contacts AS contact
             WHERE ${predicate}
             ORDER BY contact.updated_at DESC, contact.id DESC
             LIMIT $${values.length}
           )
           SELECT contact_page.*,
                  identity.id identity_id, identity.channel,
                  identity.identity_kind, identity.phone_status,
                  identity.external_identity_lookup_hash,
                  identity.identity_envelope,
                  COALESCE((SELECT count(*)::integer FROM crm.deals deal
                            WHERE deal.contact_id=contact_page.id
                              AND deal.status='active'), 0) active_deal_count,
                  GREATEST(
                    contact_page.updated_at,
                    COALESCE((SELECT max(conversation.last_message_at)
                              FROM crm.contact_identities linked_identity
                              JOIN crm.conversations conversation
                                ON conversation.contact_identity_id=linked_identity.id
                              WHERE linked_identity.current_contact_id=contact_page.id),
                             contact_page.updated_at),
                    COALESCE((SELECT max(deal.updated_at) FROM crm.deals deal
                              WHERE deal.contact_id=contact_page.id),
                             contact_page.updated_at)
                  ) latest_activity_at
           FROM contact_page
           LEFT JOIN crm.contact_identities identity
             ON identity.current_contact_id=contact_page.id
           ORDER BY contact_page.updated_at DESC, contact_page.id DESC,
                    identity.created_at, identity.id`,
          values,
        ),
        database.query('SELECT count(*)::integer count FROM crm.contacts'),
      ]);
      const contacts = groupContacts(page.rows, this.envelopeKey);
      const hasMore = contacts.length > input.limit;
      return {
        hasMore,
        items: contacts.slice(0, input.limit),
        totalCount: Number(count.rows[0]?.count ?? 0),
      };
    });
  }

  /** @param {string} contactId */
  async get(contactId) {
    return this.#snapshot(async (database) => {
      const [contact, identities, conversations, deals] = await runSequential([
        () =>
          database.query(
            `SELECT id, display_name, provisional, version, created_at,
                    updated_at
             FROM crm.contacts WHERE id=$1`,
            [contactId],
          ),
        () =>
          database.query(
            `SELECT id, channel, identity_kind, phone_status,
                    external_identity_lookup_hash, identity_envelope,
                    created_at, updated_at
             FROM crm.contact_identities
             WHERE current_contact_id=$1 ORDER BY created_at, id`,
            [contactId],
          ),
        () =>
          database.query(
            `SELECT conversation.id, conversation.state,
                    conversation.automation_state, conversation.version,
                    conversation.opened_at, conversation.last_message_at,
                    conversation.terminal_at, identity.channel
             FROM crm.conversations conversation
             JOIN crm.contact_identities identity
               ON identity.id=conversation.contact_identity_id
             WHERE identity.current_contact_id=$1
             ORDER BY conversation.last_message_at DESC, conversation.id DESC`,
            [contactId],
          ),
        () =>
          database.query(
            `SELECT deal.id, deal.stage, deal.status, deal.version,
                    deal.created_at, deal.updated_at,
                    deal.assigned_user_id, user_function.function_name
             FROM crm.deals deal
             LEFT JOIN crm.user_functions user_function
               ON user_function.user_id=deal.assigned_user_id
             WHERE deal.contact_id=$1
             ORDER BY deal.updated_at DESC, deal.id DESC`,
            [contactId],
          ),
      ]);
      const row = contact.rows[0];
      if (!row) throw notFound('CONTACT_NOT_FOUND');
      const identityViews = identities.rows.map((/** @type {any} */ identity) =>
        mapIdentity(identity, this.envelopeKey),
      );
      return {
        activeDealCount: deals.rows.filter(
          (/** @type {any} */ deal) => deal.status === 'active',
        ).length,
        contact: mapContact(row, identityViews),
        conversations: conversations.rows.map(
          (/** @type {any} */ conversation) => ({
            automationState: conversation.automation_state,
            channel: conversation.channel,
            id: conversation.id,
            lastMessageAt: iso(conversation.last_message_at),
            openedAt: iso(conversation.opened_at),
            state: conversation.state,
            terminalAt: conversation.terminal_at
              ? iso(conversation.terminal_at)
              : null,
            version: Number(conversation.version),
          }),
        ),
        deals: deals.rows.map((/** @type {any} */ deal) => ({
          assignedUser: deal.assigned_user_id
            ? {
                functionName: deal.function_name,
                id: deal.assigned_user_id,
              }
            : null,
          createdAt: iso(deal.created_at),
          id: deal.id,
          stage: deal.stage,
          status: deal.status,
          updatedAt: iso(deal.updated_at),
          version: Number(deal.version),
        })),
        identities: identityViews,
      };
    });
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

/** @param {any[]} rows @param {Buffer} key */
function groupContacts(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    let current = grouped.get(row.id);
    if (!current) {
      current = {
        activeDealCount: Number(row.active_deal_count),
        createdAt: iso(row.created_at),
        displayName: row.display_name ?? null,
        id: row.id,
        identities: [],
        latestActivityAt: iso(row.latest_activity_at),
        provisional: Boolean(row.provisional),
        updatedAt: iso(row.updated_at),
        version: Number(row.version),
      };
      grouped.set(row.id, current);
    }
    if (row.identity_id) current.identities.push(mapIdentity(row, key));
  }
  return [...grouped.values()].map((contact) =>
    mapContact(contact, contact.identities),
  );
}

/** @param {any} row @param {any[]} identities */
function mapContact(row, identities) {
  const primary =
    identities.find((identity) => identity.channel === 'whatsapp') ??
    identities[0] ??
    null;
  return Object.freeze({
    activeDealCount: Number(row.activeDealCount ?? row.active_deal_count ?? 0),
    createdAt: row.createdAt ?? iso(row.created_at),
    displayName: row.displayName ?? row.display_name ?? null,
    id: row.id,
    identities: Object.freeze([...identities]),
    // Operator-chosen name wins; the channel handle is only the fallback.
    label:
      row.displayName ??
      row.display_name ??
      primary?.displayHandle ??
      primary?.externalId ??
      `Contato ${row.id}`,
    latestActivityAt:
      row.latestActivityAt ?? row.updatedAt ?? iso(row.updated_at),
    provisional: Boolean(row.provisional),
    updatedAt: row.updatedAt ?? iso(row.updated_at),
    version: Number(row.version),
  });
}

/** @param {any} row @param {Buffer} key */
function mapIdentity(row, key) {
  const secret = decryptContactIdentityEnvelope(
    row.identity_envelope,
    row.external_identity_lookup_hash,
    key,
  );
  return Object.freeze({
    channel: row.channel,
    displayHandle: secret.displayHandle ?? null,
    externalId: secret.externalIdentityId,
    id: row.identity_id ?? row.id,
    kind: row.identity_kind,
    phoneStatus: row.phone_status,
  });
}

/** @param {Array<() => Promise<any>>} operations */
async function runSequential(operations) {
  const results = [];
  for (const operation of operations) results.push(await operation());
  return results;
}

/** @param {any} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** @param {string} code */
function notFound(code) {
  return Object.assign(new Error(code), { code, statusCode: 404 });
}
