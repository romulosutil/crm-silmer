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
    artwork: {
      feito_pelo_cliente: false,
      feito_pela_silmer: true,
      files: [],
    },
    items: [
      {
        cor: 'BRANCA',
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        estampa: 'Sem estampa',
        gola: 'GOLA V',
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
  deliveredOn: null,
  finalAmountCents: 118000,
  firstContactAt: '2026-09-02T14:12:00.000Z',
  id: 'order-confirmado',
  missingFields: [],
  number: '05-CRM',
  orderDate: '2026-09-09',
  paidOn: '2026-09-10',
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
  deliveredOn: null,
  fabCode: 'FAB 01',
  ficha: {
    artwork: {
      feito_pelo_cliente: true,
      feito_pela_silmer: false,
      files: [],
    },
    items: [
      {
        cor: 'BRANCA',
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        estampa: 'Arte do cliente · frente',
        gola: 'GOLA REDONDA',
        grade: [
          { quantidade: 100, tamanho: 'M' },
          { quantidade: 50, tamanho: 'G' },
        ],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'CAMISETA',
        tipo_servico: 'SUBLIMAÇÃO TOTAL',
        vies_gola: 'OLÍMPICA - VERDE',
        vies_mangas: 'VERDE',
      },
    ],
    observations: ['Separar os itens por tamanho.'],
    serviceData: {
      artwork_status: 'Arte recebida do cliente',
      city_or_postal_code: 'Salvador/BA',
      purchase_profile: 'Compra recorrente',
      purpose: 'Uso próprio',
    },
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Colégio Ápice',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2027',
    },
  },
  finalAmountCents: null,
  firstContactAt: '2026-09-11T20:40:00.000Z',
  id: 'order-pendente',
  missingFields: ['finalAmount', 'paymentCondition'],
  number: '07-CRM',
  orderDate: null,
  paidOn: null,
  paymentCondition: null,
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'seller-marina', name: 'Marina Aguiar' },
  status: 'pendente',
  totalPieces: 150,
  updatedAt: '2026-09-12T09:46:00.000Z',
  version: 2,
};

// The same confirmed order, owned by the signed-in seller: only the owner (or
// an admin) sees the edit buttons.
const ownConfirmedOrder = {
  ...confirmedOrder,
  seller: { id: session.user.id, name: session.user.name },
};

