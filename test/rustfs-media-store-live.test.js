import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { RustfsMediaStore } from '../modules/integration-reliability/src/rustfs-media-store.js';

if (process.env.RUN_RUSTFS_LIVE_SMOKE === 'yes') {
  test('T3 pinned SDK streams exact bytes against isolated RustFS, conditional replay and Range', async () => {
    const env = process.env;
    assert.equal(
      env.MEDIA_S3_BUCKET,
      'crm-silmer-chat-media-dev',
      'Live SDK fixture writes only synthetic DEV bucket',
    );
    const adapter = new RustfsMediaStore({
      bucket: env.MEDIA_S3_BUCKET,
      endpoint: env.MEDIA_S3_ENDPOINT,
      region: env.MEDIA_S3_REGION,
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
    });
    const key = randomUUID();
    const body = Buffer.from(
      'CRM synthetic SDK media bytes; no customer data.',
    );
    const sha256 = createHash('sha256').update(body).digest('hex');
    const input = () => ({
      key,
      stream: Readable.from([body.subarray(0, 7), body.subarray(7)]),
      sha256,
      sizeBytes: body.length,
      mimeType: 'image/jpeg',
    });
    /** @param {AsyncIterable<Uint8Array>} stream */
    async function bytes(stream) {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    try {
      assert.deepEqual(await adapter.putValidated(input()), {
        sizeBytes: body.length,
        sha256,
      });
      assert.deepEqual(await adapter.head(key), {
        sizeBytes: body.length,
        sha256,
        mimeType: 'image/jpeg',
      });
      const read = await adapter.read(key);
      assert.deepEqual(await bytes(read.stream), body);
      const range = await adapter.read(key, 'bytes=0-6');
      assert.equal(range.contentRange, `bytes 0-6/${body.length}`);
      assert.deepEqual(await bytes(range.stream), body.subarray(0, 7));
      assert.deepEqual(await adapter.putValidated(input()), {
        sizeBytes: body.length,
        sha256,
      });
      const changed = Buffer.from('different synthetic variant');
      await assert.rejects(
        adapter.putValidated({
          ...input(),
          stream: Readable.from([changed]),
          sizeBytes: changed.length,
          sha256: createHash('sha256').update(changed).digest('hex'),
        }),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'MEDIA_STORAGE_UNAVAILABLE',
      );
      const preserved = await adapter.read(key);
      assert.deepEqual(await bytes(preserved.stream), body);
    } finally {
      await adapter.deleteDraft(key);
    }
    await assert.rejects(
      adapter.head(key),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'MEDIA_OBJECT_MISSING',
    );
  });
}
