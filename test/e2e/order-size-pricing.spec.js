import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  applySizePricingCommand,
  sizePricingSummary,
} from '../../modules/orders/src/domain/size-pricing-composition.js';
import { pendingOrder } from './support/orders-mock.js';

const groupId = '55777e58-ad9b-4fda-93f3-a29045939b26';
const lineId = 'b7c42ab0-25f1-46f6-a6ad-2b520706116f';
const otherGroupId = 'c0105d9a-3e97-41d3-bb7d-b3e2798c9cf3';
const otherLineId = '4cb9616a-72e1-49db-94fa-4601e5cf6bc9';

/** @param {import('@playwright/test').BrowserContext} context */
async function pricingMock(context) {
  const user = {
    id: 'seller-marina',
    name: 'Vendedora sintética',
    functionName: 'Vendedor',
    capabilities: [],
    olistEnabled: false,
  };
  /** @type {any} */
  let order = structuredClone(pendingOrder);
  order.origin = 'atendimento';
  order.version = 4;
  order.ficha.items[0].grade = [{ tamanho: 'M', quantidade: 3 }];
  order.ficha.items.push({
    ...structuredClone(order.ficha.items[0]),
    tipo: 'POLO',
    cor: 'AZUL',
    grade: [{ tamanho: 'M', quantidade: 2 }],
  });
  order.ficha.sizePricing = [
    {
      id: groupId,
      lines: [
        {
          id: lineId,
          size: 'M',
          quantity: 3,
          subtotalCents: 10500,
          subtotalReviewed: true,
        },
      ],
    },
    {
      id: otherGroupId,
      lines: [
        {
          id: otherLineId,
          size: 'M',
          quantity: 2,
          subtotalCents: 5000,
          subtotalReviewed: true,
        },
      ],
    },
  ];
  order.finalAmountCents = 15500;
  order.totalPieces = 5;
  order.paymentCondition = 'pix';
  order.missingFields = [];
  order.pricing = sizePricingSummary(order.ficha);
  /** @type {Array<{path:string,body:any}>} */
  const writes = [];
  const state = {
    operation: /** @type {any} */ (null),
    projectionDenied: false,
  };
  await context.addCookies([
    {
      name: 'crm_csrf',
      value: 'pricing-test-csrf',
      url: 'http://127.0.0.1:4173',
    },
  ]);
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (/** @type {any} */ value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (path === '/api/v1/sessions/current') return json({ user });
    if (path === '/api/v1/events')
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n: connected\n\n',
      });
    if (path === `/api/v1/orders/${order.id}`) return json({ order });
    if (path === `/api/v1/orders/${order.id}/files`)
      return json({ final: null, references: [] });
    if (path.endsWith('/shipping-estimate')) return json({ quote: null });
    if (
      path === `/api/v1/orders/${order.id}/sections/size-pricing` &&
      req.method() === 'PATCH'
    ) {
      const body = req.postDataJSON();
      writes.push({ path, body });
      expect(req.headers()['x-csrf-token']).toBe('pricing-test-csrf');
      expect(req.headers()['idempotency-key']).toBeTruthy();
      if (body.expectedVersion !== order.version)
        return json({ code: 'VERSION_CONFLICT' }, 409);
      try {
        // Exercise the real composition commands: browser tests do not invent
        // identities, recalculate unit prices or bypass subtotal review.
        order.ficha = applySizePricingCommand(order, body.value);
        order.pricing = sizePricingSummary(order.ficha);
        order.finalAmountCents = order.pricing.totalCents;
        order.version++;
        order.totalPieces = order.ficha.items.reduce(
          /** @param {number} total @param {any} item */
          (total, item) =>
            total +
            item.grade.reduce(
              /** @param {number} sum @param {any} line */ (sum, line) =>
                sum + line.quantidade,
              0,
            ),
          0,
        );
        order.missingFields = order.pricing.complete ? [] : ['finalAmount'];
        return json({ order });
      } catch (error) {
        return json(
          { code: /** @type {any} */ (error).code ?? 'SIZE_PRICING_INVALID' },
          422,
        );
      }
    }
    if (
      path === `/api/v1/orders/${order.id}/confirm` &&
      req.method() === 'POST'
    ) {
      const body = req.postDataJSON();
      writes.push({ path, body });
      expect(body).not.toHaveProperty('amountText');
      expect(body).not.toHaveProperty('finalAmountCents');
      order = {
        ...order,
        version: order.version + 1,
        status: 'confirmado',
        confirmedAt: '2026-11-07T15:00:00.000Z',
        confirmedBy: { id: user.id, name: user.name },
        orderDate: '2026-11-07',
      };
      return json({ order });
    }
    if (path.endsWith('/olist')) {
      if (state.projectionDenied) return json({ code: 'FORBIDDEN' }, 403);
      return json({
        orderId: order.id,
        number: order.number,
        status: order.status,
        operation: state.operation,
        creationEnabled: false,
        pendingFields: [],
      });
    }
    return json({
      columns: [],
      items: [],
      eventCursor: 'pricing-before',
      totals: {},
      period: {},
      storeNewCount: 0,
    });
  });
  return {
    writes,
    state,
    current: () => structuredClone(order),
    bumpVersion: () => {
      order.version++;
    },
  };
}