const extraPending = {
  ...pendingOrder,
  conversationId: 'conversation-9',
  id: 'order-pendente-2',
  ficha: {
    ...pendingOrder.ficha,
    summary: { ...pendingOrder.ficha.summary, cliente: 'Loja Vitória Sports' },
  },
  missingFields: ['items[0].gola', 'finalAmount', 'paymentCondition'],
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
  } else if (section === 'artwork') {
    ficha.artwork = { ...ficha.artwork, ...value };
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

// ADR 016: the seven points of every item, the promised delivery, the
// amount and the payment method — the same rule and order the server applies.
const ITEM_POINTS = [
  'tipo',
  'cor',
  'estampa',
  'malhas',
  'grade',
  'gola',
  'tipo_servico',
];

/** @param {any} order */
function missingFor(order) {
  if (order.status === 'confirmado') return [];
  /** @type {string[]} */
  const missing = [];
  if (order.ficha.items.length === 0) missing.push('items');
  order.ficha.items.forEach(
    /** @param {any} item @param {number} index */ (item, index) => {
      for (const key of ITEM_POINTS) {
        const value = item[key];
        const blank = Array.isArray(value)
          ? value.length === 0
          : !String(value ?? '').trim();
        if (blank) missing.push(`items[${index}].${key}`);
      }
    },
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(
      order.ficha.summary.data_entrega_confirmada ?? '',
    )
  ) {
    missing.push('summary.data_entrega_confirmada');
  }
  if (!order.finalAmountCents) missing.push('finalAmount');
  if (!order.paymentCondition) missing.push('paymentCondition');
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
 * @param {{orders?: any[], failDetailOnce?: boolean, failListOnce?: boolean, liveEvent?: Record<string, unknown>|null, onDetail?: (orderId: string) => void, onList?: (params: URLSearchParams) => void, onWrite?: (call: {section?: string, action?: string, body: any}) => void, pages?: any[][], writeFailure?: {status: number, body: Record<string, unknown>}}} [options]
 */
async function mockOrders(page, options = {}) {
  // A write mutates the order it answers with, so each test gets its own
  // copy: sharing the module fixture would let one test's confirmation
  // decide what the next test in the same worker reads.
  /** @type {any[]} */
  const orders = JSON.parse(
    JSON.stringify(options.orders ?? [confirmedOrder, pendingOrder]),
  );
  const pages = options.pages ?? null;
  let listCalls = 0;
  let detailCalls = 0;
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
      const pageIndex = listCalls;
      listCalls += 1;
      if (options.failListOnce && listCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
      const source = pages
        ? (pages[Math.min(pageIndex, pages.length - 1)] ?? [])
        : orders.filter(
            (order) =>
              !url.searchParams.get('status') ||
              order.status === url.searchParams.get('status'),
          );
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

    const milestones = /^\/api\/v1\/orders\/([^/]+)\/milestones$/u.exec(path);
    if (milestones && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      options.onWrite?.({ action: 'milestones', body });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const current = orders.find(
        (candidate) => candidate.id === milestones[1],
      );
      Object.assign(current, {
        deliveredOn: body.deliveredOn,
        paidOn: body.paidOn,
        version: current.version + 1,
      });
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
      if (options.failDetailOnce && detailCalls++ === 0) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
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
  await expect(pendingRow).toContainText(
    'Falta valor final e forma de pagamento',
  );
  await expect(pendingRow).toContainText('Pedido sem movimentação há');

  // PLI-06: printing belongs to confirmed orders, continuing to pending ones.
  await expect(
    confirmedRow.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeVisible();
  await expect(
    confirmedRow.getByRole('link', { name: 'Abrir pedido' }),
  ).toHaveAttribute('href', '/pedidos/order-confirmado');
  await expect(
    confirmedRow.getByRole('link', { name: 'Continuar pedido' }),
  ).toHaveCount(0);
  await expect(
    pendingRow.getByRole('button', { name: 'Imprimir ficha' }),
  ).toHaveCount(0);
  await expect(
    pendingRow.getByRole('link', { name: 'Abrir pedido' }),
  ).toHaveAttribute('href', '/pedidos/order-pendente');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('recovers the order list after an initial server failure without showing an empty wallet', async ({
  page,
}) => {
  await mockOrders(page, { failListOnce: true });
  await page.goto('/pedidos');

  await expect(
    page.getByRole('heading', { name: 'Pedidos indisponíveis' }),
  ).toBeVisible();
  await expect(page.getByText('Nenhum pedido por aqui')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('row', { name: /Colégio Ápice/u })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Pedidos', exact: true }),
  ).toBeFocused();
});

test('keeps loaded orders visible when a live refresh fails', async ({
  page,
}) => {
  await mockOrders(page);
  let reads = 0;
  await page.route(/\/api\/v1\/orders\?/u, async (route) => {
    reads += 1;
    if (reads !== 2) return route.fallback();
    return route.fulfill({
      body: JSON.stringify({ code: 'UNAVAILABLE' }),
      contentType: 'application/problem+json',
      status: 503,
    });
  });
  /** @type {() => void} */
  let sendEvent = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      body: eventStreamBody({
        payload: { orderId: 'order-pendente' },
        type: 'inbox.order.changed',
      }),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.goto('/pedidos');
  await expect(page.getByRole('row', { name: /Colégio Ápice/u })).toBeVisible();

  sendEvent();
  await expect(page.getByRole('alert')).toContainText(
    'Os dados exibidos podem estar desatualizados.',
  );
  await expect(page.getByRole('row', { name: /Colégio Ápice/u })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(3);
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
    'Lastro do pedido',
    'Itens e especificações',
    'Estampa e arquivos',
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

  const print = page.getByRole('button', { name: 'Imprimir ficha' });
  await expect(print).toBeDisabled();
  await expect(
    page.getByText('Disponível depois de gerar o pedido'),
  ).toBeVisible();
  await expect(print).toHaveAttribute('aria-describedby', /./u);
});

test('lists exactly what is missing to generate, point by point (PFI-09, PIT-05, PIT-06)', async ({
  page,
}) => {
  const incomplete = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [
        { ...pendingOrder.ficha.items[0], cor: '', gola: '', vies_gola: '' },
      ],
      // ADR 016: of the summary, only the promised delivery blocks.
      summary: {
        aplicacao: null,
        cliente: 'Colégio Ápice',
        data_entrega_confirmada: null,
        nome: null,
      },
    },
    missingFields: [
      'items[0].cor',
      'items[0].gola',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ],
  };
  await mockOrders(page, { orders: [incomplete] });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  const readiness = closing.locator('#closing-readiness');
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, definição da gola do item 1, entrega prometida, valor final e forma de pagamento.',
  );
  await expect(page.getByText('Ainda em branco na ficha')).toHaveCount(0);

  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, definição da gola do item 1 e entrega prometida.',
  );
  // What is filled elsewhere keeps the order from being sent to be generated.
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(closing).toContainText(
    'Complete os itens antes de gerar: cor do item 1 e definição da gola do item 1.',
  );
  await expect(closing).toContainText(
    'Informe a entrega prometida no Resumo do pedido.',
  );

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Cor', { exact: true }).fill('BRANCA');
  await items.getByLabel('Definição da gola').fill('GOLA V');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(readiness).toHaveText('Falta para gerar: entrega prometida.');

  // The checklist sends the seller to the summary, on the promised delivery.
  await closing
    .getByRole('button', { name: 'Informar no Resumo (entrega prometida)' })
    .click();
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const delivery = summary.getByLabel('Entrega prometida');
  await expect(delivery).toBeFocused();
  await delivery.fill('2026-10-24');
  await summary.getByRole('button', { name: 'Salvar resumo' }).click();
  await expect(readiness).toHaveText(
    'Tudo pronto. Gerar confirma o pedido e libera a ficha.',
  );
  // The paid day stays empty: generating means paid until the CRM handles
  // payments.
  await expect(
    page.getByRole('region', { name: 'Lastro do pedido' }),
  ).toContainText('Pagamento');
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' }),
  ).toBeVisible();
});

test('prints a confirmed order from its page', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const print = page.getByRole('button', { name: 'Imprimir ficha' });
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
  await expect(page.getByRole('button', { name: 'Gerar pedido' })).toHaveCount(
    0,
  );
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

test('recovers the order detail after an initial server failure', async ({
  page,
}) => {
  await mockOrders(page, { failDetailOnce: true });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('heading', { name: 'Pedido indisponível' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
});

test('keeps a loaded order visible when its live refresh fails', async ({
  page,
}) => {
  await mockOrders(page);
  let reads = 0;
  await page.route('**/api/v1/orders/order-pendente', async (route) => {
    reads += 1;
    if (reads !== 2) return route.fallback();
    return route.fulfill({
      body: JSON.stringify({ code: 'UNAVAILABLE' }),
      contentType: 'application/problem+json',
      status: 503,
    });
  });
  /** @type {() => void} */
  let sendEvent = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      body: eventStreamBody({
        payload: { orderId: 'order-pendente' },
        type: 'inbox.order.changed',
      }),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.goto('/pedidos/order-pendente');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();

  sendEvent();
  await expect(page.getByRole('alert')).toContainText(
    'Os dados exibidos podem estar desatualizados.',
  );
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(3);
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

test('refreshes a pending order when its customer changes in the conversation', async ({
  page,
}) => {
  let detailCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { contactId: 'contact-7' },
      type: 'inbox.contact.changed',
    },
    onDetail: () => {
      detailCalls += 1;
    },
  });
  await page.goto('/pedidos/order-pendente');
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
    'Entrega prometida',
    'Total de peças',
    'Técnica da arte (referência)',
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
  await expect(summary).toContainText('definida ao gerar');
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
  await summary.getByLabel('Técnica da arte (referência)').fill('SILK 4 CORES');
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
  await summary.getByLabel('Técnica da arte (referência)').fill('DESCARTAR');
  await summary.getByRole('button', { name: 'Cancelar' }).click();

  await expect(summary).toContainText('SUBLIMAÇÃO TOTAL');
  await expect(summary).not.toContainText('DESCARTAR');
  expect(writes).toHaveLength(0);
});

test('refreshes after leaving an edit saved over an older version', async ({
  page,
}) => {
  let detailCalls = 0;
  await mockOrders(page, {
    onDetail: () => {
      detailCalls += 1;
    },
    writeFailure: { body: { code: 'VERSION_CONFLICT' }, status: 409 },
  });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await summary.getByLabel('Técnica da arte (referência)').fill('SILK 4 CORES');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  await expect(summary.getByRole('alert')).toContainText(
    'Este pedido mudou. Cancele a edição para ver a versão atual.',
  );
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('records the artwork origin and prepares its Dropbox folder without uploading yet', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const artwork = page.getByRole('region', { name: 'Estampa e arquivos' });
  await expect(artwork).toContainText('Feito pelo cliente');
  await expect(artwork).toContainText('CRM/07-crm/');
  await expect(artwork.getByLabel('Adicionar arquivos da arte')).toBeDisabled();
  await expect(artwork).toContainText('PNG, JPEG, CDR');

  await artwork.getByRole('button', { name: 'Editar origem' }).click();
  const client = artwork.getByLabel('Feito pelo cliente');
  await expect(client).toBeFocused();
  await expect(client).toBeChecked();
  await artwork.getByLabel('Feito pela Silmer').check();
  await artwork.getByRole('button', { name: 'Salvar origem da arte' }).click();

  await expect(artwork).toContainText('Feito pelo cliente · Feito pela Silmer');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    section: 'artwork',
    body: {
      expectedVersion: 2,
      value: { feito_pelo_cliente: true, feito_pela_silmer: true },
    },
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('requires a service for each item before the seller can generate the order', async ({
  page,
}) => {
  const withoutService = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], tipo_servico: '' }],
    },
    missingFields: ['items[0].tipo_servico', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, { orders: [withoutService] });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('tipo de serviço do item 1');
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Tipo de serviço').fill('BORDADO');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(closing).not.toContainText('tipo de serviço do item 1');
  await expect(items).toContainText('BORDADO');
});

test('keeps garment, colour and collar data from older fichas when saving an item', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const legacy = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [
        {
          ...pendingOrder.ficha.items[0],
          tipo: '',
          cor: '',
          gola: '',
        },
      ],
    },
  };
  await mockOrders(page, {
    orders: [legacy],
    onWrite: (call) => writes.push(call),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items).toContainText('Item 1 · — · 150 peças');
  await expect(items).toContainText('OLÍMPICA - VERDE');
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Tipo de roupa')).toHaveValue('');
  await expect(items.getByLabel('Cor', { exact: true })).toHaveValue('BRANCA');
  await expect(items.getByLabel('Definição da gola')).toHaveValue(
    'OLÍMPICA - VERDE',
  );
  await items.getByLabel('Tipo de roupa').fill('CAMISETA');
  await items.getByRole('button', { name: 'Salvar itens' }).click();

  expect(writes[0].body.value[0]).toMatchObject({
    cor: 'BRANCA',
    gola: 'OLÍMPICA - VERDE',
    modelo: 'GOLA OLÍMPICA',
    tipo: 'CAMISETA',
    vies_gola: 'OLÍMPICA - VERDE',
  });
});

test('keeps a confirmed order in reading mode until it is reopened (PFI-10)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [ownConfirmedOrder] });
  await page.goto('/pedidos/order-confirmado');

  // ADR 008: only the trail stays editable, since payment and delivery come
  // after the order is generated.
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(1);
  await expect(
    page
      .getByRole('region', { name: 'Lastro do pedido' })
      .getByRole('button', { name: 'Editar' }),
  ).toBeVisible();
});

