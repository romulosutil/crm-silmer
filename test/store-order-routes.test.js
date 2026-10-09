import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import {
  AutomationAuthError,
  createAutomationAuthRuntime,
} from '../apps/api/src/automation-auth-runtime.js';
import { STORE_ORDERS_PATH } from '../apps/api/src/store-order-routes.js';
import {
  createStoreOrderRuntime,
  createStoreOrdersForServer,
  readBaseUrl,
} from '../apps/api/src/store-order-runtime.js';
import { createSafeLogger } from '../modules/shared/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import {
  STORE_NOW,
  STORE_RECEIPT_URL,
  STORE_REQUEST_ID,
  otherStoreOrderBody,
  storeOrderBody,
} from './fixtures/store-order.js';

const CLIENT_ID = 'n8n-loja-sintetico';
const SECRET = 'segredo-sintetico-da-automacao-com-32-caracteres';
const BASE_URL = 'https://crm.example.test';

/** @param {string} id @param {string} secret */
function basic(id, secret) {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

/**
 * @param {{acceptTest?: boolean, appBaseUrl?: string, automationAuth?: any, repository?: any}} [options]
 */
function harness(options = {}) {
  const repository = options.repository ?? new InMemoryOrderRepository();
  /** @type {any[]} */
  const denials = [];
  /** @type {any[]} */
  const logs = [];
  let ids = 0;
  const storeOrders = createStoreOrderRuntime({
    appBaseUrl: options.appBaseUrl ?? BASE_URL,
    service: createStoreOrderService({
      acceptTest: options.acceptTest ?? true,
      clock: () => STORE_NOW,
      fabCode: '01',
      hmacKey: Buffer.alloc(32, 27),
      idFactory: () => `0c3e0e5a-0000-4000-8000-00000000000${(ids += 1)}`,
      repository,
    }),
  });
  const automationAuth =
    options.automationAuth ??
    createAutomationAuthRuntime({
      auditPort: { append: async (event) => void denials.push(event) },
      environment: {
        CRM_AUTOMATION_CLIENT_ID: CLIENT_ID,
        CRM_AUTOMATION_CLIENT_SECRET: SECRET,
      },
    });
  const api = createApi(
    {},
    {
      automationAuth,
      logger: createSafeLogger({
        service: 'crm-silmer-api',
        sink: (/** @type {any} */ entry) => logs.push(entry),
      }),
      storeOrders,
    },
  );
  return { api, denials, logs, repository };
}

/**
 * @param {import('fastify').FastifyInstance} api
 * @param {{body?: any, payload?: string, headers?: Record<string, string|null>}} [input]
 */
function post(api, input = {}) {
  const body = input.body ?? storeOrderBody();
  /** @type {Record<string, string>} */
  const headers = {
    authorization: basic(CLIENT_ID, SECRET),
    'content-type': 'application/json',
    'idempotency-key': body?.pedido_id ?? STORE_REQUEST_ID,
    'x-correlation-id': body?.pedido_id ?? STORE_REQUEST_ID,
    'x-silmer-execution-id': '48213',
    'x-silmer-workflow-key': 'silmer-loja-checkout-infinitepay',
    'x-silmer-workflow-version': 'loja-checkout-1',
  };
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  return api.inject({
    headers,
    method: 'POST',
    payload: input.payload ?? JSON.stringify(body),
    url: STORE_ORDERS_PATH,
  });
}

/** @param {any} response @param {number} status @param {string} code */
function assertProblem(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.match(
    String(response.headers['content-type']),
    /^application\/problem\+json/u,
  );
  const problem = response.json();
  assert.equal(problem.accepted, false);
  assert.equal(problem.status, status);
  assert.equal(problem.error.code, code);
  assert.deepEqual(Object.keys(problem.error), ['code']);
  // A problem never echoes the record.
  assert.doesNotMatch(
    response.body,
    /Cliente Sintetico|5527900000001|nsu-sintetico|recibo\.infinitepay/u,
  );
}

test('LOJ-15: the paid record creates the order and answers 201 with where to open it', async (t) => {
  const { api, repository } = harness();
  t.after(() => api.close());
  const response = await post(api);
  assert.equal(response.statusCode, 201, response.body);
  assert.match(String(response.headers['content-type']), /application\/json/u);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-correlation-id'], STORE_REQUEST_ID);
  const orderId = '0c3e0e5a-0000-4000-8000-000000000001';
  assert.deepEqual(response.json(), {
    comprovante_registrado: false,
    criado: true,
    ficha_url: `${BASE_URL}/api/v1/orders/${orderId}/print?download=1`,
    numero: '01-CRM',
    numero_loja: 'LJ-5B0C77ED',
    pedido_id: orderId,
    pedido_url: `${BASE_URL}/pedidos/${orderId}`,
  });
  assert.deepEqual(
    repository.audits().map((/** @type {any} */ audit) => audit.actor),
    ['AUTOMATION_EXECUTOR'],
  );
});

test('LOJ-17: a retry answers 200 with the same order; the receipt that arrives later is recorded', async (t) => {
  const { api, repository } = harness();
  t.after(() => api.close());
  const first = (await post(api)).json();
  const replay = await post(api);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), { ...first, criado: false });

  const withReceipt = await post(api, {
    body: storeOrderBody(
      (body) => (body.pagamento.receipt_url = STORE_RECEIPT_URL),
    ),
  });
  assert.equal(withReceipt.statusCode, 200);
  assert.deepEqual(withReceipt.json(), {
    ...first,
    comprovante_registrado: true,
    criado: false,
  });
  const order = await repository.findById(first.pedido_id);
  assert.equal(order?.ficha.loja?.comprovanteUrl, STORE_RECEIPT_URL);
  assert.deepEqual(
    repository.audits().map((/** @type {any} */ audit) => audit.action),
    ['store.order.create', 'store.order.receipt_attached'],
  );
});