/** @param {import('@playwright/test').Page} page */
async function openGrade(page) {
  await page.goto(`/pedidos/${pendingOrder.id}#itens`);
  await page.getByRole('button', { name: 'Editar itens', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Grade e subtotais por tamanho' }),
  ).toBeVisible();
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

for (const operationState of ['confirmed', 'pending']) {
  test(`T12 late Olist ${operationState} projection fences an already open confirmation dialog`, async ({
    page,
    context,
  }) => {
    const { writes, state, bumpVersion } = await pricingMock(context);
    await page.addInitScript(() => {
      const testGlobal = /** @type {any} */ (globalThis);
      class PricingEventSource extends globalThis.EventTarget {
        constructor() {
          super();
          testGlobal.__pricingEvents = this;
          globalThis.queueMicrotask(() =>
            this.dispatchEvent(new globalThis.Event('open')),
          );
        }
        close() {}
      }
      testGlobal.EventSource = PricingEventSource;
    });
    /** @type {() => void} */
    let release = () => {};
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let projectionReads = 0;
    await page.route('**/api/v1/orders/order-pendente/olist', async (route) => {
      projectionReads++;
      if (projectionReads > 1) await held;
      await route.fallback();
    });
    await page.goto(`/pedidos/${pendingOrder.id}`);
    await page
      .getByRole('button', { name: 'Gerar pedido', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
    await dialog
      .getByRole('radio', { name: 'Cartão de crédito', exact: true })
      .check();
    state.operation = {
      state: operationState,
      stage: 'sale',
      number: operationState === 'confirmed' ? '777' : null,
    };
    bumpVersion();
    await page.evaluate(() => {
      const testGlobal = /** @type {any} */ (globalThis);
      testGlobal.__pricingEvents.dispatchEvent(
        new globalThis.MessageEvent('inbox.order.changed', {
          data: JSON.stringify({ orderId: 'order-pendente' }),
        }),
      );
    });
    // A live revision requires fresh proof. The stale modal closes as soon
    // as the projection enters checking, before its response is released.
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        name: 'Fechamento e pagamento',
        exact: true,
      }),
    ).toBeFocused();
    expect(writes).toHaveLength(0);
    release();
    if (operationState === 'confirmed') {
      await page
        .getByRole('button', { name: 'Gerar pedido', exact: true })
        .click();
      // A new modal can confirm only the persisted payment condition;
      // the previous uncommitted choice cannot escape the lock.
      const pix = dialog.getByRole('radio', { name: 'Pix', exact: true });
      await expect(pix).toBeDisabled();
      await expect(pix).toBeChecked();
      await expect(
        dialog.getByRole('radio', { name: 'Cartão de crédito', exact: true }),
      ).not.toBeChecked();
      await dialog
        .getByRole('button', { name: 'Confirmar e gerar ficha', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(writes).toHaveLength(1);
      expect(writes[0].body).toEqual({
        expectedVersion: 5,
        paymentCondition: 'pix',
      });
    } else {
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('heading', {
          name: 'Fechamento e pagamento',
          exact: true,
        }),
      ).toBeFocused();
      await expect(
        page.getByRole('button', { name: 'Gerar pedido', exact: true }),
      ).toHaveCount(0);
      expect(writes).toHaveLength(0);
    }
  });
}

test('T12 quantity invalidates only its subtotal and requires an explicit reviewed amount in exact cents', async ({
  page,
  context,
}) => {
  const { writes, current } = await pricingMock(context);
  await openGrade(page);
  const editor = page.locator('.op-price-editor');
  await expect(editor).toContainText('Total do pedido: R$ 155,00');
  await page
    .getByRole('button', {
      name: 'Editar quantidade de M, grupo 1',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Quantidade de peças')).toBeFocused();
  await page.getByLabel('Quantidade de peças').fill('4');
  await page
    .getByRole('button', { name: 'Salvar alteração', exact: true })
    .click();
  await expect(editor).toContainText(
    'Quantidade salva. Revise o subtotal desta linha.',
  );
  await expect(editor).toContainText('Total do pedido: A revisar');
  expect(current().ficha.sizePricing[0].lines[0]).toMatchObject({
    id: lineId,
    quantity: 4,
    subtotalCents: 10500,
    subtotalReviewed: false,
  });
  expect(current().ficha.sizePricing[1].lines[0]).toMatchObject({
    id: otherLineId,
    quantity: 2,
    subtotalCents: 5000,
    subtotalReviewed: true,
  });
  await page
    .getByRole('button', {
      name: 'Revisar subtotal de M, grupo 1',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Subtotal do tamanho (R$)')).toBeFocused();
  await expect(
    page.getByText(
      'Confirme o valor de todas as 4 peças do tamanho M. Não informe o valor de uma peça.',
    ),
  ).toBeVisible();
  await page.getByLabel('Subtotal do tamanho (R$)').fill('0');
  await page
    .getByRole('button', { name: 'Confirmar subtotal', exact: true })
    .click();
  await expect(
    page.getByText('Informe um subtotal maior que zero, no formato 120,00.'),
  ).toBeFocused();
  expect(writes).toHaveLength(1);
  await page.getByLabel('Subtotal do tamanho (R$)').fill('120,01');
  await page
    .getByRole('button', { name: 'Confirmar subtotal', exact: true })
    .click();
  await expect(editor).toContainText('Total do pedido: R$ 170,01');
  expect(writes.map((call) => call.body)).toEqual([
    {
      expectedVersion: 4,
      value: { action: 'change_quantity', groupId, lineId, quantity: 4 },
    },
    {
      expectedVersion: 5,
      value: {
        action: 'review_subtotal',
        groupId,
        lineId,
        subtotalCents: 12001,
      },
    },
  ]);
  expect(current().finalAmountCents).toBe(17001);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('T12 identical size in different groups keeps IDs and subtotals independent; duplicate groups get server IDs', async ({
  page,
  context,
}) => {
  const { writes, current } = await pricingMock(context);
  await openGrade(page);
  await page
    .getByRole('button', {
      name: 'Revisar subtotal de M, grupo 2',
      exact: true,
    })
    .click();
  await page.getByLabel('Subtotal do tamanho (R$)').fill('55,00');
  await page
    .getByRole('button', { name: 'Confirmar subtotal', exact: true })
    .click();
  expect(writes[0].body.value).toEqual({
    action: 'review_subtotal',
    groupId: otherGroupId,
    lineId: otherLineId,
    subtotalCents: 5500,
  });
  expect(current().ficha.sizePricing[0].lines[0].subtotalCents).toBe(10500);
  await page.getByText('Mais ações do grupo 1', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Duplicar grupo 1', exact: true })
    .click();
  await expect(
    page.getByText(
      'Grupo duplicado com novos identificadores. Revise os subtotais da cópia.',
    ),
  ).toBeVisible();
  const groups = current().ficha.sizePricing;
  expect(groups).toHaveLength(3);
  expect(groups[0].id).toBe(groupId);
  expect(groups[1].id).toBe(otherGroupId);
  expect(groups[2].id).not.toBe(groupId);
  expect(groups[2].lines[0].id).not.toBe(lineId);
  expect(groups[2].lines[0].subtotalReviewed).toBe(false);
  expect(writes[1].body.value).toEqual({ action: 'duplicate_group', groupId });
});

test('T12 two tabs refuse stale composition and retain the draft until explicit refresh', async ({
  page,
  context,
}) => {
  const { writes, current } = await pricingMock(context);
  await openGrade(page);
  const second = await context.newPage();
  await openGrade(second);
  await page
    .getByRole('button', {
      name: 'Editar quantidade de M, grupo 1',
      exact: true,
    })
    .click();
  await page.getByLabel('Quantidade de peças').fill('4');
  await page
    .getByRole('button', { name: 'Salvar alteração', exact: true })
    .click();
  await expect(
    page.getByText('Quantidade salva. Revise o subtotal desta linha.'),
  ).toBeVisible();
  await second
    .getByRole('button', {
      name: 'Revisar subtotal de M, grupo 1',
      exact: true,
    })
    .click();
  await second.getByLabel('Subtotal do tamanho (R$)').fill('150,00');
  await second
    .getByRole('button', { name: 'Confirmar subtotal', exact: true })
    .click();
  await expect(
    second.getByText(
      'Este pedido mudou. Cancele a edição para ver a versão atual.',
    ),
  ).toBeFocused();
  await expect(second.getByLabel('Subtotal do tamanho (R$)')).toHaveValue(
    '150,00',
  );
  await expect(
    second.getByRole('button', { name: 'Confirmar subtotal', exact: true }),
  ).toBeDisabled();
  expect(current().ficha.sizePricing[0].lines[0].subtotalCents).toBe(10500);
  expect(writes[1].body.expectedVersion).toBe(4);
  await second
    .getByRole('button', { name: 'Fechar edição de itens', exact: true })
    .click();
  await second.reload();
  await second
    .getByRole('button', { name: 'Editar itens', exact: true })
    .click();
  await expect(second.locator('.op-price-editor')).toContainText('4 peças');
  await second.close();
});

test('T12 confirmation uses the calculated total as read only and sends only payment choice and version', async ({
  page,
  context,
}) => {
  const { writes } = await pricingMock(context);
  await page.goto(`/pedidos/${pendingOrder.id}`);
  await page.getByRole('button', { name: 'Gerar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Valor final calculado');
  await expect(dialog).toContainText('R$ 155,00');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Confirmar e gerar ficha', exact: true })
    .click();
  await expect(
    page.getByText('Pedido confirmado e ficha gerada.', { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({
    expectedVersion: 4,
    paymentCondition: 'pix',
  });
});

test('T12 monetary grade stays accessible and fits phone and dark 320px layouts', async ({
  page,
  context,
}) => {
  await pricingMock(context);
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGrade(page);
  await captureFromTop(page, 'var/olist-t12-grade-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await captureFromTop(page, 'var/olist-t12-grade-mobile.png');
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
  await captureFromTop(page, 'var/olist-t12-grade-dark-320.png');
});

test('T12 owner without Olist checkbox reads the lock, keeps milestones and cannot edit an exported snapshot after read denial', async ({
  page,
  context,
}) => {
  const { state } = await pricingMock(context);
  state.operation = { state: 'confirmed', stage: 'sale', number: '901' };
  await page.goto(`/pedidos/${pendingOrder.id}`);
  const panel = page.getByRole('region', { name: 'Pedido no Olist' });
  await expect(panel).toContainText('Venda confirmada no Olist');
  await expect(
    page.getByRole('button', { name: 'Editar itens', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Editar datas', exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Conferir prévia Olist' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Gerar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('radio', { name: 'Pix', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole('button', {
      name: 'Confirmar e gerar ficha',
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  state.projectionDenied = true;
  await panel.getByRole('button', { name: 'Atualizar estado Olist' }).click();
  await expect(
    panel.getByText(
      'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.',
    ),
  ).toBeVisible();
  // Losing permission to read a ledger is not evidence that its lock vanished.
  await expect(
    page.getByRole('button', { name: 'Editar itens', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Editar resumo', exact: true }),
  ).toHaveCount(0);
});
