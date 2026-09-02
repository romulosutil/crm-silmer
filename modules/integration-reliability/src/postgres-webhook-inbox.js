import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const ENVELOPE_ALGORITHM = 'AES-256-GCM';
const ENVELOPE_VERSION = 1;
const KEY_VERSION = 1;
const MAX_BODY_BYTES = 1024 * 1024;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSED_PAYLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIA_TYPES = new Set(['audio', 'document', 'image', 'video']);
const MESSAGE_TYPES = new Set([
  'audio',
  'document',
  'image',
  'text',
  'unsupported',
  'video',
]);

/**
 * Raised when a provider-scoped event or media identifier is reused with
 * different canonical content. The original row remains authoritative.
 */
export class WebhookEventConflictError extends Error {
  constructor() {
    super('Webhook external identity was reused with different content');
    this.name = 'WebhookEventConflictError';
    this.code = 'WEBHOOK_EVENT_ID_REUSED';
    this.statusCode = 409;
  }
}

/**
 * @typedef {{
 *   externalMediaId: string,
 *   mediaType: 'audio'|'document'|'image'|'video',
 *   declaredMimeType?: string|null,
 *   providerSha256?: string|null,
 * }} MediaDescriptor
 * @typedef {{
 *   disposition: 'process'|'reconcile',
 *   event: Record<string, unknown>,
 *   media?: readonly MediaDescriptor[],
 * }} WebhookBatchItem
 * @typedef {{
 *   query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>
 * }} Queryable
 * @typedef {{
 *   query: Queryable['query'],
 *   transaction: <T>(work: (client: Queryable) => Promise<T>) => Promise<T>,
 * }} TransactionalDatabase
 * @typedef {{query: Function, transaction: Function}} DatabaseCandidate
 */

/**
 * Durable PostgreSQL inbox for already authenticated and normalized channel
 * events. The caller must verify the provider signature before invoking this
 * port. This class validates the complete batch, encrypts the exact raw body,
 * then persists receipt, events, media metadata, audit envelopes and minimal
 * processing jobs in one transaction. It never downloads media.
 */
export class PostgresWebhookInbox {
  /** @type {TransactionalDatabase} */
  #database;

  /** @type {Buffer} */
  #envelopeKey;

