import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { confirmedOrder, mockOrders } from './support/orders-mock.js';

test('CAR-11: consults the history and downloads the original PDF without finding an order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOrders(page, { orders: [] });
  const generatedAt = '2026-11-27T14:00:00.000Z';
  const original = '%PDF-1.4\n% original synthetic cut map\n';
  let historyRequests = 0;
  await page.route(/\/api\/v1\/orders\/cut-maps(\?|$)/u, async (route) => {
    historyRequests += 1;
    const before = new URL(route.request().url()).searchParams.get('before');
    if (historyRequests === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } },
      });
    } else if (before === '24') {
      await route.fulfill({
        json: {
          items: [
            {
              number: '23',
              generatedAt,
              orders: ['17-CRM'],
              pdfAvailable: false,
            },
          ],
          nextCursor: null,
        },
      });
    } else {
      expect(before).toBeNull();
      await route.fulfill({
        json: {
          items: [
            {
              number: '24',
              generatedAt,
              orders: ['18-CRM', '19-CRM'],
              pdfAvailable: true,
            },
          ],
          nextCursor: '24',
        },
      });
    }
  });
  await page.route('**/api/v1/orders/cut-map/24/pdf', (route) => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ contentType: 'application/pdf', body: original });
  });

  await page.goto('/pedidos');
  const toggle = page.getByRole('button', {
    name: 'Mapas de corte',
    exact: true,
  });
  const history = page.getByRole('region', {
    name: 'Histórico de mapas de corte',
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(historyRequests).toBe(0);
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(history.getByRole('alert')).toHaveText(
    'Não foi possível carregar o histórico.',
  );
  await history
    .getByRole('button', { name: 'Tentar novamente' })
    .press('Enter');
  await expect(
    history.getByRole('heading', { name: 'Mapa de corte 24' }),
  ).toBeFocused();
  await expect(history.locator('time')).toHaveAttribute(
    'datetime',
    generatedAt,
  );
  await expect(history.locator('time')).toContainText('27/11/2026');
  await expect(history.getByText('18-CRM, 19-CRM')).toBeVisible();

  const download = page.waitForEvent('download');
  await history
    .getByRole('button', { name: 'Baixar PDF do mapa de corte 24' })
    .press('Enter');
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe('mapa-de-corte-24.pdf');
  expect(await readFile(await pdf.path(), 'utf8')).toBe(original);
  await history
    .getByRole('button', { name: 'Carregar mais mapas' })
    .press('Enter');
  const legacy = history
    .getByRole('listitem')
    .filter({ hasText: 'Mapa de corte 23' });
  await expect(legacy.getByRole('heading')).toBeFocused();
  await expect(legacy.getByText('17-CRM')).toBeVisible();
  await expect(legacy.getByText('PDF indisponível')).toBeVisible();
  await expect(legacy.getByRole('button')).toHaveCount(0);
  await expect(
    history.getByRole('button', { name: 'Carregar mais mapas' }),
  ).toHaveCount(0);
  expect(
    await history.evaluate(
      (region) => region.scrollWidth <= region.clientWidth,
    ),
  ).toBe(true);

  await toggle.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(history).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(
    page.getByRole('button', { name: 'Histórico de mapas de corte' }),
  ).toBeVisible();
});

