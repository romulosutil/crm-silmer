import assert from 'node:assert/strict';
import test from 'node:test';

import { createDealApiRuntime } from '../apps/api/src/deal-runtime.js';
import { createServerApi } from '../apps/api/src/server.js';

const DATABASE = Object.freeze({
  query: async () => ({ rows: [] }),
  /** @param {(client: any) => Promise<any>} work */
  transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
});

function harness() {
  /** @type {Array<{input: any, operation: string}>} */
  const calls = [];
  const automationActor = {
    id: 'AUTOMATION_EXECUTOR',
    kind: 'AUTOMATION_EXECUTOR',
  };
  const humanActor = {
    functionName: 'Vendedor',
    id: 'user-seller-1',
    kind: 'human',
  };
  const runtime = createDealApiRuntime(
    {
      query: async () => ({ rows: [] }),
      /** @param {(client: any) => Promise<any>} work */
      transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
    },
    {
      automationAuth: {
        /** @param {any} input */
        async authorize(input) {
          calls.push({ input, operation: 'automation' });
          return { actor: automationActor };
        },
      },
      environment: {
        DEAL_ENVELOPE_KEY: Buffer.alloc(32, 46).toString('base64url'),
        IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 45).toString('base64url'),
        QUALIFICATION_ENVELOPE_KEY: Buffer.alloc(32, 47).toString('base64url'),
      },
      identity: {
        allowedOrigins: ['https://crm.example.test'],
        /** @param {any} input */
        async authorizeOperational(input) {
          calls.push({ input, operation: 'human' });
          return { actor: humanActor };
        },
      },
    },
  );
  return { calls, runtime };
}

test('deal runtime authorizes Basic automation or Origin/CSRF human sessions', async () => {
  const { calls, runtime } = harness();
  const automation = await runtime.authorize({
    action: 'conversation.convert',
    authorization: 'Basic opaque',
    correlationId: 'correlation-automation',
  });
  assert.equal(automation.actor.kind, 'AUTOMATION_EXECUTOR');
  assert.equal(calls[0].input.action, 'conversation.convert');

  const human = await runtime.authorize({
    action: 'conversation.convert',
    cookie: 'crm_session=session; crm_csrf=csrf',
    correlationId: 'correlation-human',
    csrfToken: 'csrf',
    origin: 'https://crm.example.test',
  });
  assert.equal(human.actor.kind, 'human');
  assert.deepEqual(calls[1], {
    input: {
      action: 'conversation.convert',
      csrfToken: 'csrf',
      sessionToken: 'session',
    },
    operation: 'human',
  });
});

test('deal runtime rejects invalid Origin, CSRF and ambiguous cookies', async () => {
  for (const input of [
    {
      action: 'conversation.convert',
      cookie: 'crm_session=session; crm_csrf=csrf',
      csrfToken: 'csrf',
      origin: 'https://evil.example.test',
    },
    {
      action: 'conversation.convert',
      cookie: 'crm_session=session; crm_csrf=csrf',
      csrfToken: 'other',
      origin: 'https://crm.example.test',
    },
    {
      action: 'conversation.convert',
      cookie: 'crm_session=one; crm_session=two; crm_csrf=csrf',
      csrfToken: 'csrf',
      origin: 'https://crm.example.test',
    },
  ]) {
    const { calls, runtime } = harness();
    await assert.rejects(
      runtime.authorize(input),
      (error) =>
        Number(/** @type {{statusCode?: unknown}} */ (error)?.statusCode) >=
        400,
    );
    assert.equal(calls.length, 0);
  }
});

test('server rejects a partially configured Deal runtime', () => {
  assert.throws(
    () =>
      createServerApi({
        database: DATABASE,
        environment: {
          IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 45).toString('base64url'),
        },
      }),
    /IDEMPOTENCY_ENVELOPE_KEY, DEAL_ENVELOPE_KEY and QUALIFICATION_ENVELOPE_KEY together/u,
  );
});
