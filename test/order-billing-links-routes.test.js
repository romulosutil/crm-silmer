import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { authorize } from '../modules/identity-access/src/authorization.js';
import {
  createSafeLogger,
  MetricRegistry,
} from '../modules/shared/src/index.js';

// LPC-02/03 HTTP boundary: the public page needs no session, the token never
// reaches a log, the answer carries only order, kind and amount.
const TOKEN = '7Q4K2MABCDEFGHJKMNPQRSTVWX';
const ORIGIN = 'https://crm.example.test';
const PUBLIC = `/api/v1/payment-links/${TOKEN}`;
const PREFIX = '/api/v1/orders/order-synthetic/billing';
const HUMAN = {
  cookie: 'crm_session=seller',
  origin: ORIGIN,
  'x-csrf-token': 'synthetic-csrf',
  'idempotency-key': 'synthetic-command-1',
};
const VERSIONS = { expectedVersion: 1, expectedBillingVersion: 1 };
const LINK = '0f5c3e5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

function harness(overrides = {}) {
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  const logger = createSafeLogger({
    service: 'crm-silmer-api',
    sink: (record) => records.push(record),
  });
  /** @type {any[]} */ const calls = [];
  /** @param {any} input @param {boolean} write */
  function access(input, write) {
    if (!input.cookie)
      throw Object.assign(new Error('private'), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    if (write && input.csrfToken !== 'synthetic-csrf')
      throw Object.assign(new Error('private'), {
        code: 'CSRF_INVALID',
        statusCode: 403,
      });
    const actor = {
      id: 'synthetic-user',
      functionName: input.cookie.includes('finance')
        ? 'Financeiro'
        : 'Vendedor',
      capabilities: [],
    };
    authorize(/** @type {any} */ (actor), input.action);
    return { actor };
  }
  /** @type {any} */
  const billing = {
    publicOrigins: [ORIGIN],
    authorizeRead: (/** @type {any} */ input) => access(input, false),
    authorizeWrite: (/** @type {any} */ input) => access(input, true),
    async publicLink(/** @type {any} */ input) {
      calls.push({ method: 'publicLink', input });
      return {
        state: 'ready',
        orderNumber: '07-CRM',
        kind: 'signal',
        amountCents: 240000,
        contactName: 'must never leave',
      };
    },
    async publicCheckout(/** @type {any} */ input) {
      calls.push({ method: 'publicCheckout', input });
      return {
        statusCode: 202,
        body: { state: 'in_progress', orderNumber: '07-CRM', phone: 'x' },
      };
    },
    ...overrides,
  };
  for (const method of [
    'createLink',
    'cancelLink',
    'confirmLinkResult',
    'recordExternal',
  ])
    billing[method] ??= async (/** @type {any} */ input) => {
      calls.push({ method, input });
      return { billing: { version: 2 } };
    };
  const api = createApi(
    {},
    { logger, metrics: new MetricRegistry({ logger }), billing },
  );
  return { api, calls, records };
}

test('LPC-02: the public page works without cookie or CSRF, answers no-store/noindex and strips everything but the allowed fields', async (t) => {
  const { api, calls, records } = harness();
  t.after(() => api.close());
  const read = await api.inject({ url: PUBLIC });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), {
    state: 'ready',
    orderNumber: '07-CRM',
    kind: 'signal',
    amountCents: 240000,
  });
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.equal(read.headers['referrer-policy'], 'no-referrer');
  assert.equal(read.headers['x-robots-tag'], 'noindex, nofollow');
  const click = await api.inject({
    method: 'POST',
    url: `${PUBLIC}/checkout`,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: {},
  });
  assert.equal(click.statusCode, 202);
  assert.deepEqual(click.json(), {
    state: 'in_progress',
    orderNumber: '07-CRM',
  });
  assert.deepEqual(
    calls.map((c) => [c.method, c.input.token]),
    [
      ['publicLink', TOKEN],
      ['publicCheckout', TOKEN],
    ],
  );
  // LPC-02: no token, path or PII in any log record.
  const logged = JSON.stringify(records);
  assert.ok(records.length > 0);
  assert.equal(logged.includes(TOKEN), false);
  assert.equal(logged.includes('payment-links'), false);
});

