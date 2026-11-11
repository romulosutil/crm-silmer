import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billingOperations,
  billingNeedsRefresh,
} from '../apps/edge-web/src/lib/order-billing-operations.js';

test('BCS-01: a charge owns its receipts; external collections do not duplicate a receipt', () => {
  const billing = {
    charges: [
      { id: 'same', amountCents: 3000, createdAt: '2026-11-09T12:00:00Z' },
    ],
    payments: [
      { id: 'ip', source: 'infinitepay', chargeId: 'same', amountCents: 3000 },
      {
        id: 'same',
        source: 'external',
        amountCents: 7000,
        receivedOn: '2026-11-10',
      },
    ],
    externalReceipts: [
      {
        id: 'same',
        amountCents: 7000,
        receivedOn: '2026-11-10',
        reversedAt: '2026-11-11T12:00:00Z',
      },
    ],
  };
  const before = JSON.stringify(billing);
  const rows = billingOperations(billing);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['external:same', 'charge:same'],
  );
  assert.equal(rows[0].external.reversedAt, '2026-11-11T12:00:00Z');
  assert.equal(rows[1].payments[0].id, 'ip');
  assert.equal(rows[0].amountCents, 7000);
  assert.equal(JSON.stringify(billing), before);
});

test('BCS-02: paged movements remain attached by exact source and operation ID', () => {
  const billing = { charges: [{ id: 'c' }], externalReceipts: [{ id: 'c' }] };
  const rows = billingOperations(billing, [
    {
      id: 'one',
      chargeId: 'c',
      kind: 'charge',
      occurredAt: '2026-11-09T10:00:00Z',
    },
    {
      id: 'two',
      externalReceiptId: 'c',
      kind: 'external_reversal',
      occurredAt: '2026-11-11T10:00:00Z',
    },
    {
      id: 'three',
      chargeId: 'c',
      kind: 'intent',
      status: 'sent',
      occurredAt: '2026-11-10T10:00:00Z',
    },
    {
      id: 'one',
      chargeId: 'c',
      kind: 'charge',
      occurredAt: '2026-11-09T10:00:00Z',
    },
  ]);
  assert.deepEqual(
    rows
      .find((row) => row.id === 'charge:c')
      .events.map((/** @type {any} */ item) => item.id),
    ['three', 'one'],
  );
  assert.deepEqual(
    rows
      .find((row) => row.id === 'external:c')
      .events.map((/** @type {any} */ item) => item.id),
    ['two'],
  );
  assert.equal(billingOperations(billing, []).length, 2);
});

test('BCS-01/02: orphan receipts and unlinked persisted events stay readable without fictitious charge identity', () => {
  const rows = billingOperations(
    {
      payments: [
        {
          id: 'p',
          source: 'infinitepay',
          amountCents: 100,
          receivedOn: '2026-11-09',
        },
      ],
    },
    [
      {
        id: 'old',
        kind: 'intent',
        status: 'unknown',
        occurredAt: '2026-11-08T10:00:00Z',
      },
    ],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'payment:p');
  assert.equal(rows[0].charge, null);
  assert.equal(rows[0].payments[0].amountCents, 100);
  assert.equal(rows[1].id, 'movement:old');
  assert.equal(rows[1].events[0].status, 'unknown');
  assert.deepEqual(billingOperations(null), []);
});

test('BCS-02: independent external records survive missing ledger entries without fabricating timestamps', () => {
  const rows = billingOperations({
    externalReceipts: [
      {
        id: 'manual',
        amountCents: 42,
        receivedOn: '2026-11-01',
        recordedAt: '2026-11-11T10:00:00Z',
      },
    ],
  });
  assert.equal(rows[0].date, '2026-11-01');
  assert.equal(rows[0].external.recordedAt, '2026-11-11T10:00:00Z');
  assert.deepEqual(rows[0].payments, []);
});

test('BCS-09: idle and settled operations stop polling; unresolved charges, checks and latest send states keep reconciliation', () => {
  assert.equal(
    billingNeedsRefresh({ charges: [], paymentChecks: [] }, []),
    false,
  );
  assert.equal(
    billingNeedsRefresh(
      { charges: [{ status: 'paid' }, { status: 'closed' }] },
      [],
    ),
    false,
  );
  assert.equal(
    billingNeedsRefresh({ charges: [{ status: 'waiting' }] }, []),
    true,
  );
  assert.equal(
    billingNeedsRefresh({ paymentChecks: [{ state: 'queued' }] }, []),
    true,
  );
  const queued = {
    intentId: 'one',
    status: 'queued',
    occurredAt: '2026-11-11T10:00:00Z',
  };
  const delivered = {
    ...queued,
    status: 'delivered',
    occurredAt: '2026-11-11T10:01:00Z',
  };
  assert.equal(billingNeedsRefresh({}, [queued]), true);
  assert.equal(billingNeedsRefresh({}, [delivered, queued]), false);
  assert.equal(billingNeedsRefresh({}, [queued, delivered]), false);
  assert.equal(
    billingNeedsRefresh({}, [
      queued,
      { ...delivered, occurredAt: queued.occurredAt },
    ]),
    false,
  );
});
