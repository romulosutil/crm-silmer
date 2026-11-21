import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';

const prototypeUrl = new URL('./painel-administrativo.html', import.meta.url);
let browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function openPrototype(t, width = 1366) {
  const context = await browser.newContext({
    offline: true,
    locale: 'pt-BR',
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    if (/^https?:/u.test(request.url())) requests.push(request.url());
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'Erros JavaScript durante a jornada');
    assert.deepEqual(
      requests,
      [],
      'Um HTML offline deve conter os recursos usados',
    );
  });
  await page.goto(prototypeUrl.href);
  await page.locator('#viewtitle').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

function cents(text) {
  const amount = text.match(/R\$\s*([\d.]+,\d{2})/u);
  assert.ok(amount, `Valor em reais esperado em ${text}`);
  return Number(amount[1].replace(/[.,]/gu, ''));
}

async function revenue(page) {
  return cents(await page.locator('.hero b').first().innerText());
}

async function expectReflow(page) {
  const fits = await page.evaluate(() => {
    const stage = document.querySelector('#stage');
    return (
      document.documentElement.scrollWidth <= innerWidth + 1 &&
      stage.scrollWidth <= stage.clientWidth + 1
    );
  });
  assert.ok(fits, 'Conteúdo ultrapassou a largura disponível');
}

async function verifyOrderList(page, amount, count) {
  const entries = page.locator('#stage .entry');
  await expect(entries).toHaveCount(count);
  const total = (await entries.allInnerTexts()).reduce(
    (sum, line) => sum + cents(line),
    0,
  );
  assert.equal(total, amount);
  assert.equal(cents(await page.locator('#stage h3').innerText()), amount);
}

