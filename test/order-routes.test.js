import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const SELLER = Object.freeze({
  capabilities: [],
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});
const OTHER = Object.freeze({ ...SELLER, id: 'seller-2' });

const readHeaders = Object.freeze({
  cookie: 'crm_session=session-synthetic',
  origin: 'https://crm.example.test',
  'x-request-id': '30000000-0000-4000-8000-000000000001',
});

const ORDER_KEYS = [
  'confirmedAt',
  'confirmedBy',
  'conversationId',
  'createdAt',
  'fabCode',
  'ficha',
  'finalAmountCents',
  'id',
  'missingFields',
  'number',
  'orderDate',
  'paymentCondition',
  'reopenedAt',
  'reopenedBy',
  'seller',
  'status',
  'totalPieces',
  'updatedAt',
  'version',
];

/** @param {{readActor?: any, writeActor?: any}} [options] */
function orderHarness(options = {}) {
  /** @type {Record<string, string|null>} */
  const assignments = {
    'conversation-1': 'seller-1',
    'conversation-2': 'seller-1',
    'conversation-empty': null,
  };
  /** @type {Record<string, string|null>} */
  const names = { 'seller-1': 'Vendedora Um', 'seller-2': 'Vendedor Dois' };
  /** @type {Array<{method: string, input: any}>} */
  const guards = [];
  let clock = Date.parse('2026-09-12T15:00:00.000Z');
  let sequence = 0;
  const repository = new InMemoryOrderRepository();
  const runtime = createOrderRuntime({
    access: {
      authorizeRead: async (input) => {
        guards.push({ input, method: 'authorizeRead' });
        if (options.readActor === null) {
          throw Object.assign(new Error('forbidden'), {
            code: 'FORBIDDEN',
            statusCode: 403,
          });
        }
        return { actor: options.readActor ?? OTHER };
      },
      authorizeWrite: async (input) => {
        guards.push({ input, method: 'authorizeWrite' });
        return { actor: options.writeActor ?? SELLER };
      },
    },
    auditTrail: { append: async () => undefined },
    clock: () => {
      clock += 60_000;
      return new Date(clock);
    },
    conversations: {
      readAssignment: async (/** @type {string} */ id) =>
        id in assignments
          ? { assignedUserId: assignments[id], version: 4 }
          : null,
      readAssignments: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, assignments[id] ?? null])),
      readOrderContext: async (/** @type {string} */ id) =>
        id in assignments
          ? {
              briefing: { order_name: 'Equipe Sintetica' },
              customerName: 'Cliente Sintetico',
            }
          : null,
      readUserNames: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, names[id] ?? null])),
      searchConversationIds: async (/** @type {string} */ query) =>
        query === 'sintetico' ? ['conversation-2'] : [],
    },
    fabCode: '01',
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    idFactory: () => {
      sequence += 1;
      return `order-${sequence}`;
    },
    repository,
  });
  const api = createApi({}, { orders: runtime });
  return { api, assignments, guards, names, repository, runtime };
}

let seedSequence = 0;
/** @param {Record<string, unknown>} input */
function seed(input) {
  seedSequence += 1;
  return {
    actor: SELLER,
    correlationId: 'correlation-seed',
    idempotencyKey: `seed-${seedSequence}`,
    ...input,
  };
}

/** @param {any} runtime @param {string} conversationId */
async function createPending(runtime, conversationId) {
  const { order } = await runtime.createManual(
    seed({ conversationId, expectedVersion: 4 }),
  );
  return order;
}