  /** @param {{database: DatabaseCandidate, envelopeKey: Buffer}} options */
  constructor({ database, envelopeKey }) {
    if (
      !database ||
      typeof database.query !== 'function' ||
      typeof database.transaction !== 'function'
    ) {
      throw new TypeError('A transactional PostgreSQL database is required');
    }
    if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
      throw new TypeError(
        'A dedicated 32-byte webhook payload envelope key is required',
      );
    }
    this.#database = /** @type {TransactionalDatabase} */ (database);
    this.#envelopeKey = Buffer.from(envelopeKey);
  }

  /**
   * @param {{
   *   events: readonly WebhookBatchItem[],
   *   rawBody: Buffer,
   *   receivedAt: string|Date,
   *   correlationId: string,
   * }} input
   * @returns {Promise<Readonly<{accepted: number, duplicates: number, reconciliation: number}>>}
   */
  async persistBatch(input) {
    const normalized = normalizeBatch(input);
    const provider = normalized.events[0].provider;
    const payloadSha256 = sha256(normalized.rawBody);
    const payloadEnvelope = encryptPayload(
      normalized.rawBody,
      provider,
      payloadSha256,
      this.#envelopeKey,
    );
    const payloadExpiresAt = new Date(
      normalized.receivedAt.getTime() + PROCESSED_PAYLOAD_TTL_MS,
    );

    return this.#database.transaction(async (client) => {
      requireQueryable(client);
      await client.query("SET LOCAL lock_timeout = '1500ms'");
      await client.query("SET LOCAL statement_timeout = '2s'");
      await client.query("SET LOCAL transaction_timeout = '5s'");
      const receiptId = randomUUID();
      const receiptInsert = await client.query(
        `INSERT INTO crm.webhook_receipts
           (id, provider, payload_sha256, payload_envelope, key_version,
            received_at, expires_at, correlation_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         ON CONFLICT ON CONSTRAINT webhook_receipts_external_payload_key
         DO NOTHING
         RETURNING id`,
        [
          receiptId,
          provider,
          payloadSha256,
          JSON.stringify(payloadEnvelope),
          KEY_VERSION,
          normalized.receivedAt,
          payloadExpiresAt,
          normalized.correlationId,
        ],
      );
      const receiptWasInserted = receiptInsert.rows.length === 1;
      const persistedReceiptId = receiptWasInserted
        ? storedString(receiptInsert.rows[0].id, 'webhook receipt id')
        : await selectReceiptId(client, provider, payloadSha256);

      let accepted = 0;
      let duplicates = 0;
      let reconciliation = 0;

      for (const item of normalized.events) {
        const eventId = randomUUID();
        const eventEnvelope = encryptCanonicalEvent(item, this.#envelopeKey);
        const inserted = await client.query(
          `INSERT INTO crm.channel_events
             (id, webhook_receipt_id, provider, channel, provider_account_id,
              external_event_id, external_message_id, message_type,
              occurred_at, fingerprint, event_envelope, event_key_version,
              received_at, disposition, processing_status, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16)
           ON CONFLICT ON CONSTRAINT channel_events_external_identity_key
           DO NOTHING
           RETURNING id`,
          [
            eventId,
            persistedReceiptId,
            item.provider,
            item.channel,
            item.providerAccountId,
            item.externalEventId,
            item.externalMessageId,
            item.messageType,
            item.occurredAt,
            item.fingerprint,
            JSON.stringify(eventEnvelope),
            KEY_VERSION,
            normalized.receivedAt,
            item.disposition,
            item.disposition === 'process' ? 'pending' : 'reconciliation',
            normalized.correlationId,
          ],
        );

        if (inserted.rows.length === 0) {
          const existing = await selectEvent(client, item);
          if (!existing) {
            throw new Error('Webhook event conflict disappeared before replay');
          }
          if (existing.fingerprint !== item.fingerprint) {
            throw new WebhookEventConflictError();
          }
          duplicates += 1;
          continue;
        }

        accepted += 1;
        if (item.disposition === 'reconciliation') reconciliation += 1;

        for (const media of item.media) {
          const mediaId = await persistMedia(
            client,
            item,
            media,
            normalized.receivedAt,
          );
          await client.query(
            `INSERT INTO crm.channel_event_media
               (channel_event_id, transient_media_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [eventId, mediaId],
          );
        }

        await client.query(
          `INSERT INTO crm.audit_events
             (id, actor_id, action, target_type, target_id, version, reason,
              correlation_id, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            'system:meta-webhook',
            'channel.webhook.accepted',
            'channel_event',
            item.eventKey,
            String(item.schemaVersion),
            item.disposition === 'process'
              ? 'valid-signed-inbound'
              : 'inbound-requires-reconciliation',
            normalized.correlationId,
            normalized.receivedAt,
          ],
        );

        if (item.disposition === 'process') {
          await client.query(
            `INSERT INTO crm.outbox_jobs
               (id, job_type, idempotency_key, channel_event_id, status,
                priority, available_at, created_at)
             VALUES ($1, 'channel_event.process', $2, $3, 'pending', 100,
               $4, $4)`,
            [randomUUID(), item.eventKey, eventId, normalized.receivedAt],
          );
        }
      }

      if (accepted === 0 && receiptWasInserted) {
        await client.query('DELETE FROM crm.webhook_receipts WHERE id = $1', [
          persistedReceiptId,
        ]);
      }

      return Object.freeze({ accepted, duplicates, reconciliation });
    });
  }

  /**
   * Worker-facing read port. The authenticated AAD binds the ciphertext to the
   * provider-scoped event identity and its canonical fingerprint.
   *
   * @param {string} channelEventId
   * @returns {Promise<Record<string, unknown>|null>}
   */
  async readCanonicalEvent(channelEventId) {
    const record = await this.readCanonicalEventRecord(channelEventId);
    return record?.event ?? null;
  }

  /**
   * Returns the decrypted event together with its content-free correlation
   * identifier so a worker can preserve traceability without reopening the
   * provider payload.
   *
   * @param {string} channelEventId
   * @returns {Promise<Readonly<{correlationId: string, event: Record<string, unknown>}>|null>}
   */
  async readCanonicalEventRecord(channelEventId) {
    const id = boundedString(channelEventId, 'channelEventId', 128);
    const selected = await this.#database.query(
      `SELECT provider, provider_account_id, external_event_id, fingerprint,
              event_envelope, event_key_version, correlation_id
       FROM crm.channel_events
       WHERE id = $1`,
      [id],
    );
    if (selected.rows.length === 0) return null;
    if (selected.rows.length !== 1) {
      throw new Error('Canonical webhook event identity is not unique');
    }
    return Object.freeze({
      correlationId: storedString(
        selected.rows[0].correlation_id,
        'channel event correlation id',
      ),
      event: decryptCanonicalEvent(selected.rows[0], this.#envelopeKey),
    });
  }
}

