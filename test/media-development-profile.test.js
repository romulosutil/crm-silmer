import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMediaDevelopmentConfig,
  loadMediaDevelopmentSecrets,
} from '../scripts/dev-media.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('T23 missing original keys with existing profile volumes fails before any file is written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crm-media-secret-loss-'));
  try {
    await assert.rejects(
      loadMediaDevelopmentSecrets(root, async () => [
        'crm-silmer-media-local_postgres-data',
      ]),
      /restore the original secrets/u,
    );
    assert.deepEqual(await readdir(root), []);
    assert.equal(
      await loadMediaDevelopmentSecrets(root, async () => []),
      undefined,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T23 local media profile requires opt-in and leaves text startup media disabled', () => {
  assert.equal(
    createMediaDevelopmentConfig({}).api.CHAT_MEDIA_ENABLED,
    'false',
  );
  assert.equal(
    createMediaDevelopmentConfig({}).api.CHAT_MEDIA_READ_ENABLED,
    'true',
  );
  assert.equal(
    createMediaDevelopmentConfig({ enabled: true }).api.CHAT_MEDIA_ENABLED,
    'true',
  );
});
test('T23 local media profile shares only loopback HTTP between built runtimes', () => {
  const config = createMediaDevelopmentConfig({ enabled: true });
  assert.equal(config.api.MEDIA_S3_ENDPOINT, 'http://127.0.0.1:9000');
  assert.equal(
    config.worker.N8N_COMMAND_URL,
    'http://127.0.0.1:5678/webhook/silmer/local-panel-command',
  );
  assert.equal(config.n8n.SILMER_PANEL_BASE_URL, 'http://127.0.0.1:3000');
});
test('T23 roles do not expose bootstrap credentials to API, worker or n8n', () => {
  const config = createMediaDevelopmentConfig({ enabled: true });
  assert.notEqual(
    config.api.MEDIA_S3_ACCESS_KEY_ID,
    config.worker.MEDIA_S3_ACCESS_KEY_ID,
  );
  for (const environment of [config.api, config.worker, config.n8n]) {
    assert.equal(Object.hasOwn(environment, 'RUSTFS_ACCESS_KEY'), false);
    assert.equal(Object.hasOwn(environment, 'RUSTFS_SECRET_KEY'), false);
  }
  assert.equal(Object.hasOwn(config.n8n, 'MEDIA_S3_SECRET_ACCESS_KEY'), false);
});
test('T23 profile preserves keys across restart and rejects incomplete persisted secret state', () => {
  const config = createMediaDevelopmentConfig({});
  const restarted = createMediaDevelopmentConfig({ secrets: config.secrets });
  assert.deepEqual(restarted.api, config.api);
  assert.throws(
    () => createMediaDevelopmentConfig({ secrets: {} }),
    /Local media secrets incomplete/u,
  );
});
test('T23 profile isolates persistent spool from legacy media and retains records', () => {
  const config = createMediaDevelopmentConfig({ enabled: true });
  assert.equal(config.api.CHAT_MEDIA_SPOOL_ROOT, '/var/lib/crm-chat-media');
  assert.equal(config.api.PRIVATE_MEDIA_ROOT, '/var/lib/crm-legacy-media');
  assert.equal(
    config.worker.CHAT_MEDIA_SPOOL_ROOT,
    config.api.CHAT_MEDIA_SPOOL_ROOT,
  );
  assert.equal(config.api.CHAT_MEDIA_BUCKET_ALIAS, 'chat-dev');
  assert.equal(config.worker.MEDIA_S3_BUCKET, 'crm-silmer-chat-media-dev');
});
test('T23 local profile makes scanner signatures and worker budget explicit', () => {
  const config = createMediaDevelopmentConfig({ enabled: true });
  assert.equal(config.worker.CHAT_MEDIA_ENABLED, 'true');
  assert.equal(config.worker.N8N_INTEGRATION_ENABLED, 'true');
  assert.equal(config.worker.APP_ENV, 'development');
  assert.equal(config.n8n.N8N_DEFAULT_BINARY_DATA_MODE, 'default');
  assert.equal(config.n8n.N8N_CONCURRENCY_PRODUCTION_LIMIT, '1');
});
