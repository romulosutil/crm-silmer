import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { InMemoryIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { renderFichaHtml } from '../modules/orders/src/print/ficha-canonical-v2.js';
import { PRINCIPAL_LABELS } from '../modules/orders/src/print/ficha-canonical-v3.js';
import {
  PRINT_TEMPLATE,
  TEMPLATE_V2,
  TEMPLATE_V3,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import { printSnapshot } from '../modules/orders/src/print/print-snapshot.js';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

// PIM-10 (ADR 017): one switch decides the printed template, and it stays on
// v2 until the v3 approval is recorded. Fixtures are synthetic.

const rootUrl = new URL('../', import.meta.url);
const v2Sample = JSON.parse(
  await readFile(
    new URL('docs/phase0/ficha-pdf-synthetic.json', rootUrl),
    'utf8',
  ),
);
const v3Gate = JSON.parse(
  await readFile(
    new URL('docs/phase0/ficha-pdf-approval-v3.json', rootUrl),
    'utf8',
  ),
);

const SELLER = Object.freeze({
  capabilities: [],
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});

const readHeaders = Object.freeze({
  cookie: 'crm_session=session-synthetic',
  origin: 'https://crm.example.test',
  'x-request-id': '30000000-0000-4000-8000-000000000001',
});

function harness() {
  let clock = Date.parse('2026-10-02T15:00:00.000Z');
  let sequence = 0;
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
      readAssignment: async () => ({
        assignedUserId: 'seller-1',
        version: 4,
      }),
      readAssignments: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, 'seller-1'])),
      readOrderContext: async () => ({
        briefing: { order_name: 'Equipe Sintetica' },
        customerName: 'Cliente Sintetico',
        openedAt: '2026-09-28T13:40:00.000Z',
      }),
      readUserNames: async (/** @type {string[]} */ ids) =>
        new Map(ids.map((id) => [id, 'Vendedora Um'])),
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    idFactory: () => {
      sequence += 1;
      return `order-${sequence}`;
    },
    repository: new InMemoryOrderRepository(),
  });
  return { api: createApi({}, { orders: runtime }), runtime };
}

let seedSequence = 0;
/** @param {Record<string, unknown>} input */
function seed(input) {
  seedSequence += 1;
  return {
    actor: SELLER,
    correlationId: 'correlation-seed',
    idempotencyKey: `switch-seed-${seedSequence}`,
    ...input,
  };
}

