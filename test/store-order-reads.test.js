import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import { renderOrderFicha } from '../modules/orders/src/print/index.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';
import {
  STORE_NOW,
  otherStoreOrderBody,
  storeOrderBody,
} from './fixtures/store-order.js';

const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  functionName: 'Vendedor',
  id: 'admin-1',
  kind: 'human',
});
const readHeaders = Object.freeze({
  cookie: 'crm_session=session-synthetic',
  origin: 'https://crm.example.test',
});
const writeHeaders = Object.freeze({
  ...readHeaders,
  'content-type': 'application/json',
  'x-csrf-token': 'csrf-synthetic',
});

function harness() {
  const repository = new InMemoryOrderRepository();
  let ids = 0;
  const store = createStoreOrderService({
    acceptTest: true,
    clock: () => STORE_NOW,
    fabCode: '01',
    hmacKey: Buffer.alloc(32, 27),
    idFactory: () => `order-store-${(ids += 1)}`,
    repository,
  });
  /** @type {string[][]} */
  const assignmentReads = [];
  const runtime = createOrderRuntime({
    access: {
      authorizeRead: async () => ({ actor: ADMIN }),
      authorizeWrite: async () => ({ actor: ADMIN }),
    },
    auditTrail: { append: async () => undefined },
    clock: () => STORE_NOW,
    conversations: {
      readAssignment: async () => ({ assignedUserId: 'admin-1', version: 1 }),
      readAssignments: async (/** @type {string[]} */ conversationIds) => {
        assignmentReads.push(conversationIds);
        return new Map(conversationIds.map((id) => [id, 'admin-1']));
      },
      readLatestMessageStates: async () => new Map(),
      readOrderContexts: orderContextsFrom(() => ({
        briefing: null,
        customerName: 'Cliente do Bot',
      })),
      readUserNames: async (/** @type {string[]} */ userIds) =>
        new Map(userIds.map((id) => [id, 'Administradora'])),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    phoneDigestsFor: store.phoneDigestsFor,
    repository,
  });
  const api = createApi({}, { orders: runtime });
  /** @param {(body: any) => void} [change] @param {any} [body] */
  async function notify(change, body = storeOrderBody(change)) {
    const outcome = await store.record({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${body.pedido_id}`,
      record: store.parse(body),
    });
    return outcome.order;
  }
  return { api, assignmentReads, notify, runtime };
}

test('LOJ-06/LOJ-08: a store order reads as locked, confirmed by Loja do site, with no seller', async () => {
  const { api, assignmentReads, notify } = harness();
  const created = await notify();
  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders/${created.id}`,
  });
  assert.equal(response.statusCode, 200);
  const { order } = response.json();
  assert.equal(order.origin, 'loja');
  assert.equal(order.locked, true);
  assert.equal(order.isTest, false);
  assert.equal(order.status, 'confirmado');
  assert.equal(order.conversationId, null);
  assert.equal(order.seller, null);
  assert.equal(order.lastMessage, null);
  assert.deepEqual(order.confirmedBy, {
    id: 'system:loja-do-site',
    name: 'Loja do site',
  });
  assert.equal(order.paidOn, '2026-10-07');
  assert.equal(order.ficha.loja.telefone, '5527900000001');
  // No conversation was looked up for an order that has none.
  assert.deepEqual(assignmentReads, []);
  await api.close();
});

test('LOJ-08: the list filters "Loja do site" and finds a store order by its phone', async () => {
  const { api, notify, runtime } = harness();
  const created = await notify();
  await runtime.createManual({
    actor: ADMIN,
    conversationId: 'conversation-1',
    correlationId: 'correlation-manual',
    expectedVersion: 1,
    idempotencyKey: 'manual-1',
  });
  const store = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?origin=loja',
  });
  assert.equal(store.statusCode, 200);
  assert.deepEqual(
    store.json().items.map((/** @type {any} */ order) => order.id),
    [created.id],
  );
  const all = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders',
  });
  assert.equal(all.json().items.length, 2);
  const byPhone = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders?q=${encodeURIComponent('(27) 90000-0001')}`,
  });
  assert.deepEqual(
    byPhone.json().items.map((/** @type {any} */ order) => order.id),
    [created.id],
  );
  const invalid = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders?origin=site',
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_FILTER');
  await api.close();
});

test('LOJ-07: every write on a store order answers 409 ORDER_LOCKED', async () => {
  const { api, notify } = harness();
  const created = await notify();
  const base = `/api/v1/orders/${created.id}`;
  /** @type {Array<[string, string, Record<string, unknown>]>} */
  const writes = [
    [
      'PATCH',
      `${base}/sections/observations`,
      { expectedVersion: 1, value: [] },
    ],
    [
      'POST',
      `${base}/confirm`,
      { amountText: '193,64', expectedVersion: 1, paymentCondition: 'pix' },
    ],
    ['POST', `${base}/reopen`, { expectedVersion: 1 }],
    [
      'PATCH',
      `${base}/milestones`,
      { deliveredOn: '2026-10-07', expectedVersion: 1, paidOn: '2026-10-07' },
    ],
  ];
  let key = 0;
  for (const [method, url, body] of writes) {
    const response = await api.inject({
      headers: { ...writeHeaders, 'idempotency-key': `locked-${(key += 1)}` },
      method: /** @type {any} */ (method),
      payload: body,
      url,
    });
    assert.equal(response.statusCode, 409, url);
    assert.deepEqual(response.json(), { error: { code: 'ORDER_LOCKED' } });
  }
  await api.close();
});

test('LOJ-10: the store order prints its simplified ficha with the standard fields only', async () => {
  const { api, notify } = harness();
  const created = await notify((body) => (body.teste = false));
  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders/${created.id}/print`,
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /^text\/html/u);
  assert.equal(response.headers['content-disposition'], undefined);
  const html = response.body;
  for (const expected of [
    'PEDIDO DA LOJA',
    'Origem: Loja do site',
    '01-CRM',
    '07/10/2026',
    'Cliente Sintetico da Loja',
    '+55 (27) 90000-0001',
    'Camisa Masculina Lisa Dry Fit',
    'Camiseta',
    'Masculino',
    'Preto',
    'Dry fit liso de poliéster',
    'Gola redonda',
    '<dt>Tamanho</dt><dd>M</dd>',
    '<dt>Quantidade</dt><dd>10</dd>',
    'R$ 180,00',
    '<dt>Forma</dt><dd>Pix</dd>',
  ]) {
    assert.ok(html.includes(expected), expected);
  }
  for (const absent of [
    /T[ée]cnica/u,
    /Arte/u,
    /Observa[çc]/u,
    /CONTROLE DE PRODUÇÃO/u,
    /Vendedor/u,
    /teste/iu,
  ]) {
    assert.doesNotMatch(html, absent);
  }
  await api.close();
});