test('CAR-12: searches the full history by map number or an included order number', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOrders(page, { orders: [] });
  const generatedAt = '2026-11-27T14:00:00.000Z';
  const recent = {
    number: '24',
    generatedAt,
    orders: ['19-CRM'],
    pdfAvailable: true,
  };
  const old = {
    number: '3',
    generatedAt,
    orders: ['07-CRM', '15-CRM'],
    pdfAvailable: true,
  };
  /** @type {(string|null)[]} */
  const queries = [];
  await page.route(/\/api\/v1\/orders\/cut-maps(\?|$)/u, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('before')).toBeNull();
    const query = params.get('q');
    queries.push(query);
    if (query === 'cliente') {
      await route.fulfill({
        status: 400,
        json: { error: { code: 'INVALID_REQUEST' } },
      });
      return;
    }
    const items =
      query === null ? [recent] : ['3', '07-CRM'].includes(query) ? [old] : [];
    await route.fulfill({
      json: { items, nextCursor: query === null ? '24' : null },
    });
  });
  await page.goto('/pedidos');
  await page
    .getByRole('button', { name: 'Mapas de corte', exact: true })
    .press('Enter');
  const history = page.getByRole('region', {
    name: 'Histórico de mapas de corte',
  });
  const query = history.getByRole('searchbox', {
    name: 'Número do mapa ou do pedido',
  });
  const olderMap = history.getByRole('heading', {
    name: 'Mapa de corte 3',
    exact: true,
  });
  const recentMap = history.getByRole('heading', { name: 'Mapa de corte 24' });
  await expect(recentMap).toBeVisible();
  await expect(olderMap).toHaveCount(0);

  await query.fill('3');
  await query.press('Enter');
  await expect(olderMap).toBeVisible();
  await expect(recentMap).toHaveCount(0);
  await expect(query).toBeFocused();

  await query.fill('07-CRM');
  await history
    .getByRole('button', { name: 'Buscar', exact: true })
    .press('Enter');
  await expect(history.getByText('07-CRM, 15-CRM')).toBeVisible();
  await expect(
    history.getByRole('button', { name: 'Baixar PDF do mapa de corte 3' }),
  ).toBeVisible();

  await query.fill('999');
  await query.press('Enter');
  await expect(history.getByRole('status')).toHaveText(
    'Nenhum mapa de corte encontrado para essa busca.',
  );
  await query.fill('cliente');
  await query.press('Enter');
  await expect(query).toHaveAttribute('aria-invalid', 'true');
  await expect(history.getByRole('alert')).toContainText(
    'Digite um número de mapa ou de pedido',
  );

  await history
    .getByRole('button', { name: 'Limpar busca de mapas de corte' })
    .press('Enter');
  await expect(query).toHaveValue('');
  await expect(query).toBeFocused();
  await expect(recentMap).toBeVisible();
  expect(queries).toEqual([null, '3', '07-CRM', '999', 'cliente', null]);
});

test('CAR-02: a legacy production step requires explicit confirmation and advances', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    orders: [
      { ...confirmedOrder, productionEditable: true, productionStage: null },
    ],
    onWrite: ({ body }) => writes.push(body),
  });
  await page.goto('/pedidos');
  await expect(
    page.getByText('Etapa a confirmar', { exact: true }),
  ).toBeVisible();
  const more = page.getByRole('button', {
    name: 'Mais ações do pedido 05-CRM',
  });
  const select = page.getByRole('combobox', {
    name: 'Definir etapa do pedido 05-CRM',
  });
  await expect(select).toHaveCount(0);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(select).toBeFocused();
  await select.selectOption('arte');
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(select).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.keyboard.press('Enter');
  await select.selectOption('arte');
  await page
    .getByRole('button', { name: 'Salvar etapa do pedido 05-CRM' })
    .click();
  const advance = page.getByRole('button', {
    name: 'Enviar para produção 05-CRM',
  });
  await expect(page.getByText('Na arte', { exact: true })).toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await expect(advance).toBeVisible();
  await advance.click();
  await expect(page.getByText('Na produção', { exact: true })).toBeVisible();
  await more.click();
  await expect(
    page.getByRole('button', { name: 'Marcar como pronto 05-CRM' }),
  ).toBeVisible();
  expect(writes).toEqual([
    { stage: 'arte', expectedVersion: 4 },
    { stage: 'producao', expectedVersion: 5 },
  ]);
});

