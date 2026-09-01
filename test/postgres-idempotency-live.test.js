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
  fingerprintCommand,
  IdempotencyConflictError,
  PostgresIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;

if (connectionString) {
  test('coalesces PostgreSQL effects and rolls failures back atomically', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live idempotency test only uses the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 6 });
    const runId = randomUUID().replaceAll('-', '');
    const effectTable = `crm_test.idempotency_effects_${runId}`;
    const responseKey = Buffer.alloc(32, 11);
    /** @type {number[]} */
    const transactionClientIds = [];
    /** @type {{
     *   query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>,
     *   transaction: <T>(work: (client: import('pg').PoolClient) => Promise<T>) => Promise<T>,
     * }} */
    const database = {
      query: pool.query.bind(pool),
      transaction: (work) =>
        withTransaction(pool, async (client) => {
          const poolClient = /** @type {import('pg').PoolClient} */ (client);
          const backend = await poolClient.query(
            'SELECT pg_backend_pid()::integer AS pid',
          );
          transactionClientIds.push(Number(backend.rows[0].pid));
          return work(poolClient);
        }),
    };
    const store = new PostgresIdempotencyRecordStore({
      database,
      envelopeKey: responseKey,
    });

    const scope = `live-${runId}:order-form.approve`;
    const identity = {
      action: 'order-form.approve',
      actor: `admin-${runId}`,
      correlationId: `correlation-${runId}`,
      fingerprint: fingerprintCommand({ approve: true, formId: runId }),
      key: `request-${runId}`,
      reason: 'Teste live de coalescência',
      scope,
      target: { id: `form-${runId}`, type: 'order-form' },
      version: 1,
    };
    const auditId = `audit-${runId}`;

    try {
      await migrate(pool, { migrations: await loadMigrations() });
      await pool.query('CREATE SCHEMA IF NOT EXISTS crm_test');
      await pool.query(
        `CREATE TABLE ${effectTable} (
           id text PRIMARY KEY,
           value text NOT NULL
         )`,
      );

      let effects = 0;
      /** @type {(value: unknown) => void} */
      let signalStarted = (_value) => {};
      const effectStarted = new Promise((resolve) => {
        signalStarted = resolve;
      });
      /** @type {(value: unknown) => void} */
      let releaseEffect = (_value) => {};
      const effectMayComplete = new Promise((resolve) => {
        releaseEffect = resolve;
      });

      const first = store.execute(identity, async (client) => {
        effects += 1;
        await client.query(
          `INSERT INTO ${effectTable} (id, value) VALUES ($1, $2)`,
          [`effect-${runId}`, 'committed-once'],
        );
        await client.query(
          `INSERT INTO crm.audit_events
             (id, actor_id, action, target_type, target_id, version, reason,
              correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            auditId,
            identity.actor,
            identity.action,
            identity.target.type,
            identity.target.id,
            String(identity.version),
            identity.reason,
            identity.correlationId,
          ],
        );
        signalStarted(undefined);
        await effectMayComplete;
        return {
          body: { approved: true },
          marker: `encrypted-response-canary-${runId}`,
          status: 200,
        };
      });

      await effectStarted;
      const second = store.execute(identity, async () => {
        effects += 1;
        throw new Error('coalesced callback must not run');
      });
      const secondState = await Promise.race([
        second.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise((resolve) => {
          setTimeout(() => resolve('waiting'), 50);
        }),
      ]);
      assert.equal(
        secondState,
        'waiting',
        'the conflicting insert must wait for the owning transaction',
      );
      releaseEffect(undefined);

      const [firstResponse, secondResponse] = await Promise.all([
        first,
        second,
      ]);
      assert.deepEqual(secondResponse, firstResponse);
      assert.notEqual(secondResponse, firstResponse);
      assert.equal(effects, 1);
      assert.equal(new Set(transactionClientIds.slice(0, 2)).size, 2);

      const effectCount = await pool.query(
        `SELECT count(*)::integer AS count FROM ${effectTable}`,
      );
      assert.equal(effectCount.rows[0].count, 1);
      const auditCount = await pool.query(
        'SELECT count(*)::integer AS count FROM crm.audit_events WHERE id = $1',
        [auditId],
      );
      assert.equal(auditCount.rows[0].count, 1);
      const stored = await pool.query(
        `SELECT status, response::text AS response_text
         FROM crm.idempotency_records
         WHERE scope = $1 AND idempotency_key = $2`,
        [identity.scope, identity.key],
      );
      assert.equal(stored.rows[0].status, 'completed');
      assert.equal(
        stored.rows[0].response_text.includes(
          `encrypted-response-canary-${runId}`,
        ),
        false,
      );

      await assert.rejects(
        store.execute(
          { ...identity, fingerprint: fingerprintCommand({ approve: false }) },
          async () => ({ status: 200 }),
        ),
        (error) => {
          assert.ok(error instanceof IdempotencyConflictError);
          assert.equal(error.statusCode, 409);
          return true;
        },
      );

      const rollbackIdentity = {
        ...identity,
        correlationId: `rollback-correlation-${runId}`,
        fingerprint: fingerprintCommand({ rollback: true }),
        key: `rollback-${runId}`,
      };
      const rollbackAuditId = `rollback-audit-${runId}`;
      await assert.rejects(
        store.execute(rollbackIdentity, async (client) => {
          await client.query(
            `INSERT INTO ${effectTable} (id, value) VALUES ($1, $2)`,
            [`rollback-effect-${runId}`, 'must-not-commit'],
          );
          await client.query(
            `INSERT INTO crm.audit_events
               (id, actor_id, action, target_type, target_id, version, reason,
                correlation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              rollbackAuditId,
              rollbackIdentity.actor,
              rollbackIdentity.action,
              rollbackIdentity.target.type,
              rollbackIdentity.target.id,
              String(rollbackIdentity.version),
              rollbackIdentity.reason,
              rollbackIdentity.correlationId,
            ],
          );
          throw new Error('synthetic rollback after effect and audit');
        }),
        /synthetic rollback/iu,
      );

      const rollbackState = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM ${effectTable} WHERE id = $1) AS effects,
           (SELECT count(*)::integer FROM crm.audit_events WHERE id = $2) AS audits,
           (SELECT count(*)::integer FROM crm.idempotency_records
             WHERE scope = $3 AND idempotency_key = $4) AS records`,
        [
          `rollback-effect-${runId}`,
          rollbackAuditId,
          rollbackIdentity.scope,
          rollbackIdentity.key,
        ],
      );
      assert.deepEqual(rollbackState.rows[0], {
        audits: 0,
        effects: 0,
        records: 0,
      });
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${effectTable}`);
      await pool.end();
    }
  });
}
