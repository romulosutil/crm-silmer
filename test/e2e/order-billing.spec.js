import { mkdirSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  billingAt,
  billingLink,
  mockOrderBilling,
  mockOrders,
  ownConfirmedOrder,
} from './support/orders-mock.js';

// RFC 074 (LPC-09): "Cobranças e recebimentos" on the order page — Situação,
// Próximo passo and Movimentações, the journey dialogs and the rail, on a
// notebook and a phone, in both themes. Synthetic data only.

const SHOTS = process.env.BILLING_SHOTS_DIR ?? '';

/** Text with the no-break space Intl puts after "R$" made plain. @param {string} value */
const money = (value) =>
  new RegExp(
    value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replaceAll(' ', '\\s'),
    'u',
  );

/**
 * @param {import('@playwright/test').Page} page
 * @param {{billing?: Record<string, any>, raceCancel?: boolean, raceExternal?: boolean, confirmConflict?: boolean, stillValid?: boolean, reconcileExceeds?: boolean, theme?: 'light'|'dark'}} [options]
 */
async function setup(page, options = {}) {
  const order = {
    ...ownConfirmedOrder,
    number: '07-CRM',
    finalAmountCents: 480000,
    paidOn: null,
    origin: 'atendimento',
    ficha: {
      ...ownConfirmedOrder.ficha,
      summary: {
        ...ownConfirmedOrder.ficha.summary,
        cliente: 'Escola Aurora',
        nome: 'Jogos 2026',
      },
    },
  };
  if (options.theme)
    await page.addInitScript((theme) => {
      globalThis.localStorage.setItem('silmer-theme', theme);
    }, options.theme);
  await mockOrders(page, { orders: [order] });
  const mock = await mockOrderBilling(page, { order, ...options });
  await page.context().addCookies([
    {
      name: 'crm_csrf',
      value: 'synthetic-billing-csrf',
      url: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`,
    },
  ]);
  await page.goto(`/pedidos/${order.id}#cobrancas`);
  const section = page.getByRole('region', {
    name: 'Cobranças e recebimentos',
    exact: true,
  });
  await expect(section).toBeVisible();
  await expect(
    section.getByText('Falta receber', { exact: true }),
  ).toBeVisible();
  return { section, ...mock };
}

const paidSignal = () =>
  billingLink({
    id: 'sig',
    state: 'paid',
    chargeId: 'ch-sig',
    createdAt: billingAt(22, 9, 12),
    sentAt: billingAt(22, 9, 13),
    deliveredAt: billingAt(22, 9, 13),
    pageOpenedAt: billingAt(22, 10, 25),
    clickedAt: billingAt(22, 10, 28),
    providerValidUntil: billingAt(23, 10, 28),
    paidAt: billingAt(22, 10, 30),
  });
const waitingSignal = () =>
  billingLink({
    sentAt: billingAt(23, 13, 45),
    deliveredAt: billingAt(23, 13, 46),
    pageOpenedAt: billingAt(23, 13, 50),
  });

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page
    .locator('section.billing-section')
    .screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

test('sem cobrança: the condition is chosen once and the first link is sent and followed to Entregue', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: { condition: null, percent: null, managed: false },
  });
  await expect(section.getByText('Sem cobrança').first()).toBeVisible();
  await expect(
    section.getByText('Condição: ainda não combinada'),
  ).toBeVisible();
  const next = section.getByRole('region', { name: 'Próximo passo' });
  await expect(
    next.getByText('Combine a condição com o cliente.'),
  ).toBeVisible();
  const terms = next.getByRole('group', { name: 'Condição de pagamento' });
  await expect(terms.getByRole('radio')).toHaveCount(3);
  await terms
    .getByRole('radio', { name: /100% · Pagamento integral/u })
    .check();
  await expect(
    next.getByRole('button', {
      name: money('Enviar link de R$ 4.800,00 na conversa'),
    }),
  ).toBeVisible();
  await terms.getByRole('radio', { name: /0% · Sem entrada/u }).check();
  await expect(
    next.getByRole('button', { name: 'Salvar sem entrada' }),
  ).toBeVisible();
  await expect(
    next.getByText(
      'Nenhum link é gerado. Você cobra o valor integral quando quiser.',
    ),
  ).toBeVisible();
  await terms.getByRole('radio', { name: /50% · Entrada/u }).check();
  const primary = next.getByRole('button', {
    name: money('Enviar link de R$ 2.400,00 na conversa'),
  });
  await primary.click();

  const dialog = page.getByRole('dialog', { name: 'Enviar link do sinal' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Enviar link do sinal' }),
  ).toBeFocused();
  await expect(dialog.getByText('Escola Aurora (WhatsApp)')).toBeVisible();
  await expect(
    dialog.getByText('Fica salva no pedido ao enviar'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('group', {
      name: 'Prévia da mensagem, como o cliente recebe',
    }),
  ).toContainText(
    money('Pedido 07-CRM — sinal de R$ 2.400,00. Link para pagamento:'),
  );
  await expect(
    dialog.getByText(
      'Você pode cancelar este link enquanto o cliente não clicar em Pagar. Enviar não confirma o pagamento.',
    ),
  ).toBeVisible();
  // Esc returns the focus to the trigger; nothing was sent.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(primary).toBeFocused();
  expect(writes).toHaveLength(0);

  await primary.click();
  await dialog
    .getByRole('button', { name: money('Enviar link de R$ 2.400,00') })
    .click();
  await expect(dialog).toBeHidden();
  expect(writes[0]).toMatchObject({
    path: 'send-intents',
    body: {
      action: 'issue_link',
      amountCents: 240000,
      percent: 50,
      conversationId: 'conversation-5',
      expectedConversationVersion: 7,
    },
  });
  await expect(
    next.getByRole('list', { name: 'Estado do envio' }),
  ).toBeVisible();
  await expect(next.getByRole('status')).toContainText(
    'Link do sinal enviado na conversa e entregue às 14:07. Você pode cancelá-lo enquanto o cliente não clicar em Pagar.',
    { timeout: 10_000 },
  );
  await expect(section.getByText('Aguardando o cliente').first()).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Cobranças e recebimentos' })
      .getByText('Aguardando o cliente'),
  ).toBeVisible();
});

test('aguardando o cliente: cancel a link before the click', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: { links: [waitingSignal()] },
  });
  await expect(
    section.getByText(money('Em links abertos R$ 2.400,00')),
  ).toBeVisible();
  const next = section.getByRole('region', { name: 'Próximo passo' });
  await expect(
    next.getByText(
      'Link do sinal enviado na conversa · Entregue às 13:46. O cliente ainda não clicou em Pagar.',
    ),
  ).toBeVisible();
  await next.getByRole('button', { name: 'Cancelar link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar link' });
  await expect(
    dialog.getByText(
      'O cliente abriu a página às 13:50, mas não clicou em Pagar',
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      money('Em links abertos passa a R$ 0,00 · livre para cobrar R$ 4.800,00'),
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar link' }).press('Enter');
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({ path: 'links/link-1/cancel' });
  // LPC-09: the trigger left with the open link, so the focus lands on the
  // Próximo passo title and stays there after the section re-reads.
  const nextTitle = page.locator('#order-billing-next-title');
  await expect(nextTitle).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(nextTitle).toBeFocused();
  await expect(next.getByRole('status')).toContainText(
    money(
      'Link de R$ 2.400,00 cancelado. Quem abrir o link verá que ele foi cancelado.',
    ),
  );
  const row = section.getByRole('listitem').filter({ hasText: 'Sinal · 50%' });
  await expect(row.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect(row.getByText('fora da soma')).toBeVisible();
});

test('corrida: the click wins and the cancel is refused in place', async ({
  page,
}) => {
  const { section } = await setup(page, {
    billing: { links: [waitingSignal()] },
    raceCancel: true,
  });
  await section
    .getByRole('button', { name: 'Mais ações desta cobrança: Sinal · 50%' })
    .click();
  await page.getByRole('menuitem', { name: 'Cancelar link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar link' });
  await dialog.getByRole('button', { name: 'Cancelar link' }).click();
  const refusal = dialog.getByRole('alert');
  await expect(refusal).toHaveText(
    'Não deu para cancelar: o cliente clicou em Pagar às 14:03. Acompanhe o pagamento.',
  );
  await expect(refusal).toBeFocused();
  await expect(
    dialog.getByRole('button', { name: 'Cancelar link' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Fechar' }).last().click();
  await expect(section.getByText('Em pagamento').first()).toBeVisible();
  await expect(
    section.getByText(
      'O cliente abriu o pagamento na InfinitePay às 14:03. Este link não pode mais ser cancelado.',
    ),
  ).toBeVisible();
});

test('vários links: another link of any amount up to the free amount', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: {
      links: [
        paidSignal(),
        billingLink({
          id: 'part',
          kind: 'installment',
          amountCents: 120000,
          createdAt: billingAt(23, 10, 15),
          sentAt: billingAt(23, 10, 15),
          deliveredAt: billingAt(23, 10, 16),
        }),
      ],
    },
  });
  await expect(
    section.getByText(money('Recebido R$ 2.400,00 de R$ 4.800,00 · 50%')),
  ).toBeVisible();
  await expect(
    section.getByText(
      money('Em links abertos R$ 1.200,00 · Livre para cobrar R$ 1.200,00'),
    ),
  ).toBeVisible();
  // Row menu by keyboard: ArrowDown opens, Esc closes and returns the focus.
  const more = section.getByRole('button', {
    name: 'Mais ações desta cobrança: Parcela',
  });
  await more.focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'Copiar link' }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'Cancelar link' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await section
    .getByRole('button', {
      name: money('Enviar outro link de até R$ 1.200,00'),
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Enviar outro link' });
  const amount = dialog.getByLabel('Valor do link');
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('1.200,00');
  await amount.fill('1.500,00');
  await dialog
    .getByRole('button', { name: 'Enviar link', exact: true })
    .click();
  await expect(
    dialog.getByText(
      money('O valor passa do livre para cobrar (R$ 1.200,00).'),
    ),
  ).toBeVisible();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toBeFocused();
  await amount.fill('0,50');
  await dialog
    .getByRole('button', { name: 'Enviar link', exact: true })
    .click();
  await expect(
    dialog.getByText('O valor mínimo de um link é R$ 1,00.'),
  ).toBeVisible();
  await amount.fill('600,00');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(
    dialog.getByText(
      money(
        'Em links abertos passa a R$ 1.800,00 · livre para cobrar R$ 600,00',
      ),
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole('definition').filter({ hasText: 'Parcela' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Só gerar o link' }).press('Enter');
  await expect(dialog).toBeHidden();
  // LPC-09: the focus never falls to the page body after the link is made.
  await page.waitForTimeout(1500);
  await expect(page.locator('body')).not.toBeFocused();
  await expect(page.locator('section.billing-section :focus')).toHaveCount(1);
  expect(writes.at(-1)).toMatchObject({
    path: 'links',
    body: { amountCents: 60000 },
  });
  await expect(
    section.getByRole('region', { name: 'Próximo passo' }).getByRole('status'),
  ).toContainText(
    'Link da parcela gerado. Ele ainda não foi enviado ao cliente.',
  );
  await expect(
    section
      .getByRole('listitem')
      .filter({ hasText: 'Link gerado, não enviado' }),
  ).toHaveCount(1);
});

test('pago por fora com link aberto: one confirmation cancels the link and records the receipt', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: {
      links: [
        paidSignal(),
        billingLink({
          id: 'bal',
          kind: 'balance',
          amountCents: 240000,
          createdAt: billingAt(23, 9, 10),
          sentAt: billingAt(23, 9, 10),
          deliveredAt: billingAt(23, 9, 11),
        }),
      ],
    },
  });
  const next = section.getByRole('region', { name: 'Próximo passo' });
  await next
    .getByRole('button', { name: 'Registrar pagamento por fora' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Registrar pagamento por fora',
  });
  const amount = dialog.getByLabel('Valor recebido');
  await expect(amount).toBeFocused();
  await amount.fill('2.400,00');
  await expect(
    dialog.getByText(
      money(
        'R$ 2.400,00 deste valor está reservado no link do saldo (R$ 2.400,00), que o cliente ainda não clicou. Para registrar, o link é cancelado no mesmo passo.',
      ),
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      money(
        'Link do saldo: cancelado · Recebido passa a R$ 4.800,00 · Quitado',
      ),
    ),
  ).toBeVisible();
  const confirm = dialog.getByRole('button', {
    name: money('Cancelar o link do saldo e registrar R$ 2.400,00'),
  });
  await confirm.click();
  await expect(dialog.getByText('Escolha a forma de pagamento.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Transferência bancária' }).check();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({
    path: 'external-receipts',
    body: {
      amountCents: 240000,
      method: 'bank_transfer',
      cancelLinkIds: ['bal'],
    },
  });
  await expect(section.locator('#order-billing-next-status')).toContainText(
    money(
      'R$ 2.400,00 registrado como recebido por fora (Transferência). O link do saldo foi cancelado.',
    ),
  );
  await expect(section.getByText('Quitado').first()).toBeVisible();
  await expect(
    section.getByRole('heading', { name: 'Tudo recebido' }),
  ).toBeVisible();
});

test('pago por fora: a link Em pagamento refuses with the reason', async ({
  page,
}) => {
  const { section } = await setup(page, {
    billing: {
      links: [
        paidSignal(),
        billingLink({
          id: 'bal',
          kind: 'balance',
          amountCents: 240000,
          state: 'checkout_open',
          chargeId: 'ch-bal',
          sentAt: billingAt(23, 9, 10),
          clickedAt: billingAt(23, 14, 2),
          providerValidUntil: billingAt(24, 14, 2),
        }),
      ],
    },
  });
  await section
    .getByRole('button', { name: 'Registrar pagamento por fora' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Registrar pagamento por fora',
  });
  await dialog.getByLabel('Valor recebido').fill('2.400,00');
  const reason = dialog.getByText(
    money(
      'Link do saldo (R$ 2.400,00) está Em pagamento. O cliente está pagando este link na InfinitePay. Aguarde ou verifique o pagamento.',
    ),
  );
  await expect(reason).toBeVisible();
  const primary = dialog.getByRole('button', { name: 'Registrar pagamento' });
  await expect(primary).toHaveAttribute('aria-disabled', 'true');
  await expect(primary).toHaveAccessibleDescription(
    money(
      'Link do saldo (R$ 2.400,00) está Em pagamento. O cliente está pagando este link na InfinitePay. Aguarde ou verifique o pagamento.',
    ),
  );
});

test('precisa de conferência: the cause, then a two-step resolution', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: {
      review: {
        reason: 'order_changed',
        previousTotalCents: 450000,
        heldCents: 225000,
      },
      links: [
        billingLink({
          id: 'held',
          state: 'paid',
          inReview: true,
          amountCents: 225000,
          chargeId: 'ch-held',
          createdAt: billingAt(22, 9, 12),
          sentAt: billingAt(22, 9, 13),
          clickedAt: billingAt(22, 10, 28),
          paidAt: billingAt(22, 10, 30),
        }),
        billingLink({
          id: 'bal',
          kind: 'balance',
          amountCents: 225000,
          state: 'cancelled',
          createdAt: billingAt(22, 11, 0),
          sentAt: billingAt(22, 11, 0),
          cancelledAt: billingAt(23, 9, 0),
          cancelReason: 'order_changed',
        }),
      ],
    },
  });
  await expect(
    section.getByText('Precisa de conferência').first(),
  ).toBeVisible();
  const next = section.getByRole('region', { name: 'Próximo passo' });
  await expect(
    next.getByText(
      money(
        'O valor do pedido mudou de R$ 4.500,00 para R$ 4.800,00 depois que o sinal foi pago. O sinal de R$ 2.250,00 está guardado, mas ainda não conta no recebido.',
      ),
    ),
  ).toBeVisible();
  await expect(
    next.getByText(
      'Até resolver, não é possível cobrar, enviar link ou registrar pagamento por fora.',
    ),
  ).toBeVisible();
  await next.getByRole('button', { name: 'Resolver conferência' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolver conferência' });
  await expect(
    dialog.getByText('Passo 1 de 2 · Confira na InfinitePay'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    dialog.getByText('Confirme que conferiu os pagamentos na InfinitePay.'),
  ).toBeVisible();
  await dialog
    .getByRole('checkbox', {
      name: 'Conferi os pagamentos desta cobrança na InfinitePay.',
    })
    .check();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    dialog.getByText('Passo 2 de 2 · Escolha o que fazer'),
  ).toBeVisible();
  const cancelOption = dialog.getByRole('radio', {
    name: /Cancelar links que o cliente ainda não clicou/u,
  });
  await expect(cancelOption).toHaveAttribute('aria-disabled', 'true');
  await expect(cancelOption).toHaveAccessibleDescription(
    'Não há link que o cliente ainda não clicou.',
  );
  await expect(
    dialog.getByRole('radio', {
      name: /Aplicar os pagamentos ao valor atual/u,
    }),
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Aplicar pagamentos' }).click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({
    path: 'reconcile',
    body: { decision: 'apply_current', confirmedProviderReview: true },
  });
  await expect(next.getByRole('status')).toContainText(
    money(
      'Conferência resolvida. Recebido passa a R$ 2.250,00 · falta R$ 2.550,00.',
    ),
  );
});

test('precisa de conferência: a link that tips the sum over the total is refused in place', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    reconcileExceeds: true,
    billing: {
      review: {
        reason: 'order_changed',
        previousTotalCents: 450000,
        heldCents: 225000,
      },
      links: [
        billingLink({
          id: 'held',
          state: 'paid',
          inReview: true,
          amountCents: 225000,
          chargeId: 'ch-held',
          createdAt: billingAt(22, 9, 12),
          clickedAt: billingAt(22, 10, 28),
          paidAt: billingAt(22, 10, 30),
        }),
      ],
    },
  });
  await section.getByRole('button', { name: 'Resolver conferência' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolver conferência' });
  await dialog
    .getByRole('checkbox', {
      name: 'Conferi os pagamentos desta cobrança na InfinitePay.',
    })
    .check();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: 'Aplicar pagamentos' }).click();
  const alert = dialog.getByRole('alert');
  const reason = money(
    'Os pagamentos e os links abertos somam R$ 5.250,00, mais que o total de R$ 4.800,00. Cancele links que o cliente ainda não clicou antes de aplicar.',
  );
  await expect(alert).toHaveText(reason);
  await expect(alert).toBeFocused();
  const apply = dialog.getByRole('radio', {
    name: /Aplicar os pagamentos ao valor atual/u,
  });
  await expect(apply).toHaveAttribute('aria-disabled', 'true');
  await expect(
    dialog.getByRole('button', { name: 'Aplicar pagamentos' }),
  ).toHaveAttribute('aria-disabled', 'true');
  // Cancelling the unclicked links stays available.
  await dialog
    .getByRole('radio', {
      name: /Cancelar links que o cliente ainda não clicou/u,
    })
    .check();
  await dialog.getByRole('button', { name: 'Cancelar links' }).click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({
    path: 'reconcile',
    body: { decision: 'cancel_open_links', confirmedProviderReview: true },
  });
});

