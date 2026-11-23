import { mkdirSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockConversationShipping } from './support/conversation-shipping-mock.js';
import {
  billingAt,
  billingLink,
  mockOrderBilling,
  ownConfirmedOrder,
} from './support/orders-mock.js';

// RFC 074 (LPC-09), Inbox: the composer's "Cobranças e recebimentos" opens ONE
// journey dialog for the order of the conversation — Situação, the next step
// sentence and the footer actions; send review, send progress and "Cancelar
// link" stay in the same dialog. Real application components, synthetic HTTP
// fixtures only.

const SHOTS = process.env.BILLING_SHOTS_DIR ?? '';

/** Text with the no-break space Intl puts after "R$" made plain. @param {string} value */
const money = (value) =>
  new RegExp(
    value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replaceAll(' ', '\\s'),
    'u',
  );

/** @param {string} id @param {string} number @param {string} nome @param {string} confirmedAt */
const confirmed = (id, number, nome, confirmedAt) => ({
  ...ownConfirmedOrder,
  id,
  number,
  conversationId: 'shipping-conversation-1',
  finalAmountCents: 480000,
  paidOn: null,
  origin: 'atendimento',
  confirmedAt,
  ficha: {
    ...ownConfirmedOrder.ficha,
    summary: {
      ...ownConfirmedOrder.ficha.summary,
      cliente: 'Escola Aurora',
      nome,
    },
  },
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{billing?: Record<string, any>, twoOrders?: boolean, raceCancel?: boolean, intentStates?: string[], theme?: 'light'|'dark'}} [options]
 */
async function setup(page, options = {}) {
  if (options.theme)
    await page.addInitScript((theme) => {
      globalThis.localStorage.setItem('silmer-theme', theme);
    }, options.theme);
  const shell = await mockConversationShipping(page, { multiple: true });
  const conversation = /** @type {any} */ (shell.conversations[0]);
  conversation.contact.label = 'Escola Aurora';
  conversation.order = {
    id: 'shipping-order-1',
    number: '07-CRM',
    status: 'confirmado',
  };
  const order = confirmed(
    'shipping-order-1',
    '07-CRM',
    'Jogos 2026',
    billingAt(22, 9, 0),
  );
  const other = confirmed(
    'shipping-order-2',
    '05-CRM',
    'Uniformes 2026',
    billingAt(10, 9, 0),
  );
  const mock = await mockOrderBilling(page, {
    order,
    billing: options.billing,
    raceCancel: options.raceCancel,
    intentStates: options.intentStates,
  });
  // mockOrderBilling answers the order's conversation for the order page;
  // the Inbox keeps its own conversation fixture.
  await page.unroute('**/api/v1/inbox/conversations/*');
  await page.route('**/api/v1/orders/shipping-order-*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (id === order.id) return route.fulfill({ json: { order } });
    if (id === other.id && options.twoOrders)
      return route.fulfill({ json: { order: other } });
    return route.fulfill({ status: 404, json: {} });
  });
  if (options.twoOrders) {
    await page.route(
      /\/api\/v1\/inbox\/conversations\/shipping-conversation-1\/subjects(?:\?.*)?$/u,
      (route) =>
        route.fulfill({
          json: {
            currentSubjectId: 'subject-1',
            subjects: [order, other].map((item, index) => ({
              id: `subject-${index + 1}`,
              kind: 'order',
              orderId: item.id,
              orderNumber: item.number,
              orderStatus: 'confirmado',
              position: index + 1,
              isCurrent: index === 0,
              selectedSource: 'human',
              version: 1,
            })),
            orders: [order, other].map(({ id, number }) => ({
              id,
              number,
              status: 'confirmado',
            })),
            links: [],
            needsSubjectMessageIds: [],
            ordersHasMore: false,
          },
        }),
    );
    await page.route('**/api/v1/orders/shipping-order-2/billing', (route) =>
      route.fulfill({
        json: {
          billing: {
            enabled: true,
            chatSendEnabled: true,
            managed: true,
            canManage: true,
            canOperate: true,
            ownerName: 'Vendedora sintética',
            version: 3,
            orderVersion: other.version,
            condition: { percent: 100 },
            percent: 100,
            totalAmountCents: 195000,
            review: null,
            settledAt: billingAt(10, 15, 0),
            figures: {
              totalCents: 195000,
              receivedCents: 195000,
              remainingCents: 0,
              heldCents: 0,
              reservedCents: 0,
              freeCents: 0,
            },
            situation: 'settled',
            links: [
              billingLink({
                id: 'paid-05',
                kind: 'full',
                amountCents: 195000,
                state: 'paid',
                chargeId: 'ch-05',
                sentAt: billingAt(10, 9, 30),
                clickedAt: billingAt(10, 14, 50),
                paidAt: billingAt(10, 15, 0),
              }),
            ],
            externalReceipts: [],
            charges: [],
            payments: [],
          },
        },
      }),
    );
  }
  let listReads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/inbox/conversations')
      listReads += 1;
  });
  page.on('pageerror', (cause) => {
    throw cause;
  });
  return {
    ...mock,
    order,
    get listReads() {
      return listReads;
    },
  };
}

