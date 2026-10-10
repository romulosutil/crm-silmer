import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// ADRs 027 and 028 (LOJ-08, LOJ-10, LOJ-14, LOJ-22..24): a site shop order
// paid through InfinitePay, in the list and on its page — the "Loja · LJ-…"
// badge, "Pago — confirmado pela InfinitePay em …", the lead time, the NSU,
// the receipt link, the lock and "Baixar ficha" — all by keyboard; and the
// order link the seller opens without a session comes back after the login.
// The customer and the gateway identifiers are synthetic.

const session = {
  user: {
    capabilities: ['COMMERCIAL_ADMIN'],
    email: 'rose@example.test',
    functionName: 'Vendedor',
    id: 'admin-rose',
    name: 'Rose Sintética',
  },
};

const RECEIPT_URL = 'https://recibo.infinitepay.io/sintetico-5b0c77ed';

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
      comprovanteUrl: RECEIPT_URL,
      produto: {
        nome: 'Camisa Masculina Lisa Dry Fit',
        slug: 'camisa-masculina-lisa',
      },
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
  finalAmountCents: 18000,
  firstContactAt: '2026-10-08T02:15:55.000Z',
  gatewayPayment: {
    confirmedAt: '2026-10-08T02:15:55.000Z',
    invoiceSlug: 'fatura-sintetica-1',
    paidAmountCents: 18000,
    receiptUrl: RECEIPT_URL,
    source: 'infinitepay',
    transactionNsu: 'nsu-sintetico-0001',
  },
  id: 'order-loja',
  isTest: true,
  lastMessage: null,
  leadTimeBusinessDays: 10,
  locked: true,
  missingFields: [],
  number: '12-CRM',
  orderDate: '2026-10-07',
  origin: 'loja',
  paidOn: '2026-10-07',
  paymentCondition: 'pix',
  reopenedAt: null,
  reopenedBy: null,
  seller: null,
  status: 'confirmado',
  storeNumber: 'LJ-5B0C77ED',
  totalPieces: 10,
  updatedAt: '2026-10-08T02:16:03.000Z',
  version: 1,
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{onList?: (params: URLSearchParams) => void, signedOut?: boolean}} [options]
 */
async function mockStore(page, options = {}) {
  let authenticated = options.signedOut !== true;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/sessions/current' && request.method() === 'GET') {
      await route.fulfill({
        body: JSON.stringify(
          authenticated ? session : { error: { code: 'UNAUTHENTICATED' } },
        ),
        contentType: 'application/json',
        status: authenticated ? 200 : 401,
      });
      return;
    }
    if (path === '/api/v1/sessions' && request.method() === 'POST') {
      authenticated = true;
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
    if (path === '/api/v1/orders/summary' && request.method() === 'GET') {
      await route.fulfill({
        body: JSON.stringify({
          averageTicketCents: 0,
          confirmedCount: 0,
          pendingCount: 0,
          soldAmountCents: 0,
          totalPiecesSold: 0,
        }),
        contentType: 'application/json',
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

/** @param {import('@playwright/test').Page} page */
async function signIn(page) {
  const loginPanel = page.getByRole('region', {
    name: 'Boas-vindas de volta',
  });
  await loginPanel.getByLabel('E-mail').fill('rose@example.test');
  await loginPanel.getByLabel('Senha').fill('senha sintetica de teste');
  await loginPanel.getByLabel('Senha').press('Enter');
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

  // LOJ-23: the search sends the shop's number as typed; the API finds it.
  await page
    .getByLabel('Buscar número, cliente ou telefone')
    .fill('LJ-5B0C77ED');
  await expect.poll(() => lists.at(-1)?.get('q') ?? null).toBe('LJ-5B0C77ED');

  const confirmed = page.getByRole('region', { name: /Confirmados/u });
  const row = confirmed.getByRole('row').nth(1);
  await expect(row).toContainText('12-CRM');
  await expect(
    row.getByText('Loja · LJ-5B0C77ED', { exact: true }),
  ).toBeVisible();
  await expect(row.getByText('Teste', { exact: true })).toBeVisible();
  await expect(row).toContainText('Cliente Sintetico da Loja');
  await expect(row).toContainText(
    'Loja do site · Camisa Masculina Lisa Dry Fit',
  );
  await expect(row).toContainText('R$ 180,00');
  await expect(row).toContainText(
    'Pago — confirmado pela InfinitePay em 07/10/2026 às 23:15',
  );
  await expect(row).not.toContainText('sem vendedor');
  await expect(row).not.toContainText('informado pelo cliente');

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('the store order page is locked, shows the InfinitePay payment and downloads its ficha', async ({
  page,
}) => {
  await mockStore(page);
  await page.goto('/pedidos/order-loja');

  const heading = page.getByRole('heading', { name: 'Pedido 12-CRM' });
  await expect(heading).toBeFocused();
  await expect(
    page.getByText(
      'Pago — confirmado pela InfinitePay em 07/10/2026 às 23:15',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Loja · LJ-5B0C77ED', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Teste', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Pedido da loja do site: travado, sem edição.'),
  ).toBeVisible();

  const details = page.getByRole('region', { name: 'Pedido da loja do site' });
  for (const [label, value] of [
    ['Número da loja', 'LJ-5B0C77ED'],
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
    ['Prazo', '10 dias úteis'],
    ['Valor', 'R$ 180,00'],
    ['Valor pago', 'R$ 180,00'],
    ['Transação InfinitePay (NSU)', 'nsu-sintetico-0001'],
    ['Origem', 'Loja do site'],
  ]) {
    await expect(
      details
        .locator('dl > div')
        .filter({ has: page.getByText(label, { exact: true }) }),
    ).toContainText(value);
  }
  await expect(details).not.toContainText('Sicredi');
  await expect(details).not.toContainText('Lindenberg');

  // LOJ-22: the receipt opens in a new tab, and says so.
  const receipt = details.getByRole('link', {
    name: 'Comprovante InfinitePay (abre em nova aba)',
  });
  await expect(receipt).toHaveAttribute('href', RECEIPT_URL);
  await expect(receipt).toHaveAttribute('target', '_blank');
  await expect(receipt).toHaveAttribute('rel', 'noopener noreferrer');

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

test('LOJ-24: the order link opened without a session comes back to the order after the login', async ({
  page,
}) => {
  await mockStore(page, { signedOut: true });
  await page.goto('/pedidos/order-loja');
  await expect(page.getByRole('status')).toHaveText('Entre para continuar.');
  await expect(page).toHaveURL('/?voltar=/pedidos/order-loja');

  await signIn(page);
  await expect(page).toHaveURL('/pedidos/order-loja');
  await expect(
    page.getByRole('heading', { name: 'Pedido 12-CRM' }),
  ).toBeFocused();
});

test('LOJ-24: a return address outside the app is ignored', async ({
  page,
}) => {
  await mockStore(page, { signedOut: true });
  await page.goto('/?voltar=%2F%2Fevil.example%2Fpedidos');
  await expect(page.getByRole('status')).toHaveText('Entre para continuar.');
  await signIn(page);
  await expect(page).toHaveURL('/dashboard');
});
