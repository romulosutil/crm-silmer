import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Pesquisa de UX de 15/10/2026, achado 2: o Painel responde por papel e cada
// indicador abre a lista já filtrada. Dados sintéticos.

const QUEUE = Object.freeze({
  assistant: {
    activeCount: 4,
    failedDeliveryCount: 1,
    lastReplyAt: '2026-10-15T14:58:00.000Z',
    stallMinutes: 10,
    stalledCount: 1,
  },
  generatedAt: '2026-10-15T15:00:00.000Z',
  mine: {
    awaitingReplyCount: 2,
    count: 3,
    oldestAwaitingSince: '2026-10-15T14:35:00.000Z',
  },
  waitingHandoff: {
    count: 3,
    oldestSince: '2026-10-15T09:00:00.000Z',
    overdueCount: 1,
  },
});

/** @param {string} key */
function ordersSummary(key) {
  const byPeriod = /** @type {Record<string, [number, number, string]>} */ ({
    '7dias': [5, 1_230_000, '2026-10-09'],
    hoje: [1, 180_000, '2026-10-15'],
    mes: [9, 2_480_000, '2026-10-01'],
  });
  const [confirmedCount, soldAmountCents, from] = byPeriod[key];
  return {
    averageTicketCents: 0,
    confirmedCount: 40,
    deliveries: {
      dueSoonCount: 4,
      dueSoonUntil: '2026-10-21',
      oldestOverdueOn: '2026-10-09',
      overdueCount: 2,
    },
    pendingCount: 6,
    period: {
      confirmedCount,
      from,
      key,
      soldAmountCents,
      timeZone: 'America/Sao_Paulo',
      to: '2026-10-15',
    },
    soldAmountCents: 9_000_000,
    storeNewCount: 0,
    storeNewOldestPaidAt: null,
    today: '2026-10-15',
    totalPiecesSold: 0,
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{manager?: boolean}} [options]
 */
async function mockPainel(page, { manager = true } = {}) {
  /** @type {string[]} */
  const periods = [];
  /** @type {URLSearchParams[]} */
  const orderLists = [];
  /** @type {URLSearchParams[]} */
  const inboxLists = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (/** @type {unknown} */ body, status = 200) =>
      route.fulfill({
        body: JSON.stringify(body),
        contentType: 'application/json',
        status,
      });
    if (url.pathname === '/api/v1/sessions/current') {
      return json({
        user: {
          capabilities: manager ? ['COMMERCIAL_ADMIN'] : [],
          functionName: 'Vendedor',
          id: manager ? 'admin-1' : 'seller-1',
          name: manager ? 'Gestor Sintético' : 'Atendente Sintética',
        },
      });
    }
    if (url.pathname === '/api/v1/events') {
      return route.fulfill({
        body: 'retry: 60000\n\n: connected\n\n',
        contentType: 'text/event-stream',
      });
    }
    if (url.pathname === '/api/v1/orders/summary') {
      const key = url.searchParams.get('period') ?? 'hoje';
      periods.push(key);
      return json(ordersSummary(key));
    }
    if (url.pathname === '/api/v1/inbox/summary') return json(QUEUE);
    if (url.pathname === '/api/v1/orders') {
      orderLists.push(url.searchParams);
      return json({
        counts: { confirmado: 0, pendente: 0 },
        items: [],
        nextCursor: null,
      });
    }
    if (url.pathname === '/api/v1/inbox/conversations') {
      inboxLists.push(url.searchParams);
      return json({ hasMore: false, items: [], totalCount: 0 });
    }
    if (url.pathname === '/api/v1/users/assignable') {
      return json({ items: [] });
    }
    return json({ error: { code: 'NOT_FOUND' } }, 404);
  });
  return { inboxLists, orderLists, periods };
}

/** @param {import('@playwright/test').Page} page */
function sectionTitles(page) {
  return page.locator('#main-content').getByRole('heading', { level: 2 });
}

test('the manager reads the day first, with the period on the server', async ({
  page,
}) => {
  const mock = await mockPainel(page);
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Dashboard', level: 1 }),
  ).toBeFocused();
  await expect(
    page.getByText(
      'Quinta-feira, 15 de outubro: vendas, entregas e quem espera atendimento.',
    ),
  ).toBeVisible();
  await expect(sectionTitles(page)).toHaveText([
    'Vendas e entregas',
    'Atendimento',
  ]);
  // No technical copy from the old Dashboard.
  await expect(page.getByText(/100 conversas|Conteúdo mínimo/u)).toHaveCount(0);

  const sold = page.getByRole('link', { name: /^Vendido hoje/u });
  await expect(sold).toContainText('R$ 1.800,00');
  await expect(
    page.getByRole('link', { name: /^Entregas atrasadas 2/u }),
  ).toContainText('A mais antiga era para 09/10');
  await expect(
    page.getByRole('link', { name: /^Esperando vendedor 3/u }),
  ).toContainText('Fora do prazo');
  await expect(
    page.getByRole('link', { name: /^Assistente Pede atenção/u }),
  ).toContainText('1 conversa sem resposta há mais de 10 min');

  const periodGroup = page.getByRole('group', { name: 'Período das vendas' });
  await expect(
    periodGroup.getByRole('button', { name: 'Hoje' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await periodGroup.getByRole('button', { name: '7 dias' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: /^Vendido em 7 dias/u }),
  ).toContainText('R$ 12.300,00');
  await expect(
    periodGroup.getByRole('button', { name: '7 dias' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#main-content').getByRole('status')).toHaveText(
    'Vendido em 7 dias atualizado.',
  );
  expect(mock.periods).toEqual(['hoje', '7dias']);

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Each indicator opens its list already filtered, by keyboard.
  await page.getByRole('link', { name: /^Entregas atrasadas/u }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/pedidos?entrega=atrasada');
  await expect(
    page.getByRole('button', { name: 'Entrega atrasada' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => mock.orderLists.at(-1)?.get('delivery') ?? null)
    .toBe('overdue');

  await page.goBack();
  await page.getByRole('link', { name: /^Esperando vendedor/u }).click();
  await expect(page).toHaveURL('/inbox?situacao=aguardando');
  await expect
    .poll(() => mock.inboxLists.at(-1)?.get('pendingHandoff') ?? null)
    .toBe('true');
});

test('the seller reads their own queue first', async ({ page }) => {
  const mock = await mockPainel(page, { manager: false });
  await page.goto('/dashboard');
  await expect(sectionTitles(page)).toHaveText([
    'Minha fila',
    'Pedidos e entregas',
  ]);
  const mine = page.getByRole('link', { name: /^Minhas conversas 3/u });
  await expect(mine).toContainText(
    '2 clientes esperam sua resposta; o primeiro escreveu há 25 min',
  );
  // The assistant's health is the manager's question.
  await expect(page.getByRole('link', { name: /^Assistente/u })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await mine.click();
  await expect(page).toHaveURL('/inbox?fila=minhas');
  await expect
    .poll(() => mock.inboxLists.at(-1)?.get('assignedUserId') ?? null)
    .toBe('seller-1');
});

test('on a 390 px phone the indicators stack without sideways scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockPainel(page);
  await page.goto('/dashboard');
  await expect(
    page.getByRole('link', { name: /^Vendido hoje/u }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const boxes = await page
    .locator('.metric-card')
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().left),
    );
  expect(new Set(boxes.map(Math.round)).size).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
