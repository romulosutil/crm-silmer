import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  AuditEventValidationError,
  PostgresAuditTrail,
} from '../modules/audit-privacy/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';

const auditInput = Object.freeze({
  actor: 'admin-1',
  action: 'identity.user.created',
  target: Object.freeze({ type: 'user', id: 'seller-1' }),
  version: 1,
  reason: 'authorized',
  correlationId: 'correlation-audit-adapter',
});

class RecordingQueryable {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  queries = [];

  /** @param {string} sql @param {unknown[]} [values] */
  async query(sql, values = []) {
    this.queries.push({ sql, values });
    return { rows: [] };
  }
}

/** @param {RecordingQueryable} queryable */
function createPostgresAuditTrail(queryable) {
  return new PostgresAuditTrail(queryable, {
    clock: () => new Date('2026-09-01T12:00:00.000Z'),
    idFactory: () => 'audit-postgres-1',
  });
}

test('PostgreSQL audit adapter projects the allowlisted envelope onto an injected transaction', async () => {
  const pool = new RecordingQueryable();
  const transaction = new RecordingQueryable();
  const auditTrail = createPostgresAuditTrail(pool);

  const event = await auditTrail.append(
    {
      ...auditInput,
      content: 'must-not-persist',
      email: 'incidental@example.test',
      payload: { secret: 'must-not-persist' },
      token: 'must-not-persist',
    },
    { transaction },
  );

  assert.deepEqual(pool.queries, []);
  assert.equal(transaction.queries.length, 1);
  assert.match(transaction.queries[0].sql, /INSERT INTO crm\.audit_events/iu);
  assert.deepEqual(transaction.queries[0].values, [
    'audit-postgres-1',
    'admin-1',
    'identity.user.created',
    'user',
    'seller-1',
    '1',
    'authorized',
    'correlation-audit-adapter',
    new Date('2026-09-01T12:00:00.000Z'),
  ]);
  assert.doesNotMatch(
    JSON.stringify(transaction.queries),
    /payload|content|token|email|must-not-persist|incidental@example\.test/iu,
  );
  assert.deepEqual(event, {
    id: 'audit-postgres-1',
    actor: 'admin-1',
    action: 'identity.user.created',
    target: { type: 'user', id: 'seller-1' },
    version: 1,
    reason: 'authorized',
    correlationId: 'correlation-audit-adapter',
    occurredAt: '2026-09-01T12:00:00.000Z',
  });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.target), true);
  assert.equal('update' in auditTrail, false);
  assert.equal('delete' in auditTrail, false);
});

test('PostgreSQL audit adapter uses the injected base Queryable without owning a transaction', async () => {
  const queryable = new RecordingQueryable();
  const auditTrail = createPostgresAuditTrail(queryable);

  await auditTrail.append(auditInput);

  assert.equal(queryable.queries.length, 1);
  assert.match(queryable.queries[0].sql, /INSERT INTO crm\.audit_events/iu);
});

test('PostgreSQL audit adapter validates before issuing a query', async () => {
  const queryable = new RecordingQueryable();
  const auditTrail = createPostgresAuditTrail(queryable);

  await assert.rejects(
    auditTrail.append({ ...auditInput, reason: '' }),
    AuditEventValidationError,
  );
  assert.deepEqual(queryable.queries, []);
});

const connectionString = process.env.TEST_DATABASE_URL;

if (connectionString) {
  test('PostgreSQL audit adapter live: external rollback and append-only rows', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live audit test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 4 });
    const migrations = await loadMigrations();
    const auditTrail = new PostgresAuditTrail(pool, {
      clock: () => new Date('2026-09-01T12:00:00.000Z'),
      idFactory: () => 'audit-live-1',
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations });

      await assert.rejects(
        withTransaction(pool, async (transaction) => {
          await auditTrail.append(
            {
              ...auditInput,
              payload: { token: 'not-a-column' },
            },
            { transaction },
          );
          throw new Error('domain effect failed');
        }),
        /domain effect failed/u,
      );
      assert.equal(
        Number(
          (
            await pool.query(
              `SELECT count(*) AS count FROM crm.audit_events
               WHERE id = 'audit-live-1'`,
            )
          ).rows[0].count,
        ),
        0,
      );

      const committed = await withTransaction(pool, (transaction) =>
        auditTrail.append(auditInput, { transaction }),
      );
      assert.equal(committed.id, 'audit-live-1');

      const persisted = await pool.query(
        `SELECT id, actor_id, action, target_type, target_id, version, reason,
                correlation_id, occurred_at
         FROM crm.audit_events
         WHERE id = 'audit-live-1'`,
      );
      assert.equal(persisted.rows.length, 1);
      assert.deepEqual(
        Object.keys(persisted.rows[0]).sort(),
        [
          'action',
          'actor_id',
          'correlation_id',
          'id',
          'occurred_at',
          'reason',
          'target_id',
          'target_type',
          'version',
        ].sort(),
      );
      assert.deepEqual(
        {
          ...persisted.rows[0],
          occurred_at: persisted.rows[0].occurred_at.toISOString(),
        },
        {
          id: 'audit-live-1',
          actor_id: 'admin-1',
          action: 'identity.user.created',
          target_type: 'user',
          target_id: 'seller-1',
          version: '1',
          reason: 'authorized',
          correlation_id: 'correlation-audit-adapter',
          occurred_at: '2026-09-01T12:00:00.000Z',
        },
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.audit_events SET reason = 'rewritten'
           WHERE id = 'audit-live-1'`,
        ),
        /immutable/iu,
      );
      await assert.rejects(
        pool.query(`DELETE FROM crm.audit_events WHERE id = 'audit-live-1'`),
        /immutable/iu,
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
