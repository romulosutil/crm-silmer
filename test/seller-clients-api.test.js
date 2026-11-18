import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOperationReadRuntime } from '../apps/api/src/operation-runtime.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const ACTOR = Object.freeze({
  id: 'wallet-seller-a',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
});
const HEADERS = Object.freeze({
  cookie: 'crm_session=synthetic-wallet',
  origin: 'https://crm.example.test',
  'x-csrf-token': 'synthetic-csrf',
  'idempotency-key': 'synthetic-wallet-request',
});
const CONTACT = Object.freeze({ id: 'official-contact', version: 4 });
const LINK = Object.freeze({
  id: 'portfolio-link',
  contactId: CONTACT.id,
  sellerId: ACTOR.id,
  version: 1,
  status: 'active',
});
const ENVIRONMENT = Object.freeze({
  CONTACT_IDENTITY_ENVELOPE_KEY: Buffer.alloc(32, 7).toString('base64url'),
  CONTACT_IDENTITY_LOOKUP_KEY: Buffer.alloc(32, 8).toString('base64url'),
  HANDOFF_ENVELOPE_KEY: Buffer.alloc(32, 9).toString('base64url'),
  INBOX_MESSAGE_ENVELOPE_KEY: Buffer.alloc(32, 10).toString('base64url'),
  IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 11).toString('base64url'),
  OPERATION_CURSOR_HMAC_KEY: Buffer.alloc(32, 12).toString('base64url'),
});

