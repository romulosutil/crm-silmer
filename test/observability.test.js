import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createServerApi } from '../apps/api/src/server.js';
import { WorkerRuntime } from '../apps/worker/src/worker.js';
import {
  createSafeLogger,
  MetricRegistry,
  normalizeTraceId,
} from '../modules/shared/src/index.js';
import {
  validateAlertPolicy,
  validateRuntimeHardening,
} from '../scripts/validate-observability.mjs';

const rootUrl = new URL('../', import.meta.url);
const canaries = [
  'cliente@example.test',
  '+5527999999999',
  'mensagem-secreta',
  'prompt-secreto',
  'token-secreto',
];

function capture() {
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  return {
    logger: createSafeLogger({
      service: 'crm-silmer-api',
      sink: (record) => records.push(record),
    }),
    records,
  };
}

/** @param {Array<Record<string, unknown>>} records */
function assertNoCanaries(records) {
  const serialized = JSON.stringify(records);
  for (const canary of canaries)
    assert.doesNotMatch(
      serialized,
      new RegExp(canary.replace(/[+]/gu, '\\+'), 'u'),
    );
}

test('allowlists structured fields and drops PII/content values', () => {
  const { logger, records } = capture();
  logger.error('synthetic_failure', {
    email: canaries[0],
    error_code: 'SYNTHETIC_FAILURE',
    message: canaries[2],
    phone: canaries[1],
    prompt: canaries[3],
    token: canaries[4],
  });

  assert.equal(records[0].error_code, 'SYNTHETIC_FAILURE');
  assert.equal(records[0].redacted_field_count, 5);
  assertNoCanaries(records);
  assert.notEqual(normalizeTraceId(canaries[1]), canaries[1]);
});

test('normalizes untrusted categorical dimensions without logging canaries', () => {
  const { logger, records } = capture();
  logger.error('synthetic_failure', {
    error_code: canaries[0],
    job_type: canaries[1],
    outcome: canaries[2],
    queue: canaries[3],
  });

  assert.equal(records[0].error_code, 'UNCLASSIFIED_ERROR');
  assert.equal(records[0].job_type, 'unknown_job');
  assert.equal(records[0].outcome, 'unknown_outcome');
  assert.equal(records[0].queue, 'unknown_queue');
  assert.equal(records[0].redacted_field_count, 4);
  assertNoCanaries(records);
});

test('server wiring defaults ready to 503 while live stays 200', async () => {
  const { logger } = capture();
  const server = createServerApi({ logger });
  assert.equal(
    (await server.inject({ url: '/api/health/live' })).statusCode,
    200,
  );
  assert.equal(
    (await server.inject({ url: '/api/health/ready' })).statusCode,
    503,
  );
  assert.equal((await server.inject({ url: '/health/live' })).statusCode, 200);
  await server.close();
});

test('readiness injection preserves explicit true, false and failure states', async () => {
  const { logger: readyLogger } = capture();
  const ready = createApi({}, { logger: readyLogger, readiness: () => true });
  assert.equal(
    (await ready.inject({ url: '/api/health/ready' })).statusCode,
    200,
  );
  await ready.close();

  const { logger: unavailableLogger } = capture();
  const unavailable = createApi(
    {},
    { logger: unavailableLogger, readiness: () => false },
  );
  assert.equal(
    (await unavailable.inject({ url: '/api/health/ready' })).statusCode,
    503,
  );
  await unavailable.close();

  const { logger, records } = capture();
  const metrics = new MetricRegistry({ logger });
  const failing = createApi(
    {},
    {
      logger,
      metrics,
      readiness: async () => {
        throw new Error(canaries[0]);
      },
    },
  );
  const response = await failing.inject({
    headers: { 'x-request-id': canaries[1] },
    url: '/api/health/ready',
  });
  assert.equal(response.statusCode, 503);
  assert.notEqual(response.headers['x-request-id'], canaries[1]);
  assert.equal(metrics.snapshot().api_5xx_total, 1);
  assertNoCanaries(records);
  await failing.close();
});

test('emits worker heartbeat and bounded failure metrics without job content', async () => {
  const { logger, records } = capture();
  const metrics = new MetricRegistry({ logger });
  const worker = new WorkerRuntime({
    heartbeatIntervalMs: 10,
    logger,
    metrics,
    now: () => 1_800_000_000_000,
  });
  await worker.start();
  worker.recordJobFailure({
    ageSeconds: 301,
    errorCode: 'SYNTHETIC_FAILURE',
    jobType: 'outbox_delivery',
    queue: 'external_effects',
  });
  await worker.stop();

  assert.equal(
    metrics.snapshot().worker_heartbeat_unixtime_seconds,
    1_800_000_000,
  );
  assert.equal(metrics.snapshot().worker_jobs_failed_total, 1);
  assert.equal(metrics.snapshot().worker_oldest_job_age_seconds, 301);
  assertNoCanaries(records);
});

test('keeps alert routing pending and runtime hardening verifiable', async () => {
  const policy = JSON.parse(
    await readFile(new URL('ops/observability/alerts.json', rootUrl), 'utf8'),
  );
  const dockerfile = await readFile(
    new URL('docker/runtime.Dockerfile', rootUrl),
    'utf8',
  );
  assert.doesNotThrow(() => validateAlertPolicy(policy));
  assert.doesNotThrow(() => validateRuntimeHardening(dockerfile));

  const unsafe = structuredClone(policy);
  unsafe.status = 'active';
  assert.throws(() => validateAlertPolicy(unsafe), /pending/iu);
});
