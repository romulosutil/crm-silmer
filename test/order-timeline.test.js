import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderTimeline } from '../apps/edge-web/src/lib/order-timeline.js';

const order = {
  firstContactAt: '2026-11-07T01:00:00Z',
  orderDate: '2026-11-08',
  confirmedAt: '2026-11-08T15:00:00Z',
  paidOn: null,
  deliveredOn: null,
  status: 'confirmado',
};
const event = (extra = {}) => ({
  id: 'receipt:external:m1',
  kind: 'receipt',
  source: 'external',
  receiptId: 'm1',
  day: '2026-11-10',
  occurredAt: null,
  dateBasis: 'effective_day',
  amountCents: 7000,
  appliedAmountCents: 7000,
  method: 'bank_transfer',
  status: 'active',
  recordedAt: '2026-11-11T12:00:00Z',
  actorName: 'Marina sintética',
  ...extra,
});

test('DTL: milestones use São Paulo day and missing dates remain absent', () => {
  const timeline = orderTimeline(order, null);
  assert.deepEqual(
    timeline.map((e) => e.day),
    ['2026-11-06', '2026-11-08'],
  );
  assert.deepEqual(
    timeline.map((e) => e.title),
    ['Primeiro contato', 'Pedido confirmado'],
  );
  assert.equal(orderTimeline({ status: 'pendente' }, null).length, 0);
});
test('DTL: real manual and gateway events keep effective and verification date semantics', () => {
  const timeline = orderTimeline(order, {
    managed: true,
    charges: [],
    timelineEvents: [
      event(),
      event({
        id: 'receipt:infinitepay:i1',
        receiptId: 'i1',
        source: 'infinitepay',
        day: '2026-11-09',
        dateBasis: 'crm_verification',
        method: 'pix',
        amountCents: 3000,
        appliedAmountCents: 3000,
        occurredAt: '2026-11-09T15:00:00Z',
        recordedAt: '2026-11-09T15:00:00Z',
        actorName: null,
      }),
    ],
  });
  assert.deepEqual(
    timeline.map((e) => e.day),
    ['2026-11-06', '2026-11-08', '2026-11-09', '2026-11-10'],
  );
  const manual = timeline.find((e) => e.id === 'receipt:external:m1');
  assert.ok(manual);
  assert.equal(manual.title, 'Recebimento manual');
  assert.match(manual.amountLabel, /70,00/);
  assert.ok(manual.detailLines.join(' ').includes('Marina sintética'));
  const gateway = timeline.find((e) => e.id === 'receipt:infinitepay:i1');
  assert.ok(gateway);
  assert.match(gateway.detailLines.join(' '), /confirma|verifica/i);
});
test('DTL: links and legacy paidOn do not become invented receipts', () => {
  const legacy = orderTimeline({ ...order, paidOn: '2026-11-10' }, null);
  assert.equal(
    legacy.filter((e) => e.title === 'Quitação registrada').length,
    1,
  );
  const legacyPayment = legacy.at(-1);
  assert.ok(legacyPayment);
  assert.equal(legacyPayment.amountLabel ?? '', '');
  assert.match(
    [legacyPayment.subtitle, ...legacyPayment.detailLines].join(' '),
    /sem detalhamento/i,
  );
  const current = orderTimeline(
    { ...order, paidOn: '2026-11-10' },
    {
      managed: true,
      charges: [{ id: 'c1', status: 'waiting' }],
      timelineEvents: [],
    },
  );
  assert.equal(current.filter((e) => e.kind === 'receipt').length, 0);
  assert.equal(
    current.filter((e) => e.title === 'Quitação registrada').length,
    0,
  );
});
test('DTL: correction remains beside the original receipt with a negative display and status', () => {
  const original = event({ status: 'reversed', appliedAmountCents: 0 });
  const reversal = event({
    id: 'external_reversal:r1',
    kind: 'external_reversal',
    day: '2026-11-11',
    occurredAt: '2026-11-11T15:00:00Z',
    appliedAmountCents: 0,
    status: 'reversed',
  });
  const result = orderTimeline(order, {
    managed: true,
    charges: [],
    timelineEvents: [original, reversal],
  });
  assert.equal(result.filter((e) => e.id === original.id).length, 1);
  const receiptEvent = result.find((e) => e.id === original.id);
  const reversalEvent = result.find((e) => e.id === reversal.id);
  assert.ok(receiptEvent);
  assert.ok(reversalEvent);
  assert.match(receiptEvent.statusLabel, /revert/i);
  assert.match(reversalEvent.amountLabel, /^[−-]/);
});
test('DTL: legacy delivery never borrows the commercial confirmer as its author', () => {
  const result = orderTimeline(
    {
      ...order,
      deliveredOn: '2026-11-11',
      confirmedBy: { id: 'x', name: 'Autor comercial' },
    },
    null,
  );
  const delivery = result.find((e) => e.title === 'Pedido entregue');
  assert.ok(delivery);
  assert.equal(delivery.day, '2026-11-11');
  assert.ok(!JSON.stringify(delivery).includes('Autor comercial'));
});

test('DTL-08: known settlement is preserved while receipt details are unavailable', () => {
  const result = orderTimeline(
    { ...order, paidOn: '2026-11-10' },
    { managed: true, pendingDetails: true },
  );
  const settlement = result.find((e) => e.title === 'Quitação registrada');
  assert.ok(settlement);
  assert.equal(settlement.day, '2026-11-10');
  assert.equal(settlement.subtitle, 'Detalhamento aguardando atualização');
  assert.equal(settlement.amountLabel, undefined);
  assert.equal(settlement.statusLabel, 'Aguardando atualização');
});
