import assert from 'node:assert/strict';
import test from 'node:test';

import { validateItems } from '../modules/orders/src/domain/ficha.js';
import { applySizePricingCommand } from '../modules/orders/src/domain/size-pricing-composition.js';
import {
  createSaveQueue,
  describeFailure,
  firstPendingTarget,
  gradeBlocksSubtotals,
  itemGaps,
  itemLines,
  MESSAGES,
  parseInformedInput,
  parseQuantity,
  parseSizeList,
  parseSubtotalInput,
  persistenceMode,
  plainItems,
  planSizes,
  reconcileIdentity,
  runOperation,
  sameAttributes,
  sizeCollides,
  sizeTakenMessage,
  structuralHint,
} from '../apps/edge-web/src/lib/order-items-inline.js';

/** @param {Record<string, any>} [overrides] */
function item(overrides = {}) {
  return {
    cor: 'AZUL',
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    estampa: '',
    gola: 'POLO',
    grade: [],
    malhas: ['PIQUET'],
    modelo: '',
    publico: '',
    quantidade_informada: null,
    tipo: 'CAMISETA',
    tipo_servico: 'Silk',
    vies_gola: '',
    vies_mangas: '',
    ...overrides,
  };
}

/**
 * A stand-in for PATCH /orders/:id/sections/:section with the rules EDIT-01
 * was written against: one command per request, `items` refused once the
 * subtotals exist, and `initialize` refused for a repeated size.
 *
 * @param {Record<string, any>} order
 * @param {Record<string, any>} [refusals] by action or section: the refusal,
 *   or a function of the value that answers one (or nothing)
 */
function server(order, refusals = {}) {
  /** @type {{section: string, value: any}[]} */
  const requests = [];
  let seed = 0;
  const id = (/** @type {string} */ prefix) => `${prefix}${(seed += 1)}`;
  const state = { order: structuredClone(order) };
  /** @param {string} groupId */
  const at = (groupId) =>
    state.order.ficha.sizePricing.findIndex(
      (/** @type {Record<string, any>} */ group) => group.id === groupId,
    );
  /** @param {number} index */
  const mirror = (index) => {
    state.order.ficha.items[index].grade = state.order.ficha.sizePricing[
      index
    ].lines.map((/** @type {Record<string, any>} */ line) => ({
      quantidade: line.quantity,
      tamanho: line.size,
    }));
  };
  return {
    getOrder: () => state.order,
    requests,
    /** @param {string} section @param {any} value */
    async save(section, value) {
      requests.push({ section, value: structuredClone(value) });
      const rule = refusals[value?.action ?? section];
      const refusal = typeof rule === 'function' ? rule(value) : rule;
      if (refusal) return { message: '', ok: false, ...refusal };
      const next = structuredClone(state.order);
      const { ficha } = next;
      if (section === 'items') {
        if (ficha.sizePricing) {
          return { code: 'SIZE_PRICING_ITEMS_MANAGED', message: '', ok: false };
        }
        ficha.items = value;
      } else if (value.action === 'initialize') {
        ficha.sizePricing = ficha.items.map(
          (/** @type {Record<string, any>} */ one) => ({
            id: id('g'),
            lines: one.grade.map((/** @type {Record<string, any>} */ line) => ({
              id: id('l'),
              quantity: line.quantidade,
              size: line.tamanho,
              subtotalCents: null,
              subtotalReviewed: false,
            })),
          }),
        );
      } else if (!ficha.sizePricing) {
        return { code: 'SIZE_PRICING_NOT_INITIALIZED', message: '', ok: false };
      }
      state.order = next;
      const groups = ficha.sizePricing;
      const index = value?.groupId ? at(value.groupId) : -1;
      const line = groups?.[index]?.lines.find(
        (/** @type {Record<string, any>} */ one) => one.id === value.lineId,
      );
      switch (section === 'items' ? '' : value.action) {
        case 'add_group':
          ficha.items.push(value.item);
          groups.push({ id: id('g'), lines: [] });
          break;
        case 'remove_group':
          ficha.items.splice(index, 1);
          groups.splice(index, 1);
          break;
        case 'reorder_groups': {
          const order_ = value.groupIds.map(at);
          ficha.items = order_.map(
            (/** @type {number} */ from) => ficha.items[from],
          );
          ficha.sizePricing = order_.map(
            (/** @type {number} */ from) => groups[from],
          );
          break;
        }
        case 'update_group':
          Object.assign(ficha.items[index], value.attributes);
          break;
        case 'add_line':
          groups[index].lines.push({
            id: id('l'),
            quantity: value.quantity,
            size: value.size,
            subtotalCents: null,
            subtotalReviewed: false,
          });
          mirror(index);
          break;
        case 'remove_line':
          groups[index].lines.splice(groups[index].lines.indexOf(line), 1);
          mirror(index);
          break;
        case 'rename_line':
          line.size = value.size;
          mirror(index);
          break;
        case 'change_quantity':
          line.quantity = value.quantity;
          line.subtotalReviewed = false;
          mirror(index);
          break;
        case 'review_subtotal':
          line.subtotalCents = value.subtotalCents;
          line.subtotalReviewed = value.subtotalCents !== null;
          break;
        default:
      }
      return { ok: true };
    },
  };
}

/** @param {Record<string, any>[]} items @param {Record<string, any>} [extra] */
function draftOrder(items, extra = {}) {
  return { confirmedAt: null, ficha: { items }, version: 1, ...extra };
}

/** An order whose subtotals already exist, with ids g1.. and l1... */
async function managedOrder(/** @type {Record<string, any>[]} */ items) {
  const io = server(draftOrder(items));
  await io.save('size-pricing', { action: 'initialize' });
  return server(io.getOrder());
}

const grade = [
  { quantidade: 20, tamanho: 'P' },
  { quantidade: 60, tamanho: 'M' },
];

