import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../dist/edge-web');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const demoAuthEnabled = process.env.SILMER_PREVIEW_DEMO_AUTH === '1';
const demoRole = process.env.SILMER_PREVIEW_DEMO_ROLE ?? 'admin';
const demoAdminEmail = process.env.SILMER_PREVIEW_DEMO_EMAIL ?? '';
const demoAdminPassword = process.env.SILMER_PREVIEW_DEMO_PASSWORD ?? '';
const demoSellerEmail =
  process.env.SILMER_PREVIEW_DEMO_SELLER_EMAIL ?? 'vendedor@local.test';
const demoSellerPassword =
  process.env.SILMER_PREVIEW_DEMO_SELLER_PASSWORD ?? 'SilmerVendedor!2026Local';

/** @type {Record<string, { capabilities: string[], email: string, functionName: string, id: string, password: string }>} */
const demoAccounts = {
  admin: {
    capabilities: ['COMMERCIAL_ADMIN'],
    email: demoAdminEmail,
    functionName: 'Atendimento',
    id: 'local-demo-admin',
    password: demoAdminPassword,
  },
  seller: {
    capabilities: [],
    email: demoSellerEmail,
    functionName: 'Vendedor',
    id: 'local-demo-seller',
    password: demoSellerPassword,
  },
};

let demoSessionAccount = demoAuthEnabled ? demoAccounts[demoRole] : null;

if (
  demoAuthEnabled &&
  (!['127.0.0.1', 'localhost', '::1'].includes(host) ||
    !demoSessionAccount?.email ||
    !demoSessionAccount.password)
) {
  throw new Error(
    'SILMER_PREVIEW_DEMO_AUTH requires loopback HOST and credentials for the selected demo role',
  );
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

/** @param {import('node:http').IncomingMessage} request */
function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, value.join('=')]),
  );
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 * @param {Record<string, string|string[]>} [headers]
 */
function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(body);
}

function demoSession() {
  return {
    user: {
      capabilities: demoSessionAccount?.capabilities ?? [],
      functionName: demoSessionAccount?.functionName ?? '',
      id: demoSessionAccount?.id ?? '',
    },
  };
}

/** @param {import('node:http').IncomingMessage} request */
function demoAuthenticated(request) {
  return (
    demoSessionAccount !== null &&
    parseCookies(request).crm_session === 'local-demo-session'
  );
}

/** @param {import('node:http').IncomingMessage} request */
async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handleDemoApi(request, response) {
  if (!demoAuthEnabled || !request.url?.startsWith('/api/v1/')) return false;

  const pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  if (pathname === '/api/v1/sessions' && request.method === 'POST') {
    const body = await readJson(request);
    const account = Object.values(demoAccounts).find(
      (candidate) =>
        candidate.email === body.email && candidate.password === body.password,
    );
    if (!account) {
      sendJson(response, 401, { error: { code: 'INVALID_CREDENTIALS' } });
      return true;
    }
    demoSessionAccount = account;
    sendJson(response, 200, demoSession(), {
      'Set-Cookie': [
        'crm_session=local-demo-session; Path=/; HttpOnly; SameSite=Lax',
        'crm_csrf=local-demo-csrf; Path=/; SameSite=Lax',
      ],
    });
    return true;
  }

  if (pathname === '/api/v1/sessions/current' && request.method === 'GET') {
    if (!demoSessionAccount) {
      sendJson(response, 401, { error: { code: 'INVALID_CREDENTIALS' } });
      return true;
    }
    sendJson(response, 200, demoSession(), {
      'Set-Cookie': [
        'crm_session=local-demo-session; Path=/; HttpOnly; SameSite=Lax',
        'crm_csrf=local-demo-csrf; Path=/; SameSite=Lax',
      ],
    });
    return true;
  }

  if (pathname === '/api/v1/sessions/current' && request.method === 'DELETE') {
    if (!demoAuthenticated(request)) {
      sendJson(response, 403, { error: { code: 'FORBIDDEN' } });
      return true;
    }
    demoSessionAccount = null;
    response.writeHead(204, {
      'Set-Cookie': [
        'crm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        'crm_csrf=; Path=/; SameSite=Lax; Max-Age=0',
      ],
    });
    response.end();
    return true;
  }

  if (
    demoAuthenticated(request) &&
    pathname === '/api/v1/invitations' &&
    request.method === 'POST'
  ) {
    sendJson(response, 200, { token: 'LOCAL-DEMO-INVITE' });
    return true;
  }

  if (
    demoAuthenticated(request) &&
    pathname.startsWith('/api/v1/capabilities/') &&
    request.method === 'POST'
  ) {
    sendJson(response, 200, { status: 'ok' });
    return true;
  }

  sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
  return true;
}

const server = createServer(async (request, response) => {
  try {
    if (await handleDemoApi(request, response)) return;
  } catch {
    sendJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', `http://${host}:${port}`).pathname,
    );
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    let candidate = resolve(root, `.${requestedPath}`);

    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }

    let file;
    try {
      file = await stat(candidate);
    } catch (error) {
      if (pathname.startsWith('/api/') || extname(pathname) !== '') throw error;
      candidate = resolve(root, 'index.html');
      file = await stat(candidate);
    }
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
