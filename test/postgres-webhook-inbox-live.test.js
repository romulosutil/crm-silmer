import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresWebhookInbox,
  WebhookEventConflictError,
} from '../modules/integration-reliability/src/postgres-webhook-inbox.js';

const connectionString = process.env.TEST_DATABASE_URL;

/**
 * @param {string} runId
 * @param {{externalId?: string, occurredAt?: string}} [options]
 * @returns {Record<string, any>}
 */
function canonicalEvent(runId, options = {}) {
  const externalId = options.externalId ?? `event-${runId}`;
  const occurredAt = options.occurredAt ?? '2026-09-02T12:00:00.000Z';
  return {
    schemaVersion: 1,
    direction: 'inbound',
    provider: 'meta',
    providerAccountId: `account-${runId}`,
    channel: 'whatsapp',
    externalEventId: {
      externalId,
      key: JSON.stringify(['meta', `account-${runId}`, externalId]),
      provider: 'meta',
      providerAccountId: `account-${runId}`,
    },
    externalMessageId: {
      externalId,
      key: JSON.stringify(['meta', `account-${runId}`, externalId]),
      provider: 'meta',
      providerAccountId: `account-${runId}`,
    },
    externalConversationId: {
      externalId: `conversation-${runId}`,
      key: JSON.stringify([
        'meta',
        `account-${runId}`,
        `conversation-${runId}`,
      ]),
      provider: 'meta',
      providerAccountId: `account-${runId}`,
    },
    occurredAt,
    origin: 'channel',
    visibility: 'inbox',
    identity: {
      automaticMergeAllowed: false,
      displayHandle: null,
      externalId: {
        externalId: `identity-${runId}`,
        key: JSON.stringify(['meta', `account-${runId}`, `identity-${runId}`]),
        provider: 'meta',
        providerAccountId: `account-${runId}`,
      },
      kind: 'phone',
      mergePolicy: 'verified-evidence-only',
      phoneStatus: 'confirmed',
    },
    message: {
      content: { attachmentId: `media-${runId}`, caption: null },
      type: 'image',
    },
  };
}

