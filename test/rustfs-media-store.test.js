import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { RustfsMediaStore } from '../modules/integration-reliability/src/rustfs-media-store.js';

const KEY = '00000000-0000-4000-8000-000000000001';
const BYTES = Buffer.from('synthetic media bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');
/** @param {(command: any, options: any) => Promise<any>} send */
function store(send) {
  return new RustfsMediaStore({
    bucket: 'crm-silmer-chat-media-dev',
    client: { send },
    timeoutMs: 20,
  });
}
/** @param {AsyncIterable<Uint8Array>} stream */
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const upload = () => ({
  key: KEY,
  stream: Readable.from([BYTES.subarray(0, 3), BYTES.subarray(3)]),
  sizeBytes: BYTES.length,
  sha256: SHA,
  mimeType: 'image/jpeg',
});

test('T3 PUT streams exact bytes with immutable digest and size, without public location', async () => {
  const result = await store(async (command) => {
    assert.equal(command.input.Bucket, 'crm-silmer-chat-media-dev');
    assert.equal(command.input.ContentLength, BYTES.length);
    assert.equal(command.input.IfNoneMatch, '*');
    assert.equal(
      command.input.ChecksumSHA256,
      Buffer.from(SHA, 'hex').toString('base64'),
    );
    assert.deepEqual(command.input.Metadata, { sha256: SHA });
    assert.deepEqual(await collect(command.input.Body), BYTES);
    return { ETag: 'untrusted-etag' };
  }).putValidated(upload());
  assert.deepEqual(result, { sizeBytes: BYTES.length, sha256: SHA });
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('T3 HEAD maps exact private metadata without provider identifiers', async () => {
  const result = await store(async () => ({
    ContentLength: BYTES.length,
    ContentType: 'image/jpeg',
    Metadata: { sha256: SHA },
    ETag: 'private-provider-id',
  })).head(KEY);
  assert.deepEqual(result, {
    sizeBytes: BYTES.length,
    sha256: SHA,
    mimeType: 'image/jpeg',
  });
});

test('T3 existing conditional PUT reconciles exact digest/size and cannot overwrite different variant', async () => {
  for (const [sha256, succeeds] of [
    [SHA, true],
    ['a'.repeat(64), false],
  ]) {
    const adapter = store(async (command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        throw { $metadata: { httpStatusCode: 412 } };
      }
      return {
        ContentLength: BYTES.length,
        ContentType: 'image/jpeg',
        Metadata: { sha256 },
      };
    });
    if (succeeds)
      assert.deepEqual(await adapter.putValidated(upload()), {
        sizeBytes: BYTES.length,
        sha256: SHA,
      });
    else
      await assert.rejects(
        adapter.putValidated(upload()),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'MEDIA_STORAGE_UNAVAILABLE',
      );
  }
});

test('T3 read and Range preserve streaming bytes and Content-Range', async () => {
  const result = await store(async (command) => {
    assert.equal(command.input.Range, 'bytes=0-2');
    return {
      Body: Readable.from([BYTES.subarray(0, 3)]),
      ContentLength: 3,
      ContentType: 'image/jpeg',
      Metadata: { sha256: SHA },
      ContentRange: `bytes 0-2/${BYTES.length}`,
    };
  }).read(KEY, 'bytes=0-2');
  assert.equal(result.contentRange, `bytes 0-2/${BYTES.length}`);
  assert.equal(result.sizeBytes, 3);
  assert.deepEqual(await collect(result.stream), BYTES.subarray(0, 3));
});

test('T3 missing, invalid Range and provider timeout are distinguishable and sanitized', async () => {
  for (const [status, code] of [
    [404, 'MEDIA_OBJECT_MISSING'],
    [416, 'MEDIA_INVALID_RANGE'],
    [503, 'MEDIA_STORAGE_UNAVAILABLE'],
  ]) {
    await assert.rejects(
      store(async () => {
        throw {
          $metadata: { httpStatusCode: status },
          message: 'secret URL credentials',
        };
      }).read(KEY),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === code &&
        !JSON.stringify(error).includes('secret'),
    );
  }
});

test('T3 abort deadline is passed to SDK and timed-out request remains unavailable', async () => {
  await assert.rejects(
    store(async (_command, options) => {
      await new Promise((resolve) => {
        options.abortSignal.addEventListener('abort', resolve, { once: true });
        setTimeout(resolve, 100);
      });
      throw new Error('provider timeout with credentials');
    }).head(KEY),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'MEDIA_STORAGE_UNAVAILABLE',
  );
});

test('T3 wrong byte count/hash prevents successful PUT even if provider accepts bytes', async () => {
  const adapter = store(async (command) => {
    await collect(command.input.Body);
    return {};
  });
  await assert.rejects(
    adapter.putValidated({ ...upload(), sha256: 'a'.repeat(64) }),
    /Unable to store private media/u,
  );
  await assert.rejects(
    adapter.putValidated({ ...upload(), sizeBytes: BYTES.length - 1 }),
    /Unable to store private media/u,
  );
});

test('T3 partial read failure emits sanitized stream error', async () => {
  async function* failing() {
    yield BYTES.subarray(0, 3);
    throw new Error('s3://private-key?secret=credential');
  }
  const result = await store(async () => ({
    Body: Readable.from(failing()),
    ContentLength: BYTES.length,
    ContentType: 'image/jpeg',
    Metadata: { sha256: SHA },
  })).read(KEY);
  await assert.rejects(
    collect(result.stream),
    (error) =>
      error instanceof Error &&
      error.message === 'Private media storage is unavailable',
  );
});

test('T3 DELETE is draft-only caller contract and arbitrary keys/buckets are refused', async () => {
  let target;
  await store(async (command) => {
    target = command.input;
    return {};
  }).deleteDraft(KEY);
  assert.deepEqual(target, { Bucket: 'crm-silmer-chat-media-dev', Key: KEY });
  await assert.rejects(
    store(async () => ({})).head('../customer-name.jpg'),
    /Invalid private media key/u,
  );
  assert.throws(
    () =>
      new RustfsMediaStore({
        bucket: 'hermes-backups',
        client: { send: async () => ({}) },
      }),
    /isolated CRM bucket/u,
  );
});
