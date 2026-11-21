import { expect, test } from '@playwright/test';
import { commercialReport, mockPainel } from './support/painel-mock.js';

/** @param {import('@playwright/test').Page} page */
async function mockRefresh(page) {
  await mockPainel(page);
  let release = () => {};
  const event = new Promise((resolve) => {
    release = () => resolve(null);
  });
  await page.route('**/api/v1/events?**', async (route) => {
    await event;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'retry: 60000\n\nevent: inbox.order.changed\nid: 9\ndata: {"orderId":"order-1"}\n\n',
    });
  });
  return () => release();
}

test('uma leitura inicial indisponível deixa o vendido desconhecido até tentar novamente', async ({
  page,
}) => {
  await mockPainel(page);
  let failing = true;
  await page.route('**/api/v1/orders/commercial-result?**', (route) =>
    failing
      ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
      : route.fulfill({ json: commercialReport('mes') }),
  );
  await page.goto('/dashboard');
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result).toContainText('Não foi possível consultar as vendas');
  await expect(result.getByText('R$ 0,00')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Urgência da fila' }),
  ).toContainText('espera vendedor');
  failing = false;
  await result.getByRole('button', { name: 'Tentar novamente' }).press('Enter');
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
});

test('uma falha de atualização conserva a última leitura apenas no próprio período', async ({
  page,
}) => {
  const publish = await mockRefresh(page);
  let failNext = false;
  await page.route('**/api/v1/orders/commercial-result?**', (route) => {
    if (failNext)
      return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    const key =
      new URL(route.request().url()).searchParams.get('period') ?? 'mes';
    return route.fulfill({ json: commercialReport(key) });
  });
  await page.goto('/dashboard');
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
  failNext = true;
  publish();
  await expect(result).toContainText('última leitura');
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
  await page.getByRole('radio', { name: 'Hoje', exact: true }).check();
  await expect(result).toContainText('Não foi possível consultar as vendas');
  await expect(result.locator('dd')).toHaveCount(0);
  failNext = false;
  await result.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(result.locator('dd').first()).toHaveText('R$ 300,00');
});

test('a recuperação da fila devolve o foco à urgência sem repetir a leitura de vendas', async ({
  page,
}) => {
  await mockPainel(page);
  let fail = true;
  let salesReads = 0;
  page.on('request', (request) => {
    if (request.url().includes('/orders/commercial-result')) salesReads++;
  });
  await page.route('**/api/v1/dashboard/live?region=queue', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
      : route.fallback(),
  );
  await page.goto('/dashboard');
  const urgency = page.getByRole('region', { name: 'Urgência da fila' });
  await expect(urgency).toContainText('Não foi possível consultar a fila');
  await expect(urgency).not.toContainText('Fila sem esperas');
  await expect(
    page
      .getByRole('region', { name: 'Vendas do período' })
      .locator('dd')
      .first(),
  ).toHaveText('R$ 1.100,00');
  fail = false;
  await urgency
    .getByRole('button', { name: 'Tentar novamente' })
    .press('Enter');
  await expect(urgency.getByRole('heading')).toBeFocused();
  await expect(urgency).toContainText('1 conversa espera vendedor');
  expect(salesReads).toBe(1);
});

test('uma resposta lenta não substitui o recorte escolhido depois dela', async ({
  page,
}) => {
  await mockPainel(page);
  let entered = () => {};
  let release = () => {};
  const received = new Promise((resolve) => {
    entered = () => resolve(null);
  });
  const gate = new Promise((resolve) => {
    release = () => resolve(null);
  });
  await page.route(
    '**/api/v1/orders/commercial-result?period=7dias',
    async (route) => {
      entered();
      await gate;
      await route.fulfill({ json: commercialReport('7dias') }).catch(() => {});
    },
  );
  await page.goto('/dashboard?periodo=hoje');
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result.locator('dd').first()).toHaveText('R$ 300,00');
  await page.getByRole('radio', { name: '7 dias', exact: true }).check();
  await received;
  await page.getByRole('radio', { name: 'Mês', exact: true }).check();
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
  release();
  await expect(
    result.getByRole('link', { name: 'Conferir pedidos', exact: true }),
  ).toHaveAttribute(
    'href',
    '/pedidos?status=confirmado&de=2026-10-01&ate=2026-10-15',
  );
});

test('revogar a leitura remove os valores da tela na próxima consulta', async ({
  page,
}) => {
  const publish = await mockRefresh(page);
  let allowed = true;
  await page.route('**/api/v1/orders/commercial-result?**', (route) =>
    allowed
      ? route.fulfill({ json: commercialReport('mes') })
      : route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
  );
  await page.goto('/dashboard');
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
  allowed = false;
  publish();
  await expect(result).toContainText('Não foi possível consultar as vendas');
  await expect(result.locator('dd')).toHaveCount(0);
  await expect(result.getByRole('link')).toHaveCount(0);
});