test('LOJ-17: different data for the same pedido_id is 409 STORE_ORDER_CONFLICT', async (t) => {
  const { api } = harness();
  t.after(() => api.close());
  await post(api);
  assertProblem(
    await post(api, {
      body: storeOrderBody((body) => (body.item.tamanho_id = 'g')),
    }),
    409,
    'STORE_ORDER_CONFLICT',
  );
  assertProblem(
    await post(api, {
      body: otherStoreOrderBody(2, (body) => {
        body.pagamento.transaction_nsu = 'nsu-sintetico-0001';
      }),
    }),
    409,
    'STORE_ORDER_CONFLICT',
  );
});

test('LOJ-18/LOJ-19: catalog, amount, method and test refusals are 422 and record nothing', async (t) => {
  const { api, repository } = harness({ acceptTest: false });
  t.after(() => api.close());
  /** @type {Array<[(body: any) => void, string]>} */
  const refusals = [
    [(body) => (body.item.cor_id = 'azul'), 'STORE_CATALOG_MISMATCH'],
    [(body) => (body.item.prazo_dias = 0), 'STORE_CATALOG_MISMATCH'],
    [(body) => (body.valor_centavos = 19364), 'STORE_CATALOG_MISMATCH'],
    [
      (body) => (body.pagamento.valor_pago_centavos = 17000),
      'AMOUNT_BELOW_PRICE',
    ],
    [(body) => (body.pagamento.forma = 'cartao'), 'PAYMENT_METHOD_UNSUPPORTED'],
    [
      (body) => (body.pagamento.gateway = 'outro'),
      'PAYMENT_METHOD_UNSUPPORTED',
    ],
    [(body) => (body.teste = true), 'TEST_REFUSED'],
  ];
  for (const [change, code] of refusals) {
    assertProblem(await post(api, { body: storeOrderBody(change) }), 422, code);
  }
  assert.deepEqual(repository.audits(), []);
});