/** @param {Queryable} client @param {string} provider @param {string} digest */
async function selectReceiptId(client, provider, digest) {
  const selected = await client.query(
    `SELECT id FROM crm.webhook_receipts
     WHERE provider = $1 AND payload_sha256 = $2
     FOR UPDATE`,
    [provider, digest],
  );
  if (selected.rows.length !== 1) {
    throw new Error('Webhook receipt conflict disappeared before replay');
  }
  return storedString(selected.rows[0].id, 'webhook receipt id');
}

/** @param {Queryable} client @param {NormalizedItem} item */
async function selectEvent(client, item) {
  const selected = await client.query(
    `SELECT id, fingerprint FROM crm.channel_events
     WHERE provider = $1
       AND provider_account_id = $2
       AND external_event_id = $3
     FOR UPDATE`,
    [item.provider, item.providerAccountId, item.externalEventId],
  );
  if (selected.rows.length !== 1) return null;
  return {
    fingerprint: storedString(
      selected.rows[0].fingerprint,
      'channel event fingerprint',
    ),
    id: storedString(selected.rows[0].id, 'channel event id'),
  };
}

/**
 * @param {Queryable} client
 * @param {NormalizedItem} item
 * @param {NormalizedMedia} media
 * @param {Date} receivedAt
 */
async function persistMedia(client, item, media, receivedAt) {
  const mediaId = randomUUID();
  const expiresAt = new Date(receivedAt.getTime() + MEDIA_TTL_MS);
  const inserted = await client.query(
    `INSERT INTO crm.transient_media
       (id, provider, provider_account_id, external_media_id, media_type,
        declared_mime_type, provider_sha256, metadata_fingerprint,
        first_received_at, expires_at, availability_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       'metadata_only')
     ON CONFLICT ON CONSTRAINT transient_media_external_identity_key
     DO NOTHING
     RETURNING id`,
    [
      mediaId,
      item.provider,
      item.providerAccountId,
      media.externalMediaId,
      media.mediaType,
      media.declaredMimeType,
      media.providerSha256,
      media.fingerprint,
      receivedAt,
      expiresAt,
    ],
  );
  if (inserted.rows.length === 1) {
    return storedString(inserted.rows[0].id, 'transient media id');
  }

  const selected = await client.query(
    `SELECT id, metadata_fingerprint FROM crm.transient_media
     WHERE provider = $1
       AND provider_account_id = $2
       AND external_media_id = $3
     FOR UPDATE`,
    [item.provider, item.providerAccountId, media.externalMediaId],
  );
  if (selected.rows.length !== 1) {
    throw new Error('Transient media conflict disappeared before replay');
  }
  const fingerprint = storedString(
    selected.rows[0].metadata_fingerprint,
    'transient media fingerprint',
  );
  if (fingerprint !== media.fingerprint) {
    throw new WebhookEventConflictError();
  }
  return storedString(selected.rows[0].id, 'transient media id');
}

