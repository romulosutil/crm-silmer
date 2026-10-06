import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFERRED,
  NOT_APPLICABLE,
  NO_PRINT,
  blankItem,
  briefingToFicha,
  itemTotal,
  normalizeFicha,
  orderTotal,
  projectBriefingOntoFicha,
  validateArtwork,
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

test('an item without colour or artwork uses its legacy collar binding (ADR 016)', () => {
  const [old] = validateItems([item()]);
  assert.equal(old.cor, '');
  assert.equal(old.estampa, '');
  assert.equal(old.gola, 'OLIMPICA - VERDE');
  assert.equal(old.tipo_servico, '');

  const [complete] = validateItems([
    item({ cor: ' AZUL ', estampa: 'Arte do cliente', gola: 'GOLA V' }),
  ]);
  assert.equal(complete.cor, 'AZUL');
  assert.equal(complete.estampa, 'Arte do cliente');
  assert.equal(complete.gola, 'GOLA V');

  for (const key of ['cor', 'estampa', 'gola']) {
    assert.throws(
      () => validateItems([item({ [key]: 5 })]),
      rejectedWith('ORDER_INVALID', { fields: [`items[0].${key}`] }),
    );
    assert.throws(
      () => validateItems([item({ [key]: null })]),
      rejectedWith('ORDER_INVALID', { fields: [`items[0].${key}`] }),
    );
  }
});

test('the seven-point form may omit legacy and additional item text fields', () => {
  const [saved] = validateItems([
    {
      tipo: 'Camiseta',
      tipo_servico: 'Sublimação',
      cor: 'Azul',
      estampa: 'Arte enviada',
      malhas: ['Dry fit'],
      grade: [{ tamanho: 'M', quantidade: 2 }],
      gola: 'Redonda',
    },
  ]);
  assert.equal(saved.modelo, '');
  assert.equal(saved.vies_gola, '');
  assert.equal(saved.cor_frente, '');
  assert.equal(saved.tipo_servico, 'Sublimação');
  assert.equal(saved.gola, 'Redonda');
});

test('an item may be saved half filled: no fabric, no size, blank fields (ADR 016)', () => {
  assert.deepEqual(validateItems([blankItem()]), [blankItem()]);
  const [partial] = validateItems([
    { ...blankItem(), cor: 'BRANCA', tipo: 'CAMISETA' },
  ]);
  assert.equal(partial.tipo, 'CAMISETA');
  assert.deepEqual(partial.malhas, []);
  assert.deepEqual(partial.grade, []);
  assert.equal(itemTotal(partial), 0);
});

