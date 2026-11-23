import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENING_LABEL,
  PAYMENT_NOTES,
  PublicPaymentError,
  callPaymentLink,
  checkoutPollDelay,
  formatPaidAt,
  formatPaymentAmount,
  isPublicPaymentToken,
  mergePaymentLink,
  normalizePaymentLink,
  paymentCheckoutPath,
  paymentHeading,
  paymentLinkPath,
  parseRetryAfter,
  paymentStateView,
  safeCheckoutUrl,
  waitForCheckout,
} from '../apps/edge-web/src/lib/public-payment.js';

const TOKEN = '7Q4K2M9XHT3VBN8CJ5RW0PDFGA';
const nbsp = (/** @type {string} */ value) => value.replace(/ /gu, ' ');

test('LPC-02: accepts only plausible tokens and builds encoded API paths', () => {
  assert.equal(isPublicPaymentToken(TOKEN), true);
  assert.equal(isPublicPaymentToken(TOKEN.toLowerCase()), true);
  for (const bad of ['', 'abc', '../../x', `${TOKEN}.js`, 'a'.repeat(65), 7])
    assert.equal(isPublicPaymentToken(bad), false, String(bad));
  assert.equal(paymentLinkPath(TOKEN), `/api/v1/payment-links/${TOKEN}`);
  assert.equal(
    paymentCheckoutPath('a/b'),
    '/api/v1/payment-links/a%2Fb/checkout',
  );
});

test('LPC-02: follows only https InfinitePay addresses', () => {
  for (const ok of [
    'https://checkout.infinitepay.io/silmer/abc',
    'https://infinitepay.io/pay?x=1',
    'https://pay.infinitepay.com.br/abc',
    'https://INFINITEPAY.IO/abc',
  ])
    assert.ok(safeCheckoutUrl(ok), ok);
  for (const bad of [
    'http://checkout.infinitepay.io/abc',
    'https://infinitepay.io.evil.test/abc',
    'https://evilinfinitepay.io/abc',
    'https://user:pass@checkout.infinitepay.io/abc',
    'https://checkout.infinitepay.io:8443/abc',
    'javascript:alert(1)',
    '//checkout.infinitepay.io/abc',
    'https://example.com/?u=https://infinitepay.io',
    '',
    null,
    42,
  ])
    assert.equal(safeCheckoutUrl(bad), null, String(bad));
});

test('LPC-02: normalizes each public state and keeps unavailable uniform', () => {
  assert.deepEqual(
    normalizePaymentLink({
      state: 'ready',
      orderNumber: '07-CRM',
      kind: 'signal',
      amountCents: 240000,
      customerName: 'never shown',
    }),
    {
      state: 'ready',
      orderNumber: '07-CRM',
      kind: 'signal',
      amountCents: 240000,
    },
  );
  assert.deepEqual(
    normalizePaymentLink({ state: 'unavailable', orderNumber: '07-CRM' }),
    { state: 'unavailable' },
  );
  assert.equal(normalizePaymentLink(null).state, 'failed');
  assert.equal(normalizePaymentLink({ state: 'weird' }).state, 'failed');
  assert.equal(
    normalizePaymentLink({
      state: 'in_progress',
      checkoutUrl: 'https://checkout.infinitepay.io/x',
    }).checkoutUrl,
    'https://checkout.infinitepay.io/x',
  );
  assert.equal(
    normalizePaymentLink({
      state: 'in_progress',
      checkoutUrl: 'https://evil.test/x',
    }).state,
    'failed',
    'an unsafe checkout address is never followed',
  );
  assert.equal(
    normalizePaymentLink({ state: 'ready', amountCents: 12.5 }).amountCents,
    undefined,
  );
});

test('LPC-02: the checkout answer keeps the order fields already on screen', () => {
  const current = normalizePaymentLink({
    state: 'ready',
    orderNumber: '07-CRM',
    kind: 'installment',
    amountCents: 120000,
  });
  assert.deepEqual(mergePaymentLink(current, { state: 'in_progress' }), {
    orderNumber: '07-CRM',
    kind: 'installment',
    amountCents: 120000,
    state: 'in_progress',
  });
  assert.deepEqual(mergePaymentLink(current, { state: 'unavailable' }), {
    state: 'unavailable',
  });
});

