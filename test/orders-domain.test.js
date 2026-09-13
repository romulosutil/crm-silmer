import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ORDER_STATUSES,
  PAYMENT_CONDITIONS,
  confirmOrder,
  formatOrderNumber,
  missingForConfirmation,
  reopenOrder,
} from '../modules/orders/src/domain/order.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const CREATED = '2026-09-10T12:00:00.000Z';
// 22:30 in São Paulo on 12/09, already 13/09 in UTC.
const CONFIRMED_AT = new Date('2026-09-13T01:30:00.000Z');

/** @param {Record<string, any>} [overrides] @returns {any} */
function pendingOrder(overrides = {}) {
  return {
    confirmedAt: null,
    confirmedBy: null,
    conversationId: 'conversation-1',
    createdAt: CREATED,
    createdBy: null,
    createdByKind: 'automation',
    fabCode: '01',
    ficha: {
      items: structuredClone(synthetic.pedido.itens),
      observations: [],
      serviceData: {},
      summary: {
        aplicacao: 'SUBLIMACAO TOTAL',
        cliente: 'Cliente Demonstracao',
        data_entrega_confirmada: '30/09/2026',
        nome: 'Equipe Horizonte',
      },
    },
    finalAmountCents: null,
    id: 'order-1',
    missingFields: [],
    number: '01-CRM',
    numberSequence: 1,
    orderDate: null,
    paymentCondition: null,
    reopenedAt: null,
    reopenedBy: null,
    status: 'pendente',
    totalPieces: 32,
    updatedAt: CREATED,
    version: 3,
    ...overrides,
  };
}

const confirmation = Object.freeze({
  actorId: 'seller-1',
  amountCents: 482000,
  now: CONFIRMED_AT,
  paymentCondition: 'pix',
});

test('exposes exactly two statuses and three payment conditions', () => {
  assert.deepEqual(ORDER_STATUSES, ['pendente', 'confirmado']);
  assert.deepEqual(PAYMENT_CONDITIONS, [
    'pix',
    'cartao_credito',
    'cartao_debito',
  ]);
  assert.ok(Object.isFrozen(ORDER_STATUSES));
  assert.ok(Object.isFrozen(PAYMENT_CONDITIONS));
});

test('formats the reserved sequence as NN-CRM', () => {
  assert.equal(formatOrderNumber(1), '01-CRM');
  assert.equal(formatOrderNumber(12), '12-CRM');
  assert.equal(formatOrderNumber(105), '105-CRM');
  for (const invalid of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => formatOrderNumber(invalid), TypeError);
  }
});

test('confirming records amount, condition, author, time and São Paulo order date', () => {
  const order = pendingOrder();
  const confirmed = confirmOrder(order, confirmation);

  assert.equal(confirmed.status, 'confirmado');
  assert.equal(confirmed.finalAmountCents, 482000);
  assert.equal(confirmed.paymentCondition, 'pix');
  assert.equal(confirmed.confirmedBy, 'seller-1');
  assert.equal(confirmed.confirmedAt, CONFIRMED_AT.toISOString());
  assert.equal(confirmed.orderDate, '2026-09-12');
  assert.equal(confirmed.updatedAt, CONFIRMED_AT.toISOString());
  assert.equal(confirmed.number, '01-CRM');
  assert.equal(confirmed.version, 3, 'the repository owns the version bump');
  assert.equal(order.status, 'pendente', 'the input order is not mutated');
});

test('confirmation needs amount, condition and one item with grade, reported per field', () => {
  assert.throws(
    () =>
      confirmOrder(
        pendingOrder({
          ficha: { ...pendingOrder().ficha, items: [] },
        }),
        {
          actorId: 'seller-1',
          amountCents: 0,
          now: CONFIRMED_AT,
          paymentCondition: /** @type {any} */ ('boleto'),
        },
      ),
    (/** @type {any} */ error) => {
      assert.equal(error.code, 'ORDER_NOT_CONFIRMABLE');
      assert.equal(error.statusCode, 422);
      assert.deepEqual(error.fields, [
        'items',
        'finalAmount',
        'paymentCondition',
      ]);
      return true;
    },
  );

  const withoutGrade = pendingOrder();
  withoutGrade.ficha.items = withoutGrade.ficha.items.map(
    (/** @type {any} */ item) => ({ ...item, grade: [] }),
  );
  assert.throws(() => confirmOrder(withoutGrade, confirmation), {
    code: 'ORDER_NOT_CONFIRMABLE',
    fields: ['items'],
  });

  // A01: empty ficha fields show in the banner but do not block confirmation.
  const sparse = pendingOrder();
  sparse.ficha.summary = {
    aplicacao: null,
    cliente: '',
    data_entrega_confirmada: null,
    nome: null,
  };
  assert.equal(confirmOrder(sparse, confirmation).status, 'confirmado');
});

