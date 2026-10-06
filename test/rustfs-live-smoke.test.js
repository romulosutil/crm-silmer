import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  runRustfsLiveSmoke,
  validateRustfsSmokeEnvironment,
} from '../scripts/rustfs-live-smoke.mjs';

const env = {
  RUN_RUSTFS_LIVE_SMOKE: 'yes',
  MEDIA_S3_ENDPOINT: 'https://s3.example.test',
  MEDIA_S3_REGION: 'us-east-1',
  MEDIA_S3_BUCKET: 'crm-silmer-chat-media-dev',
  MEDIA_S3_ACCESS_KEY_ID: 'synthetic-limited-key',
  MEDIA_S3_SECRET_ACCESS_KEY: 'synthetic-secret-not-real',
  RUSTFS_SMOKE_DENIED_BUCKET: 'crm-silmer-chat-media',
  RUSTFS_RUNNING_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
};

/** @param {{rangeStatus?: number, anonymousStatus?: number, crossStatus?: number, corrupt?: boolean, transportFailure?: boolean, lifecycle?: boolean}} [fault] */
function harness(fault = {}) {
  /** @type {Array<{method: string, path: string, signed: boolean}>} */
  const calls = [];
  /** @type {Uint8Array|undefined} */
  let stored;
  let removed = false;
  /** @type {Record<string, unknown>|undefined} */
  let evidence;
  /** @type {typeof fetch} */
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method ?? 'GET';
    const headers = new globalThis.Headers(options.headers);
    const signed = headers.has('authorization');
    calls.push({ method, path: url.pathname, signed });
    if (url.pathname.startsWith('/crm-silmer-chat-media/')) {
      return new globalThis.Response(null, {
        status: fault.crossStatus ?? 403,
      });
    }
    if (!signed) {
      return new globalThis.Response(null, {
        status: fault.anonymousStatus ?? 403,
      });
    }
    assert.match(
      headers.get('authorization') ?? '',
      /^AWS4-HMAC-SHA256 Credential=synthetic-limited-key\//u,
    );
    if (url.search === '?lifecycle=') {
      return new globalThis.Response(
        fault.lifecycle
          ? '<LifecycleConfiguration><Rule><Status>Enabled</Status><Expiration><Days>7</Days></Expiration></Rule></LifecycleConfiguration>'
          : '<Error><Code>NoSuchLifecycleConfiguration</Code></Error>',
        { status: fault.lifecycle ? 200 : 404 },
      );
    }
    if (method === 'PUT') {
      stored = new Uint8Array(/** @type {Uint8Array} */ (options.body));
      if (fault.transportFailure)
        throw new Error(env.MEDIA_S3_SECRET_ACCESS_KEY);
      return new globalThis.Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
      removed = true;
      stored = undefined;
      return new globalThis.Response(null, { status: 204 });
    }
    if (!stored) return new globalThis.Response(null, { status: 404 });
    if (method === 'HEAD')
      return new globalThis.Response(null, {
        status: 200,
        headers: {
          'content-length': String(stored.length),
          'x-amz-meta-sha256': createHash('sha256')
            .update(stored)
            .digest('hex'),
        },
      });
    if (headers.get('range') === 'bytes=0-7')
      return new globalThis.Response(stored.slice(0, 8), {
        status: fault.rangeStatus ?? 206,
        headers: { 'content-range': `bytes 0-7/${stored.length}` },
      });
    if (headers.has('range'))
      return new globalThis.Response(null, { status: 416 });
    return new globalThis.Response(
      fault.corrupt ? 'wrong bytes' : Uint8Array.from(stored),
      { status: 200 },
    );
  };
  return {
    calls,
    removed: () => removed,
    evidence: () => evidence,
    run: () =>
      runRustfsLiveSmoke({
        env,
        fetchImpl,
        randomUuid: () => '00000000-0000-4000-8000-000000000001',
        now: () => new Date('2026-10-05T12:00:00Z'),
        writeEvidence: async (value) => {
          evidence = value;
        },
      }),
  };
}

