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
    assert.equal(await section.locator('ol li').count(), 5);
    assert.ok((await section.innerText()).includes('R$ 840,00'));
    await example.selectOption('partial');
    assert.equal(await section.locator('ol li').count(), 3);
    assert.ok((await section.innerText()).includes('Ainda não quitado'));
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
    if (!(await example.isVisible()))
      await section.getByRole('button', { name: /Datas do pedido/ }).click();
    assert.ok(await example.isVisible());
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
