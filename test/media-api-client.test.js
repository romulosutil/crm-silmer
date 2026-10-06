import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { request, ApiError } from '../apps/edge-web/src/lib/api-client.js';

/** @param {(request:any,response:any)=>void} handler @param {(url:string)=>Promise<void>} work */
async function withServer(handler, work) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ detail: error.message }));
    });
  });
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  const previous = Reflect.get(globalThis, 'document');
  Reflect.set(globalThis, 'document', {
    cookie: 'other=x; crm_csrf=synthetic%20csrf',
  });
  try {
    await work(`http://127.0.0.1:${address.port}/api/media`);
  } finally {
    Reflect.set(globalThis, 'document', previous);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}
/** @param {any} request */
async function bytes(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('T17/MED-04/06/08: native FormData preserves binary/boundary, CSRF and original command key', async () => {
  await withServer(
    async (req, res) => {
      const body = await bytes(req);
      assert.match(
        req.headers['content-type'],
        /^multipart\/form-data; boundary=/u,
      );
      assert.equal(req.headers['x-csrf-token'], 'synthetic csrf');
      assert.equal(req.headers['idempotency-key'], 'upload/a?#%');
      assert.ok(body.includes(Buffer.from([0, 255, 9, 7])));
      assert.ok(body.includes(Buffer.from('name="origin"')));
      res
        .writeHead(202, { 'content-type': 'application/json' })
        .end('{"mediaId":"synthetic","state":"processing"}');
    },
    async (url) => {
      const form = new globalThis.FormData();
      form.set(
        'file',
        new globalThis.Blob([new Uint8Array([0, 255, 9, 7])], {
          type: 'audio/ogg',
        }),
        'sample.ogg',
      );
      form.set('origin', 'attachment');
      const result = await request(url, {
        method: 'POST',
        body: form,
        idempotencyKey: 'upload/a?#%',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(result.data.state, 'processing');
    },
  );
});
test('T17/MED-06: JSON request remains encoded with CSRF and same idempotency key', async () => {
  await withServer(
    async (req, res) => {
      assert.equal(req.headers['content-type'], 'application/json');
      assert.equal(req.headers['x-csrf-token'], 'synthetic csrf');
      assert.equal(req.headers['idempotency-key'], 'original');
      assert.deepEqual(JSON.parse((await bytes(req)).toString()), {
        expectedVersion: 1,
        content: { mediaId: 'id' },
      });
      res.writeHead(204).end();
    },
    async (url) => {
      assert.equal(
        (
          await request(url, {
            method: 'POST',
            body: { expectedVersion: 1, content: { mediaId: 'id' } },
            idempotencyKey: 'original',
          })
        ).data,
        null,
      );
    },
  );
});
test('T17/MED-08: native status polling forwards AbortSignal and stops pending read', async () => {
  await withServer(
    () => {},
    async (url) => {
      const controller = new AbortController();
      const pending = request(url, { signal: controller.signal });
      setTimeout(() => controller.abort(), 20);
      await assert.rejects(
        pending,
        (error) => /** @type {any} */ (error).name === 'AbortError',
      );
    },
  );
});
test('T17/MED-08: native multipart request stops on abort', async () => {
  await withServer(
    () => {},
    async (url) => {
      const controller = new AbortController();
      const form = new globalThis.FormData();
      form.set(
        'file',
        new globalThis.Blob([new Uint8Array(1024 * 1024)]),
        'synthetic.ogg',
      );
      const pending = request(url, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 20);
      await assert.rejects(
        pending,
        (error) => /** @type {any} */ (error).name === 'AbortError',
      );
    },
  );
});
test('T17/MED-08: pre-aborted request performs no HTTP work', async () => {
  let calls = 0;
  await withServer(
    (_req, res) => {
      calls++;
      res.end();
    },
    async (url) => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        request(url, { signal: controller.signal }),
        (error) => /** @type {any} */ (error).name === 'AbortError',
      );
      assert.equal(calls, 0);
    },
  );
});
test('T17/MED-04: processing rejection problem retains sanitized status/code/detail', async () => {
  await withServer(
    (_req, res) => {
      res
        .writeHead(422, { 'content-type': 'application/problem+json' })
        .end(
          '{"code":"CHAT_MEDIA_INVALID_FORMAT","detail":"Formato inválido"}',
        );
    },
    async (url) => {
      await assert.rejects(
        request(url),
        (error) =>
          error instanceof ApiError &&
          error.status === 422 &&
          error.code === 'CHAT_MEDIA_INVALID_FORMAT' &&
          error.message === 'Formato inválido',
      );
    },
  );
});
test('T17/MED-06: GET 304 retains ETag and emits no body or CSRF', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.headers['content-type'], undefined);
      assert.equal(req.headers['x-csrf-token'], undefined);
      res.writeHead(304, { etag: '"v1"' }).end();
    },
    async (url) => {
      assert.deepEqual(await request(url), {
        data: null,
        etag: '"v1"',
        notModified: true,
      });
    },
  );
});
