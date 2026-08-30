import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('renders the semantic foundation without critical accessibility violations', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('CRM Silmer');
  await expect(page.getByRole('main')).toContainText('Fundação do CRM pronta.');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps the status announcement and document language available', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.getByRole('status')).toHaveText('Fundação do CRM pronta.');
});
