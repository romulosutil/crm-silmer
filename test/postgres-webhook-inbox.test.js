import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import test from 'node:test';

import {
  PostgresWebhookInbox,
  WebhookEventConflictError,
} from '../modules/integration-reliability/src/postgres-webhook-inbox.js';

const ENVELOPE_KEY = Buffer.alloc(32, 29);
const RECEIVED_AT = '2026-09-02T12:00:00.000Z';

/**
 * @param {string} externalId
 * @param {{occurredAt?: string, messageType?: string}} [options]
 * @returns {Record<string, any>}
 */
function canonicalEvent(externalId, options = {}) {
  const occurredAt = options.occurredAt ?? RECEIVED_AT;
  const messageType = options.messageType ?? 'image';
  return {
    schemaVersion: 1,
    direction: 'inbound',
    provider: 'meta',
    providerAccountId: 'synthetic-account',
    channel: 'whatsapp',
    externalEventId: {
      externalId,
      key: JSON.stringify(['meta', 'synthetic-account', externalId]),
      provider: 'meta',
      providerAccountId: 'synthetic-account',
    },
    externalMessageId: {
      externalId,
      key: JSON.stringify(['meta', 'synthetic-account', externalId]),
      provider: 'meta',
      providerAccountId: 'synthetic-account',
    },
    externalConversationId: {
      externalId: 'synthetic-conversation',
      key: JSON.stringify([
        'meta',
        'synthetic-account',
        'synthetic-conversation',
      ]),
      provider: 'meta',
      providerAccountId: 'synthetic-account',
    },
    occurredAt,
    origin: 'channel',
    visibility: 'inbox',
    identity: {
      automaticMergeAllowed: false,
      displayHandle: null,
      externalId: {
        externalId: 'synthetic-identity',
        key: JSON.stringify([
          'meta',
          'synthetic-account',
          'synthetic-identity',
        ]),
        provider: 'meta',
        providerAccountId: 'synthetic-account',
      },
      kind: 'phone',
      mergePolicy: 'verified-evidence-only',
      phoneStatus: 'confirmed',
    },
    message:
      messageType === 'text'
        ? { content: { text: 'synthetic message' }, type: 'text' }
        : {
            content: { attachmentId: `media-${externalId}`, caption: null },
            type: messageType,
          },
  };
}

/**
 * @param {string} externalId
 * @param {{occurredAt?: string, messageType?: string, disposition?: 'process'|'reconcile'}} [options]
 * @returns {any}
 */
function batchItem(externalId, options = {}) {
  const event = canonicalEvent(externalId, options);
  return {
    disposition: options.disposition ?? 'process',
    event,
    media:
      event.message.type === 'text'
        ? []
        : [
            {
              declaredMimeType: 'image/png',
              externalMediaId: `media-${externalId}`,
              mediaType: event.message.type,
              providerSha256: 'synthetic-provider-sha256',
            },
          ],
  };
}

/**
 * @param {(sql: string, values: unknown[], calls: Array<{sql: string, values: unknown[]}>) => Promise<{rows: Array<Record<string, unknown>>}>} [onQuery]
 * @returns {any}
 */
function fakeDatabase(onQuery = async () => ({ rows: [] })) {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const calls = [];
  return {
    calls,
    /** @param {string} sql @param {unknown[]} [values] */
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      return onQuery(sql, values, calls);
    },
    /** @param {(client: {query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>}) => Promise<unknown>} work */
    transaction: async (work) =>
      work({
        /** @param {string} sql @param {unknown[]} [values] */
        query: async (sql, values = []) => {
          calls.push({ sql, values });
          return onQuery(sql, values, calls);
        },
      }),
  };
}

function insertedDatabase() {
  return fakeDatabase(async (sql) => {
    if (sql.includes('INSERT INTO crm.webhook_receipts')) {
      return { rows: [{ id: 'receipt-1' }] };
    }
    if (sql.includes('INSERT INTO crm.channel_events')) {
      return { rows: [{ id: 'event-1' }] };
    }
    if (sql.includes('INSERT INTO crm.transient_media')) {
      return { rows: [{ id: 'media-1' }] };
    }
    return { rows: [] };
  });
}

/** @param {any[]} events @param {Record<string, unknown>} [overrides] @returns {any} */
function input(events, overrides = {}) {
  return {
    correlationId: '018fc0d5-8a52-7c42-9fb3-2f9fb8dc1a11',
    events,
    rawBody: Buffer.from('{"canary":"private webhook payload"}'),
    receivedAt: RECEIVED_AT,
    ...overrides,
  };
}

test('requires a transactional database and a dedicated 32-byte key', () => {
  assert.throws(
    () =>
      new PostgresWebhookInbox({
        database: /** @type {any} */ ({}),
        envelopeKey: ENVELOPE_KEY,
      }),
    /transactional PostgreSQL database/u,
  );
  assert.throws(
    () =>
      new PostgresWebhookInbox({
        database: fakeDatabase(),
        envelopeKey: Buffer.alloc(16),
      }),
    /32-byte.*webhook payload/u,
  );
});