test('shows the trail from the first contact to the delivery (PLA-01..03)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Lastro do pedido' });
  await expect(trail).toContainText('4 de 5 datas');
  await expect(trail.getByRole('listitem')).toHaveText([
    /Primeiro contato\s*02\/09\/2026\s*vem da conversa/u,
    /Pedido fechado\s*09\/09\/2026\s*data do pedido/u,
    /Pagamento\s*10\/09\/2026\s*informado/u,
    /Entrega prometida\s*24\/10\/2026\s*vem do resumo/u,
    /Entrega realizada\s*—\s*a informar/u,
  ]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('records payment and delivery on a confirmed order without reopening it (PLA-04, PLA-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [ownConfirmedOrder],
  });
  await page.clock.setFixedTime(new Date('2026-09-20T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Lastro do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await expect(trail.getByLabel('Pago em')).toBeFocused();
  await expect(trail.getByLabel('Pago em')).toHaveValue('2026-09-10');
  await expect(trail.getByLabel('Entregue em')).toHaveAttribute(
    'max',
    '2026-09-20',
  );
  await trail.getByLabel('Entregue em').fill('2026-09-19');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  await expect(trail.getByRole('button', { name: 'Editar' })).toBeVisible();
  await expect(trail).toContainText('5 de 5 datas');
  await expect(trail.getByRole('listitem').last()).toContainText('19/09/2026');
  expect(writes).toEqual([
    {
      action: 'milestones',
      body: {
        deliveredOn: '2026-09-19',
        expectedVersion: 4,
        paidOn: '2026-09-10',
      },
    },
  ]);
  // The order stays confirmed and printable.
  await expect(page.locator('.op-head .op-status')).toHaveText(/Confirmado/u);
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
});