test('a size list is read as pairs in either order and with any separator', () => {
  const expected = [
    { quantity: 20, size: 'P' },
    { quantity: 60, size: 'M' },
    { quantity: 50, size: 'G' },
  ];
  for (const text of [
    'P 20 M 60 G 50',
    'P:20 M:60 G:50',
    'P: 20, M: 60; G: 50',
    '20 P 60 M 50 G',
    'P-20 M-60 G-50',
    'P 20\nM 60\tG 50',
    'P=20, 60 M, G-50',
  ]) {
    assert.deepEqual(parseSizeList(text), { kind: 'pairs', pairs: expected });
  }
  assert.deepEqual(parseSizeList('12 20 14 5'), {
    kind: 'pairs',
    pairs: [
      { quantity: 20, size: '12' },
      { quantity: 5, size: '14' },
    ],
  });
  assert.deepEqual(parseSizeList('12 anos 20'), {
    kind: 'pairs',
    pairs: [{ quantity: 20, size: '12 anos' }],
  });
  // The ficha prints what is stored: a size keeps the case it was typed in.
  assert.deepEqual(parseSizeList('p 20 Gg 5'), {
    kind: 'pairs',
    pairs: [
      { quantity: 20, size: 'p' },
      { quantity: 5, size: 'Gg' },
    ],
  });
});

test('one size alone waits for its quantity; a list without one is refused', () => {
  assert.deepEqual(parseSizeList('  '), { kind: 'empty' });
  assert.deepEqual(parseSizeList(' gg '), { kind: 'single', size: 'gg' });
  assert.deepEqual(parseSizeList('0-3 meses'), {
    kind: 'single',
    size: '0-3 meses',
  });
  assert.deepEqual(parseSizeList('12 ANOS'), {
    kind: 'single',
    size: '12 ANOS',
  });
  for (const text of ['P 20 M', 'P 20 M G 50', '20 P M']) {
    assert.deepEqual(parseSizeList(text), {
      kind: 'invalid',
      message: 'Escreva o tamanho e a quantidade, por exemplo: M 60.',
    });
  }
});

test('a size of several words is one size, with the quantity in its own cell', () => {
  for (const text of ['EX G', 'G1 PLUS', 'BABY LOOK P', 'Extra grande']) {
    assert.deepEqual(parseSizeList(` ${text} `), {
      kind: 'single',
      size: text,
    });
  }
});

test('a size the item already has is added to its line, never written twice', () => {
  const lines = [
    { quantity: 20, size: 'P' },
    { quantity: 60, size: 'M' },
  ];
  assert.deepEqual(
    planSizes(lines, [
      { quantity: 5, size: 'm' },
      { quantity: 10, size: 'G' },
      { quantity: 1, size: 'M ' },
      { quantity: 2, size: 'g' },
    ]),
    [
      { added: 6, kind: 'merge', lineIndex: 1, quantity: 66, size: 'M' },
      { kind: 'add', quantity: 12, size: 'G' },
    ],
  );
  assert.equal(sizeCollides(lines, 0, 'm'), true);
  assert.equal(sizeCollides(lines, 1, 'm'), false);
  assert.equal(
    sizeTakenMessage('M'),
    'O tamanho M já está neste item. Some a quantidade na outra linha.',
  );
});

test('quantity, subtotal and the quantity said are checked before sending', () => {
  assert.equal(parseQuantity(' 60 '), 60);
  for (const text of ['', '0', '-1', '1.5', '1,5', 'dez', '99999999999']) {
    assert.equal(parseQuantity(text), null);
  }
  assert.equal(MESSAGES.quantity, 'Use uma quantidade inteira maior que zero.');

  assert.deepEqual(parseSubtotalInput(''), { cents: null, ok: true });
  assert.deepEqual(parseSubtotalInput('4.820,00'), { cents: 482000, ok: true });
  assert.deepEqual(parseSubtotalInput('R$ 640'), { cents: 64000, ok: true });
  for (const text of ['0', '0,00', '4,820.00', 'abc', '-5']) {
    assert.deepEqual(parseSubtotalInput(text), {
      message: 'Use um subtotal maior que zero no formato 4.820,00.',
      ok: false,
    });
  }

  assert.deepEqual(parseInformedInput(' '), { ok: true, value: null });
  assert.deepEqual(parseInformedInput('100000'), { ok: true, value: 100000 });
  for (const text of ['0', '100001', '1,5', 'x']) {
    assert.deepEqual(parseInformedInput(text), {
      message: 'Use um número inteiro de 1 a 100000.',
      ok: false,
    });
  }
});

test('refuses a subtotal beyond the cents the server accepts, never cutting it (EDIT-03)', () => {
  // size-pricing.js takes a positive safe integer of cents: 90.071.992.547.409,91.
  assert.deepEqual(parseSubtotalInput('90.071.992.547.409,91'), {
    cents: Number.MAX_SAFE_INTEGER,
    ok: true,
  });
  for (const text of [
    '90.071.992.547.409,92',
    '90071992547409,92',
    '900.719.925.474.099,00',
    `R$ ${'9'.repeat(30)}`,
    `${'1.000'.repeat(20)},00`,
  ]) {
    assert.deepEqual(
      parseSubtotalInput(text),
      {
        message: 'Use um subtotal maior que zero no formato 4.820,00.',
        ok: false,
      },
      text,
    );
  }
});

test('the mode follows the subtotals and whether the order was confirmed', () => {
  assert.equal(persistenceMode(draftOrder([])), 'initialize');
  assert.equal(
    persistenceMode(draftOrder([], { confirmedAt: '2026-11-01T12:00:00Z' })),
    'plain',
  );
  assert.equal(
    persistenceMode({
      confirmedAt: 'x',
      ficha: { items: [], sizePricing: [] },
    }),
    'managed',
  );
});

