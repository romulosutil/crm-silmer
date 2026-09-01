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
  validateActivationGate,
  validateAlertPolicy,
  validateRuntimeHardening,
} from '../scripts/validate-observability.mjs';

const rootUrl = new URL('../', import.meta.url);
const canaries = [
  'cliente@example.test',
  '+12025550199',
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

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** @param {Array<Record<string, unknown>>} records */
function assertNoCanaries(records) {
  const serialized = JSON.stringify(records);
  for (const canary of canaries)
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(canary), 'u'));
}

test('escapes every regular-expression metacharacter in log canaries', () => {
  const pattern = new RegExp(escapeRegExp('a\\b+c.test?'), 'u');

  assert.match('a\\b+c.test?', pattern);
  assert.doesNotMatch('abccXtest', pattern);
});

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

test('keeps T00.7 activation fail-closed until every live proof is coherent', async () => {
  const policy = JSON.parse(
    await readFile(new URL('ops/observability/alerts.json', rootUrl), 'utf8'),
  );
  const gate = JSON.parse(
    await readFile(
      new URL('ops/observability/activation-gate.json', rootUrl),
      'utf8',
    ),
  );

  assert.doesNotThrow(() => validateActivationGate(gate, policy));

  const partial = structuredClone(gate);
  partial.status = 'active';
  assert.throws(
    () => validateActivationGate(partial, policy),
    /pending or wholly proved/iu,
  );

  const leaked = structuredClone(gate);
  leaked.provider.apiToken = 'must-not-pass';
  assert.throws(
    () => validateActivationGate(leaked, policy),
    /sensitive field/iu,
  );

  const completed = structuredClone(gate);
  const evidence = 'docs/phase0/observability-live-evidence.json';
  completed.status = 'proved';
  completed.provider = {
    dataRegion: 'br-compatible-approved-region',
    dpaAccepted: true,
    evidenceRef: `${evidence}#provider`,
    name: 'approved-observability-operator',
    privacyReviewer: 'silmer:privacy-officer',
    retentionDays: 30,
    reviewedAt: '2026-09-01T12:00:00.000Z',
    status: 'approved',
    subprocessorsAccepted: true,
  };
  completed.routing = {
    criticalEscalationMinutes: 10,
    destinations: [
      'operator-contact://primary-on-call',
      'operator-contact://delivery-team',
    ],
    evidenceRef: `${evidence}#routing`,
    highEscalationMinutes: 15,
    ownerIds: ['silmer:tech-lead', 'silmer:devops'],
    status: 'configured',
  };
  completed.monitor = {
    ...completed.monitor,
    checkIntervalSeconds: 30,
    evidenceRef: `${evidence}#api-live-unavailable`,
    monitorId: 'operator-monitor://crm-silmer-api-live',
    status: 'active',
  };
  completed.telemetry = {
    ...completed.telemetry,
    evidenceRef: `${evidence}#telemetry`,
    status: 'active',
  };
  completed.hardening = {
    capabilitiesRemoved: true,
    digest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    evidenceRef: `${evidence}#hardening`,
    nonRoot: true,
    readOnly: true,
    status: 'passed',
    temporaryStorageLimited: true,
  };
  completed.drills = completed.drills.map(
    (/** @type {any} */ drill, /** @type {number} */ index) => ({
      ...drill,
      deliveredAt: `2026-09-01T12:0${index}:30.000Z`,
      detectedAt: `2026-09-01T12:0${index}:20.000Z`,
      evidenceRef: `${evidence}#${drill.alertId}`,
      recoveredAt: `2026-09-01T12:0${index}:40.000Z`,
      startedAt: `2026-09-01T12:0${index}:10.000Z`,
      status: 'passed',
    }),
  );
  completed.completion = {
    approvedAt: '2026-09-01T13:00:00.000Z',
    approvedBy: ['silmer:tech-lead', 'silmer:privacy-officer'],
    evidenceRef: `${evidence}#approval`,
    humanApproved: true,
  };

  const activePolicy = structuredClone(policy);
  activePolicy.status = 'active';
  activePolicy.routing = {
    ...activePolicy.routing,
    destination: 'operator-contact://primary-on-call',
    status: 'configured',
  };
  activePolicy.alerts = activePolicy.alerts.map((/** @type {any} */ alert) => ({
    ...alert,
    status: 'active',
  }));
  assert.doesNotThrow(() => validateActivationGate(completed, activePolicy));

  completed.drills[0].detectedAt = completed.drills[0].startedAt;
  assert.throws(
    () => validateActivationGate(completed, activePolicy),
    /ordered timestamps/iu,
  );
});