test('clears a recorded day and refuses a day after today, next to the field (PLA-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [ownConfirmedOrder],
  });
  await page.clock.setFixedTime(new Date('2026-09-20T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Lastro do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await trail.getByLabel('Entregue em').fill('2026-09-21');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  const delivered = trail.getByLabel('Entregue em');
  await expect(delivered).toHaveAttribute('aria-invalid', 'true');
  await expect(trail.getByRole('alert')).toHaveText('Use uma data até hoje.');
  expect(writes).toHaveLength(0);

  await delivered.fill('');
  await trail.getByLabel('Pago em').fill('');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();
  await expect(trail).toContainText('3 de 5 datas');
  expect(writes.map((write) => write.body)).toEqual([
    { deliveredOn: null, expectedVersion: 4, paidOn: null },
  ]);
});

test('names the day the server refused as invalid', async ({ page }) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'INVALID_DATE', fields: ['paidOn'] },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const trail = page.getByRole('region', { name: 'Lastro do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await trail.getByLabel('Pago em').fill('2026-09-11');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  await expect(trail.getByLabel('Pago em')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(trail.getByLabel('Entregue em')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(trail.getByRole('alert')).toHaveText('Use uma data até hoje.');
});

test('reads each item with the seven points in order and the extras closed (PFI-03, PIT-01, PIT-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items).toContainText('1 item · 150 peças');
  const card = items.getByRole('group', {
    name: 'Item 1 · CAMISETA · 150 peças',
  });
  await expect(
    card.getByRole('heading', {
      level: 3,
      name: 'Item 1 · CAMISETA · 150 peças',
    }),
  ).toBeVisible();
  const points = card.locator('dl').first();
  await expect(points.locator(':scope > div > dt')).toHaveText([
    'Tipo de roupa',
    'Tipo de serviço',
    'Cor',
    'Quantidade',
    'Estampa',
    'Tecido',
    'Tamanhos',
    'Definição da gola',
  ]);
  await expect(points.locator(':scope > div > dd')).toHaveText([
    'CAMISETA',
    'SUBLIMAÇÃO TOTAL',
    'BRANCA',
    '150 peças',
    'Arte do cliente · frente',
    'DRY FIT 100% POLIÉSTER',
    'M100G50',
    'GOLA REDONDA',
  ]);
  await expect(card.getByRole('listitem')).toHaveText(['M100', 'G50']);

  // PIT-02: the extras start closed and do not show their values.
  const toggle = card.getByRole('button', {
    name: /Adicionais \(não obrigatórios\)/u,
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByText('Cor frente', { exact: true })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByText('Cor frente', { exact: true })).toBeVisible();
  await expect(card.getByText('Modelo', { exact: true })).toHaveCount(0);
  await expect(card.locator('dl').nth(1).locator('dt')).toHaveText([
    'Cor frente',
    'Cor costas',
    'Manga direita',
    'Manga esquerda',
    'Viés mangas',
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('opens and closes the extras with the keyboard, keeping the focus (PIT-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const toggle = items.getByRole('button', {
    name: /Adicionais \(não obrigatórios\)/u,
  });
  const extras = items.locator(
    `#${await toggle.getAttribute('aria-controls')}`,
  );
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(extras).toBeVisible();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(extras).toBeHidden();
  await expect(toggle).toBeFocused();

  // While editing, the extras are closed again and open the same way.
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Tipo de roupa')).toBeFocused();
  const editToggle = items.getByRole('button', {
    name: 'Adicionais (não obrigatórios)',
  });
  await expect(editToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(items.getByLabel('Cor frente')).toBeHidden();
  await editToggle.focus();
  await page.keyboard.press('Enter');
  await expect(items.getByLabel('Cor frente')).toBeVisible();
  await expect(editToggle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(items.getByLabel('Cor frente')).toBeFocused();
});

test('edits the seven points and the extras of an item (PIT-01, PIT-02, PIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByText('Quantidade', { exact: true })).toBeVisible();
  await items.getByLabel('Tipo de roupa').fill('REGATA');
  await items.getByLabel('Cor', { exact: true }).fill('PRETA');
  await items.getByLabel('Estampa').fill('Silmer cria a arte');
  await items.getByLabel('Tecido 1').fill('ALGODÃO');
  await items.getByLabel('Definição da gola').fill('REGATA');
  await items.getByLabel('Tipo de serviço').fill('SILK 4 CORES');
  await items
    .getByRole('button', { name: 'Adicionais (não obrigatórios)' })
    .click();
  await items.getByLabel('Cor frente').fill('PRETA');

  // A second item stays half filled: it saves and is listed as missing.
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  await page.locator('#item-1-tipo').fill('BONÉ');
  await page.locator('#item-1-tipo-servico').fill('BORDADO');
  await items.getByRole('button', { name: 'Salvar itens' }).click();

  await expect(
    items.getByRole('heading', { name: 'Item 1 · REGATA · 150 peças' }),
  ).toBeVisible();
  await expect(
    items.getByRole('heading', { name: 'Item 2 · BONÉ · 0 peças' }),
  ).toBeVisible();
  const [first, second] = writes[0].body.value;
  expect(first).toMatchObject({
    cor: 'PRETA',
    cor_frente: 'PRETA',
    estampa: 'Silmer cria a arte',
    gola: 'REGATA',
    malhas: ['ALGODÃO'],
    tipo: 'REGATA',
    tipo_servico: 'SILK 4 CORES',
  });
  expect(second).toMatchObject({
    grade: [],
    malhas: [],
    tipo: 'BONÉ',
    tipo_servico: 'BORDADO',
  });
  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText(
    'Falta para gerar: cor do item 2, estampa do item 2, tecido do item 2, tamanhos do item 2, definição da gola do item 2, valor final e forma de pagamento.',
  );
});

test('shows the quantity the customer said next to the total, and warns when the sizes differ (PIT-09)', async ({
  page,
}) => {
  const told = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      serviceData: { ...pendingOrder.ficha.serviceData, quantity: 140 },
    },
  };
  const noSizes = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], grade: [] }],
      serviceData: { quantity: '30 peças' },
    },
    id: 'order-sem-tamanhos',
    missingFields: ['items[0].grade', 'finalAmount', 'paymentCondition'],
    totalPieces: 0,
  };
  await mockOrders(page, { orders: [told, noSizes] });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).toContainText('cliente informou 140');
  await expect(summary).toContainText(
    'A soma dos tamanhos (150) é diferente da quantidade informada (140)',
  );
  // Non-blocking: generating is still only about the points, amount and method.
  await expect(
    page.getByRole('region', { name: 'Fechamento e pagamento' }),
  ).not.toContainText('quantidade informada');

  await page.goto('/pedidos/order-sem-tamanhos');
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items.locator('dl').first()).toContainText(
    '— (cliente informou 30 peças)',
  );
  await expect(summary).not.toContainText('é diferente');
});

