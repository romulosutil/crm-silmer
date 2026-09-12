import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ADMIN = {
  capabilities: ['COMMERCIAL_ADMIN'],
  canDelete: false,
  createdAt: '2026-03-12T12:00:00.000Z',
  disabledAt: null,
  email: 'romulo@silmer.com.br',
  functionName: 'Vendedor',
  id: 'admin-1',
  name: 'Rômulo Sutil',
};
const SELLER = {
  capabilities: [],
  canDelete: true,
  createdAt: '2026-06-02T12:00:00.000Z',
  disabledAt: null,
  email: 'marina.duarte@silmer.com.br',
  functionName: 'Vendedor',
  id: 'seller-1',
  name: 'Marina Duarte',
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{capabilities?: string[]}} [options]
 */
async function mockUsers(page, options = {}) {
  const viewer = {
    ...ADMIN,
    capabilities: [...(options.capabilities ?? ADMIN.capabilities)],
  };
  /** @type {Array<Record<string, any>>} */
  const users = [
    { ...ADMIN, capabilities: [...ADMIN.capabilities] },
    { ...SELLER, capabilities: [...SELLER.capabilities] },
  ];
  /** @type {Array<{method: string, path: string, body: any}>} */
  const commands = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (/** @type {unknown} */ body, status = 200) =>
      route.fulfill({
        body: JSON.stringify(body),
        contentType: 'application/json',
        status,
      });

    if (path === '/api/v1/sessions/current' && method === 'GET') {
      return json({ user: viewer });
    }
    if (path === '/api/v1/events') return route.fulfill({ status: 204 });
    if (path === '/api/v1/kanban') {
      return json({ columns: [], eventCursor: 'evt-1' });
    }
    if (path === '/api/v1/users' && method === 'GET') return json({ users });
    if (path === '/api/v1/users' && method === 'POST') {
      const body = request.postDataJSON();
      commands.push({ body, method, path });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      const created = {
        capabilities: [],
        canDelete: true,
        createdAt: '2026-09-09T12:00:00.000Z',
        disabledAt: null,
        email: body.email,
        functionName: 'Vendedor',
        id: 'seller-2',
        name: body.name,
      };
      users.push(created);
      return json({ user: created }, 201);
    }
    if (path.startsWith('/api/v1/users/') && method === 'PATCH') {
      const body = request.postDataJSON();
      commands.push({ body, method, path });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      const target = users.find((user) => path.endsWith(user.id));
      if (target && body.name) target.name = body.name;
      return json({ user: target });
    }
    if (path.startsWith('/api/v1/users/') && method === 'DELETE') {
      const body = request.postDataJSON();
      commands.push({ body, method, path });
      const index = users.findIndex((user) => path.endsWith(user.id));
      if (index >= 0) users.splice(index, 1);
      return json({ deleted: true });
    }
    if (path.endsWith('/disable') && method === 'POST') {
      const body = request.postDataJSON();
      commands.push({ body, method, path });
      const target = users.find((user) => path.includes(user.id));
      if (target) target.disabledAt = '2026-09-09T13:00:00.000Z';
      return json({ user: target });
    }
    return route.fulfill({ body: '{}', status: 404 });
  });

  return { commands, users };
}

/** @param {import('@playwright/test').Page} page @param {string} name */
async function openActions(page, name) {
  await page.getByLabel(`Mais ações para ${name}`).click();
}

test('lists accounts and hands over the created credentials as markdown', async ({
  page,
}) => {
  const { commands } = await mockUsers(page);
  await page.goto('/usuarios');

  await expect(
    page.getByRole('heading', { exact: true, name: 'Vendedores' }),
  ).toBeFocused();
  await expect(
    page
      .getByLabel('Vendedores do CRM')
      .getByText('Administrador', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(
    page.getByText('2 contas · 2 ativas · 0 desativadas'),
  ).toBeVisible();

  await page.getByLabel('Nome').fill('Helena Nogueira');
  await page.getByLabel('E-mail').fill('helena.nogueira@silmer.com.br');
  await page.getByLabel('Senha', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Criar vendedor' }).click();

  const block = page.locator('.markdown-block');
  await expect(block).toContainText('- Nome: Helena Nogueira');
  await expect(block).toContainText('- E-mail: helena.nogueira@silmer.com.br');
  await expect(block).toContainText('- Senha: x');
  await expect(page.getByRole('button', { name: 'Copiar' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(4);

  // The password travels in the request but never comes back in a response.
  expect(commands).toHaveLength(1);
  expect(commands[0].body).toMatchObject({
    email: 'helena.nogueira@silmer.com.br',
    name: 'Helena Nogueira',
    password: 'x',
  });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('edits one field at a time and disables an account', async ({ page }) => {
  const { commands } = await mockUsers(page);
  await page.goto('/usuarios');

  await page
    .getByRole('row', { name: /Marina Duarte/u })
    .getByLabel('Mais ações para Marina Duarte')
    .click();
  await page.getByRole('button', { name: 'Editar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nome').fill('Marina Duarte Lima');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(dialog).toBeHidden();
  expect(commands).toHaveLength(1);
  // Only the changed field is sent; e-mail and password stay untouched.
  expect(commands[0].body.name).toBe('Marina Duarte Lima');
  expect(commands[0].body.email).toBeUndefined();
  expect(commands[0].body.password).toBeUndefined();

  await page
    .getByRole('row', { name: /Marina Duarte Lima/u })
    .getByLabel('Mais ações para Marina Duarte Lima')
    .click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await expect(
    page.getByText('2 contas · 1 ativas · 1 desativadas'),
  ).toBeVisible();
});

test('offers permanent deletion only for a seller without history', async ({
  page,
}) => {
  const { commands } = await mockUsers(page);
  await page.goto('/usuarios');

  await openActions(page, 'Rômulo Sutil');
  await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
  await openActions(page, 'Rômulo Sutil');

  const sellerRow = page.getByRole('row', { name: /Marina Duarte/u });
  const sellerRowBefore = await sellerRow.boundingBox();
  if (!sellerRowBefore) throw new Error('Linha de Marina não encontrada.');
  await openActions(page, 'Marina Duarte');
  await expect(page.locator('.row-menu-popover')).toBeVisible();
  const sellerRowAfter = await sellerRow.boundingBox();
  if (!sellerRowAfter) throw new Error('Linha de Marina não encontrada.');
  expect(sellerRowAfter.height).toBe(sellerRowBefore.height);
  await page.getByLabel('Mais ações para Marina Duarte').click();

  await openActions(page, 'Marina Duarte');
  await page.getByRole('button', { name: 'Excluir' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('Excluir Marina Duarte?');
  await confirmation.getByRole('button', { name: 'Cancelar' }).click();
  expect(commands).toHaveLength(0);

  await openActions(page, 'Marina Duarte');
  await page.getByRole('button', { name: 'Excluir' }).click();
  await confirmation.getByRole('button', { name: 'Excluir conta' }).click();

  await expect(page.getByRole('row')).toHaveCount(2);
  expect(commands.at(-1)).toMatchObject({
    body: { reason: expect.any(String) },
    method: 'DELETE',
    path: '/api/v1/users/seller-1',
  });
});

test('redirects a non-admin away from the users screen and hides its navigation entry', async ({
  page,
}) => {
  await mockUsers(page, { capabilities: [] });
  await page.goto('/usuarios');

  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('link', { name: 'Vendedores' })).toHaveCount(0);
  await expect(page.getByText('Vendedor')).toBeVisible();
  await expect(
    page.getByRole('heading', { exact: true, name: 'Dashboard' }),
  ).toBeVisible();
});
