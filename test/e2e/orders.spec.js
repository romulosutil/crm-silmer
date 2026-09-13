import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const session = {
  user: {
    capabilities: [],
    email: 'marina@example.test',
    functionName: 'Vendedor',
    id: 'seller-marina',
    name: 'Marina Aguiar',
  },
};

const confirmedOrder = {
  confirmedAt: '2026-09-09T19:20:00.000Z',
  confirmedBy: { id: 'seller-ricardo', name: 'Ricardo Lima' },
  conversationId: 'conversation-5',
  createdAt: '2026-09-08T12:00:00.000Z',
  fabCode: 'FAB 01',
  ficha: {
    items: [
      {
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        grade: [{ quantidade: 60, tamanho: 'M' }],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'AVENTAL',
        vies_gola: 'VERDE',
        vies_mangas: 'VERDE',
      },
    ],
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Buffet Casa Rosa',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Aventais e camisetas',
    },
  },
  finalAmountCents: 118000,
  id: 'order-confirmado',
  missingFields: [],
  number: '05-CRM',
  orderDate: '2026-09-09',
  paymentCondition: 'pix',
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
  status: 'confirmado',
  totalPieces: 60,
  updatedAt: '2026-09-09T19:20:00.000Z',
  version: 4,
};

const pendingOrder = {
  confirmedAt: null,
  confirmedBy: null,
  conversationId: 'conversation-7',
  createdAt: '2026-09-12T09:00:00.000Z',
  fabCode: 'FAB 01',
  ficha: {
    items: [
      {
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        grade: [
          { quantidade: 100, tamanho: 'M' },
          { quantidade: 50, tamanho: 'G' },
        ],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'CAMISETA',
        vies_gola: 'OLÍMPICA - VERDE',
        vies_mangas: 'VERDE',
      },
    ],
    observations: ['Separar os itens por tamanho.'],
    serviceData: {},
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Colégio Ápice',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2027',
    },
  },
  finalAmountCents: null,
  id: 'order-pendente',
  missingFields: ['finalAmount', 'paymentCondition'],
  number: '07-CRM',
  orderDate: null,
  paymentCondition: null,
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'seller-marina', name: 'Marina Aguiar' },
  status: 'pendente',
  totalPieces: 150,
  updatedAt: '2026-09-12T09:46:00.000Z',
  version: 2,
};

const extraPending = {
  ...pendingOrder,
  conversationId: 'conversation-9',
  id: 'order-pendente-2',
  ficha: {
    ...pendingOrder.ficha,
    summary: { ...pendingOrder.ficha.summary, cliente: 'Loja Vitória Sports' },
  },
  missingFields: ['items[0].modelo', 'finalAmount', 'paymentCondition'],
  number: '09-CRM',
  totalPieces: 45,
};

/**
 * One SSE payload delivered on connect, with a long retry so the reconnect
 * does not turn a single event into a refresh loop during the test.
 *
 * @param {Record<string, unknown>|null} event
 */
function eventStreamBody(event) {
  if (!event) return 'retry: 60000\n\n: connected\n\n';
  return [
    'retry: 60000',
    '',
    `event: ${event.type}`,
    'id: evt-2',
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{orders?: any[], liveEvent?: Record<string, unknown>|null, onList?: (params: URLSearchParams) => void, pages?: any[][]}} [options]
 */
async function mockOrders(page, options = {}) {
  const orders = options.orders ?? [confirmedOrder, pendingOrder];
  const pages = options.pages ?? null;
  let listCalls = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/v1/sessions/current') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
      return;
    }
    if (path === '/api/v1/events') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: eventStreamBody(options.liveEvent ?? null),
      });
      return;
    }
    if (path === '/api/v1/orders' && request.method() === 'GET') {
      options.onList?.(url.searchParams);
      const source = pages
        ? (pages[Math.min(listCalls, pages.length - 1)] ?? [])
        : orders.filter(
            (order) =>
              !url.searchParams.get('status') ||
              order.status === url.searchParams.get('status'),
          );
      listCalls += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          counts: {
            confirmado: orders.filter((o) => o.status === 'confirmado').length,
            pendente: orders.filter((o) => o.status === 'pendente').length,
          },
          items: source,
          nextCursor:
            pages && listCalls < pages.length ? `cursor-${listCalls}` : null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } }),
    });
  });
}

