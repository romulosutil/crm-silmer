import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

import {
  ContactIdentityConflictError,
  ContactIdentityNotFoundError,
} from '../domain/errors.js';

const CIPHER = 'aes-256-gcm';
const KEY_VERSION = 1;

export class PostgresContactIdentityRepository {
  #database;
  #envelopeKey;
  #lookupKey;

  /** @param {{database: {query: Function, transaction: Function}, envelopeKey: Buffer, lookupKey: Buffer}} options */
  constructor(options) {
    if (
      !options?.database ||
      typeof options.database.query !== 'function' ||
      typeof options.database.transaction !== 'function'
    ) {
      throw new TypeError('A transactional PostgreSQL database is required');
    }
    if (
      !Buffer.isBuffer(options.envelopeKey) ||
      options.envelopeKey.length !== 32
    ) {
      throw new TypeError(
        'A dedicated 32-byte contact envelope key is required',
      );
    }
    if (
      !Buffer.isBuffer(options.lookupKey) ||
      options.lookupKey.length !== 32
    ) {
      throw new TypeError('A dedicated 32-byte contact lookup key is required');
    }
    this.#database = options.database;
    this.#envelopeKey = Buffer.from(options.envelopeKey);
    this.#lookupKey = Buffer.from(options.lookupKey);
  }

