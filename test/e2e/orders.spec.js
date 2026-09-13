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
 * The server recomputes totals and what is missing on every write; the mock
 * does the same, so the page is never asserted against a stale derived field.
 *
 * @param {any} order @param {string} section @param {any} value
 */
function applySection(order, section, value) {
  const ficha = { ...order.ficha };
  if (section === 'summary') {
    ficha.summary = { ...ficha.summary, ...value };
  } else if (section === 'items') {
    ficha.items = value;
  } else {
    ficha.observations = value;
  }
  const totalPieces = ficha.items.reduce(
    /** @param {number} total @param {any} item */
    (total, item) =>
      total +
      item.grade.reduce(
        /** @param {number} sum @param {any} line */
        (sum, line) => sum + line.quantidade,
        0,
      ),
    0,
  );
  return {
    ficha,
    missingFields: missingFor({ ...order, ficha }),
    totalPieces,
    updatedAt: new Date().toISOString(),
    version: order.version + 1,
  };
}

/** @param {any} order @param {string} action @param {any} body */
function applyCommand(order, action, body) {
  if (action === 'reopen') {
    const reopened = {
      ...order,
      reopenedAt: '2026-09-13T12:00:00.000Z',
      reopenedBy: { id: session.user.id, name: session.user.name },
      status: 'pendente',
      version: order.version + 1,
    };
    return { ...reopened, missingFields: missingFor(reopened) };
  }
  return {
    confirmedAt: '2026-09-13T12:00:00.000Z',
    confirmedBy: { id: session.user.id, name: session.user.name },
    finalAmountCents: brlToCents(body.amountText),
    missingFields: [],
    orderDate: '2026-09-13',
    paymentCondition: body.paymentCondition,
    status: 'confirmado',
    version: order.version + 1,
  };
}

/** @param {string} text */
function brlToCents(text) {
  const [reais, cents = '00'] = String(text).split(',');
  return Number(reais.replaceAll('.', '')) * 100 + Number(cents.padEnd(2, '0'));
}

/** @param {any} order */
function missingFor(order) {
  if (order.status === 'confirmado') return [];
  /** @type {string[]} */
  const missing = [];
  if (
    !order.ficha.items.some(
      /** @param {any} item */ (item) => item.grade.length > 0,
    )
  ) {
    missing.push('items');
  }
  if (!order.finalAmountCents) missing.push('finalAmount');
  if (!order.paymentCondition) missing.push('paymentCondition');
  for (const key of [
    'cliente',
    'data_entrega_confirmada',
    'aplicacao',
    'nome',
  ]) {
    if (!order.ficha.summary[key]) missing.push(`summary.${key}`);
  }
  return missing;
}

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
 * @param {{orders?: any[], liveEvent?: Record<string, unknown>|null, onDetail?: (orderId: string) => void, onList?: (params: URLSearchParams) => void, onWrite?: (call: {section?: string, action?: string, body: any}) => void, pages?: any[][], writeFailure?: {status: number, body: Record<string, unknown>}}} [options]
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
    const section = /^\/api\/v1\/orders\/([^/]+)\/sections\/([^/]+)$/u.exec(
      path,
    );
    if (section && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      options.onWrite?.({ body, section: section[2] });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const current = orders.find((candidate) => candidate.id === section[1]);
      const next = applySection(current, section[2], body.value);
      Object.assign(current, next);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order: current }),
      });
      return;
    }

    const command = /^\/api\/v1\/orders\/([^/]+)\/(confirm|reopen)$/u.exec(
      path,
    );
    if (command && request.method() === 'POST') {
      const body = request.postDataJSON();
      options.onWrite?.({ action: command[2], body });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const current = orders.find((candidate) => candidate.id === command[1]);
      Object.assign(current, applyCommand(current, command[2], body));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order: current }),
      });
      return;
    }

    const detail = /^\/api\/v1\/orders\/([^/]+)$/u.exec(path);
    if (detail && request.method() === 'GET') {
      options.onDetail?.(detail[1]);
      const order = orders.find((candidate) => candidate.id === detail[1]);
      if (!order) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order }),
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

test('opens the order page inside Pedidos, with the trail and the sections in order', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente?conversa=conversation-7');

  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
  await expect(page.locator('.topbar-title')).toHaveText('Pedido');
  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Pedidos' }),
  ).toHaveAttribute('aria-current', 'page');

  // PGE-01: back to Pedidos, and the origin named when it came from a chat.
  const trail = page.getByRole('navigation', { name: 'Rastro' });
  await expect(trail.getByRole('link', { name: '← Pedidos' })).toHaveAttribute(
    'href',
    '/pedidos',
  );
  await expect(trail).toContainText('07-CRM');
  await expect(trail).toContainText('aberto a partir da conversa');
  await expect(
    page.getByRole('link', { name: 'Abrir conversa' }),
  ).toBeVisible();

  await expect(page.locator('main h2')).toHaveText([
    'Resumo do pedido',
    'Itens e especificações',
    'Observações do pedido',
    'Controle de produção',
    'Dados do atendimento',
    'Fechamento e pagamento',
  ]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps the trail without an origin when the list opened the order', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const trail = page.getByRole('navigation', { name: 'Rastro' });
  await expect(trail).not.toContainText('aberto a partir da conversa');
  await expect(page.getByRole('link', { name: 'Abrir conversa' })).toHaveCount(
    0,
  );
});

