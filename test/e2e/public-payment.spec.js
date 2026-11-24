import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * RFC 074 (LPC-02/LPC-09): the customer's payment page `/pagar/:token`.
 * The public API is mocked; the InfinitePay page is intercepted and never
 * reached.
 */

const TOKEN = '7Q4K2M9XHT3VBN8CJ5RW0PDFGA';
const PAGE = `/pagar/${TOKEN}`;
const LINK = `/api/v1/payment-links/${TOKEN}`;
const CHECKOUT_URL = 'https://checkout.infinitepay.io/silmer/synthetic-123';
const READY = {
  state: 'ready',
  orderNumber: '07-CRM',
  kind: 'signal',
  amountCents: 240000,
};
const SHOTS = process.env.PUBLIC_PAYMENT_SHOTS ?? '';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   get: (count: number) => Record<string, unknown> | number,
 *   post?: (count: number) => Record<string, unknown> | number | Promise<Record<string, unknown> | number>,
 * }} handlers
 */
async function mockLink(page, handlers) {
  const seen = {
    get: 0,
    post: 0,
    sessions: 0,
    cookies: /** @type {string[]} */ ([]),
  };
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/sessions/current')) seen.sessions += 1;
  });
  await page.route('**/api/v1/sessions/current', (route) =>
    route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }),
  );
  await page.route(`**${LINK}/checkout`, async (route) => {
    seen.post += 1;
    const { cookie } = await route.request().allHeaders();
    if (cookie) seen.cookies.push(cookie);
    const body = await handlers.post?.(seen.post);
    if (typeof body === 'number')
      return route.fulfill({ status: body, json: {} });
    return route.fulfill({
      status: 202,
      json: body ?? { state: 'in_progress' },
    });
  });
  await page.route(`**${LINK}`, async (route) => {
    seen.get += 1;
    const count = seen.get;
    const { cookie } = await route.request().allHeaders();
    if (cookie) seen.cookies.push(cookie);
    const body = handlers.get(count);
    if (typeof body === 'number')
      return route.fulfill({ status: body, json: {} });
    if (body.state === 'rate_limited')
      return route.fulfill({
        status: 429,
        json: { code: 'RATE_LIMITED' },
        headers: { 'retry-after': String(body.retryAfter) },
      });
    return route.fulfill({
      json: body,
      headers: { 'cache-control': 'no-store' },
    });
  });
  return seen;
}

/** Intercept the provider so the test never leaves the machine.
 * @param {import('@playwright/test').Page} page */
async function catchInfinitePay(page) {
  /** @type {string[]} */
  const opened = [];
  await page.route(/^https:\/\/[^/]*infinitepay\.(io|com\.br)\//u, (route) => {
    opened.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>InfinitePay</title><p>Checkout sintético</p>',
    });
  });
  return opened;
}

/**
 * Record, in the page's (fake) time, each public GET, and how many public
 * calls are in flight. A call counts until its body is read, so once it drops
 * to 0 the page has already scheduled its next wait.
 * @param {import('@playwright/test').Page} page
 */
async function trackPaymentCalls(page) {
  await page.addInitScript(() => {
    const state = {
      reads: /** @type {number[]} */ ([]),
      inflight: 0,
      maxInflight: 0,
    };
    /** @type {any} */ (globalThis).__pay = state;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes('/api/v1/payment-links/')) return original(input, init);
      if ((init?.method ?? 'GET') === 'GET') state.reads.push(Date.now());
      state.inflight += 1;
      state.maxInflight = Math.max(state.maxInflight, state.inflight);
      let response;
      try {
        response = await original(input, init);
      } catch (error) {
        state.inflight -= 1;
        throw error;
      }
      if (!response.ok) {
        state.inflight -= 1;
        return response;
      }
      const json = response.json.bind(response);
      response.json = async () => {
        try {
          return await json();
        } finally {
          state.inflight -= 1;
        }
      };
      return response;
    };
  });
}

/** @param {import('@playwright/test').Page} page */
async function paymentCalls(page) {
  return page.evaluate(() => {
    const state = /** @type {any} */ (globalThis).__pay;
    return {
      reads: /** @type {number[]} */ ([...state.reads]),
      inflight: /** @type {number} */ (state.inflight),
      maxInflight: /** @type {number} */ (state.maxInflight),
      now: Date.now(),
    };
  });
}

/**
 * Advance the paused page clock in 0.5 s steps (every cadence is a multiple),
 * letting each reading answer before the next step.
 * @param {import('@playwright/test').Page} page
 * @param {number} ms
 */
