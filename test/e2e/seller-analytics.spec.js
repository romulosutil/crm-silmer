import { expect, test } from '@playwright/test';
import { CLARITY_HOST } from '../../apps/edge-web/src/lib/seller-analytics.js';

const origin = `https://${CLARITY_HOST}`;
/** @type {{id: string, functionName: string, capabilities: string[], name: string, email: string}} */
const seller = {
  id: 'synthetic-seller',
  functionName: 'Vendedor',
  capabilities: [],
  name: 'CanarySellerName',
  email: 'canary-seller@example.test',
};

/** Serve the production build at its authorized origin; intercept EVERY external
 * request so tests never send synthetic sessions to Microsoft.
 * @param {import('@playwright/test').Page} page
 * @param {{user?: typeof seller | null, blocked?: boolean}} [options]
 */
async function setup(page, options = {}) {
  const user = options.user === undefined ? seller : options.user;
  /** @type {string[]} */
  const payloads = [];
  /** @type {string[]} */
  const sdkRequests = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'https://www.clarity.ms') {
      expect(request.headers().cookie).toBeUndefined();
      expect(request.headers().referer).toBeUndefined();
      if (options.blocked) return route.abort();
      payloads.push(request.postData() ?? '');
      return route.fulfill({
        status: 204,
        headers: { 'access-control-allow-origin': origin },
      });
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname.includes('clarity.module-'))
      sdkRequests.push(url.pathname);
    if (url.pathname === '/api/v1/sessions/current') {
      return route.fulfill({
        status: user ? 200 : 401,
        json: user ? { user } : { code: 'UNAUTHORIZED' },
      });
    }
    if (url.pathname === '/api/v1/events') {
      return route.fulfill({
        contentType: 'text/event-stream',
        body: ': synthetic\n\n',
      });
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({
        json: {
          items: [],
          counts: { confirmado: 0, pendente: 0 },
          nextCursor: null,
          totalCount: 0,
          storeNewCount: 0,
        },
      });
    }
    const response = await page.request.get(
      `${test.info().project.use.baseURL}${url.pathname}`,
    );
    return route.fulfill({ response });
  });
  return { payloads, sdkRequests };
}

test('CLAR-01–06 actual SDK masks DOM/media, emits seller actions and stops at Account', async ({
  page,
  context,
}) => {
  const { payloads } = await setup(page);
  await page.goto(`${origin}/pedidos?status=pendente&vendedor=eu`);
  await expect(
    page.getByRole('button', { name: 'Novo pedido', exact: true }),
  ).toBeVisible();
  await expect.poll(() => payloads.join('')).toContain('seller_view_orders');
  await page.evaluate(() => {
    const section = globalThis.document.createElement('section');
    section.innerHTML =
      '<p title="CanaryCustomerTitle" aria-label="CanaryCustomerAria" data-customer="CanaryCustomerData">CanaryCustomerText</p><input aria-label="CanaryInputLabel" value="CanaryInputValue"><a href="mailto:canary-customer@example.test">CanaryLinkText</a><img src="/CanaryCustomerImage.png" alt="CanaryCustomerImageAlt">';
    globalThis.document.body.append(section);
    section
      .querySelector('a')
      ?.addEventListener('click', (event) => event.preventDefault());
    section.querySelector('a')?.click();
    globalThis.dispatchEvent(
      new globalThis.ErrorEvent('error', {
        message: 'CanarySensitiveError',
        error: new Error('CanarySensitiveError'),
      }),
    );
  });
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await expect
    .poll(() => payloads.join(''))
    .toContain('seller_order_create_started');
  await page.keyboard.press('Escape');
  await page.locator('.app-sidebar a[href="/conta"]').click();
  await expect(
    page.getByRole('heading', { name: 'Conta e segurança' }),
  ).toBeVisible();
  const count = payloads.length;
  // Exceed the SDK's 250ms history restart and one-second upload interval.
  await page.waitForTimeout(1400);
  await page.mouse.move(200, 200);
  expect(payloads).toHaveLength(count);
  const wire = payloads.join('');
  for (const canary of [
    'CanarySellerName',
    'canary-seller@example.test',
    'CanaryCustomerText',
    'CanaryCustomerTitle',
    'CanaryCustomerAria',
    'CanaryCustomerData',
    'CanaryInputValue',
    'canary-customer@example.test',
    'CanaryLinkText',
    'CanaryCustomerImage',
    'CanarySensitiveError',
    '/conta',
  ])
    expect(wire).not.toContain(canary);
  expect(wire).toContain('crm_seller_key');
  expect(wire).not.toContain('synthetic-seller');
  expect(
    (await context.cookies()).filter((cookie) =>
      /^_cl(ck|sk)$/u.test(cookie.name),
    ),
  ).toEqual([]);
});

for (const scenario of [
  {
    name: 'admin',
    path: '/pedidos',
    user: { ...seller, capabilities: ['COMMERCIAL_ADMIN'] },
  },
  {
    name: 'finance',
    path: '/financeiro',
    user: { ...seller, functionName: 'Financeiro' },
  },
  { name: 'signed out', path: '/', user: null },
  { name: 'account', path: '/conta', user: seller },
  {
    name: 'unknown query',
    path: '/pedidos?email=canary@example.test',
    user: seller,
  },
  { name: 'fragment', path: '/pedidos#CanarySecret', user: seller },
  {
    name: 'duplicate filter',
    path: '/pedidos?status=pendente&status=confirmado',
    user: seller,
  },
]) {
  test(`CLAR-01/04 does not load SDK for ${scenario.name}`, async ({
    page,
  }) => {
    const { payloads, sdkRequests } = await setup(page, {
      user: scenario.user,
    });
    await page.goto(`${origin}${scenario.path}`);
    await expect(page.locator('.app-shell, .public-shell')).toBeVisible();
    await page.waitForTimeout(400);
    expect(sdkRequests).toEqual([]);
    expect(payloads).toEqual([]);
  });
}

test('CLAR-05 blocked collector preserves seller navigation and commands', async ({
  page,
}) => {
  await setup(page, { blocked: true });
  await page.goto(`${origin}/pedidos`);
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.app-sidebar a[href="/conta"]').click();
  await expect(
    page.getByRole('heading', { name: 'Conta e segurança' }),
  ).toBeVisible();
});

test('CLAR-04 legacy consent cookie cannot override cookieless initialization', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: '_clck', value: 'CanaryLegacyId|2|zzzzz|1|0', url: origin },
  ]);
  const { payloads, sdkRequests } = await setup(page);
  await page.goto(`${origin}/pedidos`);
  await expect(
    page.getByRole('button', { name: 'Novo pedido', exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  expect(sdkRequests).toEqual([]);
  expect(payloads).toEqual([]);
});
