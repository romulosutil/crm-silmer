import assert from 'node:assert/strict';
import test from 'node:test';
import http, { createServer } from 'node:http';
import { spawn } from 'node:child_process';

/** @param {Promise<any>} promise */
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('PROXY_CANCELLATION_NOT_FORWARDED')),
          1500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** @param {(req:any,res:any)=>void} handler @param {(origin:string)=>Promise<void>} work */
async function withProxy(handler, work) {
  const api = createServer(handler);
  await new Promise((resolve) =>
    api.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  const reservation = createServer();
  await new Promise((resolve) =>
    reservation.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  const port = /** @type {import('node:net').AddressInfo} */ (
    reservation.address()
  ).port;
  await new Promise((resolve) => reservation.close(() => resolve(undefined)));
  const apiPort = /** @type {import('node:net').AddressInfo} */ (api.address())
    .port;
  const child = spawn(process.execPath, ['scripts/serve-dev.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      API_ORIGIN: `http://127.0.0.1:${apiPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await bounded(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error('PROXY_BOOT_FAILED')));
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('development edge-web available'))
            resolve(undefined);
        });
      }),
    );
    await work(`http://127.0.0.1:${port}`);
  } finally {
    child.kill();
    api.closeAllConnections();
    await new Promise((resolve) => api.close(() => resolve(undefined)));
  }
}
test('T17/MED-08: abandoned partial browser upload destroys the API request through the real dev proxy', async () => {
  /** @type {(value:any)=>void} */ let received = () => {};
  /** @type {(value:any)=>void} */ let aborted = () => {};
  const firstData = new Promise((resolve) => {
    received = resolve;
  });
  const stopped = new Promise((resolve) => {
    aborted = resolve;
  });
  await withProxy(
    (req) => {
      req.once('data', received);
      req.once('aborted', aborted);
    },
    async (origin) => {
      const client = http.request(origin + '/api/v1/media', {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=synthetic',
          'content-length': 1024 * 1024,
        },
      });
      client.on('error', () => {});
      client.write(Buffer.alloc(1024));
      await bounded(firstData);
      client.destroy();
      await bounded(stopped);
    },
  );
});
test('T17/MED-08: normal Range response completes and a closed SSE consumer stops the upstream response', async () => {
  /** @type {(value:any)=>void} */ let stopped = () => {};
  const closed = new Promise((resolve) => {
    stopped = resolve;
  });
  await withProxy(
    (req, res) => {
      if (req.url === '/api/range') {
        assert.equal(req.headers.range, 'bytes=0-2');
        res
          .writeHead(206, {
            'content-range': 'bytes 0-2/6',
            'content-type': 'application/octet-stream',
          })
          .end('abc');
      } else {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: synthetic\n\n');
        res.once('close', stopped);
      }
    },
    async (origin) => {
      const range = await globalThis.fetch(origin + '/api/range', {
        headers: { Range: 'bytes=0-2' },
      });
      assert.equal(range.status, 206);
      assert.equal(await range.text(), 'abc');
      assert.equal(range.headers.get('content-range'), 'bytes 0-2/6');
      const client = http.get(origin + '/api/events');
      client.on('error', () => {});
      await bounded(
        new Promise((resolve) =>
          client.once('response', (response) =>
            response.once('data', () => {
              response.destroy();
              client.destroy();
              resolve(undefined);
            }),
          ),
        ),
      );
      await bounded(closed);
    },
  );
});