/**
 * @typedef {{
 *   declaredMimeType: string|null,
 *   externalMediaId: string,
 *   fingerprint: string,
 *   mediaType: 'audio'|'document'|'image'|'video',
 *   providerSha256: string|null,
 * }} NormalizedMedia
 * @typedef {{
 *   channel: string,
 *   disposition: 'process'|'reconciliation',
 *   event: Record<string, unknown>,
 *   eventKey: string,
 *   externalEventId: string,
 *   externalMessageId: string,
 *   fingerprint: string,
 *   media: NormalizedMedia[],
 *   messageType: string,
 *   occurredAt: Date,
 *   provider: string,
 *   providerAccountId: string,
 *   schemaVersion: number,
 * }} NormalizedItem
 */

/** @param {Parameters<PostgresWebhookInbox['persistBatch']>[0]} input */
function normalizeBatch(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Webhook batch input must be an object');
  }
  if (
    !Buffer.isBuffer(input.rawBody) ||
    input.rawBody.length === 0 ||
    input.rawBody.length > MAX_BODY_BYTES
  ) {
    throw new TypeError('rawBody must be a non-empty Buffer of at most 1 MiB');
  }
  const correlationId = boundedString(
    input.correlationId,
    'correlationId',
    128,
  );
  const receivedAt = canonicalInstant(input.receivedAt, 'receivedAt');
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new TypeError('events must be a non-empty array');
  }

  const events = input.events.map((item, index) =>
    normalizeItem(item, index, receivedAt),
  );
  const provider = events[0].provider;
  if (events.some((event) => event.provider !== provider)) {
    throw new TypeError('A webhook batch must contain exactly one provider');
  }
  events.sort((left, right) => left.eventKey.localeCompare(right.eventKey));
  return {
    correlationId,
    events,
    rawBody: Buffer.from(input.rawBody),
    receivedAt,
  };
}

/**
 * @param {WebhookBatchItem} item
 * @param {number} index
 * @param {Date} receivedAt
 * @returns {NormalizedItem}
 */
function normalizeItem(item, index, receivedAt) {
  if (!item || typeof item !== 'object') {
    throw new TypeError(`events[${index}] must be an object`);
  }
  if (!['process', 'reconcile'].includes(item.disposition)) {
    throw new TypeError(`events[${index}].disposition is invalid`);
  }
  const event = requirePlainObject(item.event, `events[${index}].event`);
  if (event.schemaVersion !== 1 || event.direction !== 'inbound') {
    throw new TypeError(
      `events[${index}].event is not a canonical inbound event`,
    );
  }
  const provider = boundedString(event.provider, 'event.provider', 64);
  if (provider !== provider.toLowerCase()) {
    throw new TypeError('event.provider must be lowercase');
  }
  const providerAccountId = boundedString(
    event.providerAccountId,
    'event.providerAccountId',
    512,
  );
  const channel = boundedString(event.channel, 'event.channel', 32);
  if (!['instagram', 'whatsapp'].includes(channel)) {
    throw new TypeError('event.channel is invalid');
  }
  const externalEventId = scopedExternalId(
    event.externalEventId,
    provider,
    providerAccountId,
    'event.externalEventId',
  );
  const externalMessageId = scopedExternalId(
    event.externalMessageId,
    provider,
    providerAccountId,
    'event.externalMessageId',
  );
  const message = requirePlainObject(event.message, 'event.message');
  const messageType = boundedString(message.type, 'event.message.type', 32);
  if (!MESSAGE_TYPES.has(messageType)) {
    throw new TypeError('event.message.type is invalid');
  }
  const occurredAt = canonicalInstant(event.occurredAt, 'event.occurredAt');
  const media = normalizeMedia(item.media ?? [], index);
  validateMediaBinding(message, messageType, media, index);
  const eventKey = JSON.stringify([
    provider,
    providerAccountId,
    externalEventId,
  ]);
  const stale = receivedAt.getTime() - occurredAt.getTime() > STALE_AFTER_MS;
  /** @type {'process'|'reconciliation'} */
  const disposition =
    item.disposition === 'reconcile' || stale ? 'reconciliation' : 'process';
  const fingerprint = sha256(
    Buffer.from(canonicalJson({ event, media: media.map(stripFingerprint) })),
  );
  return {
    channel,
    disposition,
    event,
    eventKey,
    externalEventId,
    externalMessageId,
    fingerprint,
    media,
    messageType,
    occurredAt,
    provider,
    providerAccountId,
    schemaVersion: 1,
  };
}