test('managed: every change is one command of size-pricing', async () => {
  const io = await managedOrder([item({ grade }), item({ tipo: 'REGATA' })]);
  /** @param {Record<string, any>} op */
  const run = async (op) => {
    io.requests.length = 0;
    const result = await runOperation(op, io);
    assert.equal(result.ok, true);
    return io.requests.map((request) => {
      assert.equal(request.section, 'size-pricing');
      return request.value;
    });
  };
  const [first, second] = io
    .getOrder()
    .ficha.sizePricing.map((/** @type {any} */ group) => group.id);
  const [lineP, lineM] = io
    .getOrder()
    .ficha.sizePricing[0].lines.map((/** @type {any} */ line) => line.id);

  assert.deepEqual(
    await run({
      attributes: { cor: 'PRETO' },
      itemIndex: 0,
      type: 'setAttributes',
    }),
    [{ action: 'update_group', attributes: { cor: 'PRETO' }, groupId: first }],
  );
  assert.deepEqual(
    await run({
      itemIndex: 0,
      lineIndex: 1,
      quantity: 61,
      type: 'setQuantity',
    }),
    [
      {
        action: 'change_quantity',
        groupId: first,
        lineId: lineM,
        quantity: 61,
      },
    ],
  );
  assert.deepEqual(
    await run({
      itemIndex: 0,
      lineIndex: 1,
      subtotalCents: 64000,
      type: 'setSubtotal',
    }),
    [
      {
        action: 'review_subtotal',
        groupId: first,
        lineId: lineM,
        subtotalCents: 64000,
      },
    ],
  );
  assert.deepEqual(
    await run({
      itemIndex: 0,
      lineIndex: 1,
      subtotalCents: null,
      type: 'setSubtotal',
    }),
    [
      {
        action: 'review_subtotal',
        groupId: first,
        lineId: lineM,
        subtotalCents: null,
      },
    ],
  );
  assert.deepEqual(
    await run({ itemIndex: 0, lineIndex: 0, size: 'PP', type: 'renameLine' }),
    [{ action: 'rename_line', groupId: first, lineId: lineP, size: 'PP' }],
  );
  assert.deepEqual(
    await run({ itemIndex: 0, lineIndex: 0, type: 'removeLine' }),
    [{ action: 'remove_line', groupId: first, lineId: lineP }],
  );
  assert.deepEqual(await run({ delta: 1, itemIndex: 0, type: 'moveItem' }), [
    { action: 'reorder_groups', groupIds: [second, first] },
  ]);
  assert.deepEqual(await run({ delta: 1, itemIndex: 1, type: 'moveItem' }), []);
  assert.deepEqual(await run({ itemIndex: 0, type: 'removeItem' }), [
    { action: 'remove_group', groupId: second },
  ]);
  const [added] = await run({ type: 'addItem' });
  assert.equal(added.action, 'add_group');
  assert.deepEqual(Object.keys(added).sort(), ['action', 'item']);
  assert.deepEqual(added.item.grade, []);
  assert.deepEqual(added.item.malhas, []);
  assert.equal(added.item.quantidade_informada, null);
});

test('managed: a list adds the new sizes and sums the ones that exist', async () => {
  const io = await managedOrder([item({ grade })]);
  const groupId = io.getOrder().ficha.sizePricing[0].id;
  const lineM = io.getOrder().ficha.sizePricing[0].lines[1].id;
  io.requests.length = 0;
  const result = await runOperation(
    {
      itemIndex: 0,
      pairs: [
        { quantity: 50, size: 'G' },
        { quantity: 5, size: 'm' },
      ],
      type: 'addLines',
    },
    io,
  );
  assert.deepEqual(
    io.requests.map((request) => request.value),
    [
      { action: 'add_line', groupId, quantity: 50, size: 'G' },
      { action: 'change_quantity', groupId, lineId: lineM, quantity: 65 },
    ],
  );
  assert.deepEqual(result.lines, [
    { kind: 'add', quantity: 50, size: 'G' },
    { added: 5, kind: 'merge', lineIndex: 1, quantity: 65, size: 'M' },
  ]);
});

test('managed: a copy is a new group placed right below, without sizes', async () => {
  const io = await managedOrder([
    item({ grade, publico: 'masculino', quantidade_informada: 80 }),
    item({ tipo: 'REGATA' }),
  ]);
  const [first, second] = io
    .getOrder()
    .ficha.sizePricing.map((/** @type {any} */ group) => group.id);
  io.requests.length = 0;
  assert.equal(
    (await runOperation({ itemIndex: 0, type: 'duplicateItem' }, io)).ok,
    true,
  );
  const [add, reorder] = io.requests.map((request) => request.value);
  assert.equal(add.action, 'add_group');
  assert.equal(add.item.tipo, 'CAMISETA');
  assert.equal(add.item.publico, 'masculino');
  assert.deepEqual(add.item.grade, []);
  assert.equal(add.item.quantidade_informada, null);
  const copy = io.getOrder().ficha.sizePricing[1].id;
  assert.deepEqual(reorder, {
    action: 'reorder_groups',
    groupIds: [first, copy, second],
  });
  assert.equal(io.requests.length, 2);

  // The copy of the last item is already right below it.
  io.requests.length = 0;
  await runOperation({ itemIndex: 2, type: 'duplicateItem' }, io);
  assert.deepEqual(
    io.requests.map((request) => request.value.action),
    ['add_group'],
  );
});

test('to initialize: the first write sends initialize, then the command', async () => {
  const io = server(draftOrder([item({ grade })]));
  const result = await runOperation(
    { itemIndex: 0, pairs: [{ quantity: 50, size: 'G' }], type: 'addLines' },
    io,
  );
  assert.equal(result.ok, true);
  assert.equal(result.initializeBlocked, false);
  const groupId = io.getOrder().ficha.sizePricing[0].id;
  assert.deepEqual(io.requests, [
    { section: 'size-pricing', value: { action: 'initialize' } },
    {
      section: 'size-pricing',
      value: { action: 'add_line', groupId, quantity: 50, size: 'G' },
    },
  ]);

  // Once it exists, nothing initializes again.
  io.requests.length = 0;
  await runOperation(
    { itemIndex: 0, lineIndex: 0, subtotalCents: 1000, type: 'setSubtotal' },
    io,
  );
  assert.deepEqual(
    io.requests.map((request) => request.value.action),
    ['review_subtotal'],
  );

  const empty = server(draftOrder([]));
  await runOperation({ type: 'addItem' }, empty);
  assert.deepEqual(
    empty.requests.map((request) => request.value.action),
    ['initialize', 'add_group'],
  );
});

