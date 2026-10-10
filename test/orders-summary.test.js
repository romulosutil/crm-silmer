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
              store_new_count: '2',
              store_new_oldest_paid_at: new Date('2026-10-08T02:15:55.000Z'),
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
    storeNewCount: 2,
    storeNewOldestPaidAt: '2026-10-08T02:15:55.000Z',
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM crm\.orders/u);
  assert.doesNotMatch(queries[0], /LIMIT|OFFSET/u);
  // ADR 031: the notice counts unprinted store orders, never a test order.
  assert.match(queries[0], /WHERE NOT is_test/u);
  assert.match(
    queries[0],
    /origin = 'loja' AND ficha_first_printed_at IS NULL/u,
  );
});