test('locks printing while the order is pending and says why (PIM-01)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const print = page.getByRole('button', { name: 'Imprimir' });
  await expect(print).toBeDisabled();
  await expect(
    page.getByText('Disponível depois de confirmar o pedido'),
  ).toBeVisible();
  await expect(print).toHaveAttribute('aria-describedby', /./u);
});

test('lists what is missing in the banner, and says so when nothing is (PFI-09)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const banner = page.getByRole('status').filter({ hasText: 'Falta' });
  await expect(banner).toContainText('valor final');
  await expect(banner).toContainText('condição de pagamento');

  await page.goto('/pedidos/order-confirmado');
  await expect(
    page.getByText('Os campos da ficha impressa estão completos.'),
  ).toBeVisible();
});

test('prints a confirmed order from its page', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const print = page.getByRole('button', { name: 'Imprimir' });
  await expect(print).toBeEnabled();
  const [document] = await Promise.all([
    page.context().waitForEvent('page'),
    print.click(),
  ]);
  expect(document.url()).toContain('/api/v1/orders/order-confirmado/print');
});

test('shows the order read-only to whoever does not own the conversation (PAU-01)', async ({
  page,
}) => {
  await mockOrders(page, {
    orders: [
      {
        ...pendingOrder,
        seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
      },
    ],
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByText(
      'Somente Ricardo Lima ou um administrador edita este pedido.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Confirmar pedido' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Reabrir pedido' }),
  ).toHaveCount(0);
});

test('names a missing order with the way back to the list', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-inexistente');

  await expect(page.getByText('Pedido não encontrado')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Voltar para Pedidos' }),
  ).toHaveAttribute('href', '/pedidos');
});

test('refreshes the open order when it changes elsewhere', async ({ page }) => {
  let detailCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { conversationId: 'conversation-7', orderId: 'order-pendente' },
      type: 'inbox.order.changed',
    },
    onDetail: () => {
      detailCalls += 1;
    },
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('reads the order summary and marks the customer as locked (PFI-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary.locator('dt')).toHaveText([
    'Cliente',
    'Entrega confirmada',
    'Total de peças',
    'Aplicação',
    'Evento / Nome',
    'Vendedor',
    'Data do pedido',
    'FAB',
  ]);
  await expect(summary).toContainText('Colégio Ápice');
  await expect(summary).toContainText('vem da conversa');
  await expect(summary).toContainText('24/10/2026');
  await expect(summary).toContainText('150');
  await expect(summary).toContainText('Marina Aguiar');
  // D14: the number exists from creation; only the date waits for the
  // confirmation, which corrects the supporting text of the mockup.
  await expect(summary).toContainText('definida na confirmação');
  await expect(summary).toContainText(
    'O número do pedido já existe desde a criação',
  );
});

test('edits the summary and saves the whole section at once (PFI-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();

  // D13: the customer comes from the contact and is never typed here.
  await expect(summary.getByLabel('Cliente')).toBeDisabled();
  await summary.getByLabel('Aplicação').fill('SILK 4 CORES');
  await summary.getByLabel('Evento / Nome').fill('Uniforme escolar 2028');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  await expect(summary.getByRole('button', { name: 'Editar' })).toBeVisible();
  await expect(summary).toContainText('SILK 4 CORES');
  await expect(summary).toContainText('Uniforme escolar 2028');
  expect(writes).toHaveLength(1);
  expect(writes[0].section).toBe('summary');
  expect(writes[0].body).toEqual({
    expectedVersion: 2,
    value: {
      aplicacao: 'SILK 4 CORES',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2028',
    },
  });
});

test('cancels an edit without writing anything', async ({ page }) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await summary.getByLabel('Aplicação').fill('DESCARTAR');
  await summary.getByRole('button', { name: 'Cancelar' }).click();

  await expect(summary).toContainText('SUBLIMAÇÃO TOTAL');
  await expect(summary).not.toContainText('DESCARTAR');
  expect(writes).toHaveLength(0);
});

test('asks for a reload when the section was saved over an older version', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: { body: { code: 'VERSION_CONFLICT' }, status: 409 },
  });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await summary.getByLabel('Aplicação').fill('SILK 4 CORES');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  await expect(summary.getByRole('alert')).toContainText(
    'Este pedido mudou. Recarregue a seção.',
  );
});

test('keeps a confirmed order in reading mode until it is reopened (PFI-10)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});