test('LOJ-20: malformed records are 400 with the field family as the code', async (t) => {
  const { api } = harness();
  t.after(() => api.close());
  /** @type {Array<[(body: any) => void, string]>} */
  const refusals = [
    [(body) => (body.extra = true), 'UNKNOWN_REQUEST_FIELD'],
    [(body) => delete body.pagamento.receipt_url, 'INVALID_REQUEST'],
    [(body) => (body.schema_version = '2.0'), 'UNSUPPORTED_SCHEMA_VERSION'],
    [(body) => (body.numero_loja = 'LJ-00000000'), 'INVALID_STORE_NUMBER'],
    [
      (body) => (body.pagamento.receipt_url = 'https://example.com/recibo'),
      'INVALID_RECEIPT_URL',
    ],
    [(body) => (body.pagamento.pago_em = '09/10/2026'), 'INVALID_PAID_AT'],
    [
      (body) => (body.pagamento.pago_em = '2026-12-01T00:00:00Z'),
      'INVALID_PAID_AT',
    ],
    [(body) => (body.cliente.telefone = '27999991234'), 'INVALID_CUSTOMER'],
  ];
  for (const [change, code] of refusals) {
    assertProblem(await post(api, { body: storeOrderBody(change) }), 400, code);
  }
  assertProblem(
    await post(api, { payload: '{"schema_version":' }),
    400,
    'INVALID_REQUEST',
  );
  assertProblem(await post(api, { payload: '[]' }), 400, 'INVALID_REQUEST');
});

test('LOJ-15: the Idempotency-Key and the technical headers are checked', async (t) => {
  const { api, repository } = harness();
  t.after(() => api.close());
  assertProblem(
    await post(api, {
      headers: { 'idempotency-key': otherStoreOrderBody(2).pedido_id },
    }),
    400,
    'INVALID_IDEMPOTENCY_KEY',
  );
  assertProblem(
    await post(api, { headers: { 'idempotency-key': null } }),
    400,
    'INVALID_IDEMPOTENCY_KEY',
  );
  assertProblem(
    await post(api, { headers: { 'x-correlation-id': 'execucao-48213' } }),
    400,
    'INVALID_CORRELATION_ID',
  );
  for (const header of [
    'x-silmer-workflow-key',
    'x-silmer-workflow-version',
    'x-silmer-execution-id',
  ]) {
    assertProblem(
      await post(api, { headers: { [header]: null } }),
      400,
      `INVALID_${header.toUpperCase().replaceAll('-', '_')}`,
    );
  }
  assert.deepEqual(repository.audits(), []);
});

test('LOJ-16: without the automation credential the answer is 401 and nothing is recorded', async (t) => {
  const { api, denials, repository } = harness();
  t.after(() => api.close());
  for (const authorization of [
    null,
    basic(CLIENT_ID, 'segredo-errado-com-mais-de-32-caracteres!!'),
    'Bearer token',
  ]) {
    const response = await post(api, { headers: { authorization } });
    assertProblem(response, 401, 'INVALID_AUTOMATION_CREDENTIALS');
    assert.match(
      String(response.headers['www-authenticate']),
      /^Basic realm=/u,
    );
  }
  assert.deepEqual(repository.audits(), []);
  assert.equal(denials.length, 3);
  assert.equal(JSON.stringify(denials).includes(SECRET), false);
});

test('LOJ-16: a credential without store.order.record is 403 FORBIDDEN_AUTOMATION_ACTION', async (t) => {
  /** @type {string[]} */
  const actions = [];
  const { api, repository } = harness({
    automationAuth: {
      async authorize(/** @type {any} */ input) {
        actions.push(input.action);
        throw new AutomationAuthError(403, 'FORBIDDEN_AUTOMATION_ACTION');
      },
    },
  });
  t.after(() => api.close());
  assertProblem(await post(api), 403, 'FORBIDDEN_AUTOMATION_ACTION');
  assert.deepEqual(actions, ['store.order.record']);
  assert.deepEqual(repository.audits(), []);
});

test('LOJ-21: no name, phone, receipt or gateway identifier reaches the logs', async (t) => {
  const { api, logs } = harness();
  t.after(() => api.close());
  await post(api, {
    body: storeOrderBody(
      (body) => (body.pagamento.receipt_url = STORE_RECEIPT_URL),
    ),
  });
  await post(api, {
    body: storeOrderBody((body) => (body.item.tamanho_id = 'g')),
  });
  assert.ok(logs.length > 0);
  assert.doesNotMatch(
    JSON.stringify(logs),
    /Cliente Sintetico|5527900000001|nsu-sintetico|fatura-sintetica|recibo\.infinitepay/u,
  );
});