async function advance(page, ms) {
  for (let done = 0; done < ms; done += 500) {
    await page.clock.runFor(500);
    await expect.poll(async () => (await paymentCalls(page)).inflight).toBe(0);
  }
}

/** @param {import('@playwright/test').Page} page */
async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

const nbsp = (/** @type {string} */ text) => text.replace(/ /gu, ' ');

test.describe('LPC-02/LPC-09: página pública de pagamento', () => {
  test('Pronto para pagar: only order, kind and amount, no shell and no session', async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: 'crm_session',
        value: 'synthetic-seller-session',
        url: 'http://127.0.0.1',
      },
    ]);
    const seen = await mockLink(page, { get: () => READY });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(PAGE);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Silmer · Pedido 07-CRM' }),
    ).toBeVisible();
    await expect(page.locator('.cp-kind')).toHaveText('Sinal');
    expect(nbsp(await page.locator('.cp-amount').innerText())).toBe(
      'R$ 2.400,00',
    );
    await expect(page.locator('.cp-badge')).toHaveText('Pronto para pagar');
    await expect(
      page.getByText(
        'Pix ou cartão: você escolhe na próxima tela, na InfinitePay.',
      ),
    ).toBeVisible();
    const pay = page.getByRole('button', { name: /^Pagar R\$/u });
    expect(nbsp(await pay.innerText())).toBe('Pagar R$ 2.400,00');
    await expect(
      page.getByText(
        'O pagamento é feito na InfinitePay, com Pix ou cartão. Dúvidas sobre o pedido? Fale com a Silmer pelo WhatsApp.',
      ),
    ).toBeVisible();

    // No CRM around it: no sidebar, login or skip link.
    await expect(
      page.locator('.app-shell, .public-shell, .skip-link'),
    ).toHaveCount(0);
    await expect(page).toHaveURL(PAGE);
    await expect(page).toHaveTitle('Pagamento · Silmer');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
    expect(seen.sessions).toBe(0);
    expect(seen.cookies).toEqual([]);
    await expectNoAxeViolations(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/public-payment-desktop-light-ready.png`,
        fullPage: true,
      });
  });

  test('Pagar shows the busy state, waits for the address and opens InfinitePay', async ({
    page,
  }) => {
    /** @type {(value?: unknown) => void} */
    let release = () => {};
    const held = new Promise((resolve) => (release = resolve));
    const seen = await mockLink(page, {
      get: (count) =>
        count === 1
          ? READY
          : count === 2
            ? { state: 'in_progress' }
            : { state: 'in_progress', checkoutUrl: CHECKOUT_URL },
      post: async () => {
        await held;
        return { state: 'in_progress' };
      },
    });
    const opened = await catchInfinitePay(page);
    await page.goto(PAGE);

    const pay = page.getByRole('button', { name: /^Pagar R\$/u });
    await pay.click();
    const busy = page.getByRole('button', { name: 'Abrindo a InfinitePay…' });
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await busy.click({ force: true });
    release();

    await page.waitForURL(CHECKOUT_URL);
    expect(opened).toEqual([CHECKOUT_URL]);
    expect(seen.post).toBe(1);
    expect(seen.get).toBe(3);
    expect(seen.sessions).toBe(0);
  });

  test('Pagamento em andamento: Continuar goes back to the same payment', async ({
    page,
  }) => {
    const seen = await mockLink(page, {
      get: () => ({
        ...READY,
        state: 'in_progress',
        checkoutUrl: CHECKOUT_URL,
      }),
    });
    const opened = await catchInfinitePay(page);
    await page.goto(PAGE);

    await expect(page.locator('.cp-badge')).toHaveText(
      'Pagamento em andamento',
    );
    await expect(
      page.getByText(
        'Você já abriu este pagamento. Continue de onde parou: nenhum pagamento novo é criado.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page
      .getByRole('button', { name: 'Continuar na InfinitePay' })
      .click();
    await page.waitForURL(CHECKOUT_URL);
    expect(opened).toEqual([CHECKOUT_URL]);
    expect(seen.post).toBe(0);
  });

  test('Já pago: confirmation time and no action', async ({ page }) => {
    await mockLink(page, {
      get: () => ({ ...READY, state: 'paid', paidAt: '2026-11-23T17:05:00Z' }),
    });
    await page.goto(PAGE);

    await expect(page.locator('.cp-badge')).toHaveText('Já pago');
    await expect(
      page.getByText(
        'Pagamento confirmado em 23/11, 14:05. Não é preciso pagar de novo.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Link indisponível: missing, malformed and cancelled links read the same, without the order', async ({
    page,
  }) => {
    for (const answer of [{ state: 'unavailable' }, 404]) {
      await mockLink(page, { get: () => answer });
      await page.goto(PAGE);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Silmer', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.cp-badge')).toHaveText('Link indisponível');
      await expect(
        page.getByText(
          'Este link não está disponível. Fale com a Silmer pelo WhatsApp.',
        ),
      ).toBeVisible();
      // The uniform answer never claims why (LPC-02).
      await expect(page.getByText(/cancelad/iu)).toHaveCount(0);
      await expect(page.getByText(/Pedido|R\$/u)).toHaveCount(0);
      await expect(page.getByRole('button')).toHaveCount(0);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }

    // A malformed token never reaches the API and reads the same.
    let calls = 0;
    await page.route('**/api/v1/payment-links/**', (route) => {
      calls += 1;
      return route.fulfill({ json: READY });
    });
    await page.goto('/pagar/abc');
    await expect(page.locator('.cp-badge')).toHaveText('Link indisponível');
    expect(calls).toBe(0);
    await expectNoAxeViolations(page);
  });

  // QA PR 457: the shell's sr-only "Verificando sua sessão…" status must not
  // exist on the customer's page, in any state.
  for (const [name, answer] of /** @type {const} */ ([
    ['ready', READY],
    ['unavailable', { state: 'unavailable' }],
    ['failed', { ...READY, state: 'failed' }],
  ]))
    test(`no session announcement and WCAG 2.2 AA (${name})`, async ({
      page,
    }) => {
      await mockLink(page, { get: () => answer });
      await page.goto(PAGE);
      await expect(page.locator('.cp-badge')).toBeVisible();
      await page.waitForTimeout(300);
      const live = await page
        .locator('[role="status"], [role="alert"], [role="log"], [aria-live]')
        .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''));
      expect(live.join(' | ')).not.toMatch(/sess[aã]o|login|acesso/iu);
      const tree = await page.locator('body').ariaSnapshot();
      expect(tree).not.toMatch(/sess[aã]o/iu);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });

  test('Falha ao abrir: Tentar de novo re-asks the same checkout and keeps focus', async ({
    page,
  }) => {
    const seen = await mockLink(page, {
      get: (count) => (count === 1 ? { ...READY, state: 'failed' } : READY),
      post: (count) =>
        count === 1
          ? { state: 'failed' }
          : { state: 'in_progress', checkoutUrl: CHECKOUT_URL },
    });
    const opened = await catchInfinitePay(page);
    await page.goto(PAGE);

    await expect(page.locator('.cp-badge')).toHaveText('Falha ao abrir');
    await expect(
      page.getByText(
        'Não conseguimos abrir o pagamento agora. Tentar de novo não cobra duas vezes.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    const retry = page.getByRole('button', { name: 'Tentar de novo' });
    await retry.click();
    await expect(page.locator('.cp-live')).toHaveText(
      'Ainda não foi possível abrir o pagamento. Tentar de novo não cobra duas vezes.',
    );
    await expect(retry).toBeFocused();
    await expect(retry).not.toHaveAttribute('aria-busy', 'true');

    await retry.click();
    await page.waitForURL(CHECKOUT_URL);
    expect(opened).toEqual([CHECKOUT_URL]);
    expect(seen.post).toBe(2);
  });

  test('an address outside InfinitePay is never followed', async ({ page }) => {
    await mockLink(page, {
      get: () => READY,
      post: () => ({
        state: 'in_progress',
        checkoutUrl: 'https://evil.example/checkout',
      }),
    });
    /** @type {string[]} */
    const foreign = [];
    await page.route('https://evil.example/**', (route) => {
      foreign.push(route.request().url());
      return route.abort();
    });
    await page.goto(PAGE);
    await page.getByRole('button', { name: /^Pagar R\$/u }).click();
    await expect(page.locator('.cp-badge')).toHaveText('Falha ao abrir');
    await expect(page).toHaveURL(PAGE);
    expect(foreign).toEqual([]);
  });

  test('the wait is bounded: 2.5 s, then 5 s after 20 s, ~16 readings, then the page says so', async ({
    page,
  }) => {
    const T0 = new Date('2026-11-23T17:00:00Z').getTime();
    await page.clock.install({ time: T0 });
    await trackPaymentCalls(page);
    const seen = await mockLink(page, {
      get: (count) => (count === 1 ? READY : { state: 'in_progress' }),
    });
    await page.goto(PAGE);
    const pay = page.getByRole('button', { name: /^Pagar R\$/u });
    await expect(pay).toBeVisible();
    await page.clock.pauseAt(T0 + 30_000);
    const start = (await paymentCalls(page)).now;
    await pay.click();
    await expect(
      page.getByRole('button', { name: 'Abrindo a InfinitePay…' }),
    ).toBeVisible();
    await expect.poll(() => seen.post).toBe(1);
    await expect.poll(async () => (await paymentCalls(page)).inflight).toBe(0);

    await advance(page, 61_000);
    await expect(page.locator('.cp-live')).toHaveText(
      'A InfinitePay ainda não respondeu. Tente de novo em instantes: nenhum pagamento novo é criado.',
    );
    const calls = await paymentCalls(page);
    expect(calls.reads.slice(1).map((at) => at - start)).toEqual([
      2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000, 25000, 30000, 35000,
      40000, 45000, 50000, 55000, 60000,
    ]);
    expect(seen.get).toBe(17);
    expect(calls.maxInflight).toBe(1);
    await expect(page.locator('.cp-badge')).toHaveText(
      'Pagamento em andamento',
    );
    const resume = page.getByRole('button', {
      name: 'Continuar na InfinitePay',
    });
    await expect(resume).toBeFocused();
    await expect(page).toHaveURL(PAGE);
  });

  test('a 429 while waiting honours Retry-After and still catches a late address', async ({
    page,
  }) => {
    const T0 = new Date('2026-11-23T17:00:00Z').getTime();
    await page.clock.install({ time: T0 });
    await trackPaymentCalls(page);
    const seen = await mockLink(page, {
      get: (count) =>
        count === 1
          ? READY
          : count === 2
            ? { state: 'rate_limited', retryAfter: 7 }
            : count === 3
              ? { state: 'in_progress' }
              : { state: 'in_progress', checkoutUrl: CHECKOUT_URL },
    });
    const opened = await catchInfinitePay(page);
    await page.goto(PAGE);
    const pay = page.getByRole('button', { name: /^Pagar R\$/u });
    await expect(pay).toBeVisible();
    await page.clock.pauseAt(T0 + 30_000);
    await pay.click();
    await expect.poll(() => seen.post).toBe(1);
    await expect.poll(async () => (await paymentCalls(page)).inflight).toBe(0);

    await advance(page, 2_500);
    expect(seen.get).toBe(2); // 429, Retry-After: 7
    await advance(page, 6_500);
    expect(seen.get).toBe(2); // no reading before the 7 s are over
    await advance(page, 500);
    expect(seen.get).toBe(3);
    await expect(
      page.getByRole('button', { name: 'Abrindo a InfinitePay…' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect((await paymentCalls(page)).maxInflight).toBe(1);
    await page.clock.runFor(2_500);
    await page.waitForURL(CHECKOUT_URL);
    expect(seen.get).toBe(4);
    expect(opened).toEqual([CHECKOUT_URL]);
  });

  test('keyboard only: Tab reaches the action and Enter opens the payment', async ({
    page,
  }) => {
    await mockLink(page, {
      get: (count) =>
        count === 1
          ? READY
          : { state: 'in_progress', checkoutUrl: CHECKOUT_URL },
    });
    const opened = await catchInfinitePay(page);
    await page.goto(PAGE);
    await expect(page.locator('.cp-badge')).toHaveText('Pronto para pagar');

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: /^Pagar R\$/u }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL(CHECKOUT_URL);
    expect(opened).toEqual([CHECKOUT_URL]);
  });

  for (const theme of ['light', 'dark']) {
    test(`390px ${theme}: fits the phone without horizontal scroll`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        globalThis.localStorage.setItem('silmer-theme', value);
      }, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const body of [READY, { state: 'unavailable' }]) {
        await mockLink(page, { get: () => body });
        await page.goto(PAGE);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.cp-badge')).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const button = page.locator('.cp-button');
        if (await button.count()) {
          const box = await button.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        await expectNoAxeViolations(page);
        if (SHOTS && theme === 'dark' && body.state === 'unavailable')
          await page.screenshot({
            path: `${SHOTS}/public-payment-mobile-dark-cancelado.png`,
            fullPage: true,
          });
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    });
  }

  test('regression: an authenticated route still sends a signed-out visitor to the login', async ({
    page,
  }) => {
    await page.route('**/api/v1/sessions/current', (route) =>
      route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }),
    );
    await page.goto('/pedidos');
    await expect(page).toHaveURL(/\/\?voltar=(?:%2F|\/)pedidos$/u);
    await expect(
      page.getByRole('button', { name: 'Entrar com segurança' }),
    ).toBeVisible();
  });
});
