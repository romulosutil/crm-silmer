import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

test('PATCH Deal fields uses the authorized closed idempotent contract', async () => {
  /** @type {any[]} */
  const calls = [];
  const api = createApi(
    {},
    {
      deals: {
        /** @param {any} input */
        async authorize(input) {
          calls.push(['authorize', input]);
          return {
            actor: { functionName: 'Vendedor', id: 'seller-1', kind: 'human' },
          };
        },
        /** @param {any} input */
        async patchFields(input) {
          calls.push(['patch', input]);
          return {
            deal: { id: input.dealId, stage: 'produto', version: 2 },
            readiness: {},
            totalQuantity: 10,
          };
        },
      },
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
    },
  );
  /** @type {import('light-my-request').InjectOptions} */
  const request = {
    headers: {
      cookie: 'crm_session=session; crm_csrf=csrf',
      'idempotency-key': 'qualification-api-1',
      origin: 'https://crm.example.test',
      'x-csrf-token': 'csrf',
    },
    method: 'PATCH',
    payload: {
      expectedVersion: 1,
      fields: {
        order: { commercialIntent: true, customer: 'Cliente', name: 'Pedido' },
      },
      reasonCode: 'customer_update',
    },
    url: '/api/v1/deals/deal-1/fields',
  };
  const response = await api.inject(request);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().totalQuantity, 10);
  assert.equal(calls[0][1].action, 'deal.fields.patch');
  assert.equal(calls[1][1].fields.order.customer, 'Cliente');

  const unknown = await api.inject({
    .../** @type {any} */ (request),
    payload: {
      .../** @type {Record<string, any>} */ (request.payload),
      targetStage: 'fechamento',
    },
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(calls.length, 2);

  const missingReasonCode = await api.inject({
    .../** @type {any} */ (request),
    payload: {
      expectedVersion: 1,
      fields: { order: { name: 'Pedido' } },
    },
  });
  assert.equal(missingReasonCode.statusCode, 400);
  assert.equal(calls.filter(([kind]) => kind === 'patch').length, 1);
  await api.close();
});
