import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createOrderBillingChatRuntime } from '../apps/api/src/order-billing-chat-runtime.js';
import { createOrderBillingRuntime } from '../apps/api/src/order-billing-runtime.js';
import {
  PostgresN8nCommandOutbox,
  decryptJson,
} from '../modules/n8n-integration/src/index.js';
import {
  cancelOrder,
  KEY,
  NOW,
  SELLER,
  seed,
} from './support/order-billing-chat-fixture.js';

// LPC-01..08 (RFC 074 / ADR 098) against a real PostgreSQL: CRM link, public
// click, reservation, cancel x click race, uncertainty and late payments.
const url = process.env.TEST_DATABASE_URL;
const BASE_URL = 'https://crm.example.test';
const OTHER = { id: 'billing-other', kind: 'human' };
const ADMIN = { id: 'billing-admin', kind: 'human' };
const FINANCE = { id: 'billing-finance', kind: 'human' };
const DISABLED = { id: 'billing-disabled', kind: 'human' };
const ASSISTANT = { id: 'AUTOMATION_EXECUTOR', kind: 'automation' };
const ENV = {
  ORDER_BILLING_ENABLED: 'true',
  ORDER_BILLING_CHAT_SEND_ENABLED: 'true',
  ORDER_BILLING_CHECK_N8N_URL: 'https://automation.example.test/check',
  N8N_INTEGRATION_ENVELOPE_KEY: KEY.toString('base64'),
  IDEMPOTENCY_ENVELOPE_KEY: KEY.toString('base64'),
  INBOX_MESSAGE_ENVELOPE_KEY: KEY.toString('base64'),
  APP_BASE_URL: BASE_URL,
};
let now = NOW;