test('to initialize: a refused initialize falls back to the whole array', async () => {
  const repeated = [
    { quantidade: 1, tamanho: 'M' },
    { quantidade: 2, tamanho: 'M' },
  ];
  assert.equal(gradeBlocksSubtotals([item({ grade: repeated })]), true);
  assert.equal(
    gradeBlocksSubtotals([item({ grade: [{ quantidade: 1, tamanho: ' M' }] })]),
    true,
  );
  assert.equal(gradeBlocksSubtotals([item({ grade })]), false);

  const io = server(draftOrder([item({ grade: repeated })]), {
    initialize: { code: 'SIZE_PRICING_INVALID' },
  });
  const result = await runOperation(
    { itemIndex: 0, lineIndex: 1, type: 'removeLine' },
    io,
  );
  assert.equal(result.ok, true);
  assert.equal(result.initializeBlocked, true);
  assert.deepEqual(
    io.requests.map((request) => request.section),
    ['size-pricing', 'items'],
  );
  assert.deepEqual(io.requests[1].value[0].grade, [
    { quantidade: 1, tamanho: 'M' },
  ]);

  // The screen already knows the sizes are repeated: it does not ask again.
  io.requests.length = 0;
  const skipped = await runOperation(
    { attributes: { cor: 'PRETO' }, itemIndex: 0, type: 'setAttributes' },
    { ...io, skipInitialize: true },
  );
  assert.equal(skipped.initializeBlocked, true);
  assert.deepEqual(
    io.requests.map((request) => request.section),
    ['items'],
  );

  // A subtotal has nowhere to go without the subtotals.
  const refused = await runOperation(
    { itemIndex: 0, lineIndex: 0, subtotalCents: 100, type: 'setSubtotal' },
    { ...io, skipInitialize: true },
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.message, MESSAGES.sizesBlocked);

  // Any other refusal of initialize stops the write.
  const stale = server(draftOrder([item()]), {
    initialize: { code: 'VERSION_CONFLICT' },
  });
  const stopped = await runOperation({ type: 'addItem' }, stale);
  assert.equal(stopped.ok, false);
  assert.equal(stale.requests.length, 1);
});

test('plain: every change sends the whole array of items', async () => {
  const confirmedAt = '2026-11-01T12:00:00Z';
  const base = draftOrder(
    [
      item({
        grade: [{ quantidade: '20', tamanho: ' P ' }],
        malhas: ['PIQUET', ' '],
        quantidade_informada: '30',
      }),
      item({ tipo: 'REGATA' }),
    ],
    { confirmedAt },
  );
  /** @param {Record<string, any>} op */
  const run = async (op) => {
    const io = server(base);
    const result = await runOperation(op, io);
    assert.equal(result.ok, true);
    assert.equal(result.initializeBlocked, undefined);
    assert.equal(io.requests.length, 1);
    assert.equal(io.requests[0].section, 'items');
    return io.requests[0].value;
  };

  const renamed = await run({
    attributes: { tipo: 'POLO' },
    itemIndex: 0,
    type: 'setAttributes',
  });
  assert.equal(renamed[0].tipo, 'POLO');
  // Built like the form before EDIT-01: trimmed, numeric, no blank fabric.
  assert.deepEqual(renamed[0].grade, [{ quantidade: 20, tamanho: 'P' }]);
  assert.deepEqual(renamed[0].malhas, ['PIQUET']);
  assert.equal(renamed[0].quantidade_informada, 30);
  assert.equal(renamed[1].tipo, 'REGATA');
  assert.deepEqual(Object.keys(renamed[0]).sort(), Object.keys(item()).sort());

  const listed = await run({
    itemIndex: 0,
    pairs: [
      { quantity: 5, size: 'p' },
      { quantity: 60, size: 'M' },
    ],
    type: 'addLines',
  });
  assert.deepEqual(listed[0].grade, [
    { quantidade: 25, tamanho: 'P' },
    { quantidade: 60, tamanho: 'M' },
  ]);

  const quantity = await run({
    itemIndex: 0,
    lineIndex: 0,
    quantity: 21,
    type: 'setQuantity',
  });
  assert.deepEqual(quantity[0].grade, [{ quantidade: 21, tamanho: 'P' }]);
  const size = await run({
    itemIndex: 0,
    lineIndex: 0,
    size: 'PP',
    type: 'renameLine',
  });
  assert.deepEqual(size[0].grade, [{ quantidade: 20, tamanho: 'PP' }]);
  assert.deepEqual(
    (await run({ itemIndex: 0, lineIndex: 0, type: 'removeLine' }))[0].grade,
    [],
  );

  const copied = await run({ itemIndex: 0, type: 'duplicateItem' });
  assert.deepEqual(
    copied.map((/** @type {any} */ one) => one.tipo),
    ['CAMISETA', 'CAMISETA', 'REGATA'],
  );
  assert.deepEqual(copied[1].grade, []);
  assert.equal(copied[1].quantidade_informada, null);
  assert.deepEqual(
    (await run({ delta: 1, itemIndex: 0, type: 'moveItem' })).map(
      (/** @type {any} */ one) => one.tipo,
    ),
    ['REGATA', 'CAMISETA'],
  );
  assert.deepEqual(
    (await run({ itemIndex: 0, type: 'removeItem' })).map(
      (/** @type {any} */ one) => one.tipo,
    ),
    ['REGATA'],
  );
  const added = await run({ type: 'addItem' });
  assert.equal(added.length, 3);
  assert.deepEqual(added[2].grade, []);
  assert.deepEqual(plainItems(null), []);
});

