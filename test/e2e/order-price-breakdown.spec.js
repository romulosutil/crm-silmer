import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOrders, ownConfirmedOrder } from './support/orders-mock.js';

const groupId = 'e4a8a5b8-06fc-4a7f-acf0-202d99566cfa';
const lineId = '79a04f49-562b-4658-b98a-7f0428e70944';

function legacySource() {
  return {
    mode: 'legacy',
    orderId: ownConfirmedOrder.id,
    orderVersion: 4,
    revision: 1,
    sourceValid: true,
    groups: [
      {
        id: groupId,
        lines: [
          {
            id: lineId,
            size: 'M',
            quantity: 60,
            subtotalCents: null,
            subtotalReviewed: false,
          },
        ],
      },
    ],
    pricing: { complete: false, totalCents: null },
    issues: [{ code: 'SIZE_SUBTOTAL_REQUIRED', field: 'priceBreakdown' }],
  };
}

/** @param {import('@playwright/test').Page} page @param {{source?:any,owner?:boolean,admin?:boolean,store?:boolean,writeStatus?:number}} [options] */
async function setup(page, options = {}) {
  const order = {
    ...structuredClone(ownConfirmedOrder),
    ...(options.store
      ? {
          origin: 'loja',
          conversationId: null,
          ficha: {
            ...structuredClone(ownConfirmedOrder.ficha),
            loja: {
              produto: { slug: 'produto-sintetico', nome: 'Produto sintético' },
              telefone: '5527999990000',
            },
          },
        }
      : {}),
  };
  await mockOrders(page, { orders: [order] });
  const user = {
    id: options.owner === false ? 'outro-operador' : order.seller.id,
    name: 'Pessoa sintética',
    email: 'pessoa@example.test',
    functionName: 'Vendedor',
    capabilities: options.admin ? ['COMMERCIAL_ADMIN'] : [],
    olistEnabled: true,
  };
  await page.route('**/api/v1/sessions/current', (route) =>
    route.fulfill({ json: { user } }),
  );
  await page.route('**/api/v1/orders/*/olist', (route) =>
    route.fulfill({
      json: { orderId: order.id, operation: null, creationEnabled: false },
    }),
  );
  let source = options.source ?? legacySource();
  /** @type {any[]} */
  const writes = [];
  await page.route('**/api/v1/orders/*/price-breakdown', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: source });
    const body = request.postDataJSON();
    writes.push(body);
    expect(request.headers()['idempotency-key']).toBeTruthy();
    if (options.writeStatus)
      return route.fulfill({
        status: options.writeStatus,
        json: {
          code: options.writeStatus === 409 ? 'VERSION_CONFLICT' : 'FORBIDDEN',
          detail: 'provider-private-canary',
        },
      });
    expect(body.expectedVersion).toBe(source.orderVersion);
    source = {
      ...source,
      orderVersion: source.orderVersion + 1,
      revision: source.revision + 1,
    };
    if (body.value.action === 'set_subtotals') {
      expect(body.value.lines).toEqual([
        { groupId, lineId, subtotalCents: 118000 },
      ]);
      source.groups[0].lines[0].subtotalCents = 118000;
      source.pricing = { complete: true, totalCents: 118000 };
      source.issues = [];
    }
    return route.fulfill({ json: source });
  });
  await page.goto(`/pedidos/${order.id}`);
  return { writes, order };
}

test('legacy subtotal is explicit, versioned and preserved after reload', async ({
  page,
}) => {
  const { writes } = await setup(page);
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  const subtotal = panel.getByLabel('Subtotal do grupo 1, tamanho M (R$)');
  await expect(subtotal).toBeFocused();
  await subtotal.fill('1.180,00');
  await panel.getByRole('button', { name: 'Salvar complemento' }).click();
  await expect(panel.getByText('Total: R$ 1.180,00')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    expectedVersion: 4,
    value: {
      action: 'set_subtotals',
      lines: [{ groupId, lineId, subtotalCents: 118000 }],
    },
  });
  await page.reload();
  await expect(panel.getByText('Total: R$ 1.180,00')).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
});