test('LPC-09: copy of the five states follows the prototype', () => {
  const base = { orderNumber: '07-CRM', kind: 'signal', amountCents: 240000 };
  const options = { companyName: 'Silmer' };
  const ready = paymentStateView({ ...base, state: 'ready' }, options);
  assert.equal(ready.label, 'Pronto para pagar');
  assert.equal(nbsp(ready.action?.label ?? ''), 'Pagar R$ 2.400,00');
  const progress = paymentStateView({ ...base, state: 'in_progress' }, options);
  assert.equal(progress.label, 'Pagamento em andamento');
  assert.equal(progress.action?.label, 'Continuar na InfinitePay');
  const paid = paymentStateView(
    { ...base, state: 'paid', paidAt: '2026-11-23T17:05:00Z' },
    options,
  );
  assert.equal(paid.label, 'Já pago');
  assert.equal(paid.strong, 'Pagamento confirmado em 23/11, 14:05.');
  assert.equal(paid.action, null);
  const cancelled = paymentStateView({ state: 'unavailable' }, options);
  assert.equal(cancelled.label, 'Cancelado');
  assert.equal(cancelled.strong, 'Este link foi cancelado.');
  assert.equal(cancelled.text, 'Fale com a Silmer pelo WhatsApp.');
  assert.equal(cancelled.action, null);
  const failed = paymentStateView({ ...base, state: 'failed' }, options);
  assert.equal(failed.label, 'Falha ao abrir');
  assert.equal(failed.action?.kind, 'retry');
  assert.equal(
    paymentStateView({ state: 'failed' }, { ...options, loadFailed: true })
      .action?.kind,
    'reload',
  );
  assert.equal(OPENING_LABEL, 'Abrindo a InfinitePay…');
});

test('LPC-09: heading, amount and paid time formats', () => {
  assert.equal(
    paymentHeading({ state: 'ready', orderNumber: '07-CRM' }, 'Silmer'),
    'Silmer · Pedido 07-CRM',
  );
  assert.equal(paymentHeading({ state: 'unavailable' }, 'Silmer'), 'Silmer');
  assert.equal(paymentHeading(null, 'Silmer'), 'Silmer');
  assert.equal(nbsp(formatPaymentAmount(5)), 'R$ 0,05');
  assert.equal(formatPaidAt('2026-11-24T02:30:00Z'), '23/11, 23:30');
  assert.equal(formatPaidAt('nope'), '');
  assert.equal(formatPaidAt(undefined), '');
});

/** @param {number} status @param {unknown} [body] */
function reply(status, body) {
  return new globalThis.Response(
    body === undefined ? null : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

test('LPC-02: the public calls send no cookie and map uniform errors', async () => {
  /** @type {Array<{url: string, init: RequestInit}>} */
  const calls = [];
  /** @param {Response} response */
  const fetchWith = (response) =>
    /** @type {typeof fetch} */ (
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return response;
      }
    );
  const link = await callPaymentLink(TOKEN, {
    fetchImpl: fetchWith(
      reply(200, {
        state: 'ready',
        orderNumber: '07-CRM',
        kind: 'full',
        amountCents: 100,
      }),
    ),
  });
  assert.equal(link.state, 'ready');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.cache, 'no-store');

  await callPaymentLink(TOKEN, {
    checkout: true,
    fetchImpl: fetchWith(reply(202, { state: 'in_progress' })),
  });
  assert.equal(calls[1].url, `/api/v1/payment-links/${TOKEN}/checkout`);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, '{}');
  assert.equal(calls[1].init.credentials, 'omit');

  assert.deepEqual(
    await callPaymentLink(TOKEN, { fetchImpl: fetchWith(reply(404, {})) }),
    { state: 'unavailable' },
  );
  await assert.rejects(
    callPaymentLink(TOKEN, { fetchImpl: fetchWith(reply(429, {})) }),
    (error) =>
      error instanceof PublicPaymentError && error.code === 'rate_limited',
  );
  await assert.rejects(
    callPaymentLink(TOKEN, { fetchImpl: fetchWith(reply(503, {})) }),
    (error) => error instanceof PublicPaymentError && error.code === 'http',
  );
  await assert.rejects(
    callPaymentLink(TOKEN, {
      fetchImpl: /** @type {typeof fetch} */ (
        async () => {
          throw new TypeError('Failed to fetch');
        }
      ),
    }),
    (error) => error instanceof PublicPaymentError && error.code === 'network',
  );
  assert.ok(PAYMENT_NOTES.rateLimited);
});