/** A link in "Resultado a conferir" whose attempt is valid until `validUntil`. @param {string|null} validUntil */
const unknownLink = (validUntil) =>
  billingLink({
    state: 'unknown',
    chargeId: 'ch-1',
    sentAt: billingAt(23, 13, 45),
    clickedAt: billingAt(23, 14, 2),
    providerValidUntil: validUntil,
    history: [
      { kind: 'created', at: billingAt(23, 13, 44), actor: 'Marina A.' },
      { kind: 'clicked', at: billingAt(23, 14, 2) },
      { kind: 'checkout_unknown', at: billingAt(23, 14, 3) },
    ],
  });
const hoursFromNow = (/** @type {number} */ hours) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

test('resultado a conferir: the customer says they paid — a provider check, no second payment', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: { links: [unknownLink(hoursFromNow(20))] },
  });
  await expect(section.getByText('Resultado a conferir').first()).toBeVisible();
  const next = section.getByRole('region', { name: 'Próximo passo' });
  await expect(
    next.getByText(
      'A integração tenta de novo sozinha · última tentativa 14:03',
    ),
  ).toBeVisible();
  const primary = next.getByRole('button', {
    name: 'Confirmar resultado na InfinitePay',
  });
  await primary.click();
  const dialog = page.getByRole('dialog', {
    name: 'Confirmar resultado na InfinitePay',
  });
  await expect(
    dialog.getByRole('heading', { name: 'Confirmar resultado na InfinitePay' }),
  ).toBeFocused();
  await expect(
    dialog.getByText('O link fica travado até confirmar.', { exact: false }),
  ).toBeVisible();
  const release = dialog.getByRole('radio', { name: /Liberar o link/u });
  await expect(release).toHaveAttribute('aria-disabled', 'true');
  await expect(release).toHaveAccessibleDescription(
    /^Disponível depois de \d{2}\/\d{2}, \d{2}:\d{2}, quando o pagamento aberto na InfinitePay vence\.$/u,
  );
  await expect(
    dialog.getByRole('radio', { name: /O cliente diz que pagou/u }),
  ).toBeChecked();
  const ask = dialog.getByRole('button', { name: 'Pedir verificação' });
  await ask.click();
  await expect(dialog.getByText('Informe o código da fatura.')).toBeVisible();
  await expect(dialog.getByLabel('Código da fatura')).toBeFocused();
  expect(writes).toHaveLength(0);
  await dialog.getByLabel('Código da fatura').fill('FAT-SINTETICA-1');
  await dialog.getByLabel('NSU da transação').fill('000123');
  await ask.click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({
    path: 'links/link-1/confirm-result',
    body: { invoiceSlug: 'FAT-SINTETICA-1', transactionNsu: '000123' },
  });
  await expect(next.getByRole('status')).toContainText(
    'Verificação pedida. A InfinitePay responde na próxima consulta, às 14:10.',
  );
  const busy = next.getByRole('button', { name: 'Confirmando resultado…' });
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
});

