import assert from 'node:assert/strict';
import test from 'node:test';
import { operationalSummary } from '../apps/edge-web/src/lib/operational-summary.js';
import { ApiError, request } from '../apps/edge-web/src/lib/api-client.js';

const now = Date.parse('2026-11-06T13:42:00Z');
const healthy = {
  status: 'ok',
  checkedAt: new Date(now).toISOString(),
  checks: { worker: 'ok', queue: 'ok', commands: 'ok' },
};

test('OPSUI-02: healthy summary has three meaningful signals and no investigation noise', () => {
  const result = operationalSummary(healthy, { now });
  assert.equal(result.state, 'healthy');
  assert.equal(result.title, 'Operação saudável');
  assert.deepEqual(
    result.signals.map((s) => s.value),
    ['Ativo', 'Sem atraso', 'Sem bloqueios'],
  );
  assert.deepEqual(result.guidance, []);
});

test('OPSUI-02: degraded snapshot preserves good signals and directs investigation', () => {
  const result = operationalSummary(
    {
      ...healthy,
      status: 'degraded',
      checks: { ...healthy.checks, queue: 'degraded' },
    },
    { now },
  );
  assert.equal(result.state, 'degraded');
  assert.deepEqual(
    result.signals.map((s) => s.state),
    ['ok', 'degraded', 'ok'],
  );
  assert.equal(result.signals[1].value, 'Atrasada');
  assert.deepEqual(result.guidance, [
    'Confira tarefas aguardando processamento há mais de 5 minutos.',
  ]);
});

test('OPSUI-02: stale, malformed, unavailable and failed reads never present healthy operation', () => {
  for (const data of [
    null,
    {},
    { status: 'unavailable' },
    { ...healthy, checkedAt: new Date(now - 120_001).toISOString() },
    { ...healthy, checkedAt: 'invalid' },
    { ...healthy, checks: { worker: 'ok' } },
    { ...healthy, status: 'other' },
    {
      ...healthy,
      status: 'ok',
      checks: { ...healthy.checks, worker: 'degraded' },
    },
  ]) {
    const result = operationalSummary(data, { now });
    assert.equal(result.state, 'unavailable');
    assert.equal(
      result.signals.every((s) => s.value === 'Sem leitura'),
      true,
    );
  }
  assert.equal(
    operationalSummary(healthy, { now, failed: true }).state,
    'unavailable',
  );
  assert.equal(
    operationalSummary(healthy, { now: now + 120_000 }).state,
    'healthy',
  );
});

test('OPSUI-03: HTTP clock metadata preserves freshness checks and degraded 503 bodies', async (t) => {
  const date = new Date(now).toUTCString();
  let status = 200;
  let header = date;
  let body = healthy;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new globalThis.Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', date: header },
      }),
  );
  const response = await request('/api/health/operations');
  assert.equal(response.serverTime, now);
  assert.deepEqual(response.data, healthy);
  assert.equal(
    operationalSummary(response.data, { now: response.serverTime ?? 0 }).state,
    'healthy',
  );
  body = { ...healthy, checkedAt: new Date(now - 120_001).toISOString() };
  const stale = await request('/api/health/operations');
  assert.equal(
    operationalSummary(stale.data, { now: stale.serverTime ?? 0 }).state,
    'unavailable',
  );
  body = { ...healthy, checkedAt: new Date(now + 5001).toISOString() };
  const future = await request('/api/health/operations');
  assert.equal(
    operationalSummary(future.data, { now: future.serverTime ?? 0 }).state,
    'unavailable',
  );
  status = 503;
  body = {
    ...healthy,
    status: 'degraded',
    checks: { ...healthy.checks, queue: 'degraded' },
  };
  await assert.rejects(request('/api/health/operations'), (cause) => {
    assert.ok(cause instanceof ApiError);
    assert.equal(cause.serverTime, now);
    assert.equal(
      operationalSummary(cause.problem, { now: cause.serverTime ?? 0 }).state,
      'degraded',
    );
    return true;
  });
  status = 200;
  for (header of ['invalid', '0', 'Thu, 99 Nov 2026 15:14:38 GMT']) {
    assert.equal((await request('/api/health/operations')).serverTime, null);
  }
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new globalThis.Response(JSON.stringify(healthy), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  assert.equal((await request('/api/health/operations')).serverTime, null);
});
