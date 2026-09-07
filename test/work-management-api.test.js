import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

function headers() {
  return {
    cookie: 'crm_session=session; crm_csrf=csrf',
    'idempotency-key': 'work-api-key',
    origin: 'https://crm.example.test',
    'x-csrf-token': 'csrf',
  };
}

test('exposes closed human assignment/task lifecycle and handoff contracts', async () => {
  /** @type {any[]} */
  const calls = [];
  const deals = {
    async authorize(/** @type {any} */ input) {
      calls.push(['authorize', input]);
      return {
        actor: { functionName: 'Vendedor', id: 'seller-1', kind: 'human' },
      };
    },
    async assignDeal(/** @type {any} */ input) {
      calls.push(['assign', input]);
      return { deal: { id: input.dealId, version: 2 } };
    },
    async createHandoff(/** @type {any} */ input) {
      calls.push(['handoff', input]);
      return {
        handoff: { id: 'handoff-1', version: 1 },
        task: { id: 'task-1' },
      };
    },
    async startTask(/** @type {any} */ input) {
      calls.push(['start', input]);
      return { task: { id: input.taskId, status: 'in_progress', version: 2 } };
    },
  };
  const api = createApi(
    {},
    {
      deals,
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
    },
  );

  const assigned = await api.inject({
    headers: headers(),
    method: 'POST',
    payload: {
      assignedUserId: 'seller-1',
      expectedDealVersion: 1,
      reasonCode: 'manual_assignment',
    },
    url: '/api/v1/deals/deal-1/assign',
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal(
    calls.find(([kind]) => kind === 'authorize')[1].action,
    'deal.assign',
  );

  const handoff = await api.inject({
    headers: { ...headers(), authorization: 'Basic credential' },
    method: 'POST',
    payload: {
      assignedUserId: 'seller-1',
      automationContext: {
        executionId: 'execution-1',
        workflowKey: 'seller-workflow',
        workflowVersion: 'v1',
      },
      automationEpoch: 2,
      conversationId: 'conversation-1',
      expectedConversationVersion: 3,
      expectedDealVersion: 1,
      reasonCode: 'unresolved_blocker',
      summary: 'Resumo cifrado no domínio',
    },
    url: '/api/v1/deals/deal-1/handoffs',
  });
  assert.equal(handoff.statusCode, 201);
  assert.equal(handoff.headers.location, '/api/v1/handoffs/handoff-1');
  assert.equal(
    calls.find(([kind]) => kind === 'handoff')[1].automationEpoch,
    2,
  );

  const started = await api.inject({
    headers: headers(),
    method: 'POST',
    payload: { expectedTaskVersion: 1, reasonCode: 'task_started' },
    url: '/api/v1/tasks/task-1/start',
  });
  assert.equal(started.statusCode, 200);

  const unknown = await api.inject({
    headers: headers(),
    method: 'POST',
    payload: {
      assignedUserId: 'seller-1',
      expectedDealVersion: 1,
      reasonCode: 'manual_assignment',
      targetStage: 'fechamento',
    },
    url: '/api/v1/deals/deal-1/assign',
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(calls.filter(([kind]) => kind === 'assign').length, 1);
  await api.close();
});
