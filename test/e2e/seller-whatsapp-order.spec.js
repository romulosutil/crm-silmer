import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';
import { pendingOrder } from './support/orders-mock.js';

// Browser projections are synthetic; server isolation is covered by E05/E07.
/** @param {import('@playwright/test').Page} page @param {{delayed?: boolean, existing?: boolean}} [options] */
async function setup(page, { delayed = false, existing = false } = {}) {
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
  const contact = {
    id: 'contact-r-ana',
    label: 'Cliente Ana T.',
    displayName: 'Cliente Ana T.',
    identities: [],
    provisional: false,
    version: 1,
    registration: null,
  };
  const subjects = [
    { id: 'subject-1', version: 4, orderId: null },
    {
      id: 'subject-2',
      version: 9,
      orderId: existing ? 'wap-order' : null,
      orderStatus: existing ? 'pendente' : null,
      orderNumber: existing ? '01-CRM' : null,
    },
  ];
  let release = () => {};
  let finish = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const finished = new Promise((resolve) => {
    finish = () => resolve(undefined);
  });
  /** @type {Array<{body: any, key: string|undefined, csrf: string|undefined}>} */
  const writes = [];
  await page
    .context()
    .addCookies([
      { name: 'crm_csrf', value: 'synthetic', url: 'http://127.0.0.1:4173' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/me/clients')
      return route.fulfill({
        json: { items: [contact], totalCount: 1, nextCursor: null },
      });
    if (path === '/api/v1/contacts/contact-r-ana')
      return route.fulfill({
        json: {
          contact,
          identities: [],
          conversations: [
            { id: 'r-ana', channel: 'whatsapp', automationState: 'human' },
          ],
          deals: [],
        },
      });
    if (path === '/api/v1/inbox/conversations/r-ana/subjects')
      return route.fulfill({
        json: {
          subjects,
          links: [],
          orders: [],
          needsSubjectMessageIds: [],
          currentSubjectId: null,
        },
      });
    if (
      path === '/api/v1/conversations/r-ana/orders' &&
      request.method() === 'POST'
    ) {
      writes.push({
        body: request.postDataJSON(),
        key: request.headers()['idempotency-key'],
        csrf: request.headers()['x-csrf-token'],
      });
      if (delayed) await gate;
      await route
        .fulfill({
          status: existing ? 200 : 201,
          json: {
            order: { id: 'wap-order', number: '01-CRM', status: 'pendente' },
          },
        })
        .catch(() => {});
      finish();
      return;
    }
    if (path === '/api/v1/orders/wap-order')
      return route.fulfill({
        json: { order: { ...pendingOrder, id: 'wap-order', number: '01-CRM' } },
      });
    return route.fallback();
  });
  return { writes, release, finished };
}

for (const width of [1366, 390]) {
  test(`WAP-E06: carteira, assunto e ficha pelo teclado em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { writes } = await setup(page);
    await page.goto('/meus-clientes');
    await expect(
      page.getByRole('heading', { name: 'Meus clientes' }),
    ).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const conversation = page.getByRole('link', {
      name: 'WhatsApp',
      exact: true,
    });
    await conversation.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/inbox\/r-ana/u);
    const draft = page.locator('textarea').first();
    await draft.fill('Rascunho sintético');
    const create = page.getByRole('button', {
      name: 'Criar pedido',
      exact: true,
    });
    await create.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'O cliente confirmou a compra?',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Assunto desta compra')).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.getByLabel('Assunto desta compra').selectOption('subject-2');
    await dialog
      .getByRole('button', { name: 'Cliente confirmou, criar pedido' })
      .click();
    await expect(page).toHaveURL(/\/pedidos\/wap-order\?conversa=r-ana/u);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({
      expectedVersion: 3,
      subjectId: 'subject-2',
      expectedSubjectVersion: 9,
    });
    expect(writes[0].csrf).toBe('synthetic');
    expect(writes[0].key).toMatch(/^[a-f0-9-]{36}$/u);
    await page.goBack();
    await expect(page.locator('textarea').first()).toHaveValue(
      'Rascunho sintético',
    );
  });
}

test('WAP-E06: troca de conversa invalida resposta atrasada', async ({
  page,
}) => {
  const { writes, release, finished } = await setup(page, { delayed: true });
  await page.goto('/inbox/r-bruno');
  await page.getByText('Cliente Ana T.', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/inbox\/r-ana/u);
  await page.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) =>
      original(
        input,
        String(input).endsWith('/r-ana/orders')
          ? { ...options, signal: undefined }
          : options,
      );
  });
  await page.getByRole('button', { name: 'Criar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'O cliente confirmou a compra?',
  });
  await dialog.getByLabel('Assunto desta compra').selectOption('subject-1');
  await dialog
    .getByRole('button', { name: 'Cliente confirmou, criar pedido' })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/inbox\/r-bruno/u);
  release();
  await finished;
  await expect(page).toHaveURL(/\/inbox\/r-bruno/u);
  await expect(dialog).not.toBeVisible();
});

test('WAP-E06: pendente do alvo é aberto e anunciado', async ({ page }) => {
  const { writes } = await setup(page, { existing: true });
  await page.goto('/inbox/r-ana');
  await page.getByRole('button', { name: 'Criar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'O cliente confirmou a compra?',
  });
  await dialog.getByLabel('Assunto desta compra').selectOption('subject-2');
  await dialog
    .getByRole('button', { name: 'Cliente confirmou, criar pedido' })
    .click();
  await expect(page).toHaveURL(/\/pedidos\/wap-order/u);
  await expect(page.locator('.notice-toast')).toContainText(
    'Pedido 01-CRM aberto.',
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({
    expectedVersion: 3,
    subjectId: 'subject-2',
    expectedSubjectVersion: 9,
  });
});

test('WAP-E06: alteração de usuário invalida comando em andamento', async ({
  page,
}) => {
  const { writes, release, finished } = await setup(page, { delayed: true });
  await page.goto('/inbox/r-ana');
  await page.getByRole('button', { name: 'Criar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'O cliente confirmou a compra?',
  });
  await dialog.getByLabel('Assunto desta compra').selectOption('subject-1');
  await dialog
    .getByRole('button', { name: 'Cliente confirmou, criar pedido' })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__wapEventSource.dispatchEvent(
      new globalThis.MessageEvent('identity.user.changed', {
        data: JSON.stringify({ userId: 'seller-bia' }),
      }),
    );
  });
  await expect(dialog).not.toBeVisible();
  release();
  await finished;
  await expect(page).toHaveURL(/\/inbox\/r-ana/u);
});