test('persists event, media metadata, audit and one minimal job atomically', async () => {
  const database = insertedDatabase();
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });

  assert.deepEqual(await inbox.persistBatch(input([batchItem('event-1')])), {
    accepted: 1,
    duplicates: 0,
    reconciliation: 0,
  });

  const sql = database.calls
    .map(
      /** @param {{sql: string}} call */
      (call) => call.sql,
    )
    .join('\n');
  assert.match(sql, /INSERT INTO crm\.webhook_receipts/u);
  assert.match(sql, /SET LOCAL transaction_timeout = '5s'/u);
  assert.match(sql, /INSERT INTO crm\.channel_events/u);
  assert.match(sql, /INSERT INTO crm\.transient_media/u);
  assert.match(sql, /INSERT INTO crm\.channel_event_media/u);
  assert.match(sql, /INSERT INTO crm\.audit_events/u);
  assert.match(sql, /INSERT INTO crm\.outbox_jobs/u);
  assert.equal(sql.includes('UPDATE crm.transient_media'), false);

  const receiptCall = database.calls.find(
    /** @param {{sql: string}} call */
    (call) => call.sql.includes('INSERT INTO crm.webhook_receipts'),
  );
  assert.ok(receiptCall);
  const envelope = JSON.parse(String(receiptCall.values[3]));
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.equal(envelope.keyVersion, 1);
  assert.doesNotMatch(JSON.stringify(envelope), /private webhook payload/u);
  assert.equal(
    new Date(String(receiptCall.values[6])).getTime() -
      new Date(String(receiptCall.values[5])).getTime(),
    30 * 24 * 60 * 60 * 1000,
  );

  const decipher = createDecipheriv(
    'aes-256-gcm',
    ENVELOPE_KEY,
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(
    Buffer.from(
      JSON.stringify([
        'crm.webhook_receipts',
        1,
        'meta',
        receiptCall.values[2],
      ]),
    ),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  assert.equal(plaintext.toString('utf8'), input([]).rawBody.toString('utf8'));

  const mediaCall = database.calls.find(
    /** @param {{sql: string}} call */
    (call) => call.sql.includes('INSERT INTO crm.transient_media'),
  );
  assert.ok(mediaCall);
  assert.equal(
    new Date(String(mediaCall.values[9])).toISOString(),
    '2026-09-09T12:00:00.000Z',
  );
});

test('round-trips the encrypted canonical event and authenticates its linkage', async () => {
  /** @type {Record<string, unknown>|undefined} */
  let storedEvent;
  const database = fakeDatabase(async (sql, values) => {
    if (sql.includes('INSERT INTO crm.webhook_receipts')) {
      return { rows: [{ id: 'receipt-round-trip' }] };
    }
    if (sql.includes('INSERT INTO crm.channel_events')) {
      storedEvent = {
        correlation_id: values[15],
        event_envelope: JSON.parse(String(values[10])),
        event_key_version: values[11],
        external_event_id: values[5],
        fingerprint: values[9],
        provider: values[2],
        provider_account_id: values[4],
      };
      return { rows: [{ id: 'event-round-trip' }] };
    }
    if (sql.includes('FROM crm.channel_events')) {
      return { rows: storedEvent ? [storedEvent] : [] };
    }
    if (sql.includes('INSERT INTO crm.transient_media')) {
      return { rows: [{ id: 'media-round-trip' }] };
    }
    return { rows: [] };
  });
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const event = canonicalEvent('event-round-trip');

  await inbox.persistBatch(input([batchItem('event-round-trip')]));
  assert.deepEqual(await inbox.readCanonicalEvent('event-round-trip'), event);
  assert.ok(storedEvent);
  storedEvent.fingerprint = '0'.repeat(64);
  await assert.rejects(
    inbox.readCanonicalEvent('event-round-trip'),
    /authenticate data|Unsupported state/u,
  );
});

test('routes events older than 24 hours to reconciliation without a job', async () => {
  const database = insertedDatabase();
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const stale = batchItem('stale-event', {
    occurredAt: '2026-09-01T11:59:59.999Z',
  });

  assert.deepEqual(await inbox.persistBatch(input([stale])), {
    accepted: 1,
    duplicates: 0,
    reconciliation: 1,
  });
  assert.equal(
    database.calls.some(
      /** @param {{sql: string}} call */
      (call) => call.sql.includes('INSERT INTO crm.outbox_jobs'),
    ),
    false,
  );
  const eventCall = database.calls.find(
    /** @param {{sql: string}} call */
    (call) => call.sql.includes('INSERT INTO crm.channel_events'),
  );
  assert.ok(eventCall);
  assert.equal(eventCall.values[13], 'reconciliation');
});

