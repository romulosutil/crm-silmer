import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';
import {
  STORE_NOW,
  STORE_ORIGIN,
  storeOrderBody,
} from './fixtures/store-order.js';

const HMAC_KEY = Buffer.alloc(32, 27);
const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'admin-1',
  kind: 'human',
});
const TRANSACTION = Object.freeze({ query: async () => ({ rows: [] }) });

/** @param {{acceptTest?: boolean, limits?: any}} [options] */
function setup(options = {}) {
  const repository = new InMemoryOrderRepository();
  let now = STORE_NOW.getTime();
  let ids = 0;
  const clock = () => new Date(now);
  const store = createStoreOrderService({
    acceptTest: options.acceptTest ?? true,
    clock,
    fabCode: '01',
    hmacKey: HMAC_KEY,
    idFactory: () => `order-store-${(ids += 1)}`,
    limits: options.limits,
    repository,
  });
  const orders = createOrderService({
    authorizeOwnership: async () => undefined,
    clock,
    conversations: {
      readOrderContexts: orderContextsFrom(() => ({
        briefing: { product_type: 'camisa' },
        customerName: 'Cliente do Bot',
      })),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    phoneDigestsFor: store.phoneDigestsFor,
    repository,
  });
  /**
   * @param {(body: any) => void} [change]
   * @param {{clientIp?: string}} [context]
   */
  async function notify(change, context = {}) {
    const body = storeOrderBody(change);
    return store.create({
      bodySha256: 'a'.repeat(64),
      clientIp: context.clientIp ?? '203.0.113.10',
      correlationId: `correlation-${body.pedido_id}`,
      origin: STORE_ORIGIN,
      request: store.parse(body),
      transaction: TRANSACTION,
    });
  }
  return {
    advance: (/** @type {number} */ ms) => (now += ms),
    notify,
    orders,
    repository,
    store,
  };
}

/** @param {number} index */
function requestId(index) {
  return `5b0c77ed-8c90-46ce-97a4-${String(index).padStart(12, '0')}`;
}

/** @param {Promise<unknown>} work @param {number} statusCode @param {string} code */
async function refuses(work, statusCode, code) {
  await assert.rejects(work, (error) => {
    assert.equal(/** @type {any} */ (error).statusCode, statusCode);
    assert.equal(/** @type {any} */ (error).code, code);
    return true;
  });
}

test('LOJ-06: a notice becomes a confirmed store order with no conversation', async () => {
  const { notify, orders, repository } = setup();
  const created = await notify();
  assert.equal(created.number, '01-CRM');
  assert.equal(created.status, 'confirmado');
  assert.equal(created.origin, 'loja');
  assert.equal(created.conversationId, null);
  assert.equal(created.version, 1);
  assert.deepEqual(
    repository.eventsFor(created.id).map((event) => event.eventType),
    ['order.created'],
  );
  const read = await orders.get(created.id);
  assert.equal(read.ficha.summary.cliente, 'Cliente Sintetico da Loja');
  assert.equal(read.ficha.loja?.telefone, '5527900000001');
  assert.deepEqual(read.missingFields, []);
  assert.equal(read.totalPieces, 10);
});

test('LOJ-13: the receipt keeps HMACs of the IP and the phone, never the values', async () => {
  const { notify, repository } = setup();
  const created = await notify();
  const receipt = repository.receiptFor(created.id);
  assert.ok(receipt);
  assert.equal(receipt.origin, STORE_ORIGIN);
  assert.equal(receipt.requestId, storeOrderBody().pedido_id);
  assert.match(receipt.ipDigest, /^[0-9a-f]{64}$/u);
  assert.match(receipt.phoneDigest, /^[0-9a-f]{64}$/u);
  assert.notEqual(receipt.ipDigest, receipt.phoneDigest);
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /203\.0\.113\.10|5527900000001/u);
});

test('LOJ-04/LOJ-05: a refused notice creates nothing', async () => {
  const { notify, orders } = setup({ acceptTest: false });
  await refuses(notify(), 422, 'teste_recusado');
  await refuses(
    notify((body) => {
      body.teste = false;
      body.valor_centavos = 100;
    }),
    422,
    'valor_divergente',
  );
  const page = await orders.list();
  assert.equal(page.items.length, 0);
  const real = await notify((body) => (body.teste = false));
  assert.equal(real.isTest, false);
});

test('LOJ-12: five orders an hour per IP, then 429 until the oldest leaves the hour', async () => {
  const { advance, notify } = setup();
  for (let index = 1; index <= 5; index += 1) {
    await notify((body) => {
      body.pedido_id = requestId(index);
      body.cliente.telefone = `55279000000${String(index).padStart(2, '0')}`;
    });
    advance(60_000);
  }
  await assert.rejects(
    notify((body) => {
      body.pedido_id = requestId(6);
      body.cliente.telefone = '5527900000099';
    }),
    (error) => {
      assert.equal(/** @type {any} */ (error).statusCode, 429);
      assert.equal(/** @type {any} */ (error).code, 'rate_limited');
      // The first order was five minutes ago: it leaves the hour in 55.
      assert.equal(/** @type {any} */ (error).retryAfterSeconds, 55 * 60);
      return true;
    },
  );
  // Another IP is not held back by this one.
  await notify(
    (body) => {
      body.pedido_id = requestId(7);
      body.cliente.telefone = '5527900000098';
    },
    { clientIp: '203.0.113.20' },
  );
  advance(55 * 60_000);
  await notify((body) => {
    body.pedido_id = requestId(8);
    body.cliente.telefone = '5527900000097';
  });
});