test('groups orders by status with counts, columns and actions', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos');

  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeFocused();

  const confirmed = page.getByRole('region', { name: /Confirmados/u });
  const pending = page.getByRole('region', { name: /Pendentes/u });
  await expect(confirmed.getByRole('heading', { level: 2 })).toContainText(
    'Confirmados',
  );
  await expect(confirmed.getByRole('heading', { level: 2 })).toContainText('1');
  await expect(pending.getByRole('heading', { level: 2 })).toContainText('1');

  await expect(confirmed.locator('thead th')).toHaveText([
    'Pedido',
    'Cliente',
    'Peças',
    'Valor',
    'Situação',
    'Ações',
  ]);

  const confirmedRow = confirmed.getByRole('row').nth(1);
  await expect(confirmedRow).toContainText('05-CRM');
  await expect(confirmedRow).toContainText('Buffet Casa Rosa');
  await expect(confirmedRow).toContainText('Aventais e camisetas');
  await expect(confirmedRow).toContainText('Ricardo Lima');
  await expect(confirmedRow).toContainText('60');
  await expect(confirmedRow).toContainText('R$ 1.180,00');
  await expect(confirmedRow).toContainText('Confirmado por Ricardo Lima');

  const pendingRow = pending.getByRole('row').nth(1);
  await expect(pendingRow).toContainText('07-CRM');
  await expect(pendingRow).toContainText('Colégio Ápice');
  await expect(pendingRow).toContainText('150');
  await expect(pendingRow).toContainText('Falta valor e condição');
  await expect(pendingRow).toContainText('parado há');

  // PLI-06: printing belongs to confirmed orders, continuing to pending ones.
  await expect(
    confirmedRow.getByRole('button', { name: 'Imprimir' }),
  ).toBeVisible();
  await expect(
    confirmedRow.getByRole('link', { name: 'Abrir' }),
  ).toHaveAttribute('href', '/pedidos/order-confirmado');
  await expect(
    confirmedRow.getByRole('link', { name: 'Continuar' }),
  ).toHaveCount(0);
  await expect(
    pendingRow.getByRole('button', { name: 'Imprimir' }),
  ).toHaveCount(0);
  await expect(
    pendingRow.getByRole('link', { name: 'Continuar' }),
  ).toHaveAttribute('href', '/pedidos/order-pendente');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('filters by status and searches by number, customer or phone', async ({
  page,
}) => {
  /** @type {URLSearchParams[]} */
  const calls = [];
  await mockOrders(page, { onList: (params) => calls.push(params) });
  await page.goto('/pedidos');

  await expect(page.locator('.filter-summary')).toHaveText(
    '1 confirmados · 1 pendentes',
  );

  await page.getByRole('button', { name: 'Pendentes' }).click();
  await expect(page.getByRole('region', { name: /Confirmados/u })).toHaveCount(
    0,
  );
  await expect(page.getByRole('region', { name: /Pendentes/u })).toBeVisible();
  await expect.poll(() => calls.at(-1)?.get('status')).toBe('pendente');
  // PLI-03: the counts keep covering both groups while one is selected.
  await expect(page.locator('.filter-summary')).toHaveText(
    '1 confirmados · 1 pendentes',
  );

  await page.getByRole('button', { name: 'Todos' }).click();
  await expect.poll(() => calls.at(-1)?.get('status')).toBe(null);

  await page.getByLabel('Buscar número, cliente ou telefone').fill('07-CRM');
  await expect.poll(() => calls.at(-1)?.get('q')).toBe('07-CRM');
});

test('pages the list with "Ver mais"', async ({ page }) => {
  await mockOrders(page, { pages: [[pendingOrder], [extraPending]] });
  await page.goto('/pedidos');

  const pending = page.getByRole('region', { name: /Pendentes/u });
  await expect(pending.getByRole('row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Ver mais' }).click();
  await expect(pending.getByRole('row')).toHaveCount(3);
  await expect(pending).toContainText('Loja Vitória Sports');
  await expect(page.getByRole('button', { name: 'Ver mais' })).toHaveCount(0);
});

test('refreshes the list when an order changes elsewhere (PLI-08)', async ({
  page,
}) => {
  let listCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { conversationId: 'conversation-7', orderId: 'order-pendente' },
      type: 'inbox.order.changed',
    },
    onList: () => {
      listCalls += 1;
    },
  });
  await page.goto('/pedidos');

  await expect(page.getByRole('region', { name: /Pendentes/u })).toBeVisible();
  await expect.poll(() => listCalls).toBeGreaterThan(1);
});

test('shows an empty list and a failure apart from each other', async ({
  page,
}) => {
  await mockOrders(page, { orders: [] });
  await page.goto('/pedidos');

  await expect(page.getByText('Nenhum pedido por aqui')).toBeVisible();

  await page.route('**/api/v1/orders?**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
    });
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível carregar os pedidos.',
  );
});
