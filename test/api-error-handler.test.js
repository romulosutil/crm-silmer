import assert from 'node:assert/strict';
import test from 'node:test';

import rateLimit from '@fastify/rate-limit';

import { createApi } from '../apps/api/src/app.js';
import {
  createSafeLogger,
  MetricRegistry,
} from '../modules/shared/src/index.js';

// WAP-E12 (E12-5): an unexpected failure never echoes the database code or
// message; deliberate 4xx keep Fastify's default contract byte for byte.
const CANARY = 'Key (email)=(cliente-canary@example.test)';

function harness() {
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  const logger = createSafeLogger({
    service: 'crm-silmer-api',
    sink: (record) => records.push(record),
  });
  const metrics = new MetricRegistry({ logger });
  const api = createApi({}, { logger, metrics });
  api.post('/synthetic/json', async () => ({ ok: true }));
  api.post('/synthetic/small', { bodyLimit: 16 }, async () => ({ ok: true }));
  api.post(
    '/synthetic/schema',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  api.get('/synthetic/raw', async () => {
    throw Object.assign(new Error(`deadlock detected ${CANARY}`), {
      code: '40P01',
      detail: CANARY,
    });
  });
  api.get('/synthetic/unique', async () => {
    throw Object.assign(
      new Error(`duplicate key value violates unique constraint ${CANARY}`),
      { code: '23505', constraint: CANARY },
    );
  });
  api.get('/synthetic/unavailable', async () => {
    throw Object.assign(new Error(`upstream down ${CANARY}`), {
      code: 'UPSTREAM_CANARY',
      statusCode: 503,
    });
  });
  api.get('/synthetic/bad-gateway', async () => {
    throw Object.assign(new Error(`gateway ${CANARY}`), {
      code: 'GATEWAY_CANARY',
      statusCode: 502,
    });
  });
  api.get('/synthetic/invalid-status', async () => {
    throw Object.assign(new Error(`odd ${CANARY}`), {
      code: 'ODD_CANARY',
      statusCode: 302,
    });
  });
  api.get('/synthetic/thrown-string', async () => {
    throw CANARY;
  });
  api.register(async (scope) => {
    await scope.register(rateLimit, { global: false });
    scope.get(
      '/synthetic/limited',
      { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
      async () => ({ ok: true }),
    );
  });
  return { api, metrics, records };
}

/** @param {any} response @param {number} status @param {string} code */
function assertGenericFailure(response, status, code) {
  assert.equal(response.statusCode, status);
  assert.deepEqual(response.json(), { error: { code } });
  assert.match(String(response.headers['content-type']), /^application\/json/u);
  assert.equal(response.headers['cache-control'], 'no-store');
  const serialized = response.body + JSON.stringify(response.headers);
  for (const leak of [
    'canary',
    'CANARY',
    '40P01',
    '23505',
    'deadlock',
    'duplicate key',
    'message',
    'statusCode',
  ])
    assert.equal(serialized.includes(leak), false, leak);
}

test('E12-5: a raw database failure answers 500 with only INTERNAL_ERROR', async (t) => {
  const { api, metrics, records } = harness();
  t.after(() => api.close());

  for (const url of ['/synthetic/raw', '/synthetic/unique']) {
    assertGenericFailure(await api.inject({ url }), 500, 'INTERNAL_ERROR');
  }
  assertGenericFailure(
    await api.inject({ url: '/synthetic/invalid-status' }),
    500,
    'INTERNAL_ERROR',
  );
  assertGenericFailure(
    await api.inject({ url: '/synthetic/thrown-string' }),
    500,
    'INTERNAL_ERROR',
  );

  // The onError log keeps the bounded SQLSTATE and the 5xx metric still counts.
  const failures = records.filter((r) => r.event === 'api_request_failed');
  assert.deepEqual(
    failures.slice(0, 2).map((r) => r.error_code),
    ['40P01', '23505'],
  );
  assert.equal(metrics.snapshot().api_5xx_total, 4);
  assert.equal(JSON.stringify(records).includes('canary'), false);
});

test('E12-5: an explicit 5xx keeps its status with a generic code', async (t) => {
  const { api } = harness();
  t.after(() => api.close());

  assertGenericFailure(
    await api.inject({ url: '/synthetic/unavailable' }),
    503,
    'SERVICE_UNAVAILABLE',
  );
  assertGenericFailure(
    await api.inject({ url: '/synthetic/bad-gateway' }),
    502,
    'INTERNAL_ERROR',
  );
});

test('E12-5: deliberate 4xx keep the Fastify default body and headers', async (t) => {
  const { api } = harness();
  t.after(() => api.close());

  const invalidJson = await api.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '{bad',
    url: '/synthetic/json',
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.deepEqual(invalidJson.json(), {
    statusCode: 400,
    code: 'FST_ERR_CTP_INVALID_JSON_BODY',
    error: 'Bad Request',
    message:
      "Body is not valid JSON but content-type is set to 'application/json'",
  });
  assert.equal(invalidJson.headers['cache-control'], undefined);

  const empty = await api.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '',
    url: '/synthetic/json',
  });
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(empty.json(), {
    statusCode: 400,
    code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
    error: 'Bad Request',
    message:
      "Body cannot be empty when content-type is set to 'application/json'",
  });

  const tooLarge = await api.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: JSON.stringify({ a: 'x'.repeat(64) }),
    url: '/synthetic/small',
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.deepEqual(tooLarge.json(), {
    statusCode: 413,
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    error: 'Payload Too Large',
    message: 'Request body is too large',
  });

  const mediaType = await api.inject({
    headers: { 'content-type': 'text/xml' },
    method: 'POST',
    payload: '<a/>',
    url: '/synthetic/json',
  });
  assert.equal(mediaType.statusCode, 415);
  assert.deepEqual(mediaType.json(), {
    statusCode: 415,
    code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    error: 'Unsupported Media Type',
    message: 'Unsupported Media Type',
  });

  const schema = await api.inject({
    method: 'POST',
    payload: {},
    url: '/synthetic/schema',
  });
  assert.equal(schema.statusCode, 400);
  assert.deepEqual(schema.json(), {
    statusCode: 400,
    code: 'FST_ERR_VALIDATION',
    error: 'Bad Request',
    message: "body must have required property 'name'",
  });

  assert.equal(
    (await api.inject({ url: '/synthetic/limited' })).statusCode,
    200,
  );
  const limited = await api.inject({ url: '/synthetic/limited' });
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), {
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded, retry in 1 minute',
  });
  assert.equal(limited.headers['x-ratelimit-limit'], '1');
  assert.equal(limited.headers['x-ratelimit-remaining'], '0');
  assert.equal(limited.headers['x-ratelimit-reset'], '60');
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(limited.headers['cache-control'], undefined);

  const missing = await api.inject({ url: '/synthetic/missing' });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), {
    message: 'Route GET:/synthetic/missing not found',
    error: 'Not Found',
    statusCode: 404,
  });
});