/** @param {any} runtime @param {Record<string, unknown>} summary */
async function confirmedOrder(runtime, summary) {
  let { order } = await runtime.createManual(
    seed({ conversationId: 'conversation-1', expectedVersion: 4 }),
  );
  order = await runtime.patchSection(
    seed({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'summary',
      value: summary,
    }),
  );
  order = await runtime.patchSection(
    seed({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: v2Sample.pedido.itens,
    }),
  );
  order = await runtime.confirm(
    seed({
      amountText: '4.820,00',
      expectedVersion: order.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
  );
  return runtime.recordMilestones(
    seed({
      deliveredOn: null,
      expectedVersion: order.version,
      orderId: order.id,
      paidOn: '2026-10-02',
    }),
  );
}

/** @param {any} api @param {string} url */
async function get(api, url) {
  return api.inject({ headers: readHeaders, method: 'GET', url });
}

test('the switch agrees with the recorded v3 approval (PIM-10)', () => {
  assert.doesNotThrow(() =>
    validateFichaPrintSwitch({ gate: v3Gate, printTemplate: PRINT_TEMPLATE }),
  );
  if (v3Gate.approval.status !== 'approved') {
    assert.equal(PRINT_TEMPLATE, TEMPLATE_V2, 'v2 prints while v3 is pending');
  }
});

test('the switch refuses v3 without a recorded approval and accepts it after (PIM-10)', () => {
  assert.throws(
    () =>
      validateFichaPrintSwitch({ gate: v3Gate, printTemplate: TEMPLATE_V3 }),
    /before its approval is recorded/u,
  );
  assert.throws(
    () => validateFichaPrintSwitch({ gate: null, printTemplate: TEMPLATE_V3 }),
    /before its approval is recorded/u,
  );
  assert.throws(
    () =>
      validateFichaPrintSwitch({
        gate: v3Gate,
        printTemplate: 'ficha-legacy-v1',
      }),
    /known ficha template/u,
  );
  const approved = structuredClone(v3Gate);
  approved.approval.status = 'approved';
  approved.approval.approved = true;
  assert.doesNotThrow(() =>
    validateFichaPrintSwitch({ gate: approved, printTemplate: TEMPLATE_V3 }),
  );
});

/** @param {any} t */
async function printedThroughRoute(t) {
  const { api, runtime } = harness();
  t.after(() => api.close());
  const confirmed = await confirmedOrder(runtime, {
    aplicacao: 'SILK',
    data_entrega_confirmada: '2026-10-24',
    nome: null,
  });
  const { order } = (await get(api, `/api/v1/orders/${confirmed.id}`)).json();
  const response = await get(api, `/api/v1/orders/${confirmed.id}/print`);
  assert.equal(response.statusCode, 200);
  return { order, response };
}

test('the print route prints whatever the switch names (PIM-10)', async (t) => {
  const { order, response } = await printedThroughRoute(t);

  assert.equal(response.body, renderOrderFicha(order));
  assert.equal(response.body, renderOrderFicha(order, PRINT_TEMPLATE));
});

test(
  'on v2 the route prints byte for byte the document it printed before the switch',
  { skip: PRINT_TEMPLATE !== TEMPLATE_V2 && 'the switch already names v3' },
  async (t) => {
    const { order, response } = await printedThroughRoute(t);

    assert.equal(
      response.body,
      renderFichaHtml(printSnapshot(order, TEMPLATE_V2), { synthetic: false }),
    );
    assert.match(
      response.body,
      /Entrega confirmada<\/span><strong>24\/10\/2026</u,
    );
    assert.match(response.body, /Vies gola \/ mangas/u);
    assert.doesNotMatch(response.body, /Lastro do pedido|Tipo de roupa/u);
  },
);

test('the same order renders on either template through one function (PIM-10)', async (t) => {
  const { api, runtime } = harness();
  t.after(() => api.close());
  const confirmed = await confirmedOrder(runtime, {
    aplicacao: 'SILK',
    data_entrega_confirmada: '2026-10-24',
    nome: 'Equipe Sintetica',
  });
  const { order } = (await get(api, `/api/v1/orders/${confirmed.id}`)).json();

  const v2 = renderOrderFicha(order, TEMPLATE_V2);
  const v3 = renderOrderFicha(order, TEMPLATE_V3);

  assert.match(v2, /Entrega confirmada/u);
  assert.match(v3, /Tipo de serviço<\/span><strong>SILK</u);
  assert.match(v3, /Entrega prometida<\/span><strong>24\/10\/2026</u);
  for (const label of PRINCIPAL_LABELS) assert.ok(v3.includes(label), label);
  // The trail comes from the order: first contact and payment; the order
  // date and the promised delivery print in the summary.
  assert.match(v3, /Primeiro contato<\/span><strong>28\/09\/2026</u);
  assert.match(v3, /Data do pedido<\/span><strong>02\/10\/2026</u);
  assert.match(v3, /Pagamento<\/span><strong>02\/10\/2026</u);
  assert.match(
    v3,
    /Entrega realizada<\/span><strong><span class="empty">—<\/span>/u,
  );
  for (const html of [v2, v3]) {
    assert.doesNotMatch(html, /Amostra sintetica|4\.820,00|R\$|pix/iu);
    assert.doesNotMatch(html, /null|undefined/u);
  }
  assert.doesNotMatch(v3, /<div class="review-box">/u);
  assert.throws(
    () => renderOrderFicha(order, 'ficha-canonical-v9'),
    /Unknown/u,
  );
});