test('legacy invalid money stays in the form and does not write', async ({
  page,
}) => {
  const { writes } = await setup(page);
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  await panel.getByLabel('Subtotal do grupo 1, tamanho M (R$)').fill('0,00');
  await panel.getByRole('button', { name: 'Salvar complemento' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'Use subtotais positivos',
  );
  await expect(panel.getByRole('alert')).toBeFocused();
  expect(writes).toHaveLength(0);
});

test('conflict preserves the legacy draft and requires cancel and review', async ({
  page,
}) => {
  const { writes } = await setup(page, { writeStatus: 409 });
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  await panel
    .getByLabel('Subtotal do grupo 1, tamanho M (R$)')
    .fill('1.180,00');
  await panel.getByRole('button', { name: 'Salvar complemento' }).click();
  await expect(panel.getByRole('alert')).toContainText('mudou em outra sessão');
  await expect(
    panel.getByLabel('Subtotal do grupo 1, tamanho M (R$)'),
  ).toHaveValue('1.180,00');
  await expect(
    panel.getByRole('button', { name: 'Salvar complemento' }),
  ).toBeDisabled();
  expect(writes).toHaveLength(1);
  await panel.getByRole('button', { name: 'Cancelar' }).click();
  await expect(
    panel.getByRole('button', { name: 'Editar complemento' }),
  ).toBeEnabled();
});

test('enabled Olist reader does not gain legacy editing', async ({ page }) => {
  const { writes } = await setup(page, { owner: false });
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await expect(panel.getByText('Subtotal não informado')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Editar complemento' }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('permission loss clears source and does not display provider details', async ({
  page,
}) => {
  await setup(page, { writeStatus: 403 });
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  await panel
    .getByLabel('Subtotal do grupo 1, tamanho M (R$)')
    .fill('1.180,00');
  await panel.getByRole('button', { name: 'Salvar complemento' }).click();
  await expect(panel.getByRole('alert')).toContainText('Seu acesso mudou');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('provider-private-canary')).toHaveCount(0);
});

test('store complement preserves checkout and sends only explicit fiscal details', async ({
  page,
}) => {
  const source = {
    ...legacySource(),
    mode: 'store',
    groups: [
      {
        id: groupId,
        lines: [
          {
            id: lineId,
            size: 'M',
            quantity: 60,
            subtotalCents: 118000,
            subtotalReviewed: true,
          },
        ],
      },
    ],
    pricing: { complete: true, totalCents: 118000 },
    details: {
      deliveryOn: null,
      applications: [{ groupId, application: null }],
      registration: null,
    },
  };
  const { writes } = await setup(page, { store: true, admin: true, source });
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  await panel.getByLabel('Previsão de entrega').fill('2026-12-07');
  await panel.getByLabel('Aplicação do grupo 1').fill('Sublimação');
  await panel.getByLabel('Tipo de pessoa').selectOption('individual');
  await panel.getByLabel('Nome ou razão social').fill('Comprador sintético');
  await panel.getByRole('button', { name: 'Salvar complemento' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].value).toMatchObject({
    action: 'set_store_details',
    deliveryOn: '2026-12-07',
    applications: [{ groupId, application: 'Sublimação' }],
    registration: {
      personType: 'individual',
      legalName: 'Comprador sintético',
    },
  });
  expect(Object.keys(writes[0].value).sort()).toEqual([
    'action',
    'applications',
    'deliveryOn',
    'registration',
  ]);
});

test('legacy complement has no accessibility violations at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const panel = page.getByRole('region', { name: 'Complemento para o Olist' });
  await panel.getByRole('button', { name: 'Editar complemento' }).click();
  expect(
    (await new AxeBuilder({ page }).include('.op-price-breakdown').analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
});