test('a refusal stops the change where it happened', async () => {
  const io = await managedOrder([item({ grade })]);
  const refusing = server(io.getOrder(), {
    change_quantity: { code: 'VERSION_CONFLICT' },
  });
  const result = await runOperation(
    {
      itemIndex: 0,
      pairs: [
        { quantity: 5, size: 'M' },
        { quantity: 50, size: 'G' },
      ],
      type: 'addLines',
    },
    refusing,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    refusing.requests.map((request) => request.value.action),
    ['change_quantity'],
  );
  const missing = await runOperation(
    { itemIndex: 4, lineIndex: 0, quantity: 1, type: 'setQuantity' },
    io,
  );
  assert.equal(missing.code, 'TARGET_GONE');

  assert.deepEqual(describeFailure(result), {
    conflict: true,
    message: 'Este pedido mudou em outro lugar.',
  });
  assert.equal(describeFailure(missing).conflict, true);
  assert.equal(
    describeFailure({
      code: 'SIZE_PRICING_ITEMS_MANAGED',
      message: 'Este pedido mudou. Cancele a edição para ver a versão atual.',
    }).conflict,
    true,
  );
  assert.deepEqual(describeFailure({ code: 'INVALID_GRADE' }), {
    conflict: false,
    message: 'Use uma quantidade inteira maior que zero.',
  });
  assert.equal(
    describeFailure({ code: 'SIZE_PRICING_INVALID' }).conflict,
    false,
  );
  assert.equal(describeFailure({ code: 'ORDER_INVALID' }).conflict, false);
  assert.deepEqual(
    describeFailure({ code: '', message: 'Serviço indisponível no momento.' }),
    { conflict: false, message: 'Serviço indisponível no momento.' },
  );
});

test('the sizes read the same in every mode and attributes compare by value', async () => {
  const plain = draftOrder([item({ grade })]);
  assert.deepEqual(itemLines(plain, 0), [
    { id: null, quantity: 20, reviewed: false, size: 'P', subtotalCents: null },
    { id: null, quantity: 60, reviewed: false, size: 'M', subtotalCents: null },
  ]);
  const io = await managedOrder([item({ grade })]);
  await runOperation(
    { itemIndex: 0, lineIndex: 0, subtotalCents: 500, type: 'setSubtotal' },
    io,
  );
  const [first] = itemLines(io.getOrder(), 0);
  assert.deepEqual(
    { ...first, id: '' },
    { id: '', quantity: 20, reviewed: true, size: 'P', subtotalCents: 500 },
  );
  assert.equal(
    sameAttributes(item(), { cor: 'AZUL', malhas: ['PIQUET'] }),
    true,
  );
  assert.equal(sameAttributes(item(), { malhas: ['PIQUET', 'PV'] }), false);
  assert.equal(sameAttributes(item(), { quantidade_informada: null }), true);
});

test('missingFields are sorted by the field that shows them', () => {
  const order = {
    ficha: {
      items: [item(), item()],
      sizePricing: [
        {
          id: 'g1',
          lines: [
            { id: 'l1', subtotalCents: 100, subtotalReviewed: true },
            { id: 'l2', subtotalCents: null, subtotalReviewed: false },
          ],
        },
        { id: 'g2', lines: [] },
      ],
    },
    missingFields: [
      'summary.data_entrega_confirmada',
      'items[1].tipo_servico',
      'items[1].grade',
      'items[0].malhas',
      'sizePricing.g1.l2',
      'sizePricing.g2',
      'artwork',
    ],
  };
  assert.deepEqual(itemGaps(order), {
    empty: false,
    fields: { 0: ['malhas'], 1: ['tipo_servico', 'grade'] },
    groups: ['g2'],
    lines: ['g1.l2'],
    pricing: false,
  });
  assert.deepEqual(itemGaps({ missingFields: ['items', 'sizePricing'] }), {
    empty: true,
    fields: {},
    groups: [],
    lines: [],
    pricing: true,
  });
  assert.deepEqual(itemGaps(null), {
    empty: false,
    fields: {},
    groups: [],
    lines: [],
    pricing: false,
  });
});

test('"Completar itens" goes to the first thing the server lists', () => {
  const groups = [
    {
      id: 'g1',
      lines: [
        { id: 'l1', subtotalCents: 100, subtotalReviewed: true },
        { id: 'l2', subtotalCents: 100, subtotalReviewed: false },
      ],
    },
    { id: 'g2', lines: [] },
  ];
  /** @param {string[]} missingFields @param {Record<string, any>} [ficha] */
  const target = (missingFields, ficha = { items: [item(), item()] }) =>
    firstPendingTarget({ ficha, missingFields });

  assert.deepEqual(target(['artwork', 'items']), { kind: 'add-item' });
  assert.deepEqual(target(['items[1].cor', 'items[0].tipo']), {
    itemIndex: 1,
    key: 'cor',
    kind: 'field',
  });
  assert.deepEqual(target(['items[0].grade']), {
    itemIndex: 0,
    kind: 'blank-size',
  });
  const priced = { items: [item(), item()], sizePricing: groups };
  assert.deepEqual(target(['sizePricing.g1.l2'], priced), {
    itemIndex: 0,
    kind: 'subtotal',
    lineIndex: 1,
  });
  assert.deepEqual(target(['sizePricing.g1'], priced), {
    itemIndex: 0,
    kind: 'subtotal',
    lineIndex: 1,
  });
  assert.deepEqual(target(['sizePricing.g2'], priced), {
    itemIndex: 1,
    kind: 'blank-size',
  });
  assert.deepEqual(target(['sizePricing'], priced), {
    itemIndex: 0,
    kind: 'subtotal',
    lineIndex: 1,
  });
  assert.deepEqual(target(['sizePricing']), {
    itemIndex: 0,
    kind: 'blank-size',
  });
  assert.deepEqual(target(['sizePricing'], { items: [] }), {
    kind: 'add-item',
  });
  // A stale or unknown entry is skipped, never a wrong field.
  assert.deepEqual(
    target(['sizePricing.gone.l9', 'items[7].cor', 'artwork']),
    null,
  );
  assert.equal(firstPendingTarget(null), null);
});

