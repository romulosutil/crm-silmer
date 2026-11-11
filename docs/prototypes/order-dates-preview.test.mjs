import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createBillingChatPreview } from './billing-chat-preview.mjs';

test('DTL-P02: timeline is usable inside the current order screen without changing financial state', async () => {
  const preview = await createBillingChatPreview({
    port: 0,
    datesPreview: true,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const origin = new URL(preview.url).origin;
    const before = JSON.stringify(preview.fixtures.view());
    await page.goto(`${origin}/pedidos/billing-preview-order`, {
      waitUntil: 'domcontentloaded',
    });
    const section = page.getByRole('region', { name: 'Datas do pedido' });
    await section.waitFor();
    const example = section.getByLabel('Exemplo', { exact: true });
    await example.waitFor();
    assert.ok(
      await section
        .getByText('Prévia visual com dados fictícios.', { exact: false })
        .isVisible(),
    );
    assert.ok(
      await section
        .getByRole('heading', { name: 'Linha do tempo' })
        .isVisible(),
    );
    assert.equal(await section.locator('ol li').count(), 4);
    // DTL-P04: a single vertical timeline replaces the horizontal dates summary.
    assert.equal(await section.locator('dl').count(), 0);
    assert.ok((await section.innerText()).includes('R$ 840,00'));
    await example.selectOption('partial');
    assert.equal(await section.locator('ol li').count(), 3);
    assert.ok((await section.innerText()).includes('Ainda não quitado'));
    // DTL-P03: cancellation/Escape preserve the date; confirmation is independent of payment.
    const deliveryButton = section.getByRole('button', {
      name: 'Confirmar entrega',
      exact: true,
    });
    const dialog = page.getByRole('dialog', {
      name: 'Confirmar entrega',
      exact: true,
    });
    await deliveryButton.click();
    await dialog.waitFor();
    assert.equal(
      await dialog
        .getByRole('button', { name: 'Cancelar' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(
      await deliveryButton.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await section.getByText('Pedido entregue', { exact: true }).count(),
      0,
    );
    assert.equal(await section.locator('ol li').count(), 3);
    await deliveryButton.click();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await deliveryButton.evaluate((el) => el === document.activeElement),
      true,
    );
    await deliveryButton.click();
    await dialog.screenshot({ path: 'tmp/order-dates-delivery-dialog.png' });
    await dialog
      .getByRole('button', { name: 'Sim, confirmar entrega' })
      .click();
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
      }).format(new Date()),
    );
    assert.equal(
      await section
        .locator('li')
        .filter({ hasText: 'Pedido entregue' })
        .locator('time')
        .getAttribute('datetime'),
      today,
    );
    assert.equal(
      await section
        .getByRole('button', { name: 'Confirmar entrega', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await section.getByText('Pedido entregue', { exact: true }).count(),
      1,
    );
    assert.ok((await section.innerText()).includes('Ainda não quitado'));
    assert.ok(
      (await section.locator('.preview-totals').innerText()).includes(
        'R$ 840,00',
      ),
    );
    assert.equal(
      await section
        .getByText('Pedido entregue', { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await section.getByText('Ver detalhes da entrega', { exact: true }).click();
    assert.ok((await section.innerText()).includes('Confirmada por Marina'));
    await example.selectOption('full');
    await example.selectOption('partial');
    assert.equal(
      await section.getByText('Pedido entregue', { exact: true }).count(),
      1,
    );
    await section.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await section.locator('details').first().getAttribute('open'),
      '',
    );
    await example.selectOption('reverse');
    assert.ok(
      (await section.innerText()).includes('Revertido · não compõe o saldo'),
    );
    await example.selectOption('legacy');
    assert.ok(
      (await section.innerText()).includes('Sem detalhamento de recebimentos'),
    );
    await example.selectOption('error');
    assert.ok(
      (await section.getByRole('status').innerText()).includes(
        'Não foi possível carregar',
      ),
    );
    await example.selectOption('full');
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'tmp/order-dates-site-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // The real phone accordion is closed on navigation; open it through its native heading.
    await section
      .getByRole('button', { name: /Datas do pedido/ })
      .waitFor({ state: 'visible' });
    if (!(await example.isVisible()))
      await section.getByRole('button', { name: /Datas do pedido/ }).click();
    await example.waitFor({ state: 'visible' });
    assert.ok(await example.isVisible());
    await section
      .getByRole('button', { name: 'Confirmar entrega', exact: true })
      .click();
    await dialog.waitFor();
    assert.ok(
      await dialog.evaluate(
        (el) => el.getBoundingClientRect().width <= innerWidth,
      ),
    );
    await dialog.screenshot({ path: 'tmp/order-dates-delivery-mobile.png' });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(
      await section.getByText('Pedido entregue', { exact: true }).count(),
      0,
    );
    assert.ok(
      await section
        .getByRole('button', { name: 'Confirmar entrega', exact: true })
        .isVisible(),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await section.screenshot({ path: 'tmp/order-dates-site-mobile.png' });
    assert.equal(JSON.stringify(preview.fixtures.view()), before);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await preview.close();
  }
});
