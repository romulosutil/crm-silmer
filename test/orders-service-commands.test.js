import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const OWNER = Object.freeze({
  capabilities: [],
  id: 'seller-1',
  kind: 'human',
});
const OTHER = Object.freeze({
  capabilities: [],
  id: 'seller-2',
  kind: 'human',
});
const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  id: 'admin-1',
  kind: 'human',
});

async function setup() {
  const repository = new InMemoryOrderRepository();
  /** @type {Record<string, string>} */
  const owners = { 'conversation-1': 'seller-1' };
  let now = Date.parse('2026-09-12T15:00:00.000Z');
  const service = createOrderService({
    authorizeOwnership: async ({ actor, conversationId }) => {
      if (
        owners[conversationId] !== actor.id &&
        !(actor.capabilities ?? []).includes('COMMERCIAL_ADMIN')
      ) {
        throw Object.assign(new Error('not the owner'), {
          code: 'FORBIDDEN',
          statusCode: 403,
        });
      }
    },
    clock: () => {
      now += 60_000;
      return new Date(now);
    },
    conversations: {
      readOrderContext: async () => ({
        briefing: { order_name: 'Evento Inicial', product_type: 'camisa' },
        customerName: 'Cliente Sintetico',
      }),
    },
    fabCode: '01',
    repository,
  });
  const { order } = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-intent',
  });
  return { order, owners, repository, service };
}

/** @param {Record<string, unknown>} [extra] @returns {any} */
function command(extra = {}) {
  return { actor: OWNER, correlationId: 'correlation-command', ...extra };
}

test('saving the summary replaces the whole section but keeps the locked customer', async () => {
  const { order, service } = await setup();
  const saved = await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'summary',
      value: {
        aplicacao: 'SUBLIMACAO TOTAL',
        data_entrega_confirmada: '30/09/2026',
        nome: null,
      },
    }),
  );
  assert.equal(saved.version, order.version + 1);
  assert.deepEqual(saved.ficha.summary, {
    aplicacao: 'SUBLIMACAO TOTAL',
    cliente: 'Cliente Sintetico',
    data_entrega_confirmada: '30/09/2026',
    nome: null,
  });
  assert.ok(saved.missingFields.includes('summary.nome'));
  assert.ok(!saved.missingFields.includes('summary.aplicacao'));
});

test('saving items recalculates total pieces and what is missing', async () => {
  const { order, service } = await setup();
  assert.ok(order.missingFields.includes('items'));
  const saved = await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );
  assert.equal(saved.totalPieces, 32);
  assert.equal(saved.ficha.items.length, 2);
  assert.ok(!saved.missingFields.includes('items'));
  assert.ok(!saved.missingFields.some((field) => field.startsWith('items[')));

  const observations = await service.patchSection(
    command({
      expectedVersion: saved.version,
      orderId: order.id,
      section: 'observations',
      value: synthetic.pedido.observacoes,
    }),
  );
  assert.deepEqual(
    observations.ficha.observations,
    synthetic.pedido.observacoes,
  );
  assert.equal(observations.totalPieces, 32);
});

test('invalid sections and values are refused without touching the order', async () => {
  const { order, repository, service } = await setup();
  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: order.version,
        orderId: order.id,
        section: 'serviceData',
        value: {},
      }),
    ),
    { code: 'ORDER_INVALID', statusCode: 400 },
  );
  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: order.version,
        orderId: order.id,
        section: 'items',
        value: [
          {
            ...synthetic.pedido.itens[0],
            grade: [{ quantidade: 0, tamanho: 'P' }],
          },
        ],
      }),
    ),
    { code: 'INVALID_GRADE', index: 0, itemIndex: 0 },
  );
  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: order.version,
        orderId: order.id,
        section: 'observations',
        value: ['1', '2', '3', '4', '5', '6'],
      }),
    ),
    { code: 'ORDER_INVALID' },
  );
  assert.deepEqual(await repository.findById(order.id), order);
});

test('only the owner or an admin edits, confirms and reopens', async () => {
  const { order, repository, service } = await setup();
  const summary = {
    aplicacao: null,
    data_entrega_confirmada: null,
    nome: 'Outro',
  };
  await assert.rejects(
    service.patchSection({
      actor: OTHER,
      correlationId: 'correlation-other',
      expectedVersion: order.version,
      orderId: order.id,
      section: 'summary',
      value: summary,
    }),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  await assert.rejects(
    service.confirm({
      actor: OTHER,
      amountText: '10,00',
      correlationId: 'correlation-other',
      expectedVersion: order.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    service.patchSection({
      actor: /** @type {any} */ ({ id: 'n8n', kind: 'automation' }),
      correlationId: 'correlation-automation',
      expectedVersion: order.version,
      orderId: order.id,
      section: 'summary',
      value: summary,
    }),
    { code: 'FORBIDDEN' },
  );
  assert.deepEqual(await repository.findById(order.id), order);

  const byAdmin = await service.patchSection({
    actor: ADMIN,
    correlationId: 'correlation-admin',
    expectedVersion: order.version,
    orderId: order.id,
    section: 'summary',
    value: summary,
  });
  assert.equal(byAdmin.ficha.summary.nome, 'Outro');
});

test('a stale version is reported as a conflict', async () => {
  const { order, service } = await setup();
  await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'observations',
      value: ['primeira'],
    }),
  );
  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: order.version,
        orderId: order.id,
        section: 'observations',
        value: ['segunda'],
      }),
    ),
    { code: 'VERSION_CONFLICT', statusCode: 409 },
  );
  await assert.rejects(
    service.confirm(
      command({
        amountText: '10,00',
        expectedVersion: order.version,
        orderId: order.id,
        paymentCondition: 'pix',
      }),
    ),
    { code: 'VERSION_CONFLICT' },
  );
});