  /** @param {{contactId: string, identity: Record<string, any>, identityId: string, now: string}} input */
  async resolveInboundIdentity(input) {
    const lookupHash = this.#lookupHash(input.identity);
    return this.#database.transaction(async (/** @type {any} */ client) => {
      await transactionBounds(client);
      await advisoryLock(client, `identity:${lookupHash}`);
      const existing = await selectIdentityByScope(
        client,
        input.identity,
        lookupHash,
        true,
      );
      if (existing) return this.#mapResolved(existing);

      await client.query(
        `INSERT INTO crm.contacts
           (id, provisional, version, created_at, updated_at)
         VALUES ($1, true, 1, $2, $2)`,
        [input.contactId, input.now],
      );
      const envelope = encryptIdentity(
        {
          displayHandle: input.identity.displayHandle,
          externalIdentityId: input.identity.externalIdentityId,
        },
        lookupHash,
        this.#envelopeKey,
      );
      await client.query(
        `INSERT INTO crm.contact_identities
           (id, current_contact_id, provider, provider_account_id, channel,
            external_identity_lookup_hash, identity_kind, phone_status,
            identity_envelope, key_version, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 1, $11, $11)`,
        [
          input.identityId,
          input.contactId,
          input.identity.provider,
          input.identity.providerAccountId,
          input.identity.channel,
          lookupHash,
          input.identity.identityKind,
          input.identity.phoneStatus,
          JSON.stringify(envelope),
          KEY_VERSION,
          input.now,
        ],
      );
      const inserted = await selectIdentityById(
        client,
        input.identityId,
        false,
      );
      if (!inserted) throw new Error('Inserted contact identity disappeared');
      return this.#mapResolved(inserted);
    });
  }

  /** @param {Record<string, any>} command @param {{append: Function}} auditPort */
  async mergeIdentity(command, auditPort) {
    try {
      return await this.#database.transaction(
        async (/** @type {any} */ client) => {
          await transactionBounds(client);
          await advisoryLock(
            client,
            `identity-merge:${command.idempotencyKey}`,
          );
          const replay = await selectLinkByMergeKey(
            client,
            command.idempotencyKey,
          );
          if (replay) {
            if (replay.merge_fingerprint !== command.fingerprint) {
              throw new ContactIdentityConflictError();
            }
            return this.#mapLinked(replay);
          }

          const identity = await selectIdentityById(
            client,
            command.identityId,
            true,
          );
          if (!identity) throw new ContactIdentityNotFoundError();
          if (
            Number(identity.identity_version) !== command.expectedVersion ||
            identity.current_contact_id === command.targetContactId
          ) {
            throw new ContactIdentityConflictError();
          }
          const active = await client.query(
            `SELECT id FROM crm.identity_links
           WHERE contact_identity_id = $1 AND status = 'active'
           FOR UPDATE`,
            [command.identityId],
          );
          if (active.rows.length !== 0)
            throw new ContactIdentityConflictError();
          const contacts = await lockContacts(client, [
            identity.current_contact_id,
            command.targetContactId,
          ]);
          if (contacts.length !== 2) throw new ContactIdentityNotFoundError();

          await client.query(
            `UPDATE crm.contacts
           SET version = version + 1, updated_at = $2
           WHERE id = ANY($1::text[])`,
            [
              [identity.current_contact_id, command.targetContactId],
              command.now,
            ],
          );
          const updatedIdentity = await client.query(
            `UPDATE crm.contact_identities
           SET current_contact_id = $2, version = version + 1, updated_at = $3
           WHERE id = $1
           RETURNING version`,
            [command.identityId, command.targetContactId, command.now],
          );
          const nextVersion = Number(updatedIdentity.rows[0].version);
          await client.query(
            `INSERT INTO crm.identity_links
             (id, contact_identity_id, source_contact_id, target_contact_id,
              status, merged_by, merge_reason, merge_correlation_id,
              merge_idempotency_key, merge_fingerprint, merged_at)
           VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10)`,
            [
              command.linkId,
              command.identityId,
              identity.current_contact_id,
              command.targetContactId,
              command.actor.id,
              command.reason,
              command.correlationId,
              command.idempotencyKey,
              command.fingerprint,
              command.now,
            ],
          );
          await auditPort.append(
            auditEvent('merged', command, command.identityId, nextVersion),
            { transaction: client },
          );
          const stored = await selectLinkById(client, command.linkId);
          if (!stored) throw new Error('Inserted identity link disappeared');
          return this.#mapLinked(stored);
        },
      );
    } catch (error) {
      throw translateConflict(error);
    }
  }

  /** @param {Record<string, any>} command @param {{append: Function}} auditPort */
  async unmergeIdentity(command, auditPort) {
    try {
      return await this.#database.transaction(
        async (/** @type {any} */ client) => {
          await transactionBounds(client);
          await advisoryLock(
            client,
            `identity-unmerge:${command.idempotencyKey}`,
          );
          const replay = await selectLinkByRevertKey(
            client,
            command.idempotencyKey,
          );
          if (replay) {
            if (replay.revert_fingerprint !== command.fingerprint) {
              throw new ContactIdentityConflictError();
            }
            return this.#mapLinked(replay);
          }

          const link = await selectLinkById(client, command.linkId, true);
          if (!link) throw new ContactIdentityNotFoundError();
          const identity = await selectIdentityById(
            client,
            link.contact_identity_id,
            true,
          );
          if (!identity) throw new ContactIdentityNotFoundError();
          if (
            link.status !== 'active' ||
            identity.current_contact_id !== link.target_contact_id ||
            Number(identity.identity_version) !== command.expectedVersion
          ) {
            throw new ContactIdentityConflictError();
          }
          const contacts = await lockContacts(client, [
            link.source_contact_id,
            link.target_contact_id,
          ]);
          if (contacts.length !== 2) throw new ContactIdentityNotFoundError();

          await client.query(
            `UPDATE crm.contacts
           SET version = version + 1, updated_at = $2
           WHERE id = ANY($1::text[])`,
            [[link.source_contact_id, link.target_contact_id], command.now],
          );
          const updatedIdentity = await client.query(
            `UPDATE crm.contact_identities
           SET current_contact_id = $2, version = version + 1, updated_at = $3
           WHERE id = $1
           RETURNING version`,
            [identity.identity_id, link.source_contact_id, command.now],
          );
          const nextVersion = Number(updatedIdentity.rows[0].version);
          await client.query(
            `UPDATE crm.identity_links
           SET status = 'reverted', reverted_by = $2, revert_reason = $3,
               revert_correlation_id = $4, revert_idempotency_key = $5,
               revert_fingerprint = $6, reverted_at = $7
           WHERE id = $1 AND status = 'active'`,
            [
              command.linkId,
              command.actor.id,
              command.reason,
              command.correlationId,
              command.idempotencyKey,
              command.fingerprint,
              command.now,
            ],
          );
          await auditPort.append(
            auditEvent('unmerged', command, identity.identity_id, nextVersion),
            { transaction: client },
          );
          const stored = await selectLinkById(client, command.linkId);
          if (!stored) throw new Error('Reverted identity link disappeared');
          return this.#mapLinked(stored);
        },
      );
    } catch (error) {
      throw translateConflict(error);
    }
  }

  /** @param {Record<string, any>} row */
  #mapResolved(row) {
    const secret = decryptIdentity(
      row.identity_envelope,
      row.external_identity_lookup_hash,
      this.#envelopeKey,
    );
    return {
      contact: mapContact(row),
      identity: mapIdentity(row, secret),
    };
  }

  /** @param {Record<string, any>} row */
  #mapLinked(row) {
    const resolved = this.#mapResolved(row);
    return {
      ...resolved,
      link: {
        id: row.link_id,
        identityId: row.contact_identity_id,
        mergedAt: instant(row.merged_at),
        mergedBy: row.merged_by,
        ...(row.reverted_at
          ? {
              revertedAt: instant(row.reverted_at),
              revertedBy: row.reverted_by,
            }
          : {}),
        sourceContactId: row.source_contact_id,
        status: row.status,
        targetContactId: row.target_contact_id,
      },
    };
  }

  /** @param {Record<string, any>} identity */
  #lookupHash(identity) {
    return createHmac('sha256', this.#lookupKey)
      .update(
        JSON.stringify([
          identity.provider,
          identity.providerAccountId,
          identity.channel,
          identity.externalIdentityId,
        ]),
      )
      .digest('hex');
  }
}

