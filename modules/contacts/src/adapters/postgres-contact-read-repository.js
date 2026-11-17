import {
  contactVisible,
  personalIdentityVisible,
  contactConversationVisible,
} from './contact-access.js';
import { decryptContactIdentityEnvelope } from './contact-identity-envelope.js';
import {
  contactPhoneHash,
  decryptContactDetails,
  normalizeContactPhone,
} from '../domain/contact-details.js';
import { decryptContactRegistration } from '../domain/contact-registration-envelope.js';
import { decryptSiteContactClaim } from '../domain/site-contact-claim.js';

export class PostgresContactReadRepository {
  /** @param {{database: {query: Function, transaction?: Function}, envelopeKey: Buffer, lookupKey: Buffer}} options */
  constructor({ database, envelopeKey, lookupKey }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
      throw new TypeError('envelopeKey must be a 32-byte Buffer');
    }
    if (!Buffer.isBuffer(lookupKey) || lookupKey.length !== 32) {
      throw new TypeError('lookupKey must be a 32-byte Buffer');
    }
    this.database = database;
    this.envelopeKey = Buffer.from(envelopeKey);
    this.lookupKey = Buffer.from(lookupKey);
  }

  /** @param {any} [reader] */
  async scopeVersion(reader = {}) {
    const result = await this.database.query(
      'SELECT COALESCE((SELECT version FROM crm.seller_client_scope_versions WHERE seller_id=$1),0)::text version',
      [reader.actorId ?? reader.walletSellerId ?? null],
    );
    return result.rows[0]?.version ?? '0';
  }

  /** @param {{after: null|{updatedAt: string, id: string}, limit: number, q?: string}} input @param {{actorId?: string|null, visibilityActorId?: string, walletSellerId?: string}} [reader] */
  async list(input, reader = {}) {
    return this.#snapshot(async (database) => {
      const scopedReader = await this.#currentReader(database, reader);
      const values = /** @type {any[]} */ ([]);
      /** @param {any} value */
      const bind = (value) => {
        values.push(value);
        return '$' + values.length;
      };
      const actor = scopedReader.visibilityActorId
        ? bind(scopedReader.visibilityActorId)
        : null;
      const wallet = scopedReader.walletSellerId
        ? scopedReader.walletSellerId === scopedReader.visibilityActorId
          ? actor
          : bind(scopedReader.walletSellerId)
        : null;
      const visible = (/** @type {string} */ alias) =>
        actor ? contactConversationVisible(alias, actor) : 'true';
      const identityVisible = (/** @type {string} */ alias) =>
        actor ? personalIdentityVisible(alias, actor) : 'true';
      const scoped = wallet
        ? contactVisible('contact', wallet, true)
        : actor
          ? contactVisible('contact', actor)
          : 'true';
      const q = (input.q ?? '').trim();
      const phone = normalizeContactPhone(q);
      const term = q
        ? bind(
            phone
              ? contactPhoneHash(phone, this.lookupKey)
              : '%' + q.replace(/[\\%_]/gu, '\\$&') + '%',
          )
        : null;
      const search = !q
        ? 'true'
        : phone
          ? `(EXISTS (
        SELECT 1 FROM crm.contact_phone_lookup phone_lookup
        LEFT JOIN crm.contact_identities phone_identity ON phone_identity.id=phone_lookup.identity_id
        WHERE phone_lookup.phone_hash = ${term}
          AND ((phone_lookup.source='manual' AND phone_lookup.contact_id=contact.id)
            OR (phone_lookup.source='whatsapp' AND phone_identity.current_contact_id = contact.id
              AND ${identityVisible('phone_identity')}))) OR EXISTS (
        SELECT 1 FROM crm.site_contact_claims site_claim
        JOIN crm.conversations site_conversation ON site_conversation.id=site_claim.conversation_id
        JOIN crm.contact_identities site_identity ON site_identity.id=site_conversation.contact_identity_id
        WHERE site_identity.current_contact_id=contact.id AND ${visible('site_conversation')}
          AND site_claim.phone_hash=${term}))`
          : `contact.display_name ILIKE ${term} ESCAPE chr(92)`;
      const predicate = `${scoped} AND (${search})`;
      const countValues = [...values];
      const after = input.after
        ? `(contact.updated_at,contact.id)<(${bind(input.after.updatedAt)},${bind(input.after.id)})`
        : 'true';
      const limit = bind(input.limit + 1);
      const walletProjection = wallet
        ? `(SELECT jsonb_build_object('id',id,'version',version,'status',status)
        FROM crm.seller_client_links WHERE contact_id=contact.id AND seller_id=${wallet} AND status='active')`
        : 'NULL';
      const [page, count] = await Promise.all([
        database.query(
          `WITH contact_page AS (
          SELECT contact.id,contact.display_name,contact.provisional,contact.version,
            contact.created_at,contact.updated_at,contact.contact_details_envelope,
            contact.registration_fields_complete,
            ${walletProjection} wallet_link,
            (SELECT count(*)>1 FROM crm.seller_client_links WHERE contact_id=contact.id AND status='active') shared
          FROM crm.contacts contact WHERE ${predicate} AND ${after}
          ORDER BY contact.updated_at DESC,contact.id DESC LIMIT ${limit})
        SELECT contact_page.*,identity.id identity_id,identity.channel,identity.identity_kind,
          identity.phone_status,identity.external_identity_lookup_hash,identity.identity_envelope,
          site_claim.id site_claim_id,site_claim.version site_claim_version,site_claim.details_envelope site_claim_envelope,
          GREATEST(contact_page.updated_at,COALESCE((SELECT max(conversation.last_message_at)
            FROM crm.contact_identities linked_identity JOIN crm.conversations conversation
              ON conversation.contact_identity_id=linked_identity.id
            WHERE linked_identity.current_contact_id=contact_page.id AND ${visible('conversation')}),contact_page.updated_at)) latest_activity_at
        FROM contact_page
        LEFT JOIN crm.contact_identities identity ON identity.current_contact_id=contact_page.id AND ${identityVisible('identity')}
        LEFT JOIN LATERAL (
          SELECT site_claim.id,site_claim.version,site_claim.details_envelope FROM crm.site_contact_claims site_claim
          JOIN crm.conversations site_conversation ON site_conversation.id=site_claim.conversation_id
          JOIN crm.contact_identities site_identity ON site_identity.id=site_conversation.contact_identity_id
          WHERE site_identity.current_contact_id=contact_page.id AND ${visible('site_conversation')}
            ${phone ? `AND site_claim.phone_hash=${term}` : ''}
          ORDER BY site_claim.updated_at DESC,site_claim.id DESC LIMIT 1
        ) site_claim ON true
        ORDER BY contact_page.updated_at DESC,contact_page.id DESC,identity.created_at,identity.id`,
          values,
        ),
        database.query(
          `SELECT count(*)::integer count FROM crm.contacts contact WHERE ${predicate}`,
          countValues,
        ),
      ]);
      const contacts = groupContacts(
        page.rows,
        this.envelopeKey,
        Boolean(phone),
      );
      return {
        hasMore: contacts.length > input.limit,
        items: contacts.slice(0, input.limit),
        totalCount: Number(count.rows[0]?.count ?? 0),
      };
    });
  }

  /** @param {string} contactId @param {{actorId?: string|null, visibilityActorId?: string}} [reader] */
  async get(contactId, reader = {}) {
    return this.#snapshot(async (database) => {
      const scopedReader = await this.#currentReader(database, reader);
      const [contact, identities, conversations, siteClaims] =
        await runSequential([
          () =>
            database.query(
              `SELECT id, display_name, provisional, version, created_at,
                    updated_at, contact_details_envelope,
                    registration_envelope, registration_fields_complete,
                    (SELECT count(*)>1 FROM crm.seller_client_links WHERE contact_id=contact.id AND status='active') shared
             FROM crm.contacts contact WHERE id=$1
               AND ($2::text IS NULL OR ${contactVisible('contact', '$2')})`,
              [contactId, scopedReader.visibilityActorId ?? null],
            ),
          () =>
            database.query(
              `SELECT id, channel, identity_kind, phone_status,
                    external_identity_lookup_hash, identity_envelope,
                    created_at, updated_at
             FROM crm.contact_identities
             WHERE current_contact_id=$1
               AND ($2::text IS NULL OR ${personalIdentityVisible('crm.contact_identities', '$2')})
             ORDER BY created_at, id`,
              [contactId, scopedReader.visibilityActorId ?? null],
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
               AND ($2::text IS NULL OR ${contactConversationVisible('conversation', '$2')})
             ORDER BY conversation.last_message_at DESC, conversation.id DESC`,
              [contactId, scopedReader.visibilityActorId ?? null],
            ),
          () =>
            database.query(
              `SELECT site_claim.id, site_claim.version, site_claim.details_envelope
             FROM crm.site_contact_claims site_claim
             JOIN crm.conversations site_conversation
               ON site_conversation.id = site_claim.conversation_id
             JOIN crm.contact_identities site_identity
               ON site_identity.id = site_conversation.contact_identity_id
             WHERE site_identity.current_contact_id=$1
               AND ($2::text IS NULL OR ${contactConversationVisible('site_conversation', '$2')})
             ORDER BY site_claim.updated_at DESC, site_claim.id DESC LIMIT 1`,
              [contactId, scopedReader.visibilityActorId ?? null],
            ),
        ]);
      const row = contact.rows[0];
      if (!row) throw notFound('CONTACT_NOT_FOUND');
      const identityViews = identities.rows.map((/** @type {any} */ identity) =>
        mapIdentity(identity, this.envelopeKey),
      );
      return {
        contact: mapContact(
          row,
          identityViews,
          decryptContactDetails(row.contact_details_envelope, this.envelopeKey),
          siteClaims.rows[0]
            ? decryptSiteContactClaim(
                siteClaims.rows[0].details_envelope,
                siteClaims.rows[0].id,
                Number(siteClaims.rows[0].version),
                this.envelopeKey,
              )
            : null,
          false,
          decryptContactRegistration(
            row.registration_envelope,
            this.envelopeKey,
          ),
        ),
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
        identities: identityViews,
      };
    });
  }

  /** Revalidate read authority in the same snapshot as search/count/details.
   * @param {any} database @param {any} reader @returns {Promise<any>} */
  async #currentReader(database, reader) {
    if (!reader.actorId) return reader; // internal trusted readers retain their contract
    const user = (
      await database.query(
        `SELECT actor.id,actor.disabled_at,role.function_name,
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

/** @param {any[]} rows @param {Buffer} key @param {boolean} matchedSitePhone */
function groupContacts(rows, key, matchedSitePhone) {
  const grouped = new Map();
  for (const row of rows) {
    let current = grouped.get(row.id);
    if (!current) {
      current = {
        createdAt: iso(row.created_at),
        displayName: row.display_name ?? null,
        id: row.id,
        identities: [],
        details: decryptContactDetails(row.contact_details_envelope, key),
        siteClaim: row.site_claim_id
          ? decryptSiteContactClaim(
              row.site_claim_envelope,
              row.site_claim_id,
              Number(row.site_claim_version),
              key,
            )
          : null,
        latestActivityAt: iso(row.latest_activity_at),
        shared: row.shared === true,
        wallet_link: row.wallet_link,
        provisional: Boolean(row.provisional),
        registration_fields_complete: row.registration_fields_complete === true,
        updatedAt: iso(row.updated_at),
        version: Number(row.version),
      };
      grouped.set(row.id, current);
    }
    if (row.identity_id) current.identities.push(mapIdentity(row, key));
  }
  return [...grouped.values()].map((contact) =>
    mapContact(
      contact,
      contact.identities,
      contact.details,
      contact.siteClaim,
      matchedSitePhone,
    ),
  );
}

/** @param {any} row @param {any[]} identities */
function mapContact(
  row,
  identities,
  details = /** @type {{email: string|null, phone: string|null}} */ ({
    email: null,
    phone: null,
  }),
  siteClaim = /** @type {{name: string, phone: string}|null} */ (null),
  matchedSitePhone = false,
  /** Only the detail passes it; `undefined` keeps it out of the list view. */
  registration = /** @type {Readonly<Record<string, string|null>>|null|undefined} */ (
    undefined
  ),
) {
  const primary =
    identities.find((identity) => identity.channel === 'whatsapp') ??
    identities[0] ??
    null;
  const confirmedPhone =
    primary?.kind === 'phone' && primary.phoneStatus === 'confirmed'
      ? normalizeContactPhone(primary.externalId)
      : null;
  const phone =
    matchedSitePhone && siteClaim
      ? siteClaim.phone
      : (row.phone ??
        details.phone ??
        confirmedPhone ??
        siteClaim?.phone ??
        null);
  const phoneSource =
    matchedSitePhone && siteClaim
      ? 'site_unverified'
      : row.phone || details.phone
        ? 'manual'
        : confirmedPhone
          ? 'whatsapp'
          : siteClaim
            ? 'site_unverified'
            : null;
  const email = details.email ?? null;
  // CP-26: registration fields plus the celular and e-mail already resolved.
  const registrationStatus =
    row.registration_fields_complete === true && phone && email
      ? 'complete'
      : 'incomplete';
  return Object.freeze({
    createdAt: row.createdAt ?? iso(row.created_at),
    displayName: row.displayName ?? row.display_name ?? null,
    id: row.id,
    identities: Object.freeze([...identities]),
    phone,
    phoneSource,
    email,
    // Operator-chosen name wins; the channel handle is only the fallback.
    label:
      row.displayName ??
      row.display_name ??
      siteClaim?.name ??
      primary?.displayHandle ??
      primary?.externalId ??
      `Contato ${row.id}`,
    latestActivityAt:
      row.latestActivityAt ?? row.updatedAt ?? iso(row.updated_at),
    shared: row.shared === true,
    ...(row.wallet_link ? { link: row.wallet_link } : {}),
    provisional: Boolean(row.provisional),
    ...(registration !== undefined ? { registration } : {}),
    registrationStatus,
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
