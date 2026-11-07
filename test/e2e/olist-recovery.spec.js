import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOrders, pendingOrder } from './support/orders-mock.js';

const resourceId = '5197961a-3ce5-4388-9a4f-0675386795ec';
const base = `/api/v1/orders/${pendingOrder.id}/olist`;
const now = new Date('2026-11-07T15:00:00Z');
/** @param {import('@playwright/test').Page} page */
async function setup(page) {
  await page.clock.install({ time: now });
  await page
    .context()
    .addCookies([
      { name: 'crm_csrf', value: 't13-csrf', url: 'http://127.0.0.1' },
    ]);
  await mockOrders(page, { orders: [pendingOrder] });
  const user = {
    id: 'seller-marina',
    name: 'Operador sintético',
    functionName: 'Vendedor',
    capabilities: ['COMMERCIAL_ADMIN'],
    olistEnabled: false,
  };
  /** @type {any} */
  const state = {
    operation: null,
    diagnostic: {
      operation: null,
      resources: [],
      attempts: [],
      requests: [],
      attemptHistoryTruncated: false,
    },
    failure: null,
    hold: false,
  };
  /** @type {any[]} */
  const calls = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  await page.route('**/api/v1/sessions/current', (route) =>
    route.fulfill({ json: { user } }),
  );
  await page.route(`**${base}**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postDataJSON();
    calls.push({ path, method: req.method(), body });
    if (req.method() === 'POST') {
      expect(req.headers()['x-csrf-token']).toBe('t13-csrf');
      expect(req.headers()['idempotency-key']).toBeTruthy();
    }
    if (state.failure?.path === path)
      return route.fulfill({
        status: state.failure.status,
        json: { code: state.failure.code, detail: 'private-provider-canary' },
      });
    if (path === base)
      return route.fulfill({
        json: {
          orderId: pendingOrder.id,
          number: pendingOrder.number,
          status: pendingOrder.status,
          cancelled: false,
          commercialLocked: !!state.operation,
          cancellationBlocked: !!state.operation,
          operation: state.operation,
          creationEnabled: false,
        },
      });
    if (path.endsWith('/administration'))
      return route.fulfill({ json: state.diagnostic });
    if (path.endsWith('/existing/previews')) {
      if (state.hold) await gate;
      return route.fulfill({
        json: {
          orderId: pendingOrder.id,
          eligible: true,
          sale: { id: body.saleId, number: '901' },
          versions: { order: pendingOrder.version, operation: 0 },
          previewToken: 'synthetic-t13-private-receipt',
          expiresAt: new Date(now.getTime() + 60000).toISOString(),
          creationEnabled: false,
        },
      });
    }
    if (path.endsWith('/links')) {
      state.operation = { state: 'linked', stage: 'complete', number: '901' };
      state.diagnostic.operation = {
        ...state.operation,
        id: 'operation-synthetic',
        actorId: user.id,
        version: 3,
      };
      return route.fulfill({
        json: {
          orderId: pendingOrder.id,
          operationId: 'operation-synthetic',
          ...state.operation,
          creationEnabled: false,
        },
      });
    }
    if (path.endsWith('/reconcile')) {
      const entry = {
        id: 'synthetic-request',
        requestId: 'synthetic-request',
        stage: body.stage,
        resourceId: body.resourceId,
        version: 1,
        status: 'queued',
      };
      state.diagnostic.requests = [entry];
      return route.fulfill({ status: 202, json: entry });
    }
    if (path.endsWith('/reconciliations/synthetic-request'))
      return route.fulfill({
        json: {
          ...state.diagnostic.requests[0],
          status: 'blocked',
          code: 'OLIST_RESOURCE_NOT_FOUND',
        },
      });
    throw new Error(`Unexpected Olist request: ${path}`);
  });
  return { state, user, calls, release };
}
/** @param {import('@playwright/test').Page} page */
async function open(page) {
  await page.goto(`/pedidos/${pendingOrder.id}`);
  await page
    .getByText('Progresso, vínculo e histórico Olist', { exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Progresso por etapa' }),
  ).toBeFocused();
}

test('T13 administrator without checkbox links only after a fresh server review, reload recovers state', async ({
  page,
}) => {
  const { calls } = await setup(page);
  await open(page);
  await expect(
    page.getByRole('button', { name: 'Conferir prévia Olist' }),
  ).toHaveCount(0);
  await page.getByText('Vincular venda já existente', { exact: true }).click();
  await page.getByLabel('ID da venda existente no Olist').fill('701');
  await page.getByRole('button', { name: 'Conferir venda existente' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Venda existente conferida' }),
  ).toBeFocused();
  await page
    .getByLabel('Motivo do vínculo')
    .fill('Pedido já registrado; conferência humana.');
  await page
    .getByRole('button', { name: 'Confirmar vínculo existente' })
    .click();
  await expect(
    page.getByText(/Venda existente vinculada. Atualize/),
  ).toBeVisible();
  await expect(
    page.getByText('Venda existente vinculada', { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancelar pedido localmente' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Pedido no Olist' }),
  ).toContainText('Venda existente vinculada');
  expect(calls.filter((call) => call.path.endsWith('/links'))).toHaveLength(1);
  expect(calls.some((call) => call.path.endsWith('/export'))).toBe(false);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      ...globalThis.localStorage,
      ...globalThis.sessionStorage,
    }),
  );
  expect(stored).not.toContain('synthetic-t13-private-receipt');
});

test('T13 changing sale ID and local expiry discard the review token', async ({
  page,
}) => {
  const { calls } = await setup(page);
  await open(page);
  await page.getByText('Vincular venda já existente', { exact: true }).click();
  await page.getByLabel('ID da venda existente no Olist').fill('701');
  await page.getByRole('button', { name: 'Conferir venda existente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Venda existente conferida' }),
  ).toBeVisible();
  await page.getByLabel('ID da venda existente no Olist').fill('702');
  await expect(
    page.getByRole('button', { name: 'Confirmar vínculo existente' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Conferir venda existente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Venda existente conferida' }),
  ).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(
    page.getByText(
      'A conferência expirou. Confira a venda existente novamente.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirmar vínculo existente' }),
  ).toHaveCount(0);
  expect(calls.filter((call) => call.path.endsWith('/links'))).toHaveLength(0);
});

test('T13 per-resource uncertainty uses exact target and version, explicit result never creates', async ({
  page,
}) => {
  const { state, calls } = await setup(page);
  state.operation = { state: 'resolving', stage: 'variation' };
  state.diagnostic = {
    operation: {
      ...state.operation,
      id: 'operation-synthetic',
      actorId: 'seller-marina',
      version: 7,
    },
    resources: [
      {
        id: resourceId,
        kind: 'variation',
        state: 'uncertain',
        version: 9,
        remoteId: null,
        parentId: 'synthetic-parent',
      },
      {
        id: 'synthetic-parent',
        kind: 'product',
        state: 'confirmed',
        version: 3,
        remoteId: '702',
        parentId: null,
      },
    ],
    attempts: [
      {
        id: 'synthetic-attempt',
        stage: 'variation',
        resourceId,
        outcome: 'uncertain',
        createdAt: now.toISOString(),
        observedRemoteId: '703',
      },
    ],
    requests: [],
    attemptHistoryTruncated: true,
  };
  await open(page);
  await expect(
    page.getByRole('region', { name: 'Pedido no Olist' }),
  ).toContainText('Etapa atual: Tamanho');
  // The resource remains uncertain; no sale effect has been reserved.
  await page
    .getByText('Solicitar reconciliação por leitura', { exact: true })
    .click();
  await page.getByLabel('Etapa a conferir').selectOption(resourceId);
  await page
    .getByLabel('Motivo da reconciliação')
    .fill('Conferir resultado incerto.');
  await page
    .getByRole('button', { name: 'Solicitar reconciliação', exact: true })
    .click();
  await expect(
    page.getByText(/Reconciliação solicitada. A consulta só lê/),
  ).toBeVisible();
  expect(calls.find((call) => call.path.endsWith('/reconcile')).body).toEqual({
    stage: 'variation',
    resourceId,
    expectedVersion: 9,
    reason: 'Conferir resultado incerto.',
  });
  await page.getByRole('button', { name: 'Atualizar acompanhamento' }).click();
  await page
    .getByText('Histórico de operações e consultas', { exact: true })
    .click();
  await expect(
    page.getByText(/Exibindo as 100 tentativas mais recentes/),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Consultar resultado da reconciliação synthetic-request',
    })
    .click();
  await expect(
    page.getByText(/Sem prova suficiente — análise necessária. Atualize/),
  ).toBeVisible();
  expect(calls.filter((call) => call.path.endsWith('/reconcile'))).toHaveLength(
    1,
  );
  expect(calls.some((call) => /\/(?:export|links)$/u.test(call.path))).toBe(
    false,
  );
});

for (const failure of [
  { status: 409, code: 'OLIST_SALE_DIVERGENT' },
  { status: 403, code: 'FORBIDDEN' },
  { status: 429, code: 'OLIST_RATE_LIMITED' },
]) {
  test(`T13 existing sale ${failure.status} is safe, redacted and focused`, async ({
    page,
  }) => {
    const { state, calls } = await setup(page);
    await open(page);
    await page
      .getByText('Vincular venda já existente', { exact: true })
      .click();
    await page.getByLabel('ID da venda existente no Olist').fill('701');
    state.failure = { ...failure, path: `${base}/existing/previews` };
    await page
      .getByRole('button', { name: 'Conferir venda existente' })
      .click();
    await expect(page.locator('.olist-recovery [role=alert]')).toBeFocused();
    await expect(page.locator('body')).not.toContainText(
      'private-provider-canary',
    );
    await expect(
      page.getByRole('button', { name: 'Confirmar vínculo existente' }),
    ).toHaveCount(0);
    expect(calls.some((call) => /\/(?:export|links)$/u.test(call.path))).toBe(
      false,
    );
  });
}

test('T13 closing disclosure cancels a late review and cannot restore receipt', async ({
  page,
}) => {
  const { state, release } = await setup(page);
  await open(page);
  state.hold = true;
  await page.getByText('Vincular venda já existente', { exact: true }).click();
  await page.getByLabel('ID da venda existente no Olist').fill('701');
  await page.getByRole('button', { name: 'Conferir venda existente' }).click();
  await page
    .getByText('Progresso, vínculo e histórico Olist', { exact: true })
    .click();
  release();
  await page
    .getByText('Progresso, vínculo e histórico Olist', { exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirmar vínculo existente' }),
  ).toHaveCount(0);
});

test('T13 a parent permission failure removes already loaded administrative history', async ({
  page,
}) => {
  const { state } = await setup(page);
  state.operation = { state: 'linked', stage: 'complete', number: 'S-901' };
  state.diagnostic.operation = {
    ...state.operation,
    id: 'private-operation-canary',
    actorId: 'seller-marina',
    version: 4,
  };
  state.diagnostic.resources = [
    {
      id: resourceId,
      kind: 'customer',
      state: 'confirmed',
      version: 2,
      remoteId: '1234567890123456789',
    },
  ];
  await open(page);
  await page
    .getByText('Histórico de operações e consultas', { exact: true })
    .click();
  await expect(
    page.getByText(/Operação: private-operation-canary/),
  ).toBeVisible();
  await expect(
    page.getByText('ID no Olist: 1234567890123456789', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Pedido no Olist' }),
  ).toContainText('Venda S-901');
  state.failure = { path: base, status: 403, code: 'FORBIDDEN' };
  await page.getByRole('button', { name: 'Atualizar estado Olist' }).click();
  await expect(
    page.getByText(/Seu acesso mudou ou sua sessão expirou/),
  ).toBeVisible();
  await expect(page.getByText(/private-operation-canary/)).toHaveCount(0);
  await expect(
    page.getByText('Progresso, vínculo e histórico Olist', { exact: true }),
  ).toHaveCount(0);
});

test('T13 checkbox without administrative capability sees only the persisted current stage', async ({
  page,
}) => {
  const { state, user, calls } = await setup(page);
  user.capabilities = [];
  user.olistEnabled = true;
  state.operation = { state: 'uncertain', stage: 'sale', number: null };
  await page.goto(`/pedidos/${pendingOrder.id}`);
  const panel = page.getByRole('region', { name: 'Pedido no Olist' });
  await expect(panel).toContainText('Etapa atual: Venda');
  await expect(panel).toContainText(
    'Resultado incerto — não repetir a criação',
  );
  await expect(
    page.getByText('Progresso, vínculo e histórico Olist', { exact: true }),
  ).toHaveCount(0);
  expect(calls.some((call) => call.path.endsWith('/administration'))).toBe(
    false,
  );
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`T13 recovery keyboard axe and reflow at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    if (viewport.width === 320)
      await page.addInitScript(() =>
        globalThis.localStorage.setItem('silmer-theme', 'dark'),
      );
    await open(page);
    if (viewport.width === 320)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page
      .getByText('Vincular venda já existente', { exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('ID da venda existente no Olist').fill('701');
    await page
      .getByRole('button', { name: 'Conferir venda existente' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Venda existente conferida' }),
    ).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include('.order-olist').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `var/olist-t13-recovery-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