/** @param {Record<string, any>} row */
function mapContact(row) {
  return {
    createdAt: instant(row.contact_created_at),
    id: row.contact_id,
    provisional: row.contact_provisional,
    updatedAt: instant(row.contact_updated_at),
    version: Number(row.contact_version),
  };
}

/** @param {Record<string, any>} row @param {Record<string, any>} secret */
function mapIdentity(row, secret) {
  return {
    automaticMergeAllowed: false,
    channel: row.channel,
    contactId: row.current_contact_id,
    createdAt: instant(row.identity_created_at),
    displayHandle: secret.displayHandle,
    externalIdentityId: secret.externalIdentityId,
    id: row.identity_id,
    identityKind: row.identity_kind,
    phoneStatus: row.phone_status,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    updatedAt: instant(row.identity_updated_at),
    version: Number(row.identity_version),
  };
}

/** @param {any} client @param {Record<string, any>} identity @param {string} lookupHash @param {boolean} lock */
async function selectIdentityByScope(client, identity, lookupHash, lock) {
  const result = await client.query(
    `${identitySelect()}
     WHERE ci.provider = $1 AND ci.provider_account_id = $2
       AND ci.channel = $3 AND ci.external_identity_lookup_hash = $4
     ${lock ? 'FOR UPDATE OF ci' : ''}`,
    [
      identity.provider,
      identity.providerAccountId,
      identity.channel,
      lookupHash,
    ],
  );
  return result.rows[0] ?? null;
}