test('reopening keeps number, amount and condition and records who reopened', () => {
  const confirmed = confirmOrder(pendingOrder(), confirmation);
  const reopenedAt = new Date('2026-09-14T10:00:00.000Z');
  const reopened = reopenOrder(confirmed, {
    actorId: 'admin-1',
    now: reopenedAt,
  });

  assert.equal(reopened.status, 'pendente');
  assert.equal(reopened.number, '01-CRM');
  assert.equal(reopened.finalAmountCents, 482000);
  assert.equal(reopened.paymentCondition, 'pix');
  assert.equal(reopened.reopenedBy, 'admin-1');
  assert.equal(reopened.reopenedAt, reopenedAt.toISOString());
  assert.equal(reopened.updatedAt, reopenedAt.toISOString());
});

test('a new confirmation overwrites author, time and order date (PCL-12)', () => {
  const first = confirmOrder(pendingOrder(), confirmation);
  const reopened = reopenOrder(first, {
    actorId: 'admin-1',
    now: new Date('2026-09-14T10:00:00.000Z'),
  });
  const secondAt = new Date('2026-09-20T15:00:00.000Z');
  const second = confirmOrder(reopened, {
    actorId: 'seller-2',
    amountCents: 500000,
    now: secondAt,
    paymentCondition: 'cartao_credito',
  });

  assert.equal(second.confirmedBy, 'seller-2');
  assert.equal(second.confirmedAt, secondAt.toISOString());
  assert.equal(second.orderDate, '2026-09-20');
  assert.equal(second.finalAmountCents, 500000);
  assert.equal(second.paymentCondition, 'cartao_credito');
});

test('no other transition is possible', () => {
  const confirmed = confirmOrder(pendingOrder(), confirmation);
  assert.throws(() => confirmOrder(confirmed, confirmation), {
    code: 'ORDER_STATUS_CONFLICT',
    statusCode: 409,
  });
  assert.throws(
    () => reopenOrder(pendingOrder(), { actorId: 'seller-1', now: new Date() }),
    { code: 'ORDER_STATUS_CONFLICT', statusCode: 409 },
  );
  assert.throws(
    () => confirmOrder(pendingOrder({ status: 'cancelado' }), confirmation),
    { code: 'ORDER_STATUS_CONFLICT' },
  );
  assert.throws(
    () => confirmOrder(pendingOrder(), { ...confirmation, actorId: '' }),
    TypeError,
  );
});

test('lists what is missing: blockers first, then empty ficha fields', () => {
  assert.deepEqual(missingForConfirmation(pendingOrder()), [
    'finalAmount',
    'paymentCondition',
  ]);

  const sparse = pendingOrder();
  sparse.ficha.summary = {
    aplicacao: null,
    cliente: 'Cliente',
    data_entrega_confirmada: null,
    nome: 'Evento',
  };
  sparse.ficha.items = [
    { ...sparse.ficha.items[0], cor_costas: '', malhas: [] },
    { ...sparse.ficha.items[1], grade: [] },
  ];
  assert.deepEqual(missingForConfirmation(sparse), [
    'finalAmount',
    'paymentCondition',
    'summary.data_entrega_confirmada',
    'summary.aplicacao',
    'items[0].malhas',
    'items[0].cor_costas',
    'items[1].grade',
  ]);

  const empty = pendingOrder();
  empty.ficha.items = [];
  assert.deepEqual(missingForConfirmation(empty).slice(0, 1), ['items']);

  assert.deepEqual(
    missingForConfirmation(confirmOrder(pendingOrder(), confirmation)),
    [],
  );
});
