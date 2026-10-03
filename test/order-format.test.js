import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amountLabel,
  dayLabel,
  elapsedSince,
  fabLabel,
  formatBrl,
  HANDOFF_REASON_LABELS,
  handoffReasonLabel,
  informedQuantity,
  isItemGap,
  isPageGap,
  itemHeading,
  itemPieces,
  itemQuantityLabel,
  joinPt,
  missingFieldLabels,
  missingHeadline,
  operationalDay,
  orderMilestones,
  orderStatusLabel,
  parseBrl,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
  PRINT_LOCKED_REASON,
  quantityWarning,
} from '../apps/edge-web/src/lib/order-format.js';

test('names the two order statuses of ADR 006', () => {
  assert.equal(orderStatusLabel('pendente'), 'Pendente');
  assert.equal(orderStatusLabel('confirmado'), 'Confirmado');
  assert.equal(orderStatusLabel('inexistente'), 'Sem pedido');
  assert.equal(orderStatusLabel(null), 'Sem pedido');
});

test('offers the three payment conditions in the order of the mockup', () => {
  assert.deepEqual(
    PAYMENT_CONDITION_OPTIONS.map((option) => option.value),
    ['pix', 'cartao_credito', 'cartao_debito'],
  );
  assert.deepEqual(
    PAYMENT_CONDITION_OPTIONS.map((option) => option.label),
    ['Pix', 'Cartão de crédito', 'Cartão de débito'],
  );
  assert.equal(paymentConditionLabel('cartao_credito'), 'Cartão de crédito');
  assert.equal(paymentConditionLabel(null), '—');
});

test('labels every reason_code the handoffs table accepts (A03)', () => {
  // The CHECK constraint of migration 0013; a code without a label would
  // reach the Inbox as a raw identifier.
  for (const code of [
    'customer_requested_human',
    'price_before_quote',
    'unresolved_blocker',
    'low_confidence',
    'briefing_complete',
    'human_requested',
    'negotiation',
    'complaint',
    'urgency',
    'unsupported',
    'iteration_limit',
  ]) {
    assert.ok(Object.hasOwn(HANDOFF_REASON_LABELS, code), code);
    assert.notEqual(handoffReasonLabel(code), 'Aguardando vendedor', code);
  }
  assert.equal(handoffReasonLabel('price_before_quote'), 'Perguntou o valor');
  assert.equal(handoffReasonLabel('negotiation'), 'Perguntou o valor');
  assert.equal(
    handoffReasonLabel('customer_requested_human'),
    'Pediu um vendedor',
  );
  assert.equal(handoffReasonLabel('human_requested'), 'Pediu um vendedor');
  assert.equal(handoffReasonLabel('briefing_complete'), 'Pré-ficha completa');
  assert.equal(handoffReasonLabel('unresolved_blocker'), 'Dado divergente');
  assert.equal(handoffReasonLabel('low_confidence'), 'Agente sem confiança');
  assert.equal(handoffReasonLabel('complaint'), 'Reclamação');
  assert.equal(handoffReasonLabel('urgency'), 'Urgência');
  assert.equal(handoffReasonLabel('unsupported'), 'Conteúdo não suportado');
  assert.equal(handoffReasonLabel('iteration_limit'), 'Limite de mensagens');
  assert.equal(handoffReasonLabel('inventado'), 'Aguardando vendedor');
});

test('parses the typed amount in Brazilian format into integer cents', () => {
  assert.equal(parseBrl('4.820,00'), 482000);
  assert.equal(parseBrl('4820'), 482000);
  assert.equal(parseBrl('4820,5'), 482050);
  assert.equal(parseBrl(' 150,00 '), 15000);
  assert.equal(parseBrl('1.234.567,89'), 123456789);
});

test('refuses malformed amounts in the browser, before the request', () => {
  // PFI-11: the dot-decimal form is a different number, never a guess.
  for (const text of ['4,820.00', 'abc', '', '0', '0,00', '-1', '1,234']) {
    assert.equal(parseBrl(text), null, text);
  }
  assert.equal(parseBrl(null), null);
  assert.equal(parseBrl(4820), null);
});

test('formats cents the same way the seller types them', () => {
  assert.equal(formatBrl(482000), '4.820,00');
  assert.equal(formatBrl(1), '0,01');
  assert.equal(formatBrl(123456789), '1.234.567,89');
  assert.equal(formatBrl(null), '');
  assert.equal(formatBrl(0), '');
});

test('shows the amount with the fixed prefix, or a dash while it is missing', () => {
  assert.equal(amountLabel(118000), 'R$ 1.180,00');
  assert.equal(amountLabel(null), '—');
});