test('LPC-02: the click needs the CRM Origin and an empty body; foreign origins are refused before any effect', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  for (const [
    headers,
    payload,
    status,
  ] of /** @type {Array<[any,any,number]>} */ ([
    [{}, {}, 403],
    [{ origin: 'https://evil.example.test' }, {}, 403],
    [{ origin: 'null' }, {}, 403],
    [{ origin: ORIGIN }, { amountCents: 1 }, 400],
    [{ origin: ORIGIN }, [], 400],
  ])) {
    const response = await api.inject({
      method: 'POST',
      url: `${PUBLIC}/checkout`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  }
  assert.equal(calls.length, 0);
  const withoutBody = await api.inject({
    method: 'POST',
    url: `${PUBLIC}/checkout`,
    headers: { origin: ORIGIN },
  });
  assert.equal(withoutBody.statusCode, 202);
  const query = await api.inject({ url: `${PUBLIC}?x=1` });
  assert.equal(query.statusCode, 400);
});

test('LPC-02: uniform unavailable passes through; reads and clicks are limited apart per token', async (t) => {
  const { api } = harness({
    publicLink: async () => ({ state: 'unavailable' }),
  });
  t.after(() => api.close());
  const statuses = [];
  for (let index = 0; index < 62; index += 1) {
    const response = await api.inject({ url: PUBLIC });
    statuses.push(response.statusCode);
    if (response.statusCode === 200)
      assert.deepEqual(response.json(), { state: 'unavailable' });
  }
  assert.equal(statuses.filter((s) => s === 200).length, 60);
  assert.equal(statuses.at(-1), 429);
  // Clicks have their own, tighter budget, unaffected by the page polls.
  const clicks = [];
  for (let index = 0; index < 11; index += 1)
    clicks.push(
      (
        await api.inject({
          method: 'POST',
          url: `${PUBLIC}/checkout`,
          headers: { origin: ORIGIN },
        })
      ).statusCode,
    );
  assert.equal(clicks.filter((s) => s === 202).length, 10);
  assert.equal(clicks.at(-1), 429);
  const other = await api.inject({
    url: '/api/v1/payment-links/ABCDEFGHJKMNPQRSTVWXYZ0123',
  });
  assert.equal(other.statusCode, 200);
});

test('LPC flags: without the billing runtime the public routes do not exist', async (t) => {
  const api = createApi({}, {});
  t.after(() => api.close());
  assert.equal((await api.inject({ url: PUBLIC })).statusCode, 404);
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: `${PUBLIC}/checkout`,
        headers: { origin: ORIGIN },
      })
    ).statusCode,
    404,
  );
});

test('LPC-03: seller link commands need session, CSRF, idempotency key and strict bodies', async (t) => {
  const { api, calls } = harness();
  t.after(() => api.close());
  for (const [
    url,
    headers,
    payload,
    status,
  ] of /** @type {Array<[string,any,any,number]>} */ ([
    [
      `${PREFIX}/links`,
      { ...HUMAN, cookie: undefined },
      { ...VERSIONS, amountCents: 100 },
      403,
    ],
    [
      `${PREFIX}/links`,
      { ...HUMAN, 'x-csrf-token': '' },
      { ...VERSIONS, amountCents: 100 },
      403,
    ],
    [
      `${PREFIX}/links`,
      { ...HUMAN, cookie: 'crm_session=finance' },
      { ...VERSIONS, amountCents: 100 },
      403,
    ],
    [
      `${PREFIX}/links`,
      { ...HUMAN, authorization: 'Basic x' },
      { ...VERSIONS, amountCents: 100 },
      403,
    ],
    [`${PREFIX}/links`, HUMAN, { ...VERSIONS }, 400],
    [
      `${PREFIX}/links`,
      HUMAN,
      { ...VERSIONS, amountCents: 100, extra: 1 },
      400,
    ],
    [
      `${PREFIX}/links`,
      { ...HUMAN, 'idempotency-key': undefined },
      { ...VERSIONS, amountCents: 100 },
      400,
    ],
    [
      `${PREFIX}/links/${LINK}/cancel`,
      HUMAN,
      { ...VERSIONS, reason: 'x' },
      400,
    ],
    [
      `${PREFIX}/links/${LINK}/confirm-result`,
      HUMAN,
      { ...VERSIONS, nsu: 'x' },
      400,
    ],
    [
      `${PREFIX}/external-receipts`,
      HUMAN,
      {
        ...VERSIONS,
        amountCents: 100,
        receivedOn: '2026-11-05',
        method: 'cash',
        note: '',
        cancel: [],
      },
      400,
    ],
  ])) {
    const response = await api.inject({
      method: 'POST',
      url,
      headers: Object.fromEntries(
        Object.entries(headers).filter(([, value]) => value !== undefined),
      ),
      payload,
    });
    assert.equal(response.statusCode, status, url);
  }
  assert.equal(calls.length, 0);
  const created = await api.inject({
    method: 'POST',
    url: `${PREFIX}/links`,
    headers: HUMAN,
    payload: { ...VERSIONS, amountCents: 100, percent: 50 },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers['cache-control'], 'private, no-store');
  for (const [url, payload] of /** @type {Array<[string,any]>} */ ([
    [`${PREFIX}/links/${LINK}/cancel`, { ...VERSIONS }],
    [`${PREFIX}/links/${LINK}/confirm-result`, { ...VERSIONS }],
    [
      `${PREFIX}/links/${LINK}/confirm-result`,
      { ...VERSIONS, invoiceSlug: 'slug', transactionNsu: 'nsu' },
    ],
    [
      `${PREFIX}/external-receipts`,
      {
        ...VERSIONS,
        amountCents: 100,
        receivedOn: '2026-11-05',
        method: 'cash',
        note: '',
        cancelLinkIds: [LINK],
      },
    ],
  ])) {
    const response = await api.inject({
      method: 'POST',
      url,
      headers: HUMAN,
      payload,
    });
    assert.equal(response.statusCode, 200, url);
  }
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      'createLink',
      'cancelLink',
      'confirmLinkResult',
      'confirmLinkResult',
      'recordExternal',
    ],
  );
  assert.equal(calls[1].input.linkId, LINK);
  assert.equal(calls[0].input.idempotencyKey, 'synthetic-command-1');
});

