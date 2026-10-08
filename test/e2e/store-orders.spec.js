import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// ADR 027 (LOJ-08, LOJ-10, LOJ-14): a site shop order in the list and on its
// page — the "Loja" badge, "Pago (informado pelo cliente em …)", the lock and
// "Baixar ficha" — all by keyboard. The customer is synthetic.

const session = {
  user: {
    capabilities: ['COMMERCIAL_ADMIN'],
    email: 'rose@example.test',
    functionName: 'Vendedor',
    id: 'admin-rose',
    name: 'Rose Sintética',
  },
};

const storeOrder = {
  confirmedAt: '2026-10-08T02:16:03.000Z',
  confirmedBy: { id: 'system:loja-do-site', name: 'Loja do site' },
  conversationId: null,
  createdAt: '2026-10-08T02:16:03.000Z',
  deliveredOn: null,
  fabCode: '01',
  ficha: {
    artwork: {
      feito_pela_silmer: false,
      feito_pelo_cliente: false,
      files: [],
      sem_estampa: true,
    },
    items: [
      {
        cor: 'Preto',
        gola: 'Gola redonda',
        grade: [{ quantidade: 10, tamanho: 'M' }],
        malhas: ['Dry fit liso de poliéster'],
        publico: 'masculino',
        tipo: 'Camiseta',
      },
    ],
    loja: {
      informadoPeloClienteEm: '2026-10-08T02:15:55.693Z',
      produto: {
        nome: 'Camisa Masculina Lisa Dry Fit',
        slug: 'camisa-masculina-lisa',
      },
      retirada:
        'Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES',
      telefone: '5527900000001',
    },
    observations: [],
    serviceData: {},
    summary: {
      cliente: 'Cliente Sintetico da Loja',
      data_entrega_confirmada: null,
      nome: null,
    },
  },
  finalAmountCents: 19364,
  firstContactAt: '2026-10-08T02:16:03.000Z',
  id: 'order-loja',
  isTest: true,
  lastMessage: null,
  locked: true,
  missingFields: [],
  number: '12-CRM',
  orderDate: '2026-10-07',
  origin: 'loja',
  paidOn: '2026-10-07',
  paymentCondition: 'pix',
  paymentDeclaredAt: '2026-10-08T02:15:55.693Z',
  reopenedAt: null,
  reopenedBy: null,
  seller: null,
  status: 'confirmado',
  totalPieces: 10,
  updatedAt: '2026-10-08T02:16:03.000Z',
  version: 1,
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{onList?: (params: URLSearchParams) => void}} [options]
 */
async function mockStore(page, options = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/sessions/current') {
      await route.fulfill({
        body: JSON.stringify(session),
        contentType: 'application/json',
      });
      return;
    }
    if (path === '/api/v1/events') {
      await route.fulfill({
        body: 'retry: 60000\n\n: connected\n\n',
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        status: 200,
      });
      return;
    }
    if (path === '/api/v1/orders' && request.method() === 'GET') {
      options.onList?.(url.searchParams);
      await route.fulfill({
        body: JSON.stringify({
          counts: { confirmado: 1, pendente: 0 },
          items: [storeOrder],
          nextCursor: null,
        }),
        contentType: 'application/json',
      });
      return;
    }
    if (path === '/api/v1/orders/order-loja' && request.method() === 'GET') {
      await route.fulfill({
        body: JSON.stringify({ order: storeOrder }),
        contentType: 'application/json',
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } }),
      contentType: 'application/json',
      status: 404,
    });
  });
}

test('the list filters "Loja do site" by keyboard and labels the store order', async ({
  page,
}) => {
  /** @type {URLSearchParams[]} */
  const lists = [];
  await mockStore(page, { onList: (params) => lists.push(params) });
  await page.goto('/pedidos');
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeFocused();

  const storeFilter = page.getByRole('button', { name: 'Loja do site' });
  await storeFilter.focus();
  await page.keyboard.press('Enter');
  await expect(storeFilter).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => lists.at(-1)?.get('origin') ?? null).toBe('loja');
  expect(lists.at(-1)?.get('status')).toBeNull();

  const confirmed = page.getByRole('region', { name: /Confirmados/u });
  const row = confirmed.getByRole('row').nth(1);
  await expect(row).toContainText('12-CRM');
  await expect(row.getByText('Loja', { exact: true })).toBeVisible();
  await expect(row.getByText('Teste', { exact: true })).toBeVisible();
  await expect(row).toContainText('Cliente Sintetico da Loja');
  await expect(row).toContainText(
    'Loja do site · Camisa Masculina Lisa Dry Fit',
  );
  await expect(row).toContainText('R$ 193,64');
  await expect(row).toContainText(
    'Pago (informado pelo cliente em 07/10/2026 às 23:15)',
  );
  await expect(row).not.toContainText('sem vendedor');

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('the store order page is locked, says who paid and downloads its ficha', async ({
  page,
}) => {
  await mockStore(page);
  await page.goto('/pedidos/order-loja');

  const heading = page.getByRole('heading', { name: 'Pedido 12-CRM' });
  await expect(heading).toBeFocused();
  await expect(
    page.getByText('Pago (informado pelo cliente em 07/10/2026 às 23:15)', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Loja', { exact: true })).toBeVisible();
  await expect(page.getByText('Teste', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Pedido da loja do site: travado, sem edição.'),
  ).toBeVisible();

  const details = page.getByRole('region', { name: 'Pedido da loja do site' });
  for (const [label, value] of [
    ['Cliente', 'Cliente Sintetico da Loja'],
    ['Telefone', '+55 (27) 90000-0001'],
    ['Produto', 'Camisa Masculina Lisa Dry Fit'],
    ['Tipo', 'Camiseta'],
    ['Público', 'Masculino'],
    ['Cor', 'Preto'],
    ['Malha', 'Dry fit liso de poliéster'],
    ['Gola', 'Gola redonda'],
    ['Tamanho', 'M'],
    ['Quantidade', '10'],
    ['Valor', 'R$ 193,64'],
    ['Origem', 'Loja do site'],
  ]) {
    await expect(
      details
        .locator('dl > div')
        .filter({ has: page.getByText(label, { exact: true }) }),
    ).toContainText(value);
  }
  await expect(details).toContainText(
    'Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES',
  );

  // Nothing to edit, generate, reopen or attach on a locked order.
  for (const name of [
    /Editar/u,
    /Gerar pedido/u,
    /Reabrir/u,
    /Enviar arquivo/u,
    /Salvar/u,
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  // Tab reaches "Baixar ficha"; it is a download of the simplified ficha.
  const download = page.getByRole('link', { name: 'Baixar ficha' });
  await expect(download).toHaveAttribute(
    'href',
    '/api/v1/orders/order-loja/print?download=1',
  );
  await expect(download).toHaveAttribute('download', 'pedido-12-CRM.html');
  await heading.focus();
  let reached = false;
  for (let step = 0; step < 12 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await download.evaluate(
      (element) => element === element.ownerDocument.activeElement,
    );
  }
  expect(reached).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