test('names each point missing to generate in plain words (PIT-06)', () => {
  assert.deepEqual(
    missingFieldLabels([
      'items[0].tipo',
      'items[0].cor',
      'items[0].estampa',
      'items[0].malhas',
      'items[1].grade',
      'items[1].gola',
      'items[1].tipo_servico',
      'finalAmount',
      'paymentCondition',
    ]),
    [
      'tipo de roupa do item 1',
      'cor do item 1',
      'estampa do item 1',
      'tecido do item 1',
      'tamanhos do item 2',
      'definição da gola do item 2',
      'tipo de serviço do item 2',
      'valor final',
      'forma de pagamento',
    ],
  );
  assert.deepEqual(missingFieldLabels(['items']), ['nenhum item']);
  assert.deepEqual(missingFieldLabels([]), []);
  assert.deepEqual(missingFieldLabels(null), []);
  assert.equal(isItemGap('items'), true);
  assert.equal(isItemGap('items[3].gola'), true);
  assert.equal(isItemGap('finalAmount'), false);
});

test('names an unmapped missing field instead of hiding it', () => {
  assert.deepEqual(missingFieldLabels(['summary.futuro']), ['summary.futuro']);
  assert.deepEqual(
    missingFieldLabels(['items[0].modelo']),
    ['items[0].modelo'],
    'an extra never blocks, so it has no label of its own',
  );
});

test('summarises what is missing for the Situação column (PLI-05)', () => {
  assert.equal(missingHeadline([]), 'Pronto para confirmar');
  assert.equal(
    missingHeadline(['items', 'finalAmount', 'paymentCondition']),
    'Nenhum item',
  );
  assert.equal(
    missingHeadline(['finalAmount', 'paymentCondition']),
    'Falta valor final e forma de pagamento',
  );
  assert.equal(missingHeadline(['finalAmount']), 'Falta valor final');
  assert.equal(
    missingHeadline(['items[0].cor', 'finalAmount', 'paymentCondition']),
    'Falta cor do item 1, valor final e mais 1 ponto',
  );
  assert.equal(
    missingHeadline([
      'items[0].cor',
      'items[0].gola',
      'finalAmount',
      'paymentCondition',
    ]),
    'Falta cor do item 1, definição da gola do item 1 e mais 2 pontos',
  );
  assert.equal(missingHeadline(null), 'Pronto para confirmar');
});

test('joins parts of a sentence the Portuguese way', () => {
  assert.equal(joinPt([]), '');
  assert.equal(joinPt(['a']), 'a');
  assert.equal(joinPt(['a', 'b']), 'a e b');
  assert.equal(joinPt(['a', 'b', 'c']), 'a, b e c');
});

test('heads each item with its type and the pieces of its sizes (PIT-01)', () => {
  const item = {
    grade: [
      { quantidade: 100, tamanho: 'M' },
      { quantidade: 50, tamanho: 'G' },
    ],
    tipo: 'CAMISETA',
  };
  assert.equal(itemPieces(item), 150);
  assert.equal(itemHeading(item, 0), 'Item 1 · CAMISETA · 150 peças');
  assert.equal(
    itemHeading({ grade: [], tipo: ' ' }, 2),
    'Item 3 · — · 0 peças',
  );
  assert.equal(itemPieces({}), 0);
});

test('compares the sizes with the quantity the customer said, without blocking (PIT-09)', () => {
  /** @param {unknown} quantity @param {number} totalPieces */
  const order = (quantity, totalPieces) => ({
    ficha: { serviceData: quantity === undefined ? {} : { quantity } },
    totalPieces,
  });
  assert.deepEqual(informedQuantity(order(30, 0)), { count: 30, text: '30' });
  assert.deepEqual(informedQuantity(order('30 peças', 0)), {
    count: 30,
    text: '30 peças',
  });
  assert.deepEqual(informedQuantity(order('entre 20 e 30', 0)), {
    count: null,
    text: 'entre 20 e 30',
  });
  assert.equal(informedQuantity(order('Definir com o vendedor', 0)), null);
  assert.equal(informedQuantity(order(undefined, 0)), null);
  assert.equal(informedQuantity(order('', 0)), null);

  assert.equal(
    quantityWarning(order(30, 40)),
    'A soma dos tamanhos (40) é diferente da quantidade informada (30)',
  );
  assert.equal(quantityWarning(order(40, 40)), '');
  assert.equal(quantityWarning(order(30, 0)), '', 'no sizes, no warning');
  assert.equal(quantityWarning(order('uns 30 ou 40', 20)), '');
  assert.equal(quantityWarning(order(undefined, 20)), '');

  const empty = { grade: [] };
  assert.equal(
    itemQuantityLabel(empty, 0, order(30, 0)),
    '— (cliente informou 30)',
  );
  assert.equal(itemQuantityLabel(empty, 1, order(30, 0)), '—');
  assert.equal(itemQuantityLabel(empty, 0, order(undefined, 0)), '—');
  assert.equal(
    itemQuantityLabel(
      { grade: [{ quantidade: 1, tamanho: 'M' }] },
      0,
      order(30, 1),
    ),
    '1 peça',
  );
});

