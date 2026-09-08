import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMediaDeleteJobHandler,
  MEDIA_RETENTION_QUEUE,
} from '../modules/integration-reliability/src/index.js';
import {
  createMediaRetentionWorkerRuntime,
  MediaRetentionScheduler,
} from '../apps/worker/src/worker.js';

test('media deletion handler removes private bytes idempotently', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const deleted = [];
  const handler = createMediaDeleteJobHandler({
    mediaVolume: {
      async delete(/** @type {Record<string, unknown>} */ input) {
        deleted.push(input);
      },
    },
    repository: {
      async markDeleted() {
        throw new Error('stored media must be deleted through the volume');
      },
      async readForDeletion() {
        return {
          availabilityStatus: 'available',
          storageKey: '10000000-0000-4000-8000-000000000001',
        };
      },
    },
  });

  assert.deepEqual(
    await handler({
      deletionReason: 'journey_terminal',
      transientMediaId: 'media-synthetic',
    }),
    { outcome: 'sent' },
  );
  assert.deepEqual(deleted, [
    {
      mediaId: 'media-synthetic',
      reason: 'journey_terminal',
      storageKey: '10000000-0000-4000-8000-000000000001',
    },
  ]);
});

test('retention scheduler covers terminal journeys and seven-day expiry', async () => {
  /** @type {string[]} */
  const calls = [];
  const scheduler = new MediaRetentionScheduler({
    intervalMs: 60_000,
    repository: {
      async scheduleExpiredDeletions() {
        calls.push('expired');
      },
      async scheduleTerminalJourneyDeletions() {
        calls.push('journey_terminal');
      },
    },
  });
  await scheduler.start();
  await scheduler.stop();
  assert.deepEqual(calls, ['journey_terminal', 'expired']);
});

test('production media worker claims only the retention queue', async () => {
  /** @type {Array<Record<string, unknown>>} */
  const claims = [];
  /** @type {Array<Record<string, unknown>>} */
  const settlements = [];
  const queue = {
    async claim(/** @type {Record<string, unknown>} */ input) {
      claims.push(input);
      return [];
    },
    async heartbeat() {
      return true;
    },
    async markEffectStarted() {
      return true;
    },
    async settle(/** @type {Record<string, unknown>} */ input) {
      settlements.push(input);
    },
  };
  const runtime = createMediaRetentionWorkerRuntime({
    database: {
      transaction: async (/** @type {Function} */ work) => work({}),
    },
    mediaVolume: { delete: async () => {} },
    queue,
    repository: {
      markDeleted: async () => {},
      readForDeletion: async () => null,
    },
  });

  assert.equal(await runtime.runOnce(), 0);
  assert.equal(claims[0].queue, MEDIA_RETENTION_QUEUE);
  assert.equal(settlements.length, 0);
});
