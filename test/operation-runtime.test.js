import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperationReadService } from '../apps/api/src/operation-runtime.js';

/** @param {Array<Record<string, unknown>>} rows */
function liveService(rows) {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const queries = [];
  const service = createOperationReadService({
    contactRepository: {},
    cursorKey: Buffer.alloc(32, 1),
    database: {
      query: async (
        /** @type {string} */ sql,
        /** @type {unknown[]} */ values,
      ) => {
        queries.push({ sql, values });
        return { rows };
      },
    },
    handoffRepository: {},
    inboxRepository: {},
  });
  return { queries, service };
}

test('live events keep contact and conversation changes as they were', async () => {
  const { queries, service } = liveService([
    {
      aggregate_id: 'contact-1',
      aggregate_type: 'contact',
      payload: { contactId: 'contact-1' },
      stream_cursor: '7',
    },
    {
      aggregate_id: 'conversation-1',
      aggregate_type: 'conversation',
      payload: { anything: 'ignored' },
      stream_cursor: '8',
    },
  ]);
  const batch = await service.readLiveEvents({ after: '6' });
  assert.deepEqual(batch, {
    cursor: 8,
    events: [
      {
        cursor: 7,
        payload: { contactId: 'contact-1' },
        type: 'inbox.contact.changed',
      },
      {
        cursor: 8,
        payload: { conversationId: 'conversation-1' },
        type: 'inbox.conversation.changed',
      },
    ],
    reset: false,
  });
  assert.deepEqual(queries[0].values, [6]);
});

test('an order change streams as inbox.order.changed with its conversation', async () => {
  const { queries, service } = liveService([
    {
      aggregate_id: 'order-1',
      aggregate_type: 'order',
      payload: { conversationId: 'conversation-9', orderId: 'order-1' },
      stream_cursor: '12',
    },
  ]);
  const batch = await service.readLiveEvents({ after: '11' });
  assert.deepEqual(batch.events, [
    {
      cursor: 12,
      payload: { conversationId: 'conversation-9', orderId: 'order-1' },
      type: 'inbox.order.changed',
    },
  ]);
  assert.match(queries[0].sql, /aggregate_type IN \([^)]*'order'[^)]*\)/u);
  assert.match(queries[0].sql, /\bpayload\b/u);
});

test('an order event never forwards more than its identifiers', async () => {
  const { service } = liveService([
    {
      aggregate_id: 'order-2',
      aggregate_type: 'order',
      payload: {
        conversationId: 'conversation-2',
        customer: 'PII-canary',
        orderId: 'order-2',
      },
      stream_cursor: '3',
    },
  ]);
  const batch = await service.readLiveEvents({ after: '2' });
  assert.deepEqual(batch.events[0].payload, {
    conversationId: 'conversation-2',
    orderId: 'order-2',
  });
});