test('names the fields the way the PO asked (PIT-10)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const main = page.locator('main');
  for (const label of [
    'Tipo de roupa',
    'Tamanhos',
    'Tecido',
    'Forma de pagamento',
  ]) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }
  for (const old of [
    'Condição de pagamento',
    'Grade',
    'Malhas',
    'Ainda em branco na ficha',
  ]) {
    await expect(main.getByText(old, { exact: true })).toHaveCount(0);
  }

  const service = page.getByRole('region', { name: 'Dados do atendimento' });
  await page.route('**/api/v1/orders/order-pendente', async (route) => {
    const order = {
      ...pendingOrder,
      ficha: {
        ...pendingOrder.ficha,
        serviceData: { artwork_technique: 'estampada', sizes: '10 de cada' },
      },
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ order }),
    });
  });
  await page.reload();
  await service.getByRole('button', { name: 'Ver' }).click();
  await expect(service.locator('dt')).toHaveText([
    'Técnica de estampa informada',
    'Tamanhos informados',
  ]);
});

test('edits the grade and recomputes every total from it (PFI-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho M').fill('120');
  await expect(items).toContainText('170 peças');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items).toContainText('1 item · 170 peças');
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).toContainText('170');
  expect(writes).toHaveLength(1);
  expect(writes[0].section).toBe('items');
  expect(writes[0].body.value[0].grade).toEqual([
    { quantidade: 120, tamanho: 'M' },
    { quantidade: 50, tamanho: 'G' },
  ]);
});