test('measures how long the order has been still (A02)', () => {
  const now = new Date('2026-09-12T12:00:00.000Z');
  assert.equal(elapsedSince('2026-09-12T11:59:30.000Z', now), 'agora');
  assert.equal(elapsedSince('2026-09-12T11:57:00.000Z', now), '3min');
  assert.equal(elapsedSince('2026-09-12T09:46:00.000Z', now), '2h 14min');
  assert.equal(elapsedSince('2026-09-12T06:58:00.000Z', now), '5h 02min');
  assert.equal(elapsedSince('2026-09-11T08:45:00.000Z', now), '1d 03h');
  assert.equal(elapsedSince('2026-09-12T12:30:00.000Z', now), 'agora');
  assert.equal(elapsedSince('', now), '');
  assert.equal(elapsedSince('not a date', now), '');
});

test('states why printing is locked while the order is pending (PIM-01)', () => {
  assert.equal(PRINT_LOCKED_REASON, 'Disponível depois de gerar o pedido');
});

test('prints the FAB the same way whether the code carries the prefix or not', () => {
  assert.equal(fabLabel('01'), 'FAB 01');
  assert.equal(fabLabel('FAB 01'), 'FAB 01');
  assert.equal(fabLabel('fab 02'), 'FAB 02');
  assert.equal(fabLabel('FABRICA'), 'FAB FABRICA');
  assert.equal(fabLabel(''), '—');
  assert.equal(fabLabel(null), '—');
});

test('reads days the way the operation does, on São Paulo time', () => {
  assert.equal(dayLabel('2026-10-24'), '24/10/2026');
  assert.equal(dayLabel('30/09/2026'), '30/09/2026', 'older free text stays');
  assert.equal(dayLabel(null), '');
  // 01:30 UTC on 13/09 is still 12/09 in São Paulo.
  assert.equal(operationalDay('2026-09-13T01:30:00.000Z'), '2026-09-12');
  assert.equal(
    operationalDay(new Date('2026-09-13T03:00:00.000Z')),
    '2026-09-13',
  );
  assert.equal(operationalDay('not a date'), '');
  assert.equal(operationalDay(null), '');
});

test('lays the order trail out from first contact to delivery (PLA-01..03)', () => {
  const order = {
    deliveredOn: null,
    ficha: { summary: { data_entrega_confirmada: '2026-10-24' } },
    firstContactAt: '2026-09-02T01:30:00.000Z',
    orderDate: '2026-09-09',
    paidOn: '2026-09-10',
  };
  assert.deepEqual(orderMilestones(order), [
    {
      key: 'firstContact',
      label: 'Primeiro contato',
      note: 'vem da conversa',
      recorded: true,
      value: '01/09/2026',
    },
    {
      key: 'closed',
      label: 'Pedido fechado',
      note: 'data do pedido',
      recorded: true,
      value: '09/09/2026',
    },
    {
      key: 'paid',
      label: 'Pagamento',
      note: 'informado',
      recorded: true,
      value: '10/09/2026',
    },
    {
      key: 'promised',
      label: 'Entrega prometida',
      note: 'vem do resumo',
      recorded: true,
      value: '24/10/2026',
    },
    {
      key: 'delivered',
      label: 'Entrega realizada',
      note: 'a informar',
      recorded: false,
      value: '—',
    },
  ]);
  assert.deepEqual(
    orderMilestones({ ficha: { summary: {} } }).map((step) => [
      step.value,
      step.note,
    ]),
    [
      ['—', 'sem registro'],
      ['—', 'definida ao gerar'],
      ['—', 'a informar'],
      ['—', 'não combinada'],
      ['—', 'a informar'],
    ],
  );
  // ADR 016: a pending order needs the promised delivery to be generated.
  assert.equal(
    orderMilestones({ ficha: { summary: {} }, status: 'pendente' }).find(
      (step) => step.key === 'promised',
    )?.note,
    'exigida para gerar',
  );
});

test('names the promised delivery and tells it apart from the amount and payment method', () => {
  assert.deepEqual(
    missingFieldLabels([
      'items[0].cor',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ]),
    ['cor do item 1', 'entrega prometida', 'valor final', 'forma de pagamento'],
  );
  assert.equal(isPageGap('summary.data_entrega_confirmada'), true);
  assert.equal(isPageGap('items[0].cor'), true);
  assert.equal(isPageGap('finalAmount'), false);
  assert.equal(isPageGap('paymentCondition'), false);
  assert.equal(
    missingHeadline(['summary.data_entrega_confirmada']),
    'Falta entrega prometida',
  );
});