test('a fabric line is text and never blank', () => {
  assert.throws(
    () => validateItems([item({ malhas: ['  '] })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].malhas'] }),
  );
  assert.throws(
    () => validateItems([item({ malhas: 'DRY FIT' })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].malhas'] }),
  );
  assert.throws(
    () => validateItems([item({ malhas: [7] })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].malhas'] }),
  );
});

test('every size line names a size with a positive whole quantity', () => {
  assert.throws(
    () => validateItems([item(), item({ grade: 'P 4' })]),
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

test('items keep the 200-character and 50-item limits', () => {
  assert.throws(
    () => validateItems([item({ cor: 'A'.repeat(201) })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].cor'] }),
  );
  assert.equal(
    validateItems([item({ gola: 'G'.repeat(200) })])[0].gola.length,
    200,
  );
  assert.equal(validateItems(Array.from({ length: 50 }, blankItem)).length, 50);
  assert.throws(
    () => validateItems(Array.from({ length: 51 }, blankItem)),
    rejectedWith('ORDER_INVALID', { fields: ['items'] }),
  );
});

test('a stored ficha reads the legacy collar binding and defaults new fields', () => {
  const stored = {
    items: [structuredClone(synthetic.pedido.itens[0])],
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: null,
      cliente: 'Cliente',
      data_entrega_confirmada: null,
      nome: null,
    },
  };
  const read = normalizeFicha(/** @type {any} */ (stored));
  assert.equal(read.items[0].cor, '');
  assert.equal(read.items[0].estampa, '');
  assert.equal(read.items[0].gola, 'OLIMPICA - VERDE');
  assert.equal(read.items[0].tipo_servico, '');
  assert.deepEqual(read.artwork, {
    feito_pelo_cliente: false,
    feito_pela_silmer: false,
    files: [],
    sem_estampa: false,
  });
  assert.deepEqual(
    normalizeFicha(
      /** @type {any} */ ({
        ...stored,
        artwork: {
          feito_pela_silmer: true,
          feito_pelo_cliente: false,
          files: [],
        },
      }),
    ).artwork,
    {
      feito_pela_silmer: true,
      feito_pelo_cliente: false,
      files: [],
      sem_estampa: false,
    },
    'an art origin stored before ADR 020 reads "Sem estampa" as unmarked',
  );
  assert.equal(read.items[0].modelo, 'TRADICIONAL');
  assert.deepEqual(read.items[0].grade, synthetic.pedido.itens[0].grade);
  assert.equal('cor' in stored.items[0], false, 'the input is not mutated');
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
    () => validateItems([item({ quantidade: 20 })]),
    rejectedWith('ORDER_INVALID', { fields: ['items[0].quantidade'] }),
    'the quantity is the sum of the sizes, never typed',
  );
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

test('who makes the art: customer and Silmer together, "Sem estampa" alone, no files (ADR 020)', () => {
  assert.deepEqual(
    validateArtwork({ feito_pelo_cliente: true, feito_pela_silmer: true }),
    {
      feito_pelo_cliente: true,
      feito_pela_silmer: true,
      files: [],
      sem_estampa: false,
    },
  );
  assert.deepEqual(
    validateArtwork({
      feito_pelo_cliente: false,
      feito_pela_silmer: false,
      sem_estampa: true,
    }),
    {
      feito_pelo_cliente: false,
      feito_pela_silmer: false,
      files: [],
      sem_estampa: true,
    },
  );
  assert.throws(
    () =>
      validateArtwork({
        feito_pelo_cliente: true,
        feito_pela_silmer: false,
        sem_estampa: true,
      }),
    rejectedWith('ORDER_INVALID', { fields: ['artwork.sem_estampa'] }),
  );
  assert.throws(
    () =>
      validateArtwork({
        feito_pelo_cliente: false,
        feito_pela_silmer: false,
        sem_estampa: 'sim',
      }),
    rejectedWith('ORDER_INVALID', { fields: ['artwork.sem_estampa'] }),
  );
  assert.throws(
    () =>
      validateArtwork({
        feito_pelo_cliente: true,
        feito_pela_silmer: false,
        files: [{ name: 'arte.cdr' }],
      }),
    rejectedWith('ORDER_INVALID', { fields: ['artwork.files'] }),
  );
  assert.throws(
    () =>
      validateArtwork({ feito_pelo_cliente: 'true', feito_pela_silmer: false }),
    rejectedWith('ORDER_INVALID', {
      fields: ['artwork.feito_pelo_cliente'],
    }),
  );
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

test('the summary input never carries the locked customer and ignores the legacy technique', () => {
  assert.deepEqual(
    validateSummary({
      aplicacao: ' SUBLIMACAO TOTAL ',
      data_entrega_confirmada: '30/09/2026',
      nome: '',
    }),
    {
      data_entrega_confirmada: '30/09/2026',
      nome: null,
    },
  );
  assert.deepEqual(
    validateSummary({ data_entrega_confirmada: null, nome: 'Turma' }),
    { data_entrega_confirmada: null, nome: 'Turma' },
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
});

test('maps the points onto item 1, the art onto the order and keeps the rest as service data (ADR 016/020)', () => {
  const ficha = briefingToFicha({
    artwork_locations: 'frente e costas',
    artwork_status: 'já tem a arte',
    artwork_technique: 'sublimação total',
    briefing_status: 'ready_for_handoff',
    city_or_postal_code: 'Cidade Sintética',
    collar: 'gola V',
    colors: 'azul e branco',
    customer_name: 'Cliente Sintético',
    delivery_mode: 'retirada',
    fabrics: 'dry fit',
    needed_by: '30/09/2026',
    next_required_field: 'ready_for_handoff',
    notes: 'Separar por tamanho',
    order_name: 'Equipe Horizonte',
    product_model: 'camiseta comum',
    product_type: 'camiseta',
    purchase_profile: 'recorrente',
    purpose: 'campeonato',
    quantity: 20,
    sizes: '4 P, 16 M',
  });

  assert.deepEqual(ficha.summary, {
    aplicacao: null,
    cliente: 'Cliente Sintético',
    data_entrega_confirmada: null,
    nome: 'Equipe Horizonte',
  });
  assert.deepEqual(ficha.items, [
    {
      ...blankItem(),
      cor: 'azul e branco',
      estampa: 'frente e costas',
      gola: 'gola V',
      grade: [
        { quantidade: 4, tamanho: 'P' },
        { quantidade: 16, tamanho: 'M' },
      ],
      malhas: ['dry fit'],
      tipo: 'camiseta comum',
      tipo_servico: 'sublimação total',
    },
  ]);
  assert.deepEqual(ficha.artwork, {
    feito_pela_silmer: false,
    feito_pelo_cliente: true,
    files: [],
    sem_estampa: false,
  });
  assert.equal(ficha.items[0].modelo, '', 'the model is left to the seller');
  assert.deepEqual(ficha.observations, []);
  assert.deepEqual(ficha.serviceData, {
    city_or_postal_code: 'Cidade Sintética',
    delivery_mode: 'retirada',
    needed_by: '30/09/2026',
    notes: 'Separar por tamanho',
    product_type: 'camiseta',
    purchase_profile: 'recorrente',
    purpose: 'campeonato',
    quantity: 20,
  });
  assert.equal(orderTotal(ficha.items), 20);
});

test('the kind of product stands in for the type of garment only when that is missing', () => {
  const fallback = briefingToFicha({ product_type: 'camiseta' });
  assert.equal(fallback.items[0].tipo, 'camiseta');
  assert.equal('product_type' in fallback.serviceData, false);

  const deferredModel = briefingToFicha({
    product_model: DEFERRED,
    product_type: 'camiseta',
  });
  assert.equal(deferredModel.items[0].tipo, 'camiseta');
  assert.equal(deferredModel.serviceData.product_model, DEFERRED);
});

test('a cap from the bot reaches item 1 with its model and no collar (ADR 021)', () => {
  // What workflow mvp-simple-12 records for a cap: the product, the model
  // with the product's name and the not-applicable collar. It never asks
  // fabric or sizes, which stay blank for the seller.
  const ficha = briefingToFicha({
    product_type: 'bonés',
    product_model: 'bonés trucker',
    colors: 'preto',
    quantity: 50,
    artwork_status: 'já tem a logo',
    collar: NOT_APPLICABLE,
  });
  const [cap] = ficha.items;
  assert.equal(cap.tipo, 'bonés trucker');
  assert.equal(cap.cor, 'preto');
  assert.equal(cap.gola, NOT_APPLICABLE);
  assert.deepEqual(cap.malhas, []);
  assert.deepEqual(cap.grade, []);
  assert.equal(ficha.serviceData.product_type, 'bonés');
  assert.equal(ficha.serviceData.quantity, 50);

  // Another product has no model: the product is the type.
  assert.equal(
    briefingToFicha({ product_type: 'canecas' }).items[0].tipo,
    'canecas',
  );
});

test('a point left to the seller is never a ficha value and stays as service data', () => {
  const ficha = briefingToFicha({
    artwork_status: DEFERRED,
    artwork_technique: DEFERRED,
    collar: 'definir com o vendedor',
    colors: DEFERRED,
    fabrics: DEFERRED,
    order_name: DEFERRED,
    product_model: DEFERRED,
    sizes: DEFERRED,
  });
  assert.deepEqual(ficha.items, [blankItem()]);
  assert.equal(ficha.summary.aplicacao, null);
  assert.equal(ficha.summary.nome, null);
  assert.deepEqual(ficha.serviceData, {
    artwork_status: DEFERRED,
    artwork_technique: DEFERRED,
    collar: 'definir com o vendedor',
    colors: DEFERRED,
    fabrics: DEFERRED,
    order_name: DEFERRED,
    product_model: DEFERRED,
    sizes: DEFERRED,
  });

  const mixed = briefingToFicha({ fabrics: ['algodão', DEFERRED] });
  assert.deepEqual(mixed.items[0].malhas, ['algodão']);
});

test('a named technique fills the technique of the item (ADR 020)', () => {
  /** @param {string} artwork_technique */
  const read = (artwork_technique) => briefingToFicha({ artwork_technique });
  for (const technique of [
    'silk',
    'Serigrafia',
    'sublimação total',
    'Sublimação parcial',
    'DTF',
    'dtg',
    'bordado',
    'bordada',
    'transfer',
  ]) {
    assert.equal(read(technique).items[0].tipo_servico, technique, technique);
    assert.equal('artwork_technique' in read(technique).serviceData, false);
    assert.equal(read(technique).summary.aplicacao, null, technique);
  }
  for (const plain of ['sem aplicação', 'Sem estampa', 'lisa']) {
    assert.equal(read(plain).items[0].tipo_servico, NO_PRINT, plain);
  }
  for (const wish of [
    'estampada',
    'com estampa',
    'foto',
    'algo bem colorido, com foto',
    'personalizada',
    'transferir depois',
  ]) {
    assert.deepEqual(read(wish).items, [], `${wish} opens no item`);
    assert.equal(read(wish).serviceData.artwork_technique, wish, wish);
  }
});

test('who makes the art lands on the order only when the answer is clear (ADR 020)', () => {
  /** @param {unknown} artwork_status */
  const origin = (artwork_status) => {
    const { artwork } = briefingToFicha({ artwork_status });
    return [
      artwork?.feito_pelo_cliente && 'cliente',
      artwork?.feito_pela_silmer && 'silmer',
      artwork?.sem_estampa && 'sem estampa',
    ]
      .filter(Boolean)
      .join(' + ');
  };
  for (const answer of [
    'pronta',
    'já tem a logo',
    'já tem a arte',
    'tem a logo',
    'tem a arte',
    'vai mandar',
    'vai mandar a logo',
    'Arte recebida',
    'Arte recebida do cliente',
    'Arte pronta e aprovada',
  ]) {
    assert.equal(origin(answer), 'cliente', answer);
  }
  for (const answer of [
    'Silmer cria a arte',
    'quer que a gente crie',
    'não tem a logo, quer que a Silmer crie',
    'não tenho arte',
  ]) {
    assert.equal(origin(answer), 'silmer', answer);
  }
  assert.equal(
    origin('tem a logo e quer que a Silmer crie o resto'),
    'cliente + silmer',
  );
  for (const answer of [
    'sem aplicação',
    'Sem estampa',
    'lisa',
    'não quer estampa',
  ]) {
    assert.equal(origin(answer), 'sem estampa', answer);
  }
  for (const answer of [
    'com estampa',
    'estampa',
    'tem estampa na frente',
    'a definir',
    'não informado',
    DEFERRED,
  ]) {
    const ficha = briefingToFicha({ artwork_status: answer });
    assert.equal(origin(answer), '', answer);
    assert.equal(ficha.serviceData.artwork_status, answer, answer);
    assert.deepEqual(ficha.items, [], 'the art opens no item');
  }
});

test('where the print goes is the reference of an open item (ADR 020)', () => {
  /** @param {Record<string, unknown>} briefing */
  const read = (briefing) =>
    briefingToFicha({ product_model: 'Camiseta', ...briefing });
  assert.equal(
    read({ artwork_locations: 'frente', artwork_status: 'vai mandar' }).items[0]
      .estampa,
    'frente',
  );
  const plain = read({
    artwork_locations: 'sem aplicação',
    artwork_status: 'sem aplicação',
    artwork_technique: 'sem aplicação',
  });
  assert.equal(plain.items[0].estampa, '');
  assert.equal(plain.items[0].tipo_servico, NO_PRINT);
  assert.equal(plain.artwork?.sem_estampa, true);
  assert.deepEqual(plain.serviceData, {});
  const deferred = read({ artwork_locations: DEFERRED });
  assert.equal(deferred.items[0].estampa, '');
  assert.equal(deferred.serviceData.artwork_locations, DEFERRED);
  const alone = briefingToFicha({ artwork_locations: 'peito' });
  assert.deepEqual(alone.items, []);
  assert.equal(
    alone.serviceData.artwork_locations,
    'peito',
    'places without an item stay with the seller',
  );
});

test('the collar is its own field and never joins the model (ADR 016)', () => {
  const ficha = briefingToFicha({
    collar: 'gola V',
    product_model: 'camiseta comum',
  });
  assert.equal(ficha.items[0].gola, 'gola V');
  assert.equal(ficha.items[0].tipo, 'camiseta comum');
  assert.equal(ficha.items[0].modelo, '');
  assert.equal(ficha.items[0].vies_gola, '', 'the trim stays with the seller');
  assert.equal('collar' in ficha.serviceData, false);

  const onlyCollar = briefingToFicha({ collar: 'regata' });
  assert.equal(onlyCollar.items.length, 1, 'a collar alone opens the item');
  assert.equal(onlyCollar.items[0].gola, 'regata');

  const unreadable = briefingToFicha({ collar: { tipo: 'V' } });
  assert.equal(unreadable.items[0].gola, '');
  assert.deepEqual(
    unreadable.serviceData.collar,
    { tipo: 'V' },
    'a collar in an unexpected shape stays visible as service data',
  );
});

test('sizes become the grade only when they read without doubt', () => {
  assert.deepEqual(briefingToFicha({ sizes: 'P5 M10' }).items[0].grade, [
    { quantidade: 5, tamanho: 'P' },
    { quantidade: 10, tamanho: 'M' },
  ]);
  assert.deepEqual(
    briefingToFicha({ sizes: { G: 15, M: 15 } }).items[0].grade,
    [
      { quantidade: 15, tamanho: 'G' },
      { quantidade: 15, tamanho: 'M' },
    ],
  );
  assert.deepEqual(
    briefingToFicha({
      sizes: [
        { size: 'P', quantity: 4 },
        { tamanho: 'M', quantidade: 16 },
      ],
    }).items[0].grade,
    [
      { quantidade: 4, tamanho: 'P' },
      { quantidade: 16, tamanho: 'M' },
    ],
  );
  const unclear = briefingToFicha({
    product_type: 'camisa',
    sizes: '10 de cada',
  });
  assert.deepEqual(unclear.items[0].grade, []);
  assert.equal(unclear.serviceData.sizes, '10 de cada');
});

test('colour and quantity: colour fills the item, quantity stays as service data', () => {
  const ficha = briefingToFicha({ colors: ['azul', 'branco'], quantity: '30' });
  assert.equal(ficha.items[0].cor, 'azul, branco');
  assert.equal(ficha.serviceData.quantity, '30');
  assert.equal(itemTotal(ficha.items[0]), 0, 'the quantity is never typed in');
  assert.deepEqual(
    briefingToFicha({ quantity: 30 }).items,
    [blankItem()],
    'the quantity alone opens the item',
  );
});

test('an empty briefing yields an empty draft', () => {
  assert.deepEqual(briefingToFicha({}), {
    artwork: {
      feito_pelo_cliente: false,
      feito_pela_silmer: false,
      files: [],
      sem_estampa: false,
    },
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
  assert.deepEqual(
    briefingToFicha({ artwork_locations: 'frente', order_name: 'Turma' }).items,
    [],
  );
});

test('projects the seven points onto item 1 and keeps what the seller owns', () => {
  const pending = normalizeFicha({
    items: [
      {
        ...blankItem(),
        cor: 'PRETA',
        cor_frente: 'PRETA',
        modelo: 'CAMISETA COMUM, GOLA V',
        tipo: '',
        tipo_servico: 'Silk escolhido pelo vendedor',
      },
      { ...blankItem(), tipo: 'BONÉ' },
    ],
    observations: ['Separar por tamanho'],
    serviceData: {},
    summary: {
      aplicacao: 'SILK',
      cliente: 'Cliente',
      data_entrega_confirmada: '2026-10-24',
      nome: null,
    },
  });
  pending.artwork = {
    feito_pelo_cliente: true,
    feito_pela_silmer: false,
    files: [],
    sem_estampa: false,
  };
  const projected = projectBriefingOntoFicha(pending, {
    artwork_status: 'Silmer cria a arte',
    artwork_technique: 'DTF',
    collar: 'gola V',
    fabrics: 'algodão',
    product_model: 'camiseta comum',
    sizes: '10 P, 15 M e 15 G',
  });
  assert.deepEqual(projected.items[0], {
    ...blankItem(),
    cor: 'PRETA',
    cor_frente: 'PRETA',
    gola: 'gola V',
    grade: [
      { quantidade: 10, tamanho: 'P' },
      { quantidade: 15, tamanho: 'M' },
      { quantidade: 15, tamanho: 'G' },
    ],
    malhas: ['algodão'],
    modelo: 'CAMISETA COMUM, GOLA V',
    tipo: 'camiseta comum',
    tipo_servico: 'Silk escolhido pelo vendedor',
  });
  assert.deepEqual(projected.items[1], pending.items[1]);
  assert.deepEqual(projected.observations, ['Separar por tamanho']);
  assert.equal(projected.artwork?.feito_pelo_cliente, true);
  assert.equal(
    projected.artwork?.feito_pela_silmer,
    false,
    "the seller's art mark stays",
  );
  assert.equal(projected.summary.aplicacao, 'SILK', 'the legacy value stays');
  assert.equal(projected.summary.data_entrega_confirmada, '2026-10-24');

  // A blank technique and an order without an art mark take the bot's.
  const blank = normalizeFicha({
    ...pending,
    artwork: undefined,
    items: [{ ...blankItem(), tipo: 'CAMISETA' }],
  });
  const filled = projectBriefingOntoFicha(blank, {
    artwork_status: 'Silmer cria a arte',
    artwork_technique: 'DTF',
    product_model: 'camiseta',
  });
  assert.equal(filled.items[0].tipo_servico, 'DTF');
  assert.equal(filled.artwork?.feito_pela_silmer, true);
  assert.equal(filled.artwork?.feito_pelo_cliente, false);

  const deferred = projectBriefingOntoFicha(projected, { colors: DEFERRED });
  assert.equal(deferred.items[0].cor, 'PRETA', 'a deferred point never erases');

  const stored = projectBriefingOntoFicha(
    /** @type {any} */ ({
      ...pending,
      items: [structuredClone(synthetic.pedido.itens[0])],
    }),
    { colors: 'azul' },
  );
  assert.equal(stored.items[0].cor, 'azul');
  assert.equal(
    stored.items[0].gola,
    'OLIMPICA - VERDE',
    'an old stored item uses the legacy collar binding',
  );
});