test('maps the public reconcile disposition to persisted reconciliation', async () => {
  const database = insertedDatabase();
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const requested = batchItem('event-manual-reconcile', {
    disposition: 'reconcile',
  });

  assert.deepEqual(await inbox.persistBatch(input([requested])), {
    accepted: 1,
    duplicates: 0,
    reconciliation: 1,
  });
  const eventCall = database.calls.find(
    /** @param {{sql: string}} call */
    (call) => call.sql.includes('INSERT INTO crm.channel_events'),
  );
  assert.ok(eventCall);
  assert.equal(eventCall.values[13], 'reconciliation');
  assert.equal(
    database.calls.some(
      /** @param {{sql: string}} call */
      (call) => call.sql.includes('INSERT INTO crm.outbox_jobs'),
    ),
    false,
  );
});

test('coalesces an exact replay without media, audit, job or expiry update', async () => {
  /** @type {string|undefined} */
  let insertedFingerprint;
  const database = fakeDatabase(async (sql, values) => {
    if (sql.includes('INSERT INTO crm.webhook_receipts')) {
      return { rows: [{ id: 'receipt-replay' }] };
    }
    if (sql.includes('INSERT INTO crm.channel_events')) {
      insertedFingerprint = String(values[9]);
      return { rows: [] };
    }
    if (sql.includes('SELECT id, fingerprint FROM crm.channel_events')) {
      return {
        rows: [
          { id: 'existing-event', fingerprint: String(insertedFingerprint) },
        ],
      };
    }
    return { rows: [] };
  });
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });

  assert.deepEqual(
    await inbox.persistBatch(input([batchItem('event-replay')])),
    {
      accepted: 0,
      duplicates: 1,
      reconciliation: 0,
    },
  );
  const sql = database.calls
    .map(
      /** @param {{sql: string}} call */
      (call) => call.sql,
    )
    .join('\n');
  assert.doesNotMatch(sql, /INSERT INTO crm\.transient_media/u);
  assert.doesNotMatch(sql, /INSERT INTO crm\.audit_events/u);
  assert.doesNotMatch(sql, /INSERT INTO crm\.outbox_jobs/u);
  assert.match(sql, /DELETE FROM crm\.webhook_receipts/u);
  assert.doesNotMatch(sql, /UPDATE .*expires_at/iu);
});

test('rejects reuse of an event identity with another fingerprint', async () => {
  const database = fakeDatabase(async (sql) => {
    if (sql.includes('INSERT INTO crm.webhook_receipts')) {
      return { rows: [{ id: 'receipt-conflict' }] };
    }
    if (sql.includes('INSERT INTO crm.channel_events')) return { rows: [] };
    if (sql.includes('SELECT id, fingerprint FROM crm.channel_events')) {
      return { rows: [{ id: 'existing-event', fingerprint: '0'.repeat(64) }] };
    }
    return { rows: [] };
  });
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });

  await assert.rejects(
    inbox.persistBatch(input([batchItem('event-conflict')])),
    (error) => {
      assert.ok(error instanceof WebhookEventConflictError);
      assert.equal(error.code, 'WEBHOOK_EVENT_ID_REUSED');
      assert.equal('identity' in error, false);
      return true;
    },
  );
});

test('sorts scoped event keys before acquiring uniqueness locks', async () => {
  const database = insertedDatabase();
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });

  await inbox.persistBatch(input([batchItem('event-z'), batchItem('event-a')]));
  const insertedIds = database.calls
    .filter(
      /** @param {{sql: string}} call */
      (call) => call.sql.includes('INSERT INTO crm.channel_events'),
    )
    .map(
      /** @param {{values: unknown[]}} call */
      (call) => call.values[5],
    );
  assert.deepEqual(insertedIds, ['event-a', 'event-z']);
});

test('validates the full batch before opening a transaction', async () => {
  let transactions = 0;
  const database = fakeDatabase();
  database.transaction = async () => {
    transactions += 1;
    throw new Error('transaction must not start');
  };
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const invalid = batchItem('event-invalid');
  invalid.media[0].externalMediaId = '';

  await assert.rejects(
    inbox.persistBatch(input([batchItem('event-valid'), invalid])),
    /externalMediaId/u,
  );
  assert.equal(transactions, 0);
});

test('rejects media descriptors that do not belong to the canonical event', async () => {
  let transactions = 0;
  const database = fakeDatabase();
  database.transaction = async () => {
    transactions += 1;
    throw new Error('transaction must not start');
  };
  const inbox = new PostgresWebhookInbox({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const mismatched = batchItem('event-media-binding');
  mismatched.media[0].externalMediaId = 'media-from-another-event';

  await assert.rejects(
    inbox.persistBatch(input([mismatched])),
    /media.*canonical event|canonical event.*media/iu,
  );
  assert.equal(transactions, 0);
});