if (!url) {
  test(
    'CRM payment links require a dedicated TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  assert.match(
    new URL(url).pathname.slice(1),
    /^crm_silmer_test(?:_[a-z0-9_]+)?$/u,
    'Only dedicated synthetic databases may be reset',
  );
  const pool = new Pool({ connectionString: url, max: 12 });
  const database = {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
  const access = {
    authorizeRead: async () => ({ actor: SELLER }),
    authorizeWrite: async () => ({ actor: SELLER }),
  };
  const chat = createOrderBillingChatRuntime(database, {
    access,
    clock: () => now,
    environment: ENV,
    outboundMessageOutbox: new PostgresN8nCommandOutbox({ envelopeKey: KEY }),
  });
  /** @param {any} db @param {Record<string,string>} [environment] */
  const runtimeWith = (db, environment = ENV) =>
    createOrderBillingRuntime(db, {
      access,
      clock: () => now,
      environment,
      billingChat: chat,
    });
  const runtime = runtimeWith(database);

  /** A transaction whose queries can pause right after a matching statement.
   * @param {(sql:string)=>Promise<void>} onQuery @param {{pid:number|null}} [seen] */
  function hooked(onQuery, seen = { pid: null }) {
    return {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) =>
        withTransaction(pool, async (/** @type {any} */ client) => {
          seen.pid = (
            await client.query('SELECT pg_backend_pid() AS pid')
          ).rows[0].pid;
          const proxy = new Proxy(client, {
            get(target, property) {
              if (property === 'query')
                return async (
                  /** @type {any} */ sql,
                  /** @type {any} */ values,
                ) => {
                  const result = await target.query(sql, values);
                  await onQuery(String(sql));
                  return result;
                };
              const value = target[property];
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return work(proxy);
        }),
    };
  }
  /** @param {{pid:number|null}} seen */
  async function waitsOnAdvisory(seen) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (
        seen.pid &&
        (
          await pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting",
            [seen.pid],
          )
        ).rows[0].waiting
      )
        return true;
      await delay(10);
    }
    return false;
  }

  before(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    /** @type {[any,string][]} */
    const users = [
      [SELLER, 'Vendedor'],
      [OTHER, 'Vendedor'],
      [ADMIN, 'Vendedor'],
      [FINANCE, 'Financeiro'],
      [DISABLED, 'Vendedor'],
    ];
    for (const [actor, role] of users) {
      await pool.query(
        "INSERT INTO crm.users(id,email,password_hash,name) VALUES ($1,$2,'$argon2id$synthetic','Pessoa sintética')",
        [actor.id, `${actor.id}@example.test`],
      );
      await pool.query(
        'INSERT INTO crm.user_functions(user_id,function_name) VALUES ($1,$2)',
        [actor.id, role],
      );
    }
    await pool.query(
      "INSERT INTO crm.user_capabilities(user_id,capability,granted_by) VALUES ($1,'COMMERCIAL_ADMIN',$2)",
      [ADMIN.id, SELLER.id],
    );
    await pool.query('UPDATE crm.users SET disabled_at=$2 WHERE id=$1', [
      DISABLED.id,
      NOW,
    ]);
  });
  beforeEach(() => {
    now = NOW;
  });
  after(() => pool.end());

  /** @param {number} [amount] */
  async function order(amount = 10000) {
    const id = await seed(pool, { conversation: true, amount });
    await pool.query(
      "UPDATE crm.conversations SET automation_state='human',state='em_atendimento',inbound_revision=1 WHERE id=(SELECT conversation_id FROM crm.orders WHERE id=$1)",
      [id],
    );
    return id;
  }
  /** @param {string} orderId */
  async function view(orderId) {
    return (await runtime.get({ actor: SELLER, orderId })).billing;
  }
  /** @param {string} orderId @param {any} [extra] */
  async function command(orderId, extra = {}) {
    const billing = await view(orderId);
    return {
      actor: SELLER,
      orderId,
      expectedVersion: billing.orderVersion,
      expectedBillingVersion: billing.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      ...extra,
    };
  }
  /** @param {string} orderId @param {number} amountCents @param {any} [extra] */
  async function createLink(orderId, amountCents, extra = {}) {
    const result = await runtime.createLink(
      await command(orderId, { amountCents, percent: 50, ...extra }),
    );
    return result.billing.links.find(
      (/** @type {any} */ l) => l.id === result.linkId,
    );
  }
  /** @param {any} link */
  const tokenOf = (link) => link.url.split('/pagar/')[1];
  /** @param {string} linkId */
  async function charges(linkId) {
    return (
      await pool.query(
        'SELECT * FROM crm.order_billing_charges WHERE link_id=$1 ORDER BY created_sequence',
        [linkId],
      )
    ).rows;
  }
  /** @param {string} linkId */
  async function linkRow(linkId) {
    return (
      await pool.query('SELECT * FROM crm.order_billing_links WHERE id=$1', [
        linkId,
      ])
    ).rows[0];
  }
  /** Worker -> n8n -> reserve/created callbacks, as the existing path does.
   * @param {string} chargeId */
  async function open(chargeId) {
    const executionId = randomUUID();
    const reserved = await runtime.reserve({
      chargeId,
      executionId,
      correlationId: randomUUID(),
    });
    assert.equal(reserved.allowed, true);
    await runtime.created({
      chargeId,
      executionId,
      checkoutUrl: `https://checkout.infinitepay.io/synthetic-${chargeId}`,
      correlationId: randomUUID(),
    });
    return executionId;
  }
  /** @param {string} chargeId @param {number} amountCents @param {string} [nsu] */
  function pay(chargeId, amountCents, nsu = randomUUID()) {
    return runtime.payment({
      chargeId,
      transactionNsu: nsu,
      invoiceSlug: `slug-${nsu}`,
      amountCents,
      paidAmountCents: amountCents,
      method: 'pix',
      installments: 1,
      receiptUrl: null,
      correlationId: randomUUID(),
    });
  }

  test('LPC-01/02: a generated link creates nothing at the provider; the public page shows only order, kind and amount', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    assert.equal(link.kind, 'signal');
    assert.equal(link.state, 'open');
    assert.equal(link.origin, 'generated');
    assert.match(
      link.url,
      /^https:\/\/crm\.example\.test\/pagar\/[0-9A-Z]{26}$/u,
    );
    const token = tokenOf(link);
    const row = await linkRow(link.id);
    assert.equal(JSON.stringify(row.token_envelope).includes(token), false);
    assert.equal((await charges(link.id)).length, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.outbox_jobs WHERE job_type='billing.checkout.create'",
        )
      ).rows[0].n,
      0,
    );
    const page = await runtime.publicLink({ token });
    const number = (
      await pool.query('SELECT number FROM crm.orders WHERE id=$1', [orderId])
    ).rows[0].number;
    assert.deepEqual(page, {
      state: 'ready',
      orderNumber: number,
      kind: 'signal',
      amountCents: 5000,
    });
    assert.ok((await linkRow(link.id)).page_opened_at);
    assert.equal(
      (await runtime.publicLink({ token: token.toLowerCase() })).state,
      'ready',
    );
    const before = await view(orderId);
    const figures = before.figures;
    assert.deepEqual(figures, {
      totalCents: 10000,
      receivedCents: 0,
      remainingCents: 10000,
      heldCents: 0,
      reservedCents: 5000,
      freeCents: 5000,
    });
    assert.equal(before.situation, 'waiting');
    assert.equal(before.canOperate, true);
    assert.equal(before.ownerName, 'Pessoa sintética');
    assert.deepEqual(
      before.links[0].history.map((/** @type {any} */ h) => h.kind),
      ['created', 'page_opened'],
    );
    // Uniform answer: missing, malformed and cancelled tokens are identical.
    await runtime.cancelLink(await command(orderId, { linkId: link.id }));
    const answers = await Promise.all(
      [token, 'Z'.repeat(26), 'short', '../../etc', ''].map((value) =>
        runtime.publicLink({ token: value }),
      ),
    );
    for (const answer of answers)
      assert.deepEqual(answer, { state: 'unavailable' });
    assert.deepEqual(await runtime.publicCheckout({ token }), {
      statusCode: 200,
      body: { state: 'unavailable' },
    });
    assert.equal((await charges(link.id)).length, 0);
  });

  test('LPC decision 10: with only receiving enabled the page reads but a click creates nothing', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    const receiving = runtimeWith(database, {
      ...ENV,
      ORDER_BILLING_ENABLED: 'false',
      ORDER_BILLING_RECEIVE_ENABLED: 'true',
    });
    const token = tokenOf(link);
    assert.equal((await receiving.publicLink({ token })).state, 'ready');
    const answer = await receiving.publicCheckout({ token });
    assert.equal(answer.statusCode, 200);
    assert.equal(answer.body.state, 'failed');
    assert.equal((await charges(link.id)).length, 0);
    assert.equal((await linkRow(link.id)).state, 'open');
    // An attempt that already exists is still returned.
    assert.equal((await runtime.publicCheckout({ token })).statusCode, 202);
    assert.equal(
      (await receiving.publicCheckout({ token })).body.state,
      'in_progress',
    );
  });

  test('LPC-03: owner or administrator cancel; other seller, Financeiro, agent and disabled user are refused', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 4000);
    for (const actor of [OTHER, FINANCE, ASSISTANT, DISABLED])
      await assert.rejects(
        runtime.cancelLink(await command(orderId, { linkId: link.id, actor })),
        (/** @type {any} */ error) =>
          ['FORBIDDEN', 'ORDER_NOT_FOUND'].includes(error.code) &&
          [403, 404].includes(error.statusCode),
      );
    const other = (await runtime.get({ actor: OTHER, orderId })).billing;
    assert.equal(other.canOperate, false);
    assert.equal(other.links[0].url, null);
    assert.equal(other.links[0].chargeId, null);
    assert.equal(other.figures.reservedCents, 4000);
    const admin = await runtime.cancelLink(
      await command(orderId, { linkId: link.id, actor: ADMIN }),
    );
    const cancelled = admin.billing.links[0];
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.cancelReason, 'seller');
    assert.equal(cancelled.url, null);
    assert.equal(admin.billing.figures.reservedCents, 0);
    // A clicked link is a conflict that names its state and click instant.
    const clicked = await createLink(orderId, 3000);
    const answer = await runtime.publicCheckout({ token: tokenOf(clicked) });
    assert.equal(answer.statusCode, 202);
    await assert.rejects(
      runtime.cancelLink(await command(orderId, { linkId: clicked.id })),
      (/** @type {any} */ error) =>
        error.code === 'BILLING_LINK_NOT_OPEN' &&
        error.details.state === 'checkout_requested' &&
        error.details.clickedAt === NOW.toISOString(),
    );
  });

  for (const winner of ['click', 'cancel'])
    test(`LPC-04: cancel and click race on the same lock; ${winner} first wins alone`, async () => {
      const orderId = await order(10000);
      const link = await createLink(orderId, 6000);
      const token = tokenOf(link);
      const cancelInput = await command(orderId, { linkId: link.id });
      const paused = Promise.withResolvers();
      const release = Promise.withResolvers();
      let held = false;
      const first = hooked(async (sql) => {
        if (
          !held &&
          sql.includes(
            "pg_advisory_xact_lock(hashtextextended('billing-send-order:'",
          )
        ) {
          held = true;
          paused.resolve(undefined);
          await release.promise;
        }
      });
      const seen = { pid: null };
      const second = hooked(async () => {}, seen);
      const firstRuntime = runtimeWith(first);
      const secondRuntime = runtimeWith(second);
      /** @type {(promise:Promise<any>)=>Promise<any>} */
      const settle = (promise) =>
        promise.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      const leading =
        winner === 'click'
          ? settle(firstRuntime.publicCheckout({ token }))
          : settle(firstRuntime.cancelLink(cancelInput));
      await paused.promise;
      const trailing =
        winner === 'click'
          ? settle(secondRuntime.cancelLink(cancelInput))
          : settle(secondRuntime.publicCheckout({ token }));
      try {
        assert.equal(
          await waitsOnAdvisory(seen),
          true,
          'The second writer must wait on the order fence held by the first',
        );
      } finally {
        release.resolve(undefined);
      }
      const [a, b] = await Promise.all([leading, trailing]);
      const attempts = await charges(link.id);
      if (winner === 'click') {
        assert.equal(a.value.statusCode, 202);
        assert.equal(b.error.code, 'BILLING_LINK_NOT_OPEN');
        assert.equal(b.error.details.state, 'checkout_requested');
        assert.equal((await linkRow(link.id)).state, 'checkout_requested');
        assert.equal(attempts.length, 1);
      } else {
        assert.equal(a.value.billing.links[0].state, 'cancelled');
        assert.deepEqual(b.value, {
          statusCode: 200,
          body: { state: 'unavailable' },
        });
        assert.equal((await linkRow(link.id)).state, 'cancelled');
        assert.equal(attempts.length, 0);
      }
      // The database itself refuses the losing transition afterwards.
      await assert.rejects(
        pool.query(
          winner === 'click'
            ? "UPDATE crm.order_billing_links SET state='cancelled',cancel_reason='seller',cancelled_at=now(),cancelled_by='billing-seller',version=version+1 WHERE id=$1"
            : "UPDATE crm.order_billing_links SET state='open',cancel_reason=NULL,cancelled_at=NULL,version=version+1 WHERE id=$1",
          [link.id],
        ),
        { code: '23514' },
      );
    });

  test('LPC-05: repeated clicks and callback redelivery make one valid payment', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 10000);
    assert.equal(link.kind, 'full');
    const token = tokenOf(link);
    const clicks = await Promise.all(
      Array.from({ length: 5 }, () => runtime.publicCheckout({ token })),
    );
    assert.equal(clicks.filter((c) => c.statusCode === 202).length, 1);
    assert.ok(clicks.every((c) => c.body.state === 'in_progress'));
    const [attempt] = await charges(link.id);
    assert.equal((await charges(link.id)).length, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.outbox_jobs WHERE job_type='billing.checkout.create' AND idempotency_key=$1",
          [attempt.id],
        )
      ).rows[0].n,
      1,
    );
    const executionId = await open(attempt.id);
    assert.equal(
      (
        await runtime.reserve({
          chargeId: attempt.id,
          executionId: randomUUID(),
          correlationId: randomUUID(),
        })
      ).allowed,
      false,
    );
    await runtime.created({
      chargeId: attempt.id,
      executionId,
      checkoutUrl: `https://checkout.infinitepay.io/synthetic-${attempt.id}`,
      correlationId: randomUUID(),
    });
    const page = await runtime.publicCheckout({ token });
    assert.equal(
      page.body.checkoutUrl,
      `https://checkout.infinitepay.io/synthetic-${attempt.id}`,
    );
    const nsu = randomUUID();
    const first = await pay(attempt.id, 10000, nsu);
    const again = await pay(attempt.id, 10000, nsu);
    assert.equal(first.reviewRequired, false);
    assert.equal(again.duplicate, true);
    const settled = await view(orderId);
    assert.equal(settled.figures.receivedCents, 10000);
    assert.equal(settled.situation, 'settled');
    assert.equal(settled.links[0].state, 'paid');
    assert.ok(settled.settledAt);
    assert.equal((await runtime.publicLink({ token })).state, 'paid');
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM crm.order_billing_payments p JOIN crm.order_billing_charges c ON c.id=p.charge_id WHERE c.order_id=$1',
          [orderId],
        )
      ).rows[0].n,
      1,
    );
    // Owner-only receipt reference; another seller sees none.
    assert.equal(settled.links[0].invoiceCode, `slug-${nsu}`);
    assert.equal(settled.payments[0].invoiceCode, `slug-${nsu}`);
    const other = (await runtime.get({ actor: OTHER, orderId })).billing;
    assert.equal(other.links[0].invoiceCode, null);
    assert.equal(other.payments[0].invoiceCode, null);
    // G: no attempt identifier reaches a non-owner.
    assert.equal(other.charges[0].id, null);
    assert.equal(other.payments[0].chargeId, null);
    const refunded = await runtime.refund(
      await command(orderId, { chargeId: attempt.id, amountCents: 1500 }),
    );
    assert.deepEqual(refunded.billing.review, {
      reason: 'refund',
      previousTotalCents: null,
      heldCents: 0,
      refundedCents: 1500,
    });
    assert.equal(refunded.billing.links[0].refundedCents, 1500);
    assert.ok(
      refunded.billing.links[0].history.some(
        (/** @type {any} */ h) => h.kind === 'refund',
      ),
    );
  });

  test('LPC-05/decision 11: an uncertain attempt locks and reserves the link until the owner confirms the result', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 4000);
    const token = tokenOf(link);
    await runtime.publicCheckout({ token });
    const [attempt] = await charges(link.id);
    await runtime.reserve({
      chargeId: attempt.id,
      executionId: randomUUID(),
      correlationId: randomUUID(),
    });
    now = new Date(NOW.getTime() + 121000);
    const uncertain = await view(orderId);
    assert.equal(uncertain.links[0].state, 'unknown');
    assert.equal(uncertain.situation, 'unknown');
    assert.equal(uncertain.figures.reservedCents, 4000);
    assert.deepEqual(
      (await runtime.publicCheckout({ token })).body.state,
      'failed',
    );
    assert.equal((await charges(link.id)).length, 1);
    await assert.rejects(
      runtime.confirmLinkResult(await command(orderId, { linkId: link.id })),
      { code: 'BILLING_LINK_STILL_VALID' },
    );
    // Not by expiry alone: a day later it is still unknown and reserved.
    now = new Date(NOW.getTime() + 25 * 3600000);
    assert.equal((await view(orderId)).links[0].state, 'unknown');
    // With provider identifiers it queues the existing n8n payment check.
    const checked = await runtime.confirmLinkResult(
      await command(orderId, {
        linkId: link.id,
        invoiceSlug: 'synthetic-slug',
        transactionNsu: 'synthetic-nsu',
      }),
    );
    assert.equal(checked.check.state, 'queued');
    const outsider = (await runtime.get({ actor: OTHER, orderId })).billing;
    assert.equal(outsider.paymentChecks[0].id, null);
    assert.equal(outsider.paymentChecks[0].chargeId, null);
    assert.equal(outsider.links[0].verifying.checkId, null);
    await runtime.paymentCheckResult({
      checkId: checked.check.checkId,
      status: 'not_paid',
      correlationId: randomUUID(),
    });
    const released = await view(orderId);
    assert.equal(released.links[0].state, 'open');
    assert.ok(
      released.links[0].history.some(
        (/** @type {any} */ h) => h.kind === 'checkout_expired',
      ),
    );
    // The next click is a new attempt.
    assert.equal((await runtime.publicCheckout({ token })).statusCode, 202);
    const attempts = await charges(link.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'closed');
  });

  test('LPC-06: concurrent link creations and an external receipt never exceed what is still owed', async () => {
    const orderId = await order(10000);
    await createLink(orderId, 1000);
    /** @param {()=>Promise<any>} attempt @returns {Promise<any>} */
    async function retrying(attempt) {
      for (;;) {
        try {
          return { value: await attempt() };
        } catch (error) {
          if (/** @type {any} */ (error).code !== 'VERSION_CONFLICT')
            return { error };
        }
      }
    }
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        retrying(async () =>
          runtime.createLink(await command(orderId, { amountCents: 3000 })),
        ),
      ),
      retrying(async () =>
        runtime.recordExternal(
          await command(orderId, {
            amountCents: 2500,
            receivedOn: '2026-11-05',
            method: 'cash',
            note: 'Recebimento sintético',
          }),
        ),
      ),
    ]);
    const failures = results.filter((r) => r.error);
    assert.ok(failures.length >= 1);
    for (const failure of failures)
      assert.ok(
        ['BILLING_LINK_EXCEEDS_FREE', 'BILLING_RECEIPT_EXCEEDS_FREE'].includes(
          failure.error.code,
        ),
        failure.error.code,
      );
    const final = await view(orderId);
    assert.ok(
      final.figures.reservedCents + final.figures.receivedCents <= 10000,
    );
    const sum = (
      await pool.query(
        `SELECT coalesce(sum(amount_cents),0)::int AS n FROM crm.order_billing_links
         WHERE order_id=$1 AND state IN ('open','checkout_requested','checkout_open','unknown')`,
        [orderId],
      )
    ).rows[0].n;
    assert.equal(sum, final.figures.reservedCents);
  });

  test('LPC-06/decision 12: an external receipt takes only the free amount or cancels listed open links', async () => {
    const orderId = await order(10000);
    const open = await createLink(orderId, 6000);
    const external = (/** @type {number} */ amountCents, extra = {}) =>
      command(orderId, {
        amountCents,
        receivedOn: '2026-11-05',
        method: 'pix_external',
        note: 'Recebimento sintético',
        ...extra,
      });
    await assert.rejects(runtime.recordExternal(await external(5000)), {
      code: 'BILLING_RECEIPT_EXCEEDS_FREE',
    });
    await assert.rejects(runtime.recordExternal(await external(10001)), {
      code: 'BILLING_INVALID_AMOUNT',
    });
    const done = await runtime.recordExternal(
      await external(5000, { cancelLinkIds: [open.id] }),
    );
    assert.equal(done.billing.figures.receivedCents, 5000);
    const cancelled = done.billing.links.find(
      (/** @type {any} */ l) => l.id === open.id,
    );
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.cancelReason, 'external_receipt');
    // Money in a link being paid cannot be taken; a stale list is refused.
    const paying = await createLink(orderId, 5000);
    await runtime.publicCheckout({ token: tokenOf(paying) });
    await assert.rejects(runtime.recordExternal(await external(1000)), {
      code: 'BILLING_LINK_IN_PAYMENT',
    });
    await assert.rejects(
      runtime.recordExternal(
        await external(1000, { cancelLinkIds: [paying.id] }),
      ),
      (/** @type {any} */ error) =>
        error.code === 'BILLING_LINK_NOT_OPEN' &&
        error.details.state === 'checkout_requested',
    );
    const [attempt] = await charges(paying.id);
    await runtime.reserve({
      chargeId: attempt.id,
      executionId: randomUUID(),
      correlationId: randomUUID(),
    });
    now = new Date(NOW.getTime() + 121000);
    await assert.rejects(runtime.recordExternal(await external(1000)), {
      code: 'BILLING_LINK_UNKNOWN',
    });
    assert.equal((await linkRow(paying.id)).state, 'unknown');
  });

  test('LPC-07: several links and an external receipt add up to settlement; cancelled links stay out', async () => {
    const orderId = await order(10000);
    const first = await createLink(orderId, 4000);
    assert.equal(first.kind, 'installment');
    await runtime.publicCheckout({ token: tokenOf(first) });
    const [a] = await charges(first.id);
    await open(a.id);
    await pay(a.id, 4000);
    const dropped = await createLink(orderId, 3000);
    await runtime.cancelLink(await command(orderId, { linkId: dropped.id }));
    const third = await createLink(orderId, 3000);
    await runtime.publicCheckout({ token: tokenOf(third) });
    const [c] = await charges(third.id);
    await open(c.id);
    await pay(c.id, 3000);
    const partial = await view(orderId);
    assert.equal(partial.situation, 'partial');
    assert.equal(partial.figures.freeCents, 3000);
    const settled = await runtime.recordExternal(
      await command(orderId, {
        amountCents: 3000,
        receivedOn: '2026-11-05',
        method: 'cash',
        note: 'Recebimento sintético',
      }),
    );
    const billing = settled.billing;
    assert.equal(billing.figures.receivedCents, 10000);
    assert.equal(billing.figures.remainingCents, 0);
    assert.equal(billing.figures.reservedCents, 0);
    assert.equal(billing.situation, 'settled');
    assert.deepEqual(
      billing.links.map((/** @type {any} */ l) => l.state),
      ['paid', 'cancelled', 'paid'],
    );
    assert.ok(
      (
        await pool.query('SELECT paid_on FROM crm.orders WHERE id=$1', [
          orderId,
        ])
      ).rows[0].paid_on,
    );
  });

  test('LPC-08: payments of expired or cancelled attempts go to review and never settle silently', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    const token = tokenOf(link);
    await runtime.publicCheckout({ token });
    const [expired] = await charges(link.id);
    await open(expired.id);
    now = new Date(NOW.getTime() + 25 * 3600000);
    const reopened = await view(orderId);
    assert.equal(reopened.links[0].state, 'open');
    assert.equal(reopened.links[0].clickedAt, null);
    assert.equal(
      (
        await pool.query(
          'SELECT status FROM crm.order_billing_charges WHERE id=$1',
          [expired.id],
        )
      ).rows[0].status,
      'closed',
    );
    await runtime.cancelLink(await command(orderId, { linkId: link.id }));
    const late = await pay(expired.id, 5000);
    assert.equal(late.reviewRequired, true);
    const reviewed = await view(orderId);
    assert.equal(reviewed.situation, 'review');
    assert.equal(reviewed.review.reason, 'late_payment');
    assert.equal(reviewed.review.heldCents, 5000);
    assert.equal(reviewed.figures.receivedCents, 0);
    assert.equal(reviewed.links[0].state, 'cancelled');
    assert.equal(reviewed.links[0].inReview, true);
    assert.equal(
      (
        await pool.query('SELECT paid_on FROM crm.orders WHERE id=$1', [
          orderId,
        ])
      ).rows[0].paid_on,
      null,
    );
    // Expiry then a new click is a new attempt.
    const other = await order(10000);
    const again = await createLink(other, 5000);
    now = NOW;
    await runtime.publicCheckout({ token: tokenOf(again) });
    const [one] = await charges(again.id);
    await open(one.id);
    now = new Date(NOW.getTime() + 25 * 3600000);
    assert.equal(
      (await runtime.publicLink({ token: tokenOf(again) })).state,
      'ready',
    );
    assert.equal(
      (await runtime.publicCheckout({ token: tokenOf(again) })).statusCode,
      202,
    );
    assert.equal((await charges(again.id)).length, 2);
  });

  test('LPC decision 5: an order value change cancels open links and sends clicked ones to review', async () => {
    const orderId = await order(10000);
    const idle = await createLink(orderId, 3000);
    const clicked = await createLink(orderId, 4000);
    await runtime.publicCheckout({ token: tokenOf(clicked) });
    const [attempt] = await charges(clicked.id);
    await open(attempt.id);
    await pool.query(
      'UPDATE crm.orders SET final_amount_cents=12000,version=version+1,updated_at=$2 WHERE id=$1',
      [orderId, NOW],
    );
    const changed = await view(orderId);
    const idleView = changed.links.find(
      (/** @type {any} */ l) => l.id === idle.id,
    );
    assert.equal(idleView.state, 'cancelled');
    assert.equal(idleView.cancelReason, 'order_changed');
    assert.equal(
      changed.links.find((/** @type {any} */ l) => l.id === clicked.id).state,
      'checkout_open',
    );
    assert.equal(changed.situation, 'review');
    assert.deepEqual(changed.review, {
      reason: 'order_changed',
      previousTotalCents: 10000,
      heldCents: 0,
      refundedCents: null,
    });
    assert.equal(
      (await runtime.publicLink({ token: tokenOf(idle) })).state,
      'unavailable',
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.audit_events WHERE target_type='billing-link' AND target_id=$1 AND reason='BILLING_LINK_ORDER_CHANGED'",
          [idle.id],
        )
      ).rows[0].n,
      1,
    );
    const paid = await pay(attempt.id, 4000);
    assert.equal(paid.reviewRequired, true);
    assert.equal((await view(orderId)).review.reason, 'order_changed');
    // Decision 8: applying payments works with the evidence held.
    const applied = await runtime.reconcile(
      await command(orderId, {
        decision: 'apply_current',
        confirmedProviderReview: true,
      }),
    );
    assert.equal(applied.billing.review, null);
    assert.equal(applied.billing.figures.receivedCents, 4000);
    assert.equal(applied.billing.figures.totalCents, 12000);
  });

  test('LPC-01: the conversation message carries the CRM link and the legacy issue stays blocked while links are open', async () => {
    const orderId = await order(12000);
    const conversation = (
      await pool.query(
        'SELECT o.version,c.id,c.version AS cv FROM crm.orders o JOIN crm.conversations c ON c.id=o.conversation_id WHERE o.id=$1',
        [orderId],
      )
    ).rows[0];
    const intent = await chat.submit({
      actor: SELLER,
      orderId,
      action: 'issue_link',
      amountCents: 6000,
      percent: 50,
      conversationId: conversation.id,
      expectedVersion: Number(conversation.version),
      expectedBillingVersion: 0,
      expectedConversationVersion: Number(conversation.cv),
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    });
    assert.equal(intent.state, 'queued');
    assert.equal(intent.chargeId, null);
    assert.ok(intent.linkId);
    const read = await chat.getIntent({
      actor: SELLER,
      orderId,
      intentId: intent.id,
    });
    assert.equal(read.linkId, intent.linkId);
    assert.equal(read.action, 'issue_link');
    const message = (
      await pool.query('SELECT * FROM crm.messages WHERE id=$1', [
        intent.messageId,
      ])
    ).rows[0];
    const text = decryptJson(
      message.content_envelope,
      `message:${message.id}`,
      KEY,
    ).text;
    assert.match(
      text,
      /— sinal de R\$\s?60,00\. Link para pagamento: https:\/\/crm\.example\.test\/pagar\/[0-9A-Z]{26}$/u,
    );
    assert.doesNotMatch(text, /infinitepay/iu);
    assert.equal((await charges(intent.linkId)).length, 0);
    const billing = await view(orderId);
    assert.equal(billing.links[0].origin, 'sent');
    assert.equal(billing.blockedReason, 'BILLING_ACTIVE_CHARGE');
    await assert.rejects(
      runtime.issue(await command(orderId, { percent: 50 })),
      { code: 'BILLING_ACTIVE_CHARGE' },
    );
  });

  test('QA-A: close_unpaid after an order change releases the clicked link instead of reserving forever', async () => {
    const orderId = await order(10000);
    const clicked = await createLink(orderId, 4000);
    await runtime.publicCheckout({ token: tokenOf(clicked) });
    const [attempt] = await charges(clicked.id);
    await open(attempt.id);
    await pool.query(
      'UPDATE crm.orders SET final_amount_cents=12000,version=version+1,updated_at=$2 WHERE id=$1',
      [orderId, NOW],
    );
    const result = await runtime.reconcile(
      await command(orderId, {
        decision: 'close_unpaid',
        confirmedProviderReview: true,
      }),
    );
    const billing = result.billing;
    assert.equal(billing.review, null);
    assert.equal(billing.figures.reservedCents, 0);
    assert.equal(billing.figures.freeCents, 12000);
    assert.equal(billing.links[0].state, 'cancelled');
    assert.equal(billing.links[0].cancelReason, 'order_changed');
    assert.deepEqual(
      (await charges(clicked.id)).map((c) => c.status),
      ['closed'],
    );
    assert.equal(
      (await runtime.publicLink({ token: tokenOf(clicked) })).state,
      'unavailable',
    );
    now = new Date(NOW.getTime() + 30 * 86400000);
    assert.equal((await view(orderId)).situation, 'none');
    // A late payment of that attempt still goes to conferência.
    assert.equal((await pay(attempt.id, 4000)).reviewRequired, true);
  });

  test('QA-B: a paid link keeps no other live attempt; a second payment is held for review', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    await runtime.publicCheckout({ token: tokenOf(link) });
    const [a] = await charges(link.id);
    await open(a.id);
    now = new Date(NOW.getTime() + 25 * 3600000);
    assert.equal(
      (await runtime.publicCheckout({ token: tokenOf(link) })).statusCode,
      202,
    );
    const [, b] = await charges(link.id);
    await open(b.id);
    assert.equal((await pay(a.id, 5000)).reviewRequired, true);
    const held = await view(orderId);
    assert.equal(held.links[0].state, 'paid');
    assert.equal(held.figures.reservedCents, 0);
    assert.deepEqual(
      (await charges(link.id)).map((c) => c.status),
      ['review', 'review'],
    );
    const second = await pay(b.id, 5000);
    assert.equal(second.reviewRequired, true);
    // Unpaid duplicate: apply closes it rather than reviving it.
    const other = await order(10000);
    const dup = await createLink(other, 5000);
    now = NOW;
    await runtime.publicCheckout({ token: tokenOf(dup) });
    const [x] = await charges(dup.id);
    await open(x.id);
    now = new Date(NOW.getTime() + 25 * 3600000);
    await runtime.publicCheckout({ token: tokenOf(dup) });
    const [, y] = await charges(dup.id);
    await open(y.id);
    await pay(x.id, 5000);
    const applied = await runtime.reconcile(
      await command(other, {
        decision: 'apply_current',
        confirmedProviderReview: true,
      }),
    );
    assert.equal(applied.billing.review, null);
    assert.equal(applied.billing.figures.receivedCents, 5000);
    assert.deepEqual(
      (await charges(dup.id)).map((c) => c.status),
      ['paid', 'closed'],
    );
    now = new Date(NOW.getTime() + 30 * 86400000);
    const later = await view(other);
    assert.notEqual(later.blockedReason, 'BILLING_REVIEW_REQUIRED');
    assert.equal(later.figures.freeCents, 5000);
    assert.equal((await createLink(other, 5000)).state, 'open');
  });

  test('QA-D: apply_current refuses when received money plus every reserving link passes the total', async () => {
    const orderId = await order(10000);
    const x = await createLink(orderId, 5000);
    await runtime.publicCheckout({ token: tokenOf(x) });
    const [xa] = await charges(x.id);
    await open(xa.id);
    now = new Date(NOW.getTime() + 25 * 3600000);
    await view(orderId);
    await runtime.cancelLink(await command(orderId, { linkId: x.id }));
    const y = await createLink(orderId, 6000);
    await runtime.publicCheckout({ token: tokenOf(y) });
    const [ya] = await charges(y.id);
    await open(ya.id);
    await pay(xa.id, 5000);
    await assert.rejects(
      runtime.reconcile(
        await command(orderId, {
          decision: 'apply_current',
          confirmedProviderReview: true,
        }),
      ),
      { code: 'BILLING_LINK_EXCEEDS_FREE' },
    );
    // Decision 8 still holds when it fits: apply with a link in payment.
    const fits = await order(10000);
    const paidLink = await createLink(fits, 3000);
    await runtime.publicCheckout({ token: tokenOf(paidLink) });
    const [pa] = await charges(paidLink.id);
    await open(pa.id);
    await pay(pa.id, 3000);
    const paying = await createLink(fits, 4000);
    await runtime.publicCheckout({ token: tokenOf(paying) });
    const [pb] = await charges(paying.id);
    await open(pb.id);
    await runtime.refund(
      await command(fits, { chargeId: pa.id, amountCents: 1000 }),
    );
    const applied = await runtime.reconcile(
      await command(fits, {
        decision: 'apply_current',
        confirmedProviderReview: true,
      }),
    );
    assert.equal(applied.billing.review, null);
    assert.equal(
      applied.billing.links.find((/** @type {any} */ l) => l.id === paying.id)
        .state,
      'checkout_open',
    );
  });

  test('QA-E: cancelling the order cancels its open links with history and audit', async () => {
    const orderId = await order(10000);
    const idle = await createLink(orderId, 3000);
    const clicked = await createLink(orderId, 4000);
    await runtime.publicCheckout({ token: tokenOf(clicked) });
    await cancelOrder(pool, orderId);
    const idleRow = await linkRow(idle.id);
    assert.equal(idleRow.state, 'cancelled');
    assert.equal(idleRow.cancel_reason, 'order_cancelled');
    assert.equal((await linkRow(clicked.id)).state, 'checkout_requested');
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.order_billing_link_events WHERE link_id=$1 AND kind='cancelled' AND reason='order_cancelled'",
          [idle.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM crm.audit_events WHERE target_id=$1 AND reason='BILLING_LINK_ORDER_CANCELLED'",
          [idle.id],
        )
      ).rows[0].n,
      1,
    );
    for (const link of [idle, clicked])
      assert.deepEqual(await runtime.publicLink({ token: tokenOf(link) }), {
        state: 'unavailable',
      });
  });

  test('QA-F: a page poll neither waits on nor writes the order locks once nothing is due', async () => {
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    const token = tokenOf(link);
    await runtime.publicLink({ token });
    const version = (await linkRow(link.id)).version;
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM crm.orders WHERE id=$1 FOR UPDATE', [
        orderId,
      ]);
      const page = await Promise.race([
        runtime.publicLink({ token }),
        delay(2000).then(() => 'blocked'),
      ]);
      assert.notEqual(page, 'blocked');
      assert.equal(/** @type {any} */ (page).state, 'ready');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    assert.equal((await linkRow(link.id)).version, version);
  });

  for (const rival of ['link', 'external receipt'])
    test(`QA-I/LPC-06: a link creation and a concurrent ${rival} on the same version overlap on the lock; exactly one wins`, async () => {
      const orderId = await order(10000);
      const first = await command(orderId, {
        amountCents: 7000,
        percent: 50,
      });
      const second =
        rival === 'link'
          ? { ...first, idempotencyKey: randomUUID(), amountCents: 6000 }
          : {
              ...first,
              idempotencyKey: randomUUID(),
              amountCents: 6000,
              receivedOn: '2026-11-05',
              method: 'cash',
              note: 'Recebimento sintético',
            };
      const paused = Promise.withResolvers();
      const release = Promise.withResolvers();
      let held = false;
      const leading = runtimeWith(
        hooked(async (sql) => {
          if (
            !held &&
            sql.includes(
              "pg_advisory_xact_lock(hashtextextended('billing-send-order:'",
            )
          ) {
            held = true;
            paused.resolve(undefined);
            await release.promise;
          }
        }),
      );
      const seen = { pid: null };
      const trailing = runtimeWith(hooked(async () => {}, seen));
      /** @type {(promise:Promise<any>)=>Promise<any>} */
      const settle = (promise) =>
        promise.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      const a = settle(leading.createLink(first));
      await paused.promise;
      const b = settle(
        rival === 'link'
          ? trailing.createLink(second)
          : trailing.recordExternal(second),
      );
      try {
        assert.equal(await waitsOnAdvisory(seen), true);
      } finally {
        release.resolve(undefined);
      }
      const results = await Promise.all([a, b]);
      assert.equal(results.filter((r) => r.value).length, 1);
      assert.equal(results[0].value?.billing.links.length, 1);
      assert.ok(
        [
          'VERSION_CONFLICT',
          'BILLING_LINK_EXCEEDS_FREE',
          'BILLING_RECEIPT_EXCEEDS_FREE',
        ].includes(results[1].error.code),
      );
      const final = await view(orderId);
      assert.ok(
        final.figures.reservedCents + final.figures.receivedCents <= 10000,
      );
      assert.equal(final.figures.reservedCents, 7000);
      assert.equal(final.figures.receivedCents, 0);
    });

  test('LPC-02 over HTTP with the real runtime: long, extended and undecodable tokens answer like an unknown one, write nothing and log no token', async (t) => {
    const { createApi } = await import('../apps/api/src/app.js');
    const { createSafeLogger, MetricRegistry } =
      await import('../modules/shared/src/index.js');
    /** @type {Array<Record<string, unknown>>} */
    const records = [];
    const logger = createSafeLogger({
      service: 'crm-silmer-api',
      sink: (record) => records.push(record),
    });
    const api = createApi(
      {},
      { logger, metrics: new MetricRegistry({ logger }), billing: runtime },
    );
    t.after(() => api.close());
    const orderId = await order(10000);
    const link = await createLink(orderId, 5000);
    const token = tokenOf(link);
    const events = async () =>
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM crm.order_billing_link_events WHERE link_id=$1',
          [link.id],
        )
      ).rows[0].n;
    const before = await events();
    const unknown = await api.inject({
      url: `/api/v1/payment-links/${'Z'.repeat(26)}`,
      remoteAddress: '10.230.0.1',
    });
    assert.equal(unknown.statusCode, 200);
    assert.equal(unknown.body, '{"state":"unavailable"}');
    const unknownClick = await api.inject({
      method: 'POST',
      url: `/api/v1/payment-links/${'Z'.repeat(26)}/checkout`,
      headers: { origin: BASE_URL },
      remoteAddress: '10.230.0.2',
    });
    let address = 2;
    // The real token extended past 100 characters, or broken by a bad escape,
    // is a different (malformed) token: same answer, no page_opened, no click.
    for (const path of [
      `${token}${'0'.repeat(200)}`,
      `${token}${'0'.repeat(5000)}`,
      `${token}%zz`,
      `${token}/x`,
    ]) {
      address += 1;
      const read = await api.inject({
        url: `/api/v1/payment-links/${path}`,
        remoteAddress: `10.230.0.${address}`,
      });
      assert.equal(read.statusCode, 200, path.slice(0, 40));
      assert.equal(read.body, unknown.body);
      assert.equal(read.headers['cache-control'], 'no-store');
      assert.equal(read.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal(read.headers['referrer-policy'], 'no-referrer');
      const click = await api.inject({
        method: 'POST',
        url: `/api/v1/payment-links/${path}/checkout`,
        headers: { origin: BASE_URL },
        remoteAddress: `10.230.1.${address}`,
      });
      assert.equal(click.statusCode, unknownClick.statusCode);
      assert.equal(click.body, unknownClick.body);
    }
    assert.equal(await events(), before, 'nothing recorded for the link');
    assert.equal((await charges(link.id)).length, 0, 'no attempt created');
    // The real token still works through the same wildcard route.
    const real = await api.inject({
      url: `/api/v1/payment-links/${token.toLowerCase()}`,
      remoteAddress: '10.230.2.1',
    });
    assert.equal(real.statusCode, 200);
    assert.equal(real.json().state, 'ready');
    const logged = JSON.stringify(records);
    assert.equal(logged.includes(token), false);
    assert.equal(logged.includes(token.toLowerCase()), false);
    assert.equal(
      records.some((record) => record.level === 'error'),
      false,
    );
  });
}