test('T1 synthetic smoke verifies bytes, HEAD hash/size, ranges, denials and cleanup', async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(result.checks, {
    put: true,
    headHashAndSize: true,
    getHashAndSize: true,
    range: true,
    invalidRange: true,
    anonymousDenied: true,
    crossBucketDenied: true,
    noExpiryLifecycle: true,
    deleteAndMissing: true,
  });
  assert.equal(h.removed(), true);
  assert.equal(result.runningImageDigest, env.RUSTFS_RUNNING_IMAGE_DIGEST);
  assert.equal(result.syntheticOnly, true);
  const serialized = JSON.stringify(h.evidence());
  assert.equal(serialized.includes(env.MEDIA_S3_SECRET_ACCESS_KEY), false);
  assert.equal(serialized.includes(env.MEDIA_S3_ACCESS_KEY_ID), false);
  assert.equal(
    serialized.includes('00000000-0000-4000-8000-000000000001'),
    false,
  );
  assert.equal(
    h.calls.some(({ path }) => path.includes('hermes')),
    false,
  );
});

test('T1 refuses Hermes bucket and cross-environment reuse before network', () => {
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...env,
        MEDIA_S3_BUCKET: 'hermes-backups',
      }),
    /CRM bucket/u,
  );
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...env,
        RUSTFS_SMOKE_DENIED_BUCKET: env.MEDIA_S3_BUCKET,
      }),
    /distinct/u,
  );
});

test('T1 requires explicit live opt-in, HTTPS origin and runtime digest', () => {
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...env,
        RUN_RUSTFS_LIVE_SMOKE: undefined,
      }),
    /authorization/u,
  );
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...env,
        MEDIA_S3_ENDPOINT: 'http://s3.example.test',
      }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...env,
        RUSTFS_RUNNING_IMAGE_DIGEST: 'rustfs/rustfs:1.0.0-alpha.99',
      }),
    /digest/u,
  );
});

test('T1 public anonymous read cannot produce PASS', async () => {
  const h = harness({ anonymousStatus: 200 });
  await assert.rejects(h.run(), /anonymous access/u);
  assert.equal(h.evidence(), undefined);
  assert.equal(h.removed(), true);
});

test('T1 isolated HTTP canary permits only loopback and its known synthetic deny bucket', () => {
  const local = {
    ...env,
    MEDIA_S3_ENDPOINT: 'http://127.0.0.1:21900',
    RUSTFS_SMOKE_DENIED_BUCKET: 'crm-silmer-smoke-denied-local',
  };
  assert.equal(validateRustfsSmokeEnvironment(local).localLoopback, true);
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...local,
        MEDIA_S3_ENDPOINT: 'http://192.0.2.1:21900',
      }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      validateRustfsSmokeEnvironment({
        ...local,
        MEDIA_S3_ENDPOINT: 'https://s3.example.test',
      }),
    /CRM bucket/u,
  );
});

test('T1 cross-bucket credential access cannot produce PASS', async () => {
  const h = harness({ crossStatus: 200 });
  await assert.rejects(h.run(), /cross-bucket access/u);
  assert.equal(h.evidence(), undefined);
  assert.equal(h.removed(), true);
});

test('T1 ignored Range and changed bytes fail and remove only canary', async () => {
  for (const fault of [{ rangeStatus: 200 }, { corrupt: true }]) {
    const h = harness(fault);
    await assert.rejects(h.run(), /Range|GET/u);
    assert.equal(h.evidence(), undefined);
    assert.equal(h.removed(), true);
  }
});

test('T1 PUT response loss attempts cleanup and never discloses raw transport error', async () => {
  const h = harness({ transportFailure: true });
  await assert.rejects(
    h.run(),
    (error) =>
      error instanceof Error &&
      error.message === 'RustFS smoke failed at PUT; no live PASS recorded',
  );
  assert.equal(h.removed(), true);
  assert.equal(h.evidence(), undefined);
});

test('T1 expiry lifecycle prevents activation without changing provider settings', async () => {
  const h = harness({ lifecycle: true });
  await assert.rejects(h.run(), /lifecycle/u);
  assert.equal(
    h.calls.some(({ method }) => method === 'PUT'),
    false,
  );
  assert.equal(h.evidence(), undefined);
});
