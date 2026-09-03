import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PostgresOutboundMessageOutbox } from '../modules/integration-reliability/src/index.js';

const AVAILABLE_AT = '2026-09-02T12:00:00.000Z';

test('enqueues a channel message with reliability-owned defaults on the supplied transaction', async () => {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const calls = [];
  const transaction = {
    query: async (
      /** @type {string} */ sql,
      /** @type {unknown[]} */ values = [],
    ) => {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const outbox = new PostgresOutboundMessageOutbox();

  await outbox.enqueueChannelMessage(
    {
      availableAt: AVAILABLE_AT,
      id: 'job-1',
      idempotencyKey: 'send-1',
      messageId: 'message-1',
    },
    { transaction },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO crm\.outbox_jobs/u);
  assert.match(calls[0].sql, /'channel_message\.send'/u);
  assert.match(calls[0].sql, /'channel-outbound'/u);
  assert.match(calls[0].sql, /'manual'/u);
  assert.match(calls[0].sql, /\b100\b/u);
  assert.match(calls[0].sql, /\b8\b/u);
  assert.deepEqual(calls[0].values, [
    'job-1',
    'send-1',
    AVAILABLE_AT,
    'message-1',
  ]);
});

test('rejects enqueue without the caller transaction', async () => {
  const outbox = new PostgresOutboundMessageOutbox();
  const input = {
    availableAt: AVAILABLE_AT,
    id: 'job-1',
    idempotencyKey: 'send-1',
    messageId: 'message-1',
  };

  await assert.rejects(
    outbox.enqueueChannelMessage(input, {}),
    /transaction.*required/iu,
  );
});

test('keeps the reliability outbox table private from inbox-channels', async () => {
  const source = await readFile(
    new URL(
      '../modules/inbox-channels/src/adapters/postgres-inbox-repository.js',
      import.meta.url,
    ),
    'utf8',
  );

  assert.doesNotMatch(source, /crm\.outbox_jobs/u);
});
