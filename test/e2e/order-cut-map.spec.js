import { expect, test } from '@playwright/test';
import { confirmedOrder, mockOrders } from './support/orders-mock.js';

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
  await page
    .getByRole('combobox', { name: 'Definir etapa do pedido 05-CRM' })
    .selectOption('arte');
  expect(writes).toEqual([]);
  await page
    .getByRole('button', { name: 'Salvar etapa do pedido 05-CRM' })
    .click();
  const advance = page.getByRole('button', {
    name: 'Enviar para produção 05-CRM',
  });
  await expect(advance).toBeVisible();
  await advance.click();
  await expect(
    page.getByRole('button', { name: 'Marcar como pronto 05-CRM' }),
  ).toBeVisible();
  expect(writes).toEqual([
    { stage: 'arte', expectedVersion: 4 },
    { stage: 'producao', expectedVersion: 5 },
  ]);
});

test('CAR-04/06: selections preview and download all audiences on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOrders(page, {
    orders: ['arte', 'producao'].map((stage, index) => ({
      ...confirmedOrder,
      productionStage: stage,
      productionEditable: true,
      cutMapAvailable: true,
      id: `order-cut-${index}`,
      number: `${index + 6}-CRM`,
      deliveredOn: null,
    })),
  });
  const url = /\/api\/v1\/orders\/cut-map(\/pdf)?\?/u;
  await page.route(url, async (route) => {
    const request = new URL(route.request().url());
    expect(request.searchParams.get('orders')?.split(',').sort()).toEqual([
      'order-cut-0',
      'order-cut-1',
    ]);
    if (request.pathname.endsWith('/pdf')) {
      expect(request.searchParams.get('fingerprint')).toBe('synthetic-preview');
      await route.fulfill({
        contentType: 'application/pdf',
        body: '%PDF-1.4\n% synthetic cut map\n',
      });
      return;
    }
    await route.fulfill({
      json: {
        fingerprint: 'synthetic-preview',
        map: {
          total: 42,
          orders: [{ number: '6-CRM' }, { number: '7-CRM' }],
          groups: ['unissex', 'masculino', 'feminino', 'infantil'].map(
            (audience, index) => ({
              audience,
              model: 'All Star',
              color: 'Branca',
              fabrics: ['Dry fit'],
              details: [],
              grade: [{ size: 'M', quantity: 9 + index }],
              total: 9 + index,
              orders: ['6-CRM', '7-CRM'],
            }),
          ),
        },
      },
    });
  });
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Mapa de corte' }).press('Enter');
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
  await preview.getByRole('button', { name: 'Baixar PDF' }).click();
  expect((await download).suggestedFilename()).toBe('mapa-de-corte.pdf');
  await page.keyboard.press('Escape');
  await expect(review).toBeFocused();
  await expect(
    page.getByRole('checkbox', { name: 'Selecionar pedido 6-CRM' }),
  ).toBeChecked();
});