test('identities survive a refresh, the first subtotals and a removal', async () => {
  let seed = 0;
  const uid = () => `u${(seed += 1)}`;
  const before = draftOrder([item({ grade }), item({ tipo: 'REGATA' })]);
  const first = reconcileIdentity(null, before, uid);
  assert.deepEqual(
    first.items.map((entry) => entry.uid),
    ['u1', 'u4'],
  );
  assert.deepEqual(
    first.items[0].lines.map((line) => line.uid),
    ['u2', 'u3'],
  );
  // The same order again keeps every identity.
  assert.deepEqual(
    reconcileIdentity(first, structuredClone(before), uid),
    first,
  );

  // Without ids a removal is followed through the hint of the change.
  const removed = reconcileIdentity(
    first,
    draftOrder([item({ tipo: 'REGATA' })]),
    uid,
    structuralHint({ itemIndex: 0, type: 'removeItem' }),
  );
  assert.deepEqual(
    removed.items.map((entry) => entry.uid),
    ['u4'],
  );
  const line = reconcileIdentity(
    first,
    draftOrder([item({ grade: [grade[1]] }), item({ tipo: 'REGATA' })]),
    uid,
    structuralHint({ itemIndex: 0, lineIndex: 0, type: 'removeLine' }),
  );
  assert.deepEqual(
    line.items[0].lines.map((entry) => entry.uid),
    ['u3'],
  );
  assert.deepEqual(structuralHint({ itemIndex: 0, type: 'duplicateItem' }), {
    index: 1,
    type: 'insertItem',
  });
  assert.deepEqual(
    structuralHint({ delta: -1, itemIndex: 1, type: 'moveItem' }),
    {
      from: 1,
      to: 0,
      type: 'moveItem',
    },
  );
  assert.equal(structuralHint({ type: 'setAttributes' }), null);

  // The first order with ids adopts the identities by position.
  const io = server(before);
  await io.save('size-pricing', { action: 'initialize' });
  const managed = reconcileIdentity(first, io.getOrder(), uid);
  assert.deepEqual(
    managed.items.map((entry) => entry.uid),
    ['u1', 'u4'],
  );
  assert.deepEqual(
    managed.items[0].lines.map((entry) => entry.uid),
    ['u2', 'u3'],
  );
  assert.equal(managed.items[0].id, io.getOrder().ficha.sizePricing[0].id);

  // From then on the ids carry them through a reorder and a new group.
  await runOperation({ delta: 1, itemIndex: 0, type: 'moveItem' }, io);
  await runOperation({ type: 'addItem' }, io);
  const moved = reconcileIdentity(managed, io.getOrder(), uid);
  assert.deepEqual(moved.items.map((entry) => entry.uid).slice(0, 2), [
    'u4',
    'u1',
  ]);
  assert.equal(moved.items.length, 3);
  assert.notEqual(moved.items[2].uid, 'u1');
});

test('a list refused halfway retries only the sizes not written yet', async () => {
  const start = await managedOrder([
    item({ grade: [{ quantidade: 60, tamanho: 'M' }] }),
  ]);
  let refuse = true;
  const io = server(start.getOrder(), {
    add_line: (/** @type {any} */ value) =>
      refuse && value.size === 'G' ? { code: 'ORDER_INVALID' } : null,
  });
  const pairs = [
    { quantity: 20, size: 'P' },
    { quantity: 10, size: 'M' },
    { quantity: 50, size: 'G' },
  ];
  const failed = await runOperation(
    { itemIndex: 0, pairs, type: 'addLines' },
    io,
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.remaining, [{ quantity: 50, size: 'G' }]);
  /** @returns {Record<string, number>} */
  const sizes = () =>
    Object.fromEntries(
      itemLines(io.getOrder(), 0).map((line) => [line.size, line.quantity]),
    );
  assert.deepEqual(sizes(), { M: 70, P: 20 });

  refuse = false;
  const retried = await runOperation(
    { itemIndex: 0, pairs: failed.remaining, type: 'addLines' },
    io,
  );
  assert.equal(retried.ok, true);
  assert.deepEqual(sizes(), { G: 50, M: 70, P: 20 });

  // A merge that is refused keeps the amount to add, not the total.
  const merge = server(start.getOrder(), {
    change_quantity: { code: 'VERSION_CONFLICT' },
  });
  const refused = await runOperation(
    { itemIndex: 0, pairs, type: 'addLines' },
    merge,
  );
  assert.deepEqual(refused.remaining, [
    { quantity: 10, size: 'M' },
    { quantity: 50, size: 'G' },
  ]);
  // A refusal before any size (initialize) leaves the list whole.
  const fresh = server(draftOrder([item()]), {
    initialize: { code: 'VERSION_CONFLICT' },
  });
  const whole = await runOperation(
    { itemIndex: 0, pairs, type: 'addLines' },
    fresh,
  );
  assert.equal(whole.ok, false);
  assert.equal(whole.remaining, undefined);
});

test('an order whose subtotals never started points to its first subtotal', () => {
  const order = {
    confirmedAt: null,
    ficha: { items: [item(), item({ grade })] },
    missingFields: ['sizePricing'],
  };
  assert.deepEqual(firstPendingTarget(order), {
    itemIndex: 1,
    kind: 'subtotal',
    lineIndex: 0,
  });
  assert.deepEqual(itemGaps(order).pricing, true);
  // With no size anywhere the blank row of the first item is what is left.
  assert.deepEqual(
    firstPendingTarget({
      ficha: { items: [item()] },
      missingFields: ['sizePricing'],
    }),
    { itemIndex: 0, kind: 'blank-size' },
  );
});

test('removing or moving what is already gone has nothing left to do', async () => {
  const io = await managedOrder([item({ grade })]);
  io.requests.length = 0;
  for (const op of [
    { itemIndex: 0, lineIndex: 5, type: 'removeLine' },
    { itemIndex: 3, lineIndex: 0, type: 'removeLine' },
    { itemIndex: 3, type: 'removeItem' },
    { delta: 1, itemIndex: 3, type: 'moveItem' },
  ]) {
    assert.deepEqual(await runOperation(op, io), { ok: true });
  }
  assert.equal(io.requests.length, 0);

  const plain = server(
    draftOrder([item({ grade })], { confirmedAt: '2026-11-01T12:00:00Z' }),
  );
  assert.deepEqual(
    await runOperation(
      { itemIndex: 0, lineIndex: 9, type: 'removeLine' },
      plain,
    ),
    { ok: true },
  );
  assert.equal(plain.requests.length, 0);
  // Anything else aimed at a missing target still says the order changed.
  assert.equal(
    (await runOperation({ itemIndex: 3, type: 'duplicateItem' }, io)).code,
    'TARGET_GONE',
  );
});

