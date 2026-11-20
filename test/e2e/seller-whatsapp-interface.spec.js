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
  await expect(
    page.getByText(
      'O código expirou. Selecione Mostrar código para gerar outro.',
    ),
  ).toBeVisible();

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
  // WAP-E12: the server already holds this line's number; no retyping.
  await expect(page.getByText('Reconectar o número ••••0000')).toBeVisible();
  await expect(page.getByLabel('Número com código do país')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Conectar WhatsApp', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reconectar WhatsApp' }).click();
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0].body).toEqual({ expectedVersion: 5 });
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

test('primeira conexão sem linha pede o número com código do país', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  const line = {
    id: null,
    state: 'not_configured',
    version: 0,
    generation: 0,
    maskedNumber: null,
  };
  /** @type {any[]} */
  const commands = [];
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: { line, challenge: null, available: true } }),
  );
  await page.route('**/api/v1/me/whatsapp/connect', (route) => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: {} });
  });
  await page.goto('/conta');
  const field = page.getByLabel('Número com código do país');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('required', '');
  await expect(
    page.getByRole('button', { name: 'Reconectar WhatsApp' }),
  ).toHaveCount(0);
  await axeEverywhere(page);
  await field.fill('5511999990000');
  await page.keyboard.press('Enter');
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({
    expectedNumber: '5511999990000',
    expectedVersion: 0,
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

// WAP-03/WAP-11 (QA P1-2, P2-2, P2-4): the GET reports only challenge
// metadata; the bytes come solely from the synchronous POST below.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

/** @param {import('@playwright/test').Page} page @param {any} [initial] */
async function pairing(page, initial = {}) {
  await installMocks(page, {}, { fixedClock: false });
  await page.addInitScript(() => {
    const add = globalThis.EventTarget.prototype.addEventListener;
    globalThis.EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      if (type === 'stream.reset')
        /** @type {any} */ (globalThis).__wapEventSource = this;
      return add.call(this, type, listener, options);
    };
  });
  const server = {
    line: {
      id: 'line-synthetic',
      state: 'awaiting_pairing',
      version: 2,
      generation: 1,
      maskedNumber: '••••0778',
    },
    operation: { id: 'operation-synthetic', state: 'succeeded' },
    challenge: /** @type {any} */ (null),
    available: true,
    ...initial,
  };
  /** @type {any[]} */
  const commands = [];
  /** @type {Promise<unknown>} */
  let gate = Promise.resolve();
  await page.route('**/api/v1/me/whatsapp', (route) =>
    route.fulfill({ json: server }),
  );
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', async (route) => {
    const body = route.request().postDataJSON();
    commands.push({ path: 'challenge', body });
    await gate;
    const id = `challenge-${commands.length}`;
    server.line = { ...server.line, version: server.line.version + 1 };
    const expiresAt = new Date(Date.now() + 30000).toISOString();
    server.challenge = { id, state: 'delivered', expiresAt };
    await route
      .fulfill({
        json: {
          challengeId: id,
          operationId: server.operation.id,
          generation: server.line.generation,
          mode: body.mode,
          value: body.mode === 'qr' ? PNG : 'TEST-CODE',
          version: server.line.version,
          expiresAt,
        },
      })
      .catch(() => {});
  });
  await page.route('**/api/v1/me/whatsapp/connect', async (route) => {
    commands.push({ path: 'connect', body: route.request().postDataJSON() });
    await gate;
    server.line = {
      ...server.line,
      state: 'preparing',
      version: server.line.version + 1,
      generation: server.line.generation + 1,
    };
    await route.fulfill({ status: 202, json: {} }).catch(() => {});
  });
  await page.route('**/api/v1/me/whatsapp/disconnect', (route) => {
    commands.push({ path: 'disconnect', body: route.request().postDataJSON() });
    server.line = {
      ...server.line,
      state: 'disconnected',
      version: server.line.version + 1,
      generation: server.line.generation + 1,
    };
    server.challenge = null;
    return route.fulfill({ status: 202, json: {} });
  });
  const reset = async () => {
    const read = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/me/whatsapp' &&
        response.request().method() === 'GET',
    );
    await page.evaluate(() =>
      /** @type {any} */ (globalThis).__wapEventSource.dispatchEvent(
        new globalThis.MessageEvent('stream.reset', { data: '{}' }),
      ),
    );
    await read;
  };
  /** @param {Promise<unknown>} next */
  const hold = (next) => {
    gate = next;
  };
  return { server, commands, reset, hold };
}