test('refuses a quantity that is not a whole piece, on the line (PFI-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho M').fill('0');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items.getByRole('alert').first()).toContainText(
    'Use uma quantidade inteira maior que zero.',
  );
  expect(writes).toHaveLength(0);
});

test('accepts "Não aplicável" on sleeves and viés (PFI-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items
    .getByRole('button', { name: 'Adicionais (não obrigatórios)' })
    .click();
  await items.getByLabel('Manga direita não se aplica').check();
  await items.getByRole('button', { name: 'Salvar' }).click();

  await items
    .getByRole('button', { name: /Adicionais \(não obrigatórios\)/u })
    .click();
  await expect(items.getByText('NÃO APLICÁVEL')).toBeVisible();
  expect(writes[0].body.value[0].cor_manga_direita).toBe('NAO APLICAVEL');
});

test('keeps every summary and item field as text typed by hand (PFI-14)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');
  const lists = page.locator('input[list], datalist, [role="combobox"]');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await expect(
    summary.getByLabel('Técnica da arte (referência)'),
  ).toBeEditable();
  await expect(lists).toHaveCount(0);
  await summary.getByRole('button', { name: 'Cancelar' }).click();

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Tipo de roupa')).toBeEditable();
  await expect(lists).toHaveCount(0);
});

