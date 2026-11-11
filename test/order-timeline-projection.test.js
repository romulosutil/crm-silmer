import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderTimelineEvents } from '../apps/api/src/order-timeline-projection.js';

/** @param {any} [extra] */
const payment = (extra = {}) => ({
  id: 'p1',
  source: 'infinitepay',
  charge_id: 'c1',
  principal_amount_cents: '3000',
  applied_amount_cents: '3000',
  refunded_amount_cents: '0',
  application_valid: true,
  method: 'pix',
  installments: 1,
  verified_at: '2026-11-06T01:30:00.000Z',
  received_on: '2026-11-05',
  transaction_nsu: 'private-nsu-canary',
  receipt_envelope: { url: 'private-url-canary' },
  ...extra,
});
/** @param {any} [extra] */
const project = (extra = {}) =>
  orderTimelineEvents({
    payments: [payment()],
    external: [],
    refunds: [],
    reviewRequired: false,
    ...extra,
  });

test('DTL-01/03/04: one event per source/id, effective manual day versus verified São Paulo day', () => {
  const gateway = payment();
  const manual = payment({
    id: 'm1',
    source: 'external',
    charge_id: null,
    principal_amount_cents: '7000',
    applied_amount_cents: '7000',
    received_on: '2026-11-04',
    method: 'cash',
  });
  const events = project({
    payments: [gateway, manual, manual],
    external: [
      {
        id: 'm1',
        recorded_by_name: 'Seller',
        note_envelope: 'private-note-canary',
      },
    ],
  });
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.id),
    ['receipt:external:m1', 'receipt:infinitepay:p1'],
  );
  assert.equal(events[0].day, '2026-11-04');
  assert.equal(events[0].dateBasis, 'effective_day');
  assert.equal(events[0].occurredAt, null);
  assert.equal(events[0].recordedAt, '2026-11-06T01:30:00.000Z');
  assert.equal(events[0].actorName, 'Seller');
  assert.equal(events[1].day, '2026-11-05');
  assert.equal(events[1].dateBasis, 'crm_verification');
  assert.equal(events[1].occurredAt, '2026-11-06T01:30:00.000Z');
  assert.equal(events[1].actorName, null);
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-|transaction_nsu|receipt_envelope|note_envelope/u,
  );
});

test('DTL-05: reversal preserves original and adds linked correction without private reason', () => {
  const events = project({
    payments: [payment({ source: 'external', applied_amount_cents: 0 })],
    external: [
      {
        id: 'p1',
        reversal_id: 'r1',
        reversed_at: '2026-11-07T01:00:00Z',
        reversed_by_name: 'Admin',
        reason_envelope: 'private-reason-canary',
      },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 'reversed');
  assert.equal(events[0].amountCents, 3000);
  assert.equal(events[0].appliedAmountCents, 0);
  assert.equal(events[1].id, 'external_reversal:r1');
  assert.equal(events[1].receiptId, 'p1');
  assert.equal(events[1].day, '2026-11-06');
  assert.equal(events[1].actorName, 'Admin');
  assert.doesNotMatch(JSON.stringify(events), /private-reason/u);
});

test('DTL-05: partial/full refunds preserve original amount and individual adjustment dates', () => {
  const refund = {
    id: 'r1',
    payment_id: 'p1',
    amount_cents: 1000,
    created_at: '2026-11-07T15:00:00Z',
    actor_name: 'Admin',
  };
  const partial = project({
    payments: [payment({ refunded_amount_cents: 1000 })],
    refunds: [refund],
  });
  assert.equal(partial[0].status, 'partially_refunded');
  assert.equal(partial[0].amountCents, 3000);
  assert.equal(partial[0].appliedAmountCents, 2000);
  assert.equal(partial[1].id, 'refund:r1');
  assert.equal(partial[1].amountCents, 1000);
  assert.equal(partial[1].occurredAt, '2026-11-07T15:00:00.000Z');
  const full = project({
    payments: [payment({ refunded_amount_cents: 3000 })],
    refunds: [refund, { ...refund, id: 'r2', amount_cents: 2000 }],
  });
  assert.equal(full[0].status, 'refunded');
  assert.equal(full[0].appliedAmountCents, 0);
  assert.deepEqual(
    full.slice(1).map((event) => event.id),
    ['refund:r1', 'refund:r2'],
  );
});

test('DTL-05: invalid applications distinguish review and unapplied and never imply active credit', () => {
  const payments = [
    payment({ application_valid: false, applied_amount_cents: 0 }),
  ];
  assert.equal(project({ payments })[0].status, 'not_applied');
  assert.equal(project({ payments, reviewRequired: true })[0].status, 'review');
  assert.equal(
    project({ payments, reviewRequired: true })[0].appliedAmountCents,
    0,
  );
});

test('DTL-01/06: source namespaces survive colliding IDs and sorting is deterministic', () => {
  const payments = [
    payment(),
    payment({ source: 'external', received_on: '2026-11-05' }),
  ];
  const first = project({ payments });
  const reverse = project({ payments: [...payments].reverse() });
  assert.equal(first.length, 2);
  assert.deepEqual(first, reverse);
  assert.deepEqual(
    new Set(first.map((event) => event.id)),
    new Set(['receipt:external:p1', 'receipt:infinitepay:p1']),
  );
});

test('DTL-02: no receipt is synthesized from empty ledger or unmatched corrections', () => {
  assert.deepEqual(
    project({
      payments: [],
      external: [{ id: 'orphan' }],
      refunds: [{ id: 'refund', payment_id: 'orphan' }],
    }),
    [],
  );
});