/** @param {import('@playwright/test').Page} page */
const focusedTag = (page) =>
  page.evaluate(() => globalThis.document.activeElement?.tagName);

/** @param {import('@playwright/test').Page} page */
async function axeEverywhere(page) {
  for (const width of [390, 1366])
    for (const theme of /** @type {const} */ (['light', 'dark'])) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((value) => {
        globalThis.document.documentElement.dataset.theme = value;
      }, theme);
      // Let the theme's color transitions settle before measuring contrast.
      await page.evaluate(() =>
        Promise.all(
          globalThis.document.getAnimations().map((item) => item.finished),
        ),
      );
      expect(
        (await new AxeBuilder({ page }).include('.my-whatsapp').analyze())
          .violations,
      ).toEqual([]);
    }
}

test('reinício do stream sozinho mantém o desafio e o pedido seguinte renova', async ({
  page,
}) => {
  const { server, commands, reset } = await pairing(page);
  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  // Another seller's activity reaches this reader only as stream.reset.
  await reset();
  await reset();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  // Not confirmed yet: no new challenge may be asked for.
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeDisabled();
  // The worker read confirms it; the next reset keeps the code and unlocks.
  server.challenge = { ...server.challenge, state: 'resolved' };
  await reset();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mostrar código' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1].body).toMatchObject({
    renewChallengeId: 'challenge-1',
    expectedVersion: 3,
  });
  await expect(page.getByText('TEST-CODE')).toBeVisible();
});

test('recarregar a página renova com o desafio informado pelo GET', async ({
  page,
}) => {
  const { server, commands } = await pairing(page, {
    challenge: {
      id: 'challenge-before-reload',
      state: 'delivered',
      expiresAt: new Date(Date.now() - 60000).toISOString(),
    },
  });
  await page.goto('/conta');
  // Still unconfirmed by a read: a clear wait instead of a dead end.
  await expect(
    page.getByText('Aguardando confirmação do desafio anterior'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar QR' })).toBeDisabled();
  await axeEverywhere(page);
  // The sweep reconciles it; the wait clears by itself, without reload.
  server.challenge = { ...server.challenge, state: 'resolved' };
  await expect(
    page.getByText('Aguardando confirmação do desafio anterior'),
  ).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Mostrar QR' })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Mostrar QR' }).click();
  await expect(
    page.getByRole('img', { name: 'QR para conectar seu WhatsApp' }),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0].body).toEqual({
    operationId: 'operation-synthetic',
    expectedVersion: 2,
    generation: 1,
    mode: 'qr',
    renewChallengeId: 'challenge-before-reload',
  });
});

test('desafio substituído em outra aba desaparece e devolve o foco', async ({
  page,
}) => {
  const { server, commands, reset } = await pairing(page);
  await page.goto('/conta');
  const beforeChallenge = { line: server.line, challenge: server.challenge };
  const showQr = page.getByRole('button', { name: 'Mostrar QR' });
  await showQr.click();
  const qr = page.getByRole('img', { name: 'QR para conectar seu WhatsApp' });
  const close = page.getByRole('button', { name: 'Fechar desafio' });
  await expect(qr).toBeVisible();
  await close.focus();

  const currentLine = server.line;
  const currentChallenge = server.challenge;
  Object.assign(server, beforeChallenge);
  await reset();
  await expect(qr).toBeVisible();

  server.line = { ...currentLine, version: currentLine.version + 1 };
  server.challenge = { ...currentChallenge, id: 'challenge-other-tab' };
  await reset();

  await expect(qr).toHaveCount(0, { timeout: 5000 });
  await expect(showQr).toBeFocused();
  await expect(showQr).toBeDisabled();
  expect(commands).toHaveLength(1);
});

