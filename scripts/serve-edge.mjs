import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../dist/edge-web');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', `http://${host}:${port}`).pathname,
    );
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const candidate = resolve(root, `.${requestedPath}`);

    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }

    const file = await stat(candidate);
    if (!file.isFile()) {
      throw new Error('Not a file');
    }

    response.writeHead(200, {
      'Content-Length': file.size,
      'Content-Type':
        contentTypes.get(extname(candidate)) ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(candidate).pipe(response);
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
});

server.listen(port, host, () => {
  console.log(`edge-web available at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
