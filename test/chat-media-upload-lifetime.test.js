import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { createApi } from '../apps/api/src/app.js';
import { request } from 'node:http';

for (const failure of ['deadline', 'lease-loss']) {
  test(
    `T22/MED-27: ${failure} closes writer before cleanup/release`,
    { timeout: 3000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'crm-upload-lifetime-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const stream = new Readable({ read() {} });
      stream.push(Buffer.from('synthetic partial bytes'));
      const controller = new AbortController();
      let removed = false;
      let released = false;
      let leaseReturned = false;
      const runtime = createChatMediaApiRuntime({
        spoolRoot: root,
        envelopeKey: Buffer.alloc(32, 7),
        access: {},
        uploadTimeoutMs: failure === 'deadline' ? 50 : 2000,
        repository: {
          async withUploadLease(
            /** @type {string} */ _id,
            /** @type {Function} */ work,
          ) {
            const timer =
              failure === 'lease-loss'
                ? setTimeout(() => controller.abort(), 50)
                : undefined;
            try {
              return await work(controller.signal);
            } finally {
              clearTimeout(timer);
              assert.equal(stream.destroyed, true);
              leaseReturned = true;
            }
          },
          async admit() {
            return {};
          },
          async complete() {
            assert.fail('partial upload cannot become media');
          },
          async release() {
            assert.equal(leaseReturned, true);
            assert.equal(removed, true);
            assert.deepEqual(await readdir(root), []);
            released = true;
          },
        },
        removeFile: async (/** @type {string} */ path) => {
          assert.equal(stream.destroyed, true);
          await rm(path, { force: true });
          removed = true;
        },
      });
      const started = Date.now();
      await assert.rejects(
        runtime.upload({
          stream,
          finishMultipart: () => new Promise(() => {}),
          kind: 'image',
          origin: 'attachment',
          declaredMimeType: 'image/png',
          filename: 'synthetic.png',
          conversationId: 'synthetic',
          expectedVersion: 1,
          actor: { id: 'synthetic' },
          sessionHash: 'synthetic',
          idempotencyKey: 'synthetic',
        }),
        (/** @type {any} */ error) => error.statusCode === 503,
      );
      assert.equal(leaseReturned, true);
      assert.equal(released, true);
      assert.ok(Date.now() - started < 1500);
    },
  );
}

test(
  'T22/MED-27: stalled multipart HTTP connection reaches deadline without freeing an open spool',
  { timeout: 3000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'crm-http-upload-deadline-'));
    let released = false;
    const runtime = createChatMediaApiRuntime({
      spoolRoot: root,
      envelopeKey: Buffer.alloc(32, 7),
      uploadTimeoutMs: 80,
      access: {
        async authorizeRead() {
          return {
            actor: { id: 'synthetic', kind: 'human', capabilities: [] },
          };
        },
        async authorize() {
          return {
            actor: { id: 'synthetic', kind: 'human', capabilities: [] },
          };
        },
      },
      repository: {
        async admit() {
          return {};
        },
        async complete() {
          assert.fail('partial HTTP upload cannot complete');
        },
        async release() {
          assert.deepEqual(await readdir(root), []);
          released = true;
        },
      },
    });
    const api = createApi({}, { chatMedia: runtime });
    const url = await api.listen({ port: 0, host: '127.0.0.1' });
    t.after(async () => {
      await api.close();
      await rm(root, { recursive: true, force: true });
    });
    const status = await new Promise((resolve, reject) => {
      const socket = request(
        `${url}/api/v1/conversations/synthetic/media`,
        {
          method: 'POST',
          headers: {
            'content-type': 'multipart/form-data; boundary=synthetic',
            'idempotency-key': 'synthetic',
            'x-csrf-token': 'synthetic',
            cookie: 'crm_session=synthetic',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode);
            socket.destroy();
          });
        },
      );
      socket.on('error', reject);
      const fields = [
        ['kind', 'image'],
        ['origin', 'attachment'],
        ['expectedVersion', '1'],
      ]
        .map(
          ([name, value]) =>
            `--synthetic\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('');
      socket.write(
        `${fields}--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\npartial bytes`,
      );
    });
    assert.equal(status, 503);
    assert.equal(released, true);
    assert.deepEqual(await readdir(root), []);
  },
);
