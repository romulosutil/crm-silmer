import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('renders the semantic foundation without critical accessibility violations', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Acesso | CRM Silmer');
  await expect(page.getByRole('main')).toContainText(
    'Entre com sua conta Silmer',
  );
  await expect(page.getByRole('tabpanel', { name: 'Entrar' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps the status announcement and document language available', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.getByRole('status')).toHaveText('Entre para continuar.');
});

test('switches access panels with the keyboard and keeps focus predictable', async ({
  page,
}) => {
  await page.goto('/');
  const loginTab = page.getByRole('tab', { name: 'Entrar' });
  const inviteTab = page.getByRole('tab', { name: 'Aceitar convite' });

  await loginTab.focus();
  await page.keyboard.press('ArrowRight');

  await expect(inviteTab).toBeFocused();
  await expect(inviteTab).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('tabpanel', { name: 'Aceitar convite' }),
  ).toBeVisible();
});
