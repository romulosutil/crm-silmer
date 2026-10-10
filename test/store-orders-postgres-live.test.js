import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import {
  STORE_NOW,
  STORE_RECEIPT_URL,
  otherStoreOrderBody,
} from './fixtures/store-order.js';

const connectionString = process.env.TEST_DATABASE_URL;
const ENVELOPE_KEY = Buffer.alloc(32, 61);
const HMAC_KEY = Buffer.alloc(32, 27);

if (connectionString) {
  const databaseName = new URL(connectionString).pathname.slice(1);
  assert.match(
    databaseName,
    /^crm_silmer_test(?:_[a-z0-9]+)?$/u,
    'store orders live test only resets a dedicated crm_silmer_test database',
  );
  const pool = new Pool({ connectionString, max: 4 });
  const database = {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
  const repository = new PostgresOrderRepository({
    database,
    envelopeKey: ENVELOPE_KEY,
  });
  const store = createStoreOrderService({
    acceptTest: true,
    clock: () => STORE_NOW,
    fabCode: '01',
    hmacKey: HMAC_KEY,
    repository,
  });

  /** @param {any} body */
  async function record(body) {
    return store.record({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${body.pedido_id}`,
      record: store.parse(body),
    });
  }

  /** @param {number} index @param {(body: any) => void} [change] */
  function paid(index, change) {
    return otherStoreOrderBody(index, (body) => {
      body.cliente.telefone = `5527900${String(index).padStart(6, '0')}`;
      change?.(body);
    });
  }

  before(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
  });
  after(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await pool.end();
  });

  test('LOJ-21: a paid store order is born confirmed with its receipt, event and audit', async () => {
    const { created, order } = await record(paid(1));
    assert.equal(created, true);
    assert.equal(order.origin, 'loja');
    assert.equal(order.conversationId, null);
    assert.equal(order.status, 'confirmado');
    assert.equal(order.isTest, false);
    assert.equal(order.paidOn, '2026-10-07');
    assert.equal(order.orderDate, '2026-10-07');
    assert.equal(order.finalAmountCents, 18000);
    assert.equal(order.paymentCondition, 'pix');
    assert.equal(order.confirmedBy, 'system:loja-do-site');
    assert.equal(order.createdByKind, 'automation');
    assert.equal(order.storeNumber, 'LJ-0001ABCD');
    assert.equal(order.leadTimeBusinessDays, 10);
    assert.deepEqual(order.gatewayPayment, {
      confirmedAt: '2026-10-08T02:15:55.000Z',
      invoiceSlug: 'fatura-sintetica-1',
      paidAmountCents: 18000,
      source: 'infinitepay',
      transactionNsu: 'nsu-sintetico-0001',
    });
    assert.match(order.number, /^\d{2,}-CRM$/u);

    const read = await repository.findById(order.id);
    assert.equal(read?.ficha.loja?.telefone, '5527900000001');
    assert.equal(read?.ficha.summary.cliente, 'Cliente Sintetico da Loja');

    const row = (
      await pool.query('SELECT * FROM crm.orders WHERE id = $1', [order.id])
    ).rows[0];
    const receipt = (
      await pool.query(
        'SELECT * FROM crm.store_order_receipts WHERE order_id = $1',
        [order.id],
      )
    ).rows[0];
    assert.equal(receipt.request_id, paid(1).pedido_id);
    assert.match(receipt.phone_digest, /^[0-9a-f]{64}$/u);
    assert.match(receipt.record_sha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'order_id',
      'phone_digest',
      'received_at',
      'record_sha256',
      'request_id',
    ]);
    for (const stored of [JSON.stringify(row), JSON.stringify(receipt)]) {
      assert.doesNotMatch(stored, /Cliente Sintetico|5527900000001/u);
    }
    const events = (
      await pool.query(
        `SELECT event_type, payload FROM crm.domain_events
         WHERE aggregate_type = 'order' AND aggregate_id = $1`,
        [order.id],
      )
    ).rows;
    assert.deepEqual(events, [
      {
        event_type: 'order.created',
        payload: { conversationId: null, orderId: order.id },
      },
    ]);
    const audits = await pool.query(
      `SELECT actor_id, action, target_type, version, reason, correlation_id
       FROM crm.audit_events WHERE target_id = $1`,
      [order.id],
    );
    assert.deepEqual(audits.rows, [
      {
        action: 'store.order.create',
        actor_id: 'AUTOMATION_EXECUTOR',
        correlation_id: `correlation-${paid(1).pedido_id}`,
        reason: 'INFINITEPAY_PAYMENT_CONFIRMED',
        target_type: 'order',
        version: '1',
      },
    ]);
  });

  test('LOJ-17: a retry answers the same order; the receipt link that arrives later is attached; a divergence is a conflict', async () => {
    const first = await record(paid(2));
    const replay = await record(paid(2));
    assert.equal(replay.created, false);
    assert.equal(replay.order.id, first.order.id);
    assert.equal(replay.order.version, 1);

    const withReceipt = paid(2, (body) => {
      body.pagamento.receipt_url = STORE_RECEIPT_URL;
    });
    const attached = await record(withReceipt);
    assert.equal(attached.receiptAttached, true);
    assert.equal(attached.order.version, 2);
    const read = await repository.findById(first.order.id);
    assert.equal(read?.ficha.loja?.comprovanteUrl, STORE_RECEIPT_URL);
    const row = (
      await pool.query('SELECT ficha_envelope FROM crm.orders WHERE id = $1', [
        first.order.id,
      ])
    ).rows[0];
    // The link lives only inside the encrypted ficha.
    assert.doesNotMatch(JSON.stringify(row), /infinitepay/u);
    assert.equal((await record(withReceipt)).order.version, 2);

    await assert.rejects(
      record(
        paid(2, (body) => {
          body.pagamento.receipt_url = 'https://recibo.infinitepay.io/outro';
        }),
      ),
      { code: 'STORE_ORDER_CONFLICT', statusCode: 409 },
    );
    await assert.rejects(
      record(paid(2, (body) => (body.item.tamanho_id = 'g'))),
      { code: 'STORE_ORDER_CONFLICT', statusCode: 409 },
    );
    const audits = await pool.query(
      `SELECT action, version FROM crm.audit_events
       WHERE target_id = $1 ORDER BY occurred_at, version`,
      [first.order.id],
    );
    assert.deepEqual(audits.rows, [
      { action: 'store.order.create', version: '1' },
      { action: 'store.order.receipt_attached', version: '2' },
    ]);
  });

  test('LOJ-17: concurrent first calls for one pedido_id record one order and one number', async () => {
    const startSequence = (
      await pool.query(`SELECT last_value FROM crm.order_number_seq`)
    ).rows[0].last_value;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => record(paid(3))),
    );
    const ids = new Set(results.map((result) => result.order.id));
    assert.equal(ids.size, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    const endSequence = (
      await pool.query(`SELECT last_value FROM crm.order_number_seq`)
    ).rows[0].last_value;
    assert.equal(Number(endSequence) - Number(startSequence), 1);
  });

  test('LOJ-17: one transaction_nsu pays one order, in the service and in the database', async () => {
    await record(paid(4));
    await assert.rejects(
      record(
        paid(
          5,
          (body) => (body.pagamento.transaction_nsu = 'nsu-sintetico-0004'),
        ),
      ),
      { code: 'STORE_ORDER_CONFLICT', statusCode: 409 },
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.orders SET payment_transaction_nsu = 'nsu-sintetico-0004'
         WHERE store_number = 'LJ-0001ABCD'`,
      ),
      { code: '23505' },
    );
  });

  test('LOJ-23/LOJ-09: the list finds store orders by origin, phone and LJ- number; tests are not sales', async () => {
    const previous = await repository.summary();
    const real = await record(paid(6));
    await record(
      paid(7, (body) => {
        body.teste = true;
        body.valor_centavos = 100;
        body.pagamento.valor_pago_centavos = 100;
      }),
    );
    const page = await repository.list({ limit: 50, origin: 'loja' });
    assert.ok(page.items.some((order) => order.id === real.order.id));
    assert.ok(page.items.every((order) => order.origin === 'loja'));
    const byPhone = await repository.list({
      limit: 10,
      phoneDigests: store.phoneDigestsFor('(27) 90000-0006'),
    });
    assert.deepEqual(
      byPhone.items.map((order) => order.id),
      [real.order.id],
    );
    const byNumber = await repository.list({
      limit: 10,
      storeNumber: 'LJ-0006ABCD',
    });
    assert.deepEqual(
      byNumber.items.map((order) => order.id),
      [real.order.id],
    );
    const summary = await repository.summary();
    assert.equal(summary.confirmedCount, previous.confirmedCount + 1);
    assert.equal(summary.soldAmountCents, previous.soldAmountCents + 18000);
  });

  test('LOJ-07/LOJ-21: the database itself keeps a store order confirmed and paid in full', async () => {
    const { order } = await record(paid(8));
    await assert.rejects(
      pool.query(`UPDATE crm.orders SET status = 'pendente' WHERE id = $1`, [
        order.id,
      ]),
      { code: '23514' },
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.orders SET paid_amount_cents = 17999 WHERE id = $1`,
        [order.id],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.orders SET payment_condition = 'cartao_credito'
         WHERE id = $1`,
        [order.id],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      pool.query(
        `UPDATE crm.orders SET store_number = 'LJ-123' WHERE id = $1`,
        [order.id],
      ),
      { code: '23514' },
    );
  });
}
