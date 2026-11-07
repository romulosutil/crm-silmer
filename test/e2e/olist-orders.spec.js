import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const orderId = 'acbf1c1b-c57f-4c5c-8076-7f439f95cfb0';
const base = `/api/v1/orders/${orderId}/olist`;
const groupId = '55777e58-ad9b-4fda-93f3-a29045939b26';
const otherGroupId = 'c0105d9a-3e97-41d3-bb7d-b3e2798c9cf3';
const lineId = 'b7c42ab0-25f1-46f6-a6ad-2b520706116f';
const otherLineId = '4cb9616a-72e1-49db-94fa-4601e5cf6bc9';
const now = new Date('2026-11-07T15:00:00.000Z');

function readyPreview() {
  return {
    orderId,
    number: '41-CRM',
    status: 'pendente',
    eligible: true,
    creationEnabled: false,
    issues: [],
    commercial: {
      totalCents: 15500,
      orderDate: '2026-11-07',
      deliveryOn: '2026-11-20',
      paymentCondition: 'pix',
      groups: [
        {
          groupId,
          attributes: { garment: 'CAMISETA', color: 'AZUL' },
          lines: [
            { lineId, groupId, quantity: 3, size: 'M', subtotalCents: 10500 },
          ],
        },
        {
          groupId: otherGroupId,
          attributes: { garment: 'POLO', color: 'BRANCA' },
          lines: [
            {
              lineId: otherLineId,
              groupId: otherGroupId,
              quantity: 2,
              size: 'M',
              subtotalCents: 5000,
            },
          ],
        },
      ],
    },
    customer: { name: 'Comprador sintético', documentSuffix: '0019' },
    registrations: {
      customer: { action: 'reuse', remoteId: '701' },
      groups: [
        {
          groupId,
          action: 'create',
          remoteId: null,
          lines: [{ lineId, action: 'create', remoteId: null }],
        },
        {
          groupId: otherGroupId,
          action: 'reuse',
          remoteId: '702',
          lines: [{ lineId: otherLineId, action: 'reuse', remoteId: '703' }],
        },
      ],
    },
    versions: {
      order: 4,
      source: 1,
      buyer: 3,
      settings: 2,
      connection: 1,
      authorization: 2,
    },
    expiresAt: '2026-11-07T15:15:00.000Z',
    previewToken: 'synthetic-session-bound-receipt',
  };
}

/** @param {import('@playwright/test').BrowserContext} context */
async function mockOlistOrders(context) {
  const user = {
    id: 'finance-viewer',
    name: 'Operador sintético',
    email: 'financeiro@example.test',
    functionName: 'Financeiro',
    capabilities: [],
    olistEnabled: true,
    olistAuthorizationVersion: 2,
  };
  const state = {
    preview: /** @type {any} */ (readyPreview()),
    operation: /** @type {any} */ (null),
    failure: /** @type {{path:string,code:string,status:number}|null} */ (null),
    holdPreview: false,
  };
  /** @type {Array<{path:string,body:any,method:string}>} */
  const calls = [];
  /** @type {() => void} */
  let sendEvent = () => {};
  /** @type {() => void} */
  let releasePreview = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  const previewGate = new Promise((resolve) => {
    releasePreview = () => resolve(null);
  });
  await context.addCookies([
    { name: 'crm_csrf', value: 'olist-t12-csrf', url: 'http://127.0.0.1:4173' },
  ]);
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = ['POST', 'PATCH'].includes(method) ? req.postDataJSON() : null;
    calls.push({ path, body, method });
    const json = (/** @type {any} */ value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (path === '/api/v1/sessions/current') return json({ user });
    if (path === '/api/v1/events') {
      await eventGate;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\nevent: identity.user.changed\nid: t12-revoke\ndata: {"userId":"finance-viewer"}\n\n',
      });
    }
    if (path === '/api/v1/orders/summary') return json({ storeNewCount: 0 });
    if (state.failure?.path === path)
      return json(
        {
          code: state.failure.code,
          detail: 'provider-private-detail-canary',
          field: 'provider-private-field-canary',
        },
        state.failure.status,
      );
    if (method === 'POST') {
      expect(req.headers()['x-csrf-token']).toBe('olist-t12-csrf');
      expect(req.headers()['idempotency-key']).toBeTruthy();
    }
    if (path === '/api/v1/integrations/olist/order-lookup' || path === base)
      return json({
        orderId,
        number: '41-CRM',
        status: 'pendente',
        creationEnabled: false,
        pendingFields: [],
        operation: state.operation,
      });
    if (path === `${base}/preview`) {
      if (state.holdPreview) await previewGate;
      return json(state.preview);
    }
    if (path === `${base}/preview/check`)
      return json({
        valid: true,
        creationEnabled: false,
        expiresAt: state.preview.expiresAt,
      });
    if (path === '/api/v1/finance/orders')
      return json({
        items: [],
        counts: { waiting: 0, completed: 0 },
        nextCursor: null,
      });
    return json({
      columns: [],
      items: [],
      eventCursor: 'before-olist-t12',
      totals: {},
      period: {},
      mine: {},
      team: [],
    });
  });
  return {
    calls,
    state,
    releasePreview,
    revoke() {
      user.olistEnabled = false;
      user.olistAuthorizationVersion++;
      sendEvent();
    },
    event: sendEvent,
  };
}

