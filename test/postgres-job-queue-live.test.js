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
  PostgresJobQueue,
  PostgresTransientMediaRepository,
} from '../modules/integration-reliability/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    /** @param {(client: import('pg').PoolClient) => Promise<any>} work */
    transaction: (work) => withTransaction(pool, work),
  };
}

/** @param {Pool} pool @param {{priority?: number, maxAttempts?: number}} [options] */
async function seedJob(pool, options = {}) {
  const suffix = randomUUID();
  const receivedAt = new Date('2026-09-02T12:00:00.000Z');
  const receiptId = `receipt-${suffix}`;
  const eventId = `event-${suffix}`;
  const jobId = `job-${suffix}`;
  const envelope = {
    algorithm: 'AES-256-GCM',
    ciphertext: 'fixture',
    iv: 'fixture',
    keyVersion: 1,
    tag: 'fixture',
    version: 1,
  };
  await pool.query(
    `INSERT INTO crm.webhook_receipts
       (id, provider, payload_sha256, payload_envelope, key_version,
        received_at, expires_at, correlation_id)
     VALUES ($1, 'meta', $2, $3, 1, $4, $5, $6)`,
    [
      receiptId,
      Buffer.from(suffix).toString('hex').slice(0, 64).padEnd(64, '0'),
      envelope,
      receivedAt,
      new Date(receivedAt.getTime() + 24 * 60 * 60 * 1000),
      `correlation-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO crm.channel_events
       (id, webhook_receipt_id, provider, channel, provider_account_id,
        external_event_id, external_message_id, message_type, occurred_at,
        fingerprint, event_envelope, event_key_version, received_at,
        disposition, processing_status, correlation_id)
     VALUES ($1, $2, 'meta', 'whatsapp', $3, $4, $5, 'text', $6, $7,
       $8, 1, $6, 'process', 'pending', $9)`,
    [
      eventId,
      receiptId,
      `account-${suffix}`,
      `external-${suffix}`,
      `message-${suffix}`,
      receivedAt,
      'a'.repeat(64),
      envelope,
      `correlation-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO crm.outbox_jobs
       (id, job_type, idempotency_key, channel_event_id, status, priority,
        available_at, created_at, updated_at, max_attempts, effect_policy)
     VALUES ($1, 'channel_event.process', $2, $3, 'pending', $4, $5, $5,
       $5, $6, 'internal')`,
    [
      jobId,
      `key-${suffix}`,
      eventId,
      options.priority ?? 100,
      receivedAt,
      options.maxAttempts ?? 3,
    ],
  );
  return { eventId, jobId, receivedAt };
}

if (connectionString) {
  test('PostgreSQL queue claims exclusively and preserves the external-effect kill matrix', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 8 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const database = databaseFor(pool);
      const queue = new PostgresJobQueue({ database, random: () => 0.5 });
      const first = await seedJob(pool, { priority: 10 });
      const second = await seedJob(pool, { priority: 20 });
      const now = first.receivedAt;

      const [left, right] = await Promise.all([
        queue.claim({ leaseMs: 1_000, limit: 1, now, workerId: 'worker-a' }),
        queue.claim({ leaseMs: 1_000, limit: 1, now, workerId: 'worker-b' }),
      ]);
      assert.equal(left.length, 1);
      assert.equal(right.length, 1);
      assert.notEqual(left[0].id, right[0].id);
      assert.deepEqual(
        new Set([left[0].id, right[0].id]),
        new Set([first.jobId, second.jobId]),
      );
      await queue.settle({
        attemptId: left[0].attemptId,
        jobId: left[0].id,
        now,
        outcome: 'sent',
        workerId: 'worker-a',
      });
      await queue.settle({
        attemptId: right[0].attemptId,
        jobId: right[0].id,
        now,
        outcome: 'sent',
        workerId: 'worker-b',
      });

      const reclaim = await seedJob(pool);
      const original = await queue.claim({
        leaseMs: 1_000,
        now,
        workerId: 'worker-before-kill',
      });
      assert.equal(original[0].id, reclaim.jobId);
      const reclaimed = await queue.claim({
        leaseMs: 1_000,
        now: new Date(now.getTime() + 1_001),
        workerId: 'worker-reclaimer',
      });
      assert.equal(reclaimed[0].id, reclaim.jobId);
      assert.equal(reclaimed[0].attemptCount, 2);
      await queue.settle({
        attemptId: reclaimed[0].attemptId,
        jobId: reclaimed[0].id,
        now: new Date(now.getTime() + 1_001),
        outcome: 'sent',
        workerId: 'worker-reclaimer',
      });

      const heartbeatJob = await seedJob(pool);
      const heartbeatClaim = await queue.claim({
        leaseMs: 1_000,
        now,
        workerId: 'worker-heartbeat',
      });
      assert.equal(heartbeatClaim[0].id, heartbeatJob.jobId);
      assert.equal(
        await queue.heartbeat({
          attemptId: heartbeatClaim[0].attemptId,
          jobId: heartbeatJob.jobId,
          leaseMs: 1_000,
          now: new Date(now.getTime() + 500),
          workerId: 'worker-heartbeat',
        }),
        true,
      );
      assert.deepEqual(
        await queue.claim({
          leaseMs: 1_000,
          now: new Date(now.getTime() + 1_001),
          workerId: 'worker-too-early',
        }),
        [],
      );
      const afterHeartbeatExpiry = await queue.claim({
        leaseMs: 1_000,
        now: new Date(now.getTime() + 1_501),
        workerId: 'worker-after-heartbeat',
      });
      assert.equal(afterHeartbeatExpiry[0].id, heartbeatJob.jobId);
      await queue.settle({
        attemptId: afterHeartbeatExpiry[0].attemptId,
        jobId: afterHeartbeatExpiry[0].id,
        now: new Date(now.getTime() + 1_501),
        outcome: 'sent',
        workerId: 'worker-after-heartbeat',
      });

      const uncertain = await seedJob(pool);
      const claimed = await queue.claim({
        leaseMs: 1_000,
        now,
        workerId: 'worker-effect',
      });
      assert.equal(claimed[0].id, uncertain.jobId);
      assert.equal(
        await queue.markEffectStarted({
          attemptId: claimed[0].attemptId,
          jobId: claimed[0].id,
          now,
          provider: 'meta',
          workerId: 'worker-effect',
        }),
        true,
      );
      await queue.claim({
        leaseMs: 1_000,
        now: new Date(now.getTime() + 1_001),
        workerId: 'worker-after-kill',
      });
      const uncertainRow = await pool.query(
        'SELECT status FROM crm.outbox_jobs WHERE id = $1',
        [uncertain.jobId],
      );
      assert.equal(uncertainRow.rows[0].status, 'outcome_unknown');
      const uncertainItems = await pool.query(
        'SELECT reason FROM crm.reconciliation_items WHERE job_id = $1',
        [uncertain.jobId],
      );
      assert.equal(
        uncertainItems.rows[0].reason,
        'lease_expired_after_effect_started',
      );

      const poison = await seedJob(pool, { maxAttempts: 1 });
      const poisonClaim = await queue.claim({ now, workerId: 'worker-poison' });
      assert.equal(poisonClaim[0].id, poison.jobId);
      await queue.settle({
        attemptId: poisonClaim[0].attemptId,
        errorCode: 'POISON',
        jobId: poison.jobId,
        now,
        outcome: 'failed',
        retryable: true,
        retrySafe: true,
        workerId: 'worker-poison',
      });
      const poisonRow = await pool.query(
        'SELECT status FROM crm.outbox_jobs WHERE id = $1',
        [poison.jobId],
      );
      assert.equal(poisonRow.rows[0].status, 'dead_letter');
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL media lifecycle schedules deletion without extending TTL and records manual Dropbox handoff', async () => {
    const pool = new Pool({ connectionString, max: 4 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      const database = databaseFor(pool);
      const repository = new PostgresTransientMediaRepository({ database });
      const suffix = randomUUID();
      const receivedAt = new Date('2026-09-02T12:00:00.000Z');
      const expiresAt = new Date('2026-09-09T12:00:00.000Z');
      const mediaId = `media-${suffix}`;
      await pool.query(
        `INSERT INTO crm.transient_media
           (id, provider, provider_account_id, external_media_id, media_type,
            metadata_fingerprint, first_received_at, expires_at,
            availability_status, storage_key, size_bytes, content_sha256,
            detected_mime_type, validation_status, stored_at)
         VALUES ($1, 'meta', $2, $3, 'image', $4, $5, $6, 'available',
           $7, 4, $8, 'image/png', 'clean', $5)`,
        [
          mediaId,
          `account-${suffix}`,
          `external-${suffix}`,
          'b'.repeat(64),
          receivedAt,
          expiresAt,
          randomUUID(),
          'c'.repeat(64),
        ],
      );

      await repository.recordDropboxHandoff({
        mediaId,
        occurredAt: receivedAt,
        operatorId: 'operator-1',
        result: 'success',
      });
      await repository.scheduleImmediateDeletion({
        mediaId,
        now: new Date('2026-09-03T12:00:00.000Z'),
        reason: 'journey_terminal',
      });
      const media = await pool.query(
        'SELECT expires_at FROM crm.transient_media WHERE id = $1',
        [mediaId],
      );
      assert.equal(
        media.rows[0].expires_at.toISOString(),
        expiresAt.toISOString(),
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.transient_media
           SET expires_at = expires_at + interval '1 hour'
           WHERE id = $1`,
          [mediaId],
        ),
        /expiry is immutable/iu,
      );
      const jobs = await pool.query(
        `SELECT job_type, available_at, deletion_reason
         FROM crm.outbox_jobs WHERE transient_media_id = $1`,
        [mediaId],
      );
      assert.deepEqual(
        jobs.rows.map(
          ({ job_type: jobType, deletion_reason: deletionReason }) => ({
            deletionReason,
            jobType,
          }),
        ),
        [{ deletionReason: 'journey_terminal', jobType: 'media.delete' }],
      );
      const receipts = await pool.query(
        `SELECT operator_id, result, content_sha256
         FROM crm.media_handoff_receipts WHERE transient_media_id = $1`,
        [mediaId],
      );
      assert.deepEqual(receipts.rows, [
        {
          content_sha256: 'c'.repeat(64),
          operator_id: 'operator-1',
          result: 'success',
        },
      ]);

      const expiredMediaId = `media-expired-${suffix}`;
      await pool.query(
        `INSERT INTO crm.transient_media
           (id, provider, provider_account_id, external_media_id, media_type,
            metadata_fingerprint, first_received_at, expires_at,
            availability_status)
         VALUES ($1, 'meta', $2, $3, 'image', $4, $5, $6,
           'metadata_only')`,
        [
          expiredMediaId,
          `account-expired-${suffix}`,
          `external-expired-${suffix}`,
          'd'.repeat(64),
          receivedAt,
          expiresAt,
        ],
      );
      assert.equal(
        await repository.scheduleExpiredDeletions({
          now: new Date('2026-09-10T12:00:00.000Z'),
        }),
        1,
      );
      const expiredJob = await pool.query(
        `SELECT deletion_reason FROM crm.outbox_jobs
         WHERE transient_media_id = $1`,
        [expiredMediaId],
      );
      assert.equal(expiredJob.rows[0].deletion_reason, 'expired');
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
