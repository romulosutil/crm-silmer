import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createBillingChatPreview } from './billing-chat-preview.mjs';

test('BCP-P01: one operation list, contextual details and simulated actions inside the order', async () => {
  const preview = await createBillingChatPreview({
    port: 0,
    simplifiedBilling: true,
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      new URL(request.url()).pathname.startsWith('/api/')
    )
      writes.push(request.url());
  });
  try {
    await page.goto(
      `${new URL(preview.url).origin}/pedidos/billing-preview-order#cobrancas`,
      { waitUntil: 'networkidle' },
    );
    const section = page.getByRole('region', {
      name: 'Cobranças',
      exact: true,
    });
    const scenario = section.getByLabel('Cenário', { exact: true });
    const rows = section.locator('.simple-list > li');
    const modal = page.getByRole('dialog');
    await expect(rows).toHaveCount(2);
    await expect(section).toContainText('Quitado');
    await expect(
      section.getByText('Histórico de cobranças', { exact: true }),
    ).toHaveCount(0);
    await expect(
      section.getByText('Pagamentos registrados', { exact: true }),
    ).toHaveCount(0);
    await expect(section.getByRole('button', { name: /Cobrar/ })).toHaveCount(
      0,
    );
    await expect(
      section.getByRole('button', {
        name: 'Registrar recebimento',
        exact: true,
      }),
    ).toHaveCount(0);
    await section.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    const reverse = section.getByRole('button', {
      name: 'Estornar registro',
      exact: true,
    });
    await reverse.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await expect(reverse).toBeFocused();
    await scenario.selectOption('partial');
    await expect(rows).toHaveCount(1);
    await section.getByRole('button', { name: /Cobrar saldo de/ }).click();
    await modal
      .getByRole('button', { name: 'Gerar e enviar cobrança', exact: true })
      .click();
    await expect(rows).toHaveCount(2);
    await expect(section).toContainText('Aguardando pagamento');
    await expect(
      section.locator('summary[data-entry-id="balance"]'),
    ).toBeFocused();
    await scenario.selectOption('partial');
    await section
      .getByRole('button', { name: 'Registrar recebimento', exact: true })
      .click();
    await modal
      .getByRole('button', { name: 'Confirmar recebimento', exact: true })
      .click();
    await expect(section).toContainText('Quitado');
    await expect(rows).toHaveCount(2);
    const manualSummary = section
      .locator('summary')
      .filter({ hasText: 'Recebimento manual' });
    await expect(manualSummary).toBeFocused();
    await manualSummary.click();
    await section
      .getByRole('button', { name: 'Estornar registro', exact: true })
      .click();
    await modal
      .getByLabel('Motivo', { exact: true })
      .fill('Lançamento duplicado na simulação');
    await modal
      .getByRole('button', { name: 'Confirmar estorno', exact: true })
      .click();
    await expect(manualSummary).toBeFocused();
    await expect(manualSummary).toContainText('Registro estornado');
    await scenario.selectOption('waiting');
    await expect(
      section.getByRole('button', { name: 'Copiar link', exact: true }),
    ).toBeVisible();
    await scenario.selectOption('review');
    await expect(section.getByRole('alert')).toContainText('supera o saldo');
    await expect(
      section.getByRole('button', { name: 'Copiar link', exact: true }),
    ).toHaveCount(0);
    await expect(
      section.getByRole('button', { name: /Cobrar saldo/ }),
    ).toHaveCount(0);
    await scenario.selectOption('empty');
    await expect(rows).toHaveCount(0);
    await expect(section).toContainText(
      'Nenhuma cobrança ou recebimento registrado',
    );
    await scenario.selectOption('paid');
    const checkA11y = async () => {
      const result = await new AxeBuilder({ page })
        .include('.simplified-billing')
        .analyze();
      assert.deepEqual(
        result.violations.map((item) => item.id),
        [],
      );
    };
    await checkA11y();
    await page.setViewportSize({ width: 320, height: 840 });
    const toggle = section.getByRole('button', { name: /^Cobranças/ });
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
    await expect(section.locator('.simple-totals')).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await checkA11y();
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
    await preview.close();
  }
});