test('relógio adiantado no celular respeita o prazo do código informado pelo servidor', async ({
  page,
}) => {
  await pairing(page);
  const serverNow = Date.now();
  await page.clock.setSystemTime(serverNow + 5 * 60_000);
  await page.route('**/api/v1/me/whatsapp/pairing-challenge', (route) =>
    route.fulfill({
      headers: { date: new Date(serverNow).toUTCString() },
      json: {
        challengeId: 'challenge-synthetic',
        operationId: 'operation-synthetic',
        generation: 1,
        mode: 'code',
        value: 'TEST-CODE',
        version: 3,
        expiresAt: new Date(serverNow + 30000).toISOString(),
      },
    }),
  );

  await page.goto('/conta');
  await page.getByRole('button', { name: 'Mostrar código' }).click();
  await expect(page.getByText('TEST-CODE')).toBeVisible({ timeout: 2000 });
});

test('teclado mantém o foco ao pedir e ao fechar o desafio', async ({
  page,
}) => {
  const { hold } = await pairing(page);
  /** @type {() => void} */
  let release = () => {};
  hold(
    new Promise((resolve) => {
      release = () => resolve(undefined);
    }),
  );
  await page.goto('/conta');
  const code = page.getByRole('button', { name: 'Mostrar código' });
  await code.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Cancelar desafio' }),
  ).toBeVisible();
  await expect(code).toBeFocused();
  expect(await focusedTag(page)).not.toBe('BODY');
  release();
  await expect(page.getByText('TEST-CODE')).toBeVisible();
  await expect(code).toBeFocused();
  await page.getByRole('button', { name: 'Fechar desafio' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('TEST-CODE')).toHaveCount(0);
  await expect(code).toBeFocused();
});

test('cancelar pelo teclado devolve o foco ao botão do desafio', async ({
  page,
}) => {
  const { hold } = await pairing(page);
  hold(new Promise(() => {}));
  await page.goto('/conta');
  const qr = page.getByRole('button', { name: 'Mostrar QR' });
  await qr.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Cancelar desafio' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Cancelar desafio' }),
  ).toHaveCount(0);
  await expect(qr).toBeFocused();
});

test('linha bloqueada explica o motivo e permite desconectar', async ({
  page,
}) => {
  const { commands, hold } = await pairing(page, {
    line: {
      id: 'line-synthetic',
      state: 'blocked',
      version: 7,
      generation: 2,
      maskedNumber: '••••0778',
    },
    operation: { id: 'operation-synthetic', state: 'reconciled' },
  });
  await page.goto('/conta');
  await expect(page.getByText('Bloqueado · ••••0778')).toBeVisible();
  await expect(
    page.getByText(
      'A conexão não pôde ser confirmada. Desconecte e tente de novo com o celular do número cadastrado.',
    ),
  ).toBeVisible();
  await axeEverywhere(page);
  await page.getByRole('button', { name: 'Desconectar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Desconectado', { exact: false })).toBeVisible();
  expect(commands).toEqual([
    {
      path: 'disconnect',
      body: { expectedVersion: 7, expectedGeneration: 2 },
    },
  ]);
  // WAP-E12: the disconnected line reconnects its stored number.
  await expect(page.getByLabel('Número com código do país')).toHaveCount(0);
  await expect(page.getByText('Reconectar o número ••••0778')).toBeVisible();
  const reconnect = page.getByRole('button', { name: 'Reconectar WhatsApp' });
  await expect(reconnect).toBeVisible();
  expect(await focusedTag(page)).not.toBe('BODY');
  await axeEverywhere(page);
  let release = () => {};
  hold(
    new Promise((resolve) => {
      release = () => resolve(undefined);
    }),
  );
  await reconnect.focus();
  await page.keyboard.press('Enter');
  await expect(reconnect).toHaveAttribute('aria-disabled', 'true');
  await expect(reconnect).toBeFocused();
  // A second Enter while busy sends nothing.
  await page.keyboard.press('Enter');
  release();
  await expect(page.getByText('Preparando · ••••0778')).toBeVisible();
  await expect(reconnect).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe('BODY');
  expect(commands.slice(1)).toEqual([
    { path: 'connect', body: { expectedVersion: 8 } },
  ]);
});