test('os controles de largura e tema alternam pelo teclado e conservam o recorte', async (t) => {
  const page = await openPrototype(t);
  const sold = await revenue(page);
  const sizes = page.getByRole('group', { name: 'Largura da prévia' });
  const themes = page.getByRole('group', { name: 'Tema da prévia' });
  const preview = page.locator('#screen');
  const windowSize = sizes.getByRole('radio', { name: 'Janela' });
  const mobileSize = sizes.getByRole('radio', { name: 'Celular' });
  await expect(windowSize).toBeChecked();
  await windowSize.focus();
  await page.keyboard.press('ArrowRight');
  await expect(mobileSize).toBeChecked();
  await expect(mobileSize).toBeFocused();
  await expect(preview).toHaveClass(/\bmobile\b/u);
  await expect(page.locator('#preview-mode')).toContainText(/celular/iu);
  await themes.getByRole('radio', { name: 'Claro' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(themes.getByRole('radio', { name: 'Escuro' })).toBeFocused();
  await expect(themes.getByRole('radio', { name: 'Escuro' })).toBeChecked();
  await expect(preview).toHaveClass(/\bnight\b/u);
  await expect(page.locator('#preview-mode')).toContainText(/escuro/iu);
  await page.keyboard.press('ArrowLeft');
  await expect(themes.getByRole('radio', { name: 'Claro' })).toBeChecked();
  await expect(preview).not.toHaveClass(/\bnight\b/u);
  await mobileSize.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(windowSize).toBeChecked();
  await expect(preview).not.toHaveClass(/\bmobile\b/u);
  assert.equal(await revenue(page), sold);
});

test('a lista de confirmados reconcilia com o resultado, o vendedor e o dia', async (t) => {
  const page = await openPrototype(t);
  await page.selectOption('#scenario', 'conciliacao');
  for (const [period, count, amount] of [
    ['mes', 4, 110_000],
    ['semana', 3, 80_000],
    ['hoje', 1, 50_000],
  ]) {
    await page.locator(`[data-period="${period}"]`).click();
    assert.equal(await revenue(page), amount);
    await page.locator('[data-orders="all"]').click();
    await verifyOrderList(page, amount, count);
    await page.locator('#stage [data-view="resultado"]').click();
    await expect(page.locator(`[data-period="${period}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.locator('[data-period="mes"]').click();
  const series = page.locator('[data-revenue-series]');
  const mode = series.getByRole('group', {
    name: 'Apresentação das vendas por dia',
  });
  const chart = mode.getByRole('button', { name: 'Gráfico' });
  const detail = mode.getByRole('button', { name: 'Tabela' });
  await expect(chart).toHaveAttribute('aria-pressed', 'true');
  await expect(series.locator('#revenue-day')).toBeVisible();
  await series.locator('#revenue-day').selectOption('5');
  const bars = series.getByRole('radio');
  const chosenBar = series.getByRole('radio', { checked: true });
  await expect(bars).toHaveCount(18);
  await chosenBar.focus();
  await page.keyboard.press('ArrowRight');
  await expect(series.locator('#revenue-day')).toHaveValue('6');
  await expect(chosenBar).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(series.locator('#revenue-day')).toHaveValue('5');
  await series.getByRole('button', { name: 'Ver pedidos de 05/11' }).click();
  await verifyOrderList(page, 30_000, 1);
  await page.goBack();
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(detail).toHaveAttribute('aria-pressed', 'true');
  await expect(
    series.getByRole('table', { name: 'Valores exatos de vendas por dia' }),
  ).toBeVisible();
  await expect(series.locator('[data-revenue-day]')).toHaveCount(18);
  await expect(series.locator('#revenue-day')).not.toBeVisible();
  const dayTotals = await series
    .locator('tr[data-revenue-day]')
    .allInnerTexts();
  assert.equal(
    dayTotals.reduce((sum, line) => sum + cents(line), 0),
    110_000,
  );
  assert.equal(await revenue(page), 110_000);
  await chart.click();
  await expect(series.locator('#revenue-day')).toBeVisible();
  await expect(
    series.locator('tr[data-revenue-day]').first(),
  ).not.toBeVisible();
  await detail.click();
  await page.locator('[data-orders="d5"]').click();
  await verifyOrderList(page, 30_000, 1);
  await page.goBack();
  await page.locator('[data-seller="0"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#viewtitle')).toContainText('Lia');
  await expect(page.locator('#viewtitle')).toBeFocused();
  await page.locator('[data-orders="p0"]').click();
  await verifyOrderList(page, 80_000, 2);
  await page.goBack();
  await expect(page.locator('#viewtitle')).toContainText('Lia');
  await page.locator('[data-period="trinta"]').click();
  await page.locator('[data-orders="p0"]').click();
  await verifyOrderList(page, 80_000, 2);
  await page.goBack();
  await expect(page.locator('[data-period="trinta"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('transferência, reabertura, reconfirmação e cancelamento preservam o crédito e a contagem', async (t) => {
  const page = await openPrototype(t);
  await page.selectOption('#scenario', 'conciliacao');
  await page.locator('[data-order-op="transferir"]').click();
  assert.equal(await revenue(page), 110_000);
  await page.locator('[data-seller="0"]').first().click();
  await page.locator('[data-orders="p0"]').click();
  await verifyOrderList(page, 80_000, 2);
  await page.locator('.appnav [data-view="resultado"]').click();
  for (const [operation, amount] of [
    ['reabrir', 60_000],
    ['reconfirmar', 110_000],
    ['cancelar', 60_000],
    ['restaurar', 110_000],
  ]) {
    await page.locator(`[data-order-op="${operation}"]`).click();
    assert.equal(await revenue(page), amount, operation);
  }
});

test('comparação usa dias comuns no mês curto e trata a virada e a base zero', async (t) => {
  const page = await openPrototype(t);
  await page.selectOption('#scenario', 'conciliacao');
  const paired = page.getByRole('region', { name: 'Comparação de vendas' });
  assert.equal(
    cents(await paired.locator('[data-comparison-metric="sold"]').innerText()),
    60_000,
  );
  const openCurrent = paired.locator('[data-comparison-ledger="atual"]');
  await openCurrent.focus();
  await page.keyboard.press('Enter');
  const ledger = paired.locator('[data-comparison-list="atual"]');
  await expect(ledger.locator('li')).toHaveCount(3);
  const shown = await ledger.locator('li').allInnerTexts();
  assert.equal(
    shown.reduce((sum, line) => sum + cents(line), 0),
    60_000,
  );
  await ledger.locator('[data-comparison-close]').click();
  await expect(openCurrent).toBeFocused();
  await expect(openCurrent).toHaveAttribute('aria-expanded', 'false');
  await paired.locator('[data-comparison-ledger="anterior"]').click();
  await expect(
    paired.locator('[data-comparison-list="anterior"]'),
  ).toContainText(/nenhum pedido/iu);
  assert.equal(await revenue(page), 110_000);
  await page.selectOption('#scenario', 'curto');
  await page.locator('[data-period="mes"]').click();
  const comparison = page.locator('.sales-context');
  await expect(
    page.getByRole('region', { name: 'Comparação de vendas' }),
  ).toBeVisible();
  await expect(
    comparison.locator('[data-comparison-mode="grafico"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await comparison.locator('[data-comparison-mode="tabela"]').focus();
  await page.keyboard.press('Enter');
  await expect(
    comparison.locator('[data-comparison-mode="tabela"]'),
  ).toBeFocused();
  await expect(comparison.getByRole('table')).toBeVisible();
  await expect(comparison).toContainText(/01\/03.+28\/03/u);
  await expect(comparison).toContainText(/01\/02.+28\/02/u);
  await page.selectOption('#scenario', 'virada');
  await page.locator('[data-period="mes"]').click();
  await expect(page.locator('#stage')).toContainText('01/12');
  await expect(comparison).not.toContainText('%');
  await page.selectOption('#scenario', 'zero');
  await page.locator('[data-period="semana"]').click();
  assert.equal(await revenue(page), 0);
  await expect(page.locator('.hero')).toContainText('—');
  await expect(comparison).not.toContainText('%');
  await page.selectOption('#scenario', 'basezero');
  assert.ok((await revenue(page)) > 0);
  await comparison.locator('[data-comparison-mode="tabela"]').click();
  await expect(comparison.getByRole('table')).toBeVisible();
  const amounts = await comparison
    .locator('tbody tr')
    .first()
    .locator('td')
    .allInnerTexts();
  assert.ok(cents(amounts[0]) > 0);
  assert.equal(cents(amounts[1]), 0);
  await expect(comparison).not.toContainText('%');
});

test('ação humana confirma no toast, fechar devolve o foco e eventos de fundo e erros conservam suas regiões', async (t) => {
  const page = await openPrototype(t);
  const receipt = page.locator('#receipt');
  const message = receipt.locator('[role="status"]');
  const close = receipt.getByRole('button', { name: 'Fechar aviso' });
  await expect(receipt).not.toBeVisible();
  await page.selectOption('#scenario', 'conciliacao');
  await expect(receipt).not.toBeVisible();
  await page.clock.install();
  await page.locator('[data-order-op="transferir"]').click();
  await expect(message).toBeVisible();
  await expect(message).toHaveAttribute('aria-atomic', 'true');
  await expect(message).toContainText(/P-A02/u);
  await expect(message).toContainText(/Caio/u);
  await expect(message).toContainText(/Lia/u);
  await close.focus();
  await page.clock.runFor(8_500);
  await expect(receipt).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(receipt).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Conferência do pedido de R$ 500' }),
  ).toBeFocused();
  await page.locator('[data-order-op="reabrir"]').click();
  await expect(receipt).toBeVisible();
  await page.clock.runFor(8_500);
  await expect(receipt).not.toBeVisible();
  await page.selectOption('#scenario', 'normal');
  await page.locator('.appnav [data-view="central"]').click();
  await page.locator('[data-play]').click();
  await page.clock.runFor(3_100);
  await expect(page.locator('[data-record="EV-19"]')).toHaveCount(1);
  await expect(receipt).not.toBeVisible();
  await page.selectOption('#scenario', 'erro');
  await expect(
    page.getByRole('heading', { name: 'Vendas indisponíveis' }),
  ).toBeVisible();
  await page.clock.runFor(9_000);
  await expect(page.locator('[data-recover]')).toBeVisible();
  await expect(receipt).not.toBeVisible();
});

test('uma resposta lenta de sete dias nunca substitui Mês após a troca de recorte', async (t) => {
  const page = await openPrototype(t);
  await page.locator('[data-period="mes"]').click();
  const monthly = await revenue(page);
  await page.clock.install();
  await page.selectOption('#scenario', 'lenta');
  await page.locator('[data-period="semana"]').click();
  await expect(page.locator('.hero')).toHaveCount(0);
  await page.locator('[data-period="mes"]').click();
  await page.clock.runFor(300);
  assert.equal(await revenue(page), monthly);
  await page.clock.runFor(1000);
  await expect(page.locator('[data-period="mes"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  assert.equal(await revenue(page), monthly);
});

test('o resumo automático de ontem é independente do período e expõe a situação da apuração', async (t) => {
  const page = await openPrototype(t);
  const closing = page.getByRole('region', {
    name: 'Resumo automático de ontem',
  });
  const value = closing.locator('[data-checkpoint-summary="total"]');
  const initial = await revenue(page);
  await expect(closing).toHaveAttribute('data-checkpoint-state', 'registrado');
  await expect(value).toBeVisible();
  const yesterday = cents(await value.innerText());
  await page.locator('[data-period="hoje"]').click();
  assert.notEqual(initial, await revenue(page));
  assert.equal(cents(await value.innerText()), yesterday);
  await page.locator('.appnav [data-view="central"]').click();
  await page.locator('[data-advance]').click();
  await page.locator('[data-advance]').click();
  await page.locator('.appnav [data-view="resultado"]').click();
  assert.equal(cents(await value.innerText()), yesterday);
  for (const state of [
    'previa',
    'aguardando',
    'indisponivel',
    'desativado',
    'registrado',
  ]) {
    await page.selectOption('#closing-sample', state);
    await expect(closing).toHaveAttribute('data-checkpoint-state', state);
    await expect(
      closing.getByRole('button', { name: /registrar/i }),
    ).toHaveCount(0);
    if (state === 'previa' || state === 'registrado') {
      await expect(value).toBeVisible();
      assert.equal(cents(await value.innerText()), yesterday);
    } else {
      await expect(closing).not.toContainText(/R\$\s*0,00/u);
    }
  }
});

test('a urgência abre somente a fila correspondente e conserva o escopo ao voltar do registro', async (t) => {
  const page = await openPrototype(t, 390);
  const target = page.locator('#stage [data-queue-scope="sem-responsavel"]');
  await target.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#queue-panel');
  await expect(page.locator('#queue-title')).toBeFocused();
  await expect(page.locator('#queue-title')).toBeInViewport();
  await expect(page).toHaveURL(/fila=sem-responsavel/u);
  await expect(panel.locator('[data-record="AT-041"]')).toBeVisible();
  await expect(panel.locator('[data-record="AT-042"]')).toBeVisible();
  await expect(panel.locator('[data-record="AT-046"]')).toHaveCount(0);
  await expect(
    panel.locator('[data-queue-scope="sem-responsavel"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('[data-record="AT-041"]').click();
  await expect(page.locator('#stage')).toContainText('AT-041');
  await page.goBack();
  await expect(
    panel.locator('[data-queue-scope="sem-responsavel"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('[data-record="AT-046"]')).toHaveCount(0);
  await panel.locator('[data-queue-scope="todas"]').click();
  await expect(panel.locator('[data-record="AT-046"]')).toBeVisible();
  await panel.locator('[data-queue-scope="sem-responsavel"]').click();
  for (const id of ['AT-041', 'AT-042']) {
    await panel.locator(`[data-record="${id}"]`).click();
    await page.locator('[data-central-action="assumir"]').click();
    await page.locator('#stage [data-queue-scope="sem-responsavel"]').click();
  }
  await expect(panel.locator('[data-record]')).toHaveCount(0);
  await expect(panel).toContainText(/nenhum|ninguém|vazi/iu);
  await page.locator('#stage [data-view="central"]').click();
  await expect(page).not.toHaveURL(/fila=sem-responsavel/u);
  await expect(page.locator('[data-record="AT-046"]')).toBeVisible();
});

test('leitura inicial indisponível e falha parcial com recuperação', async (t) => {
  const page = await openPrototype(t);
  await page.selectOption('#scenario', 'erro');
  await expect(page.locator('#stage')).toContainText(/indisponív/u);
  await expect(page.locator('.hero')).toHaveCount(0);
  await page.locator('[data-recover]').click();
  assert.ok((await revenue(page)) > 0);
  await page.selectOption('#scenario', 'parcial');
  const retained = await revenue(page);
  await expect(page.locator('#stage')).toContainText(
    /última leitura|desatualizad/iu,
  );
  await page.locator('.appnav [data-view="central"]').click();
  await page.locator('[data-advance]').click();
  await page.locator('[data-advance]').click();
  await page.locator('.appnav [data-view="resultado"]').click();
  assert.equal(await revenue(page), retained);
  await page.locator('[data-period="hoje"]').click();
  await expect(page.locator('.hero')).toHaveCount(0);
  await page.locator('[data-period="mes"]').click();
  await page.locator('[data-partial="retry"]').first().click();
  await expect(page.locator('[data-partial="retry"]')).toHaveCount(0);
  assert.equal(await revenue(page), retained + 64_000);
});

test('as filas de pedidos e entregas levam ao registro, e a primeira impressão baixa o aviso da loja', async (t) => {
  const page = await openPrototype(t);
  const central = page.locator('.appnav [data-view="central"]');
  await central.click();
  const operations = page.getByRole('region', { name: 'Pedidos e entregas' });
  const queue = (group) => operations.locator(`[data-record="${group}"]`);
  for (const group of ['PENDENTES', 'ATRASADAS', 'PROXIMAS', 'FICHAS']) {
    await expect(queue(group).locator('[data-queue-count]')).toBeVisible();
  }
  await queue('PROXIMAS').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-record="ENTREGA-PROXIMA"]').click();
  await expect(page.locator('#stage')).toContainText(/entrega/iu);
  await central.click();
  await queue('ATRASADAS').click();
  await page.locator('[data-record="P-1198"]').click();
  await page.locator('[data-central-action="entregar"]').click();
  await central.click();
  await expect(queue('ATRASADAS').locator('[data-queue-count]')).toHaveText(
    '0',
  );
  await queue('FICHAS').click();
  await page.locator('[data-record="LOJA"]').click();
  await page.locator('[data-central-action="imprimir"]').click();
  await central.click();
  await expect(page.locator('[data-record="LOJA"]')).toHaveCount(0);
  await expect(page.locator('[data-central-action="imprimir"]')).toHaveCount(0);
  await expect(page.locator('#stage')).not.toContainText(
    /1 pedido.*aguarda.*impressão/iu,
  );
  await expect(queue('FICHAS').locator('[data-queue-count]')).toHaveText('0');
  await queue('FICHAS').click();
  await expect(page.locator('[data-record="LOJA"]')).toHaveCount(0);
  await central.click();
  await queue('PENDENTES').click();
  await page.locator('[data-record="P-1501"]').click();
  await page.locator('[data-central-action="confirmar"]').click();
  await central.click();
  await expect(page.locator('#stage')).toContainText(/Pedido confirmado/iu);
  await expect(queue('PENDENTES').locator('[data-queue-count]')).toHaveText(
    '0',
  );
  await queue('PENDENTES').click();
  await expect(page.locator('[data-record="P-1501"]')).toHaveCount(0);
});

test('a fila envelhece sem mensagem e a reconexão recupera o evento uma vez', async (t) => {
  const page = await openPrototype(t);
  const initialRevenue = await revenue(page);
  const central = page.locator('.appnav [data-view="central"]');
  await central.click();
  const waiting = page.locator('[data-record="AT-046"]');
  await expect(waiting).toContainText('14 min');
  await page.locator('[data-central-action="minuto"]').click();
  await expect(waiting).toContainText('15 min');
  await page.locator('[data-central-action="minuto"]').click();
  await expect(waiting).toContainText('16 min');
  await page.locator('[data-advance]').click();
  await page.locator('#sim [data-connection]').click();
  await page.locator('[data-advance]').click();
  await expect(page.locator('[data-record="EV-20"]')).toHaveCount(0);
  await page.locator('.appnav [data-view="resultado"]').click();
  assert.equal(await revenue(page), initialRevenue);
  await central.click();
  await page.locator('#sim [data-connection]').click();
  await expect(page.locator('[data-record="EV-20"]')).toHaveCount(1);
  await page.locator('[data-replay]').click();
  await expect(page.locator('[data-record="EV-20"]')).toHaveCount(1);
  await page.locator('[data-central-action="lacuna"]').click();
  await page.locator('#stage [data-central-action="reler"]').click();
  await expect(page.locator('[data-record="EV-20"]')).toHaveCount(1);
  await page.locator('.appnav [data-view="resultado"]').click();
  assert.equal(await revenue(page), initialRevenue + 64_000);
});

test('escopo da conversa pessoal e do dashboard acompanha o perfil até no acesso direto', async (t) => {
  const page = await openPrototype(t);
  await page.selectOption('#role', 'designado');
  const central = page.locator('.appnav [data-view="central"]');
  await central.click();
  await page.locator('[data-record="AT-047"]').click();
  const privateUrl = page.url();
  await expect(page.locator('#stage')).toContainText('AT-047');
  await page.selectOption('#role', 'admin');
  await central.click();
  await expect(page.locator('[data-record="AT-047"]')).toHaveCount(0);
  await page.goto(privateUrl);
  await expect(page.locator('#stage')).not.toContainText('AT-047');
  await page.selectOption('#role', 'vendedor');
  await page.goto(
    new URL('#page=painel&view=seller&period=mes&id=6', prototypeUrl).href,
  );
  await expect(page.locator('#stage')).not.toContainText('Nara');
  await page.selectOption('#role', 'financeiro');
  await page.goto(
    new URL('#page=painel&view=resultado&period=mes', prototypeUrl).href,
  );
  await expect(page.locator('.hero')).toHaveCount(0);
  await expect(page.locator('[data-seller]')).toHaveCount(0);
});

test('parecer é exportável pelo teclado e conserva a revisão comercial informada', async (t) => {
  const page = await openPrototype(t);
  const plan = page.locator('[data-page="plano"]');
  await plan.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#doctitle')).toBeFocused();
  const decision = page.getByLabel(/conversão/iu);
  await decision.selectOption('Pedir ajuste');
  await page
    .locator('#comment')
    .fill('Conferir o tratamento da transferência.');
  await page.locator('[data-page="antes"]').click();
  await plan.click();
  await expect(decision).toHaveValue('Pedir ajuste');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download]').focus();
  await page.keyboard.press('Enter');
  const download = await downloadEvent;
  const chunks = [];
  for await (const bytes of await download.createReadStream())
    chunks.push(bytes);
  const record = Buffer.concat(chunks).toString('utf8');
  assert.match(record, /Pedir ajuste[^\n]*conversão/iu);
  assert.match(record, /Conferir o tratamento da transferência/u);
});

test('cada vendedor mostra os quatro indicadores e permite conferir os ciclos convertidos', async (t) => {
  const page = await openPrototype(t);
  await page.locator('[data-period="mes"]').click();
  const team = page.locator('[data-team-panel]');
  const graph = team.locator('[data-team-mode="grafico"]'),
    numbers = team.locator('[data-team-mode="tabela"]');
  await expect(graph).toHaveAttribute('aria-pressed', 'true');
  await expect(team.locator('#team-chart-metric')).toHaveValue('sold');
  const plotted = {};
  for (const key of ['conversion', 'timely', 'orders', 'sold']) {
    await team.locator('#team-chart-metric').selectOption(key);
    const row = team.locator('[data-team-row="0"]');
    await expect(row).toBeVisible();
    plotted[key] = await row.innerText();
  }
  await expect(team.locator('[data-team-reconciliation]')).toBeVisible();
  await numbers.focus();
  await page.keyboard.press('Enter');
  await expect(numbers).toHaveAttribute('aria-pressed', 'true');
  await expect(numbers).toBeFocused();
  const table = page.locator('table.seller-table');
  const lia = table.locator('tbody tr[data-person="0"]');
  const required = ['conversion', 'timely', 'orders', 'sold'];
  const cardValues = {};
  for (const metric of required) {
    const cell = lia.locator(`[data-metric="${metric}"]`);
    await expect(cell).toBeVisible();
    cardValues[metric] = (await cell.locator('strong').innerText()).trim();
    assert.ok(
      plotted[metric]
        .replaceAll('\u00a0', ' ')
        .includes(cardValues[metric].replaceAll('\u00a0', ' ')),
      metric,
    );
  }
  await expect(lia.locator('[data-metric="conversion"]')).toContainText('%');
  await expect(lia.locator('[data-metric="timely"]')).toContainText('%');
  await expect(table).toContainText(/Nara.*inativa/iu);
  const ivo = table.locator('tbody tr[data-person="3"]');
  assert.equal(cents(await ivo.locator('[data-metric="sold"]').innerText()), 0);
  await lia.locator('[data-seller]').click();
  const detail = page.locator('.seller-summary');
  for (const metric of required) {
    const cell = detail.locator(`[data-metric="${metric}"]`);
    await expect(cell).toBeVisible();
    await expect(cell.locator('strong')).toHaveText(cardValues[metric]);
  }
  assert.equal(
    cents(await detail.locator('[data-metric="sold"]').innerText()),
    cents(cardValues.sold),
  );
  const ledger = page.locator('details[data-cohort-ledger]');
  await ledger.locator('summary').click();
  const cycles = ledger.locator('[data-cycle]');
  const ids = await cycles.evaluateAll((rows) =>
    rows.map((r) => r.dataset.cycle),
  );
  assert.equal(ids.length, new Set(ids).size);
  const converted = ledger.locator('[data-converted="sim"]');
  assert.ok((await converted.count()) > 0);
  assert.ok((await ledger.locator('[data-converted="nao"]').count()) > 0);
  await expect(ledger.locator('[data-cycle="C-0-988-1"]')).toHaveAttribute(
    'data-converted',
    'sim',
  );
  await expect(ledger.locator('[data-cycle="C-0-988-1"]')).toContainText(
    'PV-C-0-988-1-A',
  );
  await expect(ledger.locator('[data-cycle="C-0-988-1"]')).toContainText(
    'PV-C-0-988-1-B',
  );
  await expect(ledger.locator('[data-cycle="C-0-977-2"]')).toHaveAttribute(
    'data-converted',
    'nao',
  );
  const value = await detail.locator('[data-metric="conversion"]').innerText();
  const shown = Number(value.match(/([\d,]+)\s*%/u)[1].replace(',', '.'));
  const calculated = (100 * (await converted.count())) / ids.length;
  assert.ok(
    Math.abs(shown - calculated) < 0.051,
    `${shown}% versus ${calculated}% nos ciclos`,
  );
});

for (const width of [320, 390, 1366]) {
  test(`resultado, quatro métricas e detalhe utilizáveis a ${width}px`, async (t) => {
    const page = await openPrototype(t, width);
    await page.locator('[data-period="mes"]').click();
    await expect(page.locator('[data-team-row="0"]')).toBeVisible();
    await expectReflow(page);
    await page.locator('[data-team-mode="tabela"]').click();
    await expectReflow(page);
    const seller = page.locator('tr[data-person="0"]');
    for (const key of ['conversion', 'timely', 'orders', 'sold']) {
      await expect(seller.locator(`[data-metric="${key}"]`)).toBeVisible();
    }
    const total = cents(
      await page
        .locator('table.seller-table tfoot [data-metric="sold"]')
        .innerText(),
    );
    assert.equal(total, await revenue(page));
    await seller.locator('[data-seller]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#viewtitle')).toBeFocused();
    await expectReflow(page);
  });
}