/** Fake clock for waitForCheckout: sleeping advances time instantly. */
function fakeClock() {
  const clock = { t: 0 };
  return {
    clock,
    now: () => clock.t,
    sleep: async (/** @type {number} */ ms) => {
      clock.t += ms;
    },
  };
}

test('LPC-02: polls every 2.5 s, then 5 s after 20 s: ~16 readings in a minute', async () => {
  const { clock, now, sleep } = fakeClock();
  /** @type {number[]} */
  const at = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const stalled = await waitForCheckout(
    async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      at.push(clock.t);
      await Promise.resolve();
      inFlight -= 1;
      return { state: 'in_progress' };
    },
    { sleep, now },
  );
  assert.equal(stalled.timedOut, true);
  assert.deepEqual(
    at,
    [
      2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000, 25000, 30000, 35000,
      40000, 45000, 50000, 55000, 60000,
    ],
  );
  assert.equal(at.length, 16, 'well inside GET 60/min per token');
  assert.equal(maxInFlight, 1, 'never more than one request in flight');
  assert.equal(checkoutPollDelay(19_999), 2500);
  assert.equal(checkoutPollDelay(20_000), 5000);

  clock.t = 0;
  let reads = 0;
  const arrives = await waitForCheckout(
    async () =>
      ++reads < 3
        ? { state: 'in_progress' }
        : {
            state: 'in_progress',
            checkoutUrl: 'https://checkout.infinitepay.io/x',
          },
    { sleep, now },
  );
  assert.equal(arrives.checkoutUrl, 'https://checkout.infinitepay.io/x');
  assert.equal(reads, 3);

  const settled = await waitForCheckout(async () => ({ state: 'failed' }), {
    sleep,
    now,
  });
  assert.equal(settled.state, 'failed');
});

test('LPC-02: a 429 waits Retry-After (or 10 s) and polling resumes to see a late address', async () => {
  const { clock, now, sleep } = fakeClock();
  /** @type {number[]} */
  const at = [];
  const late = await waitForCheckout(
    async () => {
      at.push(clock.t);
      if (at.length === 1) throw new PublicPaymentError('rate_limited', 7000);
      if (at.length === 2) throw new PublicPaymentError('rate_limited');
      if (at.length === 3) throw new PublicPaymentError('network');
      return at.length < 5
        ? { state: 'in_progress' }
        : {
            state: 'in_progress',
            checkoutUrl: 'https://checkout.infinitepay.io/late',
          };
    },
    { sleep, now },
  );
  assert.equal(late.checkoutUrl, 'https://checkout.infinitepay.io/late');
  // 2.5 s → 429 (Retry-After 7 s) → 9.5 s → 429 (no header, 10 s) → 19.5 s
  // → network error (2.5 s) → 22 s → 27 s (5 s cadence after 20 s).
  assert.deepEqual(at, [2500, 9500, 19500, 22000, 27000]);

  // A Retry-After beyond the budget ends the wait honestly, without reading.
  clock.t = 0;
  let reads = 0;
  const capped = await waitForCheckout(
    async () => {
      reads += 1;
      throw new PublicPaymentError('rate_limited', 120_000);
    },
    { sleep, now },
  );
  assert.equal(capped.timedOut, true);
  assert.equal(reads, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitForCheckout(async () => ({ state: 'in_progress' }), {
      signal: controller.signal,
    }),
  );
});

test('LPC-02: Retry-After reads seconds or an HTTP date, capped', async () => {
  assert.equal(parseRetryAfter('7'), 7000);
  assert.equal(parseRetryAfter(' 0 '), 0);
  assert.equal(parseRetryAfter('99999'), 120_000);
  assert.equal(
    parseRetryAfter(
      'Mon, 23 Nov 2026 17:00:30 GMT',
      Date.parse('2026-11-23T17:00:00Z'),
    ),
    30_000,
  );
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(null), null);

  await assert.rejects(
    callPaymentLink(TOKEN, {
      fetchImpl: /** @type {typeof fetch} */ (
        async () =>
          new globalThis.Response('{}', {
            status: 429,
            headers: { 'retry-after': '12' },
          })
      ),
    }),
    (error) =>
      error instanceof PublicPaymentError &&
      error.code === 'rate_limited' &&
      error.retryAfterMs === 12_000,
  );
});