test('CAR-04/06/09: numbered maps can be consulted and their orders cannot be selected again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let generations = 0;
  const memberships = new Map();
  const generatedAt = '2026-11-27T14:00:00.000Z';
  const orders = ['arte', 'producao', 'arte'].map((stage, index) => ({
    ...confirmedOrder,
    productionStage: stage,
    productionEditable: true,
    cutMapAvailable: true,
    id: `order-cut-${index}`,
    number: `${index + 6}-CRM`,
    deliveredOn: null,
  }));
  await mockOrders(page, { orders });
  await page.route('**/api/v1/orders/cut-maps', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(/\/api\/v1\/orders(\?|$)/u, (route) =>
    route.fulfill({
      json: {
        counts: { confirmado: orders.length, pendente: 0 },
        items: orders.map((order) => ({
          ...order,
          cutMapAvailable: !memberships.has(order.id),
          cutMap: memberships.get(order.id) ?? null,
        })),
        nextCursor: null,
      },
    }),
  );
  const pdfBody = '%PDF-1.4\n% synthetic cut map\n';
  await page.route(
    /\/api\/v1\/orders\/cut-map\/[12](\/pdf)?$/u,
    async (route) => {
      const parts = new URL(route.request().url()).pathname.split('/');
      const number = parts[5];
      const included = orders.filter(
        ({ id }) => memberships.get(id)?.number === number,
      );
      expect(route.request().method()).toBe('GET');
      if (parts.at(-1) === 'pdf') {
        await route.fulfill({ contentType: 'application/pdf', body: pdfBody });
        return;
      }
      await route.fulfill({
        json: {
          map: {
            number,
            generatedAt,
            orders: included.map((order) => order.number),
            pdfAvailable: true,
          },
        },
      });
    },
  );
  const url = /\/api\/v1\/orders\/cut-map(\/pdf$|\?)/u;
  await page.route(url, async (route) => {
    const request = new URL(route.request().url());
    if (request.pathname.endsWith('/pdf')) {
      expect(route.request().method()).toBe('POST');
      const selection = route.request().postDataJSON();
      expect(selection.orders.sort()).toEqual(
        generations ? ['order-cut-2'] : ['order-cut-0', 'order-cut-1'],
      );
      expect(selection.fingerprint).toBe('synthetic-preview');
      generations += 1;
      const number = String(generations);
      for (const id of selection.orders) {
        expect(memberships.has(id)).toBe(false);
        memberships.set(id, { number, generatedAt, orderVersion: 4 });
      }
      await route.fulfill({
        contentType: 'application/pdf',
        headers: { 'x-cut-map-number': number },
        body: pdfBody,
      });
      return;
    }
    const ids = request.searchParams.get('orders')?.split(',').sort();
    expect(ids).toEqual(
      generations ? ['order-cut-2'] : ['order-cut-0', 'order-cut-1'],
    );
    const selected = orders.filter(({ id }) => ids?.includes(id));
    await route.fulfill({
      json: {
        fingerprint: 'synthetic-preview',
        map: {
          total: 42,
          orders: selected,
          groups: ['unissex', 'masculino', 'feminino', 'infantil'].map(
            (audience, index) => ({
              audience,
              model: 'All Star',
              color: 'Branca',
              fabrics: ['Dry fit'],
              details: [],
              grade: [{ size: 'M', quantity: 9 + index }],
              total: 9 + index,
              orders: selected.map(({ number }) => number),
            }),
          ),
        },
      },
    });
  });
  await page.goto('/pedidos');
  await page
    .getByRole('button', { name: 'Mapas de corte', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Novo mapa de corte' }).press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Selecione os pedidos para o corte' }),
  ).toBeFocused();
  await page
    .getByRole('checkbox', { name: 'Selecionar pedido 6-CRM' })
    .press('Space');
  await page
    .getByRole('checkbox', { name: 'Selecionar pedido 7-CRM' })
    .press('Space');
  await expect(page.getByText('2 pedidos selecionados')).toBeVisible();
  const review = page.getByRole('button', { name: 'Conferir mapa' });
  await review.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Conferir mapa de corte' });
  await expect(preview.getByText('42 peças a cortar')).toBeVisible();
  for (const audience of ['Unissex', 'Masculino', 'Feminino', 'Infantil']) {
    await expect(preview.getByText(audience, { exact: true })).toHaveCount(1);
  }
  const download = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Gerar mapa e baixar PDF' })
    .click();
  const firstPdf = await download;
  expect(firstPdf.suggestedFilename()).toBe('mapa-de-corte-1.pdf');
  await expect(preview.getByRole('status')).toHaveText(
    'Mapa de corte 1 gerado.',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Selecione os pedidos para o corte' }),
  ).toBeFocused();
  await expect(
    page.getByRole('checkbox', { name: 'Selecionar pedido 6-CRM' }),
  ).toHaveCount(0);
  await expect(review).toBeDisabled();
  const badge = page.getByRole('button', {
    name: 'Mapa de corte 1 · Pedido 6-CRM',
  });
  await expect(badge).toBeVisible();
  await badge.press('Enter');
  const membership = page.getByRole('dialog', { name: 'Mapa de corte 1' });
  await expect(
    membership.getByText('Pedido 6-CRM', { exact: true }),
  ).toBeVisible();
  await expect(
    membership.getByText('Pedido 7-CRM', { exact: true }),
  ).toBeVisible();
  const redownload = page.waitForEvent('download');
  await membership.getByRole('button', { name: 'Baixar PDF' }).press('Enter');
  const reissued = await redownload;
  expect(reissued.suggestedFilename()).toBe(firstPdf.suggestedFilename());
  expect(await readFile(await reissued.path())).toEqual(
    await readFile(await firstPdf.path()),
  );
  expect(generations).toBe(1);
  await page.keyboard.press('Escape');
  await expect(badge).toBeFocused();

  await page
    .getByRole('checkbox', { name: 'Selecionar pedido 8-CRM' })
    .press('Space');
  await review.press('Enter');
  const another = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Gerar mapa e baixar PDF' })
    .press('Enter');
  expect((await another).suggestedFilename()).toBe('mapa-de-corte-2.pdf');
  await page.reload();
  await expect(badge).toBeVisible();
  await badge.press('Enter');
  await expect(
    membership.getByText('Pedido 6-CRM', { exact: true }),
  ).toBeVisible();
});