test('LPC-03/04: a lost race answers its state and click instant only', async (t) => {
  const { api } = harness({
    cancelLink: async () => {
      throw Object.assign(new Error('BILLING_LINK_NOT_OPEN'), {
        code: 'BILLING_LINK_NOT_OPEN',
        statusCode: 409,
        details: {
          state: 'checkout_requested',
          clickedAt: '2026-11-23T17:03:00.000Z',
          token: TOKEN,
        },
      });
    },
  });
  t.after(() => api.close());
  const response = await api.inject({
    method: 'POST',
    url: `${PREFIX}/links/${LINK}/cancel`,
    headers: HUMAN,
    payload: VERSIONS,
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    type: 'about:blank',
    title: 'BILLING_LINK_NOT_OPEN',
    status: 409,
    code: 'BILLING_LINK_NOT_OPEN',
    state: 'checkout_requested',
    clickedAt: '2026-11-23T17:03:00.000Z',
  });
});

test('LPC-02: tokens are 26 Crockford characters with 130 random bits and read case-insensitively', async () => {
  const { newLinkToken, readLinkToken, linkTokenHash } =
    await import('../apps/api/src/order-billing-links.js');
  const tokens = new Set(Array.from({ length: 2000 }, () => newLinkToken()));
  assert.equal(tokens.size, 2000);
  for (const token of tokens) {
    assert.match(token, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
    assert.equal(readLinkToken(token.toLowerCase()), token);
  }
  for (const value of ['', 'short', 'I'.repeat(26), 'O'.repeat(26), null, 7])
    assert.equal(readLinkToken(value), null);
  assert.equal(linkTokenHash(TOKEN).length, 32);
});

test('LPC-01: a link send intent keeps linkId through the HTTP response schema', async (t) => {
  const { default: Fastify } = await import('fastify');
  const { registerOrderBillingChatRoutes } =
    await import('../apps/api/src/order-billing-chat-routes.js');
  const api = Fastify();
  t.after(() => api.close());
  const intent = {
    id: 'intent-link',
    version: 2,
    action: 'issue_link',
    chargeId: null,
    linkId: LINK,
    conversationId: 'conversation-synthetic',
    state: 'queued',
    blockedReason: null,
    messageId: 'billing-message:intent-link',
    commandId: 'billing-send:intent-link',
    amountCents: 6000,
    canRetry: false,
    supersedesChargeId: null,
    retryOfIntentId: null,
  };
  registerOrderBillingChatRoutes(
    api,
    {
      authorizeRead: async () => ({ actor: { id: 'synthetic-user' } }),
      authorizeWrite: async () => ({ actor: { id: 'synthetic-user' } }),
      getIntent: async () => intent,
    },
    () => ({ correlationId: 'synthetic' }),
    { enabled: true },
  );
  const response = await api.inject({
    url: `${PREFIX}/send-intents/intent-link`,
    headers: HUMAN,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), intent);
});
