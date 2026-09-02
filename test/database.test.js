import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkDatabaseReadiness,
  DatabaseConnectionTimeoutError,
  withTransaction,
} from '../modules/database/src/index.js';

class TransactionClient {
  constructor({ failRollback = false } = {}) {
    this.failRollback = failRollback;
    /** @type {string[]} */
    this.queries = [];
    this.released = false;
  }

  /** @param {string} sql */
  async query(sql) {
    this.queries.push(sql);
    if (sql === 'ROLLBACK' && this.failRollback) {
      throw new Error('rollback failed');
    }
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

test('commits successful work and releases the PostgreSQL client', async () => {
  const client = new TransactionClient();
  const pool = { connect: async () => client };

  const value = await withTransaction(pool, async (transaction) => {
    await transaction.query('SELECT 42');
    return 'committed';
  });

  assert.equal(value, 'committed');
  assert.deepEqual(client.queries, ['BEGIN', 'SELECT 42', 'COMMIT']);
  assert.equal(client.released, true);
});

test('rolls back failed work without replacing the domain error', async () => {
  const client = new TransactionClient({ failRollback: true });
  const pool = { connect: async () => client };
  const domainError = new Error('domain failed');

  await assert.rejects(
    withTransaction(pool, async () => {
      throw domainError;
    }),
    (error) => error === domainError,
  );

  assert.deepEqual(client.queries, ['BEGIN', 'ROLLBACK']);
  assert.equal(client.released, true);
});

test('classifies a bounded PostgreSQL pool acquisition timeout', async () => {
  const cause = new Error('timeout exceeded when trying to connect');
  const pool = {
    async connect() {
      throw cause;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => undefined),
    (error) => {
      assert.ok(error instanceof DatabaseConnectionTimeoutError);
      assert.equal(error.code, 'DATABASE_CONNECTION_TIMEOUT');
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test('readiness requires connectivity and every compatible expand migration', async () => {
  const migrations = /** @type {const} */ ([
    { checksum: 'aaa', phase: 'expand', version: '0001' },
    { checksum: 'bbb', phase: 'expand', version: '0002' },
    { checksum: 'ccc', phase: 'contract', version: '0003' },
  ]);
  const ready = {
    query: async (/** @type {string} */ sql) => {
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      return {
        rows: [
          { checksum: 'aaa', phase: 'expand', version: '0001' },
          { checksum: 'bbb', phase: 'expand', version: '0002' },
        ],
      };
    },
  };

  assert.equal(await checkDatabaseReadiness(ready, migrations), true);

  const stale = {
    query: async (/** @type {string} */ sql) =>
      sql === 'SELECT 1'
        ? { rows: [{ '?column?': 1 }] }
        : { rows: [{ checksum: 'aaa', phase: 'expand', version: '0001' }] },
  };
  assert.equal(await checkDatabaseReadiness(stale, migrations), false);
});
