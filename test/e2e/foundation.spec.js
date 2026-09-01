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

test('submits login, restores and closes a session by keyboard without browser storage', async ({
  page,
}) => {
  let authenticated = false;
  let loginAttempts = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/v1/sessions/current' && method === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        status: authenticated ? 200 : 401,
        body: authenticated
          ? JSON.stringify({
              mfaVerified: true,
              user: {
                capabilities: ['COMMERCIAL_ADMIN'],
                functionName: 'Atendimento',
                id: 'admin-1',
              },
            })
          : JSON.stringify({ error: { code: 'INVALID_CREDENTIALS' } }),
      });
      return;
    }

    if (path === '/api/v1/sessions' && method === 'POST') {
      loginAttempts += 1;
      if (loginAttempts === 1) {
        await route.fulfill({
          contentType: 'application/json',
          status: 401,
          body: JSON.stringify({
            error: { code: 'INVALID_CREDENTIALS' },
          }),
        });
        return;
      }
      authenticated = true;
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({
          mfaVerified: true,
          user: {
            capabilities: ['COMMERCIAL_ADMIN'],
            functionName: 'Atendimento',
            id: 'admin-1',
          },
        }),
      });
      return;
    }

    if (path === '/api/v1/sessions/current' && method === 'DELETE') {
      authenticated = false;
      await route.fulfill({ status: 204 });
      return;
    }

    await route.abort();
  });

  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Entre para continuar.');

  const loginPanel = page.getByRole('tabpanel', { name: 'Entrar' });
  await loginPanel.getByLabel('E-mail').fill('admin@example.test');
  await loginPanel.getByLabel('Senha').fill('wrong password value');
  await loginPanel.getByLabel('Senha').press('Enter');
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(
    'Não foi possível entrar com os dados informados.',
  );
  await expect(alert).toBeFocused();

  await loginPanel.getByLabel('Senha').fill('correct horse battery staple');
  await loginPanel.getByLabel('Senha').press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Acesso confirmado' }),
  ).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(
    'Sessão iniciada com segurança.',
  );

  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Sessão restaurada.');
  await expect(
    page.getByRole('heading', { name: 'Acesso confirmado' }),
  ).toBeFocused();

  await page.getByRole('button', { name: 'Sair' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Sessão encerrada.');
  await expect(
    page.getByRole('heading', { name: 'Boas-vindas de volta' }),
  ).toBeFocused();
  await expect(
    page.evaluate(() => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
    })),
  ).resolves.toEqual({ local: 0, session: 0 });
});
