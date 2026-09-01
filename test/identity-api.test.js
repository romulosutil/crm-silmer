import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const ORIGIN = 'https://crm.example.test';

/** @param {import('fastify').FastifyServerOptions} [options] */
function harness(options = {}) {
  /** @type {Array<{operation: string, input: Record<string, unknown>}>} */
  const calls = [];
  const identity = {
    allowedOrigins: [ORIGIN],
    /** @param {Record<string, unknown>} input */
    acceptInvitation: async (input) => {
      calls.push({ input, operation: 'accept' });
      return { capabilities: [], functionName: 'Vendedor', id: 'seller-1' };
    },
    /** @param {Record<string, unknown>} input */
    bootstrap: async (input) => {
      calls.push({ input, operation: 'bootstrap' });
      return { capabilities: ['COMMERCIAL_ADMIN'], id: 'admin-1' };
    },
    /** @param {Record<string, unknown>} input */
    changeCapability: async (input) => {
      calls.push({ input, operation: 'capability' });
      return { changed: true };
    },
    /** @param {Record<string, unknown>} input */
    createInvitation: async (input) => {
      calls.push({ input, operation: 'invitation' });
      return { expiresAt: '2026-09-02T12:00:00.000Z', token: 'invite-token' };
    },
    /** @param {Record<string, unknown>} input */
    enrollMfa: async (input) => {
      calls.push({ input, operation: 'mfa' });
      return { recoveryCodes: ['recovery-code'], secret: 'BASE32SECRET' };
    },
    /** @param {Record<string, unknown>} input */
    current: async (input) => {
      calls.push({ input, operation: 'current' });
      return { capabilities: ['COMMERCIAL_ADMIN'], id: 'admin-1' };
    },
    /** @param {Record<string, unknown>} input */
    login: async (input) => {
      calls.push({ input, operation: 'login' });
      return {
        body: { mfaVerified: true, user: { id: 'admin-1' } },
        cookie:
          'crm_session=opaque-session; Path=/; HttpOnly; Secure; SameSite=Lax',
        csrfToken: 'opaque-csrf',
        sessionToken: 'opaque-session',
      };
    },
    /** @param {Record<string, unknown>} input */
    logout: async (input) => {
      calls.push({ input, operation: 'logout' });
    },
  };
  const api = createApi(options, {
    identity,
    logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
  });
  return { api, calls };
}