test('adds and removes items, fabrics and grade lines', async ({ page }) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByRole('button', { name: 'Adicionar tamanho' }).click();
  await items.getByLabel('Tamanho da linha 3').fill('GG');
  await items.getByLabel('Quantidade do tamanho GG').fill('10');
  await items.getByRole('button', { name: 'Adicionar tecido' }).click();
  await items.getByLabel('Tecido 2').fill('HELANCA LIGHT');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items).toContainText('1 item · 160 peças');
  expect(writes[0].body.value[0].grade).toHaveLength(3);
  expect(writes[0].body.value[0].malhas).toEqual([
    'DRY FIT 100% POLIÉSTER',
    'HELANCA LIGHT',
  ]);
});

test('shows the server grade error on the line it names', async ({ page }) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'INVALID_GRADE', fields: ['items[0].grade[1]'], index: 1 },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho G').fill('7');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items.getByRole('alert').first()).toContainText(
    'Use uma quantidade inteira maior que zero.',
  );
});

test('opens one section at a time (PFI-06)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await summary.getByRole('button', { name: 'Editar' }).click();

  await expect(items.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect(items.getByRole('button', { name: 'Editar' })).toBeEnabled();
});

test('edits the observations and stops at five lines (PFI-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  await expect(observations).toContainText('1 de 5 linhas');
  await expect(observations.getByRole('listitem')).toHaveText([
    'Separar os itens por tamanho.',
  ]);

  await observations.getByRole('button', { name: 'Editar' }).click();
  const addLine = observations.getByRole('button', {
    name: 'Adicionar observação',
  });
  for (let line = 2; line <= 5; line += 1) {
    await addLine.click();
    await observations.getByLabel(`Observação ${line}`).fill(`Linha ${line}`);
  }
  await expect(addLine).toBeDisabled();

  await observations.getByRole('button', { name: 'Salvar' }).click();
  await expect(observations).toContainText('5 de 5 linhas');
  expect(writes[0].section).toBe('observations');
  expect(writes[0].body.value).toHaveLength(5);
});