test('an unexpected failure is 503 SERVICE_UNAVAILABLE without internal detail', async (t) => {
  const failing = new InMemoryOrderRepository();
  failing.findStoreOrder = async () => {
    throw Object.assign(new Error('connection to 10.0.0.5 refused'), {
      code: 'ECONNREFUSED',
    });
  };
  const { api } = harness({ repository: failing });
  t.after(() => api.close());
  const response = await post(api);
  assertProblem(response, 503, 'SERVICE_UNAVAILABLE');
  assert.equal(response.headers['retry-after'], '1');
  assert.doesNotMatch(response.body, /10\.0\.0\.5|ECONNREFUSED/u);
});

test('LOJ-15: without APP_BASE_URL the links are relative', async (t) => {
  const { api } = harness({ appBaseUrl: '' });
  t.after(() => api.close());
  const answer = (await post(api)).json();
  assert.equal(answer.pedido_url, `/pedidos/${answer.pedido_id}`);
  assert.equal(
    answer.ficha_url,
    `/api/v1/orders/${answer.pedido_id}/print?download=1`,
  );
});

test('LOJ-25: the public route is gone and the store route is off until it is configured', async (t) => {
  const api = createApi({}, {});
  t.after(() => api.close());
  for (const url of [STORE_ORDERS_PATH, '/api/v1/public/loja/pedidos']) {
    const response = await api.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: JSON.stringify(storeOrderBody()),
      url,
    });
    assert.equal(response.statusCode, 404, url);
  }
  const configured = harness();
  t.after(() => configured.api.close());
  const preflight = await configured.api.inject({
    headers: { origin: 'https://silmer.com.br' },
    method: 'OPTIONS',
    url: '/api/v1/public/loja/pedidos',
  });
  assert.equal(preflight.statusCode, 404);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

test('LOJ-25: the server wiring needs the HMAC key, FAB_CODE and well-formed values', () => {
  const database = {
    query: async () => ({ rows: [] }),
    transaction: async () => undefined,
  };
  const key = Buffer.alloc(32, 9).toString('base64url');
  const environment = {
    FAB_CODE: '01',
    N8N_INTEGRATION_ENVELOPE_KEY: key,
    STORE_ORDERS_HMAC_KEY: key,
  };
  assert.equal(
    createStoreOrdersForServer({
      database,
      environment: { ...environment, STORE_ORDERS_HMAC_KEY: '' },
    }),
    undefined,
  );
  assert.equal(createStoreOrdersForServer({ environment }), undefined);
  assert.ok(createStoreOrdersForServer({ database, environment }));
  for (const broken of [
    { FAB_CODE: '' },
    { STORE_ORDERS_HMAC_KEY: 'curta' },
    { N8N_INTEGRATION_ENVELOPE_KEY: undefined },
    { STORE_ORDERS_ACCEPT_TEST: 'sim' },
    { APP_BASE_URL: 'crm.example.test' },
    { APP_BASE_URL: 'http://crm.example.test' },
    { APP_BASE_URL: 'https://crm.example.test/?x=1' },
  ]) {
    assert.throws(
      () =>
        createStoreOrdersForServer({
          database,
          environment: { ...environment, ...broken },
        }),
      Error,
      JSON.stringify(broken),
    );
  }
});

test('APP_BASE_URL is read as an origin with an optional path, without the trailing slash', () => {
  assert.equal(readBaseUrl(undefined), '');
  assert.equal(readBaseUrl(' '), '');
  assert.equal(
    readBaseUrl('https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/'),
    'https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host',
  );
  assert.equal(
    readBaseUrl('https://crm.example.test/app/'),
    'https://crm.example.test/app',
  );
  assert.equal(readBaseUrl('http://127.0.0.1:4173'), 'http://127.0.0.1:4173');
});
