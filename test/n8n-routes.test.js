import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';

const technicalHeaders = Object.freeze({
  authorization: 'Basic dGVzdDp0ZXN0',
  'idempotency-key': 'wamid.synthetic.1',
  'x-correlation-id': '10000000-0000-4000-8000-000000000001',
  'x-request-id': '10000000-0000-4000-8000-000000000002',
  'x-silmer-execution-id': 'execution-synthetic-1',
  'x-silmer-workflow-key': 'silmer-whatsapp',
  'x-silmer-workflow-version': '98f96069-ede2-4900-aa5c-7fec0d3b80cb',
});

function harness() {
  /** @type {Array<{method: string, input: Record<string, unknown>}>} */
  const calls = [];
  const integration = Object.fromEntries(
    ['claimAiTurn', 'receiveInbound', 'recordEvent', 'storeAttachment'].map(
      (method) => [
        method,
        async (/** @type {Record<string, unknown>} */ input) => {
          calls.push({ input, method });
          return { accepted: true, method };
        },
      ],
    ),
  );
  const api = createApi(
    {},
    {
      automationAuth: {
        async authorize(/** @type {Record<string, unknown>} */ input) {
          assert.equal(
            input.correlationId,
            technicalHeaders['x-correlation-id'],
          );
          return { actor: 'AUTOMATION_EXECUTOR', credentialVersion: 1 };
        },
      },
      n8n: integration,
    },
  );
  return { api, calls };
}

test('n8n inbound route authenticates the technical envelope and forwards the DTO', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  const response = await api.inject({
    headers: technicalHeaders,
    method: 'POST',
    payload: {
      channel: 'whatsapp',
      contact: { name: 'Synthetic', wa_id: '5511000000000' },
      event_id: 'wamid.synthetic.1',
      message: {
        external_id: 'wamid.synthetic.1',
        text: 'synthetic',
        type: 'text',
      },
      metadata: { phone_number_id: 'phone-synthetic' },
      occurred_at: '2026-09-07T12:00:00.000Z',
      schema_version: '1.0',
    },
    url: '/api/v1/integrations/n8n/messages/inbound',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'receiveInbound');
  assert.deepEqual(calls[0].input.technical, {
    actor: 'AUTOMATION_EXECUTOR',
    correlationId: technicalHeaders['x-correlation-id'],
    credentialVersion: 1,
    executionId: technicalHeaders['x-silmer-execution-id'],
    idempotencyKey: technicalHeaders['idempotency-key'],
    requestId: technicalHeaders['x-request-id'],
    workflowKey: technicalHeaders['x-silmer-workflow-key'],
    workflowVersion: technicalHeaders['x-silmer-workflow-version'],
  });
});

test('n8n boundary rejects a missing technical header as problem+json without echoing input', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  const headers = { ...technicalHeaders };
  Reflect.deleteProperty(headers, 'x-silmer-execution-id');
  const response = await api.inject({
    headers,
    method: 'POST',
    payload: {
      channel: 'whatsapp',
      contact: { wa_id: '5511999999999' },
      event_id: 'private-canary',
      message: {
        external_id: 'private-canary',
        text: 'private-canary',
        type: 'text',
      },
      metadata: { phone_number_id: 'phone-synthetic' },
      occurred_at: '2026-09-07T12:00:00.000Z',
      schema_version: '1.0',
    },
    url: '/api/v1/integrations/n8n/messages/inbound',
  });

  assert.equal(response.statusCode, 400);
  assert.match(
    String(response.headers['content-type']),
    /^application\/problem\+json/u,
  );
  const problem = response.json();
  assert.equal(problem.accepted, false);
  assert.equal(problem.error.code, 'INVALID_X_SILMER_EXECUTION_ID');
  assert.equal(JSON.stringify(problem).includes('private-canary'), false);
  assert.equal(calls.length, 0);
});

test('n8n events route rejects event types outside the v1 allowlist', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  const response = await api.inject({
    headers: technicalHeaders,
    method: 'POST',
    payload: {
      conversation_id: 'conversation-synthetic',
      event_id: 'event-synthetic',
      event_type: 'message.retried',
      occurred_at: '2026-09-07T12:00:00.000Z',
      schema_version: '1.0',
    },
    url: '/api/v1/integrations/n8n/events',
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'UNSUPPORTED_EVENT_TYPE');
  assert.equal(calls.length, 0);
});
