import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkerRuntime } from '../apps/worker/src/worker.js';
import {
  calculateRetryDelayMs,
  decideFailedAttempt,
  decideExpiredAttempt,
} from '../modules/integration-reliability/src/postgres-job-queue.js';
import {
  createSafeLogger,
  MetricRegistry,
} from '../modules/shared/src/index.js';

const silentLogger = createSafeLogger({
  service: 'crm-silmer-worker',
  sink: () => {},
});

test('bounds exponential retry and applies symmetric jitter', () => {
  assert.equal(
    calculateRetryDelayMs({ attemptCount: 1, random: () => 0 }),
    750,
  );
  assert.equal(
    calculateRetryDelayMs({ attemptCount: 1, random: () => 1 }),
    1_250,
  );
  assert.equal(
    calculateRetryDelayMs({ attemptCount: 20, random: () => 0.5 }),
    300_000,
  );
});

test('retries only proven-safe failures and dead-letters poison jobs', () => {
  assert.deepEqual(
    decideFailedAttempt({
      attemptCount: 2,
      maxAttempts: 4,
      retryable: true,
      retrySafe: true,
    }),
    { reconciliationReason: null, status: 'retry' },
  );
  assert.deepEqual(
    decideFailedAttempt({
      attemptCount: 2,
      maxAttempts: 4,
      retryable: true,
      retrySafe: false,
    }),
    { reconciliationReason: 'unsafe_retry', status: 'dead_letter' },
  );
  assert.deepEqual(
    decideFailedAttempt({
      attemptCount: 4,
      maxAttempts: 4,
      retryable: true,
      retrySafe: true,
    }),
    { reconciliationReason: 'attempts_exhausted', status: 'dead_letter' },
  );
});

test('reclaims a kill before effect and reconciles kills after effect start', () => {
  assert.deepEqual(
    decideExpiredAttempt({
      attemptCount: 1,
      attemptState: 'claimed',
      maxAttempts: 3,
    }),
    { attemptOutcome: 'failed', reconciliationReason: null, status: 'retry' },
  );
  assert.deepEqual(
    decideExpiredAttempt({
      attemptCount: 1,
      attemptState: 'sending',
      maxAttempts: 3,
    }),
    {
      attemptOutcome: 'outcome_unknown',
      reconciliationReason: 'lease_expired_after_effect_started',
      status: 'outcome_unknown',
    },
  );
});

/** @returns {any} */
function queueFixture() {
  /** @type {any[]} */
  const calls = [];
  const job = Object.freeze({
    attemptCount: 1,
    attemptId: 'attempt-1',
    id: 'job-1',
    jobType: 'fixture.process',
    maxAttempts: 3,
  });
  return {
    calls,
    async claim() {
      calls.push(['claim']);
      return [job];
    },
    /** @param {any} input */
    async heartbeat(input) {
      calls.push(['heartbeat', input]);
      return true;
    },
    /** @param {any} input */
    async markEffectStarted(input) {
      calls.push(['effect', input]);
      return true;
    },
    /** @param {any} input */
    async settle(input) {
      calls.push(['settle', input]);
      return input;
    },
  };
}

test('worker settles a successful effect only after marking its boundary', async () => {
  const queue = queueFixture();
  const worker = new WorkerRuntime({
    handlers: {
      'fixture.process': async (_job, context) => {
        assert.equal(await context.heartbeat(), true);
        assert.equal(
          await context.markEffectStarted({ provider: 'fixture' }),
          true,
        );
        return { outcome: 'sent', providerExternalId: 'provider-1' };
      },
    },
    logger: silentLogger,
    metrics: new MetricRegistry({ logger: silentLogger }),
    queue,
    workerId: 'worker-1',
  });

  assert.equal(await worker.runOnce(), 1);
  assert.deepEqual(
    queue.calls.map(
      /** @param {any[]} call */
      (call) => call[0],
    ),
    ['claim', 'heartbeat', 'effect', 'settle'],
  );
  assert.equal(queue.calls[3][1].outcome, 'sent');
});

test('worker distinguishes safe pre-effect failure from uncertain effect', async () => {
  const beforeQueue = queueFixture();
  const beforeWorker = new WorkerRuntime({
    handlers: {
      'fixture.process': async () => {
        throw new Error('decode failed');
      },
    },
    logger: silentLogger,
    queue: beforeQueue,
    workerId: 'worker-before',
  });
  await beforeWorker.runOnce();
  const beforeSettlement = beforeQueue.calls.find(
    /** @param {any[]} call */
    (call) => call[0] === 'settle',
  )[1];
  assert.deepEqual(
    {
      outcome: beforeSettlement.outcome,
      retryable: beforeSettlement.retryable,
      retrySafe: beforeSettlement.retrySafe,
    },
    { outcome: 'failed', retryable: true, retrySafe: true },
  );

  const afterQueue = queueFixture();
  const afterWorker = new WorkerRuntime({
    handlers: {
      'fixture.process': async (_job, context) => {
        await context.markEffectStarted({ provider: 'fixture' });
        throw new Error('connection disappeared');
      },
    },
    logger: silentLogger,
    queue: afterQueue,
    workerId: 'worker-after',
  });
  await afterWorker.runOnce();
  const afterSettlement = afterQueue.calls.find(
    /** @param {any[]} call */
    (call) => call[0] === 'settle',
  )[1];
  assert.deepEqual(
    {
      outcome: afterSettlement.outcome,
      retryable: afterSettlement.retryable,
      retrySafe: afterSettlement.retrySafe,
    },
    { outcome: 'outcome_unknown', retryable: false, retrySafe: false },
  );
});