test('"Manter os N subtotais" reviews every pending subtotal of the item', async () => {
  const io = await managedOrder([
    item({
      grade: [...grade, { quantidade: 5, tamanho: 'G' }],
    }),
  ]);
  const group = io.getOrder().ficha.sizePricing[0];
  const [lineP, lineM] = group.lines.map((/** @type {any} */ one) => one.id);
  await runOperation(
    { itemIndex: 0, lineIndex: 0, subtotalCents: 64000, type: 'setSubtotal' },
    io,
  );
  await runOperation(
    { itemIndex: 0, lineIndex: 1, subtotalCents: 192000, type: 'setSubtotal' },
    io,
  );
  // A change to the item leaves both to review; G never had a subtotal.
  for (const one of io.getOrder().ficha.sizePricing[0].lines) {
    one.subtotalReviewed = false;
  }
  io.requests.length = 0;
  const result = await runOperation(
    { itemIndex: 0, type: 'keepSubtotals' },
    io,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    io.requests.map((request) => request.value),
    [
      {
        action: 'review_subtotal',
        groupId: group.id,
        lineId: lineP,
        subtotalCents: 64000,
      },
      {
        action: 'review_subtotal',
        groupId: group.id,
        lineId: lineM,
        subtotalCents: 192000,
      },
    ],
  );
  assert.deepEqual(
    itemLines(io.getOrder(), 0).map((line) => line.reviewed),
    [true, true, false],
  );
});

test('the queue saves one at a time, drops repeats and stops at a refusal', async () => {
  /** @type {string[]} */
  const log = [];
  /** @type {Record<string, string>} */
  const failures = {};
  /** @type {string[]} */
  const states = [];
  let running = 0;
  const queue = createSaveQueue({
    async execute(job, sending) {
      running += 1;
      assert.equal(running, 1, 'one save at a time');
      if (!job.noop) sending();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
      log.push(job.key);
      running -= 1;
      return job.result ?? { ok: true };
    },
    onFailure(job, failure, result) {
      failures[job.key] = failure.message;
      job.rollback?.(result);
    },
    onState: (state) => states.push(state),
  });

  /** @type {string[]} */
  const settled = [];
  const after = (/** @type {string} */ key) => () => settled.push(key);
  assert.equal(queue.enqueue({ after: after('a'), key: 'a', mark: '1' }), true);
  assert.equal(queue.enqueue({ key: 'a', mark: '1' }), false);
  assert.equal(
    queue.enqueue({ after: after('a2'), key: 'a', mark: '2' }),
    true,
  );
  assert.equal(queue.enqueue({ key: 'b' }), true);
  assert.equal(queue.isPending('b'), true);
  await queue.whenIdle();
  assert.deepEqual(log, ['a', 'a', 'b']);
  assert.deepEqual(settled, ['a', 'a2']);
  assert.equal(queue.isPending('b'), false);
  assert.deepEqual(states, ['saving', 'saving', 'saving', 'saved']);

  // A refusal: its own message, "not saved" for what waited behind it, and
  // nothing else is sent.
  log.length = 0;
  states.length = 0;
  /** @type {any} */
  let rolledBack;
  queue.enqueue({
    key: 'c',
    result: { code: 'VERSION_CONFLICT', ok: false, remaining: [] },
    rollback: (/** @type {any} */ result) => {
      rolledBack = result;
    },
  });
  queue.enqueue({ key: 'c', mark: 'again' });
  queue.enqueue({ key: 'd' });
  await queue.whenIdle();
  assert.deepEqual(log, ['c']);
  assert.deepEqual(failures, {
    c: 'Este pedido mudou em outro lugar.',
    d: 'Não foi salvo porque a alteração anterior falhou.',
  });
  assert.deepEqual(rolledBack.remaining, []);
  assert.deepEqual(states, ['saving', '']);

  // Nothing sent, nothing announced; a throw is a refusal, not a stall.
  states.length = 0;
  queue.enqueue({ key: 'e', noop: true });
  await queue.whenIdle();
  assert.deepEqual(states, []);
  /** @type {string[]} */
  const thrown = [];
  const broken = createSaveQueue({
    execute: async () => {
      throw new Error('boom');
    },
    onFailure: (_job, failure) => {
      thrown.push(failure.message);
    },
  });
  broken.enqueue({ key: 'f' });
  await broken.whenIdle();
  assert.deepEqual(thrown, ['Não foi possível salvar esta alteração.']);
});

/**
 * PATCH /orders/:id/sections/:section answered by the real domain, after the
 * JSON round trip a request makes.
 *
 * @param {Record<string, any>[]} items @param {Record<string, any>} [extra]
 */
function domain(items, extra = {}) {
  /** @type {{section: string, value: any}[]} */
  const requests = [];
  /** @type {Record<string, any>} */
  const state = {
    order: {
      confirmedAt: null,
      ficha: { items: validateItems(JSON.parse(JSON.stringify(items))) },
      origin: 'atendimento',
      status: 'pendente',
      ...extra,
    },
  };
  return {
    getOrder: () => state.order,
    requests,
    /** @param {string} section @param {any} value */
    async save(section, value) {
      const sent = JSON.parse(JSON.stringify(value));
      requests.push({ section, value: sent });
      try {
        if (section === 'items') {
          if (state.order.ficha.sizePricing !== undefined) {
            return { code: 'SIZE_PRICING_ITEMS_MANAGED', ok: false };
          }
          state.order = {
            ...state.order,
            ficha: { ...state.order.ficha, items: validateItems(sent) },
          };
        } else {
          state.order = {
            ...state.order,
            ficha: applySizePricingCommand(
              /** @type {any} */ (state.order),
              sent,
            ),
          };
        }
        return { ok: true };
      } catch (cause) {
        const error = /** @type {any} */ (cause);
        return {
          code: String(error?.code ?? error?.name ?? ''),
          message: String(error?.message ?? ''),
          ok: false,
        };
      }
    },
  };
}

