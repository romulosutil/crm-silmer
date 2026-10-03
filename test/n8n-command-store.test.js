import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresN8nCommandStore } from '../modules/n8n-integration/src/postgres-command-store.js';

function harness() {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const queries = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {unknown[]} */ values) {
      queries.push({ sql, values });
      if (
        sql.includes('FROM crm.n8n_commands WHERE command_id = $1 FOR UPDATE')
      ) {
        return {
          rows: [
            {
              command_id: 'command-1',
              locked_by: 'attempt-1',
              message_id: 'message-1',
              status: 'processing',
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const store = new PostgresN8nCommandStore({
    database: {
      query: client.query.bind(client),
      transaction: (/** @type {(client: any) => Promise<unknown>} */ work) =>
        work(client),
    },
    envelopeKey: Buffer.alloc(32),
  });
  return { queries, store };
}

test('human send completion records only the first confirmed send time', async () => {
  const { queries, store } = harness();
  const now = new Date('2026-10-03T10:00:00.000Z');
  assert.equal(
    await store.markDelivered('command-1', {
      attemptId: 'attempt-1',
      now,
      providerExternalId: 'wamid.sent-1',
    }),
    true,
  );
  const messageUpdate = queries.find(({ sql }) =>
    sql.startsWith('UPDATE crm.messages'),
  );
  assert.ok(messageUpdate);
  assert.match(messageUpdate.sql, /COALESCE\(sent_at, \$5\)/u);
  assert.match(messageUpdate.sql, /WHEN \$3 = 'sent'/u);
  assert.deepEqual(messageUpdate.values, [
    'message-1',
    'wamid.sent-1',
    'sent',
    'sent',
    now,
  ]);
});

test('failed human send leaves the confirmed send clock unset', async () => {
  const { queries, store } = harness();
  assert.equal(
    await store.markFailed('command-1', {
      attemptId: 'attempt-1',
      errorCode: 'N8N_SEND_FAILED',
      now: '2026-10-03T10:00:00.000Z',
    }),
    true,
  );
  const messageUpdate = queries.find(({ sql }) =>
    sql.startsWith('UPDATE crm.messages'),
  );
  assert.ok(messageUpdate);
  assert.match(messageUpdate.sql, /WHEN \$3 = 'sent'.*ELSE sent_at END/su);
  assert.equal(messageUpdate.values[2], 'failed');
});