test('resultado a conferir: after the attempt expired, the link is released for a new click', async ({
  page,
}) => {
  const { section, writes } = await setup(page, {
    billing: { links: [unknownLink(hoursFromNow(-1))] },
  });
  await section
    .getByRole('button', { name: 'Confirmar resultado na InfinitePay' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Confirmar resultado na InfinitePay',
  });
  const release = dialog.getByRole('radio', { name: /Liberar o link/u });
  await expect(release).not.toHaveAttribute('aria-disabled', 'true');
  await release.check();
  await expect(dialog.getByLabel('Código da fatura')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Liberar o link' }).click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)?.path).toBe('links/link-1/confirm-result');
  expect(Object.keys(writes.at(-1)?.body ?? {}).sort()).toEqual([
    'expectedBillingVersion',
    'expectedVersion',
  ]);
  await expect(section.locator('#order-billing-next-status')).toContainText(
    'Link liberado: o cliente pode clicar em Pagar de novo.',
  );
  await expect(section.getByText('Aguardando o cliente').first()).toBeVisible();
});

test('resultado a conferir: refusals are said in place', async ({ page }) => {
  const still = await setup(page, {
    billing: { links: [unknownLink(null)] },
    stillValid: true,
  });
  await still.section
    .getByRole('button', { name: 'Confirmar resultado na InfinitePay' })
    .click();
  let dialog = page.getByRole('dialog', {
    name: 'Confirmar resultado na InfinitePay',
  });
  await dialog.getByRole('radio', { name: /Liberar o link/u }).check();
  await dialog.getByRole('button', { name: 'Liberar o link' }).click();
  const stillAlert = dialog.getByRole('alert');
  await expect(stillAlert).toHaveText(
    'Ainda não dá para liberar: o pagamento aberto na InfinitePay ainda vale.',
  );
  await expect(stillAlert).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The InfinitePay's own answer arrives first (BILLING_CONFLICT).
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const raced = await setup(page, {
    billing: { links: [unknownLink(hoursFromNow(20))] },
    confirmConflict: true,
  });
  await raced.section
    .getByRole('button', { name: 'Confirmar resultado na InfinitePay' })
    .click();
  dialog = page.getByRole('dialog', {
    name: 'Confirmar resultado na InfinitePay',
  });
  await dialog.getByLabel('Código da fatura').fill('FAT-SINTETICA-2');
  await dialog.getByLabel('NSU da transação').fill('000456');
  await dialog.getByRole('button', { name: 'Pedir verificação' }).click();
  const conflict = dialog.getByRole('alert');
  await expect(conflict).toHaveText(
    'O resultado já chegou: a InfinitePay abriu o pagamento. Acompanhe o pagamento.',
  );
  await expect(conflict).toBeFocused();
  await expect(
    dialog.getByRole('button', { name: 'Pedir verificação' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Fechar' }).last().click();
  await expect(raced.section.getByText('Em pagamento').first()).toBeVisible();
});

test('quitado: receipts add up, the cancelled link stays out of the sum, history opens', async ({
  page,
}) => {
  const { section } = await setup(page, {
    billing: {
      settledAt: billingAt(23, 11, 30),
      links: [
        paidSignal(),
        billingLink({
          id: 'c',
          kind: 'installment',
          amountCents: 200000,
          state: 'cancelled',
          createdAt: billingAt(23, 9, 0),
          sentAt: billingAt(23, 9, 0),
          cancelledAt: billingAt(23, 9, 4),
          cancelledBy: 'Marina A.',
          cancelReason: 'seller',
        }),
        billingLink({
          id: 'p',
          kind: 'installment',
          amountCents: 120000,
          state: 'paid',
          chargeId: 'ch-p',
          payMethod: 'credit_card',
          createdAt: billingAt(23, 10, 15),
          sentAt: billingAt(23, 10, 15),
          paidAt: billingAt(23, 10, 42),
        }),
      ],
      receipts: [
        {
          id: 'r1',
          amountCents: 120000,
          receivedOn: '2026-11-23',
          method: 'bank_transfer',
          note: '',
          recordedByName: 'Marina A.',
          recordedAt: billingAt(23, 11, 30),
          reversedAt: null,
        },
      ],
    },
  });
  await expect(section.getByText('Quitado').first()).toBeVisible();
  await expect(
    section.getByRole('heading', { name: 'Tudo recebido' }),
  ).toBeVisible();
  await expect(
    section.getByText(
      money('Pedido quitado em 23/11: 3 recebimentos somam R$ 4.800,00.'),
    ),
  ).toBeVisible();
  await expect(
    section.getByText('4 movimentações · da mais antiga para a mais recente'),
  ).toBeVisible();
  const cancelled = section
    .getByRole('listitem')
    .filter({ hasText: 'cancelado por Marina A.' });
  await expect(cancelled.getByText('fora da soma')).toBeVisible();
  const toggle = cancelled.getByRole('button', {
    name: 'Histórico desta cobrança',
  });
  await toggle.click();
  await expect(
    cancelled.getByRole('button', { name: 'Ocultar histórico' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    cancelled.getByText('Link cancelado por Marina A.'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Cobranças e recebimentos' })
      .getByText('Quitado'),
  ).toBeVisible();
  await shot(page, 'billing-desktop-light-quitado');
  const axe = await new AxeBuilder({ page })
    .include('section.billing-section')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('other seller: numbers, badge and rows, but no link and no action', async ({
  page,
}) => {
  const { section } = await setup(page, {
    billing: {
      canOperate: false,
      canManage: false,
      chatSendEnabled: false,
      links: [{ ...waitingSignal(), url: null }],
    },
  });
  await expect(section.getByText('Aguardando o cliente').first()).toBeVisible();
  await expect(
    section.getByText(
      'Só Marina A. (responsável) ou um administrador opera as cobranças deste pedido.',
    ),
  ).toBeVisible();
  await expect(
    section.getByRole('region', { name: 'Próximo passo' }),
  ).toHaveCount(0);
  await expect(
    section.getByRole('button', { name: /Mais ações/u }),
  ).toHaveCount(0);
  await expect(section.getByText('/pagar/')).toHaveCount(0);
});

test('notebook light: section and an open dialog pass axe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { section } = await setup(page, {
    billing: {
      links: [
        paidSignal(),
        billingLink({
          id: 'part',
          kind: 'installment',
          amountCents: 120000,
          createdAt: billingAt(23, 10, 15),
          sentAt: billingAt(23, 10, 15),
          deliveredAt: billingAt(23, 10, 16),
        }),
      ],
    },
  });
  await shot(page, 'billing-desktop-light');
  expect(
    (
      await new AxeBuilder({ page })
        .include('section.billing-section')
        .analyze()
    ).violations,
  ).toEqual([]);
  await section
    .getByRole('button', { name: 'Registrar pagamento por fora' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Registrar pagamento por fora' }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('dialog[open]').analyze())
      .violations,
  ).toEqual([]);
});

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  test(`phone 390px ${theme}: one column, full-width actions, row menu as a sheet`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { section } = await setup(page, {
      theme,
      billing: {
        links: [
          paidSignal(),
          billingLink({
            id: 'part',
            kind: 'installment',
            amountCents: 120000,
            createdAt: billingAt(23, 10, 15),
            sentAt: billingAt(23, 10, 15),
            deliveredAt: billingAt(23, 10, 16),
          }),
        ],
      },
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const toggle = section.getByRole('button', {
      name: /Cobranças e recebimentos/u,
    });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText('Aguardando o cliente');
    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const primary = section.getByRole('button', {
      name: money('Enviar outro link de até R$ 1.200,00'),
    });
    const box = await primary.boundingBox();
    const body = await section.locator('#order-billing-body').boundingBox();
    expect(box && body && box.width).toBeGreaterThan((body?.width ?? 0) - 80);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, `billing-mobile-${theme}`);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section.billing-section')
          .analyze()
      ).violations,
    ).toEqual([]);
    const more = section.getByRole('button', {
      name: 'Mais ações desta cobrança: Parcela',
    });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Mais ações · Parcela' });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole('menuitem', { name: 'Copiar link' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });
}