/** @param {any} runtime @param {string} conversationId */
async function createConfirmed(runtime, conversationId) {
  const order = await createPending(runtime, conversationId);
  const edited = await runtime.patchSection(
    seed({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );
  return runtime.confirm(
    seed({
      amountText: '4.820,00',
      expectedVersion: edited.version,
      orderId: edited.id,
      paymentCondition: 'pix',
    }),
  );
}

const writeHeaders = Object.freeze({
  cookie: 'crm_session=session-synthetic; crm_csrf=csrf-synthetic',
  'content-type': 'application/json',
  'idempotency-key': 'order-command-1',
  origin: 'https://crm.example.test',
  'x-correlation-id': '30000000-0000-4000-8000-000000000002',
  'x-csrf-token': 'csrf-synthetic',
  'x-request-id': '30000000-0000-4000-8000-000000000003',
});

test('GET /orders/:orderId returns the Order contract with named actors', async (t) => {
  const { api, guards, runtime } = orderHarness();
  t.after(() => api.close());
  const confirmed = await createConfirmed(runtime, 'conversation-1');

  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders/${confirmed.id}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-cache');
  const { order } = response.json();
  assert.deepEqual(Object.keys(response.json()), ['order']);
  assert.deepEqual(Object.keys(order).sort(), ORDER_KEYS);
  assert.equal(order.number, '01-CRM');
  assert.equal(order.status, 'confirmado');
  assert.equal(order.finalAmountCents, 482000);
  assert.equal(order.totalPieces, 32);
  assert.deepEqual(order.confirmedBy, { id: 'seller-1', name: 'Vendedora Um' });
  assert.deepEqual(order.seller, { id: 'seller-1', name: 'Vendedora Um' });
  assert.equal(order.reopenedBy, null);
  assert.equal(order.ficha.summary.cliente, 'Cliente Sintetico');
  assert.deepEqual(
    guards.map((guard) => [guard.method, guard.input.action]),
    [['authorizeRead', 'order.read']],
  );
});

test('GET /orders/:orderId answers 404 ORDER_NOT_FOUND', async (t) => {
  const { api } = orderHarness();
  t.after(() => api.close());
  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders/order-missing',
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: { code: 'ORDER_NOT_FOUND' } });
});

test('GET /orders filters by status, searches and pages with counts', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  await createConfirmed(runtime, 'conversation-1');
  await createPending(runtime, 'conversation-2');

  const all = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?limit=1',
  });
  assert.equal(all.statusCode, 200);
  const firstPage = all.json();
  assert.deepEqual(Object.keys(firstPage).sort(), [
    'counts',
    'items',
    'nextCursor',
  ]);
  assert.deepEqual(firstPage.counts, { confirmado: 1, pendente: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.deepEqual(Object.keys(firstPage.items[0]).sort(), ORDER_KEYS);
  assert.ok(firstPage.nextCursor);

  const next = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  });
  assert.equal(next.json().items.length, 1);
  assert.notEqual(next.json().items[0].id, firstPage.items[0].id);
  assert.equal(next.json().nextCursor, null);

  const pending = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?status=pendente',
  });
  assert.deepEqual(
    pending.json().items.map((/** @type {any} */ order) => order.status),
    ['pendente'],
  );

  const searched = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?q=sintetico',
  });
  assert.deepEqual(
    searched
      .json()
      .items.map((/** @type {any} */ order) => order.conversationId),
    ['conversation-2'],
  );
  const byNumber = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?q=01-CRM',
  });
  assert.deepEqual(
    byNumber.json().items.map((/** @type {any} */ order) => order.number),
    ['01-CRM'],
  );
});

test('GET /orders refuses unknown or malformed parameters with 400', async (t) => {
  const { api, guards } = orderHarness();
  t.after(() => api.close());
  for (const query of [
    'unknown=1',
    'status=cancelado',
    'limit=0',
    'limit=101',
    'limit=abc',
    'q=',
    'cursor=not-a-cursor',
  ]) {
    const response = await api.inject({
      headers: readHeaders,
      method: 'GET',
      url: `/api/v1/orders?${query}`,
    });
    assert.equal(response.statusCode, 400, query);
    assert.equal(typeof response.json().error.code, 'string');
  }
  // Only the opaque cursor needs the service; every other shape error is
  // refused before the session is read.
  assert.equal(guards.length, 1);
});

test('GET /conversations/:conversationId/order returns the current order or null', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  const confirmed = await createConfirmed(runtime, 'conversation-1');

  const current = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/conversations/conversation-1/order',
  });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().order.id, confirmed.id);

  const empty = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/conversations/conversation-empty/order',
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { order: null });

  const missing = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/conversations/conversation-missing/order',
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), {
    error: { code: 'CONVERSATION_NOT_FOUND' },
  });
});

