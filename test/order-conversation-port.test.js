import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';

test('last message status is read in one batch without content or identity', async () => {
  /** @type {Array<{sql: string, values?: unknown[]}>} */
  const queries = [];
  const port = new PostgresOrderConversationPort({
    contactEnvelopeKey: Buffer.alloc(32, 1),
    envelopeKey: Buffer.alloc(32, 2),
    database: {
      query: async (
        /** @type {string} */ sql,
        /** @type {unknown[]} */ values = [],
      ) => {
        queries.push({ sql, values });
        return {
          rows: [
            {
              conversation_id: 'conversation-1',
              direction: 'outbound',
              status: 'sent',
              delivery_status: 'failed',
              occurred_at: '2026-10-03T10:00:00.000Z',
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(await port.readLatestMessageStates([]), new Map());
  const ids = ['conversation-1', 'conversation-2'];
  assert.deepEqual(
    await port.readLatestMessageStates(ids),
    new Map([
      [
        'conversation-1',
        {
          direction: 'outbound',
          occurredAt: '2026-10-03T10:00:00.000Z',
          deliveryStatus: 'failed',
          status: 'sent',
        },
      ],
    ]),
  );
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [ids]);
  assert.match(queries[0].sql, /DISTINCT ON \(conversation_id\)/u);
  assert.doesNotMatch(
    queries[0].sql,
    /content_envelope|author_id|external_message_id/u,
  );
});
