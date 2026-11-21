import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockPainel } from './support/painel-mock.js';

test('o resultado concilia o mês e abre os pedidos do mesmo período por teclado', async ({
  page,
}) => {
  const mock = await mockPainel(page);
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Dashboard', level: 1 }),
  ).toBeFocused();
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result.locator('dd').first()).toHaveText('R$ 1.100,00');
  await expect(result.locator('dd').nth(1)).toHaveText('4');
  await expect(result.locator('dd').nth(2)).toHaveText('R$ 275,00');
  const team = page.getByRole('region', { name: 'Vendedores' });
  await expect(team).toContainText('R$ 800,00');
  await expect(team).toContainText('R$ 1.100,00');
  await expect(
    page.getByRole('heading', { name: 'Minhas providências' }),
  ).toHaveCount(0);
  const confirm = result.getByRole('link', {
    name: 'Conferir pedidos',
    exact: true,
  });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    '/pedidos?status=confirmado&de=2026-10-01&ate=2026-10-15',
  );
  await expect
    .poll(() => mock.orderLists.at(-1)?.get('from'))
    .toBe('2026-10-01');
  expect(mock.orderLists.at(-1)?.get('to')).toBe('2026-10-15');
  await page.goBack();
  await expect(
    page.getByRole('radio', { name: 'Mês', exact: true }),
  ).toBeChecked();
  await expect(
    result.getByRole('link', { name: 'Conferir pedidos', exact: true }),
  ).toBeFocused();
});

test('the seller works from their own queue and navigates to the real Inbox by keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPainel(page, { manager: false });
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await expect(
    actions.getByRole('button', { name: 'Tudo 5', exact: true }),
  ).toBeVisible();
  await expect(
    actions.getByRole('button', { name: 'Pedidos 2', exact: true }),
  ).toBeVisible();
  const row = actions.getByRole('button', {
    name: 'Abrir Cliente Sintético',
    exact: true,
  });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(
    actions.getByRole('heading', { name: 'Cliente Sintético', exact: true }),
  ).toBeFocused();
  const reply = actions.getByRole('link', {
    name: 'Abrir conversa para responder',
  });
  await expect(reply).toHaveAttribute('href', '/inbox/reply-1');
  await expect(actions.locator('textarea')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Desempenho da equipe' }),
  ).toHaveCount(0);
  await actions.getByRole('button', { name: 'Voltar às providências' }).click();
  await expect(row).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await row.click();
  await reply.click();
  await expect(page).toHaveURL('/inbox/reply-1');
});