test('order reads refuse a request the session guard rejects', async (t) => {
  const { api } = orderHarness({ readActor: null });
  t.after(() => api.close());
  for (const url of [
    '/api/v1/orders',
    '/api/v1/orders/order-1',
    '/api/v1/conversations/conversation-1/order',
  ]) {
    const response = await api.inject({
      headers: readHeaders,
      method: 'GET',
      url,
    });
    assert.equal(response.statusCode, 403, url);
    assert.deepEqual(response.json(), { error: { code: 'FORBIDDEN' } });
  }
});

test('a seller without a name and an unassigned conversation still fit the contract', async (t) => {
  const { api, assignments, names, runtime } = orderHarness();
  t.after(() => api.close());
  const confirmed = await createConfirmed(runtime, 'conversation-1');
  names['seller-1'] = null;
  assignments['conversation-1'] = null;
  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders/${confirmed.id}`,
  });
  const { order } = response.json();
  assert.deepEqual(order.confirmedBy, { id: 'seller-1', name: '' });
  assert.equal(order.seller, null);
});

test('POST /conversations/:id/orders creates 201, then answers 200 with the pending order', async (t) => {
  const { api, guards } = orderHarness();
  t.after(() => api.close());
  const created = await api.inject({
    headers: writeHeaders,
    method: 'POST',
    payload: { expectedVersion: 4 },
    url: '/api/v1/conversations/conversation-1/orders',
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(Object.keys(created.json()), ['order']);
  const { order } = created.json();
  assert.deepEqual(Object.keys(order).sort(), ORDER_KEYS);
  assert.equal(order.status, 'pendente');
  assert.equal(order.ficha.summary.cliente, 'Cliente Sintetico');
  assert.equal(guards.at(-1)?.input.action, 'order.create');
  assert.equal(guards.at(-1)?.input.csrfToken, 'csrf-synthetic');

  const again = await api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'order-command-2' },
    method: 'POST',
    payload: { expectedVersion: 4 },
    url: '/api/v1/conversations/conversation-1/orders',
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().order.id, order.id);
});

test('order writes require an Idempotency-Key and expectedVersion before the session', async (t) => {
  const { api, guards, runtime } = orderHarness();
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');
  const withoutKey = { ...writeHeaders };
  Reflect.deleteProperty(withoutKey, 'idempotency-key');
  const createUrl = '/api/v1/conversations/conversation-1/orders';
  const sectionUrl = `/api/v1/orders/${pending.id}/sections/observations`;
  const cases =
    /** @type {Array<[any, any, 'POST'|'PATCH', string, string]>} */ ([
      [
        withoutKey,
        { expectedVersion: 4 },
        'POST',
        createUrl,
        'INVALID_IDEMPOTENCY_KEY',
      ],
      [writeHeaders, {}, 'POST', createUrl, 'INVALID_EXPECTED_VERSION'],
      [
        writeHeaders,
        { expectedVersion: 4, extra: true },
        'POST',
        createUrl,
        'INVALID_REQUEST',
      ],
      [
        withoutKey,
        { expectedVersion: pending.version, value: [] },
        'PATCH',
        sectionUrl,
        'INVALID_IDEMPOTENCY_KEY',
      ],
      [
        writeHeaders,
        { value: [] },
        'PATCH',
        sectionUrl,
        'INVALID_EXPECTED_VERSION',
      ],
      [
        writeHeaders,
        { expectedVersion: 0, value: [] },
        'PATCH',
        sectionUrl,
        'INVALID_EXPECTED_VERSION',
      ],
      [
        writeHeaders,
        { expectedVersion: pending.version },
        'PATCH',
        sectionUrl,
        'INVALID_REQUEST',
      ],
      [
        writeHeaders,
        { expectedVersion: pending.version, value: [] },
        'PATCH',
        `/api/v1/orders/${pending.id}/sections/pagamento`,
        'INVALID_SECTION',
      ],
    ]);
  for (const [headers, payload, method, url, code] of cases) {
    guards.length = 0;
    const response = await api.inject({ headers, method, payload, url });
    assert.equal(
      response.statusCode,
      400,
      `${method} ${url} ${JSON.stringify(payload)}`,
    );
    assert.deepEqual(response.json(), { error: { code } });
    assert.deepEqual(guards, []);
  }
});

test('PATCH /orders/:id/sections/:section saves the whole section', async (t) => {
  const { api, guards, runtime } = orderHarness();
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');
  const response = await api.inject({
    headers: writeHeaders,
    method: 'PATCH',
    payload: {
      expectedVersion: pending.version,
      value: synthetic.pedido.itens,
    },
    url: `/api/v1/orders/${pending.id}/sections/items`,
  });
  assert.equal(response.statusCode, 200);
  const { order } = response.json();
  assert.equal(order.version, pending.version + 1);
  assert.equal(order.totalPieces, 32);
  assert.ok(!order.missingFields.includes('items'));
  assert.equal(guards.at(-1)?.input.action, 'order.edit');
});

test('section writes answer 403 outside ownership, 409 on a stale version and 422 with fields', async (t) => {
  const { api, runtime } = orderHarness({ writeActor: OTHER });
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');

  const forbidden = await api.inject({
    headers: writeHeaders,
    method: 'PATCH',
    payload: { expectedVersion: pending.version, value: [] },
    url: `/api/v1/orders/${pending.id}/sections/observations`,
  });
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(forbidden.json(), { error: { code: 'FORBIDDEN' } });

  const createForbidden = await api.inject({
    headers: writeHeaders,
    method: 'POST',
    payload: { expectedVersion: 4 },
    url: '/api/v1/conversations/conversation-2/orders',
  });
  assert.equal(createForbidden.statusCode, 403);

  const owner = orderHarness();
  t.after(() => owner.api.close());
  const mine = await createPending(owner.runtime, 'conversation-1');
  const stale = await owner.api.inject({
    headers: writeHeaders,
    method: 'PATCH',
    payload: { expectedVersion: mine.version + 3, value: [] },
    url: `/api/v1/orders/${mine.id}/sections/observations`,
  });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json(), { error: { code: 'VERSION_CONFLICT' } });

  const staleConversation = await owner.api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'stale-conversation' },
    method: 'POST',
    payload: { expectedVersion: 3 },
    url: '/api/v1/conversations/conversation-2/orders',
  });
  assert.equal(staleConversation.statusCode, 409);
  assert.deepEqual(staleConversation.json(), {
    error: { code: 'VERSION_CONFLICT' },
  });

  const items = structuredClone(synthetic.pedido.itens);
  items[0].grade[1].quantidade = 0;
  const invalid = await owner.api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'invalid-grade' },
    method: 'PATCH',
    payload: { expectedVersion: mine.version, value: items },
    url: `/api/v1/orders/${mine.id}/sections/items`,
  });
  assert.equal(invalid.statusCode, 422);
  assert.deepEqual(invalid.json(), {
    error: { code: 'INVALID_GRADE', fields: ['items[0].grade[1]'], index: 1 },
  });

  const missing = await owner.api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'missing-order' },
    method: 'PATCH',
    payload: { expectedVersion: 1, value: [] },
    url: '/api/v1/orders/order-missing/sections/observations',
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: { code: 'ORDER_NOT_FOUND' } });
});

test('a retried write with the same key replays; another body under that key is 409', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');
  const request = {
    headers: { ...writeHeaders, 'idempotency-key': 'retry-key' },
    method: /** @type {const} */ ('PATCH'),
    payload: { expectedVersion: pending.version, value: ['Linha 1'] },
    url: `/api/v1/orders/${pending.id}/sections/observations`,
  };
  const first = await api.inject(request);
  const replay = await api.inject(request);
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(
    (await runtime.get(pending.id)).order.version,
    pending.version + 1,
  );

  const reused = await api.inject({
    ...request,
    payload: { expectedVersion: pending.version, value: ['Outra'] },
  });
  assert.equal(reused.statusCode, 409);
  assert.deepEqual(reused.json(), {
    error: { code: 'IDEMPOTENCY_KEY_REUSED' },
  });
});

test('a malformed section answers 400 without echoing its content', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');
  const summary = await api.inject({
    headers: writeHeaders,
    method: 'PATCH',
    payload: {
      expectedVersion: pending.version,
      value: { nome: 'PII-canary' },
    },
    url: `/api/v1/orders/${pending.id}/sections/summary`,
  });
  assert.equal(summary.statusCode, 400);
  assert.deepEqual(summary.json(), { error: { code: 'ORDER_INVALID' } });
  assert.equal(summary.body.includes('PII-canary'), false);
});

/** @param {any} runtime @param {string} conversationId */
async function createReady(runtime, conversationId) {
  const order = await createPending(runtime, conversationId);
  return runtime.patchSection(
    seed({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );
}

test('POST /orders/:id/confirm confirms with amount and condition', async (t) => {
  const { api, guards, runtime } = orderHarness();
  t.after(() => api.close());
  const ready = await createReady(runtime, 'conversation-1');
  const response = await api.inject({
    headers: writeHeaders,
    method: 'POST',
    payload: {
      amountText: '4.820,00',
      expectedVersion: ready.version,
      paymentCondition: 'cartao_credito',
    },
    url: `/api/v1/orders/${ready.id}/confirm`,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json()), ['order']);
  const { order } = response.json();
  assert.deepEqual(Object.keys(order).sort(), ORDER_KEYS);
  assert.equal(order.status, 'confirmado');
  assert.equal(order.finalAmountCents, 482000);
  assert.equal(order.paymentCondition, 'cartao_credito');
  assert.deepEqual(order.confirmedBy, { id: 'seller-1', name: 'Vendedora Um' });
  assert.match(order.orderDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(guards.at(-1)?.input.action, 'order.confirm');
});

test('confirming without what A01 requires answers 422 ORDER_NOT_CONFIRMABLE with fields', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  const pending = await createPending(runtime, 'conversation-1');
  const blocked = await api.inject({
    headers: writeHeaders,
    method: 'POST',
    payload: { expectedVersion: pending.version },
    url: `/api/v1/orders/${pending.id}/confirm`,
  });
  assert.equal(blocked.statusCode, 422);
  assert.deepEqual(blocked.json(), {
    error: {
      code: 'ORDER_NOT_CONFIRMABLE',
      fields: ['items', 'finalAmount', 'paymentCondition'],
    },
  });

  const malformed = await api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'malformed-amount' },
    method: 'POST',
    payload: {
      amountText: '4,820.00',
      expectedVersion: pending.version,
      paymentCondition: 'pix',
    },
    url: `/api/v1/orders/${pending.id}/confirm`,
  });
  assert.equal(malformed.statusCode, 422);
  assert.deepEqual(malformed.json(), {
    error: { code: 'INVALID_AMOUNT', fields: ['finalAmount'] },
  });
  assert.equal(
    (await runtime.get(pending.id)).order.status,
    'pendente',
    'a refused confirmation keeps the order pending',
  );
});

test('two confirmations on the same version: one 200, the other 409', async (t) => {
  const { api, runtime } = orderHarness();
  t.after(() => api.close());
  const ready = await createReady(runtime, 'conversation-1');
  const confirm = (/** @type {string} */ key) =>
    api.inject({
      headers: { ...writeHeaders, 'idempotency-key': key },
      method: 'POST',
      payload: {
        amountText: '100,00',
        expectedVersion: ready.version,
        paymentCondition: 'pix',
      },
      url: `/api/v1/orders/${ready.id}/confirm`,
    });
  const responses = await Promise.all([confirm('first'), confirm('second')]);
  assert.deepEqual(
    responses.map((response) => response.statusCode).sort(),
    [200, 409],
  );
  const conflict = responses.find((response) => response.statusCode === 409);
  assert.deepEqual(conflict?.json(), { error: { code: 'VERSION_CONFLICT' } });
});

test('POST /orders/:id/reopen returns a confirmed order to pending', async (t) => {
  const { api, guards, runtime } = orderHarness();
  t.after(() => api.close());
  const confirmed = await createConfirmed(runtime, 'conversation-1');
  const response = await api.inject({
    headers: writeHeaders,
    method: 'POST',
    payload: { expectedVersion: confirmed.version },
    url: `/api/v1/orders/${confirmed.id}/reopen`,
  });
  assert.equal(response.statusCode, 200);
  const { order } = response.json();
  assert.equal(order.status, 'pendente');
  assert.equal(order.number, confirmed.number);
  assert.equal(order.finalAmountCents, confirmed.finalAmountCents);
  assert.equal(order.paymentCondition, confirmed.paymentCondition);
  assert.deepEqual(order.reopenedBy, { id: 'seller-1', name: 'Vendedora Um' });
  assert.equal(guards.at(-1)?.input.action, 'order.reopen');

  const again = await api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'reopen-again' },
    method: 'POST',
    payload: { expectedVersion: order.version },
    url: `/api/v1/orders/${confirmed.id}/reopen`,
  });
  assert.equal(again.statusCode, 409);
  assert.deepEqual(again.json(), { error: { code: 'ORDER_STATUS_CONFLICT' } });

  const reconfirmed = await api.inject({
    headers: { ...writeHeaders, 'idempotency-key': 'reconfirm' },
    method: 'POST',
    payload: {
      amountText: '5.000,00',
      expectedVersion: order.version,
      paymentCondition: 'pix',
    },
    url: `/api/v1/orders/${confirmed.id}/confirm`,
  });
  assert.equal(reconfirmed.statusCode, 200);
  assert.equal(reconfirmed.json().order.finalAmountCents, 500000);
  assert.notEqual(
    reconfirmed.json().order.confirmedAt,
    confirmed.confirmedAt,
    'PCL-12: a new confirmation records its own time',
  );
});

test('confirm and reopen refuse non-owners and malformed requests', async (t) => {
  const { api, guards, runtime } = orderHarness({ writeActor: OTHER });
  t.after(() => api.close());
  const confirmed = await createConfirmed(runtime, 'conversation-1');
  const pending = await createReady(runtime, 'conversation-2');
  for (const [url, payload] of /** @type {Array<[string, any]>} */ ([
    [
      `/api/v1/orders/${pending.id}/confirm`,
      {
        amountText: '10,00',
        expectedVersion: pending.version,
        paymentCondition: 'pix',
      },
    ],
    [
      `/api/v1/orders/${confirmed.id}/reopen`,
      { expectedVersion: confirmed.version },
    ],
  ])) {
    const response = await api.inject({
      headers: writeHeaders,
      method: 'POST',
      payload,
      url,
    });
    assert.equal(response.statusCode, 403, url);
    assert.deepEqual(response.json(), { error: { code: 'FORBIDDEN' } });
  }

  const withoutKey = { ...writeHeaders };
  Reflect.deleteProperty(withoutKey, 'idempotency-key');
  const cases = /** @type {Array<[any, string, any, string]>} */ ([
    [
      withoutKey,
      `/api/v1/orders/${pending.id}/confirm`,
      { expectedVersion: pending.version },
      'INVALID_IDEMPOTENCY_KEY',
    ],
    [
      writeHeaders,
      `/api/v1/orders/${pending.id}/confirm`,
      { amountText: '10,00', paymentCondition: 'pix' },
      'INVALID_EXPECTED_VERSION',
    ],
    [
      writeHeaders,
      `/api/v1/orders/${pending.id}/confirm`,
      { amountText: 10, expectedVersion: pending.version },
      'INVALID_REQUEST',
    ],
    [
      writeHeaders,
      `/api/v1/orders/${pending.id}/confirm`,
      { expectedVersion: pending.version, status: 'confirmado' },
      'INVALID_REQUEST',
    ],
    [
      withoutKey,
      `/api/v1/orders/${confirmed.id}/reopen`,
      { expectedVersion: confirmed.version },
      'INVALID_IDEMPOTENCY_KEY',
    ],
    [
      writeHeaders,
      `/api/v1/orders/${confirmed.id}/reopen`,
      { expectedVersion: confirmed.version, reason: 'x' },
      'INVALID_REQUEST',
    ],
  ]);
  for (const [headers, url, payload, code] of cases) {
    guards.length = 0;
    const response = await api.inject({
      headers,
      method: 'POST',
      payload,
      url,
    });
    assert.equal(response.statusCode, 400, `${url} ${JSON.stringify(payload)}`);
    assert.deepEqual(response.json(), { error: { code } });
    assert.deepEqual(guards, []);
  }
});