/**
 * The canonical inbound contract exposes one attachment id for a media message.
 * Keeping that relationship explicit prevents an otherwise valid descriptor
 * from being attached to a different provider event.
 *
 * @param {Record<string, unknown>} message
 * @param {string} messageType
 * @param {readonly NormalizedMedia[]} media
 * @param {number} eventIndex
 */
function validateMediaBinding(message, messageType, media, eventIndex) {
  if (!MEDIA_TYPES.has(messageType)) {
    if (media.length !== 0) {
      throw new TypeError(
        `events[${eventIndex}].media does not belong to the canonical event`,
      );
    }
    return;
  }

  const content = requirePlainObject(message.content, 'event.message.content');
  const attachmentId = boundedString(
    content.attachmentId,
    'event.message.content.attachmentId',
    512,
  );
  if (
    media.length !== 1 ||
    media[0].externalMediaId !== attachmentId ||
    media[0].mediaType !== messageType
  ) {
    throw new TypeError(
      `events[${eventIndex}].media does not match the canonical event`,
    );
  }
}

/**
 * @param {readonly MediaDescriptor[]} media
 * @param {number} eventIndex
 * @returns {NormalizedMedia[]}
 */
function normalizeMedia(media, eventIndex) {
  if (!Array.isArray(media)) {
    throw new TypeError(`events[${eventIndex}].media must be an array`);
  }
  const normalized = media.map((descriptor, mediaIndex) => {
    const field = `events[${eventIndex}].media[${mediaIndex}]`;
    const value = requirePlainObject(descriptor, field);
    const externalMediaId = boundedString(
      value.externalMediaId,
      `${field}.externalMediaId`,
      512,
    );
    const mediaTypeValue = boundedString(
      value.mediaType,
      `${field}.mediaType`,
      32,
    );
    if (!MEDIA_TYPES.has(mediaTypeValue)) {
      throw new TypeError(`${field}.mediaType is invalid`);
    }
    const mediaType = /** @type {'audio'|'document'|'image'|'video'} */ (
      mediaTypeValue
    );
    const declaredMimeType = optionalBoundedString(
      value.declaredMimeType,
      `${field}.declaredMimeType`,
      255,
    );
    const providerSha256 = optionalBoundedString(
      value.providerSha256,
      `${field}.providerSha256`,
      128,
    );
    const stable = {
      declaredMimeType,
      externalMediaId,
      mediaType,
      providerSha256,
    };
    return {
      ...stable,
      fingerprint: sha256(Buffer.from(canonicalJson(stable))),
    };
  });
  normalized.sort((left, right) =>
    left.externalMediaId.localeCompare(right.externalMediaId),
  );
  return normalized;
}

/** @param {NormalizedMedia} media */
function stripFingerprint(media) {
  return {
    declaredMimeType: media.declaredMimeType,
    externalMediaId: media.externalMediaId,
    mediaType: media.mediaType,
    providerSha256: media.providerSha256,
  };
}

/** @param {unknown} value @param {string} provider @param {string} account @param {string} field */
function scopedExternalId(value, provider, account, field) {
  const scoped = requirePlainObject(value, field);
  const externalId = boundedString(
    scoped.externalId,
    `${field}.externalId`,
    512,
  );
  if (
    scoped.provider !== provider ||
    scoped.providerAccountId !== account ||
    scoped.key !== JSON.stringify([provider, account, externalId])
  ) {
    throw new TypeError(`${field} scope is inconsistent`);
  }
  return externalId;
}

/** @param {Buffer} rawBody @param {string} provider @param {string} digest @param {Buffer} key */
function encryptPayload(rawBody, provider, digest, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(payloadAad(provider, digest));
  const ciphertext = Buffer.concat([cipher.update(rawBody), cipher.final()]);
  return Object.freeze({
    algorithm: ENVELOPE_ALGORITHM,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: KEY_VERSION,
    tag: cipher.getAuthTag().toString('base64url'),
    version: ENVELOPE_VERSION,
  });
}