/** @param {any} client @param {string} id @param {boolean} lock */
async function selectIdentityById(client, id, lock) {
  const result = await client.query(
    `${identitySelect()} WHERE ci.id = $1 ${lock ? 'FOR UPDATE OF ci' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

function identitySelect() {
  return `SELECT
    ci.id AS identity_id, ci.current_contact_id, ci.provider,
    ci.provider_account_id, ci.channel, ci.external_identity_lookup_hash,
    ci.identity_kind, ci.phone_status, ci.identity_envelope,
    ci.version AS identity_version, ci.created_at AS identity_created_at,
    ci.updated_at AS identity_updated_at,
    c.id AS contact_id, c.provisional AS contact_provisional,
    c.version AS contact_version, c.created_at AS contact_created_at,
    c.updated_at AS contact_updated_at
   FROM crm.contact_identities ci
   JOIN crm.contacts c ON c.id = ci.current_contact_id`;
}

/** @param {any} client @param {string[]} ids */
async function lockContacts(client, ids) {
  const result = await client.query(
    `SELECT id FROM crm.contacts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return result.rows;
}

/** @param {any} client @param {string} key */
async function selectLinkByMergeKey(client, key) {
  return selectLink(client, 'l.merge_idempotency_key = $1', key, false);
}

/** @param {any} client @param {string} key */
async function selectLinkByRevertKey(client, key) {
  return selectLink(client, 'l.revert_idempotency_key = $1', key, false);
}

/** @param {any} client @param {string} id @param {boolean} [lock] */
async function selectLinkById(client, id, lock = false) {
  return selectLink(client, 'l.id = $1', id, lock);
}

/** @param {any} client @param {string} where @param {string} value @param {boolean} lock */
async function selectLink(client, where, value, lock) {
  const result = await client.query(
    `SELECT l.id AS link_id, l.contact_identity_id, l.source_contact_id,
            l.target_contact_id, l.status, l.merged_by, l.merge_fingerprint,
            l.merged_at, l.reverted_by, l.revert_fingerprint, l.reverted_at,
            ci.id AS identity_id, ci.current_contact_id, ci.provider,
            ci.provider_account_id, ci.channel,
            ci.external_identity_lookup_hash, ci.identity_kind,
            ci.phone_status, ci.identity_envelope,
            ci.version AS identity_version,
            ci.created_at AS identity_created_at,
            ci.updated_at AS identity_updated_at,
            c.id AS contact_id, c.provisional AS contact_provisional,
            c.version AS contact_version, c.created_at AS contact_created_at,
            c.updated_at AS contact_updated_at
     FROM crm.identity_links l
     JOIN crm.contact_identities ci ON ci.id = l.contact_identity_id
     JOIN crm.contacts c ON c.id = ci.current_contact_id
     WHERE ${where} ${lock ? 'FOR UPDATE OF l' : ''}`,
    [value],
  );
  return result.rows[0] ?? null;
}

/** @param {Record<string, any>} value @param {string} lookupHash @param {Buffer} key */
function encryptIdentity(value, lookupHash, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(identityAad(lookupHash));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: KEY_VERSION,
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  };
}

/** @param {unknown} value @param {string} lookupHash @param {Buffer} key */
function decryptIdentity(value, lookupHash, key) {
  if (!value || typeof value !== 'object')
    throw new Error('Stored identity envelope is invalid');
  const envelope = /** @type {Record<string, any>} */ (value);
  if (
    envelope.algorithm !== 'AES-256-GCM' ||
    Number(envelope.keyVersion) !== 1 ||
    Number(envelope.version) !== 1
  ) {
    throw new Error('Stored identity envelope is invalid');
  }
  const decipher = createDecipheriv(
    CIPHER,
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(identityAad(lookupHash));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new Error('Stored identity payload is invalid');
  return parsed;
}

/** @param {string} lookupHash */
function identityAad(lookupHash) {
  return Buffer.from(
    JSON.stringify(['crm.contact_identities', KEY_VERSION, lookupHash]),
  );
}

/** @param {any} client */
async function transactionBounds(client) {
  await client.query("SET LOCAL lock_timeout = '1500ms'");
  await client.query("SET LOCAL statement_timeout = '3s'");
  await client.query("SET LOCAL transaction_timeout = '8s'");
}

/** @param {any} client @param {string} key */
async function advisoryLock(client, key) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    key,
  ]);
}

/** @param {'merged'|'unmerged'} change @param {Record<string, any>} command @param {string} identityId @param {number} version */
function auditEvent(change, command, identityId, version) {
  return {
    action: `contact.identity.${change}`,
    actor: command.actor.id,
    correlationId: command.correlationId,
    reason: command.reason,
    target: { id: identityId, type: 'contact_identity' },
    version,
  };
}

/** @param {unknown} value */
function instant(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new Error('Stored timestamp is invalid');
}

/** @param {unknown} error */
function translateConflict(error) {
  if (
    error instanceof ContactIdentityConflictError ||
    error instanceof ContactIdentityNotFoundError
  )
    return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  ) {
    return new ContactIdentityConflictError();
  }
  return error;
}