test('every command the screen builds is one the domain accepts', async () => {
  const io = domain([
    item({ grade, publico: 'masculino', quantidade_informada: 80 }),
    item({ tipo: 'REGATA' }),
  ]);
  /** @param {Record<string, any>} op */
  const run = async (op) => {
    const before = io.requests.length;
    const result = await runOperation(op, io);
    assert.equal(
      result.ok,
      true,
      `${op.type}: ${JSON.stringify(io.requests.slice(before))} → ${result.code} ${result.message}`,
    );
    return result;
  };
  const types = () =>
    io.getOrder().ficha.items.map((/** @type {any} */ one) => one.tipo);
  const lines = () =>
    itemLines(io.getOrder(), 0).map((line) => `${line.size}:${line.quantity}`);

  // The first write starts the subtotals.
  await run({
    attributes: { tipo_servico: 'DTF' },
    itemIndex: 0,
    type: 'setAttributes',
  });
  assert.deepEqual(io.requests[0], {
    section: 'size-pricing',
    value: { action: 'initialize' },
  });
  await run({
    attributes: { malhas: ['PIQUET', 'PV'] },
    itemIndex: 0,
    type: 'setAttributes',
  });
  await run({
    attributes: { quantidade_informada: null },
    itemIndex: 0,
    type: 'setAttributes',
  });
  await run({
    attributes: { cor_manga_direita: 'NAO APLICAVEL', publico: '' },
    itemIndex: 0,
    type: 'setAttributes',
  });
  await run({
    itemIndex: 0,
    pairs: [
      { quantity: 5, size: 'm' },
      { quantity: 50, size: 'Baby look P' },
    ],
    type: 'addLines',
  });
  assert.deepEqual(lines(), ['P:20', 'M:65', 'Baby look P:50']);
  await run({ itemIndex: 0, lineIndex: 0, quantity: 21, type: 'setQuantity' });
  await run({ itemIndex: 0, lineIndex: 0, size: 'pp', type: 'renameLine' });
  await run({
    itemIndex: 0,
    lineIndex: 0,
    subtotalCents: 64000,
    type: 'setSubtotal',
  });
  await run({
    itemIndex: 0,
    lineIndex: 1,
    subtotalCents: 192000,
    type: 'setSubtotal',
  });
  await run({
    itemIndex: 0,
    lineIndex: 1,
    subtotalCents: null,
    type: 'setSubtotal',
  });
  await run({
    itemIndex: 0,
    lineIndex: 1,
    subtotalCents: 192000,
    type: 'setSubtotal',
  });
  // A change to the item asks for every subtotal again; one look keeps them.
  await run({
    attributes: { gola: 'CARECA' },
    itemIndex: 0,
    type: 'setAttributes',
  });
  assert.deepEqual(
    itemLines(io.getOrder(), 0).map((line) => line.reviewed),
    [false, false, false],
  );
  await run({ itemIndex: 0, type: 'keepSubtotals' });
  assert.deepEqual(
    itemLines(io.getOrder(), 0).map((line) => line.reviewed),
    [true, true, false],
  );
  await run({ itemIndex: 0, lineIndex: 2, type: 'removeLine' });
  assert.deepEqual(lines(), ['pp:21', 'M:65']);

  await run({ itemIndex: 0, type: 'duplicateItem' });
  assert.deepEqual(types(), ['CAMISETA', 'CAMISETA', 'REGATA']);
  assert.deepEqual(io.getOrder().ficha.items[1].grade, []);
  await run({ delta: 1, itemIndex: 1, type: 'moveItem' });
  assert.deepEqual(types(), ['CAMISETA', 'REGATA', 'CAMISETA']);
  await run({ itemIndex: 2, type: 'removeItem' });
  await run({ type: 'addItem' });
  assert.deepEqual(types(), ['CAMISETA', 'REGATA', '']);
  assert.equal(io.getOrder().ficha.sizePricing.length, 3);

  // An order confirmed and reopened without subtotals: the whole array.
  const plain = domain([item({ grade })], {
    confirmedAt: '2026-11-01T12:00:00Z',
  });
  for (const op of [
    { attributes: { cor: 'PRETO' }, itemIndex: 0, type: 'setAttributes' },
    { itemIndex: 0, pairs: [{ quantity: 5, size: 'p' }], type: 'addLines' },
    { itemIndex: 0, lineIndex: 0, quantity: 30, type: 'setQuantity' },
    { itemIndex: 0, lineIndex: 1, size: 'G', type: 'renameLine' },
    { itemIndex: 0, lineIndex: 1, type: 'removeLine' },
    { itemIndex: 0, type: 'duplicateItem' },
    { delta: 1, itemIndex: 0, type: 'moveItem' },
    { itemIndex: 0, type: 'removeItem' },
    { type: 'addItem' },
  ]) {
    const result = await runOperation(op, plain);
    assert.equal(result.ok, true, `${op.type}: ${result.message}`);
  }
  assert.equal(
    plain.requests.every((request) => request.section === 'items'),
    true,
  );
  assert.equal(plain.getOrder().ficha.sizePricing, undefined);

  // The domain refuses to start the subtotals over a repeated size; the
  // screen then keeps the whole-array write.
  const repeated = domain([
    item({
      grade: [
        { quantidade: 1, tamanho: 'M' },
        { quantidade: 2, tamanho: 'M' },
      ],
    }),
  ]);
  const fallback = await runOperation(
    { itemIndex: 0, lineIndex: 1, type: 'removeLine' },
    repeated,
  );
  assert.equal(fallback.ok, true);
  assert.equal(fallback.initializeBlocked, true);
  assert.deepEqual(
    repeated.requests.map((request) => request.section),
    ['size-pricing', 'items'],
  );
});