/** @param {NormalizedItem} item @param {Buffer} key */
function encryptCanonicalEvent(item, key) {
  const plaintext = Buffer.from(canonicalJson(item.event));
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(canonicalEventAad(item));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Object.freeze({
    algorithm: ENVELOPE_ALGORITHM,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: KEY_VERSION,
    tag: cipher.getAuthTag().toString('base64url'),
    version: ENVELOPE_VERSION,
  });
}

/** @param {Record<string, unknown>} row @param {Buffer} key */
function decryptCanonicalEvent(row, key) {
  const provider = storedString(row.provider, 'channel event provider');
  const providerAccountId = storedString(
    row.provider_account_id,
    'channel event provider account id',
  );
  const externalEventId = storedString(
    row.external_event_id,
    'channel event external id',
  );
  const fingerprint = storedString(
    row.fingerprint,
    'channel event fingerprint',
  );
  if (row.event_key_version !== KEY_VERSION) {
    throw new Error('Unsupported canonical webhook event key version');
  }
  const envelope = requirePlainObject(
    row.event_envelope,
    'channel event envelope',
  );
  if (
    envelope.algorithm !== ENVELOPE_ALGORITHM ||
    envelope.version !== ENVELOPE_VERSION ||
    envelope.keyVersion !== KEY_VERSION
  ) {
    throw new Error('Unsupported canonical webhook event envelope');
  }
  const decipher = createDecipheriv(
    CIPHER,
    key,
    Buffer.from(storedString(envelope.iv, 'event envelope iv'), 'base64url'),
  );
  decipher.setAAD(
    canonicalEventAad({
      eventKey: JSON.stringify([provider, providerAccountId, externalEventId]),
      fingerprint,
    }),
  );
  decipher.setAuthTag(
    Buffer.from(storedString(envelope.tag, 'event envelope tag'), 'base64url'),
  );
  const plaintext = Buffer.concat([
    decipher.update(
      Buffer.from(
        storedString(envelope.ciphertext, 'event envelope ciphertext'),
        'base64url',
      ),
    ),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString('utf8'));
  return requirePlainObject(parsed, 'decrypted canonical event');
}

/** @param {{eventKey: string, fingerprint: string}} item */
function canonicalEventAad(item) {
  return Buffer.from(
    JSON.stringify([
      'crm.channel_events',
      KEY_VERSION,
      item.eventKey,
      item.fingerprint,
    ]),
  );
}

/** @param {string} provider @param {string} digest */
function payloadAad(provider, digest) {
  return Buffer.from(
    JSON.stringify(['crm.webhook_receipts', KEY_VERSION, provider, digest]),
  );
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value @param {string} field */
function requirePlainObject(value, field) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${field} must be a plain object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} field @param {number} maximum */
function boundedString(value, field, maximum) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximum
  ) {
    throw new TypeError(`${field} must be a bounded non-empty string`);
  }
  return value;
}

/** @param {unknown} value @param {string} field @param {number} maximum */
function optionalBoundedString(value, field, maximum) {
  if (value === undefined || value === null) return null;
  return boundedString(value, field, maximum);
}

/** @param {unknown} value @param {string} field */
function canonicalInstant(value, field) {
  const date =
    value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid instant`);
  }
  if (
    typeof value === 'string' &&
    (date.toISOString() !== value || !value.endsWith('Z'))
  ) {
    throw new TypeError(`${field} must be a canonical ISO instant`);
  }
  return date;
}

/**
 * @param {unknown} value
 * @param {Set<object>} [ancestors]
 * @returns {string}
 */
function canonicalJson(value, ancestors = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError('Canonical event must contain only JSON values');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical event must not contain cycles');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Canonical event objects must be plain objects');
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** @param {unknown} client */
function requireQueryable(client) {
  if (
    !client ||
    typeof client !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (client).query) !==
      'function'
  ) {
    throw new TypeError('transaction must provide a queryable client');
  }
}

/** @param {unknown} value @param {string} field */
function storedString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid persisted ${field}`);
  }
  return value;
}
