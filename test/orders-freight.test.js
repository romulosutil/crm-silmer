import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';

import { createShippingQuoteReader } from '../apps/api/src/conversation-shipping-runtime.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import {
  AUTOMATION_ORDER_ACTIONS,
  AUTOMATION_STORE_ACTIONS,
  OPERATIONAL_ACTIONS,
  authorize,
} from '../modules/identity-access/src/index.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import {
  MAX_FREIGHT_CENTS,
  orderAmounts,
  orderFreightCents,
  orderTotalCents,
  parseFreightCents,
} from '../modules/orders/src/domain/freight.js';
import {
  confirmOrder,
  reopenOrder,
} from '../modules/orders/src/domain/order.js';
import { renderOrderFicha } from '../modules/orders/src/print/index.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';
import { syntheticItems } from './fixtures/order-items.js';
import { fixturePricing, priceDraft } from './fixtures/size-pricing.js';
import { STORE_NOW, storeOrderBody } from './fixtures/store-order.js';

// OLC-T01 / ADR 080 (OLC-05a-j). Synthetic data only.

const SELLER = Object.freeze({
  capabilities: [],
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});
const OTHER = Object.freeze({ ...SELLER, id: 'seller-2' });
const ADMIN = Object.freeze({
  ...SELLER,
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'admin-1',
});
const PIECES = 482000;

