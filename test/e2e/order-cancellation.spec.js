import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  confirmedOrder,
  mockOrders,
  ownConfirmedOrder,
  pendingOrder,
} from './support/orders-mock.js';

/** @param {import('@playwright/test').Page} page @param {any} [options] */
async function cancellationFixture(page, options = {}) {
  const user = {
    id: 'seller-marina',
    name: 'Marina Aguiar',
    functionName: 'Vendedor',
    email: 'marina@example.test',
    capabilities: [],
    olistEnabled: false,
    ...options.user,
  };
  const state = {
    order: structuredClone(options.order ?? ownConfirmedOrder),
    operation: options.operation ?? null,
    commercialLocked: options.commercialLocked ?? Boolean(options.operation),
    cancellationBlocked:
      options.cancellationBlocked ?? Boolean(options.operation),
    projectionCancelled: /** @type {boolean|null} */ (null),
    failure: /** @type {any} */ (null),
    hold: false,
  };
  /** @type {Array<{body:any,key:string|undefined,csrf:string|undefined}>} */
  const cancellations = [];
  /** @type {Array<{path:string,method:string}>} */
  const calls = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  await mockOrders(page, { orders: [state.order] });
  await page.context().addCookies([
    {
      name: 'crm_csrf',
      value: 't13-cancel-csrf',
      url: String(test.info().project.use.baseURL),
    },
  ]);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({ path, method: req.method() });
    if (path === '/api/v1/sessions/current')
      return route.fulfill({ json: { user } });
    if (path === `/api/v1/orders/${state.order.id}` && req.method() === 'GET')
      return route.fulfill({ json: { order: state.order } });
    if (path === `/api/v1/orders/${state.order.id}/olist`)
      return route.fulfill({
        json: {
          orderId: state.order.id,
          number: state.order.number,
          status: state.order.status,
          operation: state.operation,
          cancelled:
            state.projectionCancelled ?? Boolean(state.order.cancelledAt),
          commercialLocked: state.commercialLocked,
          cancellationBlocked: state.cancellationBlocked,
          creationEnabled: false,
          pendingFields: [],
        },
      });
    if (path === `/api/v1/orders/${state.order.id}/cancel`) {
      cancellations.push({
        body: req.postDataJSON(),
        key: req.headers()['idempotency-key'],
        csrf: req.headers()['x-csrf-token'],
      });
      if (state.hold) await gate;
      if (state.failure === 'transport') return route.abort('failed');
      if (state.failure)
        return route.fulfill({
          status: state.failure.status,
          contentType: 'application/problem+json',
          json: {
            code: state.failure.code,
            detail: 'private-provider-detail-canary',
          },
        });
      state.order = {
        ...state.order,
        cancelledAt: '2026-11-07T15:30:00.000Z',
        cancelledBy: { id: user.id, name: user.name },
        cancellationReason: req.postDataJSON().reason,
        effectiveStatus: 'cancelado',
        locked: true,
        version: state.order.version + 1,
      };
      return route.fulfill({ json: { order: state.order } });
    }
    return route.fallback();
  });
  return { state, cancellations, calls, release };
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function openOrder(page, id) {
  await page.goto(`/pedidos/${id}`);
  await expect(
    page.getByRole('heading', { name: /^Pedido \d+-CRM$/u }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Atualizar estado Olist' }),
  ).toBeEnabled();
  const cancellation = page.getByText('Cancelamento local', { exact: true });
  if (await cancellation.count()) {
    await cancellation.focus();
    await page.keyboard.press('Enter');
  }
}

test('T13 owner cancels without Olist checkbox by keyboard, preserving paid history and terminal state after reload', async ({
  page,
}) => {
  const { state, cancellations, calls } = await cancellationFixture(page);
  const before = structuredClone(state.order);
  await openOrder(page, state.order.id);
  const trigger = page.getByRole('button', {
    name: 'Cancelar pedido localmente',
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Cancelar pedido localmente?',
  });
  const reason = dialog.getByLabel('Motivo do cancelamento');
  await expect(reason).toBeFocused();
  await reason.fill('Pedido encerrado a pedido do cliente sintético.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'var/olist-t13-cancellation-dialog-desktop.png',
    fullPage: false,
  });
  await dialog
    .getByRole('button', { name: 'Cancelar definitivamente' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  const heading = page.getByRole('heading', {
    name: 'Pedido cancelado',
    exact: true,
  });
  await expect(heading).toBeFocused();
  expect(cancellations).toHaveLength(1);
  expect(cancellations[0].body).toEqual({
    expectedVersion: before.version,
    reason: 'Pedido encerrado a pedido do cliente sintético.',
  });
  expect(cancellations[0].key).toBeTruthy();
  expect(cancellations[0].csrf).toBe('t13-cancel-csrf');
  expect(state.order.status).toBe(before.status);
  expect(state.order.ficha).toEqual(before.ficha);
  expect(state.order.paidOn).toBe(before.paidOn);
  expect(state.order.finalAmountCents).toBe(before.finalAmountCents);
  await expect(
    page.getByRole('region', { name: 'Pedido cancelado' }),
  ).toContainText('Marina Aguiar');
  await expect(page.getByText(/"id"|seller-marina/u)).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /Editar|Reabrir pedido|Conferir prévia Olist|Cancelar pedido localmente/u,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page.locator('.op-status')).toHaveText('Cancelado');
  await expect(
    page.getByRole('button', {
      name: /Editar|Reabrir pedido|Conferir prévia Olist|Cancelar pedido localmente/u,
    }),
  ).toHaveCount(0);
  expect(cancellations).toHaveLength(1);
  expect(
    calls.some((call) => /\/export$|\/reopen$|\/sections\//u.test(call.path)),
  ).toBe(false);
});

test('T13 only commercial owner or administrator sees local cancellation, independently of Olist grant', async ({
  page,
}) => {
  const { state } = await cancellationFixture(page, {
    order: confirmedOrder,
    user: { olistEnabled: true },
  });
  await openOrder(page, state.order.id);
  await expect(
    page.getByRole('button', {
      name: 'Cancelar pedido localmente',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('T13 cancellation dialog retains focus, contrast and reflow on a dark 320px viewport', async ({
  page,
}) => {
  const { state, cancellations } = await cancellationFixture(page, {
    order: pendingOrder,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await openOrder(page, state.order.id);
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  await page
    .getByRole('button', { name: 'Cancelar pedido localmente', exact: true })
    .click();
  await expect(page.getByLabel('Motivo do cancelamento')).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(320);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'var/olist-t13-cancellation-dialog-dark-320.png',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Cancelar pedido localmente',
      exact: true,
    }),
  ).toBeFocused();
  expect(cancellations).toHaveLength(0);
});

for (const admin of [false, true]) {
  test(`T13 store local cancellation ${admin ? 'is available to administrator' : 'is hidden from seller even with Olist grant'}`, async ({
    page,
  }) => {
    const store = {
      ...ownConfirmedOrder,
      id: 'cancel-store-synthetic',
      origin: 'loja',
      locked: true,
      seller: null,
      gatewayPayment: {
        source: 'infinitepay',
        confirmedAt: '2026-09-10T15:00:00.000Z',
        paidAmountCents: 118000,
      },
      ficha: {
        ...ownConfirmedOrder.ficha,
        loja: {
          produto: {
            nome: 'Camiseta sintética',
            slug: 'camisa-masculina-lisa',
          },
          telefone: '5527900000001',
        },
      },
    };
    const { state } = await cancellationFixture(page, {
      order: store,
      user: {
        id: 'different-seller',
        olistEnabled: !admin,
        capabilities: admin ? ['COMMERCIAL_ADMIN'] : [],
      },
    });
    await openOrder(page, state.order.id);
    const trigger = page.getByRole('button', {
      name: 'Cancelar pedido localmente',
      exact: true,
    });
    if (admin) await expect(trigger).toBeVisible();
    else await expect(trigger).toHaveCount(0);
  });
}

for (const operationState of ['reserved', 'confirmed', 'linked', 'uncertain']) {
  test(`T13 ${operationState} sale never offers local cancellation, editing or repeat creation`, async ({
    page,
  }) => {
    const { state, calls } = await cancellationFixture(page, {
      operation: {
        state: operationState,
        stage: 'sale',
        number: operationState === 'linked' ? '99' : null,
      },
      commercialLocked: true,
      cancellationBlocked: true,
    });
    await openOrder(page, state.order.id);
    await expect(
      page
        .getByRole('button', {
          name: /Cancelar pedido localmente|Editar|Reabrir pedido|Conferir prévia Olist/u,
        })
        .filter({ hasNotText: 'Editar datas' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Editar datas', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Uma venda reservada, enviada, vinculada ou incerta impede/u,
      ),
    ).toBeVisible();
    expect(
      calls.some((call) => /\/export$|\/cancel$|\/reopen$/u.test(call.path)),
    ).toBe(false);
  });
}

test('T13 customer or product work freezes commercial editing but permits cancellation before a sale effect', async ({
  page,
}) => {
  const { state, cancellations } = await cancellationFixture(page, {
    operation: { state: 'resolving', stage: 'product', number: null },
    commercialLocked: true,
    cancellationBlocked: false,
  });
  await openOrder(page, state.order.id);
  await expect(
    page
      .getByRole('button', { name: /Editar|Reabrir pedido/u })
      .filter({ hasNotText: 'Editar datas' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Editar datas', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cancelar pedido localmente', exact: true })
    .click();
  await page
    .getByLabel('Motivo do cancelamento')
    .fill('Encerramento antes da venda.');
  await page.getByRole('button', { name: 'Cancelar definitivamente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pedido cancelado', exact: true }),
  ).toBeVisible();
  expect(cancellations).toHaveLength(1);
});

test('T13 cancellation discovered by the minimal projection blocks stale commercial actions from another tab', async ({
  page,
}) => {
  const { state, cancellations } = await cancellationFixture(page);
  await openOrder(page, state.order.id);
  await expect(
    page.getByRole('button', {
      name: 'Cancelar pedido localmente',
      exact: true,
    }),
  ).toBeVisible();
  state.projectionCancelled = true;
  await page.getByRole('button', { name: 'Atualizar estado Olist' }).click();
  await expect(
    page.getByRole('button', {
      name: 'Cancelar pedido localmente',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('button', {
        name: /Editar|Reabrir pedido|Conferir prévia Olist/u,
      })
      .filter({ hasNotText: 'Editar datas' }),
  ).toHaveCount(0);
  expect(cancellations).toHaveLength(0);
});

test('T13 Escape restores the cancellation trigger and conflict requires a fresh versioned decision', async ({
  page,
}) => {
  const { state, cancellations } = await cancellationFixture(page, {
    order: pendingOrder,
  });
  await openOrder(page, state.order.id);
  const trigger = page.getByRole('button', {
    name: 'Cancelar pedido localmente',
    exact: true,
  });
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(cancellations).toHaveLength(0);
  await trigger.click();
  await page.getByLabel('Motivo do cancelamento').fill('Decisão sintética.');
  state.failure = { status: 409, code: 'VERSION_CONFLICT' };
  await page.getByRole('button', { name: 'Cancelar definitivamente' }).click();
  await expect(page.getByRole('alert')).toContainText('O pedido mudou.');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Cancelar definitivamente' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Motivo do cancelamento')).toBeDisabled();
  await expect(page.getByText('private-provider-detail-canary')).toHaveCount(0);
  expect(cancellations).toHaveLength(1);
  state.failure = null;
  state.order.version++;
  await page
    .getByRole('button', { name: 'Atualizar pedido', exact: true })
    .click();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page
    .getByLabel('Motivo do cancelamento')
    .fill('Nova decisão após revisão.');
  await page.getByRole('button', { name: 'Cancelar definitivamente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pedido cancelado', exact: true }),
  ).toBeVisible();
  expect(cancellations).toHaveLength(2);
  expect(cancellations[1].body.expectedVersion).toBe(pendingOrder.version + 1);
  expect(cancellations[1].key).not.toBe(cancellations[0].key);
});

test('T13 transport uncertainty makes one command and requires checking persisted state before another decision', async ({
  page,
}) => {
  const { state, cancellations } = await cancellationFixture(page);
  state.failure = 'transport';
  await openOrder(page, state.order.id);
  await page
    .getByRole('button', { name: 'Cancelar pedido localmente', exact: true })
    .click();
  await page
    .getByLabel('Motivo do cancelamento')
    .fill('Encerramento sintético.');
  await page.getByRole('button', { name: 'Cancelar definitivamente' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Não foi possível confirmar o cancelamento.',
  );
  await expect(
    page.getByRole('button', { name: 'Cancelar definitivamente' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Atualizar pedido', exact: true }),
  ).toBeVisible();
  expect(cancellations).toHaveLength(1);
});

test('T13 cancellation in flight cannot be dismissed or submitted twice', async ({
  page,
}) => {
  const { state, cancellations, release } = await cancellationFixture(page);
  state.hold = true;
  await openOrder(page, state.order.id);
  await page
    .getByRole('button', { name: 'Cancelar pedido localmente', exact: true })
    .click();
  await page
    .getByLabel('Motivo do cancelamento')
    .fill('Encerramento sintético.');
  await page.getByRole('button', { name: 'Cancelar definitivamente' }).click();
  await expect.poll(() => cancellations.length).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Cancelando…' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Voltar', exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole('heading', { name: 'Pedido cancelado', exact: true }),
  ).toBeVisible();
  expect(cancellations).toHaveLength(1);
});

test('T13 cancelled history filters GET and private phone search with cancellation instead of an invalid commercial status', async ({
  page,
}) => {
  const cancelled = {
    ...pendingOrder,
    cancelledAt: '2026-11-07T15:30:00.000Z',
    cancelledBy: { id: 'seller-marina', name: 'Marina Aguiar' },
    cancellationReason: 'Encerrado.',
    locked: true,
  };
  await mockOrders(page, { orders: [cancelled] });
  await page.context().addCookies([
    {
      name: 'crm_csrf',
      value: 't13-filter-csrf',
      url: String(test.info().project.use.baseURL),
    },
  ]);
  /** @type {URLSearchParams[]} */ const lists = [];
  /** @type {any[]} */ const searches = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/api/v1/orders' && req.method() === 'GET')
      lists.push(url.searchParams);
    else if (url.pathname === '/api/v1/orders/search')
      searches.push(req.postDataJSON());
    else return route.fallback();
    return route.fulfill({
      json: {
        items: [cancelled],
        counts: { pendente: 1, confirmado: 0 },
        nextCursor: null,
      },
    });
  });
  await page.goto('/pedidos?cancelamento=cancelados');
  await expect(
    page.getByRole('heading', { name: /^Cancelados · pendentes/u }),
  ).toBeVisible();
  expect(lists[0].get('cancellation')).toBe('cancelled');
  expect(lists[0].has('status')).toBe(false);
  await expect(
    page.locator('tbody tr').filter({ hasText: '07-CRM' }),
  ).toContainText('Cancelado');
  await page
    .getByLabel('Buscar número, cliente ou telefone')
    .fill('5527900000001');
  await expect.poll(() => searches.length).toBe(1);
  expect(searches[0]).toMatchObject({
    q: '5527900000001',
    cancellation: 'cancelled',
  });
  expect(searches[0]).not.toHaveProperty('status');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'var/olist-t13-cancelled-history-dark-320.png',
    fullPage: true,
  });
});
