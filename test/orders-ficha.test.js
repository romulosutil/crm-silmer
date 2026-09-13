import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  NOT_APPLICABLE,
  briefingToFicha,
  itemTotal,
  orderTotal,
  validateItems,
  validateObservations,
  validateSummary,
} from '../modules/orders/src/domain/ficha.js';

const synthetic = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

/** @param {Record<string, unknown>} [overrides] */
function item(overrides = {}) {
  return {
    ...structuredClone(synthetic.pedido.itens[0]),
    ...overrides,
  };
}

/** @param {string} code @param {Record<string, unknown>} [extra] */
function rejectedWith(code, extra = {}) {
  return (/** @type {any} */ error) => {
    assert.equal(error.code, code);
    for (const [key, value] of Object.entries(extra)) {
      assert.deepEqual(error[key], value);
    }
    return true;
  };
}

test('the approved synthetic snapshot validates and totals 32 pieces', () => {
  const items = validateItems(synthetic.pedido.itens);
  assert.equal(items.length, 2);
  assert.equal(itemTotal(items[0]), 20);
  assert.equal(itemTotal(items[1]), 12);
  assert.equal(orderTotal(items), synthetic.pedido.quantidade_total);
  assert.equal(orderTotal([]), 0);
});

test('an item needs at least one fabric', () => {
  assert.throws(
    () => validateItems([item({ malhas: [] })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].malhas'] }),
  );
  assert.throws(
    () => validateItems([item({ malhas: ['  '] })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].malhas'] }),
  );
});

test('an item needs at least one grade line with a positive integer quantity', () => {
  assert.throws(
    () => validateItems([item(), item({ grade: [] })]),
    rejectedWith('INVALID_GRADE', { fields: ['items[1].grade'], itemIndex: 1 }),
  );
  for (const quantidade of [0, -1, 1.5, '4', null]) {
    assert.throws(
      () =>
        validateItems([
          item({
            grade: [
              { tamanho: 'P', quantidade: 2 },
              { tamanho: 'M', quantidade },
            ],
          }),
        ]),
      rejectedWith('INVALID_GRADE', { index: 1, itemIndex: 0 }),
      `quantidade ${JSON.stringify(quantidade)} must be rejected`,
    );
  }
  assert.throws(
    () => validateItems([item({ grade: [{ tamanho: '', quantidade: 2 }] })]),
    rejectedWith('INVALID_GRADE', { index: 0 }),
  );
});

test('sleeve and trim colours accept the explicit not-applicable value', () => {
  const [normalized] = validateItems([
    item({
      cor_manga_direita: NOT_APPLICABLE,
      cor_manga_esquerda: NOT_APPLICABLE,
      vies_gola: NOT_APPLICABLE,
      vies_mangas: NOT_APPLICABLE,
    }),
  ]);
  assert.equal(NOT_APPLICABLE, 'NAO APLICAVEL');
  assert.equal(normalized.cor_manga_direita, NOT_APPLICABLE);
  assert.equal(normalized.cor_manga_esquerda, NOT_APPLICABLE);
  assert.equal(normalized.vies_gola, NOT_APPLICABLE);
  assert.equal(normalized.vies_mangas, NOT_APPLICABLE);
});

test('items reject unknown keys, typed totals and non-string fields', () => {
  assert.throws(
    () => validateItems([item({ total: 20 })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].total'] }),
  );
  assert.throws(
    () => validateItems([item({ modelo: 7 })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].modelo'] }),
  );
  assert.throws(() => validateItems(/** @type {any} */ ({})), {
    code: 'ORDER_INVALID',
  });
  const [trimmed] = validateItems([item({ tipo: '  CAMISA ' })]);
  assert.equal(trimmed.tipo, 'CAMISA');
});

test('observations accept zero to five lines', () => {
  assert.deepEqual(validateObservations([]), []);
  assert.deepEqual(validateObservations(synthetic.pedido.observacoes), [
    ...synthetic.pedido.observacoes,
  ]);
  assert.deepEqual(validateObservations(['a', 'b', 'c', 'd', ' e ']), [
    'a',
    'b',
    'c',
    'd',
    'e',
  ]);
  assert.throws(
    () => validateObservations(['1', '2', '3', '4', '5', '6']),
    rejectedWith('ORDER_INVALID', { fields: ['observations'] }),
  );
  assert.throws(() => validateObservations([3]), { code: 'ORDER_INVALID' });
  assert.throws(() => validateObservations(/** @type {any} */ ('x')), {
    code: 'ORDER_INVALID',
  });
});

test('the summary input never carries the locked customer', () => {
  assert.deepEqual(
    validateSummary({
      aplicacao: ' SUBLIMACAO TOTAL ',
      data_entrega_confirmada: '30/09/2026',
      nome: '',
    }),
    {
      aplicacao: 'SUBLIMACAO TOTAL',
      data_entrega_confirmada: '30/09/2026',
      nome: null,
    },
  );
  assert.throws(
    () =>
      validateSummary({
        aplicacao: null,
        cliente: 'Outro Cliente',
        data_entrega_confirmada: null,
        nome: null,
      }),
    rejectedWith('ORDER_INVALID', { fields: ['summary.cliente'] }),
  );
  assert.throws(
    () => validateSummary({ aplicacao: null, nome: null }),
    rejectedWith('ORDER_INVALID', {
      fields: ['summary.data_entrega_confirmada'],
    }),
  );
  assert.throws(
    () =>
      validateSummary({
        aplicacao: 5,
        data_entrega_confirmada: null,
        nome: null,
      }),
    rejectedWith('ORDER_INVALID', { fields: ['summary.aplicacao'] }),
  );
});

test('maps the agent pre-ficha into ficha sections and keeps the rest as service data', () => {
  const ficha = briefingToFicha({
    artwork_locations: ['frente', 'costas'],
    artwork_status: 'pronta',
    artwork_technique: 'sublimação total',
    briefing_status: 'ready_for_handoff',
    city_or_postal_code: 'Cidade Sintética',
    colors: ['azul', 'branco'],
    customer_name: 'Cliente Sintético',
    delivery_mode: 'retirada',
    fabrics: ['dry fit', ''],
    needed_by: '30/09/2026',
    next_required_field: 'ready_for_handoff',
    notes: 'Separar por tamanho',
    order_name: 'Equipe Horizonte',
    pickup_location: 'Loja',
    product_model: 'tradicional',
    product_type: 'camisa',
    purchase_profile: 'recorrente',
    purpose: 'campeonato',
    quantity: 20,
    sizes: [
      { size: 'P', quantity: 4 },
      { tamanho: 'M', quantidade: 16 },
    ],
  });

  assert.deepEqual(ficha.summary, {
    aplicacao: 'sublimação total',
    cliente: 'Cliente Sintético',
    data_entrega_confirmada: null,
    nome: 'Equipe Horizonte',
  });
  assert.deepEqual(ficha.items, [
    {
      cor_costas: '',
      cor_frente: '',
      cor_manga_direita: '',
      cor_manga_esquerda: '',
      grade: [
        { quantidade: 4, tamanho: 'P' },
        { quantidade: 16, tamanho: 'M' },
      ],
      malhas: ['dry fit'],
      modelo: 'tradicional',
      tipo: 'camisa',
      vies_gola: '',
      vies_mangas: '',
    },
  ]);
  assert.deepEqual(ficha.observations, []);
  assert.deepEqual(ficha.serviceData, {
    artwork_locations: ['frente', 'costas'],
    artwork_status: 'pronta',
    city_or_postal_code: 'Cidade Sintética',
    colors: ['azul', 'branco'],
    delivery_mode: 'retirada',
    needed_by: '30/09/2026',
    notes: 'Separar por tamanho',
    pickup_location: 'Loja',
    purchase_profile: 'recorrente',
    purpose: 'campeonato',
    quantity: 20,
  });
  assert.equal(orderTotal(ficha.items), 20);
});

test('keeps unparseable sizes as service data and an empty briefing yields an empty draft', () => {
  const ficha = briefingToFicha({
    product_type: 'camisa',
    sizes: 'P, M e G',
  });
  assert.deepEqual(ficha.items[0].grade, []);
  assert.equal(ficha.serviceData.sizes, 'P, M e G');

  assert.deepEqual(briefingToFicha({}), {
    items: [],
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: null,
      cliente: '',
      data_entrega_confirmada: null,
      nome: null,
    },
  });
  assert.deepEqual(briefingToFicha(null), briefingToFicha({}));
});
