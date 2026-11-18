import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';
import { ownConfirmedOrder, pendingOrder } from './support/orders-mock.js';

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
    shared: true,
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
    await expect(
      page.getByText('Este cadastro é compartilhado.', { exact: false }),
    ).toBeVisible();
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

for (const width of [390, 1366]) {
  test(`WAP-E09: carteira conserva cliente e pedido até cobrança em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    const order = {
      ...ownConfirmedOrder,
      id: 'order-client',
      number: '22-CRM',
      contactId: 'contact-r-ana',
      conversationId: null,
      seller: { id: 'seller-bia', name: 'Bia Souza' },
    };
    /** @type {any[]} */
    const billingWrites = [];
    await page.route('**/api/v1/orders?**', (route) => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('owner')).toBe('me');
      expect(query.get('cancellation')).toBe('all');
      return route.fulfill({
        json: {
          items: [
            order,
            {
              ...order,
              id: 'other-client-order',
              contactId: 'other-contact',
              number: '99-CRM',
            },
          ],
          nextCursor: null,
          counts: {},
        },
      });
    });
    await page.route('**/api/v1/orders/order-client', (route) =>
      route.fulfill({ json: { order } }),
    );
    await page.route('**/api/v1/orders/order-client/billing', (route) =>
      route.fulfill({
        json: {
          billing: {
            version: 1,
            orderVersion: order.version,
            canManage: true,
            enabled: true,
            managed: false,
            totalAmountCents: 10000,
            receivedAmountCents: 0,
            balanceAmountCents: 10000,
            charges: [],
            timelineEvents: [],
          },
        },
      }),
    );
    await page.route(
      '**/api/v1/orders/order-client/billing/charges',
      (route) => {
        billingWrites.push(route.request().postDataJSON());
        return route.fulfill({
          json: {
            billing: {
              version: 2,
              orderVersion: order.version,
              percent: 30,
              canManage: true,
              enabled: true,
              managed: true,
              totalAmountCents: 10000,
              receivedAmountCents: 0,
              balanceAmountCents: 10000,
              charges: [
                { id: 'charge-synthetic', status: 'queued', amountCents: 3000 },
              ],
              timelineEvents: [],
            },
          },
        });
      },
    );
    await page.goto('/meus-clientes/contact-r-ana');
    const list = page.getByRole('region', {
      name: 'Meus pedidos deste cliente',
    });
    await expect(
      list.getByRole('link', { name: 'Pedido 22-CRM' }),
    ).toBeVisible();
    await expect(list.getByText('99-CRM')).toHaveCount(0);
    await list.getByRole('link', { name: 'Pedido 22-CRM' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      /pedidos\/order-client\?cliente=contact-r-ana/u,
    );
    await page.getByRole('button', { name: 'Ver cobranças' }).click();
    await expect(page.getByRole('region', { name: 'Cobranças' })).toBeVisible();
    await expect(page.getByText('A receber').first()).toBeVisible();
    await page.getByRole('button', { name: 'Revisar cobrança' }).click();
    const billingDialog = page.getByRole('dialog', {
      name: 'Gerar link de pagamento',
    });
    await expect(billingDialog).toBeVisible();
    await billingDialog
      .getByRole('button', { name: 'Gerar link de pagamento' })
      .click();
    await expect.poll(() => billingWrites.length).toBe(1);
    expect(billingWrites[0]).toMatchObject({
      expectedVersion: order.version,
      expectedBillingVersion: 1,
      percent: 30,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('link', { name: '← Meus clientes' }).click();
    await expect(page).toHaveURL(/meus-clientes\/contact-r-ana/u);
    await expect(
      page.getByRole('heading', { name: 'Cliente Ana T.' }),
    ).toBeVisible();
  });
}

test('WAP-E09: recusa da leitura comercial não expõe pedidos do contato compartilhado', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/orders?**', (route) =>
    route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
  );
  await page.goto('/meus-clientes/contact-r-ana');
  const list = page.getByRole('region', { name: 'Meus pedidos deste cliente' });
  await expect(list.getByRole('alert')).toContainText(
    'Não foi possível consultar seus pedidos',
  );
  await expect(list.getByRole('link', { name: /Pedido/u })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'WhatsApp', exact: true }),
  ).toBeVisible();
});

test('WAP-E09: canal indisponível preserva rascunho e não bloqueia pedido local', async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.route('**/api/v1/conversations/r-ana/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 503,
      json: { code: 'WHATSAPP_SEND_UNAVAILABLE' },
    });
  });
  await page.goto('/meus-clientes/contact-r-ana');
  await page.getByRole('link', { name: 'WhatsApp', exact: true }).click();
  const draft = page.locator('textarea').first();
  await draft.fill('Mensagem sintética preservada');
  await page.getByRole('button', { name: /Enviar resposta/u }).click();
  await expect(
    page.getByText('O WhatsApp desta linha está indisponível.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(draft).toHaveValue('Mensagem sintética preservada');
  await page.getByRole('button', { name: 'Criar pedido', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'O cliente confirmou a compra?',
  });
  await dialog.getByLabel('Assunto desta compra').selectOption('subject-2');
  await dialog
    .getByRole('button', { name: 'Cliente confirmou, criar pedido' })
    .click();
  await expect(page).toHaveURL(/\/pedidos\/wap-order\?conversa=r-ana/u);
  expect(writes).toHaveLength(1);
  await page.goBack();
  await expect(draft).toHaveValue('Mensagem sintética preservada');
});

test('WAP-E09: troca de cliente descarta a leitura comercial atrasada', async ({
  page,
}) => {
  await setup(page);
  const second = {
    id: 'contact-second',
    label: 'Cliente sintético B',
    displayName: 'Cliente sintético B',
    identities: [],
    provisional: false,
    version: 1,
    registration: null,
  };
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let reads = 0;
  await page.route('**/api/v1/contacts/contact-second', (route) =>
    route.fulfill({
      json: { contact: second, identities: [], conversations: [] },
    }),
  );
  await page.route('**/api/v1/orders?**', async (route) => {
    reads++;
    if (reads === 1) {
      await gate;
      return route
        .fulfill({
          json: {
            items: [
              {
                ...pendingOrder,
                id: 'late-order',
                number: '77-CRM',
                contactId: 'contact-r-ana',
              },
            ],
            nextCursor: null,
          },
        })
        .catch(() => {});
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/meus-clientes/contact-r-ana');
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() =>
    globalThis.history.pushState({}, '', '/meus-clientes/contact-second'),
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.PopStateEvent('popstate')),
  );
  await expect(
    page.getByRole('heading', { name: 'Cliente sintético B' }),
  ).toBeVisible();
  release();
  await expect(page.getByRole('link', { name: 'Pedido 77-CRM' })).toHaveCount(
    0,
  );
});