/** @param {import('@playwright/test').Page} page */
const billingDialog = (page) =>
  page.getByRole('dialog', { name: 'Cobranças e recebimentos', exact: true });

/** @param {import('@playwright/test').Page} page */
async function openBilling(page) {
  await page.goto('/inbox/shipping-conversation-1');
  const reply = page.getByRole('textbox', { name: 'Responder', exact: true });
  await reply.fill('Rascunho preservado');
  const trigger = page.getByRole('button', {
    name: 'Cobranças e recebimentos',
    exact: true,
  });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = billingDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Situação', exact: true }),
  ).toBeVisible();
  return { dialog, trigger, reply };
}

/** @param {import('@playwright/test').Page} page */
async function onlyOneDialog(page) {
  await expect(page.locator('dialog[open]')).toHaveCount(1);
}

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shoot(page, name) {
  const dir = SHOTS || '';
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

test('LPC-09 Inbox: the linked order is pre-selected and the next step is a sentence, actions in the footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  const { dialog } = await openBilling(page);
  await expect(dialog.locator('h2')).toBeFocused();
  await expect(dialog).toContainText(
    'Pedido 07-CRM · Escola Aurora — Jogos 2026',
  );
  await expect(
    dialog.getByRole('button', { name: 'Trocar pedido' }),
  ).toHaveCount(0);
  await expect(dialog.locator('.bl-due-value')).toHaveText(
    money('R$ 4.800,00'),
  );
  await expect(dialog).toContainText(
    money('Recebido R$ 0,00 de R$ 4.800,00 · 0%'),
  );
  await expect(dialog).toContainText('Condição: Entrada de 50% · saldo depois');
  await expect(dialog).toContainText(
    money('Envie o link do sinal de R$ 2.400,00.'),
  );
  // The order page's actions are not offered here.
  await expect(
    dialog.getByRole('button', { name: 'Só gerar o link' }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Registrar pagamento por fora' }),
  ).toHaveCount(0);
  const foot = dialog.locator('footer');
  await expect(foot.getByRole('button')).toHaveText([
    'Ver tudo no pedido',
    money('Enviar link de R$ 2.400,00 na conversa'),
  ]);
  await expect(dialog.locator('.bl-meter')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await onlyOneDialog(page);
  await shoot(page, 'inbox-desktop-light-overview');
  expect(
    (await new AxeBuilder({ page }).include('.inbox-billing-dialog').analyze())
      .violations,
  ).toEqual([]);
});

test('LPC-09 Inbox: review, send through the conversation and follow the steps until Entregue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const state = await setup(page);
  const { dialog, trigger, reply } = await openBilling(page);
  const readsBefore = state.listReads;
  await dialog
    .getByRole('button', {
      name: money('Enviar link de R$ 2.400,00 na conversa'),
    })
    .click();
  await expect(
    dialog.getByText('Revisar envio · Pedido 07-CRM', { exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText('Escola Aurora (WhatsApp)');
  await expect(dialog).toContainText(
    'Prévia da mensagem, como o cliente recebe',
  );
  const foot = dialog.locator('footer');
  await expect(foot.getByRole('button')).toHaveText([
    'Voltar',
    money('Enviar link de R$ 2.400,00'),
  ]);
  expect(state.writes).toHaveLength(0);
  await foot
    .getByRole('button', { name: money('Enviar link de R$ 2.400,00') })
    .click();
  await expect(
    dialog.getByText('Envio na conversa · Pedido 07-CRM', { exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText(
    money('Link do sinal de R$ 2.400,00 para Escola Aurora (WhatsApp).'),
  );
  await expect(dialog).toContainText(
    'Enviar não confirma o pagamento. Você pode cancelar o link enquanto o cliente não clicar em Pagar. Quando a InfinitePay confirmar, o sinal aparece como Recebido no pedido.',
  );
  const steps = dialog.getByRole('list', { name: 'Estado do envio' });
  await expect(steps.getByRole('listitem')).toHaveText([
    'Gerando link',
    'Enviando',
    'Enviado',
    'Entregue',
  ]);
  await expect(dialog.locator('p.sr-only[role="status"]')).toHaveText(
    'Entregue.',
    { timeout: 15000 },
  );
  await expect(steps.locator('li[data-done]')).toHaveCount(4);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].path).toBe('send-intents');
  expect(state.writes[0].body).toEqual({
    action: 'issue_link',
    amountCents: 240000,
    conversationId: 'shipping-conversation-1',
    expectedConversationVersion: 4,
    expectedVersion: state.order.version,
    expectedBillingVersion: 1,
  });
  // Only CRM link actions leave the Inbox.
  expect(
    state.writes.every((write) =>
      ['issue_link', 'send_link', undefined].includes(write.body.action),
    ),
  ).toBe(true);
  // The thread is read again so the outgoing message shows up.
  await expect.poll(() => state.listReads).toBeGreaterThan(readsBefore);
  await expect(foot.getByRole('button')).toHaveText([
    'Ver tudo no pedido',
    'Cancelar link',
    'Fechar',
  ]);
  await onlyOneDialog(page);
  await shoot(page, 'inbox-desktop-light-result-entregue');
  expect(
    (await new AxeBuilder({ page }).include('.inbox-billing-dialog').analyze())
      .violations,
  ).toEqual([]);
  await foot.getByRole('button', { name: 'Fechar' }).click();
  await expect(trigger).toBeFocused();
  await expect(reply).toHaveValue('Rascunho preservado');
});

test('LPC-09 Inbox: copy the waiting link, then cancel it in the same dialog', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = await setup(page, {
    billing: {
      links: [
        billingLink({
          id: 'link-1',
          sentAt: billingAt(23, 13, 45),
          deliveredAt: billingAt(23, 13, 46),
        }),
      ],
    },
  });
  const { dialog } = await openBilling(page);
  await expect(dialog).toContainText(
    'Link do sinal enviado na conversa · Entregue às 13:46. O cliente ainda não clicou em Pagar.',
  );
  const foot = dialog.locator('footer');
  await expect(foot.getByRole('button')).toHaveText([
    'Ver tudo no pedido',
    'Copiar link',
    'Cancelar link',
    'Fechar',
  ]);
  await foot.getByRole('button', { name: 'Copiar link' }).click();
  await expect(dialog.locator('#inbox-billing-status')).toHaveText(
    'Link copiado.',
  );
  expect(
    await page.evaluate(() => globalThis.navigator.clipboard.readText()),
  ).toMatch(/\/pagar\/7Q4K2M/u);
  await foot.getByRole('button', { name: 'Cancelar link' }).click();
  await expect(
    dialog.getByText('Cancelar link · Pedido 07-CRM', { exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText(
    'Quem abrir este link verá que ele foi cancelado.',
  );
  await onlyOneDialog(page);
  await foot.getByRole('button', { name: 'Cancelar link' }).click();
  await expect(dialog.locator('h2')).toBeFocused();
  await expect(dialog.locator('#inbox-billing-status')).toHaveText(
    money(
      'Link de R$ 2.400,00 cancelado. Quem abrir o link verá que ele foi cancelado.',
    ),
  );
  expect(state.writes.map((write) => write.path)).toEqual([
    'links/link-1/cancel',
  ]);
});

test('LPC-04 Inbox: the customer clicked Pagar first — the refusal replaces the body in place', async ({
  page,
}) => {
  await setup(page, {
    raceCancel: true,
    billing: {
      links: [billingLink({ id: 'link-1', sentAt: billingAt(23, 13, 45) })],
    },
  });
  const { dialog } = await openBilling(page);
  const foot = dialog.locator('footer');
  await foot.getByRole('button', { name: 'Cancelar link' }).click();
  await foot.getByRole('button', { name: 'Cancelar link' }).click();
  const refusal = dialog.locator('#inbox-billing-cancel-refusal');
  await expect(refusal).toBeFocused();
  await expect(refusal).toHaveText(
    'Não deu para cancelar: o cliente clicou em Pagar às 14:03. Acompanhe o pagamento.',
  );
  await expect(foot.getByRole('button')).toHaveText([
    'Ver tudo no pedido',
    'Voltar',
  ]);
  await onlyOneDialog(page);
  await foot.getByRole('button', { name: 'Voltar' }).click();
  await expect(dialog).toContainText(
    'O cliente abriu o pagamento na InfinitePay às 14:03. Este link não pode mais ser cancelado.',
  );
});

test('LPC-09 Inbox: with two confirmed orders "Trocar pedido" reveals the radio list', async ({
  page,
}) => {
  await setup(page, { twoOrders: true });
  const { dialog } = await openBilling(page);
  const swap = dialog.getByRole('button', { name: 'Trocar pedido' });
  await expect(swap).toHaveAttribute('aria-expanded', 'false');
  await expect(
    dialog.getByRole('group', { name: 'Pedidos confirmados desta conversa' }),
  ).toBeHidden();
  await swap.click();
  await expect(swap).toHaveAttribute('aria-expanded', 'true');
  const group = dialog.getByRole('group', {
    name: 'Pedidos confirmados desta conversa',
  });
  await expect(
    group.getByRole('radio', {
      name: 'Pedido 07-CRM · Jogos 2026 · confirmado em 22/11',
    }),
  ).toBeChecked();
  const settled = group.getByRole('radio', {
    name: 'Pedido 05-CRM · Uniformes 2026 · confirmado em 10/11',
  });
  await settled.focus();
  await page.keyboard.press('Space');
  await expect(settled).toBeChecked();
  await expect(dialog).toContainText(
    'Pedido 05-CRM · Escola Aurora — Uniformes 2026',
  );
  await expect(
    dialog.getByRole('heading', { name: 'Tudo recebido' }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    money('Pedido quitado em 10/11: 1 recebimento de R$ 1.950,00.'),
  );
  await expect(dialog.locator('footer').getByRole('button')).toHaveText([
    'Ver tudo no pedido',
    'Fechar',
  ]);
  expect(
    (await new AxeBuilder({ page }).include('.inbox-billing-dialog').analyze())
      .violations,
  ).toEqual([]);
});

test('LPC-09 Inbox: without a condition the picker offers 50/100 and the send saves it', async ({
  page,
}) => {
  const state = await setup(page, {
    billing: { condition: null, percent: null },
  });
  const { dialog } = await openBilling(page);
  await expect(dialog).toContainText(
    'Escolha a condição combinada para enviar o link.',
  );
  const picker = dialog.getByRole('group', { name: 'Condição de pagamento' });
  await expect(picker.getByRole('radio')).toHaveCount(2);
  await expect(
    picker.getByRole('radio', { name: /50% · Entrada/u }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('button', { name: 'Defina no pedido.' }),
  ).toBeVisible();
  await picker
    .getByRole('radio', { name: /100% · Pagamento integral/u })
    .check();
  const foot = dialog.locator('footer');
  await foot
    .getByRole('button', {
      name: money('Enviar link de R$ 4.800,00 na conversa'),
    })
    .click();
  await expect(dialog).toContainText('Pagamento integral · à vista');
  await expect(dialog).toContainText('Fica salva no pedido ao enviar');
  await foot
    .getByRole('button', { name: money('Enviar link de R$ 4.800,00') })
    .click();
  await expect(dialog.locator('p.sr-only[role="status"]')).toHaveText(
    'Entregue.',
    { timeout: 15000 },
  );
  expect(state.writes[0].body).toMatchObject({
    action: 'issue_link',
    amountCents: 480000,
    percent: 100,
  });
});

test('LPC-09 Inbox: the condition is never asked again when the order has one', async ({
  page,
}) => {
  await setup(page, { billing: { condition: { percent: 0 }, percent: 0 } });
  const { dialog } = await openBilling(page);
  await expect(
    dialog.getByRole('group', { name: 'Condição de pagamento' }),
  ).toHaveCount(0);
  await expect(dialog).toContainText('Condição: Sem entrada');
});

test('LPC-09 Inbox: another seller reads a locked panel and opens the order', async ({
  page,
}) => {
  await setup(page, {
    billing: { canOperate: false, ownerName: 'Ana R.' },
  });
  await page.goto('/inbox/shipping-conversation-1');
  await page
    .getByRole('button', { name: 'Cobranças e recebimentos', exact: true })
    .click();
  const dialog = billingDialog(page);
  await expect(dialog).toContainText(
    'Só Ana R. (responsável) ou um administrador opera as cobranças deste pedido.',
  );
  await expect(dialog).toContainText(
    'As cobranças deste pedido continuam visíveis em leitura na página do pedido.',
  );
  await expect(
    dialog.getByRole('button', { name: /^Enviar link/u }),
  ).toHaveCount(0);
  const go = dialog.getByRole('button', { name: 'Abrir o pedido 07-CRM' });
  await expect(go).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('.inbox-billing-dialog').analyze())
      .violations,
  ).toEqual([]);
  await go.click();
  await expect(page).toHaveURL(
    /\/pedidos\/shipping-order-1\?conversa=shipping-conversation-1#cobrancas$/u,
  );
});

test('LPC-09 Inbox: "Ver tudo no pedido" closes, opens the order and focuses its billing title', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  const { dialog } = await openBilling(page);
  await dialog.getByRole('button', { name: 'Ver tudo no pedido' }).click();
  await expect(page).toHaveURL(
    /\/pedidos\/shipping-order-1\?conversa=shipping-conversation-1#cobrancas$/u,
  );
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#order-billing-title')).toBeFocused();
});

test('LPC-09 Inbox: keyboard only, Esc returns to the composer button', async ({
  page,
}) => {
  await setup(page);
  const { dialog, trigger } = await openBilling(page);
  await expect(dialog.locator('h2')).toBeFocused();
  // Tab reaches the footer: Ver tudo no pedido, then the send.
  const names = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    names.push(
      await page.evaluate(() =>
        (globalThis.document.activeElement?.textContent ?? '').trim(),
      ),
    );
  }
  expect(names).toContain('Ver tudo no pedido');
  const send = dialog.getByRole('button', {
    name: money('Enviar link de R$ 2.400,00 na conversa'),
  });
  await send.focus();
  await page.keyboard.press('Enter');
  await expect(
    dialog.getByText('Revisar envio · Pedido 07-CRM', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.locator('footer').getByRole('button', { name: 'Voltar' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('h2')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  test(`LPC-09 Inbox: 390px bottom sheet in ${theme} theme has no overflow nor violations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, { theme });
    await page.goto('/inbox/shipping-conversation-1');
    const trigger = page.getByRole('button', {
      name: 'Cobranças e recebimentos',
      exact: true,
    });
    await trigger.click();
    const dialog = billingDialog(page);
    await expect(
      dialog.getByRole('heading', { name: 'Situação', exact: true }),
    ).toBeVisible();
    const width = await dialog.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      box: el.getBoundingClientRect().width,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    expect(width.box).toBeLessThanOrEqual(391);
    const buttons = dialog.locator('footer button');
    for (const box of await buttons.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    ))
      expect(box).toBeGreaterThanOrEqual(44);
    await shoot(page, `inbox-mobile-${theme}`);
    expect(
      (
        await new AxeBuilder({ page })
          .include('.inbox-billing-dialog')
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}