/** @param {import('@playwright/test').Page} page */
async function locateOrder(page) {
  await page.clock.install({ time: now });
  await page.goto('/olist');
  await page.getByLabel('Número ou identificador do pedido').fill('41-CRM');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Pedido no Olist' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Atualizar estado Olist' }),
  ).toBeEnabled();
}

/** @param {import('@playwright/test').Page} page @param {string} path */
async function captureFromTop(page, path) {
  await page.evaluate(() => {
    if (globalThis.document.activeElement instanceof globalThis.HTMLElement)
      globalThis.document.activeElement.blur();
    globalThis.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true });
}

test('T12 restricted Financeiro reviews exact size subtotals by keyboard without commercial access or creation', async ({
  page,
  context,
}) => {
  const { calls } = await mockOlistOrders(context);
  await locateOrder(page);
  const panel = page.getByRole('region', { name: 'Pedido no Olist' });
  const review = panel.getByRole('button', { name: 'Conferir prévia Olist' });
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(
    panel.getByRole('heading', { name: 'Prévia pronta para conferência' }),
  ).toBeFocused();
  const groups = panel.locator('.order-olist-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Grupo 1 · CAMISETA · AZUL');
  await expect(groups.nth(0)).toContainText('3 peças · Subtotal R$ 105,00');
  await expect(groups.nth(1)).toContainText('2 peças · Subtotal R$ 50,00');
  await expect(panel.getByText('Total do pedido: R$ 155,00')).toBeVisible();
  await expect(panel.getByText(/documento com final 0019/u)).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Gerar no Olist', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Validar prévia atual' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    panel.getByText(
      'Prévia conferida nas versões atuais. A geração real continua desligada.',
    ),
  ).toBeFocused();
  await expect(
    page.getByRole('link', { name: 'Caixa de Entrada', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /Editar itens|Editar resumo|Reabrir pedido/u,
    }),
  ).toHaveCount(0);
  expect(
    calls
      .filter((call) => call.path === `${base}/preview/check`)
      .map((call) => call.body),
  ).toEqual([{ previewToken: 'synthetic-session-bound-receipt' }]);
  expect(
    calls.some((call) =>
      /\/export$|\/contacts|\/inbox|\/conversations|\/sections|\/price-breakdown/u.test(
        call.path,
      ),
    ),
  ).toBe(false);
  expect(calls.some((call) => call.path === `/api/v1/orders/${orderId}`)).toBe(
    false,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await captureFromTop(page, 'var/olist-t12-preview-desktop.png');
});

test('T12 preview errors stay fixed, preserve minimal access and require correction at the origin', async ({
  page,
  context,
}) => {
  const { state, calls } = await mockOlistOrders(context);
  state.preview = {
    ...readyPreview(),
    eligible: false,
    previewToken: null,
    expiresAt: null,
    issues: [
      { code: 'OLIST_BUYER_REQUIRED', field: 'buyer.registration.document' },
      {
        code: 'SIZE_SUBTOTAL_REVIEW_REQUIRED',
        field: `sizePricing.${groupId}.${lineId}`,
      },
      {
        code: 'provider-private-code-canary',
        field: 'provider-private-field-canary',
      },
    ],
  };
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  const panel = page.getByRole('region', { name: 'Pedido no Olist' });
  await expect(
    panel.getByRole('heading', { name: 'Pendências para o Olist' }),
  ).toBeFocused();
  await expect(panel).toContainText(
    'Complete o cadastro fiscal e o contato do comprador na origem.',
  );
  await expect(panel).toContainText(
    'A habilitação Olist não concede edição do pedido ou cadastro.',
  );
  await expect(page.getByText(/provider-private/u)).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
  expect(
    calls.some((call) =>
      /\/export$|\/sections|\/price-breakdown/u.test(call.path),
    ),
  ).toBe(false);
});

