import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createN8nCommandJobHandler,
  createN8nCommandDeliveryClient,
  canonicalJsonStringify,
  N8nCommandDeliveryError,
  reconcileN8nCommandOutcome,
  sha256Hex,
} from '../modules/integration-reliability/src/index.js';

const COMMAND_ID = 'e8c63771-08dd-42c4-9053-ab3c82fd7377';

function job() {
  return Object.freeze({
    attemptId: 'attempt-1',
    id: 'job-1',
    idempotencyKey: COMMAND_ID,
  });
}

function storeFixture() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    async loadForDelivery(
      /** @type {string} */ commandId,
      /** @type {Record<string, unknown>} */ context,
    ) {
      calls.push(['load', commandId, context]);
      return {
        commandId,
        payload: { action: 'send_message', command_id: commandId },
        payloadHash: 'a'.repeat(64),
      };
    },
    async markDelivered(
      /** @type {string} */ commandId,
      /** @type {Record<string, unknown>} */ context,
    ) {
      calls.push(['delivered', commandId, context]);
    },
    async markFailed(
      /** @type {string} */ commandId,
      /** @type {Record<string, unknown>} */ context,
    ) {
      calls.push(['failed', commandId, context]);
    },
    async markOutcomeUnknown(
      /** @type {string} */ commandId,
      /** @type {Record<string, unknown>} */ context,
    ) {
      calls.push(['unknown', commandId, context]);
    },
    async markProcessing(
      /** @type {string} */ commandId,
      /** @type {Record<string, unknown>} */ context,
    ) {
      calls.push(['processing', commandId, context]);
    },
  };
}

test('delivers after loading immutable payload and marking the effect boundary', async () => {
  const store = storeFixture();
  /** @type {string[]} */
  const effects = [];
  const handler = createN8nCommandJobHandler({
    client: {
      prepareDelivery(/** @type {any} */ command) {
        assert.equal(command.commandId, COMMAND_ID);
        return {
          async execute() {
            effects.push('request');
            return {
              duplicate: false,
              providerExternalId: 'wamid.opaque',
              statusCode: 202,
            };
          },
          payloadHash: command.payloadHash,
        };
      },
    },
    commandStore: store,
  });

  const result = await handler(job(), {
    async markEffectStarted() {
      effects.push('boundary');
      return true;
    },
  });

  assert.deepEqual(result, {
    outcome: 'sent',
    providerExternalId: 'wamid.opaque',
  });
  assert.deepEqual(
    store.calls.map((call) => call[0]),
    ['load', 'processing', 'delivered'],
  );
  assert.deepEqual(effects, ['boundary', 'request']);
});

test('timeout before the point of no return is a safe retry', async () => {
  const store = storeFixture();
  let effectStarted = false;
  const handler = createN8nCommandJobHandler({
    client: {
      prepareDelivery() {
        throw new N8nCommandDeliveryError('N8N_COMMAND_TIMEOUT', {
          retryable: true,
        });
      },
    },
    commandStore: store,
  });

  const result = await handler(job(), {
    async markEffectStarted() {
      effectStarted = true;
      return true;
    },
  });

  assert.deepEqual(result, {
    errorCode: 'N8N_COMMAND_TIMEOUT',
    outcome: 'failed',
    retryable: true,
    retrySafe: true,
  });
  assert.equal(effectStarted, false);
  assert.deepEqual(
    store.calls.map((call) => call[0]),
    ['load', 'failed'],
  );
});

test('timeout after the point of no return becomes outcome_unknown', async () => {
  const store = storeFixture();
  const handler = createN8nCommandJobHandler({
    client: {
      prepareDelivery(/** @type {any} */ command) {
        return {
          async execute() {
            throw new N8nCommandDeliveryError('N8N_COMMAND_TIMEOUT', {
              retryable: true,
              retrySafe: false,
            });
          },
          payloadHash: command.payloadHash,
        };
      },
    },
    commandStore: store,
  });

  const result = await handler(job(), {
    async markEffectStarted() {
      return true;
    },
  });

  assert.deepEqual(result, {
    errorCode: 'N8N_COMMAND_TIMEOUT',
    outcome: 'outcome_unknown',
    retryable: false,
    retrySafe: false,
  });
  assert.deepEqual(
    store.calls.map((call) => call[0]),
    ['load', 'processing', 'unknown'],
  );
});

