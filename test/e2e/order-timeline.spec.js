import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  eventStreamBody,
  mockOrders,
  ownConfirmedOrder,
} from './support/orders-mock.js';

/** @param {string} id @param {string} source @param {string} day @param {number} amountCents @param {Record<string, any>} [extra] */
const receipt = (id, source, day, amountCents, extra = {}) => ({
  id: `receipt:${source}:${id}`,
  receiptId: id,
  kind: 'receipt',
  source,
  day,
  dateBasis: source === 'external' ? 'effective_day' : 'crm_verification',
  occurredAt: source === 'external' ? null : `${day}T15:00:00.000Z`,
  recordedAt: `${day}T15:00:00.000Z`,
  method: source === 'external' ? 'bank_transfer' : 'pix',
  amountCents,
  appliedAmountCents: amountCents,
  status: 'active',
  actorName: source === 'external' ? 'Marina de demonstração' : null,
  ...extra,
});

/** @param {import('@playwright/test').Page} page @param {any} [options] */
async function setup(page, options = {}) {
  const order = {
    ...structuredClone(ownConfirmedOrder),
    origin: 'atendimento',
    paidOn: null,
    finalAmountCents: 10000,
    orderDate: '2026-11-08',
    confirmedAt: '2026-11-08T15:00:00Z',
    firstContactAt: '2026-11-06T15:00:00Z',
    ...options.order,
  };
  const second = {
    ...structuredClone(order),
    id: 'order-second',
    number: '98-CRM',
    firstContactAt: '2026-11-07T12:00:00Z',
  };
  await mockOrders(page, { orders: [order, second] });
  await page.route('**/api/v1/orders/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (id === order.id || id === second.id)
      return route.fulfill({
        json: { order: id === order.id ? order : second },
      });
    return route.fallback();
  });
  const billing = {
    version: 1,
    orderVersion: order.version,
    percent: 30,
    canManage: true,
    managed: true,
    enabled: true,
    totalAmountCents: 10000,
    receivedAmountCents: 3000,
    balanceAmountCents: 7000,
    charges: [],
    timelineEvents: [receipt('ip', 'infinitepay', '2026-11-09', 3000)],
    ...options.billing,
  };
  /** @type {any[]} */
  const writes = [];
  let reads = 0,
    mode = options.mode ?? 'ok';
  await page.context().addCookies([
    {
      name: 'crm_csrf',
      value: 'synthetic-timeline-csrf',
      url: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`,
    },
  ]);
  await page.route('**/api/v1/orders/*/billing', async (route) => {
    reads++;
    if (mode === 'error')
      return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    if (mode === 'missing')
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
    return route.fulfill({ json: { billing } });
  });
  await page.route(
    '**/api/v1/orders/*/delivery-confirmation',
    async (route) => {
      const req = route.request();
      writes.push({
        body: req.postDataJSON(),
        key: req.headers()['idempotency-key'],
        csrf: req.headers()['x-csrf-token'],
        path: new URL(req.url()).pathname,
      });
      if (options.deliveryGate) await options.deliveryGate;
      if (mode === 'conflict') {
        order.version++;
        billing.orderVersion = order.version;
        return route.fulfill({
          status: 409,
          json: { code: 'VERSION_CONFLICT' },
        });
      }
      if (mode === 'lost') return route.abort('failed');
      Object.assign(order, {
        deliveredOn: req.postDataJSON().deliveredOn ?? '2026-11-11',
        version: order.version + 1,
      });
      Object.assign(billing, {
        orderVersion: order.version,
        deliveryConfirmation: {
          day: order.deliveredOn,
          confirmedAt: '2026-11-11T15:00:00Z',
          actorName: 'Marina de demonstração',
        },
      });
      return route.fulfill({ json: { order } });
    },
  );
  return {
    order,
    billing,
    writes,
    get reads() {
      return reads;
    },
    /** @param {string} value */
    setMode(value) {
      mode = value;
    },
  };
}

/** @param {import('@playwright/test').Page} page */
const sectionFor = (page) =>
  page.getByRole('region', { name: 'Datas do pedido', exact: true });
/** @param {import('@playwright/test').Page} page */
const deliveryFor = (page) =>
  page.getByRole('dialog', { name: 'Confirmar entrega', exact: true });

test('DTL: mixed receipts render once in the horizontal timeline with shared billing read', async ({
  page,
}) => {
  const manual = receipt('manual', 'external', '2026-11-10', 7000, {
    recordedAt: '2026-11-11T12:00:00Z',
  });
  const mock = await setup(page, {
    order: { paidOn: '2026-11-10' },
    billing: {
      receivedAmountCents: 10000,
      balanceAmountCents: 0,
      timelineEvents: [
        receipt('ip', 'infinitepay', '2026-11-09', 3000),
        manual,
      ],
      payments: [{ id: 'manual' }],
      externalReceipts: [{ id: 'manual' }],
    },
  });
  // PED-RD-04: horizontal only while the chapter container is wider than 30rem.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await expect(section.locator('.order-timeline li')).toHaveCount(4);
  await expect(section).toContainText('Pedido confirmado');
  await expect(section).toContainText('InfinitePay');
  await expect(section).toContainText('Recebimento manual');
  await expect(section.locator('.order-timeline')).toContainText('R$ 70,00');
  await expect(section.locator('dl')).toHaveCount(0);
  await expect(
    section.getByRole('heading', { name: 'Linha do tempo' }),
  ).toHaveCount(0);
  const boxes = await section.locator('.order-timeline li').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );
  expect(
    boxes.every(
      (b, i) =>
        i === 0 || (b.x > boxes[i - 1].x && Math.abs(b.y - boxes[0].y) < 2),
    ),
  ).toBe(true);
  // The existing compact billing workspace also reads its summary/history.
  // Dates reuse the outer billing snapshot and add no third summary request.
  expect(mock.reads).toBe(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('DTL: event titles open read-only details in an accessible modal and restore keyboard focus', async ({
  page,
}) => {
  const mock = await setup(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await section.getByRole('button', { name: /Datas do pedido/ }).click();
  await expect(section.locator('summary')).toHaveCount(0);
  const readsBeforeDetails = mock.reads;
  const trigger = section.getByRole('button', {
    name: 'Pedido confirmado',
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Pedido confirmado',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Confirmação registrada em');
  await expect(
    dialog.getByRole('button', { name: 'Fechar', exact: true }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().width <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const receiptTitle = section.getByRole('button', {
    name: 'Pagamento confirmado',
    exact: true,
  });
  await receiptTitle.focus();
  await page.keyboard.press('Space');
  const receiptDialog = page.getByRole('dialog', {
    name: 'Pagamento confirmado',
    exact: true,
  });
  await expect(receiptDialog).toContainText('R$ 30,00');
  await expect(receiptDialog).toContainText('instante efetivo da transação');
  await receiptDialog
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  await expect(receiptTitle).toBeFocused();
  expect(mock.writes).toEqual([]);
  expect(mock.reads).toBe(readsBeforeDetails);
});

test('DTL: delivery uses a frozen version and server day, preserving partial payment', async ({
  page,
}) => {
  const mock = await setup(page);
  await page.clock.setFixedTime(new Date('2026-11-10T20:00:00Z'));
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page),
    trigger = section.getByRole('button', {
      name: 'Confirmar entrega',
      exact: true,
    }),
    dialog = deliveryFor(page);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Cancelar', exact: true }),
  ).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(mock.writes).toEqual([]);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(mock.writes).toEqual([]);
  await trigger.click();
  await dialog
    .getByRole('button', { name: 'Sim, confirmar entrega', exact: true })
    .click();
  await expect(
    section.getByText('Pedido entregue', { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText('Pedido entregue', { exact: true }),
  ).toBeFocused();
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0].body).toEqual({ expectedVersion: 4 });
  expect(mock.writes[0].key).toBeTruthy();
  expect(mock.writes[0].csrf).toBe('synthetic-timeline-csrf');
  await expect(
    section
      .locator('.order-timeline li')
      .filter({ hasText: 'Pedido entregue' }),
  ).toContainText('11/11/2026');
  await expect(trigger).toHaveCount(0);
  await expect(
    section.getByRole('button', {
      name: 'Alterar data de entrega',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    section.getByRole('button', { name: 'Editar datas' }),
  ).toHaveCount(0);
  expect(mock.order.paidOn).toBeNull();
  expect(mock.billing.balanceAmountCents).toBe(7000);
  expect(mock.order.status).toBe('confirmado');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('DDE: one header action corrects only the existing delivery date with keyboard and mobile support', async ({
  page,
}) => {
  const mock = await setup(page, {
    order: {
      deliveredOn: '2026-11-10',
      conversationId: null,
      manualOwnerId: 'seller-marina',
    },
  });
  await page.clock.setFixedTime(new Date('2026-11-11T15:00:00Z'));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  const trigger = section.getByRole('button', {
    name: 'Alterar data de entrega',
    exact: true,
  });
  await expect(
    section.getByRole('button', { name: 'Editar datas', exact: true }),
  ).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Alterar data de entrega',
    exact: true,
  });
  const day = dialog.getByLabel('Entregue em', { exact: true });
  const save = dialog.getByRole('button', {
    name: 'Salvar data de entrega',
    exact: true,
  });
  await expect(day).toBeFocused();
  await expect(day).toHaveValue('2026-11-10');
  await expect(day).toHaveAttribute('max', '2026-11-11');
  await expect(dialog.locator('input')).toHaveCount(1);
  await expect(dialog.getByLabel('Pago em')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await day.fill('2026-11-09');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(mock.writes).toEqual([]);
  await trigger.click();
  await expect(day).toHaveValue('2026-11-10');
  await day.fill('2026-11-12');
  await save.click();
  expect(mock.writes).toEqual([]);
  expect(
    await day.evaluate(
      (el) => /** @type {HTMLInputElement} */ (el).validity.valid,
    ),
  ).toBe(false);
  await day.fill('');
  await expect(save).toBeDisabled();
  await day.fill('2026-11-09');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().width <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(
    section.getByText('Pedido entregue', { exact: true }),
  ).toBeFocused();
  await expect(section.locator('[data-kind="delivery"]')).toHaveCount(1);
  await expect(section.locator('[data-kind="delivery"]')).toContainText(
    '09/11/2026',
  );
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0].body).toEqual({
    expectedVersion: 4,
    deliveredOn: '2026-11-09',
  });
  expect(mock.writes[0].key).toBeTruthy();
  expect(mock.writes[0].csrf).toBe('synthetic-timeline-csrf');
  expect(mock.order.paidOn).toBeNull();
  expect(mock.billing.receivedAmountCents).toBe(3000);
  expect(mock.billing.balanceAmountCents).toBe(7000);
  expect(mock.order.status).toBe('confirmado');
  await trigger.click();
  await expect(day).toHaveValue('2026-11-09');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(mock.writes).toHaveLength(1);
});

for (const mode of ['lost', 'conflict'])
  test(`DDE: ${mode} correction reconciles the requested day rather than the old delivery`, async ({
    page,
  }) => {
    const mock = await setup(page, {
      mode,
      order: { deliveredOn: '2026-11-10' },
    });
    await page.clock.setFixedTime(new Date('2026-11-11T15:00:00Z'));
    await page.goto('/pedidos/order-confirmado');
    await sectionFor(page)
      .getByRole('button', { name: 'Alterar data de entrega', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Alterar data de entrega',
      exact: true,
    });
    const day = dialog.getByLabel('Entregue em', { exact: true });
    const save = dialog.getByRole('button', {
      name: 'Salvar data de entrega',
      exact: true,
    });
    await day.fill('2026-11-09');
    await save.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(day).toBeDisabled();
    await expect(save).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'Atualizar pedido', exact: true })
      .click();
    await expect(dialog).toBeVisible();
    expect(mock.order.deliveredOn).toBe('2026-11-10');
    expect(mock.writes).toHaveLength(1);
    if (mode === 'conflict') {
      await expect(save).toBeDisabled();
      return;
    }
    await expect(save).toBeEnabled();
    mock.setMode('ok');
    await save.click();
    await expect(dialog).not.toBeVisible();
    expect(mock.writes).toHaveLength(2);
    expect(mock.writes[1].key).toBe(mock.writes[0].key);
    expect(mock.writes[1].body).toEqual(mock.writes[0].body);
    expect(mock.order.deliveredOn).toBe('2026-11-09');
  });

test('DDE: a late delivery response cannot replace a more recent order snapshot', async ({
  page,
}) => {
  const mock = await setup(page, { order: { deliveredOn: '2026-11-10' } });
  await page.clock.setFixedTime(new Date('2026-11-11T15:00:00Z'));
  let release = () => {},
    sendEvent = () => {},
    started = false;
  const responseGate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: eventStreamBody({
        type: 'inbox.order.changed',
        payload: { orderId: mock.order.id },
      }),
    });
  });
  await page.route(
    '**/api/v1/orders/*/delivery-confirmation',
    async (route) => {
      const previous = { ...mock.order, version: 5, deliveredOn: '2026-11-08' };
      started = true;
      await responseGate;
      return route.fulfill({ json: { order: previous } });
    },
  );
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await section
    .getByRole('button', { name: 'Alterar data de entrega', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Alterar data de entrega',
    exact: true,
  });
  await dialog.getByLabel('Entregue em').fill('2026-11-08');
  await dialog
    .getByRole('button', { name: 'Salvar data de entrega', exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  Object.assign(mock.order, { version: 6, deliveredOn: '2026-11-09' });
  mock.billing.orderVersion = 6;
  sendEvent();
  await expect(section.locator('[data-kind="delivery"]')).toContainText(
    '09/11/2026',
  );
  release();
  await expect(dialog.getByRole('alert')).toContainText('O pedido mudou');
  await expect(section.locator('[data-kind="delivery"]')).toContainText(
    '09/11/2026',
  );
  await expect(dialog).toBeVisible();
});

for (const mode of ['conflict', 'lost'])
  test(`DTL: ${mode} never invents delivery or blindly retries`, async ({
    page,
  }) => {
    const mock = await setup(page, { mode });
    await page.goto('/pedidos/order-confirmado');
    const section = sectionFor(page),
      dialog = deliveryFor(page);
    await section
      .getByRole('button', { name: 'Confirmar entrega', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Sim, confirmar entrega', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(
      section.getByText('Pedido entregue', { exact: true }),
    ).toHaveCount(0);
    expect(mock.writes).toHaveLength(1);
    expect(mock.order.deliveredOn).toBeNull();
    expect(mock.billing.receivedAmountCents).toBe(3000);
  });

for (const patch of [
  { status: 'pendente' },
  { isTest: true },
  { origin: 'loja' },
  { cancelledAt: '2026-11-10T10:00:00Z' },
  { seller: { id: 'other', name: 'Outro vendedor' } },
])
  test(`DTL: delivery is hidden for ${JSON.stringify(patch)}`, async ({
    page,
  }) => {
    await setup(page, { order: patch });
    await page.goto('/pedidos/order-confirmado');
    await expect(
      page.getByRole('heading', { name: 'Pedido 05-CRM', exact: true }),
    ).toBeVisible();
    if (patch.origin !== 'loja') await expect(sectionFor(page)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirmar entrega', exact: true }),
    ).toHaveCount(0);
  });

test('DTL: no payments endpoint does not fabricate legacy amounts or InfinitePay identity', async ({
  page,
}) => {
  await setup(page, { mode: 'missing', order: { paidOn: '2026-11-10' } });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await expect(section).toContainText('Quitação registrada');
  await expect(section).toContainText('Sem detalhamento');
  await expect(section).not.toContainText('InfinitePay');
  await expect(section).not.toContainText('R$ 30,00');
});

test('DTL: unavailable billing preserves order milestones and exposes retry instead of empty history', async ({
  page,
}) => {
  const mock = await setup(page, {
    mode: 'error',
    order: { paidOn: '2026-11-10' },
  });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await expect(section).toContainText('Primeiro contato');
  await expect(section).toContainText('Pedido confirmado');
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(section).toContainText('Detalhamento aguardando atualização');
  await expect(section).not.toContainText('Registro legado');
  await expect(section).not.toContainText('Nenhum recebimento');
  expect(mock.reads).toBe(1);
});

test('DTL: an uncertain delivery requires an explicit read before a same-key human retry', async ({
  page,
}) => {
  const mock = await setup(page, { mode: 'lost' });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page),
    dialog = deliveryFor(page);
  await section
    .getByRole('button', { name: 'Confirmar entrega', exact: true })
    .click();
  const confirm = dialog.getByRole('button', {
    name: 'Sim, confirmar entrega',
    exact: true,
  });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(confirm).toBeDisabled();
  expect(mock.writes).toHaveLength(1);
  mock.setMode('ok');
  await dialog
    .getByRole('button', { name: 'Atualizar pedido', exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    section.getByText('Pedido entregue', { exact: true }),
  ).toBeVisible();
  expect(mock.writes).toHaveLength(2);
  expect(mock.writes[1].key).toBe(mock.writes[0].key);
  expect(mock.writes[1].body).toEqual(mock.writes[0].body);
});

test('DTL: double Enter sends one delivery while the request is pending', async ({
  page,
}) => {
  let release = () => {};
  const deliveryGate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  const mock = await setup(page, { deliveryGate });
  await page.goto('/pedidos/order-confirmado');
  await sectionFor(page)
    .getByRole('button', { name: 'Confirmar entrega', exact: true })
    .click();
  const dialog = deliveryFor(page);
  await dialog
    .getByRole('button', { name: 'Sim, confirmar entrega', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.writes.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(
    sectionFor(page).getByText('Pedido entregue', { exact: true }),
  ).toBeVisible();
  expect(mock.writes).toHaveLength(1);
});

test('DTL: a late response from another order cannot replace the current history', async ({
  page,
}) => {
  const mock = await setup(page);
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  let oldReadStarted = false;
  await page.route(
    '**/api/v1/orders/order-confirmado/billing',
    async (route) => {
      oldReadStarted = true;
      await gate;
      await route.fulfill({ json: { billing: mock.billing } }).catch(() => {});
    },
  );
  await page.route('**/api/v1/orders/order-second/billing', (route) =>
    route.fulfill({
      json: {
        billing: { ...mock.billing, timelineEvents: [], managed: false },
      },
    }),
  );
  await page.goto('/pedidos/order-confirmado');
  await expect.poll(() => oldReadStarted).toBe(true);
  await page.locator('a[href="/pedidos"]').first().click();
  await page.locator('a[href="/pedidos/order-second"]').first().click();
  await expect(
    page.getByRole('heading', { name: 'Pedido 98-CRM', exact: true }),
  ).toBeVisible();
  release();
  await expect(sectionFor(page).locator('.order-timeline li')).toHaveCount(2);
  await expect(sectionFor(page)).not.toContainText('InfinitePay');
});

test('DTL: mobile stacks the timeline vertically without side scroll, keeps native keyboard details and a usable delivery dialog', async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pedidos/order-confirmado');
  const section = sectionFor(page);
  await section.getByRole('button', { name: /Datas do pedido/ }).click();
  const region = section.getByRole('region', {
    name: 'Cronologia do pedido',
  });
  await expect(region).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  // PED-RD-04: a narrow container stacks the entries, no lateral scroll.
  await expect(section.getByText('Deslize para ver')).toHaveCount(0);
  expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const stack = await region
    .locator('.order-timeline li')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y));
  expect(stack.every((y, i) => i === 0 || y > stack[i - 1])).toBe(true);
  await section
    .getByRole('button', { name: 'Confirmar entrega', exact: true })
    .click();
  await expect(deliveryFor(page)).toBeVisible();
  expect(
    await deliveryFor(page).evaluate(
      (el) => el.getBoundingClientRect().width <= globalThis.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