test('confirming parses the amount and refuses what is missing per field', async () => {
  const { order, service } = await setup();
  const withItems = await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );

  await assert.rejects(
    service.confirm(
      command({
        amountText: '',
        expectedVersion: withItems.version,
        orderId: order.id,
        paymentCondition: null,
      }),
    ),
    (/** @type {any} */ error) => {
      assert.equal(error.code, 'ORDER_NOT_CONFIRMABLE');
      assert.deepEqual(error.fields, ['finalAmount', 'paymentCondition']);
      return true;
    },
  );
  await assert.rejects(
    service.confirm(
      command({
        amountText: '4,820.00',
        expectedVersion: withItems.version,
        orderId: order.id,
        paymentCondition: 'pix',
      }),
    ),
    { code: 'INVALID_AMOUNT', statusCode: 422 },
  );

  const confirmed = await service.confirm(
    command({
      amountText: '4.820,00',
      expectedVersion: withItems.version,
      orderId: order.id,
      paymentCondition: 'cartao_debito',
    }),
  );
  assert.equal(confirmed.status, 'confirmado');
  assert.equal(confirmed.finalAmountCents, 482000);
  assert.equal(confirmed.paymentCondition, 'cartao_debito');
  assert.equal(confirmed.confirmedBy, 'seller-1');
  assert.deepEqual(confirmed.missingFields, []);
});

test('a pending order without items cannot be confirmed', async () => {
  const { order, service } = await setup();
  const empty = await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: [],
    }),
  );
  await assert.rejects(
    service.confirm(
      command({
        amountText: '10,00',
        expectedVersion: empty.version,
        orderId: order.id,
        paymentCondition: 'pix',
      }),
    ),
    { code: 'ORDER_NOT_CONFIRMABLE', fields: ['items'] },
  );
});

test('a confirmed order is read-only until reopened, and a new owner confirms again', async () => {
  const { order, owners, service } = await setup();
  const withItems = await service.patchSection(
    command({
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: synthetic.pedido.itens,
    }),
  );
  const confirmed = await service.confirm(
    command({
      amountText: '100,00',
      expectedVersion: withItems.version,
      orderId: order.id,
      paymentCondition: 'pix',
    }),
  );

  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: confirmed.version,
        orderId: order.id,
        section: 'observations',
        value: ['tarde demais'],
      }),
    ),
    { code: 'ORDER_STATUS_CONFLICT', statusCode: 409 },
  );
  await assert.rejects(
    service.confirm(
      command({
        amountText: '100,00',
        expectedVersion: confirmed.version,
        orderId: order.id,
        paymentCondition: 'pix',
      }),
    ),
    { code: 'ORDER_STATUS_CONFLICT' },
  );

  // The conversation was transferred: the previous owner loses the actions.
  owners['conversation-1'] = 'seller-2';
  await assert.rejects(
    service.reopen(
      command({ expectedVersion: confirmed.version, orderId: order.id }),
    ),
    { code: 'FORBIDDEN' },
  );
  const reopened = await service.reopen({
    actor: OTHER,
    correlationId: 'correlation-reopen',
    expectedVersion: confirmed.version,
    orderId: order.id,
  });
  assert.equal(reopened.status, 'pendente');
  assert.equal(reopened.reopenedBy, 'seller-2');
  assert.equal(reopened.number, order.number);
  assert.equal(reopened.finalAmountCents, 10000);
  await assert.rejects(
    service.reopen({
      actor: OTHER,
      correlationId: 'correlation-reopen-again',
      expectedVersion: reopened.version,
      orderId: order.id,
    }),
    { code: 'ORDER_STATUS_CONFLICT' },
  );

  const reconfirmed = await service.confirm({
    actor: OTHER,
    amountText: '120,00',
    correlationId: 'correlation-reconfirm',
    expectedVersion: reopened.version,
    orderId: order.id,
    paymentCondition: 'cartao_credito',
  });
  assert.equal(reconfirmed.confirmedBy, 'seller-2');
  assert.notEqual(reconfirmed.confirmedAt, confirmed.confirmedAt);
  assert.equal(reconfirmed.finalAmountCents, 12000);
});

test('commands on an unknown order are refused as not found', async () => {
  const { service } = await setup();
  await assert.rejects(
    service.reopen(command({ expectedVersion: 1, orderId: 'missing' })),
    { code: 'ORDER_NOT_FOUND', statusCode: 404 },
  );
  await assert.rejects(
    service.patchSection(
      command({
        expectedVersion: 1,
        orderId: 'missing',
        section: 'observations',
        value: [],
      }),
    ),
    { code: 'ORDER_NOT_FOUND' },
  );
});
