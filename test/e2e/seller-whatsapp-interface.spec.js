import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// Do not capture or trace pairing material, even synthetic material.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

for (const width of [390, 1366]) {
  test(`cadastro da carteira antes do pareamento em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await installMocks(page, {}, { fixedClock: false });
    /** @type {any[]} */
    const writes = [];
    await page.route('**/api/v1/me/clients**', async (route) => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        return route.fulfill({
          status: 201,
          json: { contact: { id: 'synthetic-client' }, link: {} },
        });
      }
      return route.fulfill({
        json: { items: [], totalCount: 0, nextCursor: null },
      });
    });
    await page.route('**/api/v1/contacts/synthetic-client', (route) =>
      route.fulfill({
        json: {
          contact: {
            id: 'synthetic-client',
            label: 'Cliente sintético',
            version: 1,
          },
          identities: [],
          conversations: [],
        },
      }),
    );
    await page.goto('/meus-clientes');
    await page.getByRole('button', { name: 'Novo cliente' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Nome', { exact: true })).toBeFocused();
    await page.getByLabel('Nome', { exact: true }).fill('Cliente sintético');
    await page.getByLabel('Telefone', { exact: true }).fill('5511999990000');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Salvar cliente' }).click();
    await expect(page).toHaveURL(/meus-clientes\/synthetic-client/u);
    expect(writes).toEqual([
      { displayName: 'Cliente sintético', phone: '5511999990000', email: null },
    ]);
  });

  test(`desafio efêmero e fechamento em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installMocks(page, {}, { fixedClock: false });
    const line = {
      id: 'line-synthetic',
      state: 'awaiting_pairing',
      version: 2,
      generation: 1,
      maskedNumber: '••••0000',
    };
    const operation = { id: 'operation-synthetic' };
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    await page.route('**/api/v1/me/whatsapp', (route) =>
      route.fulfill({ json: { line, operation, available: true } }),
    );
    await page.route(
      '**/api/v1/me/whatsapp/pairing-challenge',
      async (route) => {
        await gate;
        await route
          .fulfill({
            json: {
              operationId: operation.id,
              generation: 1,
              challengeId: 'challenge-synthetic',
              mode: 'code',
              value: 'TEST-CODE',
              expiresAt: new Date(Date.now() + 30000).toISOString(),
            },
          })
          .catch(() => {});
      },
    );
    await page.goto('/conta');
    await expect(
      page.getByText('Aguardando pareamento', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mostrar código' }).click();
    await expect(
      page.getByRole('button', { name: 'Cancelar desafio' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar desafio' }).click();
    release();
    await expect(page.getByText('TEST-CODE')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Mostrar código' }),
    ).toBeDisabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test('desafio expira e linha conectada não oferece novo QR', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  const line = {
    id: 'line-synthetic',
    state: 'awaiting_pairing',
    version: 2,
    generation: 1,
    maskedNumber: '••••0000',
  };
  const operation = { id: 'operation-synthetic' };
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, operation, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', (route) =>
    route.fulfill({
      json: {
        operationId: operation.id,
        generation: 1,
        challengeId: 'challenge-synthetic',
        mode: 'code',
        value: 'TEST-CODE',
        expiresAt: new Date(Date.now() + 1200).toISOString(),
      },
    }),
  );
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0, { timeout: 5000 });
  line.state = 'connected';
  await page.getByRole('button', { name: 'Atualizar estado' }).click();
  await expect(page.getByText('Conectado', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar QR' })).toHaveCount(0);
});

test('conflito de telefone preserva rascunho sem revelar candidato privado', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  await page.route('**/api/v1/me/clients**', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 409,
        json: { code: 'CONTACT_PHONE_MATCH' },
      });
    return route.fulfill({
      json: { items: [], totalCount: 0, nextCursor: null },
    });
  });
  await page.goto('/meus-clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Rascunho sintético');
  await page.getByLabel('Telefone', { exact: true }).fill('5511999990000');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Busque um cliente existente ao qual você tenha acesso',
  );
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue(
    'Rascunho sintético',
  );
  await expect(page.getByLabel('Telefone', { exact: true })).toHaveValue(
    '5511999990000',
  );
});

test('revogação da sessão remove desafio e impede resposta tardia', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  await page.addInitScript(() => {
    const add = globalThis.EventTarget.prototype.addEventListener;
    globalThis.EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      if (type === 'identity.user.changed')
        /** @type {any} */ (globalThis).__wapEventSource = this;
      return add.call(this, type, listener, options);
    };
  });
  const line = {
    id: 'line-synthetic',
    state: 'awaiting_pairing',
    version: 2,
    generation: 1,
    maskedNumber: '••••0000',
  };
  const operation = { id: 'operation-synthetic' };
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, operation, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', async (route) => {
    await gate;
    await route
      .fulfill({
        json: {
          operationId: operation.id,
          generation: 1,
          challengeId: 'challenge-synthetic',
          mode: 'code',
          value: 'TEST-CODE',
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        },
      })
      .catch(() => {});
  });
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancelar desafio' }),
  ).toBeVisible();
  await page.evaluate(() =>
    /** @type {any} */ (globalThis).__wapEventSource.dispatchEvent(
      new globalThis.MessageEvent('identity.user.changed', {
        data: JSON.stringify({ userId: 'seller-bia' }),
      }),
    ),
  );
  release();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeDisabled();
});

test('vincula contato acessível com a versão escolhida e mantém o mesmo ID', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  const contact = {
    id: 'contact-synthetic',
    label: 'Contato sintético',
    displayName: 'Contato sintético',
    version: 4,
    identities: [],
    shared: false,
  };
  /** @type {any[]} */
  const commands = [];
  await page.route('**/api/v1/contacts?**', (route) =>
    route.fulfill({
      json: { items: [contact], totalCount: 1, nextCursor: null },
    }),
  );
  await page.route('**/api/v1/contacts/contact-synthetic', (route) =>
    route.fulfill({ json: { contact, identities: [], conversations: [] } }),
  );
  await page.route('**/api/v1/me/clients/contact-synthetic/link', (route) => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({
      json: { contactId: contact.id, link: { version: 1 } },
    });
  });
  await page.route('**/api/v1/me/clients?**', (route) =>
    route.fulfill({
      json: { items: [contact], totalCount: 1, nextCursor: null },
    }),
  );
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Vincular à minha carteira' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/meus-clientes\/contact-synthetic/u);
  expect(commands).toEqual([{ expectedVersion: 4 }]);
});