test('drops a blank observation instead of storing an empty line', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  await observations.getByRole('button', { name: 'Editar' }).click();
  await observations
    .getByRole('button', { name: 'Adicionar observação' })
    .click();
  await observations.getByRole('button', { name: 'Salvar' }).click();

  expect(writes[0].body.value).toEqual(['Separar os itens por tamanho.']);
});

test('shows production as informative and service data as not printed (PFI-08)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const production = page.getByRole('region', { name: 'Controle de produção' });
  await expect(production).toContainText('14 campos');
  await expect(production).toContainText('saem em branco');
  await expect(production.getByRole('button')).toHaveCount(0);

  const service = page.getByRole('region', { name: 'Dados do atendimento' });
  await expect(service).toContainText('não saem na ficha impressa');
  await service.getByRole('button', { name: 'Ver' }).click();
  await expect(service).toContainText('Arte');
  await expect(service).toContainText('Arte recebida do cliente');
  await expect(service).toContainText('Salvador/BA');
  await expect(service).toContainText('Uso próprio');
  await expect(service.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});

test('keeps the sections in the order of the printed ficha (PFI-01, PLA-01)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  await expect(page.locator('main h2')).toHaveText([
    'Resumo do pedido',
    'Lastro do pedido',
    'Itens e especificações',
    'Estampa e arquivos',
    'Observações do pedido',
    'Controle de produção',
    'Dados do atendimento',
    'Fechamento e pagamento',
  ]);
});

test('confirms the order, frees printing, reopens it and locks printing again', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('pedido pendente');
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeDisabled();

  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toContainText('R$ 4.820,00 · Pix');
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(closing).toContainText('Pedido confirmado e ficha gerada.');
  await expect(closing).toContainText('R$ 4.820,00');
  await expect(closing).toContainText('Pix');
  await expect(closing).toContainText('Confirmado por Marina Aguiar');
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
  await expect(
    page.getByText('Disponível depois de gerar o pedido'),
  ).toHaveCount(0);
  expect(writes[0].action).toBe('confirm');
  expect(writes[0].body).toEqual({
    amountText: '4.820,00',
    expectedVersion: 2,
    paymentCondition: 'pix',
  });

  await closing.getByRole('button', { name: 'Reabrir pedido' }).click();
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeDisabled();
  await expect(closing).toContainText('pedido pendente');
  // PCL-07: the amount and the condition survive the reopen.
  await expect(closing.getByLabel('Valor final')).toHaveValue('4.820,00');
  expect(writes[1].action).toBe('reopen');
});

test('refuses a malformed amount next to the field, before the request', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByLabel('Valor final').fill('4,820.00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();

  await expect(closing).toContainText('Use o formato 4.820,00.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('names each blocker the server refused the confirmation with', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: {
      body: {
        code: 'ORDER_NOT_CONFIRMABLE',
        fields: ['items[0].cor', 'items[0].gola', 'paymentCondition'],
      },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar e gerar ficha' })
    .click();

  await expect(closing).toContainText('Escolha a forma de pagamento.');
  await expect(closing).toContainText(
    'Complete os itens antes de gerar: cor do item 1 e definição da gola do item 1.',
  );
  await expect(closing).toContainText('pedido pendente');
});

test('says an order needs an item when the server refuses one without items', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'ORDER_NOT_CONFIRMABLE', fields: ['items'] },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar e gerar ficha' })
    .click();
  await expect(closing).toContainText('O pedido precisa de ao menos um item.');
});

test('keeps "Gerar pedido" as the only primary button of the page (PFI-13)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  await expect(page.locator('main button.primary')).toHaveText([
    'Gerar pedido',
  ]);

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await expect(page.locator('main button.primary')).toHaveText([
    'Gerar pedido',
  ]);
});

test('hides Gerar and Reabrir from whoever does not own the conversation', async ({
  page,
}) => {
  await mockOrders(page, {
    orders: [
      {
        ...confirmedOrder,
        seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
      },
    ],
  });
  await page.goto('/pedidos/order-confirmado');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('R$ 1.180,00');
  await expect(
    closing.getByRole('button', { name: 'Reabrir pedido' }),
  ).toHaveCount(0);
  // PIM-05: any operational session prints a confirmed order.
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
});
