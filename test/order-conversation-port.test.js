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
              sent_at: '2026-10-03T10:05:00.000Z',
            },
            {
              conversation_id: 'conversation-2',
              direction: 'outbound',
              status: 'sent',
              delivery_status: 'read',
              occurred_at: '2026-10-01T10:00:00.000Z',
              // The command completed after queueing; a later read receipt
              // must not replace this confirmed send time.
              sent_at: '2026-10-03T09:00:00.000Z',
            },
            {
              conversation_id: 'conversation-3',
              direction: 'outbound',
              status: 'sent',
              delivery_status: 'read',
              occurred_at: '2026-10-01T10:00:00.000Z',
              // Legacy receipt with no retained send proof stays unknown.
              sent_at: null,
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(await port.readLatestMessageStates([]), new Map());
  const ids = ['conversation-1', 'conversation-2', 'conversation-3'];
  assert.deepEqual(
    await port.readLatestMessageStates(ids),
    new Map([
      [
        'conversation-1',
        {
          direction: 'outbound',
          occurredAt: '2026-10-03T10:00:00.000Z',
          sentAt: '2026-10-03T10:05:00.000Z',
          deliveryStatus: 'failed',
          status: 'sent',
        },
      ],
      [
        'conversation-2',
        {
          direction: 'outbound',
          occurredAt: '2026-10-01T10:00:00.000Z',
          sentAt: '2026-10-03T09:00:00.000Z',
          deliveryStatus: 'read',
          status: 'sent',
        },
      ],
      [
        'conversation-3',
        {
          direction: 'outbound',
          occurredAt: '2026-10-01T10:00:00.000Z',
          sentAt: null,
          deliveryStatus: 'read',
          status: 'sent',
        },
      ],
    ]),
  );
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [ids]);
  assert.match(queries[0].sql, /DISTINCT ON \(message\.conversation_id\)/u);
  assert.match(queries[0].sql, /message\.sent_at/u);
  assert.doesNotMatch(
    queries[0].sql,
    /send_command\.completed_at|message\.delivery_status_at/u,
  );
  assert.doesNotMatch(
    queries[0].sql,
    /content_envelope|author_id|external_message_id/u,
  );
});
