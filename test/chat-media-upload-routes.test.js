import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { createApi } from '../apps/api/src/app.js';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';

const headers = {
  cookie: 'crm_session=synthetic; crm_csrf=synthetic-csrf',
  origin: 'https://crm.example.test',
  'x-csrf-token': 'synthetic-csrf',
  'idempotency-key': 'synthetic-upload',
  'content-type': 'multipart/form-data; boundary=synthetic-boundary',
};
/** @param {Buffer} bytes @param {Record<string,string>} [fields] @param {boolean} [complete] */
function multipart(bytes, fields = {}, complete = true) {
  const values = {
    kind: 'image',
    origin: 'attachment',
    expectedVersion: '1',
    ...fields,
  };
  const start = Object.entries(values)
    .map(
      ([name, value]) =>
        `--synthetic-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
    .join('');
  return Buffer.concat([
    Buffer.from(
      `${start}--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="private-canary.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(complete ? '\r\n--synthetic-boundary--\r\n' : ''),
  ]);
}
/** @param {any} t @param {Record<string,any>} [options] */
async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crm-media-upload-'));
  const records = new Map();
  const reservations = new Map();
  const repository = {
    async admit(/** @type {any} */ input) {
      if (options.statusCode)
        throw Object.assign(new Error('private-canary'), {
          statusCode: options.statusCode,
        });
      const existing = records.get(input.idempotencyKey);
      if (existing)
        return {
          replay: {
            id: existing.id,
            request_fingerprint: existing.fingerprint,
          },
        };
      reservations.set(input.id, input.reservationBytes);
      return input;
    },
    async complete(/** @type {any} */ input) {
      const existing = records.get(input.idempotencyKey);
      if (existing && existing.fingerprint !== input.fingerprint)
        throw Object.assign(new Error('private-canary'), { statusCode: 409 });
      if (existing) return { mediaId: existing.id, duplicate: true };
      assert.ok(reservations.get(input.id) >= input.sizeBytes * 2);
      records.set(input.idempotencyKey, input);
      reservations.delete(input.id);
      return { mediaId: input.id, duplicate: false };
    },
    async release(/** @type {string} */ id) {
      reservations.delete(id);
    },
    async cleanupDisposition() {
      return 'receiving';
    },
  };
  const access = {
    async authorize(/** @type {any} */ input) {
      if (input.csrfToken !== 'synthetic-csrf')
        throw Object.assign(new Error('private-canary'), { statusCode: 403 });
      return {
        actor: { id: 'synthetic-seller', kind: 'human', capabilities: [] },
      };
    },
  };
  const runtime = createChatMediaApiRuntime({
    repository,
    access,
    spoolRoot: root,
    envelopeKey: Buffer.alloc(32, 7),
    ...(options.removeFile ? { removeFile: options.removeFile } : {}),
  });
  const api = createApi({}, { chatMedia: runtime });
  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });
  const post = (
    payload = multipart(Buffer.from('synthetic-bytes')),
    extra = {},
  ) =>
    api.inject({
      method: 'POST',
      url: '/api/v1/conversations/synthetic-conversation/media',
      headers: { ...headers, ...extra },
      payload,
    });
  return { post, root, records, reservations };
}