test('LOJ-10: "Baixar ficha" sends the same document as pedido-NN-CRM.html', async () => {
  const { api, notify } = harness();
  const created = await notify((body) => (body.teste = true));
  const download = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: `/api/v1/orders/${created.id}/print?download=1`,
  });
  assert.equal(download.statusCode, 200);
  assert.equal(
    download.headers['content-disposition'],
    `attachment; filename="pedido-01-CRM.html"; filename*=UTF-8''pedido-01-CRM.html`,
  );
  assert.match(download.body, /Pedido de teste — não entregar/u);
  for (const query of ['download=2', 'download=1&x=1', 'formato=pdf']) {
    const refused = await api.inject({
      headers: readHeaders,
      method: 'GET',
      url: `/api/v1/orders/${created.id}/print?${query}`,
    });
    assert.equal(refused.statusCode, 400, query);
  }
  await api.close();
});

test('LOJ-10: the simplified ficha escapes what the customer typed', () => {
  const html = renderOrderFicha({
    ficha: {
      items: [],
      loja: { telefone: '5527900000001' },
      summary: { cliente: '<img src=x onerror=alert(1)>' },
    },
    number: '09-CRM',
    origin: 'loja',
  });
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});

test('LOJ-09: the summary counts a store sale like any sale and skips tests', async () => {
  const { api, notify } = harness();
  await notify((body) => (body.teste = true));
  await notify(undefined, otherStoreOrderBody(2));
  const response = await api.inject({
    headers: readHeaders,
    method: 'GET',
    url: '/api/v1/orders/summary',
  });
  assert.deepEqual(response.json(), {
    averageTicketCents: 18000,
    confirmedCount: 1,
    pendingCount: 0,
    soldAmountCents: 18000,
    totalPiecesSold: 10,
  });
  await api.close();
});