test('partial HTTP acknowledgement settles the command as unknown without resending', async () => {
  const store = storeFixture();
  const payload = { action: 'send_message', command_id: COMMAND_ID };
  const payloadHash = sha256Hex(canonicalJsonStringify(payload));
  store.loadForDelivery = async (commandId, context) => {
    store.calls.push(['load', commandId, context]);
    return { commandId, payload, payloadHash };
  };
  let calls = 0;
  const client = createN8nCommandDeliveryClient({
    clientId: 'synthetic-local',
    clientSecret: 'synthetic-secret',
    endpoint: 'https://n8n.example.test/webhook/silmer/panel-command',
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      calls += 1;
      return {
        status: 202,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('private-remote-data'), {
                    name: 'AbortError',
                  }),
                ),
              { once: true },
            );
          }),
      };
    },
  });
  const handler = createN8nCommandJobHandler({ client, commandStore: store });
  assert.deepEqual(
    await handler(job(), { markEffectStarted: async () => true }),
    {
      errorCode: 'N8N_COMMAND_TIMEOUT',
      outcome: 'outcome_unknown',
      retryable: false,
      retrySafe: false,
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    store.calls.map((call) => call[0]),
    ['load', 'processing', 'unknown'],
  );
  assert.equal(store.calls.at(-1)[2].errorCode, 'N8N_COMMAND_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(store.calls), /private-remote-data/);
});

test('remote reservation proof permits replay with the same command', async () => {
  const store = storeFixture();
  const handler = createN8nCommandJobHandler({
    client: {
      prepareDelivery(/** @type {any} */ command) {
        return {
          async execute() {
            throw new N8nCommandDeliveryError(
              'N8N_COMMAND_REMOTE_UNAVAILABLE',
              { retryable: true, retrySafe: true },
            );
          },
          payloadHash: command.payloadHash,
        };
      },
    },
    commandStore: store,
  });

  const result = await handler(job(), {
    async markEffectStarted() {
      return true;
    },
  });
  assert.deepEqual(result, {
    errorCode: 'N8N_COMMAND_REMOTE_UNAVAILABLE',
    outcome: 'failed',
    retryable: true,
    retrySafe: true,
  });
  assert.equal(store.calls.at(-1)[0], 'failed');
});

test('manual reconciliation records evidence without another external call', async () => {
  const store = storeFixture();
  await reconcileN8nCommandOutcome({
    commandId: COMMAND_ID,
    commandStore: store,
    outcome: 'sent',
    providerExternalId: 'wamid.reconciled',
    reconciledBy: 'operator-opaque-id',
  });
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0][0], 'delivered');
  assert.equal(store.calls[0][2].source, 'manual_reconciliation');
});

test('store receives only technical error code, never thrown PII', async () => {
  const store = storeFixture();
  const handler = createN8nCommandJobHandler({
    client: {
      prepareDelivery(/** @type {any} */ command) {
        return {
          async execute() {
            const error = Object.assign(
              new Error('cliente@example.test +55 27 99999-9999'),
              { code: 'telefone +55 27 99999-9999' },
            );
            throw error;
          },
          payloadHash: command.payloadHash,
        };
      },
    },
    commandStore: store,
  });
  await handler(job(), { markEffectStarted: async () => true });
  const serialized = JSON.stringify(store.calls);
  assert.doesNotMatch(serialized, /cliente|99999/iu);
  assert.match(serialized, /N8N_COMMAND_DELIVERY_FAILED/u);
});