test('MED-01/20: accepted upload is private and leaves complete spool for one job', async (t) => {
  const h = await harness(t);
  const response = await h.post();
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().state, 'processing');
  assert.match(response.json().mediaId, /^[a-f0-9-]{36}$/u);
  const saved = [...h.records.values()][0];
  assert.equal(saved.sizeBytes, 15);
  assert.equal(saved.declaredMimeType, 'image/png');
  assert.equal(saved.reservationBytes, 30);
  assert.equal(saved.filenameEnvelope.algorithm, 'AES-256-GCM');
  const envelope = saved.filenameEnvelope;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.alloc(32, 7),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(`chat-media-filename:${saved.id}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  assert.deepEqual(
    JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ),
    { filename: 'private-canary.png' },
  );
  assert.equal(
    JSON.stringify(saved.filenameEnvelope).includes('private-canary'),
    false,
  );
  assert.deepEqual(await readdir(h.root), [saved.id]);
  assert.equal(response.body.includes('private-canary'), false);
});
test('MED-06: byte-identical replay preserves media ID and removes replay spool', async (t) => {
  const h = await harness(t);
  const first = await h.post();
  const replay = await h.post();
  assert.equal(replay.statusCode, 202);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(h.records.size, 1);
  assert.equal(h.reservations.size, 0);
  assert.equal((await readdir(h.root)).length, 1);
});
test('MED-07: same command different bytes returns 409 and cleans failed spool', async (t) => {
  const h = await harness(t);
  await h.post();
  const response = await h.post(multipart(Buffer.from('other-bytes')));
  assert.equal(response.statusCode, 409);
  assert.equal(h.records.size, 1);
  assert.equal(h.reservations.size, 0);
  assert.equal((await readdir(h.root)).length, 1);
});
for (const statusCode of [403, 409, 429, 503])
  test(`MED-08/28: admission ${statusCode} writes no bytes`, async (t) => {
    const h = await harness(t, { statusCode });
    const response = await h.post();
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.json().accepted, false);
    assert.equal(response.json().status, statusCode);
    assert.equal(
      response.json().error.code,
      /** @type {Record<number,string>} */ ({
        403: 'FORBIDDEN',
        409: 'MEDIA_CONFLICT',
        429: 'MEDIA_RATE_LIMITED',
        503: 'SERVICE_UNAVAILABLE',
      })[statusCode],
    );
    assert.equal(
      response.headers['content-type'],
      'application/problem+json; charset=utf-8',
    );
    assert.equal(h.records.size, 0);
    assert.deepEqual(await readdir(h.root), []);
    assert.equal(response.body.includes('private-canary'), false);
  });
test('MED-16: absent session returns 401 before admission', async (t) => {
  const h = await harness(t);
  const response = await h.post(undefined, { cookie: '' });
  assert.equal(response.statusCode, 401);
  assert.equal(h.records.size, 0);
  assert.deepEqual(await readdir(h.root), []);
});
test('MED-08: CSRF mismatch returns 403 before bytes', async (t) => {
  const h = await harness(t);
  const response = await h.post(undefined, { 'x-csrf-token': 'wrong' });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(await readdir(h.root), []);
});
test('MED-04: image above 5 MiB returns 413 even with false Content-Length', async (t) => {
  const h = await harness(t);
  const response = await h.post(
    multipart(Buffer.alloc(5 * 1024 * 1024 + 1, 1)),
    { 'content-length': '1' },
  );
  assert.equal(response.statusCode, 413);
  assert.equal(h.records.size, 0);
  assert.equal(h.reservations.size, 0);
  assert.deepEqual(await readdir(h.root), []);
});
test('MED-04: truncated multipart never publishes job and confirms cleanup', async (t) => {
  const h = await harness(t);
  const response = await h.post(multipart(Buffer.from('partial'), {}, false));
  assert.equal(response.statusCode, 422);
  assert.equal(h.records.size, 0);
  assert.equal(h.reservations.size, 0);
  assert.deepEqual(await readdir(h.root), []);
});
for (const fields of /** @type {Record<string,string>[]} */ ([
  { kind: 'document' },
  { origin: 'recording' },
  { expectedVersion: '0' },
  { unexpected: 'value' },
]))
  test(`MED-04: invalid fields ${JSON.stringify(fields)} return 422`, async (t) => {
    const h = await harness(t);
    const response = await h.post(multipart(Buffer.from('bytes'), fields));
    assert.equal(response.statusCode, 422);
    assert.equal(h.records.size, 0);
    assert.deepEqual(await readdir(h.root), []);
  });
test('MED-29: zero bytes rejected before 202 without false metadata', async (t) => {
  const h = await harness(t);
  const response = await h.post(multipart(Buffer.alloc(0)));
  assert.equal(response.statusCode, 422);
  assert.equal(h.records.size, 0);
  assert.equal(h.reservations.size, 0);
  assert.deepEqual(await readdir(h.root), []);
});
test('MED-29: complete invalid format is accepted for asynchronous inspection', async (t) => {
  const h = await harness(t);
  const response = await h.post(multipart(Buffer.from('<svg/>')));
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().state, 'processing');
  assert.equal([...h.records.values()][0].sizeBytes, 6);
});
test('MED-14/28: recording reserves input plus 32 MiB after worst case admission', async (t) => {
  const h = await harness(t);
  const response = await h.post(
    multipart(Buffer.from('synthetic-bytes'), {
      kind: 'audio',
      origin: 'recording',
    }),
  );
  assert.equal(response.statusCode, 202);
  assert.equal(
    [...h.records.values()][0].reservationBytes,
    15 + 32 * 1024 * 1024,
  );
});
test('MED-04: audio above 16 MiB is interrupted before publishing media', async (t) => {
  const h = await harness(t);
  const response = await h.post(
    multipart(Buffer.alloc(16 * 1024 * 1024 + 1, 1), { kind: 'audio' }),
  );
  assert.equal(response.statusCode, 413);
  assert.equal(h.records.size, 0);
  assert.equal(h.reservations.size, 0);
  assert.deepEqual(await readdir(h.root), []);
});
test('MED-28: failed spool removal retains charged admission and responds503', async (t) => {
  const h = await harness(t, {
    removeFile: async () => {
      throw new Error('synthetic cleanup unavailable');
    },
  });
  const response = await h.post(multipart(Buffer.alloc(0)));
  assert.equal(response.statusCode, 503);
  assert.equal(h.records.size, 0);
  assert.equal(h.reservations.size, 1);
  assert.equal((await readdir(h.root)).length, 1);
});
