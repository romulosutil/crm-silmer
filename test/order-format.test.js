import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amountLabel,
  elapsedSince,
  fabLabel,
  formatBrl,
  HANDOFF_REASON_LABELS,
  handoffReasonLabel,
  missingFieldLabels,
  missingHeadline,
  orderStatusLabel,
  parseBrl,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
  PRINT_LOCKED_REASON,
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

test('turns missingFields into what the banner lists (PFI-09)', () => {
  assert.deepEqual(
    missingFieldLabels([
      'items',
      'finalAmount',
      'paymentCondition',
      'summary.cliente',
      'summary.data_entrega_confirmada',
      'summary.aplicacao',
      'summary.nome',
    ]),
    [
      'nenhum item com grade',
      'valor final',
      'condição de pagamento',
      'cliente',
      'entrega confirmada',
      'aplicação',
      'evento/nome',
    ],
  );
  assert.deepEqual(missingFieldLabels(['items[0].modelo', 'items[1].grade']), [
    'item 1: modelo',
    'item 2: grade',
  ]);
  assert.deepEqual(missingFieldLabels(['items[0].cor_manga_direita']), [
    'item 1: cor da manga direita',
  ]);
  assert.deepEqual(missingFieldLabels([]), []);
  assert.deepEqual(missingFieldLabels(null), []);
});

test('names an unmapped missing field instead of hiding it', () => {
  assert.deepEqual(missingFieldLabels(['summary.futuro']), ['summary.futuro']);
});

test('summarises what is missing for the Situação column (PLI-05)', () => {
  assert.equal(missingHeadline([]), 'Pronto para confirmar');
  assert.equal(
    missingHeadline(['items', 'finalAmount', 'paymentCondition']),
    'Nenhum item',
  );
  assert.equal(
    missingHeadline(['finalAmount', 'paymentCondition']),
    'Falta valor e condição',
  );
  assert.equal(missingHeadline(['finalAmount']), 'Falta o valor final');
  assert.equal(
    missingHeadline(['paymentCondition']),
    'Falta a condição de pagamento',
  );
  assert.equal(missingHeadline(['items[0].modelo']), 'Falta item 1: modelo');
  assert.equal(missingHeadline(null), 'Pronto para confirmar');
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