/** @param {any} [options] */
function harness(options = {}) {
  const calls = /** @type {Array<[string, any, any?]>} */ ([]);
  /** @param {any} input @param {boolean} write */
  function access(input, write) {
    calls.push(['authorize', input]);
    if (input.cookie !== HEADERS.cookie)
      throw Object.assign(new Error('INVALID_SESSION'), {
        code: 'INVALID_SESSION',
        statusCode: 401,
      });
    if (
      input.origin !== HEADERS.origin ||
      (write && input.csrfToken !== HEADERS['x-csrf-token'])
    )
      throw Object.assign(new Error('FORBIDDEN'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    return { actor: ACTOR };
  }
  const api = createApi(
    {},
    {
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
      operations: {
        authorizeRead: async (/** @type {any} */ input) => access(input, false),
        authorizeWrite: async (/** @type {any} */ input) => access(input, true),
        async listMyClients(
          /** @type {any} */ input,
          /** @type {any} */ reader,
        ) {
          calls.push(['list', input, reader]);
          if (options.listError) throw options.listError;
          return {
            items: [{ ...CONTACT, link: LINK }],
            nextCursor: null,
            totalCount: 1,
          };
        },
        async createMyClient(/** @type {any} */ input) {
          calls.push(['create', input]);
          return {
            created: options.created !== false,
            contact: CONTACT,
            link: LINK,
          };
        },
        async linkMyClient(/** @type {any} */ input) {
          calls.push(['link', input]);
          return { contactId: CONTACT.id, link: LINK };
        },
        async setContactDetails(/** @type {any} */ input) {
          calls.push(['details', input]);
          if (options.detailsError) throw options.detailsError;
          return CONTACT;
        },
      },
    },
  );
  return { api, calls };
}

test('WAP-E03 lists only the session portfolio and keeps its response private', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  const response = await api.inject({
    method: 'GET',
    url: '/api/v1/me/clients?q=Sintetico&limit=10&cursor=signed',
    headers: HEADERS,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers.vary, 'Origin, Cookie');
  assert.equal(calls[0][1].action, 'contact.read');
  assert.deepEqual(calls[1], [
    'list',
    { q: 'Sintetico', limit: 10, cursor: 'signed' },
    { actorId: ACTOR.id, capabilities: [] },
  ]);
  assert.equal(response.json().totalCount, 1);
  assert.equal(
    calls.filter(([name]) => name === 'create' || name === 'link').length,
    0,
  );
});

test('WAP-E03 creates the official Contact and portfolio together, with a 200 replay', async (t) => {
  for (const created of [true, false]) {
    const { api, calls } = harness({ created });
    t.after(() => api.close());
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/me/clients',
      headers: HEADERS,
      payload: {
        displayName: 'Cliente Sintetico',
        phone: '11999999999',
        email: 'wallet@example.test',
      },
    });
    assert.equal(response.statusCode, created ? 201 : 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(calls[0][1].action, 'contact.create');
    assert.equal(calls[0][1].csrfToken, HEADERS['x-csrf-token']);
    assert.deepEqual(calls[1], [
      'create',
      {
        actor: ACTOR,
        displayName: 'Cliente Sintetico',
        phone: '11999999999',
        email: 'wallet@example.test',
        idempotencyKey: HEADERS['idempotency-key'],
        correlationId: response.headers['x-request-id'],
      },
    ]);
    assert.deepEqual(response.json(), { contact: CONTACT, link: LINK });
  }
});

test('WAP-E03 links the selected official Contact with both expected versions', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  const response = await api.inject({
    method: 'POST',
    url: `/api/v1/me/clients/${CONTACT.id}/link`,
    headers: HEADERS,
    payload: { expectedVersion: 4, expectedLinkVersion: 2 },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(calls[0][1].action, 'contact.rename');
  assert.deepEqual(calls[1], [
    'link',
    {
      actor: ACTOR,
      contactId: CONTACT.id,
      expectedVersion: 4,
      expectedLinkVersion: 2,
      idempotencyKey: HEADERS['idempotency-key'],
      correlationId: response.headers['x-request-id'],
    },
  ]);
  assert.deepEqual(response.json(), { contactId: CONTACT.id, link: LINK });
});

test('WAP-E03 refuses caller-selected ownership, technical destinations and phone URLs before services', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  for (const extra of [
    { sellerId: 'other' },
    { userId: 'other' },
    { instanceName: 'private' },
    { url: 'https://gateway.test' },
  ]) {
    for (const { url, payload } of [
      {
        url: '/api/v1/me/clients',
        payload: { displayName: 'Sintetico', phone: '11999999999', ...extra },
      },
      {
        url: `/api/v1/me/clients/${CONTACT.id}/link`,
        payload: { expectedVersion: 4, ...extra },
      },
    ]) {
      const response = await api.inject({
        method: 'POST',
        url,
        headers: HEADERS,
        payload,
      });
      assert.equal(response.statusCode, 400);
    }
  }
  for (const query of ['q=11999999999', 'sellerId=other', 'limit=0']) {
    const response = await api.inject({
      method: 'GET',
      url: `/api/v1/me/clients?${query}`,
      headers: HEADERS,
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(
    calls.filter(([name]) => ['list', 'create', 'link'].includes(name)).length,
    0,
  );
});

test('WAP-E03 routes preserve session, origin, CSRF and idempotency guards', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  for (const url of [
    '/api/v1/me/clients',
    `/api/v1/me/clients/${CONTACT.id}/link`,
  ]) {
    const payload = url.endsWith('/link')
      ? { expectedVersion: 4 }
      : { displayName: 'Sintetico', phone: '11999999999' };
    for (const [field, status] of /** @type {Array<[string, number]>} */ ([
      ['cookie', 401],
      ['origin', 403],
      ['x-csrf-token', 403],
      ['idempotency-key', 400],
    ])) {
      const headers = /** @type {Record<string, string>} */ ({ ...HEADERS });
      delete headers[field];
      const response = await api.inject({
        method: 'POST',
        url,
        headers,
        payload,
      });
      assert.equal(response.statusCode, status);
    }
  }
  assert.equal(
    calls.filter(([name]) => name === 'create' || name === 'link').length,
    0,
  );
});

test('WAP-E03 portfolio ingresses are default off and require an explicit seller allowlist', async () => {
  const database = {
    async query() {
      throw new Error('A disabled ingress must not touch PostgreSQL');
    },
    async transaction() {
      throw new Error('A disabled ingress must not start a transaction');
    },
  };
  for (const [
    configuration,
    statusCode,
  ] of /** @type {Array<[Record<string, string>, number]>} */ ([
    [{}, 503],
    [
      {
        SELLER_CLIENTS_ENABLED: 'true',
        SELLER_CLIENTS_SELLER_IDS: '["other-seller"]',
      },
      403,
    ],
  ])) {
    const runtime = createOperationReadRuntime(database, {
      environment: { ...ENVIRONMENT, ...configuration },
    });
    const create = {
      actor: ACTOR,
      displayName: 'Sintetico',
      phone: '11999999999',
      idempotencyKey: 'key',
      correlationId: 'request',
    };
    await assert.rejects(runtime.createMyClient(create), { statusCode });
    await assert.rejects(
      runtime.linkMyClient({
        actor: ACTOR,
        contactId: CONTACT.id,
        expectedVersion: 4,
        idempotencyKey: 'key',
        correlationId: 'request',
      }),
      { statusCode },
    );
    await assert.rejects(
      runtime.listMyClients({}, { actorId: ACTOR.id, capabilities: [] }),
      { statusCode },
    );
  }
  assert.throws(
    () =>
      createOperationReadRuntime(database, {
        environment: {
          ...ENVIRONMENT,
          SELLER_CLIENTS_ENABLED: 'true',
          SELLER_CLIENTS_SELLER_IDS: '[]',
        },
      }),
    /SELLER_CLIENTS_SELLER_IDS requires explicit seller IDs/u,
  );
});

/** @param {number} statusCode @param {string} code */
function failure(statusCode, code) {
  return Object.assign(new Error(`${code} synthetic-detail-canary`), {
    code,
    statusCode,
  });
}

test('WAP-E03 publishes the restricted shared-field codes the registration form relies on', async (t) => {
  for (const [statusCode, code] of /** @type {Array<[number, string]>} */ ([
    [403, 'CONTACT_FIELD_RESTRICTED'],
    [400, 'CONTACT_REVIEW_REQUIRED'],
  ])) {
    const { api, calls } = harness({
      detailsError: failure(statusCode, code),
    });
    t.after(() => api.close());
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/contacts/${CONTACT.id}/details`,
      headers: HEADERS,
      payload: { expectedVersion: 4, phone: '11999999999' },
    });
    assert.equal(response.statusCode, statusCode);
    assert.deepEqual(response.json(), { error: { code } });
    assert.equal(calls.filter(([name]) => name === 'details').length, 1);
  }
});

test('WAP-E03 a disabled portfolio answers 503 SELLER_CLIENTS_DISABLED; other 5xx stay generic', async (t) => {
  for (const [error, code] of /** @type {Array<[Error, string]>} */ ([
    [failure(503, 'SELLER_CLIENTS_DISABLED'), 'SELLER_CLIENTS_DISABLED'],
    [failure(503, 'IDENTITY_UNAVAILABLE'), 'SERVICE_UNAVAILABLE'],
    [failure(500, '40P01'), 'SERVICE_UNAVAILABLE'],
  ])) {
    const { api } = harness({ listError: error });
    t.after(() => api.close());
    const response = await api.inject({
      method: 'GET',
      url: '/api/v1/me/clients',
      headers: HEADERS,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: { code } });
    assert.doesNotMatch(response.body, /synthetic-detail-canary|40P01/u);
  }
});
