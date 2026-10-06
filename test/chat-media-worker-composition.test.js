import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createChatMediaWorkerRuntime,
  startWorkerServices,
} from '../apps/worker/src/worker.js';
import { ClamAvSignatureRefresh } from '../modules/integration-reliability/src/clamav-signature-refresh.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

test('T6 production composition selects media queue and registers process handler', () => {
  const worker = createChatMediaWorkerRuntime({
    database: {},
    repository: { acquire() {}, prepare() {}, ready() {}, fail() {} },
    store: { head() {}, putValidated() {} },
    spoolRoot: tmpdir(),
    queue: {},
  });
  assert.equal(worker.queueName, 'chat_media');
  assert.equal(typeof worker.handlers['chat_media.process'], 'function');
});

test('T6 technical media dimensions remain observable while paths and credentials are dropped', () => {
  const logger = createSafeLogger({
    service: 'crm-silmer-worker',
    sink: () => {},
  });
  const result = logger.error('worker_job_failed', {
    error_code: 'MEDIA_PROCESS_UNAVAILABLE',
    job_type: 'chat_media.process',
    queue: 'chat_media',
    object_key: 'private-key-canary',
    secret: 'private-secret-canary',
  });
  assert.equal(result.error_code, 'MEDIA_PROCESS_UNAVAILABLE');
  assert.equal(result.job_type, 'chat_media.process');
  assert.equal(result.queue, 'chat_media');
  assert.doesNotMatch(JSON.stringify(result), /private-.*-canary/u);
});

test('T6 text worker starts while signature CDN refresh remains pending', async () => {
  let textStarted = false;
  let refreshStarted = false;
  let release = () => {};
  const pending = new Promise((done) => {
    release = () => done(undefined);
  });
  await startWorkerServices({
    commandWorker: {
      async start() {
        textStarted = true;
      },
    },
    mediaWorker: { async start() {} },
    retentionScheduler: { async start() {} },
    signatureRefresh: {
      async start() {
        refreshStarted = true;
        await pending;
      },
    },
  });
  assert.equal(textStarted, true);
  assert.equal(refreshStarted, true);
  release();
});

test('T22 media cleanup scheduler is started with workers', async () => {
  /** @type {string[]} */ const starts = [];
  await startWorkerServices({
    commandWorker: {
      async start() {
        starts.push('text');
      },
    },
    mediaWorker: {
      async start() {
        starts.push('legacy');
      },
    },
    chatMediaCleanup: {
      async start() {
        starts.push('draft-cleanup');
      },
    },
    retentionScheduler: {
      async start() {
        starts.push('legacy-scheduler');
      },
    },
    signatureRefresh: {
      async start() {
        starts.push('signatures');
      },
    },
  });
  assert.deepEqual(starts, [
    'text',
    'legacy',
    'draft-cleanup',
    'legacy-scheduler',
    'signatures',
  ]);
});

test('T6 refresh concurrent starts share download and stop cannot resurrect timer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-refresh-stop-'));
  let calls = 0;
  let release = () => {};
  const pending = new Promise((done) => {
    release = () => done(undefined);
  });
  const refresh = new ClamAvSignatureRefresh({
    markerPath: join(root, 'verified'),
    async execFileImpl() {
      calls++;
      await pending;
    },
  });
  try {
    const starts = [refresh.start(), refresh.start()];
    const stopped = refresh.stop();
    release();
    await Promise.all([...starts, stopped]);
    assert.equal(calls, 1);
    assert.equal(refresh.timer, undefined);
  } finally {
    await refresh.stop();
    await rm(root, { recursive: true, force: true });
  }
});