test('LOJ-12: five orders a day per phone, whatever the IP', async () => {
  const { advance, notify } = setup();
  for (let index = 1; index <= 5; index += 1) {
    await notify((body) => (body.pedido_id = requestId(index)), {
      clientIp: `203.0.113.${index}`,
    });
    advance(2 * 3_600_000);
  }
  await refuses(
    notify((body) => (body.pedido_id = requestId(6)), {
      clientIp: '203.0.113.99',
    }),
    429,
    'rate_limited',
  );
});

test('LOJ-12: the limits can be configured and must be positive', async () => {
  const { notify } = setup({ limits: { perIpPerHour: 1 } });
  await notify();
  await refuses(
    notify((body) => {
      body.pedido_id = requestId(2);
      body.cliente.telefone = '5527900000002';
    }),
    429,
    'rate_limited',
  );
  assert.throws(() => setup({ limits: { perPhonePerDay: 0 } }), TypeError);
});

test('LOJ-07: every write on a store order is ORDER_LOCKED, even for an admin', async () => {
  const { notify, orders } = setup();
  const created = await notify();
  const base = {
    actor: ADMIN,
    correlationId: 'correlation-write',
    expectedVersion: created.version,
    orderId: created.id,
  };
  await refuses(
    orders.patchSection({ ...base, section: 'observations', value: [] }),
    409,
    'ORDER_LOCKED',
  );
  await refuses(
    orders.confirm({ ...base, amountText: '193,64', paymentCondition: 'pix' }),
    409,
    'ORDER_LOCKED',
  );
  await refuses(orders.reopen(base), 409, 'ORDER_LOCKED');
  await refuses(
    orders.recordMilestones({
      ...base,
      deliveredOn: '2026-10-07',
      paidOn: '2026-10-07',
    }),
    409,
    'ORDER_LOCKED',
  );
});

test('LOJ-06: a store order never touches the pending order of a conversation', async () => {
  const { notify, orders } = setup();
  const { order: pending } = await orders.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-intent',
  });
  const store = await notify();
  const current = await orders.currentForConversation('conversation-1');
  assert.equal(current?.id, pending.id);
  assert.notEqual(store.id, pending.id);
  const again = await orders.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-intent-2',
  });
  assert.equal(again.created, false);
  assert.equal(again.order.id, pending.id);
});

test('LOJ-08: the list narrows to store orders and finds one by its whole phone', async () => {
  const { notify, orders } = setup();
  await orders.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-intent',
  });
  const store = await notify();
  const onlyStore = await orders.list({ origin: 'loja' });
  assert.deepEqual(
    onlyStore.items.map((order) => order.id),
    [store.id],
  );
  assert.deepEqual(onlyStore.counts, { confirmado: 1, pendente: 0 });
  for (const typed of [
    '(27) 90000-0001',
    '27900000001',
    '+55 27 90000-0001',
    '027 90000-0001',
  ]) {
    const found = await orders.list({ q: typed });
    assert.deepEqual(
      found.items.map((order) => order.id),
      [store.id],
      typed,
    );
  }
  const partial = await orders.list({ q: '90000-0001' });
  assert.deepEqual(partial.items, []);
  await assert.rejects(orders.list({ origin: 'site' }), {
    code: 'ORDER_INVALID',
  });
});

test('LOJ-09: a store sale counts like any sale; a test order does not', async () => {
  const { notify, orders } = setup();
  await notify();
  assert.deepEqual(await orders.summary(), {
    averageTicketCents: 0,
    confirmedCount: 0,
    pendingCount: 0,
    soldAmountCents: 0,
    totalPiecesSold: 0,
  });
  await notify((body) => {
    body.teste = false;
    body.pedido_id = requestId(2);
  });
  assert.deepEqual(await orders.summary(), {
    averageTicketCents: 19364,
    confirmedCount: 1,
    pendingCount: 0,
    soldAmountCents: 19364,
    totalPiecesSold: 10,
  });
});

test('the store service refuses an incomplete configuration', () => {
  const repository = new InMemoryOrderRepository();
  const base = {
    acceptTest: true,
    fabCode: '01',
    hmacKey: HMAC_KEY,
    repository,
  };
  assert.throws(
    () => createStoreOrderService({ ...base, hmacKey: Buffer.alloc(16) }),
    TypeError,
  );
  assert.throws(
    () => createStoreOrderService({ ...base, fabCode: ' ' }),
    TypeError,
  );
  assert.throws(
    () =>
      createStoreOrderService({
        ...base,
        acceptTest: /** @type {any} */ ('true'),
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createStoreOrderService({
        ...base,
        repository: /** @type {any} */ ({}),
      }),
    TypeError,
  );
});

test('a store order is created only inside a transaction', async () => {
  const repository = new InMemoryOrderRepository();
  const store = createStoreOrderService({
    acceptTest: true,
    clock: () => STORE_NOW,
    fabCode: '01',
    hmacKey: HMAC_KEY,
    repository,
  });
  await assert.rejects(
    store.create({
      bodySha256: 'a'.repeat(64),
      clientIp: '203.0.113.10',
      correlationId: 'correlation',
      origin: STORE_ORIGIN,
      request: store.parse(storeOrderBody()),
      transaction: undefined,
    }),
    TypeError,
  );
});