test('login sets separate secure session and CSRF cookies without returning tokens', async () => {
  const { api, calls } = harness();
  const response = await api.inject({
    headers: { origin: ORIGIN },
    method: 'POST',
    payload: {
      email: 'admin@example.test',
      password: 'correct horse battery staple',
      totpCode: '123456',
    },
    url: '/api/v1/sessions',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.deepEqual(response.json(), {
    mfaVerified: true,
    user: { id: 'admin-1' },
  });
  assert.doesNotMatch(response.body, /opaque-session|opaque-csrf/iu);
  const cookies = /** @type {string[]} */ (response.headers['set-cookie']);
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /crm_session=.*HttpOnly.*Secure.*SameSite=Lax/iu);
  assert.match(cookies[1], /crm_csrf=.*Secure.*SameSite=Lax/iu);
  assert.doesNotMatch(cookies[1], /HttpOnly/iu);
  assert.equal(calls[0].operation, 'login');
  await api.close();
});

test('uses the client address behind a trusted private edge proxy', async () => {
  const { api, calls } = harness({
    trustProxy: 'loopback, linklocal, uniquelocal',
  });
  const response = await api.inject({
    headers: {
      origin: ORIGIN,
      'x-forwarded-for': '198.51.100.9, 203.0.113.42',
    },
    method: 'POST',
    payload: {
      email: 'admin@example.test',
      password: 'correct horse battery staple',
    },
    remoteAddress: '172.18.0.2',
    url: '/api/v1/sessions',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].input.network, '203.0.113.42');
  await api.close();
});

test('authenticated commands require matching Origin, CSRF cookie and header', async () => {
  const { api, calls } = harness();
  const base = {
    method: /** @type {const} */ ('POST'),
    payload: {
      capability: 'PRIVACY_OFFICER',
      reason: 'Delegacao aprovada',
      targetId: 'seller-1',
    },
    url: '/api/v1/capabilities/grant',
  };

  for (const headers of [
    {},
    { origin: 'https://evil.example.test' },
    { origin: ORIGIN },
    {
      cookie: 'crm_session=session; crm_csrf=csrf-one',
      origin: ORIGIN,
      'x-csrf-token': 'csrf-two',
    },
  ]) {
    const denied = await api.inject({ ...base, headers });
    assert.equal(denied.statusCode, 403);
  }
  assert.equal(calls.length, 0);

  const allowed = await api.inject({
    ...base,
    headers: {
      cookie: 'crm_session=session; crm_csrf=csrf-one',
      origin: ORIGIN,
      'x-csrf-token': 'csrf-one',
      'idempotency-key': 'capability-request-1',
    },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(calls[0].operation, 'capability');
  assert.equal(calls[0].input.sessionToken, 'session');
  assert.equal(calls[0].input.csrfToken, 'csrf-one');
  assert.equal(calls[0].input.idempotencyKey, 'capability-request-1');
  await api.close();
});

test('invitation commands require an idempotency key and reject ambiguous cookies', async () => {
  const { api, calls } = harness();
  const headers = {
    cookie: 'crm_session=session; crm_csrf=csrf',
    origin: ORIGIN,
    'x-csrf-token': 'csrf',
  };
  const missingKey = await api.inject({
    headers,
    method: 'POST',
    payload: {
      email: 'seller@example.test',
      expiresAt: '2026-09-02T12:00:00.000Z',
      functionName: 'Vendedor',
      reason: 'Novo vendedor',
    },
    url: '/api/v1/invitations',
  });
  assert.equal(missingKey.statusCode, 400);

  const duplicate = await api.inject({
    headers: {
      ...headers,
      cookie: 'crm_session=one; crm_session=two; crm_csrf=csrf',
      'idempotency-key': 'invitation-request-1',
    },
    method: 'POST',
    payload: {
      email: 'seller@example.test',
      expiresAt: '2026-09-02T12:00:00.000Z',
      functionName: 'Vendedor',
      reason: 'Novo vendedor',
    },
    url: '/api/v1/invitations',
  });
  assert.equal(duplicate.statusCode, 400);
  assert.equal(calls.length, 0);
  await api.close();
});

test('MFA enrollment is authenticated, CSRF-protected and idempotent', async () => {
  const { api, calls } = harness();
  const response = await api.inject({
    headers: {
      cookie: 'crm_session=session; crm_csrf=csrf',
      'idempotency-key': 'mfa-enrollment-request-1',
      origin: ORIGIN,
      'x-csrf-token': 'csrf',
    },
    method: 'POST',
    payload: { reason: 'Habilitar acesso privilegiado' },
    url: '/api/v1/mfa/enrollments',
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), {
    recoveryCodes: ['recovery-code'],
    secret: 'BASE32SECRET',
  });
  assert.equal(calls[0].operation, 'mfa');
  assert.equal(calls[0].input.sessionToken, 'session');
  assert.equal(calls[0].input.csrfToken, 'csrf');
  assert.equal(calls[0].input.idempotencyKey, 'mfa-enrollment-request-1');
  await api.close();
});

test('current session uses only the HttpOnly session cookie and logout expires both cookies', async () => {
  const { api } = harness();
  const current = await api.inject({
    headers: { cookie: 'crm_session=session' },
    url: '/api/v1/sessions/current',
  });
  assert.equal(current.statusCode, 200);

  const logout = await api.inject({
    headers: {
      cookie: 'crm_session=session; crm_csrf=csrf',
      origin: ORIGIN,
      'x-csrf-token': 'csrf',
    },
    method: 'DELETE',
    url: '/api/v1/sessions/current',
  });
  assert.equal(logout.statusCode, 204);
  assert.match(String(logout.headers['set-cookie']), /Max-Age=0/iu);
  await api.close();
});