/** @param {{quotes?: any}} [options] */
function harness(options = {}) {
  /** @type {Record<string, string|null>} */
  const assignments = {
    'conversation-1': 'seller-1',
    'conversation-admin': 'admin-1',
  };
  /** @type {any[]} */
  const audits = [];
  const repository = new InMemoryOrderRepository();
  const idempotencyStore = new InMemoryIdempotencyRecordStore();
  let clock = Date.parse('2026-11-10T15:00:00.000Z');
  let ids = 0;
  const runtime = createOrderRuntime({
    access: {
      authorizeRead: async () => ({ actor: SELLER }),
      authorizeWrite: async () => ({ actor: SELLER }),
    },
    auditTrail: {
      append: async (/** @type {any} */ event) => void audits.push(event),
    },
    clock: () => new Date((clock += 60_000)),
    conversations: {
      readAssignment: async (/** @type {string} */ id) =>
        id in assignments
          ? { assignedUserId: assignments[id], version: 4 }
          : null,
      readAssignments: async (/** @type {string[]} */ list) =>
        new Map(list.map((id) => [id, assignments[id] ?? null])),
      readContactNames: async (/** @type {string[]} */ list) =>
        new Map(list.map((id) => [id, 'Cliente Sintetico'])),
      readLatestMessageStates: async () => new Map(),
      readOrderContexts: orderContextsFrom((/** @type {string} */ id) =>
        id in assignments
          ? { briefing: null, customerName: 'Cliente Sintetico' }
          : null,
      ),
      readUserNames: async (/** @type {string[]} */ list) =>
        new Map(list.map((id) => [id, `Nome ${id}`])),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    freightNoticeDatabase: options.quotes
      ? { query: async () => ({}) }
      : undefined,
    freightQuotes: options.quotes,
    idFactory: () => `order-${(ids += 1)}`,
    idempotencyStore,
    repository,
  });
  return { assignments, audits, repository, runtime };
}

let sequence = 0;
/** @param {any} actor @param {Record<string, unknown>} extra @returns {any} */
function command(actor, extra) {
  sequence += 1;
  return {
    actor,
    correlationId: `correlation-freight-${sequence}`,
    idempotencyKey: `freight-key-${sequence}`,
    ...extra,
  };
}

/**
 * A pending order priced by size, ready to be generated.
 *
 * @param {any} runtime @param {any} [actor] @param {string|null} [conversationId]
 */
async function ready(
  runtime,
  actor = SELLER,
  conversationId = 'conversation-1',
) {
  let order =
    conversationId === null
      ? await runtime.createForContact(
          command(actor, { contactId: 'contact-1' }),
        )
      : (
          await runtime.createManual(
            command(actor, { conversationId, expectedVersion: 4 }),
          )
        ).order;
  for (const [section, value] of Object.entries({
    summary: {
      aplicacao: null,
      data_entrega_confirmada: '2026-12-01',
      nome: null,
    },
    items: syntheticItems(),
    artwork: { feito_pela_silmer: false, feito_pelo_cliente: true },
  })) {
    order = await runtime.patchSection(
      command(actor, {
        expectedVersion: order.version,
        orderId: order.id,
        section,
        value,
      }),
    );
  }
  return order;
}

/** @param {any} runtime @param {any} [actor] @param {string|null} [conversationId] */
async function priced(
  runtime,
  actor = SELLER,
  conversationId = 'conversation-1',
) {
  return priceDraft(
    runtime,
    await ready(runtime, actor, conversationId),
    PIECES,
    actor,
  );
}

/** @param {any} runtime @param {any} order @param {unknown} freightCents @param {any} [actor] null is "no actor" */
function inform(runtime, order, freightCents, actor = SELLER) {
  return runtime.setFreight(
    command(actor, {
      expectedVersion: order.version,
      freightCents,
      orderId: order.id,
    }),
  );
}

// ---------------------------------------------------------------- domain

test('OLC-05c: freight is an exact, non-negative integer number of cents', () => {
  assert.equal(parseFreightCents(0), 0);
  assert.equal(Object.is(parseFreightCents(-0), 0), true);
  assert.equal(parseFreightCents(3750), 3750);
  assert.equal(parseFreightCents(MAX_FREIGHT_CENTS), MAX_FREIGHT_CENTS);
  for (const invalid of [
    -1,
    0.5,
    37.5,
    '3750',
    '37,50',
    '',
    null,
    undefined,
    true,
    [],
    {},
    3750n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.throws(
      () => parseFreightCents(invalid),
      { code: 'FREIGHT_INVALID', fields: ['freightCents'], statusCode: 422 },
      String(invalid),
    );
  }
  for (const overflow of [MAX_FREIGHT_CENTS + 1, 2 ** 60, 1e300]) {
    assert.throws(() => parseFreightCents(overflow), {
      code: 'FREIGHT_OVERFLOW',
      statusCode: 422,
    });
  }
});

test('OLC-05a/b: the total is pieces + freight; incomplete pieces have no total; nothing is rounded', () => {
  assert.equal(orderTotalCents(PIECES, 0), PIECES);
  assert.equal(orderTotalCents(PIECES, 3751), PIECES + 3751);
  // Freight alone never makes a total.
  assert.equal(orderTotalCents(null, 3751), null);
  assert.equal(orderTotalCents(1, MAX_FREIGHT_CENTS - 1), MAX_FREIGHT_CENTS);
  assert.throws(() => orderTotalCents(2, MAX_FREIGHT_CENTS - 1), {
    code: 'FREIGHT_OVERFLOW',
  });
  assert.throws(() => orderTotalCents(PIECES, -1), { code: 'FREIGHT_INVALID' });
});

test('OLC-05d: legacy and store orders carry no freight even if a value is present', () => {
  const ficha = { items: [], observations: [], serviceData: {}, summary: {} };
  const legacy = /** @type {any} */ ({
    ficha,
    finalAmountCents: 9000,
    freightCents: 500,
    origin: 'atendimento',
  });
  assert.equal(orderFreightCents(legacy), 0);
  assert.deepEqual(orderAmounts(legacy), {
    freightCents: 0,
    piecesCents: 9000,
    totalCents: 9000,
  });
  const store = /** @type {any} */ ({ ...legacy, origin: 'loja' });
  assert.equal(orderFreightCents(store), 0);
  assert.deepEqual(orderAmounts(store), {
    freightCents: 0,
    piecesCents: 9000,
    totalCents: 9000,
  });
});

test('OLC-05a/i: confirming freezes pieces + freight and refuses a divergent declared amount', () => {
  const ficha = fixturePricing(
    {
      artwork: {
        feito_pela_silmer: false,
        feito_pelo_cliente: true,
        files: [],
        sem_estampa: false,
      },
      items: syntheticItems(),
      observations: [],
      serviceData: {},
      summary: {
        aplicacao: null,
        cliente: 'Cliente Sintetico',
        data_entrega_confirmada: '2026-12-01',
        nome: null,
      },
    },
    PIECES,
  );
  const order = /** @type {any} */ ({
    ficha,
    finalAmountCents: PIECES + 3750,
    freightCents: 3750,
    origin: 'atendimento',
    paidOn: null,
    status: 'pendente',
  });
  const input = {
    actorId: 'seller-1',
    now: new Date('2026-11-10T15:00:00.000Z'),
    paymentCondition: /** @type {const} */ ('pix'),
  };
  const confirmed = confirmOrder(order, input);
  assert.equal(confirmed.finalAmountCents, PIECES + 3750);
  assert.equal(confirmed.freightCents, 3750);
  assert.equal(
    confirmOrder(order, { ...input, amountCents: PIECES + 3750 })
      .finalAmountCents,
    PIECES + 3750,
  );
  // The pieces alone are no longer the order's amount.
  assert.throws(() => confirmOrder(order, { ...input, amountCents: PIECES }), {
    code: 'SIZE_PRICING_AMOUNT_MISMATCH',
    fields: ['finalAmount'],
  });
  // Zero or absent freight: the total is the pieces.
  for (const freightCents of [0, undefined]) {
    assert.equal(
      confirmOrder({ ...order, freightCents }, input).finalAmountCents,
      PIECES,
    );
  }
  const reopened = reopenOrder(confirmed, {
    actorId: 'seller-1',
    now: new Date('2026-11-10T16:00:00.000Z'),
  });
  assert.equal(reopened.freightCents, 3750);
  assert.equal(reopened.finalAmountCents, PIECES + 3750);
});

test('OLC-05d: a legacy additive composition has no freight and must still equal the existing total', () => {
  const ficha = /** @type {any} */ ({
    artwork: {
      feito_pela_silmer: false,
      feito_pelo_cliente: true,
      files: [],
      sem_estampa: false,
    },
    items: syntheticItems(),
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: null,
      cliente: 'Cliente Sintetico',
      data_entrega_confirmada: '2026-12-01',
      nome: null,
    },
  });
  // The composition lives beside the ficha (sidecar), never inside it.
  const legacySizePricing = fixturePricing(ficha, 9000).sizePricing;
  const legacy = /** @type {any} */ ({
    ficha,
    finalAmountCents: 9000,
    // Even a stray value is ignored: a legacy order has no freight.
    freightCents: 500,
    legacySizePricing,
    origin: 'atendimento',
    paidOn: '2026-11-01',
    status: 'pendente',
  });
  const input = {
    actorId: 'seller-1',
    now: new Date('2026-11-10T15:00:00.000Z'),
    paymentCondition: /** @type {const} */ ('pix'),
  };
  const confirmed = confirmOrder(legacy, input);
  assert.equal(confirmed.finalAmountCents, 9000);
  // The historical total did not change, so its settlement stands.
  assert.equal(confirmed.paidOn, '2026-11-01');
  assert.throws(
    () => confirmOrder({ ...legacy, finalAmountCents: 9500 }, input),
    { code: 'SIZE_PRICING_AMOUNT_MISMATCH', fields: ['priceBreakdown'] },
  );
});

// ----------------------------------------------------------- authorization

test('order.freight is an operational action no automation list carries; assistants and disabled users are denied', () => {
  assert.equal(OPERATIONAL_ACTIONS.has('order.freight'), true);
  assert.equal(AUTOMATION_ORDER_ACTIONS.includes('order.freight'), false);
  assert.equal(AUTOMATION_STORE_ACTIONS.includes('order.freight'), false);
  const seller = /** @type {any} */ ({ ...SELLER });
  authorize(seller, 'order.freight');
  for (const denied of [
    { ...seller, kind: 'assistant' },
    { ...seller, disabledAt: '2026-11-10T12:00:00.000Z' },
    { ...seller, functionName: 'Financeiro' },
  ]) {
    assert.throws(() => authorize(denied, 'order.freight'), {
      code: 'FORBIDDEN',
    });
  }
});

test('OLC-05h: only the responsible seller informs the freight; an admin only as that seller', async () => {
  const { runtime, repository, assignments } = harness();
  const order = await priced(runtime);

  // An admin who is not the responsible seller edits the order, not its freight.
  await assert.rejects(inform(runtime, order, 3750, ADMIN), {
    code: 'FORBIDDEN',
    statusCode: 403,
  });
  await assert.rejects(inform(runtime, order, 3750, OTHER), {
    code: 'FORBIDDEN',
  });
  for (const actor of [
    { ...SELLER, kind: 'assistant' },
    { ...SELLER, kind: 'automation' },
    { id: 'AUTOMATION_EXECUTOR', kind: 'technical' },
    null,
  ]) {
    await assert.rejects(inform(runtime, order, 3750, actor), {
      code: 'FORBIDDEN',
    });
  }
  const untouched = await repository.findById(order.id);
  assert.equal(untouched?.version, order.version);
  assert.equal(untouched?.freightCents, 0);
  assert.deepEqual(repository.freightEventsFor(order.id), []);

  const informed = await inform(runtime, order, 3750);
  assert.equal(informed.freight.cents, 3750);
  assert.deepEqual(informed.freight.setBy, {
    id: 'seller-1',
    name: 'Nome seller-1',
  });

  // The conversation moved to the admin: now the admin is the responsible
  // seller and the previous owner is not.
  assignments['conversation-1'] = 'admin-1';
  await assert.rejects(inform(runtime, informed, 4000), { code: 'FORBIDDEN' });
  const byAdmin = await inform(runtime, informed, 4000, ADMIN);
  assert.equal(byAdmin.freight.cents, 4000);
  assert.equal(byAdmin.freight.setBy.id, 'admin-1');

  // A manual order without conversation: its owner, never another admin.
  const manual = await priced(runtime, SELLER, null);
  await assert.rejects(inform(runtime, manual, 100, ADMIN), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(inform(runtime, manual, 100, OTHER), {
    code: 'FORBIDDEN',
  });
  assert.equal((await inform(runtime, manual, 100)).freight.cents, 100);
});

test('OLC-05h/i: confirmed, cancelled, store and legacy orders refuse a freight', async () => {
  const { runtime, repository } = harness();

  const confirmed = await runtime.confirm(
    command(SELLER, {
      ...(({ id, version }) => ({ expectedVersion: version, orderId: id }))(
        await priced(runtime),
      ),
      paymentCondition: 'pix',
    }),
  );
  await assert.rejects(inform(runtime, confirmed, 3750), {
    code: 'ORDER_STATUS_CONFLICT',
    statusCode: 409,
  });

  const legacy = await ready(runtime);
  assert.equal(legacy.ficha.sizePricing, undefined);
  await assert.rejects(inform(runtime, legacy, 3750), {
    code: 'SIZE_PRICING_NOT_INITIALIZED',
    statusCode: 409,
  });

  const cancelled = await runtime.cancel(
    command(SELLER, {
      expectedVersion: legacy.version,
      orderId: legacy.id,
      reason: 'Motivo sintetico',
    }),
  );
  await assert.rejects(inform(runtime, cancelled, 3750), {
    code: 'ORDER_CANCELLED',
    statusCode: 409,
  });

  const store = createStoreOrderService({
    acceptTest: true,
    clock: () => STORE_NOW,
    fabCode: '01',
    hmacKey: Buffer.alloc(32, 27),
    idFactory: () => 'order-store-freight',
    repository,
  });
  const body = storeOrderBody();
  const { order: shop } = await store.record({
    actor: 'AUTOMATION_EXECUTOR',
    correlationId: 'correlation-store-freight',
    record: store.parse(body),
  });
  for (const actor of [SELLER, ADMIN]) {
    await assert.rejects(inform(runtime, shop, 3750, actor), {
      code: 'ORDER_LOCKED',
      statusCode: 409,
    });
  }
  const shown = (await runtime.get(shop.id)).order;
  assert.equal(shown.finalAmountCents, shop.finalAmountCents);
  assert.deepEqual(shown.amounts, {
    freightCents: 0,
    piecesCents: shop.finalAmountCents,
    totalCents: shop.finalAmountCents,
  });
  assert.equal(shown.freight.cents, 0);
  assert.equal(shown.freight.source, null);
  assert.equal(shown.freight.pricingRule, 'pieces-v1');
});

// ------------------------------------------------------------------ command

test('OLC-05a/b/c: positive, zero and absent freight; invalid values write nothing', async () => {
  const { runtime, repository, audits } = harness();
  const order = await priced(runtime);
  assert.deepEqual(order.amounts, {
    freightCents: 0,
    piecesCents: PIECES,
    totalCents: PIECES,
  });
  assert.deepEqual(order.freight, {
    cents: 0,
    pricingRule: 'pieces-v1',
    quoteId: null,
    quoteNotice: null,
    quotedCents: null,
    serviceId: null,
    setAt: null,
    setBy: null,
    source: null,
  });
  // Absent freight is not a pendency.
  assert.deepEqual(order.missingFields, ['paymentCondition']);

  for (const [value, code] of /** @type {[unknown, string][]} */ ([
    [-1, 'FREIGHT_INVALID'],
    [37.5, 'FREIGHT_INVALID'],
    ['3750', 'FREIGHT_INVALID'],
    [null, 'FREIGHT_INVALID'],
    [MAX_FREIGHT_CENTS + 1, 'FREIGHT_OVERFLOW'],
    // Valid alone, but pieces + freight leaves the money limit.
    [MAX_FREIGHT_CENTS, 'FREIGHT_OVERFLOW'],
  ])) {
    await assert.rejects(inform(runtime, order, value), {
      code,
      statusCode: 422,
    });
  }
  assert.equal((await repository.findById(order.id))?.version, order.version);
  assert.deepEqual(repository.freightEventsFor(order.id), []);

  const revision = (await repository.findById(order.id))?.commercialRevision;
  const informed = await inform(runtime, order, 3751);
  assert.equal(informed.version, order.version + 1);
  assert.equal(informed.finalAmountCents, PIECES + 3751);
  assert.deepEqual(informed.amounts, {
    freightCents: 3751,
    piecesCents: PIECES,
    totalCents: PIECES + 3751,
  });
  assert.equal(informed.pricing.totalCents, PIECES);
  assert.equal(informed.freight.source, 'seller');
  assert.equal(informed.freight.pricingRule, 'pieces-freight-v1');
  assert.deepEqual(informed.missingFields, ['paymentCondition']);
  // The freight is commercially exportable content; a paid day is not.
  assert.equal(
    (await repository.findById(order.id))?.commercialRevision,
    Number(revision) + 1,
  );
  assert.deepEqual(repository.eventsFor(order.id).at(-1), {
    aggregateVersion: informed.version,
    correlationId: repository.eventsFor(order.id).at(-1)?.correlationId,
    eventType: 'order.freight_updated',
    occurredAt: informed.updatedAt,
    // Identifiers only.
    payload: { conversationId: 'conversation-1', orderId: order.id },
  });
  assert.deepEqual(repository.freightEventsFor(order.id), [
    {
      actorId: 'seller-1',
      freightCents: 3751,
      kind: 'set',
      occurredAt: informed.updatedAt,
      orderId: order.id,
      orderVersion: informed.version,
      piecesCents: PIECES,
      previousFreightCents: 0,
      quoteId: null,
      quotedCents: null,
      serviceId: null,
      source: 'seller',
      totalCents: PIECES + 3751,
    },
  ]);
  // The audit carries ids, action and version: no value and no free text.
  const audit = audits.at(-1);
  assert.equal(audit.action, 'order.freight');
  assert.deepEqual(audit.target, { id: order.id, type: 'order' });
  assert.equal(JSON.stringify(audit).includes('3751'), false);

  const paid = await runtime.recordMilestones(
    command(SELLER, {
      deliveredOn: null,
      expectedVersion: informed.version,
      orderId: order.id,
      paidOn: '2026-11-09',
    }),
  );
  assert.equal(paid.version, informed.version + 1);
  assert.equal(
    (await repository.findById(order.id))?.commercialRevision,
    Number(revision) + 1,
  );

  // Back to zero: "no freight" again, the rule marker stays.
  const cleared = await inform(runtime, paid, 0);
  assert.equal(cleared.finalAmountCents, PIECES);
  assert.equal(cleared.freight.cents, 0);
  assert.equal(cleared.freight.source, 'seller');
  assert.equal(cleared.freight.pricingRule, 'pieces-freight-v1');
});

test('OLC-05i: a quantity or subtotal command recalculates the total and never the freight', async () => {
  const { runtime } = harness();
  let order = await inform(runtime, await priced(runtime), 3750);
  const [group] = order.ficha.sizePricing;
  const [line] = group.lines;
  const apply = (/** @type {unknown} */ value) =>
    runtime.patchSection(
      command(SELLER, {
        expectedVersion: order.version,
        orderId: order.id,
        section: 'size-pricing',
        value,
      }),
    );
  order = await apply({
    action: 'change_quantity',
    groupId: group.id,
    lineId: line.id,
    quantity: line.quantity + 1,
  });
  // The subtotal needs review again: no total, the freight is untouched.
  assert.equal(order.finalAmountCents, null);
  assert.deepEqual(order.amounts, {
    freightCents: 3750,
    piecesCents: null,
    totalCents: null,
  });
  assert.equal(order.freight.cents, 3750);
  assert.equal(order.freight.source, 'seller');
  order = await apply({
    action: 'review_subtotal',
    groupId: group.id,
    lineId: line.id,
    subtotalCents: line.subtotalCents + 1000,
  });
  assert.equal(order.finalAmountCents, PIECES + 1000 + 3750);
  assert.equal(order.freight.cents, 3750);
});

test('OLC-05i: freight on incomplete pieces is stored without a total and joins it later', async () => {
  const { runtime } = harness();
  let order = await ready(runtime);
  order = await runtime.patchSection(
    command(SELLER, {
      expectedVersion: order.version,
      orderId: order.id,
      section: 'size-pricing',
      value: { action: 'initialize' },
    }),
  );
  order = await inform(runtime, order, 2500);
  assert.equal(order.finalAmountCents, null);
  assert.deepEqual(order.amounts, {
    freightCents: 2500,
    piecesCents: null,
    totalCents: null,
  });
  order = await priceDraft(runtime, order, PIECES, SELLER);
  assert.equal(order.finalAmountCents, PIECES + 2500);
});

test('OLC-05i: a stale version writes nothing; the same key replays once; another body is refused', async () => {
  const { runtime, repository, audits } = harness();
  const order = await priced(runtime);
  await assert.rejects(
    runtime.setFreight(
      command(SELLER, {
        expectedVersion: order.version + 1,
        freightCents: 3750,
        orderId: order.id,
      }),
    ),
    { code: 'VERSION_CONFLICT', statusCode: 409 },
  );
  assert.equal((await repository.findById(order.id))?.freightCents, 0);

  const input = command(SELLER, {
    expectedVersion: order.version,
    freightCents: 3750,
    orderId: order.id,
  });
  const before = audits.length;
  const first = await runtime.setFreight(input);
  const replay = await runtime.setFreight({ ...input });
  assert.deepEqual(replay, first);
  assert.equal(repository.freightEventsFor(order.id).length, 1);
  assert.equal((await repository.findById(order.id))?.version, first.version);
  assert.equal(audits.length, before + 1);
  await assert.rejects(runtime.setFreight({ ...input, freightCents: 3751 }), {
    code: 'IDEMPOTENCY_KEY_REUSED',
    statusCode: 409,
  });
  // Two commands on the same version: exactly one wins.
  const outcomes = await Promise.allSettled(
    [4000, 5000].map((freightCents) =>
      runtime.setFreight(
        command(SELLER, {
          expectedVersion: first.version,
          freightCents,
          orderId: order.id,
        }),
      ),
    ),
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  assert.equal(repository.freightEventsFor(order.id).length, 2);
});

test('a command carrying both forms, neither, or a price next to the quote is refused', async () => {
  const { runtime, repository } = harness({
    quotes: {
      resolve: async () => ({ priceCents: 1 }),
      selected: async () => null,
    },
  });
  const order = await priced(runtime);
  const base = { expectedVersion: order.version, orderId: order.id };
  for (const extra of [
    {},
    { freightCents: 100, quote: { quoteId: 'quote-1', serviceId: 1 } },
    { quote: { priceCents: 100, quoteId: 'quote-1', serviceId: 1 } },
    { quote: { quoteId: 'quote-1' } },
    { quote: { quoteId: 'quote-1', serviceId: '1' } },
    { quote: null },
  ]) {
    await assert.rejects(
      runtime.setFreight(command(SELLER, { ...base, ...extra })),
      (/** @type {any} */ error) => error.statusCode === 400,
      JSON.stringify(extra),
    );
  }
  assert.equal((await repository.findById(order.id))?.version, order.version);
});

// ------------------------------------------------------------------- quote

test('OLC-05h: applying an estimate stores the price the server read, with its origin', async () => {
  /** @type {any[]} */
  const asked = [];
  /** @type {{quoteId: string, serviceId: number, priceCents: number}|null} */
  let selected = null;
  const { runtime, repository } = harness({
    quotes: {
      notice: async () => 'divergent',
      resolve: async (
        /** @type {unknown} */ transaction,
        /** @type {any} */ input,
      ) => {
        asked.push(input);
        if (input.quoteId !== 'quote-current') {
          throw Object.assign(new Error('SHIPPING_QUOTE_STALE'), {
            code: 'SHIPPING_QUOTE_STALE',
            statusCode: 409,
          });
        }
        return { priceCents: 2590 };
      },
      selected: async () => selected,
    },
  });
  const order = await priced(runtime);
  const apply = (/** @type {any} */ current, /** @type {string} */ quoteId) =>
    runtime.setFreight(
      command(SELLER, {
        expectedVersion: current.version,
        orderId: current.id,
        quote: { quoteId, serviceId: 2 },
      }),
    );
  await assert.rejects(apply(order, 'quote-old'), {
    code: 'SHIPPING_QUOTE_STALE',
    statusCode: 409,
  });
  assert.equal((await repository.findById(order.id))?.version, order.version);

  const applied = await apply(order, 'quote-current');
  assert.deepEqual(asked.at(-1), {
    orderId: order.id,
    orderVersion: order.version,
    quoteId: 'quote-current',
    serviceId: 2,
  });
  assert.equal(applied.finalAmountCents, PIECES + 2590);
  assert.equal(applied.freight.cents, 2590);
  assert.equal(applied.freight.source, 'quote');
  assert.equal(applied.freight.quoteId, 'quote-current');
  assert.equal(applied.freight.serviceId, 2);
  assert.equal(applied.freight.quotedCents, 2590);
  // The warning is read on a single order and is only a warning.
  assert.equal(applied.freight.quoteNotice, 'divergent');
  assert.equal(
    (await runtime.list({})).items[0].freight.quoteNotice,
    null,
    'lists never compute the warning',
  );

  // The seller may then declare another value; the history keeps what the
  // selected estimate quoted next to it (P1).
  selected = { priceCents: 2590, quoteId: 'quote-current', serviceId: 2 };
  const declared = await inform(runtime, applied, 1000);
  assert.equal(declared.freight.source, 'seller');
  assert.equal(declared.freight.quoteId, null);
  assert.equal(declared.freight.quotedCents, null);
  assert.deepEqual(
    repository
      .freightEventsFor(order.id)
      .map(
        ({
          source,
          freightCents,
          quotedCents,
          quoteId,
          previousFreightCents,
        }) => ({
          freightCents,
          previousFreightCents,
          quoteId,
          quotedCents,
          source,
        }),
      ),
    [
      {
        freightCents: 2590,
        previousFreightCents: 0,
        quoteId: 'quote-current',
        quotedCents: 2590,
        source: 'quote',
      },
      {
        freightCents: 1000,
        previousFreightCents: 2590,
        quoteId: 'quote-current',
        quotedCents: 2590,
        source: 'seller',
      },
    ],
  );
});

test('without shipping estimates a value still works and applying one fails safely', async () => {
  const { runtime } = harness();
  const order = await priced(runtime);
  await assert.rejects(
    runtime.setFreight(
      command(SELLER, {
        expectedVersion: order.version,
        orderId: order.id,
        quote: { quoteId: 'quote-1', serviceId: 1 },
      }),
    ),
    { code: 'FREIGHT_QUOTE_UNAVAILABLE', statusCode: 409 },
  );
  assert.equal((await inform(runtime, order, 1500)).freight.cents, 1500);
});

// ---- the estimate reader (ADR 054 staleness rule, unchanged)

const QUOTE_KEY = Buffer.alloc(32, 23);
const CONTEXT = 'synthetic-context';

/** The envelope the conversation shipping runtime persists.
 * @param {string} id @param {any} payload */
function envelope(id, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', QUOTE_KEY, iv);
  cipher.setAAD(Buffer.from(`shipping-quote:${id}:1`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  };
}

/** @param {Record<string, unknown>} [override] @param {any} [payload] */
function quoteRow(override = {}, payload = {}) {
  const id = /** @type {string} */ (override.id ?? 'quote-1');
  return {
    id,
    order_id: 'order-1',
    order_version: 5,
    selected_at: '2026-11-10T12:00:00.000Z',
    selected_service_id: 2,
    superseded_at: null,
    ...override,
    quote_envelope: envelope(id, {
      providerContext: CONTEXT,
      services: [
        { id: 1, name: 'PAC', priceCents: 2590 },
        { id: 2, name: 'SEDEX', priceCents: 4810 },
      ],
      ...payload,
    }),
  };
}

/** @param {any[]} rows */
function quoteClient(rows) {
  return {
    async query(/** @type {string} */ sql, /** @type {unknown[]} */ values) {
      if (sql.includes('WHERE id=$1')) {
        return { rows: rows.filter((row) => row.id === values[0]) };
      }
      return {
        rows: rows
          .filter(
            (row) =>
              row.order_id === values[0] &&
              row.selected_service_id !== null &&
              row.superseded_at === null,
          )
          .slice(0, 1),
      };
    },
  };
}

const reader = createShippingQuoteReader({
  configured: true,
  contextKey: CONTEXT,
  key: QUOTE_KEY,
});
const target = Object.freeze({
  orderId: 'order-1',
  orderVersion: 5,
  quoteId: 'quote-1',
  serviceId: 2,
});

test('OLC-05h: the reader takes the selected service price of a current estimate of the same order', async () => {
  assert.deepEqual(await reader.resolve(quoteClient([quoteRow()]), target), {
    priceCents: 4810,
  });
  assert.deepEqual(await reader.selected(quoteClient([quoteRow()]), target), {
    priceCents: 4810,
    quoteId: 'quote-1',
    serviceId: 2,
  });
});

test('OLC-05h: stale, foreign, unselected and unreadable estimates are refused with safe codes', async () => {
  /** @type {[string, any[], any, {code: string, statusCode: number}][]} */
  const cases = [
    [
      'missing',
      [],
      target,
      { code: 'SHIPPING_QUOTE_NOT_FOUND', statusCode: 404 },
    ],
    [
      // Another order's estimate answers exactly like a missing one.
      'another order',
      [quoteRow({ order_id: 'order-2' })],
      target,
      { code: 'SHIPPING_QUOTE_NOT_FOUND', statusCode: 404 },
    ],
    [
      'order version moved',
      [quoteRow()],
      { ...target, orderVersion: 6 },
      { code: 'SHIPPING_QUOTE_STALE', statusCode: 409 },
    ],
    [
      'superseded',
      [quoteRow({ superseded_at: '2026-11-10T13:00:00.000Z' })],
      target,
      { code: 'SHIPPING_QUOTE_STALE', statusCode: 409 },
    ],
    [
      'another provider context',
      [quoteRow({}, { providerContext: 'other-context' })],
      target,
      { code: 'SHIPPING_QUOTE_STALE', statusCode: 409 },
    ],
    [
      'a service that is not the selected one',
      [quoteRow()],
      { ...target, serviceId: 1 },
      { code: 'INVALID_SHIPPING_SERVICE', statusCode: 422 },
    ],
    [
      'nothing selected',
      [quoteRow({ selected_service_id: null })],
      target,
      { code: 'INVALID_SHIPPING_SERVICE', statusCode: 422 },
    ],
    [
      'a price that is not integer cents',
      [quoteRow({}, { services: [{ id: 2, priceCents: 48.1 }] })],
      target,
      { code: 'INVALID_SHIPPING_SERVICE', statusCode: 422 },
    ],
    [
      'a malformed identifier',
      [quoteRow()],
      { ...target, quoteId: 'quote 1; DROP' },
      { code: 'INVALID_REQUEST', statusCode: 400 },
    ],
  ];
  for (const [name, rows, input, expected] of cases) {
    await assert.rejects(
      reader.resolve(quoteClient(rows), input),
      expected,
      name,
    );
  }
  // An envelope another key wrote cannot be read.
  const foreign = createShippingQuoteReader({
    configured: true,
    contextKey: CONTEXT,
    key: Buffer.alloc(32, 24),
  });
  await assert.rejects(foreign.resolve(quoteClient([quoteRow()]), target), {
    code: 'SHIPPING_QUOTE_UNAVAILABLE',
    statusCode: 503,
  });
  assert.equal(await foreign.selected(quoteClient([quoteRow()]), target), null);

  // Not configured: nothing is read at all.
  const off = createShippingQuoteReader({
    configured: false,
    contextKey: CONTEXT,
    key: QUOTE_KEY,
  });
  const untouched = {
    query: async () => {
      throw new Error('no estimate is read without the configuration');
    },
  };
  await assert.rejects(off.resolve(untouched, target), {
    code: 'FREIGHT_QUOTE_UNAVAILABLE',
    statusCode: 409,
  });
  assert.equal(await off.selected(untouched, target), null);
  assert.equal(
    await off.notice(untouched, {
      ...target,
      freightCents: 1,
      source: 'quote',
    }),
    null,
  );
});

test('ADR 080 item 6: the estimate warning is divergent, stale or nothing', async () => {
  const applied = {
    freightCents: 4810,
    orderId: 'order-1',
    // Applying at version 5 moved the order to version 6.
    orderVersion: 6,
    quoteId: 'quote-1',
    source: 'quote',
  };
  assert.equal(await reader.notice(quoteClient([quoteRow()]), applied), null);
  // The order changed after the estimate was applied.
  assert.equal(
    await reader.notice(quoteClient([quoteRow()]), {
      ...applied,
      orderVersion: 7,
    }),
    'stale',
  );
  assert.equal(
    await reader.notice(
      quoteClient([quoteRow({ superseded_at: '2026-11-10T13:00:00.000Z' })]),
      applied,
    ),
    'stale',
  );
  assert.equal(await reader.notice(quoteClient([]), applied), 'stale');
  // A newer selected, current estimate prices differently.
  const newer = quoteRow({ id: 'quote-2', order_version: 7 });
  assert.equal(
    await reader.notice(
      quoteClient([
        newer,
        quoteRow({ superseded_at: '2026-11-10T13:00:00.000Z' }),
      ]),
      {
        ...applied,
        freightCents: 1000,
        orderVersion: 7,
        source: 'seller',
        quoteId: null,
      },
    ),
    'divergent',
  );
  // A declared value equal to the current estimate: nothing to warn.
  assert.equal(
    await reader.notice(quoteClient([newer]), {
      ...applied,
      orderVersion: 7,
      quoteId: null,
      source: 'seller',
    }),
    null,
  );
});

// ------------------------------------------------------------ confirmation

test('OLC-05a/i: the confirmation freezes total and freight, records them, and an admin confirms without changing the freight', async () => {
  const { runtime, repository } = harness({
    quotes: {
      // The origin estimate went stale: only a warning, never a block (P2).
      notice: async () => 'stale',
      resolve: async () => ({ priceCents: 2590 }),
      selected: async () => null,
    },
  });
  const order = await runtime.setFreight(
    command(SELLER, {
      ...(({ id, version }) => ({ expectedVersion: version, orderId: id }))(
        await priced(runtime),
      ),
      quote: { quoteId: 'quote-1', serviceId: 2 },
    }),
  );
  assert.equal(order.freight.quoteNotice, 'stale');
  const confirm = (/** @type {any} */ actor, /** @type {any} */ extra) =>
    runtime.confirm(
      command(actor, {
        expectedVersion: order.version,
        orderId: order.id,
        paymentCondition: 'pix',
        ...extra,
      }),
    );
  // The pieces alone, in the legacy declaration, are refused.
  await assert.rejects(confirm(SELLER, { amountText: '4.820,00' }), {
    code: 'SIZE_PRICING_AMOUNT_MISMATCH',
    statusCode: 422,
  });
  const confirmed = await confirm(ADMIN, { amountText: '4.845,90' });
  assert.equal(confirmed.status, 'confirmado');
  assert.equal(confirmed.finalAmountCents, PIECES + 2590);
  assert.equal(confirmed.confirmedBy?.id, 'admin-1');
  // The admin confirmed; the freight is still the seller's.
  assert.equal(confirmed.freight.cents, 2590);
  assert.equal(confirmed.freight.setBy?.id, 'seller-1');
  assert.equal(confirmed.freight.source, 'quote');
  assert.equal(confirmed.freight.quoteNotice, null);
  assert.deepEqual(repository.freightEventsFor(order.id).at(-1), {
    actorId: 'admin-1',
    freightCents: 2590,
    kind: 'confirmed',
    occurredAt: confirmed.confirmedAt,
    orderId: order.id,
    orderVersion: confirmed.version,
    piecesCents: PIECES,
    previousFreightCents: null,
    quoteId: 'quote-1',
    quotedCents: 2590,
    serviceId: 2,
    source: 'quote',
    totalCents: PIECES + 2590,
  });
  for (const actor of [SELLER, ADMIN]) {
    await assert.rejects(
      inform(runtime, confirmed, 0, actor),
      (/** @type {any} */ error) =>
        ['ORDER_STATUS_CONFLICT', 'FORBIDDEN'].includes(error.code),
    );
  }
  assert.equal((await repository.findById(order.id))?.freightCents, 2590);

  // Reopening keeps freight and total; the seller may then change it and the
  // new confirmation recalculates.
  const reopened = await runtime.reopen(
    command(SELLER, { expectedVersion: confirmed.version, orderId: order.id }),
  );
  assert.equal(reopened.freight.cents, 2590);
  assert.equal(reopened.finalAmountCents, PIECES + 2590);
  const changed = await inform(runtime, reopened, 3000);
  const again = await runtime.confirm(
    command(SELLER, {
      expectedVersion: changed.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
  );
  assert.equal(again.finalAmountCents, PIECES + 3000);
  assert.deepEqual(
    repository.freightEventsFor(order.id).map((event) => event.kind),
    ['set', 'confirmed', 'set', 'confirmed'],
  );
});

test('OLC-05j: the printed ficha does not show the freight', async () => {
  const { runtime } = harness();
  const order = await inform(runtime, await priced(runtime), 3791);
  const confirmed = await runtime.confirm(
    command(SELLER, {
      expectedVersion: order.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
  );
  const html = renderOrderFicha(confirmed);
  assert.doesNotMatch(html, /frete/iu);
  assert.doesNotMatch(html, /37,91/u);
  // The same order without freight prints the same ficha body.
  const plain = harness();
  const twin = await plain.runtime.confirm(
    command(SELLER, {
      ...(({ id, version }) => ({ expectedVersion: version, orderId: id }))(
        await priced(plain.runtime),
      ),
      paymentCondition: 'pix',
    }),
  );
  assert.equal(twin.finalAmountCents, PIECES);
  assert.equal(confirmed.finalAmountCents, PIECES + 3791);
});
