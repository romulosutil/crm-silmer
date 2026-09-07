import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { DealConflictError } from '../modules/deals-pipeline/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

/** @param {{conflict?: boolean, deny?: boolean, unavailable?: boolean}} [options] */
function harness(options = {}) {
  /** @type {Array<{input: any, operation: string}>} */
  const calls = [];
  const deals = {
    /** @param {any} input */
    async authorize(input) {
      calls.push({ input, operation: 'authorize' });
      if (options.deny) {
        const error = new Error('FORBIDDEN');
        Object.assign(error, { code: 'FORBIDDEN', statusCode: 403 });
        throw error;
      }
      if (options.unavailable) {
        const error = new Error('database details must stay private');
        Object.assign(error, {
          code: 'AUTOMATION_AUTH_UNAVAILABLE',
          statusCode: 503,
        });
        throw error;
      }
      return {
        actor: {
          functionName: 'Atendimento',
          id: 'user-attendant-1',
          kind: 'human',
        },
      };
    },
    /** @param {any} input */
    async convertConversation(input) {
      calls.push({ input, operation: 'convert' });
      if (options.conflict) throw new DealConflictError('stale version');
      return {
        contact: { id: 'contact-1', provisional: false, version: 2 },
        conversation: {
          id: input.conversationId,
          state: 'convertida_em_lead',
          version: input.expectedVersion + 1,
        },
        deal: {
          contactId: 'contact-1',
          id: 'deal-1',
          sourceConversationId: input.conversationId,
          stage: 'produto',
          version: 1,
        },
      };
    },
  };
  const api = createApi(
    {},
    {
      deals,
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
    },
  );
  return { api, calls };
}

const validRequest = Object.freeze({
  headers: {
    authorization: 'Basic c2lsbWVyLW44bjpzZWNyZXQ=',
    'idempotency-key': 'convert-request-1',
    'x-correlation-id': 'correlation-api-1',
  },
  method: 'POST',
  payload: {
    expectedVersion: 3,
    reason: 'Intenção comercial confirmada',
  },
  url: '/api/v1/conversations/conversation-1/convert',
});

test('conversion endpoint authenticates before creating the Produto deal', async () => {
  const { api, calls } = harness();

  const response = await api.inject(validRequest);

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers.location, '/api/v1/deals/deal-1');
  assert.deepEqual(response.json().deal, {
    contactId: 'contact-1',
    id: 'deal-1',
    sourceConversationId: 'conversation-1',
    stage: 'produto',
    version: 1,
  });
  assert.equal(calls[0].operation, 'authorize');
  assert.equal(calls[0].input.action, 'conversation.convert');
  assert.equal(calls[1].operation, 'convert');
  assert.equal(calls[1].input.idempotencyKey, 'convert-request-1');
  assert.equal(calls[1].input.actor.id, 'user-attendant-1');
  await api.close();
});

test('conversion endpoint fails closed on missing key, denied actor and conflict', async () => {
  const missingKeyHarness = harness();
  const missingKey = await missingKeyHarness.api.inject({
    ...validRequest,
    headers: { authorization: validRequest.headers.authorization },
  });
  assert.equal(missingKey.statusCode, 400);
  assert.deepEqual(missingKey.json(), {
    error: { code: 'INVALID_IDEMPOTENCY_KEY' },
  });
  assert.equal(missingKeyHarness.calls.length, 0);
  await missingKeyHarness.api.close();

  const unknownFieldHarness = harness();
  const unknownField = await unknownFieldHarness.api.inject({
    ...validRequest,
    payload: { ...validRequest.payload, targetStage: 'fechamento' },
  });
  assert.equal(unknownField.statusCode, 400);
  assert.deepEqual(unknownField.json(), {
    error: { code: 'INVALID_REQUEST' },
  });
  assert.equal(unknownFieldHarness.calls.length, 0);
  await unknownFieldHarness.api.close();

  const deniedHarness = harness({ deny: true });
  const denied = await deniedHarness.api.inject(validRequest);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { error: { code: 'FORBIDDEN' } });
  assert.equal(deniedHarness.calls.length, 1);
  await deniedHarness.api.close();

  const conflictHarness = harness({ conflict: true });
  const conflict = await conflictHarness.api.inject(validRequest);
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), { error: { code: 'DEAL_CONFLICT' } });
  await conflictHarness.api.close();

  const unavailableHarness = harness({ unavailable: true });
  const unavailable = await unavailableHarness.api.inject(validRequest);
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), {
    error: { code: 'SERVICE_UNAVAILABLE' },
  });
  assert.doesNotMatch(unavailable.body, /database details/iu);
  await unavailableHarness.api.close();
});
