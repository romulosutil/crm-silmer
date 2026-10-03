import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';

test('Postgres sales summary aggregates all orders before any list pagination', async () => {
  /** @type {string[]} */
  const queries = [];
  const repository = new PostgresOrderRepository({
    envelopeKey: Buffer.alloc(32, 1),
    database: {
      query: async (/** @type {string} */ sql) => {
        queries.push(sql);
        return {
          rows: [
            {
              confirmed_count: '3',
              sold_amount_cents: '150000',
              pending_count: '4',
              total_pieces_sold: '27',
            },
          ],
        };
      },
      transaction: async () => {
        throw new Error('not used');
      },
    },
  });
  assert.deepEqual(await repository.summary(), {
    confirmedCount: 3,
    soldAmountCents: 150000,
    averageTicketCents: 50000,
    pendingCount: 4,
    totalPiecesSold: 27,
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM crm\.orders/u);
  assert.doesNotMatch(queries[0], /LIMIT|OFFSET/u);
});
