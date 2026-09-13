import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
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
    clock: () => {
      clock += 60_000;
      return new Date(clock);
    },
    conversations: {
      readAssignment: async (/** @type {string} */ id) =>
        id in assignments ? { assignedUserId: assignments[id] } : null,
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
    idFactory: () => {
      sequence += 1;
      return `order-${sequence}`;
    },
    repository,
  });
  const api = createApi({}, { orders: runtime });
  return { api, assignments, guards, names, repository, runtime };
}

/** @param {any} runtime @param {string} conversationId */
async function createConfirmed(runtime, conversationId) {
  const { order } = await runtime.createManual({
    actor: SELLER,
    conversationId,
    correlationId: 'correlation-seed',
  });
  const edited = await runtime.patchSection({
    actor: SELLER,
    correlationId: 'correlation-seed',
    expectedVersion: order.version,
    orderId: order.id,
    section: 'items',
    value: synthetic.pedido.itens,
  });
  return runtime.confirm({
    actor: SELLER,
    amountText: '4.820,00',
    correlationId: 'correlation-seed',
    expectedVersion: edited.version,
    orderId: edited.id,
    paymentCondition: 'pix',
  });
}

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
  await runtime.createManual({
    actor: SELLER,
    conversationId: 'conversation-2',
    correlationId: 'correlation-seed',
  });

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
