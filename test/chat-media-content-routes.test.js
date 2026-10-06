import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createApi } from '../apps/api/src/app.js';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { registerChatMediaContentRoutes } from '../apps/api/src/chat-media-content-routes.js';

const id = '20000000-0000-4000-8000-000000000001';
/** @param {any} t @param {any} [options] */
function harness(t, options = {}) {
  const bytes = options.large
    ? Buffer.alloc(16 * 1024 * 1024, 7)
    : Buffer.from('abcdefghij');
  const row = {
    id,
    state: 'attached',
    validation_status: 'clean',
    size_bytes: bytes.length,
    content_sha256: 'a'.repeat(64),
    detected_mime_type: 'image/png',
    object_key: id,
    storage_bucket_alias: 'chat-dev',
    version: 3,
    ...options.row,
  };
  let calls = 0;
  const repository = {
    async readForActor() {
      if (options.forbidden)
        throw Object.assign(new Error('secret-key'), { statusCode: 403 });
      return row;
    },
    async markLost() {
      row.state = 'lost';
      return true;
    },
  };
  const store = {
    async head() {
      calls++;
      if (options.unavailable && calls === 1)
        throw Object.assign(new Error('secret-key'), {
          code: 'MEDIA_STORAGE_UNAVAILABLE',
        });
      if (options.missing)
        throw Object.assign(new Error('secret-key'), {
          code: 'MEDIA_OBJECT_MISSING',
        });
      return {
        sizeBytes: bytes.length,
        sha256: row.content_sha256,
        mimeType: options.badMime ? 'text/plain' : 'image/png',
      };
    },
    async read(
      /** @type {string} */ _key,
      /** @type {string|undefined} */ range,
    ) {
      const match = range?.match(/^bytes=(\d+)-(\d+)$/u);
      const start = match ? Number(match[1]) : 0;
      const end = match ? Number(match[2]) : bytes.length - 1;
      const output = bytes.subarray(start, end + 1);
      return {
        sizeBytes: output.length,
        sha256: row.content_sha256,
        mimeType: 'image/png',
        contentRange:
          match && !options.ignoredRange
            ? `bytes ${start}-${end}/${bytes.length}`
            : null,
        stream: Readable.from(
          (function* () {
            for (let offset = 0; offset < output.length; offset += 65536)
              yield output.subarray(offset, offset + 65536);
          })(),
        ),
      };
    },
  };
  const runtime = createChatMediaApiRuntime({
    repository,
    access: {
      async authorizeRead() {
        return { actor: { id: 'seller' } };
      },
    },
    spoolRoot: 'var/media-test-unused',
    envelopeKey: Buffer.alloc(32),
    store,
    bucketAlias: row.storage_bucket_alias,
  });
  const api = createApi();
  registerChatMediaContentRoutes(api, runtime, () => ({
    requestId: 'synthetic',
  }));
  t.after(() => api.close());
  return {
    row,
    get: (headers = {}) =>
      api.inject({
        method: 'GET',
        url: `/api/v1/conversations/conversation/media/${id}/content`,
        headers: { cookie: 'crm_session=synthetic', ...headers },
      }),
  };
}
test('MED-15/17: full retained attached bytes remain readable with private headers', async (t) => {
  const response = await harness(t, {
    row: { created_at: '2025-01-01', conversation_state: 'encerrada' },
  }).get();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'abcdefghij');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal(response.headers['content-length'], '10');
});
for (const [range, expected, contentRange] of [
  ['bytes=2-4', 'cde', 'bytes 2-4/10'],
  ['bytes=7-', 'hij', 'bytes 7-9/10'],
  ['bytes=-3', 'hij', 'bytes 7-9/10'],
  ['bytes=-99', 'abcdefghij', 'bytes 0-9/10'],
  ['bytes=8-99', 'ij', 'bytes 8-9/10'],
])
  test(`MED-17: range ${range} returns exact 206`, async (t) => {
    const response = await harness(t).get({ range });
    assert.equal(response.statusCode, 206);
    assert.equal(response.body, expected);
    assert.equal(response.headers['content-range'], contentRange);
    assert.equal(Number(response.headers['content-length']), expected.length);
  });
for (const range of [
  'bytes=10-',
  'bytes=3-2',
  'bytes=-0',
  'bytes=0-1,3-4',
  'invalid',
])
  test(`MED-17: invalid range ${range} returns 416 without bytes`, async (t) => {
    const response = await harness(t).get({ range });
    assert.equal(response.statusCode, 416);
    assert.equal(response.headers['content-range'], 'bytes */10');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.body.includes('abcdefghij'), false);
  });
test('MED-16: missing session and forbidden actor cannot read bytes', async (t) => {
  assert.equal((await harness(t).get({ cookie: '' })).statusCode, 401);
  assert.equal(
    (await harness(t).get({ cookie: '' })).headers['cache-control'],
    'private, no-store',
  );
  assert.equal((await harness(t, { forbidden: true }).get()).statusCode, 403);
});
test('MED-19: transient storage failure recovers without durable state replacement', async (t) => {
  const h = harness(t, { unavailable: true });
  assert.equal((await h.get()).statusCode, 503);
  assert.equal(h.row.state, 'attached');
  assert.equal((await h.get()).statusCode, 200);
});
test('MED-19: confirmed missing object returns 410 and marks lost', async (t) => {
  const h = harness(t, { missing: true });
  const response = await h.get();
  assert.equal(response.statusCode, 410);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(h.row.state, 'lost');
  assert.equal(response.body.includes('secret-key'), false);
});
test('MED-17/19: storage metadata mismatch and ignored Range fail before bytes', async (t) => {
  assert.equal((await harness(t, { badMime: true }).get()).statusCode, 503);
  assert.equal(
    (await harness(t, { ignoredRange: true }).get({ range: 'bytes=1-2' }))
      .statusCode,
    503,
  );
});
test('MED-17: large object streams in bounded chunks', async (t) => {
  const response = await harness(t, { large: true }).get();
  assert.equal(response.statusCode, 200);
  assert.equal(response.rawPayload.length, 16 * 1024 * 1024);
  assert.equal(response.rawPayload[response.rawPayload.length - 1], 7);
});
test('MED-15: unvalidated content is blocked before storage read', async (t) => {
  assert.equal(
    (
      await harness(t, {
        row: { state: 'rejected', validation_status: 'invalid_format' },
      }).get()
    ).statusCode,
    409,
  );
});
test('MED-15/16: disabling admission preserves history routes', async (t) => {
  const api = createApi(
    {},
    {
      chatMedia: {
        admissionEnabled: false,
        async authorizeRead() {
          return { actor: { id: 'seller' } };
        },
        async status() {
          return { mediaId: id, state: 'attached' };
        },
        async content() {
          return {
            statusCode: 200,
            headers: { 'Cache-Control': 'private, no-store' },
            stream: Readable.from(['retained']),
          };
        },
      },
    },
  );
  t.after(() => api.close());
  const headers = { cookie: 'crm_session=synthetic' };
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/api/v1/conversations/c/media',
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/api/v1/conversations/c/media/${id}`,
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await api.inject({
        method: 'GET',
        url: `/api/v1/conversations/c/media/${id}/content`,
        headers,
      })
    ).body,
    'retained',
  );
});
