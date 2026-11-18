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

test('versão nova sem mudança de estado mantém o desafio até expirar', async ({
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
  let ttl = 30000;
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, operation, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', (route) => {
    line.version += 1;
    return route.fulfill({
      json: {
        operationId: operation.id,
        generation: line.generation,
        challengeId: `challenge-${line.version}`,
        mode: 'code',
        value: 'TEST-CODE',
        version: line.version,
        expiresAt: new Date(Date.now() + ttl).toISOString(),
      },
    });
  });
  const refresh = async () => {
    const read = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/me/whatsapp' &&
        response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await read;
  };
  const show = async () => {
    await page.getByRole('button', { name: 'Mostrar código' }).click();
    await expect(page.getByText('TEST-CODE')).toBeVisible();
  };
  await page.goto('/conta');

  // A read that only bumps the version keeps the challenge within its TTL.
  ttl = 4000;
  await show();
  line.version += 1;
  await refresh();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  line.version += 1;
  await refresh();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  // Expiry still removes it.
  await expect(page.getByText('TEST-CODE')).toHaveCount(0, { timeout: 6000 });

  // A new generation removes it even while still awaiting pairing.
  ttl = 30000;
  await show();
  line.generation = 2;
  line.version += 1;
  await refresh();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);

  // A replaced operation removes it.
  await show();
  operation.id = 'operation-replaced';
  line.version += 1;
  await refresh();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);

  // Leaving awaiting_pairing removes it.
  await show();
  line.state = 'unknown';
  line.version += 1;
  await refresh();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toHaveCount(0);
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

test('administrador confirma e motiva troca de telefone compartilhado', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false, admin: true });
  const contact = {
    id: 'contact-shared',
    label: 'Contato sintético',
    displayName: 'Contato sintético',
    version: 4,
    identities: [],
    shared: true,
    phone: '5511999990000',
    phoneSource: 'manual',
    email: null,
    registration: null,
  };
  /** @type {any[]} */
  const commands = [];
  await page.route('**/api/v1/contacts?**', (route) =>
    route.fulfill({
      json: { items: [contact], totalCount: 1, nextCursor: null },
    }),
  );
  await page.route('**/api/v1/contacts/contact-shared', (route) =>
    route.fulfill({ json: { contact, identities: [], conversations: [] } }),
  );
  await page.route('**/api/v1/contacts/contact-shared/details', (route) => {
    const body = route.request().postDataJSON();
    commands.push(body);
    return route.fulfill({
      json: { contact: { ...contact, phone: body.phone, version: 5 } },
    });
  });
  await page.goto('/clientes/contact-shared');
  await page.getByRole('button', { name: 'Completar cadastro' }).click();
  await page.getByLabel('Celular', { exact: true }).fill('5511988880000');
  await page.getByLabel('Conferi a alteração').check();
  await page.getByLabel('Motivo da alteração').fill('Conferido com o cliente');
  await page.getByRole('button', { name: 'Salvar cadastro' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    expectedVersion: 4,
    phone: '5511988880000',
    review: { confirmed: true, reason: 'Conferido com o cliente' },
  });
});

test('duas abas não restauram desafio após mudança de geração', async ({
  page,
  context,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  const other = await context.newPage();
  await installMocks(other, {}, { fixedClock: false });
  const line = {
    id: 'line-synthetic',
    state: 'awaiting_pairing',
    version: 2,
    generation: 1,
    maskedNumber: '••••0000',
  };
  const operation = { id: 'operation-synthetic' };
  for (const tab of [page, other]) {
    await tab.route('**/api/v1/me/whatsapp', (route) =>
      route.fulfill({ json: { line, operation, available: true } }),
    );
    await tab.route('**/api/v1/me/whatsapp/pairing-challenge', (route) =>
      route.fulfill({
        json: {
          operationId: operation.id,
          generation: 1,
          challengeId: 'challenge-synthetic',
          mode: 'code',
          value: 'TEST-CODE',
          version: 2,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        },
      }),
    );
  }
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  await other.goto('/conta');
  line.state = 'disconnected';
  line.generation = 2;
  line.version = 3;
  await other.getByRole('button', { name: 'Atualizar estado' }).click();
  await expect(other.getByText('Desconectado', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar estado' }).click();
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toHaveCount(0);
  await other.close();
});

test('reconexão exige comando explícito e falha de desafio não repete efeito', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  const line = {
    id: 'line-synthetic',
    state: 'disconnected',
    version: 5,
    generation: 2,
    maskedNumber: '••••0000',
  };
  const operation = { id: 'operation-next' };
  /** @type {any[]} */
  const commands = [];
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, operation, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/connect', (route) => {
    commands.push({
      path: 'connect',
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    line.state = 'awaiting_pairing';
    line.version = 6;
    line.generation = 3;
    return route.fulfill({ status: 202, json: {} });
  });
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', (route) => {
    commands.push({ path: 'challenge', body: route.request().postDataJSON() });
    return route.fulfill({
      status: 409,
      json: { code: 'WHATSAPP_OPERATION_UNCERTAIN' },
    });
  });
  await page.goto('/conta');
  await page.getByLabel('Número com código do país').fill('5511999990000');
  await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0].body).toEqual({
    expectedNumber: '5511999990000',
    expectedVersion: 5,
  });
  expect(commands[0].key).toMatch(/^[a-f0-9-]{36}$/u);
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível confirmar o desafio',
  );
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeDisabled();
  expect(commands).toHaveLength(2);
  expect(commands[1].body).toMatchObject({
    operationId: operation.id,
    expectedVersion: 6,
    generation: 3,
    mode: 'code',
  });
});

test('QR sintético só aparece sob comando e é removido ao fechar', async ({
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
  let count = 0;
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, operation, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', (route) => {
    count++;
    return route.fulfill({
      json: {
        operationId: operation.id,
        generation: 1,
        challengeId: 'challenge-synthetic',
        mode: 'qr',
        value:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        expiresAt: new Date(Date.now() + 30000).toISOString(),
      },
    });
  });
  await page.goto('/conta');
  await expect(page.getByRole('button', { name: 'Mostrar QR' })).toBeVisible();
  expect(count).toBe(0);
  await page.getByRole('button', { name: 'Mostrar QR' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('img', { name: 'QR para conectar seu WhatsApp' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fechar desafio' }).click();
  await expect(
    page.getByRole('img', { name: 'QR para conectar seu WhatsApp' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mostrar QR' })).toBeFocused();
  expect(
    await page.evaluate(() =>
      Object.keys(globalThis.localStorage).some((key) =>
        globalThis.localStorage.getItem(key)?.includes('iVBORw0KGgo'),
      ),
    ),
  ).toBe(false);
  expect(count).toBe(1);
});

test('revogação remove código que já estava visível', async ({ page }) => {
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
        expiresAt: new Date(Date.now() + 30000).toISOString(),
      },
    }),
  );
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  await page.evaluate(() =>
    /** @type {any} */ (globalThis).__wapEventSource.dispatchEvent(
      new globalThis.MessageEvent('identity.user.changed', {
        data: JSON.stringify({ userId: 'seller-bia' }),
      }),
    ),
  );
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);
});
