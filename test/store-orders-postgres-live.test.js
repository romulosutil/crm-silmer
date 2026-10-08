import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createStoreOrdersForServer } from '../apps/api/src/store-order-runtime.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { createStoreOrderService } from '../modules/orders/src/application/store-order-service.js';
import {
  STORE_NOW,
  STORE_ORIGIN,
  storeOrderBody,
} from './fixtures/store-order.js';

const connectionString = process.env.TEST_DATABASE_URL;
const ENVELOPE_KEY = Buffer.alloc(32, 61);
const HMAC_KEY = Buffer.alloc(32, 27);

/** @param {number} index */
function requestId(index) {
  return `5b0c77ed-8c90-46ce-97a4-${String(index).padStart(12, '0')}`;
}

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

  /**
   * @param {(body: any) => void} [change]
   * @param {string} [clientIp]
   */
  async function notify(change, clientIp = '203.0.113.10') {
    const body = storeOrderBody(change);
    return database.transaction((/** @type {any} */ transaction) =>
      store.create({
        bodySha256: 'b'.repeat(64),
        clientIp,
        correlationId: `correlation-${body.pedido_id}`,
        origin: STORE_ORIGIN,
        request: store.parse(body),
        transaction,
      }),
    );
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

  test('LOJ-06/LOJ-13: a store order is born confirmed with its receipt and event', async () => {
    const created = await notify();
    assert.equal(created.origin, 'loja');
    assert.equal(created.conversationId, null);
    assert.equal(created.status, 'confirmado');
    assert.equal(created.isTest, true);
    assert.equal(created.paidOn, '2026-10-07');
    assert.equal(created.orderDate, '2026-10-07');
    assert.equal(created.paymentDeclaredAt, '2026-10-08T02:15:55.693Z');
    assert.equal(created.finalAmountCents, 19364);
    assert.equal(created.paymentCondition, 'pix');
    assert.equal(created.confirmedBy, 'system:loja-do-site');
    assert.match(created.number, /^\d{2,}-CRM$/u);

    const read = await repository.findById(created.id);
    assert.equal(read?.ficha.loja?.telefone, '5527900000001');
    assert.equal(read?.ficha.summary.cliente, 'Cliente Sintetico da Loja');

    const row = (
      await pool.query('SELECT * FROM crm.orders WHERE id = $1', [created.id])
    ).rows[0];
    const receipt = (
      await pool.query(
        'SELECT * FROM crm.store_order_receipts WHERE order_id = $1',
        [created.id],
      )
    ).rows[0];
    assert.equal(receipt.request_id, storeOrderBody().pedido_id);
    assert.equal(receipt.request_origin, STORE_ORIGIN);
    assert.match(receipt.ip_digest, /^[0-9a-f]{64}$/u);
    assert.match(receipt.phone_digest, /^[0-9a-f]{64}$/u);
    for (const stored of [JSON.stringify(row), JSON.stringify(receipt)]) {
      assert.doesNotMatch(
        stored,
        /Cliente Sintetico|5527900000001|203\.0\.113\.10/u,
      );
    }
    const events = (
      await pool.query(
        `SELECT event_type, payload FROM crm.domain_events
         WHERE aggregate_type = 'order' AND aggregate_id = $1`,
        [created.id],
      )
    ).rows;
    assert.deepEqual(events, [
      {
        event_type: 'order.created',
        payload: { conversationId: null, orderId: created.id },
      },
    ]);
  });

  test('LOJ-08/LOJ-09: the list finds store orders by origin and phone; tests are not sales', async () => {
    const real = await notify((body) => {
      body.pedido_id = requestId(20);
      body.teste = false;
      body.cliente.telefone = '5527900000020';
    }, '203.0.113.20');
    const page = await repository.list({ limit: 10, origin: 'loja' });
    assert.ok(page.items.some((order) => order.id === real.id));
    assert.ok(page.items.every((order) => order.origin === 'loja'));
    const byPhone = await repository.list({
      limit: 10,
      phoneDigests: store.phoneDigestsFor('(27) 90000-0020'),
    });
    assert.deepEqual(
      byPhone.items.map((order) => order.id),
      [real.id],
    );
    const summary = await repository.summary();
    assert.equal(summary.confirmedCount, 1);
    assert.equal(summary.soldAmountCents, 19364);
    assert.equal(summary.totalPiecesSold, 10);
  });

  test('LOJ-12: the per-IP limit is counted in PostgreSQL', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await notify((body) => {
        body.pedido_id = requestId(30 + index);
        body.cliente.telefone = `55279000000${30 + index}`;
      }, '203.0.113.30');
    }
    await assert.rejects(
      notify((body) => {
        body.pedido_id = requestId(36);
        body.cliente.telefone = '5527900000036';
      }, '203.0.113.30'),
      (error) => {
        assert.equal(/** @type {any} */ (error).code, 'rate_limited');
        assert.equal(/** @type {any} */ (error).retryAfterSeconds, 3600);
        return true;
      },
    );
    const refused = await pool.query(
      'SELECT 1 FROM crm.store_order_receipts WHERE request_id = $1',
      [requestId(36)],
    );
    assert.equal(refused.rows.length, 0);
  });

  test('LOJ-02/LOJ-13: the notice, its idempotency record and its audit commit together', async () => {
    const runtime = createStoreOrdersForServer({
      database,
      environment: {
        FAB_CODE: '01',
        IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 5).toString('base64url'),
        N8N_INTEGRATION_ENVELOPE_KEY: ENVELOPE_KEY.toString('base64url'),
        STORE_ORDERS_ACCEPT_TEST: 'true',
        STORE_ORDERS_ALLOWED_ORIGINS: STORE_ORIGIN,
        STORE_ORDERS_HMAC_KEY: HMAC_KEY.toString('base64url'),
      },
    });
    assert.ok(runtime);
    const body = storeOrderBody((change) => {
      change.pedido_id = requestId(50);
      change.cliente.telefone = '5527900000050';
      // The live clock is now; the notice was declared a minute ago.
      change.pagamento.informado_pelo_cliente_em = new Date(
        Date.now() - 60_000,
      ).toISOString();
    });
    const input = {
      body,
      clientIp: '203.0.113.50',
      correlationId: 'correlation-live-50',
      idempotencyKey: body.pedido_id,
      origin: STORE_ORIGIN,
    };
    const first = await runtime.receive(input);
    const replay = await runtime.receive(input);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.numero, first.numero);
    await assert.rejects(
      runtime.receive({
        ...input,
        body: { ...body, cliente: { ...body.cliente, nome: 'Outro Nome' } },
      }),
      { code: 'idempotency_conflict', statusCode: 409 },
    );
    const records = await pool.query(
      `SELECT status, actor_id, action, target_type, target_id
       FROM crm.idempotency_records WHERE idempotency_key = $1`,
      [body.pedido_id],
    );
    assert.deepEqual(records.rows, [
      {
        action: 'store.order.create',
        actor_id: 'system:loja-do-site',
        status: 'completed',
        target_id: body.pedido_id,
        target_type: 'store_order',
      },
    ]);
    const audits = await pool.query(
      `SELECT actor_id, action FROM crm.audit_events
       WHERE target_type = 'store_order' AND target_id = $1`,
      [body.pedido_id],
    );
    assert.deepEqual(audits.rows, [
      { action: 'store.order.create', actor_id: 'system:loja-do-site' },
    ]);
    const orders = await pool.query(
      `SELECT count(*)::integer AS total FROM crm.store_order_receipts
       WHERE request_id = $1`,
      [body.pedido_id],
    );
    assert.equal(orders.rows[0].total, 1);
  });

  test('LOJ-07: the database itself refuses to turn a store order pending', async () => {
    const created = await notify((body) => {
      body.pedido_id = requestId(40);
      body.cliente.telefone = '5527900000040';
    }, '203.0.113.40');
    await assert.rejects(
      pool.query(`UPDATE crm.orders SET status = 'pendente' WHERE id = $1`, [
        created.id,
      ]),
      { code: '23514' },
    );
  });
}
