import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import {
  compileAllowedOrigins,
  createStoreOrderRuntime,
  createStoreOrdersForServer,
} from '../apps/api/src/store-order-runtime.js';
import { STORE_ORDERS_PATH } from '../apps/api/src/store-order-routes.js';
import { createSafeLogger } from '../modules/shared/src/index.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import {
  STORE_NOW,
  STORE_ORIGIN,
  STORE_REQUEST_ID,
  storeOrderBody,
} from './fixtures/store-order.js';

const ALLOWED =
  'https://silmer.com.br, https://www.silmer.com.br, https://silmer-*-romulodesigns.vercel.app';

/**
 * @param {{acceptTest?: boolean, requestsPerMinute?: number, limits?: any, allowedOrigins?: string}} [options]
 */
function harness(options = {}) {
  const repository = new InMemoryOrderRepository();
  /** @type {any[]} */
  const audits = [];
  /** @type {any[]} */
  const logs = [];
  let ids = 0;
  const storeOrders = createStoreOrderRuntime({
    allowedOrigins: options.allowedOrigins ?? ALLOWED,
    auditTrail: {
      append: async (/** @type {any} */ event) => void audits.push(event),
    },
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    requestsPerMinute: options.requestsPerMinute,
    service: createStoreOrderService({
      acceptTest: options.acceptTest ?? true,
      clock: () => STORE_NOW,
      fabCode: '01',
      hmacKey: Buffer.alloc(32, 27),
      idFactory: () => `order-store-${(ids += 1)}`,
      limits: options.limits,
      repository,
    }),
  });
  const api = createApi(
    {},
    {
      logger: createSafeLogger({
        service: 'crm-silmer-api',
        sink: (/** @type {any} */ entry) => logs.push(entry),
      }),
      storeOrders,
    },
  );
  return { api, audits, logs, repository };
}

/**
 * @param {import('fastify').FastifyInstance} api
 * @param {{body?: unknown, payload?: string, key?: string|null, origin?: string|null, contentType?: string}} [input]
 */
function post(api, input = {}) {
  const body = input.body ?? storeOrderBody();
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': input.contentType ?? 'application/json',
  };
  const key =
    input.key === undefined ? /** @type {any} */ (body)?.pedido_id : input.key;
  if (key !== null && key !== undefined) headers['idempotency-key'] = key;
  const origin = input.origin === undefined ? STORE_ORIGIN : input.origin;
  if (origin !== null) headers.origin = origin;
  return api.inject({
    headers,
    method: 'POST',
    payload: input.payload ?? JSON.stringify(body),
    url: STORE_ORDERS_PATH,
  });
}

/** @param {number} index */
function requestId(index) {
  return `5b0c77ed-8c90-46ce-97a4-${String(index).padStart(12, '0')}`;
}

test('LOJ-01: the contract v1 notice creates an order and answers 201 with its number', async () => {
  const { api, audits, repository } = harness();
  const response = await post(api);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { numero: '01-CRM' });
  assert.equal(response.headers['access-control-allow-origin'], STORE_ORIGIN);
  assert.equal(response.headers.vary, 'Origin');
  assert.equal(response.headers['cache-control'], 'no-store');
  const order = await repository.findById('order-store-1');
  assert.equal(order?.origin, 'loja');
  assert.equal(order?.status, 'confirmado');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, 'system:loja-do-site');
  assert.equal(audits[0].action, 'store.order.create');
  assert.deepEqual(audits[0].target, {
    id: STORE_REQUEST_ID,
    type: 'store_order',
  });
  assert.equal(repository.receiptFor('order-store-1')?.origin, STORE_ORIGIN);
  await api.close();
});

test('LOJ-02: the same key and body replays the number with 200, in any key order', async () => {
  const { api, audits, repository } = harness();
  const first = await post(api);
  const body = storeOrderBody();
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  const replay = await post(api, { body: reordered });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(audits.length, 1);
  assert.equal((await repository.list({ limit: 10 })).items.length, 1);
  await api.close();
});

test('LOJ-02: the same key with another body is 409 idempotency_conflict', async () => {
  const { api, repository } = harness();
  await post(api);
  const response = await post(api, {
    body: storeOrderBody((body) => (body.cliente.nome = 'Outro Nome')),
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { erro: 'idempotency_conflict' });
  assert.equal((await repository.list({ limit: 10 })).items.length, 1);
  await api.close();
});

test('LOJ-02: the Idempotency-Key must be present and equal pedido_id', async () => {
  const { api } = harness();
  for (const key of [null, requestId(9)]) {
    const response = await post(api, { key });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { erro: 'chave_invalida' });
  }
  await api.close();
});

