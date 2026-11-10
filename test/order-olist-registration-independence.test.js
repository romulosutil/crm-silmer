import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { buildOlistPreviewPlan } from '../apps/api/src/olist-preview-plan.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { syntheticItems } from './fixtures/order-items.js';
import { priceDraft } from './fixtures/size-pricing.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';

// ADR 082 / OLC-T01: the buyer registration is mandatory only for a new Olist
// send. Saving, confirming and printing an Order never read it. Synthetic data.

const SELLER = Object.freeze({
  capabilities: [],
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});
const headers = Object.freeze({
  cookie: 'crm_session=session-synthetic',
  origin: 'https://crm.example.test',
  'x-request-id': '30000000-0000-4000-8000-000000000082',
});
const COMPLETE = Object.freeze({
  personType: 'individual',
  document: '52998224725',
  legalName: 'Comprador Sintético',
  postalCode: '01001000',
  city: 'São Paulo',
  state: 'SP',
  street: 'Rua Sintética',
  district: 'Centro',
  number: '12',
});
const SETTINGS = Object.freeze({
  sellerId: 11,
  operationNatureId: 12,
  warehouseId: 13,
  paymentMethodId: 14,
  originId: 15,
  paymentTerms: 'À vista',
  paymentDueOn: '2026-12-01',
});

function harness() {
  let clock = Date.parse('2026-11-10T15:00:00.000Z');
  let sequence = 0;
  const repository = new InMemoryOrderRepository();
  const runtime = createOrderRuntime({
    access: {
      authorizeRead: async () => ({ actor: SELLER }),
      authorizeWrite: async () => ({ actor: SELLER }),
    },
    auditTrail: { append: async () => undefined },
    clock: () => {
      clock += 60_000;
      return new Date(clock);
    },
    conversations: {
      readAssignment: async () => ({ assignedUserId: 'seller-1', version: 4 }),
      readAssignments: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, 'seller-1'])),
      readLatestMessageStates: async () => new Map(),
      readOrderContexts: orderContextsFrom(() => ({
        briefing: { order_name: 'Equipe Sintetica' },
        customerName: 'Cliente Sintetico',
        openedAt: '2026-11-09T13:40:00.000Z',
      })),
      readUserNames: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, 'Vendedora Um'])),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    idFactory: () => `order-${++sequence}`,
    repository,
  });
  return { api: createApi({}, { orders: runtime }), runtime, repository };
}

let seedSequence = 0;
/** @param {Record<string, unknown>} input */
function seed(input) {
  return {
    actor: SELLER,
    correlationId: 'correlation-seed',
    idempotencyKey: `registration-seed-${++seedSequence}`,
    ...input,
  };
}

test('ADR 082: an Order is saved, confirmed and printed with an empty, partial or invalid buyer registration, which blocks only the Olist send', async (t) => {
  const { api, runtime: typed, repository } = harness();
  const runtime = /** @type {any} */ (typed);
  t.after(() => api.close());
  let { order } = await runtime.createManual(
    seed({ conversationId: 'conversation-1', expectedVersion: 4 }),
  );
  for (const [section, value] of /** @type {[string, unknown][]} */ ([
    [
      'summary',
      { data_entrega_confirmada: '2026-11-24', nome: 'Equipe Sintetica' },
    ],
    ['items', syntheticItems()],
    ['artwork', { feito_pela_silmer: false, feito_pelo_cliente: true }],
  ]))
    order = await runtime.patchSection(
      seed({
        expectedVersion: order.version,
        orderId: order.id,
        section,
        value,
      }),
    );
  order = await priceDraft(runtime, order, 482000, SELLER);
  // No command above or below receives, reads or requires a registration.
  order = await runtime.confirm(
    seed({
      amountText: '4.820,00',
      expectedVersion: order.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
  );
  assert.equal(order.status, 'confirmado');
  assert.deepEqual(order.missingFields, []);

  const detail = await api.inject({
    headers,
    method: 'GET',
    url: `/api/v1/orders/${order.id}`,
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().order.status, 'confirmado');
  const printed = await api.inject({
    headers,
    method: 'GET',
    url: `/api/v1/orders/${order.id}/print`,
  });
  assert.equal(printed.statusCode, 200);
  assert.match(String(printed.headers['content-type']), /text\/html/u);
  assert.ok(printed.body.length > 1000);

  const stored = await repository.findById(order.id);
  /** @param {unknown} registration */
  const plan = (registration) =>
    buildOlistPreviewPlan({
      source: { order: stored, sourceRevision: 0, issues: [] },
      buyer: {
        name: 'Comprador Sintético',
        phone: '5511999990000',
        email: null,
        registration,
      },
      settings: SETTINGS,
      now: new Date('2026-11-10T15:00:00.000Z'),
    });
  /** @param {any} result */
  const registrationIssues = (result) =>
    result.issues.filter((/** @type {any} */ entry) =>
      entry.field.startsWith('buyer.registration.'),
    );
  for (const registration of [
    null,
    {},
    { personType: 'individual', legalName: 'Comprador Sintético' },
    { ...COMPLETE, number: null },
    { ...COMPLETE, document: '11111111111' },
  ]) {
    const blocked = plan(registration);
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.customer, null);
    assert.ok(registrationIssues(blocked).length > 0);
  }
  const complete = plan(COMPLETE);
  assert.deepEqual(
    complete.issues.filter((/** @type {any} */ entry) =>
      entry.field.startsWith('buyer.'),
    ),
    [],
  );
  assert.equal(complete.customer.cpfCnpj, COMPLETE.document);

  // The Olist pendencies never became a property of the Order or its print.
  const after = await repository.findById(order.id);
  assert.equal(after?.status, 'confirmado');
  assert.equal(after?.version, stored?.version);
});
