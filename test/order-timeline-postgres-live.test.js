import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createOrderBillingRuntime } from '../apps/api/src/order-billing-runtime.js';
import { createOrderApiRuntime } from '../apps/api/src/order-runtime.js';
import {
  seed,
  KEY,
  SELLER,
  NOW,
} from './support/order-billing-chat-fixture.js';

const url = process.env.TEST_DATABASE_URL;
const ENV = {
  ORDER_BILLING_ENABLED: 'true',
  ORDER_BILLING_RECEIVE_ENABLED: 'true',
  N8N_INTEGRATION_ENVELOPE_KEY: KEY.toString('base64'),
  IDEMPOTENCY_ENVELOPE_KEY: KEY.toString('base64'),
};
const OTHER = { id: 'timeline-other', kind: 'human' },
  ADMIN = { id: 'timeline-admin', kind: 'human' },
  FINANCE = { id: 'timeline-finance', kind: 'human' },
  INACTIVE = { id: 'timeline-inactive', kind: 'human' };

if (!url) {
  test(
    'Order timeline integration requires dedicated TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  assert.match(new URL(url).pathname, /^\/crm_silmer_test(?:_[a-z0-9_]+)?$/u);
  const pool = new Pool({ connectionString: url, max: 6 });
  const database = {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
  let now = NOW;
  const access = {
    authorizeRead: async () => ({ actor: SELLER }),
    authorizeWrite: async () => ({ actor: SELLER }),
  };
  const runtime = createOrderBillingRuntime(database, {
    environment: ENV,
    clock: () => now,
    access,
  });
  before(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    for (const [actor, role] of [
      [SELLER, 'Vendedor'],
      [OTHER, 'Vendedor'],
      [ADMIN, 'Vendedor'],
      [FINANCE, 'Financeiro'],
      [INACTIVE, 'Vendedor'],
    ]) {
      const id = /** @type {any} */ (actor).id;
      await pool.query(
        "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic',$3)",
        [
          id,
          `${id}@example.test`,
          id === ADMIN.id ? 'Timeline admin' : 'Timeline seller',
        ],
      );
      await pool.query(
        'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2)',
        [id, role],
      );
    }
    await pool.query(
      "INSERT INTO crm.user_capabilities(user_id,capability,granted_by) VALUES($1,'COMMERCIAL_ADMIN',$2)",
      [ADMIN.id, SELLER.id],
    );
    await pool.query('UPDATE crm.users SET disabled_at=$2 WHERE id=$1', [
      INACTIVE.id,
      NOW,
    ]);
  });
  beforeEach(() => {
    now = NOW;
  });
  after(() => pool.end());
  /** @param {string} id @param {any} [extra] */
  async function command(id, extra = {}) {
    const { billing } = await runtime.get({ actor: SELLER, orderId: id });
    return {
      actor: SELLER,
      orderId: id,
      expectedVersion: billing.orderVersion,
      expectedBillingVersion: billing.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      ...extra,
    };
  }
  /** @param {string} id @param {number} [percent] */
  async function issue(id, percent = 30) {
    const { billing } = await runtime.issue(await command(id, { percent }));
    const charge = billing.charges.at(-1),
      executionId = randomUUID();
    await runtime.reserve({
      chargeId: charge.id,
      executionId,
      correlationId: randomUUID(),
    });
    await runtime.created({
      chargeId: charge.id,
      executionId,
      checkoutUrl: `https://checkout.infinitepay.io/synthetic-${charge.id}`,
      correlationId: randomUUID(),
    });
    return charge;
  }
  /** @param {any} charge */
  const payment = (charge) => ({
    chargeId: charge.id,
    transactionNsu: randomUUID(),
    invoiceSlug: randomUUID(),
    amountCents: charge.amountCents,
    paidAmountCents: charge.amountCents,
    method: 'pix',
    installments: 1,
    receiptUrl: null,
    correlationId: randomUUID(),
  });
  /** @param {string} id @param {number} amount */
  const external = async (id, amount) =>
    runtime.recordExternal(
      await command(id, {
        amountCents: amount,
        receivedOn: '2026-11-04',
        method: 'cash',
        note: 'private-note-canary',
      }),
    );

  test('DTL-01/03/04/09: mixed receipts are unique, scoped and distinguish manual effective day from verified São Paulo day', async () => {
    const id = await seed(pool),
      charge = await issue(id);
    now = new Date('2026-11-06T01:30:00Z');
    await runtime.payment(payment(charge));
    const state = await external(id, 7000);
    const otherId = await seed(pool);
    await external(otherId, 1000);
    const result = await runtime.get({ actor: SELLER, orderId: id });
    const events = result.billing.timelineEvents;
    assert.equal(events.length, 2);
    assert.equal(new Set(events.map((/** @type {any} */ e) => e.id)).size, 2);
    assert.deepEqual(
      events.map((/** @type {any} */ e) => e.source),
      ['external', 'infinitepay'],
    );
    assert.equal(events[0].day, '2026-11-04');
    assert.equal(events[0].occurredAt, null);
    assert.equal(events[0].recordedAt, '2026-11-06T01:30:00.000Z');
    assert.equal(events[0].actorName, 'Timeline seller');
    assert.equal(events[1].day, '2026-11-05');
    assert.equal(events[1].dateBasis, 'crm_verification');
    assert.equal(events[1].occurredAt, '2026-11-06T01:30:00.000Z');
    assert.deepEqual(
      events.map((/** @type {any} */ e) => e.amountCents),
      [7000, 3000],
    );
    assert.equal(state.billing.receivedAmountCents, 10000);
    assert.equal(result.billing.balanceAmountCents, 0);
    assert.equal(
      (
        await pool.query('SELECT paid_on::text FROM crm.orders WHERE id=$1', [
          id,
        ])
      ).rows[0].paid_on,
      '2026-11-05',
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /private-note|transactionNsu|receiptUrl|checkoutUrl|note|reason/u,
    );
  });

  test('DTL-01/02/12: callbacks and external command replay never duplicate timeline events', async () => {
    const id = await seed(pool),
      charge = await issue(id),
      input = payment(charge);
    await runtime.payment(input);
    await runtime.payment(input);
    const receiptCommand = await command(id, {
      amountCents: 7000,
      receivedOn: '2026-11-04',
      method: 'cash',
      note: '',
    });
    await runtime.recordExternal(receiptCommand);
    await runtime.recordExternal(receiptCommand);
    const { billing } = await runtime.get({ actor: SELLER, orderId: id });
    assert.equal(billing.timelineEvents.length, 2);
    assert.equal(billing.receivedAmountCents, 10000);
    assert.equal(billing.balanceAmountCents, 0);
    const emptyId = await seed(pool);
    await issue(emptyId);
    assert.deepEqual(
      (await runtime.get({ actor: SELLER, orderId: emptyId })).billing
        .timelineEvents,
      [],
    );
  });

  test('DTL-05: external reversal preserves original and one linked correction under replay', async () => {
    const id = await seed(pool),
      recorded = await external(id, 10000),
      receiptId = recorded.billing.externalReceipts[0].id;
    now = new Date('2026-11-06T01:30:00Z');
    const input = await command(id, {
      receiptId,
      reason: 'private-reversal-canary',
    });
    await runtime.reverseExternal(input);
    await runtime.reverseExternal(input);
    const { billing } = await runtime.get({ actor: SELLER, orderId: id });
    assert.equal(billing.timelineEvents.length, 2);
    assert.equal(billing.timelineEvents[0].status, 'reversed');
    assert.equal(billing.timelineEvents[0].amountCents, 10000);
    assert.equal(billing.timelineEvents[0].appliedAmountCents, 0);
    assert.equal(billing.timelineEvents[1].kind, 'external_reversal');
    assert.equal(billing.timelineEvents[1].receiptId, receiptId);
    assert.equal(billing.timelineEvents[1].day, '2026-11-05');
    assert.equal(billing.timelineEvents[1].actorName, 'Timeline seller');
    assert.equal(billing.receivedAmountCents, 0);
    assert.equal(billing.balanceAmountCents, 10000);
    assert.doesNotMatch(
      JSON.stringify(billing.timelineEvents),
      /private-note|private-reversal/u,
    );
  });

  test('DTL-05: partial refund has its persisted correction event and current net credit', async () => {
    const id = await seed(pool),
      charge = await issue(id, 100);
    await runtime.payment(payment(charge));
    now = new Date('2026-11-06T16:00:00Z');
    await runtime.refund(
      await command(id, { chargeId: charge.id, amountCents: 2500 }),
    );
    const { billing } = await runtime.get({ actor: SELLER, orderId: id });
    assert.equal(billing.timelineEvents.length, 2);
    assert.equal(billing.timelineEvents[0].status, 'partially_refunded');
    assert.equal(billing.timelineEvents[0].amountCents, 10000);
    assert.equal(billing.timelineEvents[0].appliedAmountCents, 7500);
    assert.equal(billing.timelineEvents[1].kind, 'refund');
    assert.equal(billing.timelineEvents[1].amountCents, 2500);
    assert.equal(billing.timelineEvents[1].occurredAt, now.toISOString());
    assert.equal(billing.timelineEvents[1].actorName, 'Timeline seller');
    assert.equal(billing.receivedAmountCents, 7500);
    assert.equal(billing.balanceAmountCents, 2500);
  });

  test('DTL-05: late unapplied gateway receipt is retained as review without duplicating credit', async () => {
    const id = await seed(pool),
      charge = await issue(id);
    await external(id, 10000);
    await runtime.payment(payment(charge));
    const { billing } = await runtime.get({ actor: SELLER, orderId: id });
    assert.equal(billing.timelineEvents.length, 2);
    const late = billing.timelineEvents.find(
      (/** @type {any} */ e) => e.source === 'infinitepay',
    );
    assert.equal(late.status, 'review');
    assert.equal(late.appliedAmountCents, 0);
    assert.equal(late.amountCents, 3000);
    assert.equal(billing.receivedAmountCents, 10000);
  });

  test('DTL-09: owner/admin can read financial events while other seller and disallowed principals cannot acquire them', async () => {
    const id = await seed(pool);
    await external(id, 1000);
    assert.equal(
      (await runtime.get({ actor: SELLER, orderId: id })).billing.timelineEvents
        .length,
      1,
    );
    assert.equal(
      (await runtime.get({ actor: ADMIN, orderId: id })).billing.timelineEvents
        .length,
      1,
    );
    const other = (await runtime.get({ actor: OTHER, orderId: id })).billing;
    assert.deepEqual(other.timelineEvents, []);
    assert.equal(other.deliveryConfirmation, null);
    for (const actor of [
      FINANCE,
      INACTIVE,
      { id: 'automation', kind: 'automation' },
    ])
      await assert.rejects(runtime.get({ actor, orderId: id }), {
        code: 'FORBIDDEN',
      });
  });

  test('DTL-02/08: disabling issue preserves receive-only history without changing stored amounts', async () => {
    const id = await seed(pool);
    await external(id, 1000);
    const receiveOnly = createOrderBillingRuntime(database, {
      environment: { ...ENV, ORDER_BILLING_ENABLED: 'false' },
      access,
    });
    const { billing } = await receiveOnly.get({ actor: SELLER, orderId: id });
    assert.equal(billing.enabled, false);
    assert.equal(billing.timelineEvents.length, 1);
    assert.equal(billing.receivedAmountCents, 1000);
    const off = createOrderBillingRuntime(database, {
      environment: {
        ...ENV,
        ORDER_BILLING_ENABLED: 'false',
        ORDER_BILLING_RECEIVE_ENABLED: 'false',
      },
      access,
    });
    await assert.rejects(off.get({ actor: SELLER, orderId: id }), {
      code: 'BILLING_DISABLED',
    });
  });

  test('DTL-10/11: actual delivery audit identifies its writer, ignores no-op audit and omits invented legacy metadata', async () => {
    const id = await seed(pool);
    const keys = Object.fromEntries(
      [
        'CONTACT_IDENTITY_ENVELOPE_KEY',
        'CONTACT_IDENTITY_LOOKUP_KEY',
        'INBOX_MESSAGE_ENVELOPE_KEY',
        'HANDOFF_ENVELOPE_KEY',
        'OPERATION_CURSOR_HMAC_KEY',
      ].map((name) => [name, KEY.toString('base64')]),
    );
    const orders = createOrderApiRuntime(database, {
      access,
      environment: { ...ENV, ...keys, FAB_CODE: '01' },
    });
    const initial = (await runtime.get({ actor: SELLER, orderId: id })).billing;
    const result = await orders.confirmDelivery({
      orderId: id,
      actor: SELLER,
      expectedVersion: initial.orderVersion,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    });
    const first = (await runtime.get({ actor: SELLER, orderId: id })).billing
      .deliveryConfirmation;
    assert.equal(first.day, result.deliveredOn);
    assert.equal(first.actorName, 'Timeline seller');
    assert.ok(first.confirmedAt);
    await orders.confirmDelivery({
      orderId: id,
      actor: ADMIN,
      expectedVersion: result.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    });
    assert.deepEqual(
      (await runtime.get({ actor: SELLER, orderId: id })).billing
        .deliveryConfirmation,
      first,
    );
    const legacyId = await seed(pool);
    await pool.query(
      "UPDATE crm.orders SET delivered_on='2026-11-05',version=version+1 WHERE id=$1",
      [legacyId],
    );
    assert.equal(
      (await runtime.get({ actor: SELLER, orderId: legacyId })).billing
        .deliveryConfirmation,
      null,
    );
  });
}