test('LOJ-03: malformed notices are 400 with the site vocabulary', async () => {
  const { api, repository } = harness();
  /** @type {Array<[Parameters<typeof post>[1], string]>} */
  const cases = [
    [{ payload: '{"versao":' }, 'corpo_invalido'],
    [{ contentType: 'text/plain', payload: 'oi' }, 'corpo_invalido'],
    [
      { body: storeOrderBody((body) => (body.extra = 'x'.repeat(9000))) },
      'corpo_invalido',
    ],
    [
      {
        payload: JSON.stringify(storeOrderBody()).replace(
          '"versao":"1"',
          '"versao":"1","__proto__":{"x":1}',
        ),
      },
      'corpo_invalido',
    ],
    [
      { body: storeOrderBody((body) => (body.versao = '2')) },
      'versao_invalida',
    ],
    [
      { body: storeOrderBody((body) => (body.cliente.nome = 'A')) },
      'nome_invalido',
    ],
    [
      { body: storeOrderBody((body) => (body.cliente.telefone = '27999')) },
      'telefone_invalido',
    ],
  ];
  for (const [input, code] of cases) {
    const response = await post(api, { key: STORE_REQUEST_ID, ...input });
    assert.equal(response.statusCode, 400, code);
    assert.deepEqual(response.json(), { erro: code });
    assert.equal(
      response.headers['access-control-allow-origin'],
      STORE_ORIGIN,
      'an error still carries CORS',
    );
  }
  assert.equal((await repository.list({ limit: 10 })).items.length, 0);
  await api.close();
});

test('LOJ-04: a price that differs from the CRM catalog is 422 valor_divergente', async () => {
  const { api, repository } = harness();
  const response = await post(api, {
    body: storeOrderBody((body) => (body.valor_centavos = 1000)),
  });
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), { erro: 'valor_divergente' });
  assert.equal((await repository.list({ limit: 10 })).items.length, 0);
  // Nothing was recorded under the key: the corrected notice goes through.
  const corrected = await post(api);
  assert.equal(corrected.statusCode, 201);
  await api.close();
});

test('LOJ-05: a test notice is 422 teste_recusado where tests are refused', async () => {
  const { api } = harness({ acceptTest: false });
  const response = await post(api);
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), { erro: 'teste_recusado' });
  const real = await post(api, {
    body: storeOrderBody((body) => (body.teste = false)),
  });
  assert.equal(real.statusCode, 201);
  await api.close();
});

test('LOJ-11: the preflight allows POST and the two headers only for listed origins', async () => {
  const { api } = harness();
  for (const origin of [
    'https://silmer.com.br',
    'https://www.silmer.com.br',
    'https://silmer-nt05eqpyp-romulodesigns.vercel.app',
    'https://silmer-git-feat-loja-camisa-lisa-romulodesigns.vercel.app',
  ]) {
    const response = await api.inject({
      headers: {
        'access-control-request-headers': 'content-type,idempotency-key',
        'access-control-request-method': 'POST',
        origin,
      },
      method: 'OPTIONS',
      url: STORE_ORDERS_PATH,
    });
    assert.equal(response.statusCode, 204, origin);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(
      response.headers['access-control-allow-methods'],
      'POST, OPTIONS',
    );
    assert.equal(
      response.headers['access-control-allow-headers'],
      'Content-Type, Idempotency-Key',
    );
    assert.equal(response.headers['access-control-max-age'], '600');
    assert.equal(response.headers.vary, 'Origin');
  }
  for (const origin of [
    'https://evil.example',
    'http://silmer.com.br',
    'https://silmer.com.br.evil.example',
    'https://silmer-x-romulodesigns.vercel.app.evil.example',
    'https://other-x-romulodesigns.vercel.app',
    'http://localhost:4330',
  ]) {
    const response = await api.inject({
      headers: { 'access-control-request-method': 'POST', origin },
      method: 'OPTIONS',
      url: STORE_ORDERS_PATH,
    });
    assert.equal(response.statusCode, 204, origin);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['access-control-allow-methods'], undefined);
  }
  await api.close();
});

test('LOJ-11: localhost is allowed only where it is configured', async () => {
  const { api } = harness({
    allowedOrigins: `${ALLOWED}, http://localhost:4330`,
  });
  const response = await post(api, { origin: 'http://localhost:4330' });
  assert.equal(response.statusCode, 201);
  assert.equal(
    response.headers['access-control-allow-origin'],
    'http://localhost:4330',
  );
  await api.close();
});

test('LOJ-11: a POST without an allowed Origin is 403 and creates nothing', async () => {
  const { api, repository } = harness();
  for (const origin of [null, 'https://evil.example']) {
    const response = await post(api, { origin });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { erro: 'origem_nao_permitida' });
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await repository.list({ limit: 10 })).items.length, 0);
  await api.close();
});

test('LOJ-12: the per-minute limit of the route answers 429 with Retry-After', async () => {
  const { api } = harness({ requestsPerMinute: 2 });
  await post(api);
  await post(api);
  const response = await post(api);
  assert.equal(response.statusCode, 429);
  assert.deepEqual(response.json(), { erro: 'rate_limited' });
  assert.match(String(response.headers['retry-after']), /^\d+$/u);
  assert.equal(response.headers['access-control-allow-origin'], STORE_ORIGIN);
  await api.close();
});

