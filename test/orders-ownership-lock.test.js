import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';

function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
}

test('a transferred conversation is checked before the order row is locked', async () => {
  const selected = deferred();
  const resume = deferred();
  /** @type {string[]} */
  const queries = [];
  let assignedUserId = 'seller-old';
  const database = {
    async query() {
      throw new Error('read outside the write transaction');
    },
    transaction: (/** @type {(transaction: any) => Promise<unknown>} */ work) =>
      work({
        async query(/** @type {string} */ sql) {
          queries.push(sql);
          if (sql.includes('FROM crm.conversations')) {
            selected.resolve();
            await resume.promise;
            return { rows: [{ assigned_user_id: assignedUserId }] };
          }
          throw new Error('the stale owner must not reach the order row');
        },
      }),
  };
  const repository = new PostgresOrderRepository({
    database: /** @type {any} */ (database),
    envelopeKey: Buffer.alloc(32),
  });
  const write = repository.saveMilestones(
    /** @type {any} */ ({ id: 'order-1', conversationId: 'conversation-1' }),
    {
      actor: { id: 'seller-old', kind: 'human', capabilities: [] },
      correlationId: 'correlation-1',
      expectedVersion: 1,
    },
  );
  await selected.promise;
  assignedUserId = 'seller-new';
  resume.resolve();
  await assert.rejects(write, { code: 'FORBIDDEN', statusCode: 403 });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FOR UPDATE/u);
});

test('an admin claim needs a current database grant', async () => {
  /** @type {string[]} */
  const queries = [];
  const transaction = {
    async query(/** @type {string} */ sql) {
      queries.push(sql);
      if (sql.includes('FROM crm.conversations')) {
        return { rows: [{ assigned_user_id: 'seller-new' }] };
      }
      if (sql.includes('FROM crm.user_capabilities')) {
        return { rows: [] };
      }
      throw new Error('no order write is allowed without the grant');
    },
  };
  const repository = new PostgresOrderRepository({
    database: /** @type {any} */ ({
      query: transaction.query,
      transaction: (/** @type {(tx: any) => Promise<unknown>} */ work) =>
        work(transaction),
    }),
    envelopeKey: Buffer.alloc(32),
  });
  await assert.rejects(
    repository.saveMilestones(
      /** @type {any} */ ({ id: 'order-1', conversationId: 'conversation-1' }),
      {
        actor: {
          id: 'seller-old',
          kind: 'human',
          capabilities: ['COMMERCIAL_ADMIN'],
        },
        correlationId: 'correlation-1',
        expectedVersion: 1,
      },
    ),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  assert.equal(queries.length, 2);
  assert.match(queries[1], /FOR SHARE/u);
});

test('human writes cannot omit the actor', async () => {
  /** @type {string[]} */
  const queries = [];
  const transaction = {
    async query(/** @type {string} */ sql) {
      queries.push(sql);
      if (sql.includes('FROM crm.conversations')) {
        return { rows: [{ assigned_user_id: 'seller-old' }] };
      }
      throw new Error('a human write without actor must stop before the order');
    },
  };
  const repository = new PostgresOrderRepository({
    database: /** @type {any} */ ({
      query: transaction.query,
      transaction: (/** @type {(tx: any) => Promise<unknown>} */ work) =>
        work(transaction),
    }),
    envelopeKey: Buffer.alloc(32),
  });
  await assert.rejects(
    repository.saveMilestones(
      /** @type {any} */ ({ id: 'order-1', conversationId: 'conversation-1' }),
      { correlationId: 'correlation-1', expectedVersion: 1 },
    ),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  await assert.rejects(
    repository.createPending(
      /** @type {any} */ ({
        conversationId: 'conversation-1',
        createdByKind: 'user',
      }),
    ),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  assert.equal(queries.length, 2);
});
