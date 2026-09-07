import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http, { createServer } from 'node:http';
import https from 'node:https';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../dist/edge-web');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const apiOrigin = new URL(process.env.API_ORIGIN ?? 'http://127.0.0.1:3000');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (requestUrl.pathname.startsWith('/api/')) {
    proxyApiRequest(request, response, requestUrl);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const candidate = resolve(root, `.${requestedPath}`);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const file = await stat(candidate);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Length': file.size,
      'Content-Type':
        contentTypes.get(extname(candidate)) ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
});

/**
 * Keeps browser requests same-origin in development, including cookies and
 * CSRF headers, without changing the frontend application.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {URL} requestUrl
 */
function proxyApiRequest(request, response, requestUrl) {
  const transport = apiOrigin.protocol === 'https:' ? https : http;
  const headers = { ...request.headers, host: apiOrigin.host };
  delete headers.connection;
  const upstream = transport.request(
    {
      headers,
      hostname: apiOrigin.hostname,
      method: request.method,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      port: apiOrigin.port || undefined,
      protocol: apiOrigin.protocol,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.once('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    response.end(JSON.stringify({ error: { code: 'DEV_API_UNAVAILABLE' } }));
  });
  request.pipe(upstream);
}

server.listen(port, host, () => {
  console.log(`development edge-web available at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