test('LOJ-12: the per-IP order limit answers 429 with the seconds left; a replay still answers 200', async () => {
  const { api } = harness({ limits: { perIpPerHour: 1 } });
  const first = await post(api);
  assert.equal(first.statusCode, 201);
  const second = await post(api, {
    body: storeOrderBody((body) => {
      body.pedido_id = requestId(2);
      body.cliente.telefone = '5527900000002';
    }),
  });
  assert.equal(second.statusCode, 429);
  assert.deepEqual(second.json(), { erro: 'rate_limited' });
  assert.equal(second.headers['retry-after'], '3600');
  const replay = await post(api);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());
  await api.close();
});

test('LOJ-13: no name, phone or IP reaches the logs', async () => {
  const { api, logs } = harness();
  await post(api);
  await post(api, {
    body: storeOrderBody((body) => (body.valor_centavos = 1)),
  });
  const written = JSON.stringify(logs);
  assert.doesNotMatch(written, /Cliente Sintetico|5527900000001|127\.0\.0\.1/u);
  await api.close();
});

test('an unexpected failure is 503 without internal detail', async () => {
  const api = createApi(
    {},
    {
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
      storeOrders: {
        allowsOrigin: () => true,
        phoneDigestsFor: () => [],
        receive: async () => {
          throw Object.assign(new Error('relation does not exist'), {
            code: '42P01',
          });
        },
        requestsPerMinute: 30,
      },
    },
  );
  const response = await post(api);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { erro: 'indisponivel' });
  await api.close();
});

test('the route does not exist until the site shop is configured', async () => {
  const api = createApi();
  const response = await post(api);
  assert.equal(response.statusCode, 404);
  await api.close();
});

test('allowed origins are checked at startup and matched exactly', () => {
  const allows = compileAllowedOrigins(ALLOWED);
  assert.equal(allows('https://silmer.com.br'), true);
  assert.equal(allows('https://SILMER.com.br'), false);
  assert.equal(allows('https://silmer-a-b-romulodesigns.vercel.app'), true);
  assert.equal(allows('https://silmer--romulodesigns.vercel.app'), false);
  assert.equal(allows('https://silmer-a.b-romulodesigns.vercel.app'), false);
  assert.equal(allows(undefined), false);
  for (const invalid of [
    '',
    ' , ',
    'silmer.com.br',
    'https://silmer.com.br/',
    'https://silmer.com.br/loja',
    'http://silmer-*.example',
    'https://**.example',
  ]) {
    assert.throws(() => compileAllowedOrigins(invalid), Error, invalid);
  }
});

test('the server wiring needs the key and the origins together', () => {
  assert.equal(
    createStoreOrdersForServer({ database: {}, environment: {} }),
    undefined,
  );
  assert.throws(
    () =>
      createStoreOrdersForServer({
        database: {},
        environment: { STORE_ORDERS_ALLOWED_ORIGINS: ALLOWED },
      }),
    /together/u,
  );
  const base = {
    FAB_CODE: '01',
    IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 1).toString('base64url'),
    N8N_INTEGRATION_ENVELOPE_KEY: Buffer.alloc(32, 2).toString('base64url'),
    STORE_ORDERS_ALLOWED_ORIGINS: ALLOWED,
    STORE_ORDERS_HMAC_KEY: Buffer.alloc(32, 3).toString('base64url'),
  };
  const database = {
    query: async () => ({ rows: [] }),
    transaction: async () => undefined,
  };
  assert.ok(createStoreOrdersForServer({ database, environment: base }));
  for (const [name, value] of [
    ['STORE_ORDERS_ACCEPT_TEST', 'yes'],
    ['STORE_ORDERS_MAX_PER_IP_HOUR', '0'],
    ['STORE_ORDERS_HMAC_KEY', 'short'],
    ['FAB_CODE', ''],
  ]) {
    assert.throws(
      () =>
        createStoreOrdersForServer({
          database,
          environment: { ...base, [name]: value },
        }),
      Error,
      name,
    );
  }
});

test('LOJ-01: the OpenAPI documents the public route and its site vocabulary', async () => {
  const { readFile } = await import('node:fs/promises');
  const openapi = await readFile(
    new URL('../docs/api/openapi.v1.yaml', import.meta.url),
    'utf8',
  );
  assert.match(openapi, /^ {2}\/public\/loja\/pedidos:$/mu);
  assert.match(openapi, /operationId: createStoreOrder/u);
  assert.match(openapi, /operationId: preflightStoreOrder/u);
  for (const code of [
    'idempotency_conflict',
    'valor_divergente',
    'teste_recusado',
    'origem_nao_permitida',
    'rate_limited',
  ]) {
    assert.match(openapi, new RegExp(`\\b${code}\\b`, 'u'), code);
  }
  assert.equal(STORE_ORDERS_PATH, '/api/v1/public/loja/pedidos');
});