test('the queue and detail fit phone, tablet and notebook without horizontal scrolling', async ({
  page,
}) => {
  await mockPainel(page, { manager: false });
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await expect(
    actions.getByRole('button', { name: 'Tudo 5', exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth -
          globalThis.document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const box = await actions
      .getByRole('button', { name: 'Abrir Equipe Sintética', exact: true })
      .boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: test.info().outputPath(`actions-${width}.png`),
      fullPage: true,
    });
    await actions
      .getByRole('button', { name: 'Abrir Equipe Sintética', exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth -
          globalThis.document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: test.info().outputPath(`detail-${width}.png`),
      fullPage: true,
    });
    const back = actions.getByRole('button', {
      name: 'Voltar às providências',
      exact: true,
    });
    if (await back.isVisible()) await back.click();
    else
      await actions
        .getByRole('button', { name: 'Tudo 5', exact: true })
        .click();
  }
  await page.getByRole('button', { name: 'Escuro', exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath('actions-dark-1440.png'),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('PNL-05: série, controles e tabela cabem a 320, 390 e 1366 px no tema escuro', async ({
  page,
}) => {
  await mockPainel(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard?periodo=7dias');
  const daily = page.getByRole('region', { name: 'Vendas por dia' });
  await expect(
    daily
      .getByRole('group', { name: 'Selecionar dia da venda' })
      .getByRole('button'),
  ).toHaveCount(7);
  await page.getByRole('button', { name: 'Escuro', exact: true }).click();
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth,
      ),
    ).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await daily.getByRole('button', { name: 'Tabela', exact: true }).click();
  await expect(daily.getByRole('table')).toBeVisible();
});

test('PERF-05/MET-04: the team page reconciles sales and switches views by keyboard', async ({
  page,
}) => {
  await mockPainel(page);
  await page.goto('/dashboard?periodo=7dias');
  await page
    .getByRole('region', { name: 'Vendedores' })
    .getByRole('link', { name: 'Ver desempenho da equipe' })
    .click();
  await expect(page).toHaveURL('/dashboard/equipe?periodo=7dias');
  await expect(
    page.getByRole('heading', { name: 'Desempenho da equipe', level: 1 }),
  ).toBeFocused();
  await expect(page.locator('.page-heading')).toContainText(
    'de segunda a sexta, 9h–12h e 13h–18h, horário de São Paulo',
  );
  const table = page.getByRole('region', { name: 'Por vendedor' });
  const views = table.getByRole('group', { name: 'Visão da tabela' });
  await expect(views.getByRole('button', { name: 'Vendas' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(table.getByRole('columnheader')).toHaveCount(7);
  await expect(
    table.getByRole('columnheader', { name: /Conversão/u }),
  ).toBeVisible();
  await expect(
    table.getByRole('columnheader', { name: /Resposta no prazo/u }),
  ).toBeVisible();
  await expect(table.getByRole('rowheader')).toHaveCount(5);
  await expect(table.getByRole('row', { name: /^Total/u })).toContainText(
    'R$ 16.400,00',
  );
  await expect(
    table.getByRole('columnheader', { name: /Vendido/u }),
  ).toHaveAttribute('aria-sort', 'descending');
  await table.getByRole('button', { name: /^Vendido/u }).click();
  await expect(
    table.getByRole('columnheader', { name: /Vendido/u }),
  ).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('rowheader').first()).toContainText(
    'Vendedor Sintético',
  );
  await expect(table.getByRole('rowheader').nth(2)).toContainText(
    'Loja do site',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await views.getByRole('button', { name: 'Atendimento' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    views.getByRole('button', { name: 'Atendimento' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const seller = table.getByRole('row', { name: /Vendedor Sintético/u });
  await expect(seller).toContainText('14 min');
  await expect(seller).toContainText('1 em aberto');
  await expect(seller).toContainText('—');
  await expect(table.getByRole('row', { name: /^Total/u })).toHaveCount(0);
  await expect(table).toContainText('Pedidos de atendimento ainda sem tomada');

  await views.getByRole('button', { name: 'Perdas' }).click();
  await expect(table.getByRole('row', { name: /^Total/u })).toContainText('5');
  await expect(
    table.getByRole('row', { name: /Atendente Sintética/u }),
  ).toContainText('Preço (2)');
  await expect(
    page.getByRole('region', { name: 'Por que perdemos' }),
  ).toContainText('5 leads marcados como perdidos');
  await expect(
    page.getByRole('region', { name: 'Como medimos' }),
  ).toContainText('nada é inferido');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth -
          globalThis.document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: test.info().outputPath(`team-page-${width}.png`),
      fullPage: true,
    });
  }
  await views.getByRole('button', { name: 'Vendas' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table.getByRole('cell').first()).toHaveAttribute(
    'headers',
    'team-person-0 team-sold',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('PERF-07: a seller who opens the team page goes back to their own Dashboard', async ({
  page,
}) => {
  await mockPainel(page, { manager: false });
  await page.goto('/dashboard/equipe');
  await expect(page).toHaveURL('/dashboard');
  await expect(
    page.getByRole('region', { name: 'Seu resultado' }),
  ).toContainText('R$ 8.400,00');
  await expect(page.getByRole('region', { name: 'Vendedores' })).toHaveCount(0);
});

test('a série e os dois intervalos abrem listas que explicam os valores exibidos', async ({
  page,
}) => {
  await mockPainel(page);
  await page.goto('/dashboard?periodo=7dias');
  const daily = page.getByRole('region', { name: 'Vendas por dia' });
  const bars = daily.getByRole('group', { name: 'Selecionar dia da venda' });
  await bars.getByRole('button').last().press('ArrowLeft');
  await expect(bars.getByRole('button').nth(5)).toBeFocused();
  await expect(bars.getByRole('button').nth(5)).toHaveAccessibleName(
    /500,00.*1 pedido/u,
  );
  await expect(
    daily.getByRole('link', { name: 'Conferir pedidos do dia' }),
  ).toHaveAttribute(
    'href',
    '/pedidos?status=confirmado&de=2026-10-14&ate=2026-10-14',
  );
  const comparison = page.getByRole('region', { name: 'Comparação de vendas' });
  await expect(comparison).toContainText('base anterior zero');
  await expect(
    comparison.getByRole('link', { name: /intervalo atual/u }),
  ).toHaveAttribute(
    'href',
    '/pedidos?status=confirmado&de=2026-10-09&ate=2026-10-14',
  );
  await expect(
    comparison.getByRole('link', { name: /intervalo anterior/u }),
  ).toHaveAttribute(
    'href',
    '/pedidos?status=confirmado&de=2026-10-03&ate=2026-10-08',
  );
  await comparison
    .getByRole('button', { name: 'Tabela', exact: true })
    .press('Enter');
  const sold = comparison.getByRole('row', { name: /^Vendido/u });
  await expect(sold.getByRole('cell').first()).toHaveText('R$ 500,00');
  await expect(sold.getByRole('cell').nth(1)).toHaveText('R$ 0,00');
  await page.getByRole('radio', { name: 'Hoje', exact: true }).check();
  await expect(comparison).toContainText('Hoje, parcial');
  await expect(
    comparison.getByRole('columnheader', { name: 'Diferença' }),
  ).toHaveCount(0);
});
