import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import {
  STORE_ORDER_REQUESTS_PER_MINUTE,
  STORE_ORDERS_PATH,
} from '../apps/api/src/store-order-routes.js';

// ADR 028: the n8n route that records a paid store order is capped per
// minute, before the automation credential is checked.

const REQUEST_ID = '5b0c77ed-8c90-46ce-97a4-d5fc1e0a9308';

function harness() {
  let authorizations = 0;
  let records = 0;
  const api = createApi(
    {},
    {
      automationAuth: {
        authorize: async () => {
          authorizations += 1;
          return {
            actor: { id: 'n8n-sintetico' },
            credentialVersion: 'current',
          };
        },
      },
      storeOrders: /** @type {any} */ ({
        record: async () => {
          records += 1;
          return { body: { accepted: true }, statusCode: 201 };
        },
      }),
    },
  );
  return {
    api,
    counts: () => ({ authorizations, records }),
  };
}

/** @param {import('fastify').FastifyInstance} api */
function post(api) {
  return api.inject({
    headers: {
      authorization: 'Basic c2ludGV0aWNvOnNpbnRldGljbw==',
      'content-type': 'application/json',
      'idempotency-key': REQUEST_ID,
      'x-correlation-id': REQUEST_ID,
      'x-silmer-execution-id': '48213',
      'x-silmer-workflow-key': 'silmer-loja-checkout-infinitepay',
      'x-silmer-workflow-version': 'loja-checkout-1',
    },
    method: 'POST',
    payload: '{}',
    url: STORE_ORDERS_PATH,
  });
}

test('the paid-order route answers 429 RATE_LIMITED past its cap per minute, before the credential', async () => {
  const { api, counts } = harness();
  for (let index = 0; index < STORE_ORDER_REQUESTS_PER_MINUTE; index += 1) {
    const response = await post(api);
    assert.equal(response.statusCode, 201, response.body);
  }
  const limited = await post(api);
  assert.equal(limited.statusCode, 429);
  assert.match(
    String(limited.headers['content-type']),
    /^application\/problem\+json/u,
  );
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  assert.equal(limited.headers['retry-after'], '1');
  assert.equal(limited.headers['cache-control'], 'no-store');
  // The refused call never reached the authorization nor the record.
  assert.deepEqual(counts(), {
    authorizations: STORE_ORDER_REQUESTS_PER_MINUTE,
    records: STORE_ORDER_REQUESTS_PER_MINUTE,
  });
  await api.close();
});