test('T12 stale preview is discarded and requires a new review', async ({
  page,
  context,
}) => {
  const { state, calls } = await mockOlistOrders(context);
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toBeVisible();
  state.failure = {
    path: `${base}/preview/check`,
    code: 'OLIST_PREVIEW_STALE',
    status: 409,
  };
  await page.getByRole('button', { name: 'Validar prévia atual' }).click();
  await expect(
    page.getByText(
      'A prévia mudou ou expirou. Confira uma nova prévia antes de continuar.',
    ),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
  await expect(page.getByText('Comprador sintético')).toHaveCount(0);
  state.failure = null;
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByRole('heading', { name: 'Prévia pronta para conferência' }),
  ).toBeFocused();
  expect(calls.filter((call) => call.path === `${base}/preview`)).toHaveLength(
    2,
  );
  expect(calls.some((call) => /\/export$/u.test(call.path))).toBe(false);
});

test('T12 preview expires locally and no token survives reload', async ({
  page,
  context,
}) => {
  const { state, calls } = await mockOlistOrders(context);
  state.preview.expiresAt = '2026-11-07T15:01:00.000Z';
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByRole('heading', { name: 'Prévia pronta para conferência' }),
  ).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(
    page.getByText('A prévia expirou. Confira uma nova prévia.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Número ou identificador do pedido').fill('41-CRM');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Pedido no Olist' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
  expect(calls.some((call) => call.path === `${base}/preview/check`)).toBe(
    false,
  );
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...globalThis.localStorage },
      session: { ...globalThis.sessionStorage },
    }),
  );
  expect(stored).not.toContain('synthetic-session-bound-receipt');
});

test('T12 two tabs recover the persisted operation and never offer repeat creation after uncertainty', async ({
  page,
  context,
}) => {
  const { state, calls } = await mockOlistOrders(context);
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByRole('heading', { name: 'Prévia pronta para conferência' }),
  ).toBeVisible();
  state.operation = { state: 'uncertain', stage: 'sale', number: null };
  const second = await context.newPage();
  await locateOrder(second);
  const secondPanel = second.getByRole('region', { name: 'Pedido no Olist' });
  await expect(secondPanel).toContainText(
    'Resultado incerto — não repetir a criação',
  );
  await expect(
    secondPanel.getByRole('button', { name: 'Conferir prévia Olist' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Atualizar estado Olist' }).click();
  await expect(
    page.getByRole('region', { name: 'Pedido no Olist' }),
  ).toContainText('Resultado incerto — não repetir a criação');
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Número ou identificador do pedido').fill('41-CRM');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Pedido no Olist' }),
  ).toContainText('Resultado incerto — não repetir a criação');
  expect(calls.filter((call) => call.path === `${base}/preview`)).toHaveLength(
    1,
  );
  expect(calls.some((call) => /\/export$/u.test(call.path))).toBe(false);
  await second.close();
});

test('T12 capability revocation discards an in-flight preview and private values cannot reappear', async ({
  page,
  context,
}) => {
  const { state, revoke, releasePreview, calls } =
    await mockOlistOrders(context);
  state.holdPreview = true;
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect
    .poll(() => calls.filter((call) => call.path === `${base}/preview`).length)
    .toBe(1);
  revoke();
  // Financeiro intentionally does not subscribe to the Inbox SSE stream.
  // Its existing 30-second session refresh must revoke the mounted lookup.
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole('heading', { name: 'Pedido no Olist' }),
  ).toHaveCount(0);
  releasePreview();
  await expect(page.getByText('Comprador sintético')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Validar prévia atual' }),
  ).toHaveCount(0);
});

test('T12 403 removes projection, blocks further consultations and never renders provider details', async ({
  page,
  context,
}) => {
  const { state, calls } = await mockOlistOrders(context);
  await locateOrder(page);
  state.failure = { path: `${base}/preview`, code: 'FORBIDDEN', status: 403 };
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByText(
      'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.',
    ),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Atualizar estado Olist' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Conferir prévia Olist' }),
  ).toBeDisabled();
  await expect(page.getByText(/provider-private/u)).toHaveCount(0);
  expect(calls.filter((call) => call.path === `${base}/preview`)).toHaveLength(
    1,
  );
});

test('T12 mobile and dark 320px preserve readable size subtotals, focus and reflow', async ({
  page,
  context,
}) => {
  await mockOlistOrders(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await locateOrder(page);
  await page.getByRole('button', { name: 'Conferir prévia Olist' }).click();
  await expect(
    page.getByRole('heading', { name: 'Prévia pronta para conferência' }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await captureFromTop(page, 'var/olist-t12-preview-mobile.png');
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  await page.setViewportSize({ width: 320, height: 700 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await captureFromTop(page, 'var/olist-t12-preview-dark-320.png');
});