test(
  'PostgreSQL live coalesces webhook effects and rolls back atomically',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const liveConnectionString = /** @type {string} */ (connectionString);
    const databaseName = new URL(liveConnectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live webhook test only uses the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString: liveConnectionString, max: 24 });
    /** @type {any} */
    const database = {
      query: pool.query.bind(pool),
      /** @param {(client: import('pg').PoolClient) => Promise<unknown>} work */
      transaction: (work) => withTransaction(pool, work),
    };
    const inbox = new PostgresWebhookInbox({
      database,
      envelopeKey: Buffer.alloc(32, 31),
    });
    const runId = randomUUID().replaceAll('-', '');
    const receivedAt = '2026-09-02T12:00:00.000Z';
    const event = canonicalEvent(runId);
    /** @type {any} */
    const item = {
      disposition: 'process',
      event,
      media: [
        {
          declaredMimeType: 'image/png',
          externalMediaId: `media-${runId}`,
          mediaType: 'image',
          providerSha256: 'synthetic-provider-sha256',
        },
      ],
    };
    /** @type {any} */
    const request = {
      correlationId: randomUUID(),
      events: [item],
      rawBody: Buffer.from(`{"canary":"private-${runId}"}`),
      receivedAt,
    };

    try {
      await migrate(pool, { migrations: await loadMigrations() });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => inbox.persistBatch(request)),
      );
      assert.equal(
        results.reduce((sum, result) => sum + result.accepted, 0),
        1,
      );
      assert.equal(
        results.reduce((sum, result) => sum + result.duplicates, 0),
        19,
      );

      const state = await pool.query(
        `SELECT
          (SELECT count(*)::integer FROM crm.channel_events
            WHERE provider_account_id = $1) AS events,
          (SELECT count(*)::integer FROM crm.transient_media
            WHERE provider_account_id = $1) AS media,
          (SELECT count(*)::integer FROM crm.channel_event_media cem
            JOIN crm.channel_events ce ON ce.id = cem.channel_event_id
            WHERE ce.provider_account_id = $1) AS links,
          (SELECT count(*)::integer FROM crm.outbox_jobs oj
            JOIN crm.channel_events ce ON ce.id = oj.channel_event_id
            WHERE ce.provider_account_id = $1) AS jobs,
          (SELECT count(*)::integer FROM crm.audit_events
            WHERE target_id = $2) AS audits`,
        [`account-${runId}`, event.externalEventId.key],
      );
      assert.deepEqual(state.rows[0], {
        audits: 1,
        events: 1,
        jobs: 1,
        links: 1,
        media: 1,
      });

      const stored = await pool.query(
        `SELECT ce.id AS channel_event_id,
                ce.event_envelope::text AS event_envelope,
                wr.payload_envelope::text AS payload_envelope,
                tm.availability_status,
                tm.first_received_at,
                tm.expires_at
         FROM crm.channel_events ce
         JOIN crm.webhook_receipts wr ON wr.id = ce.webhook_receipt_id
         JOIN crm.channel_event_media cem ON cem.channel_event_id = ce.id
         JOIN crm.transient_media tm ON tm.id = cem.transient_media_id
         WHERE ce.provider_account_id = $1`,
        [`account-${runId}`],
      );
      assert.equal(stored.rows[0].availability_status, 'metadata_only');
      assert.equal(
        stored.rows[0].expires_at.getTime() -
          stored.rows[0].first_received_at.getTime(),
        7 * 24 * 60 * 60 * 1000,
      );
      assert.doesNotMatch(
        stored.rows[0].payload_envelope,
        new RegExp(runId, 'u'),
      );
      assert.doesNotMatch(
        stored.rows[0].event_envelope,
        new RegExp(runId, 'u'),
      );
      assert.deepEqual(
        await inbox.readCanonicalEvent(stored.rows[0].channel_event_id),
        event,
      );

      const originalExpiry = stored.rows[0].expires_at.toISOString();
      await inbox.persistBatch({
        ...request,
        receivedAt: '2026-09-03T12:00:00.000Z',
      });
      const replayExpiry = await pool.query(
        `SELECT expires_at FROM crm.transient_media
         WHERE provider_account_id = $1`,
        [`account-${runId}`],
      );
      assert.equal(
        replayExpiry.rows[0].expires_at.toISOString(),
        originalExpiry,
      );

      const staleRunId = `${runId}stale`;
      const stale = canonicalEvent(staleRunId, {
        occurredAt: '2026-09-01T11:59:59.999Z',
      });
      assert.deepEqual(
        await inbox.persistBatch({
          correlationId: randomUUID(),
          events: [
            {
              disposition: 'process',
              event: stale,
              media: [
                {
                  externalMediaId: `media-${staleRunId}`,
                  mediaType: 'image',
                },
              ],
            },
          ],
          rawBody: Buffer.from(`{"stale":"${runId}"}`),
          receivedAt,
        }),
        { accepted: 1, duplicates: 0, reconciliation: 1 },
      );
      const staleJobs = await pool.query(
        `SELECT count(*)::integer AS count
         FROM crm.outbox_jobs oj
         JOIN crm.channel_events ce ON ce.id = oj.channel_event_id
         WHERE ce.provider_account_id = $1`,
        [`account-${staleRunId}`],
      );
      assert.equal(staleJobs.rows[0].count, 0);

      const changed = /** @type {any} */ (structuredClone(item));
      changed.event.message.content.caption = 'different canonical event';
      await assert.rejects(
        inbox.persistBatch({ ...request, events: [changed] }),
        WebhookEventConflictError,
      );

      const rollbackRunId = `${runId}rollback`;
      const rollbackEvent = canonicalEvent(rollbackRunId);
      /** @type {any} */
      const rejectingDatabase = {
        query: pool.query.bind(pool),
        /** @param {(client: any) => Promise<unknown>} work */
        transaction: (work) =>
          withTransaction(pool, (client) =>
            work({
              /** @param {string} sql @param {unknown[]} [values] */
              query: (sql, values) => {
                if (sql.includes('INSERT INTO crm.audit_events')) {
                  throw new Error('synthetic audit failure');
                }
                return client.query(sql, values);
              },
            }),
          ),
      };
      const rejectingInbox = new PostgresWebhookInbox({
        database: rejectingDatabase,
        envelopeKey: Buffer.alloc(32, 31),
      });
      await assert.rejects(
        rejectingInbox.persistBatch({
          correlationId: randomUUID(),
          events: [
            {
              disposition: 'process',
              event: rollbackEvent,
              media: [
                {
                  externalMediaId: `media-${rollbackRunId}`,
                  mediaType: 'image',
                },
              ],
            },
          ],
          rawBody: Buffer.from(`{"rollback":"${runId}"}`),
          receivedAt,
        }),
        /synthetic audit failure/u,
      );
      const rolledBack = await pool.query(
        `SELECT count(*)::integer AS count FROM crm.channel_events
         WHERE provider_account_id = $1`,
        [`account-${rollbackRunId}`],
      );
      assert.equal(rolledBack.rows[0].count, 0);
    } finally {
      await pool.end();
    }
  },
);
