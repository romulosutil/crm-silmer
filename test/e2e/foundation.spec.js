import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('renders the semantic foundation without critical accessibility violations', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('CRM Silmer');
  await expect(page.getByRole('main')).toContainText(
    'O comercial inteiro,em movimento.',
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

test('uses the light theme by default, even when the system is dark', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis
          .getComputedStyle(globalThis.document.documentElement)
          .getPropertyValue('--color-canvas')
          .trim(),
      ),
    )
    .toBe('#f7f6fb');
});

test('applies a saved dark theme before the application bundle loads', async ({
  page,
}) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('silmer-theme', 'dark');
  });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
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

  await page.keyboard.press('Home');
  await expect(loginTab).toBeFocused();
  await expect(loginTab).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('End');
  await expect(inviteTab).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(loginTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(inviteTab).toBeFocused();
});

test('distinguishes session service failure from a signed-out session', async ({
  page,
}) => {
  let available = false;
  await page.route('**/api/v1/sessions/current', async (route) => {
    await route.fulfill({
      contentType: 'application/problem+json',
      status: available ? 401 : 503,
      body: JSON.stringify({
        code: available ? 'UNAUTHORIZED' : 'UNAVAILABLE',
      }),
    });
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Não foi possível verificar sua sessão',
    }),
  ).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);

  available = true;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
});

test('returns a real 404 for a missing compiled asset', async ({ request }) => {
  const response = await request.get('/assets/inexistente.js');
  expect(response.status()).toBe(404);
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

    if (path === '/api/v1/kanban' && method === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ eventCursor: 'evt-1', columns: [] }),
      });
      return;
    }

    if (path === '/api/v1/events' && method === 'GET') {
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
    page.getByRole('heading', { name: 'Kanban comercial' }),
  ).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(
    'Sessão iniciada com segurança.',
  );

  await page.getByRole('button', { name: 'Claro' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Escuro' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Escuro' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Sessão restaurada.');
  await expect(
    page.getByRole('heading', { name: 'Kanban comercial' }),
  ).toBeFocused();

  await page.getByRole('button', { name: 'Sair' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Sessão encerrada.');
  await expect(
    page.getByRole('heading', { name: 'Boas-vindas de volta' }),
  ).toBeFocused();
  await page.evaluate(() => globalThis.localStorage.removeItem('silmer-theme'));
  await expect(
    page.evaluate(() => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
    })),
  ).resolves.toEqual({ local: 0, session: 0 });
});
