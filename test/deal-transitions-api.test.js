import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { DealConflictError } from '../modules/deals-pipeline/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

function harness() {
  /** @type {Array<{input: any, operation: string}>} */
  const calls = [];
  const deals = {
    /** @param {any} input */
    async authorize(input) {
      calls.push({ input, operation: 'authorize' });
      return {
        actor: {
          functionName: 'Vendedor',
          id: 'seller-1',
          kind: 'human',
        },
      };
    },
    /** @param {any} input */
    async transitionDeal(input) {
      calls.push({ input, operation: 'transition' });
      if (input.expectedVersion === 9) throw new DealConflictError();
      return {
        deal: { id: input.dealId, stage: 'especificacao', version: 2 },
        gate: {
          blockers: [],
          dealId: input.dealId,
          fromStage: 'produto',
          version: input.expectedVersion,
        },
      };
    },
    /** @param {any} input */
    async loseDeal(input) {
      calls.push({ input, operation: 'lose' });
      return { deal: { id: input.dealId, status: 'lost', version: 2 } };
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

/** @param {string} url @param {any} payload @returns {import('light-my-request').InjectOptions} */
function request(url, payload) {
  return {
    headers: {
      cookie: 'crm_session=session; crm_csrf=csrf',
      'idempotency-key': 'deal-command-1',
      origin: 'https://crm.example.test',
      'x-correlation-id': 'correlation-1',
      'x-csrf-token': 'csrf',
    },
    method: 'POST',
    payload,
    url,
  };
}

test('transition endpoint accepts only direction and expectedVersion', async () => {
  const { api, calls } = harness();
  const response = await api.inject(
    request('/api/v1/deals/deal-1/transitions', {
      direction: 'advance',
      expectedVersion: 1,
      reason: 'Gate validado',
    }),
  );
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].input.action, 'deal.transition');
  assert.equal(calls[1].input.direction, 'advance');

  const targetStage = await api.inject(
    request('/api/v1/deals/deal-1/transitions', {
      direction: 'advance',
      expectedVersion: 1,
      reason: 'Gate validado',
      targetStage: 'fechamento',
    }),
  );
  assert.equal(targetStage.statusCode, 400);
  await api.close();
});

test('lose endpoint requires a human-authenticated reason and maps conflicts', async () => {
  const { api, calls } = harness();
  const lost = await api.inject(
    request('/api/v1/deals/deal-1/lose', {
      expectedVersion: 1,
      reason: 'Cliente desistiu',
    }),
  );
  assert.equal(lost.statusCode, 200);
  assert.equal(calls[0].input.action, 'deal.lose');
  assert.equal(calls[1].input.reason, 'Cliente desistiu');

  const conflict = await api.inject(
    request('/api/v1/deals/deal-1/transitions', {
      direction: 'advance',
      expectedVersion: 9,
      reason: 'Gate validado',
    }),
  );
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), { error: { code: 'DEAL_CONFLICT' } });
  await api.close();
});
