import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';

import { brand } from '../../apps/edge-web/src/brand/index.js';
import {
  confirmedOrder,
  eventStreamBody,
  mockOrders,
  ONE_PIXEL_PNG,
  ownConfirmedOrder,
  pendingOrder,
  PRICED_GROUP_ID,
  PRICED_LINE_G,
  PRICED_LINE_M,
  pricedPendingOrder,
  syntheticFile,
} from './support/orders-mock.js';

/**
 * PFI-20: the controls that add art files — the drop area's button while
 * there are none, then the grid's last tile; never both.
 *
 * @param {import('@playwright/test').Locator} scope
 */
function addFileControls(scope) {
  return scope.getByRole('button', { name: /^Adicionar arquivo/u });
}

/**
 * The tiles of the art files themselves, without the tile that adds one.
 *
 * @param {import('@playwright/test').Locator} files
 */
function fileTiles(files) {
  return files.getByRole('listitem').filter({
    hasNot: files.page().getByRole('button', { name: /^Adicionar arquivo/u }),
  });
}

// EDIT-01 (ADR 083, design.md §20): "Itens e especificações" is edited in
// place — no "Editar itens", no Salvar/Cancelar; each change is one PATCH.
const ITEMS = 'Itens e especificações';

/**
 * The section writes the page sent, in order, as `{section, ...body}`.
 *
 * @param {any[]} writes
 */
function sectionWrites(writes) {
  return writes
    .filter((call) => call.section)
    .map((call) => ({ section: call.section, ...call.body }));
}

/**
 * Waits until the page sent `count` writes and the last one was answered:
 * the one status region of the items reads "Salvo" (EDIT-08).
 *
 * @param {import('@playwright/test').Page} page
 * @param {any[]} writes @param {number} count
 */
async function expectSaved(page, writes, count) {
  await expect.poll(() => writes.length).toBe(count);
  await expect(
    page.getByRole('region', { name: ITEMS }).getByRole('status'),
  ).toHaveText('Salvo');
}

/**
 * One command of the section `size-pricing`, as the page sends it.
 *
 * @param {number} expectedVersion @param {Record<string, unknown>} value
 */
function command(expectedVersion, value) {
  return { expectedVersion, section: 'size-pricing', value };
}

/** A new item as "Adicionar item" sends it: every key, nothing filled. */
const BLANK_ITEM = {
  cor: '',
  cor_costas: '',
  cor_frente: '',
  cor_manga_direita: '',
  cor_manga_esquerda: '',
  estampa: '',
  gola: '',
  grade: [],
  malhas: [],
  modelo: '',
  publico: '',
  quantidade_informada: null,
  tipo: '',
  tipo_servico: '',
  vies_gola: '',
  vies_mangas: '',
};

const OTHER_SELLER = { id: 'seller-ricardo', name: 'Ricardo Lima' };

// An item with the principal points only, so every optional is still to add.
const bareItemOrder = {
  ...pendingOrder,
  ficha: {
    ...pendingOrder.ficha,
    items: [
      {
        cor: 'BRANCA',
        gola: 'GOLA REDONDA',
        grade: [
          { quantidade: 100, tamanho: 'M' },
          { quantidade: 50, tamanho: 'G' },
        ],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        tipo: 'CAMISETA',
        tipo_servico: 'SUBLIMAÇÃO TOTAL',
      },
    ],
  },
};

// Two priced items, to move and to remove.
const SECOND_GROUP_ID = '6f0c2f0e-6f39-4c1c-9a57-0d0f0a5b7c12';
const twoItemsOrder = {
  ...pricedPendingOrder,
  ficha: {
    ...pricedPendingOrder.ficha,
    items: [
      pendingOrder.ficha.items[0],
      { ...pendingOrder.ficha.items[0], tipo: 'REGATA' },
    ],
    sizePricing: [
      pricedPendingOrder.ficha.sizePricing[0],
      {
        id: SECOND_GROUP_ID,
        lines: [
          {
            id: '0b9a4d7e-3c55-4a43-8a8e-51f2c1d9e003',
            quantity: 100,
            size: 'M',
            subtotalCents: 320000,
            subtotalReviewed: true,
          },
          {
            id: '0b9a4d7e-3c55-4a43-8a8e-51f2c1d9e004',
            quantity: 50,
            size: 'G',
            subtotalCents: 160000,
            subtotalReviewed: true,
          },
        ],
      },
    ],
  },
  finalAmountCents: 960000,
  pricing: {
    complete: true,
    groups: [
      { id: PRICED_GROUP_ID, subtotalCents: 480000 },
      { id: SECOND_GROUP_ID, subtotalCents: 480000 },
    ],
    issues: [],
    totalCents: 960000,
  },
  totalPieces: 300,
};

// A confirmed order reopened without subtotals by size: it keeps the
// whole-list write of the section `items` (EDIT-07).
const reopenedOrder = {
  ...pendingOrder,
  confirmedAt: '2026-09-09T19:20:00.000Z',
  confirmedBy: { id: 'seller-marina', name: 'Marina Aguiar' },
  finalAmountCents: 482000,
  missingFields: [],
  orderDate: '2026-09-09',
  paymentCondition: 'pix',
  reopenedAt: '2026-09-13T12:00:00.000Z',
  reopenedBy: { id: 'seller-marina', name: 'Marina Aguiar' },
};

test('opens the order page inside Pedidos, with the trail and the sections in order', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente?conversa=conversation-7');

  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
  await expect(page.locator('.topbar-title')).toHaveText('Pedido');
  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Pedidos' }),
  ).toHaveAttribute('aria-current', 'page');

  // PGE-01: back to Pedidos, and the origin named when it came from a chat.
  const trail = page.getByRole('navigation', { name: 'Rastro' });
  await expect(trail.getByRole('link', { name: '← Pedidos' })).toHaveAttribute(
    'href',
    '/pedidos',
  );
  await expect(trail).toContainText('07-CRM');
  await expect(trail).toContainText('aberto a partir da conversa');
  // The way back is the conversation itself, not the Inbox in general.
  await expect(
    page.getByRole('link', { name: 'Abrir conversa' }),
  ).toHaveAttribute('href', '/inbox/conversation-7');

  // PFI-15: the real progress to generate opens the page. PFI-20: the words
  // of the screen, and no production control (it is only on paper).
  await expect(page.locator('main h2')).toHaveText([
    'Para gerar o pedido',
    'Resumo do pedido',
    'Datas do pedido',
    'Itens e especificações',
    'Arte do pedido',
    'Observações do pedido',
    'Dados do atendimento',
    'Fechamento e pagamento',
  ]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps the trail without an origin when the list opened the order', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const trail = page.getByRole('navigation', { name: 'Rastro' });
  await expect(trail).not.toContainText('aberto a partir da conversa');
  // The order still knows its conversation and opens it directly.
  await expect(
    page.getByRole('link', { name: 'Abrir conversa' }),
  ).toHaveAttribute('href', '/inbox/conversation-7');
});

test('locks printing while the order is pending and says why (PIM-01)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const print = page.getByRole('button', { name: 'Gerar PDF' });
  await expect(print).toBeDisabled();
  await expect(
    page.getByText('Disponível depois de gerar o pedido'),
  ).toBeVisible();
  await expect(print).toHaveAttribute('aria-describedby', /./u);
});

// ADR 016: of the summary, only the promised delivery blocks; this order
// misses one of each step plus the amount and the payment method.
const incompleteOrder = {
  ...pendingOrder,
  ficha: {
    ...pendingOrder.ficha,
    artwork: {
      feito_pelo_cliente: false,
      feito_pela_silmer: false,
      files: [],
      sem_estampa: false,
    },
    items: [
      { ...pendingOrder.ficha.items[0], cor: '', gola: '', vies_gola: '' },
    ],
    summary: {
      aplicacao: null,
      cliente: 'Colégio Ápice',
      data_entrega_confirmada: null,
      nome: null,
    },
  },
  missingFields: [
    'items[0].cor',
    'items[0].gola',
    'artwork',
    'summary.data_entrega_confirmada',
    'finalAmount',
    'paymentCondition',
  ],
};

// The same order once priced by size, every subtotal reviewed (OLIST-43).
const incompletePricedOrder = {
  ...incompleteOrder,
  ficha: {
    ...incompleteOrder.ficha,
    sizePricing: pricedPendingOrder.ficha.sizePricing,
  },
  finalAmountCents: pricedPendingOrder.finalAmountCents,
  pricing: pricedPendingOrder.pricing,
};

test('lists exactly what is missing to generate, point by point, and fills the items in place (PFI-09, PFI-15, PFI-16, PIT-05, PIT-06, TEC-03, EDIT-04, EDIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [incompleteOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  const readiness = closing.locator('#closing-readiness');
  // PFI-19: the amount and the payment method are asked when generating,
  // never listed as missing nor typed in the panel.
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, gola do item 1, quem faz a arte e previsão de entrega. Valor e forma de pagamento você informa ao gerar.',
  );
  await expect(page.getByLabel('Valor final')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Ainda em branco na ficha')).toHaveCount(0);

  // PFI-15: the real progress on top, in the order of the page, with only
  // the next step as a button; the amount and payment method are not steps.
  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const count = progress.getByRole('status');
  await expect(count).toHaveText('0 de 3 prontos');
  await expect(progress.getByRole('listitem')).toHaveText([
    /Previsão de entrega\s*falta: a data combinada/u,
    /Itens\s*falta: cor do item 1 e gola do item 1/u,
    /Arte do pedido\s*falta: quem faz a arte/u,
  ]);
  await expect(progress.getByRole('button')).toHaveText([
    'Informar previsão de entrega',
  ]);
  await expect(progress).toContainText(
    'Valor e forma de pagamento: você informa ao gerar o pedido.',
  );
  // PFI-16: what is filled elsewhere keeps "Gerar pedido" unavailable but
  // focusable; activating it leads to the next step and never confirms.
  const generate = closing.getByRole('button', { name: 'Gerar pedido' });
  await expect(generate).toHaveAttribute('aria-disabled', 'true');
  await generate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const delivery = summary.getByLabel('Previsão de entrega');
  await expect(delivery).toBeFocused();
  expect(writes.filter((call) => call.action === 'confirm')).toHaveLength(0);

  // Saving the delivery moves the progress without reloading the page.
  await delivery.fill('2026-10-24');
  await summary.getByRole('button', { name: 'Salvar resumo' }).click();
  await expect(count).toHaveText('1 de 3 prontos');
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, gola do item 1 e quem faz a arte. Valor e forma de pagamento você informa ao gerar.',
  );

  // EDIT-04: the next step opens no editor; it lands on the first pending
  // field of the items, which saves by itself.
  await progress.getByRole('button', { name: 'Completar itens' }).click();
  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  await expect(colour).toBeFocused();
  await colour.fill('AZUL');
  await colour.press('Enter');
  const collar = items.getByLabel('Gola', { exact: true });
  await collar.fill('GOLA V');
  await collar.press('Enter');
  // EDIT-07: the first write started the subtotals by size, so the items
  // now ask for them instead of the two points.
  await expect(readiness).not.toContainText('do item 1');
  await expect(readiness).toContainText('subtotais por tamanho a revisar');
  await expect(count).toHaveText('1 de 3 prontos');
  for (const [size, amount] of [
    ['M', '3.200,00'],
    ['G', '1.600,00'],
  ]) {
    const subtotal = items.getByLabel(`Subtotal do tamanho ${size}, item 1`);
    await subtotal.fill(amount);
    await subtotal.press('Enter');
  }
  await expect(count).toHaveText('2 de 3 prontos');
  await expect(readiness).toHaveText(/^Falta para gerar: quem faz a arte\./u);

  // ADR 020: the last step sends the seller to who makes the art.
  await progress
    .getByRole('button', { name: 'Marcar quem faz a arte' })
    .click();
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  await expect(artwork.getByLabel('O cliente envia a arte')).toBeFocused();
  await artwork.getByLabel('Sem estampa').check();
  await artwork.getByRole('button', { name: 'Salvar arte' }).click();
  // RFC 024: with nothing missing the progress folds into one line, under
  // the same heading and the same status, without the list of steps.
  await expect(count).toHaveText('Tudo pronto para gerar · 3 de 3');
  await expect(progress.getByRole('listitem')).toHaveCount(0);
  await expect(progress.getByRole('button')).toHaveCount(0);
  await expect(readiness).toHaveText(/^Tudo pronto\./u);
  await expect(generate).not.toHaveAttribute('aria-disabled', /./u);
  // The paid day stays empty: generating means paid until the CRM handles
  // payments.
  await expect(
    page.getByRole('region', { name: 'Datas do pedido' }),
  ).toContainText('Pago em');
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toBeVisible();
  // OLIST-43: priced by size, the dialog reads the total of the subtotals
  // and asks only for the payment method (PFI-19), still unchosen.
  await expect(dialog.getByRole('status')).toHaveText('R$ 4.800,00');
  await expect(
    dialog.getByRole('textbox', { name: 'Valor final' }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  expect(writes.filter((call) => call.action === 'confirm')).toHaveLength(0);
});

test('downloads a confirmed order as PDF from its page', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const print = page.getByRole('button', { name: 'Gerar PDF' });
  await expect(print).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    print.click(),
  ]);
  expect(download.suggestedFilename()).toBe('pedido-05-CRM.pdf');
});

test('offers the generated PDF to the phone share sheet', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => {
    /** @type {any} */ (globalThis).__sharedPdfNames = [];
    Object.defineProperty(globalThis.navigator, 'canShare', {
      configurable: true,
      value: (/** @type {{files: File[]}} */ { files }) =>
        files?.[0]?.type === 'application/pdf',
    });
    Object.defineProperty(globalThis.navigator, 'share', {
      configurable: true,
      value: async (/** @type {{files: File[]}} */ { files }) => {
        /** @type {any} */ (globalThis).__sharedPdfNames.push(files[0].name);
      },
    });
  });
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const share = page.locator('.op-mobile-action').getByRole('button', {
    name: 'Compartilhar PDF',
  });
  await expect(share).toBeVisible();
  await share.click();
  if (
    await page
      .getByText('PDF pronto. Toque em Compartilhar PDF novamente')
      .isVisible()
  ) {
    await share.click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (globalThis).__sharedPdfNames),
    )
    .toEqual(['pedido-05-CRM.pdf']);
});

test('shows the order read-only to whoever does not own the conversation (PAU-01)', async ({
  page,
}) => {
  await mockOrders(page, {
    orders: [
      {
        ...pendingOrder,
        seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
      },
    ],
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByText(
      'Somente Ricardo Lima ou um administrador edita este pedido.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerar pedido' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Reabrir pedido' }),
  ).toHaveCount(0);
  // PFI-15: no progress to generate for whoever cannot generate.
  await expect(
    page.getByRole('region', { name: 'Para gerar o pedido' }),
  ).toHaveCount(0);
});

test('shows no progress to generate on a confirmed order or a store order (PFI-15, LOJ-34)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page, {
    orders: [
      ownConfirmedOrder,
      // A store order is locked even if it ever reads as pending.
      {
        ...incompleteOrder,
        id: 'order-loja',
        origin: 'loja',
      },
    ],
  });
  await page.goto('/pedidos/order-confirmado');
  await expect(
    page.getByRole('heading', { name: 'Pedido 05-CRM' }),
  ).toBeFocused();
  await expect(
    page.getByRole('region', { name: 'Para gerar o pedido' }),
  ).toHaveCount(0);
  await expect(page.locator('.op-mobile-action')).toHaveText('Gerar PDF');

  await page.goto('/pedidos/order-loja');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
  await expect(
    page.getByText('Pedido da loja do site: travado, sem edição.'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Para gerar o pedido' }),
  ).toHaveCount(0);
  await expect(page.locator('.op-mobile-action')).toHaveCount(0);
});

test('names a missing order with the way back to the list', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-inexistente');

  await expect(page.getByText('Pedido não encontrado')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Voltar para Pedidos' }),
  ).toHaveAttribute('href', '/pedidos');
});

test('recovers the order detail after an initial server failure', async ({
  page,
}) => {
  await mockOrders(page, { failDetailOnce: true });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('heading', { name: 'Pedido indisponível' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
});

test('keeps a loaded order visible when its live refresh fails', async ({
  page,
}) => {
  await mockOrders(page);
  let reads = 0;
  await page.route('**/api/v1/orders/order-pendente', async (route) => {
    reads += 1;
    if (reads !== 2) return route.fallback();
    return route.fulfill({
      body: JSON.stringify({ code: 'UNAVAILABLE' }),
      contentType: 'application/problem+json',
      status: 503,
    });
  });
  /** @type {() => void} */
  let sendEvent = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      body: eventStreamBody({
        payload: { orderId: 'order-pendente' },
        type: 'inbox.order.changed',
      }),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.goto('/pedidos/order-pendente');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();

  sendEvent();
  await expect(page.getByRole('alert')).toContainText(
    'Os dados exibidos podem estar desatualizados.',
  );
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(3);
});

test('refreshes the open order when it changes elsewhere', async ({ page }) => {
  let detailCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { conversationId: 'conversation-7', orderId: 'order-pendente' },
      type: 'inbox.order.changed',
    },
    onDetail: () => {
      detailCalls += 1;
    },
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('refreshes the open order when a message delivery changes', async ({
  page,
}) => {
  let detailCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { conversationId: 'conversation-7' },
      type: 'inbox.conversation.changed',
    },
    onDetail: () => {
      detailCalls += 1;
    },
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeVisible();
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('refreshes a pending order when its customer changes in the conversation', async ({
  page,
}) => {
  let detailCalls = 0;
  await mockOrders(page, {
    liveEvent: {
      payload: { contactId: 'contact-7' },
      type: 'inbox.contact.changed',
    },
    onDetail: () => {
      detailCalls += 1;
    },
  });
  await page.goto('/pedidos/order-pendente');
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('reads the order summary and marks the customer as locked (PFI-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  // ADR 020: the technique lives on each item, not in the summary.
  await expect(summary.locator('dt')).toHaveText([
    'Cliente',
    'Previsão de entrega',
    'Total de peças',
    'Nome do pedido',
    'Vendedor',
    'Data do pedido',
    'FAB',
  ]);
  await expect(summary).not.toContainText('SUBLIMAÇÃO TOTAL');
  await expect(summary).toContainText('Colégio Ápice');
  await expect(summary).toContainText('vem da conversa');
  await expect(summary).toContainText('24/10/2026');
  await expect(summary).toContainText('150');
  await expect(summary).toContainText('Marina Aguiar');
  // D14: the number exists from creation; only the date waits for the
  // confirmation, which corrects the supporting text of the mockup.
  await expect(summary).toContainText('definida ao gerar');
  await expect(summary).toContainText(
    'O número do pedido já existe desde a criação',
  );
});

test('does not attribute a manual order customer to a conversation', async ({
  page,
}) => {
  const manualOrder = {
    ...pendingOrder,
    conversationId: null,
    id: 'order-manual',
  };
  await mockOrders(page, { orders: [manualOrder] });
  await page.goto('/pedidos/order-manual');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).toContainText('Colégio Ápice');
  await expect(summary).not.toContainText('vem da conversa');
});

test('edits the summary and saves the whole section at once (PFI-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();

  // D13: the customer comes from the contact and is never typed here.
  await expect(summary.getByLabel('Cliente')).toBeDisabled();
  await expect(
    summary.getByLabel('Previsão de entrega'),
  ).toHaveAccessibleDescription('A data combinada com o cliente.');
  await expect(summary.getByLabel(/Aplicação/u)).toHaveCount(0);
  const name = summary.getByLabel('Nome do pedido');
  await expect(name).toHaveAccessibleDescription(
    'Evento, empresa, time ou turma.',
  );
  await name.fill('Uniforme escolar 2028');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  await expect(summary.getByRole('button', { name: 'Editar' })).toBeVisible();
  await expect(summary).toContainText('Uniforme escolar 2028');
  expect(writes).toHaveLength(1);
  expect(writes[0].section).toBe('summary');
  expect(writes[0].body).toEqual({
    expectedVersion: 2,
    value: {
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2028',
    },
  });
});

test('cancels an edit without writing anything', async ({ page }) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await summary.getByLabel('Nome do pedido').fill('DESCARTAR');
  await summary.getByRole('button', { name: 'Cancelar' }).click();

  await expect(summary).toContainText('Uniforme escolar 2027');
  await expect(summary).not.toContainText('DESCARTAR');
  expect(writes).toHaveLength(0);
});

test('refreshes after leaving an edit saved over an older version', async ({
  page,
}) => {
  let detailCalls = 0;
  await mockOrders(page, {
    onDetail: () => {
      detailCalls += 1;
    },
    writeFailure: { body: { code: 'VERSION_CONFLICT' }, status: 409 },
  });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await summary.getByLabel('Nome do pedido').fill('Uniforme escolar 2028');
  await summary.getByRole('button', { name: 'Salvar' }).click();

  await expect(summary.getByRole('alert')).toContainText(
    'Este pedido mudou. Cancele a edição para ver a versão atual.',
  );
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
});

test('records who makes the art next to an empty file area (TEC-03, ARQ-01)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  await expect(artwork).toContainText('O cliente envia a arte');
  await expect(artwork).not.toContainText('Dropbox');
  await expect(
    artwork.getByRole('button', { name: 'Adicionar arquivos da arte' }),
  ).toBeEnabled();
  await expect(
    artwork.getByRole('button', { name: 'Enviar arte final' }),
  ).toBeEnabled();
  await expect(artwork).toContainText('0 de 5');
  await expect(artwork).toContainText('PNG, JPEG, WebP, GIF, CDR');

  // PFI-20: one control adds files; with none yet, the drop area's button.
  await expect(addFileControls(artwork)).toHaveCount(1);

  await artwork.getByRole('button', { name: 'Editar' }).click();
  const client = artwork.getByLabel('O cliente envia a arte');
  // PFI-20 (ADR 035): the company's name comes from the brand.
  const silmer = artwork.getByLabel(`A ${brand.companyName} cria a arte`);
  const plain = artwork.getByLabel('Sem estampa');
  await expect(client).toBeFocused();
  await expect(client).toBeChecked();
  // "Sem estampa" stands alone; an origin clears it again.
  await plain.check();
  await expect(client).not.toBeChecked();
  await client.check();
  await expect(plain).not.toBeChecked();
  await silmer.check();
  await artwork.getByRole('button', { name: 'Salvar arte' }).click();

  await expect(artwork).toContainText(
    `O cliente envia a arte · A ${brand.companyName} cria a arte`,
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    section: 'artwork',
    body: {
      expectedVersion: 2,
      value: {
        feito_pela_silmer: true,
        feito_pelo_cliente: true,
        sem_estampa: false,
      },
    },
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a seller sends art files and the final art, then removes one by keyboard (ARQ-02, ARQ-04, ARQ-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const uploads = [];
  /** @type {string[]} */
  const removed = [];
  await mockOrders(page, {
    onRemove: (/** @type {string} */ id) => removed.push(id),
    onUpload: (/** @type {any} */ call) => uploads.push(call),
  });
  await page.goto('/pedidos/order-pendente');
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });

  const chooser = page.waitForEvent('filechooser');
  await artwork
    .getByRole('button', { name: 'Adicionar arquivos da arte' })
    .click();
  await (
    await chooser
  ).setFiles([
    { buffer: ONE_PIXEL_PNG, mimeType: 'image/png', name: 'logo-frente.png' },
    {
      buffer: Buffer.from('RIFF\0\0\0\0CDRv synthetic'),
      mimeType: 'application/octet-stream',
      name: 'brasao.cdr',
    },
  ]);

  const files = artwork.getByRole('region', { name: 'Arquivos da arte' });
  await expect(fileTiles(files)).toHaveCount(2);
  await expect(files).toContainText('2 de 5');
  // PFI-20: with files, the grid's last tile is the one control that adds.
  await expect(addFileControls(artwork)).toHaveCount(1);
  await expect(addFileControls(artwork)).toHaveAccessibleName(
    /^Adicionar arquivo 3 vagas/u,
  );
  await expect(files.getByText('CDR', { exact: true })).toBeVisible();
  await expect(
    files.getByRole('link', { name: 'Baixar logo-frente.png' }),
  ).toHaveAttribute(
    'href',
    /\/api\/v1\/orders\/order-pendente\/files\/.+\/content$/u,
  );
  expect(uploads).toEqual([
    { filename: 'logo-frente.png', hasThumbnail: true, slot: 'reference' },
    { filename: 'brasao.cdr', hasThumbnail: false, slot: 'reference' },
  ]);
  await expect(
    page.getByRole('status').filter({ hasText: 'brasao.cdr' }),
  ).toHaveText('“brasao.cdr” enviado.');

  const finalChooser = page.waitForEvent('filechooser');
  await artwork.getByRole('button', { name: 'Enviar arte final' }).click();
  await (
    await finalChooser
  ).setFiles({
    buffer: Buffer.from('%PDF-1.7 synthetic'),
    mimeType: 'application/pdf',
    name: 'arte-final.pdf',
  });
  const finalArt = artwork.getByRole('region', { name: 'Arte final' });
  await expect(finalArt).toContainText('Enviada');
  await expect(finalArt).toContainText('arte-final.pdf');
  await expect(files).toContainText('2 de 5');

  const remove = files.getByRole('button', { name: 'Remover logo-frente.png' });
  await remove.focus();
  await page.keyboard.press('Enter');
  const confirm = files.getByRole('group', {
    name: 'Remover logo-frente.png?',
  });
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await confirm.getByRole('button', { name: 'Remover' }).click();
  await expect(fileTiles(files)).toHaveCount(1);
  await expect(files).toContainText('1 de 5');
  await expect(
    files.getByRole('link', { name: 'Baixar brasao.cdr' }),
  ).toBeFocused();
  await expect(addFileControls(artwork)).toHaveCount(1);
  expect(removed).toHaveLength(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('refuses files over 10 MB, outside the formats or past five (ARQ-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const uploads = [];
  await mockOrders(page, {
    files: {
      'order-pendente': {
        final: null,
        references: [1, 2, 3, 4].map((index) =>
          syntheticFile(`ref-${index}.pdf`, 'reference', index),
        ),
      },
    },
    onUpload: (/** @type {any} */ call) => uploads.push(call),
  });
  await page.goto('/pedidos/order-pendente');
  const files = page.getByRole('region', { name: 'Arquivos da arte' });
  await expect(files).toContainText('4 de 5');

  const chooser = page.waitForEvent('filechooser');
  await files.getByRole('button', { name: 'Adicionar arquivo' }).click();
  await (
    await chooser
  ).setFiles([
    {
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      mimeType: 'image/png',
      name: 'grande.png',
    },
    {
      buffer: Buffer.from('MZ'),
      mimeType: 'application/octet-stream',
      name: 'setup.exe',
    },
    {
      buffer: Buffer.from('%PDF-1.7'),
      mimeType: 'application/pdf',
      name: 'a.pdf',
    },
    {
      buffer: Buffer.from('%PDF-1.7'),
      mimeType: 'application/pdf',
      name: 'b.pdf',
    },
  ]);

  const alerts = files.getByRole('alert');
  await expect(alerts).toHaveCount(3);
  await expect(alerts.nth(0)).toContainText('“grande.png” não foi enviado');
  await expect(alerts.nth(0)).toContainText('o limite é 10 MB');
  await expect(alerts.nth(1)).toContainText('“setup.exe” não foi enviado');
  await expect(alerts.nth(2)).toContainText('“b.pdf” ficou de fora');
  await expect(files).toContainText('5 de 5');
  await expect(files).toContainText('Limite de 5 arquivos atingido');
  // PFI-20: still one control that adds, now disabled for lack of slots.
  await expect(addFileControls(files)).toHaveCount(1);
  await expect(
    files.getByRole('button', { name: 'Adicionar arquivo' }),
  ).toBeDisabled();
  expect(uploads.map((call) => call.filename)).toEqual(['a.pdf']);
  await expect(
    page.getByRole('button', { name: 'Enviar arte final' }),
  ).toBeEnabled();
});

test('a confirmed order only downloads its art files (ARQ-06)', async ({
  page,
}) => {
  await mockOrders(page, {
    files: {
      'order-confirmado': {
        final: syntheticFile('arte-final.cdr', 'final', 9),
        references: [syntheticFile('mockup.png', 'reference', 1)],
      },
    },
  });
  await page.goto('/pedidos/order-confirmado');
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  await expect(artwork).toContainText('arte-final.cdr');
  await expect(
    artwork.getByRole('link', { name: 'Baixar arte final arte-final.cdr' }),
  ).toHaveAttribute(
    'href',
    '/api/v1/orders/order-confirmado/files/file-9/content',
  );
  await expect(
    artwork.getByRole('link', { name: 'Baixar mockup.png' }),
  ).toHaveAttribute('download', '');
  await expect(
    artwork.getByRole('button', {
      name: /Remover|Adicionar|Enviar|Substituir/u,
    }),
  ).toHaveCount(0);
  await expect(artwork).toContainText('Arquivos da arte');
  await expect(artwork.getByText('1', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [390, 1280]) {
  test(`says "Arte do pedido" with one control to add files at ${width}px (PFI-20)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockOrders(page, {
      files: {
        'order-pendente': {
          final: null,
          references: [1, 2].map((index) =>
            syntheticFile(`ref-${index}.pdf`, 'reference', index),
          ),
        },
      },
    });
    await page.goto('/pedidos/order-pendente');

    const artwork = page.getByRole('region', { name: 'Arte do pedido' });
    await expect(
      artwork.getByRole('heading', { level: 2, name: 'Arte do pedido' }),
    ).toBeVisible();
    // PFI-18: on a phone the section is a fold of the accordion; it opens
    // before its content is read.
    if (width < 769) {
      await artwork.getByRole('button', { name: /^Arte do pedido/u }).click();
    }
    // Fixed hints tell the final art from the reference files (ARQ-01, ARQ-04).
    await expect(
      artwork.getByRole('region', { name: 'Arte final' }),
    ).toHaveAccessibleDescription('A versão aprovada que vai para a produção.');
    await expect(
      artwork.getByRole('region', { name: 'Arquivos da arte' }),
    ).toHaveAccessibleDescription(
      /^Referências e rascunhos; não vão para a produção\. Até 5 arquivos/u,
    );

    const add = addFileControls(artwork);
    await expect(add).toHaveCount(1);
    await expect(add).toBeVisible();
    await expect(add).toHaveAccessibleName(/^Adicionar arquivo 3 vagas/u);
    const box = await add.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole('button', { name: 'Enviar arte final' }),
    ).toHaveCSS('min-block-size', width < 640 ? '44px' : '40px');

    await page.getByRole('button', { name: 'Editar arte' }).click();
    await expect(
      artwork.getByLabel(`A ${brand.companyName} cria a arte`),
    ).toBeVisible();
    await expect(artwork.locator('#order-artwork-source-hint')).toHaveText(
      `Obrigatório para gerar. O cliente e a ${brand.companyName} podem ser marcados juntos; “Sem estampa” vale sozinho.`,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test('no order component writes the company name itself (PFI-20, ADR 035)', async () => {
  const sources = new URL('../../apps/edge-web/src/', import.meta.url);
  const files = [
    ...(await readdir(new URL('components/order/', sources)))
      .filter((name) => name.endsWith('.vue'))
      .map((name) => new URL(`components/order/${name}`, sources)),
    new URL('views/OrderView.vue', sources),
  ];
  expect(files.length).toBeGreaterThan(10);
  // Comments may cite the pilot; code and templates take `brand`. Read line by
  // line instead of stripping comments, so no markup is ever rewritten.
  /** @param {string} line */
  const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*|<!--)/u.test(line);
  for (const file of files) {
    const offending = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((line) => line.includes(brand.companyName))
      .filter((line) => !isCommentLine(line));
    expect(offending, file.pathname).toEqual([]);
  }
});

test('requires a technique for each item and asks for it at the field itself (TEC-01, EDIT-04)', async ({
  page,
}) => {
  const withoutTechnique = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], tipo_servico: '' }],
    },
    missingFields: ['items[0].tipo_servico', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, { orders: [withoutTechnique] });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('aplicação do item 1');
  const items = page.getByRole('region', { name: ITEMS });
  const technique = items.getByLabel('Aplicação', { exact: true });
  // EDIT-04 (FieldGap): a pendência is a state of the field, not an error.
  await expect(technique).toHaveAttribute('aria-required', 'true');
  await expect(technique).not.toHaveAttribute('aria-invalid', /./u);
  await expect(technique).toHaveAccessibleDescription(
    /^Silk, DTF, sublimação, bordado… ou Sem estampa\.\s+Falta\s+para gerar o pedido$/u,
  );
  const gaps = items.locator('.op-field-gap');
  await expect(gaps).toHaveText([/^Falta\s+para gerar o pedido$/u]);
  await expect(gaps.locator('svg')).toHaveCount(1);
  await expect(items.getByLabel('Modelo', { exact: true })).not.toHaveAttribute(
    'aria-required',
    /./u,
  );

  await technique.fill('BORDADO');
  await page.keyboard.press('Tab');
  await expect(closing).not.toContainText('aplicação do item 1');
  await expect(technique).toHaveValue('BORDADO');
  await expect(technique).not.toHaveAttribute('aria-required', /./u);
  await expect(gaps).toHaveCount(0);
});

test('keeps garment, colour and collar data from older fichas when one point is saved in place (EDIT-02)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const legacy = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [
        {
          ...pendingOrder.ficha.items[0],
          tipo: '',
          cor: '',
          gola: '',
        },
      ],
    },
  };
  const { orders } = await mockOrders(page, {
    orders: [legacy],
    onWrite: (call) => writes.push(call),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  // FPI-05: the one "Modelo" on the screen is item.tipo, empty here; an
  // older ficha shows its colour and its collar from the keys it has.
  const model = items.getByLabel('Modelo', { exact: true });
  await expect(model).toHaveCount(1);
  await expect(model).toHaveValue('');
  const colour = items.getByLabel('Cor', { exact: true });
  await expect(colour).toHaveValue('BRANCA');
  await expect(items.getByLabel('Gola', { exact: true })).toHaveValue(
    'OLÍMPICA - VERDE',
  );
  // FPI-05: the older model is its own optional field, shown while it has
  // data (PIT-02 as amended by EDIT-05).
  await expect(
    items.getByLabel('Detalhe do modelo', { exact: true }),
  ).toHaveValue('GOLA OLÍMPICA');

  await model.fill('CAMISETA');
  await model.press('Enter');
  await expectSaved(page, writes, 2);
  const groupId = orders[0].ficha.sizePricing[0].id;
  // Only the point typed travelled; nothing else of the item was rewritten.
  expect(sectionWrites(writes)).toEqual([
    command(2, { action: 'initialize' }),
    command(3, {
      action: 'update_group',
      attributes: { tipo: 'CAMISETA' },
      groupId,
    }),
  ]);
  expect(orders[0].ficha.items[0]).toMatchObject({
    cor: '',
    cor_frente: 'BRANCA',
    modelo: 'GOLA OLÍMPICA',
    tipo: 'CAMISETA',
    vies_gola: 'OLÍMPICA - VERDE',
  });
  await expect(
    items.getByRole('heading', { name: 'Item 1 CAMISETA' }),
  ).toBeVisible();

  // The colour the screen reads from the fabric is still missing as `cor`:
  // leaving the field stores what it shows.
  await expect(colour).toHaveAttribute('aria-required', 'true');
  await colour.focus();
  await page.keyboard.press('Tab');
  await expectSaved(page, writes, 3);
  expect(sectionWrites(writes)[2]).toEqual(
    command(4, {
      action: 'update_group',
      attributes: { cor: 'BRANCA' },
      groupId,
    }),
  );
  await expect(colour).not.toHaveAttribute('aria-required', /./u);
});

test('stores the colour an older ficha shows when the seller types it again as it is (EDIT-02, EDIT-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const legacy = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], cor: '' }],
    },
    missingFields: ['items[0].cor', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, {
    orders: [legacy],
    onWrite: (call) => writes.push(call),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  await expect(colour).toHaveValue('BRANCA');
  await expect(colour).toHaveAttribute('aria-required', 'true');
  await colour.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('BRANCA');
  await page.keyboard.press('Tab');
  await expectSaved(page, writes, 2);
  expect(writes[1].body.value).toMatchObject({
    action: 'update_group',
    attributes: { cor: 'BRANCA' },
  });
  await expect(colour).not.toHaveAttribute('aria-required', /./u);
});

test('keeps a confirmed order in reading mode until it is reopened (PFI-10)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [ownConfirmedOrder] });
  await page.goto('/pedidos/order-confirmado');

  // ADR 008: only the trail stays editable, since payment and delivery come
  // after the order is generated.
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(1);
  await expect(
    page
      .getByRole('region', { name: 'Datas do pedido' })
      .getByRole('button', { name: 'Editar' }),
  ).toBeVisible();
});

test('shows the three trail dates without repeating the summary (PLA-01..03, PLA-08)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  await expect(trail).toContainText('2 de 3 datas');
  await expect(trail.getByRole('listitem')).toHaveText([
    /Primeiro contato\s*02\/09\/2026\s*vem da conversa/u,
    /Pago em\s*10\/09\/2026\s*informado/u,
    /Entregue em\s*—\s*a informar/u,
  ]);
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).toContainText('Data do pedido');
  await expect(summary).toContainText('Previsão de entrega');
  await expect(trail).not.toContainText('Pedido fechado');
  await expect(trail).not.toContainText('Previsão de entrega');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('manual orders edit only payment and preserve delivery and first contact (T136, PLA-02, PLA-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [
      {
        ...ownConfirmedOrder,
        conversationId: null,
        manualOwnerId: 'seller-marina',
        origin: 'atendimento',
        firstContactAt: ownConfirmedOrder.createdAt,
        deliveredOn: '2026-09-19',
      },
    ],
  });
  await page.clock.setFixedTime(new Date('2026-09-20T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  await expect(trail.getByRole('listitem').first()).toContainText('08/09/2026');
  await trail.getByRole('button', { name: 'Editar' }).focus();
  await page.keyboard.press('Enter');
  await expect(trail.getByLabel('Pago em')).toBeFocused();
  await expect(trail.locator('input')).toHaveCount(1);
  await expect(trail.getByLabel('Entregue em')).toHaveCount(0);
  await expect(trail.getByLabel('Primeiro contato')).toHaveCount(0);
  await trail.getByLabel('Pago em').fill('2026-09-21');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();
  await expect(trail.getByLabel('Pago em')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(writes).toHaveLength(0);

  await trail.getByLabel('Pago em').fill('');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();
  await expect(trail.getByRole('button', { name: 'Editar' })).toBeVisible();
  expect(writes).toEqual([
    { action: 'milestones', body: { expectedVersion: 4, paidOn: null } },
  ]);
  await expect(trail.getByRole('listitem').first()).toContainText('08/09/2026');
  await expect(trail.getByRole('listitem').last()).toContainText('19/09/2026');
  await expect(page.locator('.op-head .op-status')).toHaveText(/Confirmado/u);
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('records payment and delivery on a confirmed order without reopening it (PLA-04, PLA-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [ownConfirmedOrder],
  });
  await page.clock.setFixedTime(new Date('2026-09-20T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await expect(trail.getByLabel('Pago em')).toBeFocused();
  await expect(trail.getByLabel('Pago em')).toHaveValue('2026-09-10');
  await expect(trail.getByLabel('Entregue em')).toHaveAttribute(
    'max',
    '2026-09-20',
  );
  await trail.getByLabel('Entregue em').fill('2026-09-19');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  await expect(trail.getByRole('button', { name: 'Editar' })).toBeVisible();
  await expect(trail).toContainText('3 de 3 datas');
  await expect(trail.getByRole('listitem').last()).toContainText('19/09/2026');
  expect(writes).toEqual([
    {
      action: 'milestones',
      body: {
        deliveredOn: '2026-09-19',
        expectedVersion: 4,
        paidOn: '2026-09-10',
      },
    },
  ]);
  // The order stays confirmed and printable.
  await expect(page.locator('.op-head .op-status')).toHaveText(/Confirmado/u);
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
});

test('clears a recorded day and refuses a day after today, next to the field (PLA-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [ownConfirmedOrder],
  });
  await page.clock.setFixedTime(new Date('2026-09-20T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');

  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await trail.getByLabel('Entregue em').fill('2026-09-21');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  const delivered = trail.getByLabel('Entregue em');
  await expect(delivered).toHaveAttribute('aria-invalid', 'true');
  await expect(trail.getByRole('alert')).toHaveText('Use uma data até hoje.');
  expect(writes).toHaveLength(0);

  await delivered.fill('');
  await trail.getByLabel('Pago em').fill('');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();
  await expect(trail).toContainText('1 de 3 datas');
  expect(writes.map((write) => write.body)).toEqual([
    { deliveredOn: null, expectedVersion: 4, paidOn: null },
  ]);
});

test('names the day the server refused as invalid', async ({ page }) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'INVALID_DATE', fields: ['paidOn'] },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  await trail.getByRole('button', { name: 'Editar' }).click();
  await trail.getByLabel('Pago em').fill('2026-09-11');
  await trail.getByRole('button', { name: 'Salvar datas' }).click();

  await expect(trail.getByLabel('Pago em')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(trail.getByLabel('Entregue em')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(trail.getByRole('alert')).toHaveText('Use uma data até hoje.');
});

test('reads each item with the seven points in order and the filled extras as text, without a field (PFI-03, PFI-10, PIT-01, PIT-02, EDIT-01)', async ({
  page,
}) => {
  // PAU-01: whoever cannot edit reads the same card as text.
  await mockOrders(page, {
    orders: [{ ...pendingOrder, seller: OTHER_SELLER }],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'read');
  await expect(items).toContainText('1 item · 150 peças');
  const card = items.getByRole('group', {
    exact: true,
    name: 'Item 1 CAMISETA',
  });
  await expect(
    card.getByRole('heading', { level: 3, name: 'Item 1 CAMISETA' }),
  ).toBeVisible();
  await expect(card.locator('.op-item-meta')).toHaveText('150 peças');
  const points = card.locator('dl.op-points');
  // PIT-02 (EDIT-05): no collapsible block; each extra that holds data is
  // one more point, after the seven of the ficha.
  await expect(points.locator(':scope > div > dt')).toHaveText([
    'Modelo',
    'Cor',
    'Quantidade',
    'Aplicação',
    'Modelo de malha',
    'Tamanhos',
    'Gola',
    'Viés da gola',
    'Estampa (referência)',
    'Cor do tecido — frente',
    'Cor do tecido — costas',
    'Cor do tecido — manga direita',
    'Cor do tecido — manga esquerda',
    'Viés das mangas',
    'Detalhe do modelo',
  ]);
  await expect(points.locator(':scope > div > dd')).toHaveText([
    'CAMISETA',
    'BRANCA',
    '150 peças',
    'SUBLIMAÇÃO TOTAL',
    'DRY FIT 100% POLIÉSTER',
    /^M\s*100\s*peças\s*G\s*50\s*peças$/u,
    'GOLA REDONDA',
    'OLÍMPICA - VERDE',
    'Logo · frente',
    'BRANCA',
    'BRANCA',
    'VERDE BANDEIRA',
    'VERDE BANDEIRA',
    'VERDE',
    'GOLA OLÍMPICA',
  ]);
  await expect(
    card
      .getByRole('list', { name: 'Tamanhos do item 1' })
      .getByRole('listitem'),
  ).toHaveText([/^M\s*100\s*peças$/u, /^G\s*50\s*peças$/u]);
  // EDIT-01: reading has no field, no action and no disabled control.
  await expect(items.getByRole('textbox')).toHaveCount(0);
  await expect(items.getByRole('button')).toHaveCount(0);
  await expect(items.locator('input, select, textarea')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('opens every point of a pending item as a field, in the order of the ficha, with no edit mode (PIT-01, PIT-02, EDIT-01, EDIT-05)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'edit');
  await expect(items).toHaveAttribute('data-items-mode', 'initialize');
  const card = items.getByRole('group', {
    exact: true,
    name: 'Item 1 CAMISETA',
  });
  // PIT-01: the principal points first; then each extra that holds data.
  await expect(
    card.locator('.op-specs').locator('label, .op-inline-label'),
  ).toHaveText([
    'Modelo',
    'Cor',
    'Aplicação',
    'Modelo de malha',
    'Gola',
    'Viés da gola',
    'Estampa (referência)',
    'Cor do tecido — frente',
    'Cor do tecido — costas',
    'Cor do tecido — manga direita',
    'Cor do tecido — manga esquerda',
    'Viés das mangas',
    'Detalhe do modelo',
  ]);
  for (const [label, value] of [
    ['Modelo', 'CAMISETA'],
    ['Cor', 'BRANCA'],
    ['Aplicação', 'SUBLIMAÇÃO TOTAL'],
    ['Modelo de malha', 'DRY FIT 100% POLIÉSTER'],
    ['Gola', 'GOLA REDONDA'],
    ['Estampa (referência)', 'Logo · frente'],
  ]) {
    const field = card.getByLabel(label, { exact: true });
    await expect(field).toBeEditable();
    await expect(field).toHaveValue(value);
  }
  // EDIT-05: what holds no data waits behind a button with its name.
  await expect(
    card
      .getByRole('group', { name: 'Adicionais do item 1, não obrigatórios' })
      .getByRole('button'),
  ).toHaveText(['Público', 'Quantidade informada']);
  await expect(
    card.getByRole('list', { name: 'Tamanhos do item 1' }),
  ).toBeVisible();

  // EDIT-01: no edit mode anywhere in the section.
  for (const name of [
    /^Editar itens/u,
    /^Salvar/u,
    'Cancelar',
    /Adicionais \(não obrigatórios\)/u,
    'Usar subtotais por tamanho',
  ]) {
    await expect(items.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(items.locator('.op-editing-tag')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveText([
    'Editar resumo',
    'Editar datas',
    'Editar arte',
    'Editar observações',
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('adds the optional points one by one, by keyboard, and keeps the ones with data (PIT-02, EDIT-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [bareItemOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const adds = items.getByRole('group', {
    name: 'Adicionais do item 1, não obrigatórios',
  });
  await expect(adds.getByRole('button')).toHaveText([
    'Público',
    'Estampa (referência)',
    'Cores por parte',
    'Viés das mangas',
    'Detalhe do modelo',
    'Quantidade informada',
  ]);
  const print = items.getByLabel('Estampa (referência)', { exact: true });
  await expect(print).toHaveCount(0);

  // One button, one field: Enter shows it and puts the focus in it.
  const addPrint = adds.getByRole('button', { name: 'Estampa (referência)' });
  await addPrint.focus();
  await page.keyboard.press('Enter');
  await expect(print).toBeFocused();
  await expect(print).toHaveAccessibleDescription(
    'O que vai estampado e onde, se ajudar a produção.',
  );
  await expect(addPrint).toHaveCount(0);
  // Showing a field is not a change.
  expect(writes).toHaveLength(0);
  await page.keyboard.type('Logo · costas');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 2);
  expect(writes[1].body.value).toMatchObject({
    action: 'update_group',
    attributes: { estampa: 'Logo · costas' },
  });

  // "Cores por parte" brings its four colours, with the focus on the first.
  await adds.getByRole('button', { name: 'Cores por parte' }).focus();
  await page.keyboard.press('Space');
  await expect(
    items.getByLabel('Cor do tecido — frente', { exact: true }),
  ).toBeFocused();
  for (const part of ['costas', 'manga direita', 'manga esquerda']) {
    await expect(
      items.getByLabel(`Cor do tecido — ${part}`, { exact: true }),
    ).toBeVisible();
  }
  // Left empty, an optional sends nothing and is never a pendência.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(items.locator('.op-field-gap')).toHaveCount(0);
  // (This order never started its subtotals: only those fields ask.)
  await expect(
    items.locator('[aria-required="true"]:not([id*="-subtotal-"])'),
  ).toHaveCount(0);

  // On the next visit the one with data is a field and the others are
  // buttons again.
  await page.reload();
  await expect(print).toHaveValue('Logo · costas');
  await expect(adds.getByRole('button')).toHaveText([
    'Público',
    'Cores por parte',
    'Viés das mangas',
    'Detalhe do modelo',
    'Quantidade informada',
  ]);
  expect(writes).toHaveLength(2);
});

test('saves each point of an item by itself, in series, and sends nothing for what did not change (PIT-01, PIT-03, EDIT-02)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  /** @type {[string, string, Record<string, unknown>][]} */
  const typed = [
    ['Modelo', 'REGATA', { tipo: 'REGATA' }],
    ['Cor', 'PRETA', { cor: 'PRETA' }],
    ['Aplicação', 'SILK 4 CORES', { tipo_servico: 'SILK 4 CORES' }],
    ['Modelo de malha', 'ALGODÃO', { malhas: ['ALGODÃO'] }],
    ['Gola', 'REGATA', { gola: 'REGATA' }],
  ];
  // Typed one after the other without waiting: the saves queue up.
  for (const [label, text] of typed) {
    await items.getByLabel(label, { exact: true }).fill(text);
    await page.keyboard.press('Tab');
  }
  await expectSaved(page, writes, 5);
  // EDIT-02: one request per change, each over the version the last left.
  expect(sectionWrites(writes)).toEqual(
    typed.map(([, , attributes], index) =>
      command(2 + index, {
        action: 'update_group',
        attributes,
        groupId: PRICED_GROUP_ID,
      }),
    ),
  );
  await expect(
    items.getByRole('heading', { name: 'Item 1 REGATA' }),
  ).toBeVisible();

  // Enter on a field as it is, and the same text typed again, send nothing.
  const model = items.getByLabel('Modelo', { exact: true });
  await model.press('Enter');
  await model.fill(' REGATA ');
  await model.press('Enter');
  await page.keyboard.press('Tab');

  // PIT-03: a second item is saved half filled and listed as missing.
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  const secondModel = page.locator('#item-1-tipo');
  await expect(secondModel).toBeFocused();
  await secondModel.fill('BONÉ');
  await secondModel.press('Enter');
  const secondTechnique = page.locator('#item-1-aplicacao');
  await secondTechnique.fill('BORDADO');
  await secondTechnique.press('Enter');
  await expectSaved(page, writes, 8);
  const secondId = orders[0].ficha.sizePricing[1].id;
  expect(sectionWrites(writes).slice(5)).toEqual([
    command(7, { action: 'add_group', item: BLANK_ITEM }),
    command(8, {
      action: 'update_group',
      attributes: { tipo: 'BONÉ' },
      groupId: secondId,
    }),
    command(9, {
      action: 'update_group',
      attributes: { tipo_servico: 'BORDADO' },
      groupId: secondId,
    }),
  ]);
  await expect(items.getByRole('heading', { level: 3 })).toHaveText([
    /^Item\s*1\s*REGATA$/u,
    /^Item\s*2\s*BONÉ$/u,
  ]);
  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  for (const point of [
    'cor do item 2',
    'modelo de malha do item 2',
    'tamanhos do item 2',
    'gola do item 2',
  ]) {
    await expect(closing).toContainText(point);
  }
});

test('warns when the sizes differ from what the customer said, without repeating it beside the total (PIT-09, TEC-06)', async ({
  page,
}) => {
  const told = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      serviceData: { ...pendingOrder.ficha.serviceData, quantity: 140 },
    },
  };
  // PFI-10: read by whoever cannot edit, the item without sizes says what
  // the customer told.
  const noSizes = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], grade: [] }],
      serviceData: { quantity: '30 peças' },
    },
    id: 'order-sem-tamanhos',
    missingFields: ['items[0].grade', 'finalAmount', 'paymentCondition'],
    seller: OTHER_SELLER,
    totalPieces: 0,
  };
  await mockOrders(page, { orders: [told, noSizes] });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).not.toContainText('cliente informou');
  await expect(summary).toContainText(
    'A soma dos tamanhos (150) é diferente da quantidade informada (140)',
  );
  // Non-blocking: generating is still only about the points, amount and method.
  await expect(
    page.getByRole('region', { name: 'Fechamento e pagamento' }),
  ).not.toContainText('quantidade informada');

  await page.goto('/pedidos/order-sem-tamanhos');
  const items = page.getByRole('region', { name: ITEMS });
  await expect(items.locator('dl').first()).toContainText(
    '— (cliente informou 30 peças)',
  );
  await expect(summary).not.toContainText('é diferente');
});

test('says what the customer told on an item without sizes while it is edited in place (PIT-09, EDIT-01)', async ({
  page,
}) => {
  const noSizes = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], grade: [] }],
      serviceData: { quantity: '30 peças' },
    },
    missingFields: ['items[0].grade', 'finalAmount', 'paymentCondition'],
    totalPieces: 0,
  };
  await mockOrders(page, { orders: [noSizes] });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'edit');
  await expect(items).toContainText('cliente informou 30 peças');
});

test('names the fields the way the PO asked (PIT-10)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const main = page.locator('main');
  for (const label of ['Modelo', 'Modelo de malha']) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // EDIT-06: edited in place, the sizes are a list named "Tamanhos".
  await expect(
    main.getByRole('list', { name: 'Tamanhos do item 1' }),
  ).toBeVisible();
  // PFI-19: the payment method is named in the dialog "Gerar o pedido".
  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' })
      .getByRole('group', { name: 'Forma de pagamento' }),
  ).toBeVisible();
  // The old names are absent from the page and from the open dialog.
  for (const old of [
    'Condição de pagamento',
    'Grade',
    'Malhas',
    'Ainda em branco na ficha',
    // ADR 020: one name per concept.
    'Tipo de roupa',
    'Tipo de serviço',
    'Técnica da arte (referência)',
    'Definição da gola',
    'Evento / Nome',
    'Pagamento',
    'Entrega realizada',
  ]) {
    await expect(main.getByText(old, { exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const service = page.getByRole('region', { name: 'Dados do atendimento' });
  await page.route('**/api/v1/orders/order-pendente', async (route) => {
    const order = {
      ...pendingOrder,
      ficha: {
        ...pendingOrder.ficha,
        serviceData: { artwork_technique: 'estampada', sizes: '10 de cada' },
      },
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ order }),
    });
  });
  await page.reload();
  await service.getByRole('button', { name: 'Ver' }).click();
  await expect(service.locator('dt')).toHaveText([
    'Técnica informada',
    'Tamanhos informados',
  ]);
});

test('recomputes every total from the sizes, while a quantity is typed and once it is saved (PFI-04, EDIT-02, EDIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
  const subtotal = items.getByLabel('Subtotal do tamanho M, item 1');
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*150 peças · R\$ 4\.800,00$/u,
  );
  // The total follows what is typed, before anything is sent.
  await quantity.fill('120');
  await expect(items.locator('.op-item-total')).toContainText('170 peças');
  expect(writes).toHaveLength(0);

  await quantity.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'change_quantity',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_M,
      quantity: 120,
    }),
  ]);
  // Without every subtotal reviewed there is no amount to show.
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*170 peças$/u,
  );
  await expect(
    page.getByRole('region', { name: 'Resumo do pedido' }),
  ).toContainText('170');

  // EDIT-07 (OLIST-43): the subtotal stays as it was and asks for a look;
  // Enter walked on to it, like a spreadsheet.
  const row = items.locator(`[data-line-id="${PRICED_LINE_M}"]`);
  await expect(row).toContainText('Confira o subtotal.');
  await expect(subtotal).toHaveValue('3.200,00');
  await expect(subtotal).toBeFocused();
  await expect(subtotal).toHaveAttribute('aria-required', 'true');
  await expect(subtotal).not.toHaveAttribute('aria-invalid', /./u);
  await row.getByRole('button', { name: 'Manter R$ 3.200,00' }).click();
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'review_subtotal',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_M,
      subtotalCents: 320000,
    }),
  );
  await expect(row).not.toContainText('Confira o subtotal.');
  await expect(row).toContainText('R$ 26,67 por peça');
  await expect(items.locator('.op-sheet-state')).toHaveText(
    '1 item · 170 peças',
  );
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*170 peças · R\$ 4\.800,00$/u,
  );
});

test('starts the subtotals by size on the first write of an order that never had them (EDIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-mode', 'initialize');
  // The subtotal is there from the first size, with no step to turn it on.
  const subtotal = items.getByLabel('Subtotal do tamanho M, item 1');
  await expect(subtotal).toBeEditable();
  await expect(subtotal).toHaveValue('');
  await expect(
    items.getByRole('button', { name: 'Usar subtotais por tamanho' }),
  ).toHaveCount(0);

  await subtotal.fill('3.200,00');
  await subtotal.press('Enter');
  await expectSaved(page, writes, 2);
  const [group] = orders.find((order) => order.id === 'order-pendente').ficha
    .sizePricing;
  expect(sectionWrites(writes)).toEqual([
    command(2, { action: 'initialize' }),
    command(3, {
      action: 'review_subtotal',
      groupId: group.id,
      lineId: group.lines[0].id,
      subtotalCents: 320000,
    }),
  ]);
  await expect(items).toHaveAttribute('data-items-mode', 'managed');
  // The field in use was not rebuilt: its text stays and Enter walked on.
  await expect(subtotal).toHaveValue('3.200,00');
  await expect(
    items.getByLabel('Quantidade do tamanho G, item 1'),
  ).toBeFocused();

  // The next change is one command; `initialize` is never sent again.
  const second = items.getByLabel('Subtotal do tamanho G, item 1');
  await second.fill('1.600,00');
  await second.press('Enter');
  await expectSaved(page, writes, 3);
  expect(sectionWrites(writes)[2]).toEqual(
    command(4, {
      action: 'review_subtotal',
      groupId: group.id,
      lineId: group.lines[1].id,
      subtotalCents: 160000,
    }),
  );
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*150 peças · R\$ 4\.800,00$/u,
  );
});

test('refuses a quantity that is not a whole piece, on the line, before any request (PFI-04, EDIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const row = items.locator(`[data-line-id="${PRICED_LINE_M}"]`);
  const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
  for (const refused of ['0', '1,5', 'dez']) {
    await quantity.fill(refused);
    await quantity.press('Enter');
    await expect(row.getByRole('alert')).toHaveText(
      'Use uma quantidade inteira maior que zero.',
    );
    await expect(quantity).toHaveAttribute('aria-invalid', 'true');
    await expect(quantity).toHaveAccessibleDescription(
      'Use uma quantidade inteira maior que zero.',
    );
    // What was typed stays, with the focus, to be corrected.
    await expect(quantity).toHaveValue(refused);
    await expect(quantity).toBeFocused();
  }
  await expect(
    items.getByLabel('Quantidade do tamanho G, item 1'),
  ).not.toHaveAttribute('aria-invalid', /./u);
  // Typing again takes the error away.
  await quantity.fill('100');
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(quantity).not.toHaveAttribute('aria-invalid', /./u);
  await quantity.press('Enter');
  expect(writes).toHaveLength(0);
});

test('accepts "Não aplicável" on sleeves and viés with a chip beside the field, and gives the colour back (PFI-07, EDIT-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const sleeve = items.getByLabel('Cor do tecido — manga direita', {
    exact: true,
  });
  const chips = items.getByRole('button', { name: /^Não aplicável: /u });
  // Only sleeves and viés take it.
  await expect(chips).toHaveCount(3);
  const chip = items.getByRole('button', {
    exact: true,
    name: 'Não aplicável: Cor do tecido — manga direita',
  });
  await expect(chip).toHaveText('Não aplicável');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  await chip.focus();
  await page.keyboard.press('Space');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(2, {
      action: 'update_group',
      attributes: { cor_manga_direita: 'NAO APLICAVEL' },
      groupId: PRICED_GROUP_ID,
    }),
  );
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toBeFocused();
  await expect(sleeve).toBeDisabled();
  await expect(sleeve).toHaveValue('Não aplicável');

  // Turned off, the field holds the colour it had.
  await page.keyboard.press('Space');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'update_group',
      attributes: { cor_manga_direita: 'VERDE BANDEIRA' },
      groupId: PRICED_GROUP_ID,
    }),
  );
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(sleeve).toBeEnabled();
  await expect(sleeve).toHaveValue('VERDE BANDEIRA');
});

test('keeps every summary and item field as text typed by hand (PFI-14, EDIT-01)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');
  const lists = page.locator('input[list], datalist, [role="combobox"]');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await expect(summary.getByLabel('Nome do pedido')).toBeEditable();
  await expect(lists).toHaveCount(0);
  await summary.getByRole('button', { name: 'Cancelar' }).click();

  // The items are open as they are: every point is a text field.
  const items = page.getByRole('region', { name: ITEMS });
  for (const label of [
    'Modelo',
    'Cor',
    'Aplicação',
    'Modelo de malha',
    'Gola',
  ]) {
    const field = items.getByLabel(label, { exact: true });
    await expect(field).toBeEditable();
    await expect(field).toHaveAttribute('type', 'text');
  }
  await expect(items.locator('select, input:not([type="text"])')).toHaveCount(
    0,
  );
  await expect(lists).toHaveCount(0);
});

test('adds and removes sizes and fabrics, each as one change (PIT-03, EDIT-02, EDIT-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const size = page.locator('#item-0-new-size');
  await size.fill('GG');
  await size.press('Enter');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(2, {
      action: 'add_line',
      groupId: PRICED_GROUP_ID,
      quantity: 10,
      size: 'GG',
    }),
  );
  await expect(items.locator('.op-item-total')).toContainText('160 peças');
  const addedLine = orders[0].ficha.sizePricing[0].lines[2].id;

  // A second fabric is one more field of the same point.
  await items.getByRole('button', { name: 'Outra malha' }).click();
  const second = items.getByLabel('Modelo de malha 2');
  await expect(second).toBeFocused();
  await second.fill('HELANCA LIGHT');
  await second.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'update_group',
      attributes: { malhas: ['DRY FIT 100% POLIÉSTER', 'HELANCA LIGHT'] },
      groupId: PRICED_GROUP_ID,
    }),
  );
  // Emptied, it is dropped: a fabric is never a blank line (PIT-03).
  await second.fill('');
  await second.press('Enter');
  await expectSaved(page, writes, 3);
  expect(sectionWrites(writes)[2]).toEqual(
    command(4, {
      action: 'update_group',
      attributes: { malhas: ['DRY FIT 100% POLIÉSTER'] },
      groupId: PRICED_GROUP_ID,
    }),
  );

  // Removing a size is one named button; the focus goes to the blank row.
  await items
    .getByRole('button', { name: 'Remover tamanho GG do item 1' })
    .click();
  await expectSaved(page, writes, 4);
  expect(sectionWrites(writes)[3]).toEqual(
    command(5, {
      action: 'remove_line',
      groupId: PRICED_GROUP_ID,
      lineId: addedLine,
    }),
  );
  await expect(size).toBeFocused();
  await expect(items.getByLabel('Tamanho, linha 3 do item 1')).toHaveCount(0);
  await expect(items.locator('.op-item-total')).toContainText('150 peças');
});

test('splits an item by audience with "Duplicar para outro público", by keyboard (ADR 025, PUB-01, PUB-02, PUB-06, EDIT-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const first = items.locator('.op-item').first();
  // PUB-01: the audience is one of four chips, behind its own button.
  await first
    .getByRole('group', { name: 'Adicionais do item 1, não obrigatórios' })
    .getByRole('button', { name: 'Público' })
    .click();
  const audience = first.getByRole('group', { exact: true, name: 'Público' });
  await expect(audience.getByRole('button')).toHaveText([
    'Masculino',
    'Feminino',
    'Infantil',
    'Unissex',
  ]);
  const masculine = audience.getByRole('button', { name: 'Masculino' });
  await expect(masculine).toBeFocused();
  await expect(audience.locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expectSaved(page, writes, 1);
  await expect(masculine).toHaveAttribute('aria-pressed', 'true');

  // PUB-02: the quantity said for the item, only a reference.
  await first
    .getByRole('button', { exact: true, name: 'Quantidade informada' })
    .click();
  const informed = page.locator('#item-0-informada');
  await expect(informed).toBeFocused();
  await expect(informed).toHaveAttribute('inputmode', 'numeric');
  await informed.fill('150');
  await informed.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'update_group',
      attributes: { publico: 'masculino' },
      groupId: PRICED_GROUP_ID,
    }),
    command(3, {
      action: 'update_group',
      attributes: { quantidade_informada: 150 },
      groupId: PRICED_GROUP_ID,
    }),
  ]);
  await expect(
    items.getByRole('heading', { name: 'Item 1 CAMISETA · Masculino' }),
  ).toBeVisible();

  // PUB-06: the copy comes right below, without sizes and without the
  // quantity said; the focus goes to its audience and it is announced.
  await first.getByRole('button', { name: 'Mais ações do item 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    items.getByRole('menuitem', { name: 'Duplicar para outro público' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 3);
  expect(sectionWrites(writes)[2]).toEqual(
    command(4, {
      action: 'add_group',
      item: {
        ...pendingOrder.ficha.items[0],
        grade: [],
        publico: 'masculino',
        quantidade_informada: null,
      },
    }),
  );
  const copyAudience = page.locator('#item-1-publico');
  await expect(copyAudience).toBeFocused();
  await expect(copyAudience).toHaveText('Masculino');
  await expect(copyAudience).toHaveAttribute('aria-pressed', 'true');
  await expect(items.locator('[data-items-announcement]')).toHaveText(
    'Item 2 criado como cópia do item 1.',
  );
  const copy = items.locator('.op-item').nth(1);
  await expect(copy.locator('.op-size-row')).toHaveCount(1);
  await expect(copy.locator('.op-item-meta')).toHaveText('0 peças');
  await expect(page.locator('#item-1-informada')).toHaveCount(0);

  // The seller changes the audience of the copy from where the focus is.
  await page.keyboard.press('Tab');
  await expect(copy.getByRole('button', { name: 'Feminino' })).toBeFocused();
  await page.keyboard.press('Space');
  await expectSaved(page, writes, 4);
  const copyId = orders[0].ficha.sizePricing[1].id;
  expect(sectionWrites(writes)[3]).toEqual(
    command(5, {
      action: 'update_group',
      attributes: { publico: 'feminino' },
      groupId: copyId,
    }),
  );
  await copy
    .getByRole('button', { exact: true, name: 'Quantidade informada' })
    .click();
  await page.locator('#item-1-informada').fill('40');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 5);
  expect(sectionWrites(writes)[4]).toEqual(
    command(6, {
      action: 'update_group',
      attributes: { quantidade_informada: 40 },
      groupId: copyId,
    }),
  );
  await expect(items.getByRole('heading', { level: 3 })).toHaveText([
    /^Item\s*1\s*CAMISETA · Masculino$/u,
    /^Item\s*2\s*CAMISETA · Feminino$/u,
  ]);
  expect(orders[0].ficha.items[1]).toMatchObject({
    grade: [],
    malhas: pendingOrder.ficha.items[0].malhas,
    publico: 'feminino',
    quantidade_informada: 40,
    tipo: 'CAMISETA',
  });
});

test('warns under an item whose sizes differ from the quantity said for it (ADR 025, PUB-02, EDIT-03, EDIT-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await items
    .getByRole('button', { exact: true, name: 'Quantidade informada' })
    .click();
  const informed = items.getByLabel('Quantidade informada', { exact: true });
  await expect(informed).toHaveAccessibleDescription(
    'O que o cliente disse; não entra no total.',
  );
  // Refused next to the field, before any request.
  await informed.fill('0');
  await informed.press('Enter');
  await expect(
    items.getByText('Use um número inteiro de 1 a 100000.'),
  ).toBeVisible();
  await expect(informed).toHaveAttribute('aria-invalid', 'true');
  await expect(informed).toHaveValue('0');
  expect(writes).toHaveLength(0);

  const warning = items.getByText(
    'A soma dos tamanhos (150) é diferente da quantidade informada (200)',
  );
  await informed.fill('200');
  await informed.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(2, {
      action: 'update_group',
      attributes: { quantidade_informada: 200 },
      groupId: PRICED_GROUP_ID,
    }),
  );
  await expect(warning).toBeVisible();
  await expect(informed).not.toHaveAttribute('aria-invalid', /./u);

  // Emptied, it is no quantity at all; the field in use stays on screen.
  await informed.fill('');
  await informed.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1].value.attributes).toEqual({
    quantidade_informada: null,
  });
  await expect(warning).toHaveCount(0);
  await expect(informed).toBeVisible();
});

test('shows a save the server refused on the line that asked for it, with what was typed (EDIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  let refuse = true;
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
    sectionFailure: ({ body }) =>
      refuse && body.value.action === 'change_quantity'
        ? {
            body: {
              code: 'INVALID_GRADE',
              fields: ['items[0].grade[1]'],
              index: 1,
            },
            status: 422,
          }
        : null,
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const row = items.locator(`[data-line-id="${PRICED_LINE_G}"]`);
  const quantity = items.getByLabel('Quantidade do tamanho G, item 1');
  await quantity.fill('7');
  await quantity.press('Enter');

  await expect(row.getByRole('alert')).toContainText(
    'Use uma quantidade inteira maior que zero.',
  );
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await expect(quantity).toHaveAccessibleDescription(
    /Use uma quantidade inteira maior que zero\./u,
  );
  await expect(quantity).toHaveValue('7');
  // Nothing was saved, and the section does not say it was.
  await expect(items.getByRole('status')).toHaveText('');
  expect(orders[0].ficha.sizePricing[0].lines[1].quantity).toBe(50);
  await expect(
    items.getByLabel('Quantidade do tamanho M, item 1'),
  ).not.toHaveAttribute('aria-invalid', /./u);

  // The way out is in the message: the same change, sent again.
  refuse = false;
  await row.getByRole('button', { name: 'Tentar de novo' }).click();
  await expectSaved(page, writes, 2);
  const sent = command(2, {
    action: 'change_quantity',
    groupId: PRICED_GROUP_ID,
    lineId: PRICED_LINE_G,
    quantity: 7,
  });
  expect(sectionWrites(writes)).toEqual([sent, sent]);
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(quantity).not.toHaveAttribute('aria-invalid', /./u);
  await expect(quantity).toHaveValue('7');
});

test('keeps the text of a field whose save failed and does not send what was typed after it (EDIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
    sectionFailure: () => ({ body: { code: 'UNAVAILABLE' }, status: 503 }),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  await colour.fill('PRETA');
  await colour.press('Enter');

  const alert = page.locator('#item-0-cor-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText('Serviço indisponível no momento.');
  await expect(
    alert.getByRole('button', { name: 'Tentar de novo' }),
  ).toBeVisible();
  await expect(colour).toHaveAttribute('aria-invalid', 'true');
  await expect(colour).toHaveAccessibleDescription(
    /Serviço indisponível no momento\./u,
  );
  await expect(colour).toHaveValue('PRETA');
  await expect(items.getByRole('status')).toHaveText('');
  expect(writes).toHaveLength(1);
  // Typing in the field again clears its error.
  await colour.fill('PRETA FOSCA');
  await expect(alert).toHaveCount(0);
  await expect(colour).not.toHaveAttribute('aria-invalid', /./u);
});

test('says the order changed elsewhere at the field and offers "Recarregar pedido" (EDIT-03, PFI-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  await expect(colour).toHaveValue('BRANCA');
  // Someone else wrote the order: the page holds an older version.
  orders[0].ficha.items[0].gola = 'GOLA POLO';
  orders[0].version += 1;

  await colour.fill('PRETA');
  await colour.press('Enter');
  const alert = page.locator('#item-0-cor-error');
  await expect(alert).toContainText('Este pedido mudou em outro lugar.');
  await expect(colour).toHaveAttribute('aria-invalid', 'true');
  await expect(colour).toHaveValue('PRETA');
  // A conflict is not retried over the same version.
  await expect(
    alert.getByRole('button', { name: 'Tentar de novo' }),
  ).toHaveCount(0);
  expect(sectionWrites(writes)).toHaveLength(1);
  expect(sectionWrites(writes)[0].expectedVersion).toBe(2);
  expect(orders[0].ficha.items[0].cor).toBe('BRANCA');

  const reload = alert.getByRole('button', { name: 'Recarregar pedido' });
  await reload.focus();
  await page.keyboard.press('Enter');
  // The order as the server has it; the focus stays at the field.
  await expect(alert).toHaveCount(0);
  await expect(colour).toHaveValue('BRANCA');
  await expect(colour).not.toHaveAttribute('aria-invalid', /./u);
  await expect(items.getByLabel('Gola', { exact: true })).toHaveValue(
    'GOLA POLO',
  );
  await expect(colour).toBeFocused();

  // The next save rides the version that was read.
  await colour.fill('PRETA');
  await colour.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'update_group',
      attributes: { cor: 'PRETA' },
      groupId: PRICED_GROUP_ID,
    }),
  );
});

test('reloads the order after a conflict on a chip, where no blur sends a second write (EDIT-03, PFI-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const first = items.locator('.op-item').first();
  await first
    .getByRole('group', { name: 'Adicionais do item 1, não obrigatórios' })
    .getByRole('button', { name: 'Público' })
    .click();
  const masculine = first
    .getByRole('group', { exact: true, name: 'Público' })
    .getByRole('button', { name: 'Masculino' });
  // Someone else wrote the order: the page holds an older version.
  orders[0].ficha.items[0].gola = 'GOLA POLO';
  orders[0].version += 1;

  await masculine.click();
  const alert = items.getByRole('alert');
  await expect(alert).toContainText('Este pedido mudou em outro lugar.');
  expect(sectionWrites(writes)).toHaveLength(1);
  // A conflict is not retried over the same version.
  await expect(
    alert.getByRole('button', { name: 'Tentar de novo' }),
  ).toHaveCount(0);
  await alert.getByRole('button', { name: 'Recarregar pedido' }).click();
  await expect(alert).toHaveCount(0);
  await expect(items.getByLabel('Gola', { exact: true })).toHaveValue(
    'GOLA POLO',
  );
  await expect(masculine).toHaveAttribute('aria-pressed', 'false');
  expect(sectionWrites(writes)).toHaveLength(1);

  // The next save rides the version that was read.
  await masculine.click();
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'update_group',
      attributes: { publico: 'masculino' },
      groupId: PRICED_GROUP_ID,
    }),
  );
});

test('keeps what is being typed, and the focus, when the order is refreshed from elsewhere (EDIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  /** @type {() => void} */
  let sendEvent = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      body: eventStreamBody({
        payload: { orderId: 'order-pendente' },
        type: 'inbox.order.changed',
      }),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  const collar = items.getByLabel('Gola', { exact: true });
  await colour.fill('PRE');
  orders[0].ficha.items[0].gola = 'GOLA POLO';
  orders[0].version += 1;
  sendEvent();

  await expect(collar).toHaveValue('GOLA POLO');
  await expect(colour).toHaveValue('PRE');
  await expect(colour).toBeFocused();
  expect(writes).toHaveLength(0);
  // What is typed is saved over the version the refresh brought.
  await page.keyboard.type('TA');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(3, {
      action: 'update_group',
      attributes: { cor: 'PRETA' },
      groupId: PRICED_GROUP_ID,
    }),
  );
});

test('reads the items, with the reason, while a section still in the Editar model is open (PFI-06, EDIT-08)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'edit');
  await summary.getByRole('button', { name: 'Editar resumo' }).click();

  // A save here would make "Salvar resumo" lose to a conflict of versions.
  await expect(items).toHaveAttribute('data-items-state', 'blocked');
  await expect(
    items.getByText('Salve ou cancele a edição aberta para alterar os itens.'),
  ).toBeVisible();
  await expect(items.getByRole('textbox')).toHaveCount(0);
  await expect(items.getByRole('button')).toHaveCount(0);
  await expect(items.locator('dl.op-points')).toBeVisible();
  await expect(
    items
      .getByRole('list', { name: 'Tamanhos do item 1' })
      .getByRole('listitem'),
  ).toHaveText([/^M\s*100\s*peças$/u, /^G\s*50\s*peças$/u]);
  // OLIST-43: read, an order priced by size shows what each size was sold for.
  await expect(
    items
      .getByRole('table', { name: 'Tamanhos e subtotais do item 1' })
      .locator('tbody tr'),
  ).toHaveText([/^M\s*100\s*R\$ 3\.200,00$/u, /^G\s*50\s*R\$ 1\.600,00$/u]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect(items).toHaveAttribute('data-items-state', 'edit');
  await expect(
    page.getByText('Salve ou cancele a edição aberta para alterar os itens.'),
  ).toHaveCount(0);
  await expect(items.getByLabel('Modelo', { exact: true })).toBeEditable();
  expect(writes).toHaveLength(0);
});

test('saves the summary opened right after a change to an item, over the version that change left (PFI-06, EDIT-02)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let reached = 0;
  // Registered after the mock, so it runs first and holds the item's save.
  await page.route(
    '**/api/v1/orders/order-pendente/sections/size-pricing',
    async (route) => {
      reached += 1;
      await held;
      await route.fallback();
    },
  );
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: ITEMS });
  await items.getByLabel('Cor', { exact: true }).fill('PRETA');
  // The click takes the focus from the field, which saves, and opens the
  // summary while that save is still on its way.
  await summary.getByRole('button', { name: 'Editar resumo' }).click();
  await expect.poll(() => reached).toBe(1);
  await summary.getByLabel('Nome do pedido').fill('Uniforme escolar 2028');
  release();
  await expect.poll(() => writes.length).toBe(1);
  await summary.getByRole('button', { name: 'Salvar resumo' }).click();

  await expect(
    summary.getByRole('button', { name: 'Editar resumo' }),
  ).toBeVisible();
  await expect(summary.getByRole('alert')).toHaveCount(0);
  await expect(summary).toContainText('Uniforme escolar 2028');
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'update_group',
      attributes: { cor: 'PRETA' },
      groupId: PRICED_GROUP_ID,
    }),
    {
      expectedVersion: 3,
      section: 'summary',
      value: {
        data_entrega_confirmada: '2026-10-24',
        nome: 'Uniforme escolar 2028',
      },
    },
  ]);
  await expect(items.getByLabel('Cor', { exact: true })).toHaveValue('PRETA');
});

test('heads each section with its state in words, "Editar" naming the section and none on the items (PFI-17, EDIT-01, EDIT-07, EDIT-08)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [incompletePricedOrder] });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  const items = page.getByRole('region', { name: ITEMS });
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });

  // The region keeps only the title as its name; the state sits beside it.
  await expect(
    page.getByRole('region', { exact: true, name: ITEMS }),
  ).toHaveCount(1);
  const states = page.locator('main .op-sheet-state');
  await expect(states).toHaveText([
    'Falta previsão de entrega',
    '1 de 3 datas',
    'Falta: cor do item 1 e gola do item 1',
    'Falta marcar quem faz a arte',
    '1 de 5 linhas',
  ]);
  // The tone has an icon besides the colour, and the text says it anyway.
  await expect(items.locator('.op-sheet-state')).toHaveAttribute(
    'data-tone',
    'missing',
  );
  await expect(items.locator('.op-sheet-state svg')).toHaveCount(1);
  await expect(trail.locator('.op-sheet-state')).toHaveAttribute(
    'data-tone',
    'neutral',
  );

  // Verb and object on every button; none says only "Editar". EDIT-01: the
  // section edited in place has none.
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveText([
    'Editar resumo',
    'Editar datas',
    'Editar arte',
    'Editar observações',
  ]);
  await expect(
    page.getByRole('button', { exact: true, name: 'Editar' }),
  ).toHaveCount(0);
  // EDIT-08: its head has the one status region of the section instead,
  // silent until something is saved.
  const status = items.locator('.op-sheet-head').getByRole('status');
  await expect(items.getByRole('status')).toHaveCount(1);
  await expect(status).toHaveText('');

  // The two points are filled where they are asked.
  const colour = items.getByLabel('Cor', { exact: true });
  await colour.fill('AZUL');
  await colour.press('Enter');
  const collar = items.getByLabel('Gola', { exact: true });
  await collar.fill('GOLA V');
  await collar.press('Enter');
  await expect(status).toHaveText('Salvo');
  // EDIT-07 (OLIST-43): a changed attribute asks a human to look at the
  // subtotals again; one button keeps them all.
  await expect(items.locator('.op-sheet-state')).toHaveText(
    /Falta: subtotais por tamanho a revisar/u,
  );
  await expect(items.getByText('Confira o subtotal.')).toHaveCount(2);
  await expect(page.locator('#item-0-keep-all')).toHaveText(
    'Manter os 2 subtotais',
  );
  await page.locator('#item-0-keep-all').click();
  await expect(page.locator('#item-0-keep-all')).toHaveCount(0);
  // Once the items are complete their state counts items and pieces.
  await expect(items.locator('.op-sheet-state')).toHaveText(
    '1 item · 150 peças',
  );
  await expect(items.locator('.op-sheet-state')).toHaveAttribute(
    'data-tone',
    'ok',
  );
  await expect(items.getByText('Confira o subtotal.')).toHaveCount(0);

  // The promised delivery and who makes the art read as done once saved.
  await summary.getByRole('button', { name: 'Editar resumo' }).click();
  await summary.getByLabel('Previsão de entrega').fill('2026-11-20');
  await summary.getByRole('button', { name: 'Salvar resumo' }).click();
  await expect(summary.locator('.op-sheet-state')).toHaveText(
    'Entrega 20/11/2026',
  );
  await artwork.getByRole('button', { name: 'Editar arte' }).click();
  await artwork.getByLabel('O cliente envia a arte').check();
  await artwork.getByRole('button', { name: 'Salvar arte' }).click();
  await expect(artwork.locator('.op-sheet-state')).toHaveText(
    'O cliente envia a arte',
  );
  await expect(observations.locator('.op-sheet-state')).toHaveText(
    '1 de 5 linhas',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('keeps the other "Editar" focusable but unavailable, with the reason, while one section is open (PFI-17, PFI-06, EDIT-08)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  const items = page.getByRole('region', { name: ITEMS });
  // The summary is still in the Editar/Salvar model.
  const editSummary = summary.getByRole('button', { name: 'Editar resumo' });
  await editSummary.focus();
  await page.keyboard.press('Enter');
  const name = summary.getByLabel('Nome do pedido');
  await name.fill('RASCUNHO');

  const others = page.getByRole('button', { name: /^Editar\b/u });
  await expect(others).toHaveText([
    'Editar datas',
    'Editar arte',
    'Editar observações',
  ]);
  for (const other of await others.all()) {
    await expect(other).toHaveAttribute('aria-disabled', 'true');
    await expect(other).toHaveAccessibleDescription(
      'Salve ou cancele a edição aberta.',
    );
  }
  // EDIT-08: the items have no button to wait; they read, with the reason.
  await expect(items).toHaveAttribute('data-items-state', 'blocked');
  await expect(items.getByRole('textbox')).toHaveCount(0);

  // Enter and a click on a waiting button open nothing and keep the draft.
  const editArtwork = artwork.getByRole('button', { name: 'Editar arte' });
  await editArtwork.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await editArtwork.dispatchEvent('click');
  await expect(editArtwork).toBeFocused();
  await expect(artwork.getByRole('checkbox')).toHaveCount(0);
  await expect(name).toHaveValue('RASCUNHO');
  // After the attempt the reason shows on screen, next to the button.
  await expect(
    artwork.getByText('Salve ou cancele a edição aberta.', { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Cancelling frees every "Editar" again, without the reason.
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect(others).toHaveCount(4);
  for (const other of await others.all()) {
    await expect(other).not.toHaveAttribute('aria-disabled', /./u);
    await expect(other).not.toHaveAttribute('aria-describedby', /./u);
  }
  await expect(page.getByText('Salve ou cancele a edição aberta.')).toHaveCount(
    0,
  );
  await expect(items).toHaveAttribute('data-items-state', 'edit');
});

test('takes the next step to the first pending field of the items, by keyboard, wide and on a phone (PFI-15, PFI-16, PFI-17, EDIT-04)', async ({
  page,
}) => {
  const noColour = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [
        {
          ...pendingOrder.ficha.items[0],
          cor: '',
          cor_costas: '',
          cor_frente: '',
        },
      ],
    },
    missingFields: ['items[0].cor', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, { orders: [noColour] });
  await page.goto('/pedidos/order-pendente');

  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const next = progress.getByRole('button', { name: 'Completar itens' });
  await next.focus();
  await page.keyboard.press('Enter');
  const items = page.getByRole('region', { name: ITEMS });
  const colour = items.getByLabel('Cor', { exact: true });
  await expect(colour).toBeFocused();
  await expect(colour).toBeInViewport();
  await expect(colour).toHaveAttribute('aria-required', 'true');
  await expect(colour).toHaveAccessibleDescription(
    /^Falta\s+para gerar o pedido$/u,
  );
  // No editor opened: nothing to save or cancel, and the step is not waiting.
  await expect(items.getByRole('button', { name: /^Salvar/u })).toHaveCount(0);
  await expect(next).not.toHaveAttribute('aria-disabled', /./u);

  // Phone: the fixed footer opens the fold of the items on the same field,
  // and stays where it is.
  await page.setViewportSize({ height: 844, width: 390 });
  const footer = page.locator('.op-mobile-action');
  const step = footer.getByRole('button', { name: 'Completar itens' });
  await step.focus();
  await page.keyboard.press('Enter');
  await expect(colour).toBeFocused();
  await expect(colour).toBeInViewport();
  await expect(
    items.getByRole('button', { name: /^Itens e especificações/u }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(step).toBeVisible();
});

const emptySubtotals = pricedPendingOrder.ficha.sizePricing[0].lines.map(
  (line) => ({ ...line, subtotalCents: null, subtotalReviewed: false }),
);

for (const pending of [
  {
    label: 'an order without items',
    order: {
      ...pendingOrder,
      ficha: { ...pendingOrder.ficha, items: [] },
      missingFields: ['items', 'finalAmount', 'paymentCondition'],
      totalPieces: 0,
    },
    target: '#order-items-add',
  },
  {
    label: 'a missing fabric',
    order: {
      ...pendingOrder,
      ficha: {
        ...pendingOrder.ficha,
        items: [{ ...pendingOrder.ficha.items[0], malhas: [] }],
      },
      missingFields: ['items[0].malhas', 'finalAmount', 'paymentCondition'],
    },
    required: true,
    target: '#item-0-malha-0',
  },
  {
    label: 'an item without sizes',
    order: {
      ...pendingOrder,
      ficha: {
        ...pendingOrder.ficha,
        items: [{ ...pendingOrder.ficha.items[0], grade: [] }],
      },
      missingFields: ['items[0].grade', 'finalAmount', 'paymentCondition'],
      totalPieces: 0,
    },
    required: true,
    target: '#item-0-new-size',
  },
  {
    label: 'a size without its subtotal',
    order: {
      ...pricedPendingOrder,
      ficha: {
        ...pricedPendingOrder.ficha,
        sizePricing: [
          {
            id: PRICED_GROUP_ID,
            lines: [
              pricedPendingOrder.ficha.sizePricing[0].lines[0],
              emptySubtotals[1],
            ],
          },
        ],
      },
      finalAmountCents: null,
      missingFields: [
        'finalAmount',
        'paymentCondition',
        `sizePricing.${PRICED_GROUP_ID}.${PRICED_LINE_G}`,
      ],
      pricing: {
        complete: false,
        groups: [{ id: PRICED_GROUP_ID, subtotalCents: null }],
        issues: [
          {
            code: 'SIZE_SUBTOTAL_REQUIRED',
            groupId: PRICED_GROUP_ID,
            lineId: PRICED_LINE_G,
          },
        ],
        totalCents: null,
      },
    },
    required: true,
    target: '#item-0-subtotal-1',
  },
  {
    // What the server lists for an order that never started its subtotals.
    label: 'subtotals never started',
    order: {
      ...pendingOrder,
      missingFields: ['finalAmount', 'paymentCondition', 'sizePricing'],
    },
    required: true,
    target: '#item-0-subtotal-0',
  },
]) {
  test(`"Completar itens" lands on the control that fills the first pendência: ${pending.label} (PFI-15, EDIT-04)`, async ({
    page,
  }) => {
    /** @type {any[]} */
    const writes = [];
    await mockOrders(page, {
      onWrite: (call) => writes.push(call),
      orders: [pending.order],
    });
    await page.goto('/pedidos/order-pendente');

    await page
      .getByRole('region', { name: 'Para gerar o pedido' })
      .getByRole('button', { name: 'Completar itens' })
      .click();
    const target = page.locator(pending.target);
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
    if (pending.required) {
      await expect(target).toHaveAttribute('aria-required', 'true');
      await expect(target).not.toHaveAttribute('aria-invalid', /./u);
    }
    // Going there changes nothing.
    expect(writes).toHaveLength(0);
  });
}

test('marks every pending point at its field as "Falta", never as an error, in the words of the head (EDIT-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  const gaps = {
    ...pricedPendingOrder,
    ficha: {
      ...pricedPendingOrder.ficha,
      items: [
        {
          ...pendingOrder.ficha.items[0],
          cor: '',
          cor_costas: '',
          cor_frente: '',
          gola: '',
          malhas: [],
          tipo: '',
          tipo_servico: '',
          vies_gola: '',
        },
      ],
    },
    missingFields: [
      'items[0].tipo',
      'items[0].cor',
      'items[0].tipo_servico',
      'items[0].malhas',
      'items[0].gola',
      'paymentCondition',
    ],
  };
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [gaps],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const principal = ['Modelo', 'Cor', 'Aplicação', 'Modelo de malha', 'Gola'];
  for (const label of principal) {
    const field = items.getByLabel(label, { exact: true });
    await expect(field).toHaveAttribute('aria-required', 'true');
    await expect(field).not.toHaveAttribute('aria-invalid', /./u);
    await expect(field).toHaveAccessibleDescription(
      /Falta\s+para gerar o pedido$/u,
    );
  }
  const badges = items.locator('.op-field-gap');
  await expect(badges).toHaveCount(5);
  for (const badge of await badges.all()) {
    await expect(badge).toHaveText(/^Falta\s+para gerar o pedido$/u);
    await expect(badge.locator('svg')).toHaveCount(1);
  }
  // An optional point is never a pendência.
  await expect(
    items.getByLabel('Estampa (referência)', { exact: true }),
  ).not.toHaveAttribute('aria-required', /./u);
  await expect(items.locator('[aria-invalid]')).toHaveCount(0);
  await expect(items.getByRole('alert')).toHaveCount(0);

  // The head and the progress read the same list, in the same words.
  await expect(items.locator('.op-sheet-state')).toHaveText(
    'Falta: modelo do item 1, cor do item 1 e mais 3 pontos',
  );
  await expect(
    page
      .getByRole('region', { name: 'Para gerar o pedido' })
      .locator('li[aria-current="step"]'),
  ).toContainText('falta: modelo do item 1, cor do item 1 e mais 3 pontos');

  // The mark leaves with the pendência, as soon as the point is saved.
  const model = items.getByLabel('Modelo', { exact: true });
  await model.fill('CAMISETA');
  await model.press('Enter');
  await expectSaved(page, writes, 1);
  await expect(model).not.toHaveAttribute('aria-required', /./u);
  await expect(badges).toHaveCount(4);
});

test('names the subtotals to review once, however many sizes lack one (PFI-15, EDIT-04)', async ({
  page,
}) => {
  await mockOrders(page, {
    orders: [
      {
        ...pricedPendingOrder,
        ficha: {
          ...pricedPendingOrder.ficha,
          sizePricing: [{ id: PRICED_GROUP_ID, lines: emptySubtotals }],
        },
        finalAmountCents: null,
        missingFields: [
          'finalAmount',
          'paymentCondition',
          `sizePricing.${PRICED_GROUP_ID}.${PRICED_LINE_M}`,
          `sizePricing.${PRICED_GROUP_ID}.${PRICED_LINE_G}`,
        ],
        pricing: {
          complete: false,
          groups: [{ id: PRICED_GROUP_ID, subtotalCents: null }],
          issues: [],
          totalCents: null,
        },
      },
    ],
  });
  await page.goto('/pedidos/order-pendente');

  await expect(
    page.getByRole('region', { name: ITEMS }).locator('.op-sheet-state'),
  ).toHaveText('Falta: subtotais por tamanho a revisar');
  await expect(page.locator('#closing-readiness')).toHaveText(
    /^Falta para gerar: subtotais por tamanho a revisar\./u,
  );
});

test('counts a blocker the screen does not know as a step that leads to the closing panel (PFI-15)', async ({
  page,
}) => {
  const newer = {
    ...pendingOrder,
    missingFields: ['summary.futuro', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, { orders: [newer] });
  await page.goto('/pedidos/order-pendente');

  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  // Never "3 de 3" while the server still refuses to generate.
  await expect(progress.getByRole('status')).toHaveText('3 de 4 prontos');
  await expect(progress.locator('li[aria-current="step"]')).toHaveText(
    /Outras pendências\s*falta: summary\.futuro/u,
  );
  const review = progress.getByRole('button', { name: 'Revisar pendências' });
  await review.focus();
  await page.keyboard.press('Enter');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(
    closing.getByRole('heading', { name: 'Fechamento e pagamento' }),
  ).toBeFocused();
  await expect(closing.locator('#closing-readiness')).toContainText(
    'summary.futuro',
  );
  // No section opened for a blocker no section fills.
  await expect(page.locator('main .op-editing-tag')).toHaveCount(0);
  await expect(
    closing.getByRole('button', { name: 'Gerar pedido' }),
  ).toHaveAttribute('aria-disabled', 'true');

  // Phone: the footer names the same step, as step 4 of 4.
  await page.setViewportSize({ height: 844, width: 390 });
  const footer = page.locator('.op-mobile-action');
  await expect(footer).toContainText('Passo 4 de 4 para gerar');
  await expect(
    footer.getByRole('button', { name: 'Revisar pendências' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('keeps the section heads readable and their buttons thumb sized, light and dark (PFI-17)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [incompleteOrder] });
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    // The app ignores the system scheme: the theme is the saved choice that
    // index.html puts on <html data-theme> before the bundle loads.
    await page.addInitScript((value) => {
      globalThis.localStorage.setItem('silmer-theme', value);
    }, theme);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/pedidos/order-pendente');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // PFI-18: on a phone every head is a thumb-sized button and only the
    // open section shows its "Editar".
    const heads = page.locator('main h2 button[aria-expanded]');
    await expect(heads).toHaveCount(6);
    for (const head of await heads.all()) {
      const box = await head.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const edits = page.getByRole('button', { name: /^Editar\b/u });
    await expect(edits).toHaveText(['Editar resumo']);
    for (const edit of await edits.all()) {
      const box = await edit.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // Something open, so the waiting heads are checked too.
    const observations = page.getByRole('region', {
      name: 'Observações do pedido',
    });
    await observations
      .getByRole('button', { name: /^Observações do pedido/u })
      .click();
    const editObservations = observations.getByRole('button', {
      name: 'Editar observações',
    });
    expect(
      (await editObservations.boundingBox())?.height ?? 0,
    ).toBeGreaterThanOrEqual(44);
    await editObservations.click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.setViewportSize({ height: 800, width: 1280 });
    // On a wide screen every "Editar" is back but the one in edit (the items
    // have none, EDIT-01), and the edit is still open.
    await expect(edits).toHaveCount(3);
    await expect(observations.getByText('Editando')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test('folds the sections into an accordion on a phone, by keyboard, with the state in each head (PFI-18, EDIT-01)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page, { orders: [incompleteOrder] });
  await page.goto('/pedidos/order-pendente');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();

  // Every section has one head button, in the order of the ficha, whose
  // name starts with the title and carries the state in words.
  const heads = page.locator('main h2 button[aria-expanded]');
  await expect(heads).toHaveCount(6);
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const summaryHead = summary.getByRole('button', {
    name: /^Resumo do pedido/u,
  });
  const trailHead = trail.getByRole('button', { name: /^Datas do pedido/u });
  const itemsHead = items.getByRole('button', {
    name: /^Itens e especificações/u,
  });
  await expect(summaryHead).toHaveAccessibleName(
    /^Resumo do pedido\s*,\s*Falta previsão de entrega$/u,
  );
  await expect(itemsHead).toHaveAccessibleName(
    /^Itens e especificações\s*,\s*Falta: cor do item 1 e gola do item 1$/u,
  );
  await expect(
    page.getByRole('button', {
      name: /^Dados do atendimento\s*,\s*4 dados · não sai na ficha$/u,
    }),
  ).toHaveCount(1);
  // The region keeps only the title as its name.
  await expect(
    page.getByRole('region', { exact: true, name: 'Itens e especificações' }),
  ).toHaveCount(1);

  // The first missing step (the promised delivery) opens with the page; the
  // other folds are closed and their bodies hidden.
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  await expect(summaryHead).toHaveAttribute(
    'aria-controls',
    'order-summary-body',
  );
  await expect(page.locator('#order-summary-body')).toBeVisible();
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(itemsHead).toHaveAttribute('aria-controls', 'order-items-body');
  await expect(page.locator('#order-items-body')).toBeHidden();
  await expect(
    page.locator('main h2 button[aria-expanded="true"]'),
  ).toHaveCount(1);
  // One "Editar" on screen, the open section's, and one primary.
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveText([
    'Editar resumo',
  ]);
  await expect(page.locator('main button.primary:visible')).toHaveCount(1);

  // Tab walks the closed heads in order.
  await trailHead.focus();
  for (const title of [
    /^Itens e especificações/u,
    /^Arte do pedido/u,
    /^Observações do pedido/u,
    /^Dados do atendimento/u,
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: title })).toBeFocused();
  }

  // Enter opens a fold, closes the other and keeps the focus on the head;
  // the hash names the open section.
  await itemsHead.focus();
  await page.keyboard.press('Enter');
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'true');
  await expect(itemsHead).toBeFocused();
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#order-items-body')).toBeVisible();
  await expect(page.locator('#order-summary-body')).toBeHidden();
  await expect(page).toHaveURL(/\/pedidos\/order-pendente#itens$/u);
  // EDIT-01: the open fold has no "Editar"; it shows the fields themselves.
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveCount(0);
  await expect(items.getByLabel('Modelo', { exact: true })).toBeEditable();
  await expect(items.getByLabel('Cor', { exact: true })).toHaveAttribute(
    'aria-required',
    'true',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Space closes it again, and opens it back.
  await page.keyboard.press('Space');
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(itemsHead).toBeFocused();
  await expect(
    page.locator('main h2 button[aria-expanded="true"]'),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/pedidos\/order-pendente$/u);
  await page.keyboard.press('Space');
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'true');

  // The hash is how the page resumes: a reload opens the same section.
  await page.reload();
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'true');
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'false');
});

test('opens the section of the hash and of the next step, and never folds a section in its Editar model (PFI-18, EDIT-08)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [incompleteOrder],
  });
  await page.goto('/pedidos/order-pendente#observacoes');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  const summaryHead = summary.getByRole('button', {
    name: /^Resumo do pedido/u,
  });
  const itemsHead = items.getByRole('button', {
    name: /^Itens e especificações/u,
  });
  const observationsHead = observations.getByRole('button', {
    name: /^Observações do pedido/u,
  });
  // The hash wins over the next step, and the section comes into view.
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();
  await expect(observationsHead).toHaveAttribute('aria-expanded', 'true');
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'false');
  await expect(observationsHead).toBeInViewport();
  await expect(observations.getByRole('listitem')).toHaveText([
    'Separar os itens por tamanho.',
  ]);

  // The next step in the footer opens its section and its editor.
  const footer = page.locator('.op-mobile-action');
  await footer
    .getByRole('button', { name: 'Informar previsão de entrega' })
    .focus();
  await page.keyboard.press('Enter');
  const delivery = summary.getByLabel('Previsão de entrega');
  await expect(delivery).toBeFocused();
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  await expect(observationsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(summaryHead).toBeInViewport();
  await expect(page).toHaveURL(/\/pedidos\/order-pendente#resumo$/u);
  await delivery.fill('2026-11-20');

  // While the summary is in edit every head waits, its own included: no
  // other fold opens and the edit never folds.
  for (const head of await page
    .locator('main h2 button[aria-expanded]')
    .all()) {
    await expect(head).toHaveAttribute('aria-disabled', 'true');
    await expect(head).toHaveAccessibleDescription(
      'Salve ou cancele a edição aberta.',
    );
  }
  await itemsHead.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await itemsHead.dispatchEvent('click');
  await expect(itemsHead).toBeFocused();
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(
    items.getByText('Salve ou cancele a edição aberta.', { exact: true }),
  ).toBeVisible();
  await summaryHead.focus();
  await page.keyboard.press('Enter');
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  await expect(delivery).toHaveValue('2026-11-20');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The draft survives the window going wide and back.
  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(page.locator('main h2 button')).toHaveCount(0);
  await expect(delivery).toHaveValue('2026-11-20');
  // EDIT-08: the items wait in reading, with the reason, and no button.
  await expect(items).toHaveAttribute('data-items-state', 'blocked');
  await expect(
    items.getByText('Salve ou cancele a edição aberta para alterar os itens.'),
  ).toBeVisible();
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(delivery).toHaveValue('2026-11-20');
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  expect(writes).toHaveLength(0);

  // Cancelling frees the heads again.
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect(itemsHead).not.toHaveAttribute('aria-disabled', /./u);
  await expect(page.getByText('Salve ou cancele a edição aberta.')).toHaveCount(
    0,
  );
});

test('folds the items like any other section: nothing typed holds them open (PFI-18, EDIT-01)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await page.setViewportSize({ height: 844, width: 390 });
  const { orders } = await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente#itens');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: ITEMS });
  const summaryHead = summary.getByRole('button', {
    name: /^Resumo do pedido/u,
  });
  const itemsHead = items.getByRole('button', {
    name: /^Itens e especificações/u,
  });
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'true');
  const model = items.getByLabel('Modelo', { exact: true });
  await model.fill('REGATA');
  // There is no draft of the section, so no head waits for a Salvar.
  for (const head of await page
    .locator('main h2 button[aria-expanded]')
    .all()) {
    await expect(head).not.toHaveAttribute('aria-disabled', /./u);
  }
  const footer = page.locator('.op-mobile-action');
  await expect(footer).toBeVisible();

  // Another head opens its section and closes the items; leaving the field
  // saved what was typed.
  await summaryHead.click();
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  await expect(itemsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#order-items-body')).toBeHidden();
  await expect.poll(() => orders[0].ficha.items[0].tipo).toBe('REGATA');
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'update_group',
      attributes: { tipo: 'REGATA' },
      groupId: PRICED_GROUP_ID,
    }),
  ]);
  await expect(footer).toBeVisible();

  await itemsHead.click();
  await expect(model).toHaveValue('REGATA');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('keeps a confirmed order and a store order coherent in the accordion (PFI-18, PFI-10, LOJ-07)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page, {
    orders: [
      ownConfirmedOrder,
      { ...incompleteOrder, id: 'order-loja', origin: 'loja' },
    ],
  });
  await page.goto('/pedidos/order-confirmado');

  // Nothing is missing on a confirmed order: the summary opens, read only.
  const summaryHead = page.getByRole('button', { name: /^Resumo do pedido/u });
  await expect(summaryHead).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('main h2 button[aria-expanded]')).toHaveCount(6);
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveCount(0);
  // PLA-04: only the dates are written after the order is generated.
  await page.getByRole('button', { name: /^Datas do pedido/u }).click();
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveText([
    'Editar datas',
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // LOJ-07: a store order has no "Editar" and no fold to open.
  await page.goto('/pedidos/order-loja');
  await expect(
    page.getByText('Pedido da loja do site: travado, sem edição.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveCount(0);
  await expect(page.locator('main h2 button[aria-expanded]')).toHaveCount(0);
});

test('keeps every section open and the heads plain on a wide screen (PFI-18)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await mockOrders(page, { orders: [incompleteOrder] });
  await page.goto('/pedidos/order-pendente#itens');

  // No accordion: no head button, no aria-expanded on a heading, every
  // body on screen and every "Editar" in place (EDIT-01: none on the items).
  await expect(page.locator('main h2 button')).toHaveCount(0);
  await expect(page.locator('main h2 [aria-expanded]')).toHaveCount(0);
  for (const body of [
    '#order-summary-body',
    '#order-milestones-body',
    '#order-items-body',
    '#order-artwork-body',
    '#order-observations-body',
  ]) {
    await expect(page.locator(body)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveCount(4);
  await expect(page.getByRole('region', { name: ITEMS })).toHaveAttribute(
    'data-items-state',
    'edit',
  );
  await expect(page.locator('main .op-sheet-state')).toHaveCount(5);
  // "Dados do atendimento" keeps its own "Ver" on a wide screen.
  await expect(
    page
      .getByRole('region', { name: 'Dados do atendimento' })
      .getByRole('button', { name: 'Ver' }),
  ).toHaveAttribute('aria-expanded', 'false');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('edits the observations and stops at five lines (PFI-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  await expect(observations).toContainText('1 de 5 linhas');
  await expect(observations.getByRole('listitem')).toHaveText([
    'Separar os itens por tamanho.',
  ]);

  await observations.getByRole('button', { name: 'Editar' }).click();
  const addLine = observations.getByRole('button', {
    name: 'Adicionar observação',
  });
  for (let line = 2; line <= 5; line += 1) {
    await addLine.click();
    await observations.getByLabel(`Observação ${line}`).fill(`Linha ${line}`);
  }
  await expect(addLine).toBeDisabled();

  await observations.getByRole('button', { name: 'Salvar' }).click();
  await expect(observations).toContainText('5 de 5 linhas');
  expect(writes[0].section).toBe('observations');
  expect(writes[0].body.value).toHaveLength(5);
});

test('drops a blank observation instead of storing an empty line', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  await observations.getByRole('button', { name: 'Editar' }).click();
  await observations
    .getByRole('button', { name: 'Adicionar observação' })
    .click();
  await observations.getByRole('button', { name: 'Salvar' }).click();

  expect(writes[0].body.value).toEqual(['Separar os itens por tamanho.']);
});

test('leaves production to the printed ficha and shows service data as not printed (PFI-08, PFI-20)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  // PFI-20: the production control is filled by hand on page 2 of the
  // printed ficha; the page has no block, nor a button, for it.
  await expect(page.locator('main')).toContainText('Dados do atendimento');
  await expect(
    page.getByRole('region', { name: 'Controle de produção' }),
  ).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(
    /controle de produção/iu,
  );

  const service = page.getByRole('region', { name: 'Dados do atendimento' });
  await expect(service).toContainText('não saem na ficha impressa');
  await service.getByRole('button', { name: 'Ver' }).click();
  await expect(service).toContainText('Arte');
  await expect(service).toContainText('Arte recebida do cliente');
  await expect(service).toContainText('Salvador/BA');
  await expect(service).toContainText('Uso próprio');
  await expect(service.getByRole('button', { name: 'Editar' })).toHaveCount(0);

  // The ficha card of a generated order still says it prints the control.
  await page.goto('/pedidos/order-confirmado');
  await expect(
    page.getByRole('region', { name: 'Fechamento e pagamento' }),
  ).toContainText('2 páginas · pedido e controle de produção');
  await expect(
    page.getByRole('region', { name: 'Controle de produção' }),
  ).toHaveCount(0);
});

test('keeps the sections in the order of the printed ficha (PFI-01, PLA-01)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  // PFI-15: the progress to generate comes before the sections of the ficha.
  // PFI-20: the ficha's order, in the words of the screen; the production
  // control stays on the printed ficha only.
  await expect(page.locator('main h2')).toHaveText([
    'Para gerar o pedido',
    'Resumo do pedido',
    'Datas do pedido',
    'Itens e especificações',
    'Arte do pedido',
    'Observações do pedido',
    'Dados do atendimento',
    'Fechamento e pagamento',
  ]);
});

test('confirms the order, frees printing, reopens it and locks printing again', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('pedido pendente');
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeDisabled();

  // PFI-19: "Gerar pedido" opens the review with the amount and the method.
  const generate = closing.getByRole('button', { name: 'Gerar pedido' });
  await generate.click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  const review = dialog.locator('dl');
  await expect(review).toContainText('Colégio Ápice');
  await expect(review).toContainText('1 item · 150 peças');
  await expect(review).toContainText('24/10/2026');
  await expect(review).toContainText('O cliente envia a arte');
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(
    closing.getByRole('heading', { name: 'Fechamento e pagamento' }),
  ).toBeFocused();
  await expect(closing).toContainText('Pedido confirmado e ficha gerada.');
  await expect(closing).toContainText('R$ 4.820,00');
  await expect(closing).toContainText('Pix');
  await expect(closing).toContainText('Confirmado por Marina Aguiar');
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
  await expect(
    page.getByText('Disponível depois de gerar o pedido'),
  ).toHaveCount(0);
  expect(writes[0].action).toBe('confirm');
  expect(writes[0].body).toEqual({
    amountText: '4.820,00',
    expectedVersion: 2,
    paymentCondition: 'pix',
  });

  // Pesquisa UX 2026-10-15, achado 6: reopening asks first and says what
  // happens to the print; backing out changes nothing.
  const reopenButton = closing.getByRole('button', { name: 'Reabrir pedido' });
  await reopenButton.click();
  const reopenDialog = page.getByRole('dialog', {
    name: 'Reabrir o pedido 07-CRM?',
  });
  await expect(reopenDialog).toContainText(
    'a ficha deixa de poder ser impressa',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(reopenDialog).toHaveCount(0);
  await expect(reopenButton).toBeFocused();
  await reopenButton.click();
  await reopenDialog.getByRole('button', { name: 'Manter confirmado' }).click();
  await expect(reopenDialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();

  await reopenButton.click();
  await reopenDialog
    .getByRole('button', { name: 'Reabrir pedido 07-CRM' })
    .click();
  await expect(reopenDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeDisabled();
  await expect(closing).toContainText('pedido pendente');
  expect(writes[1].action).toBe('reopen');
  await expect(
    closing.getByRole('heading', { name: 'Fechamento e pagamento' }),
  ).toBeFocused();
  const toast = page.locator('.notice-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Pedido 07-CRM reaberto.');
  await toast.getByRole('button', { name: 'Fechar aviso' }).click();
  await expect(toast).toHaveCount(0);

  // PCL-07: the amount and the condition survive the reopen; the dialog
  // comes back filled, and backing out writes nothing.
  await generate.click();
  await expect(dialog.getByLabel('Valor final')).toHaveValue('4.820,00');
  await expect(dialog.getByLabel('Pix')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(generate).toBeFocused();
  expect(writes).toHaveLength(2);
});

test('refuses a malformed amount next to the field, before the request', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  // PFI-19: the field lives in the dialog, which stays open with the error.
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  const amount = dialog.getByLabel('Valor final');
  await dialog.getByLabel('Pix').check();
  for (const malformed of ['4,820', '4,820.00']) {
    await amount.fill(malformed);
    await dialog
      .getByRole('button', { name: 'Confirmar e gerar ficha' })
      .click();
    await expect(dialog).toContainText('Use o formato 4.820,00.');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(amount).toHaveAccessibleDescription('Use o formato 4.820,00.');
    await expect(amount).toBeFocused();
    await expect(dialog).toBeVisible();
  }
  expect(writes).toHaveLength(0);
});

test('asks for the payment method in the dialog, before the request (PFI-12, PFI-19)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await dialog.getByLabel('Valor final').fill('4820');
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();
  await expect(dialog).toContainText('Escolha a forma de pagamento.');
  // Formatted on leaving the field (PFI-11).
  await expect(dialog.getByLabel('Valor final')).toHaveValue('4.820,00');
  await expect(dialog.getByLabel('Pix')).toBeFocused();
  expect(writes).toHaveLength(0);

  // Picking one clears the warning; the request goes once.
  await page.keyboard.press('Space');
  await expect(dialog).not.toContainText('Escolha a forma de pagamento.');
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({
    amountText: '4.820,00',
    expectedVersion: 2,
    paymentCondition: 'pix',
  });
});

test('names each blocker the server refused the confirmation with', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: {
      body: {
        code: 'ORDER_NOT_CONFIRMABLE',
        fields: [
          'items[0].cor',
          'items[0].gola',
          'artwork',
          'paymentCondition',
        ],
      },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  // PFI-19: blockers outside the dialog close it; the panel names them all.
  await expect(dialog).toHaveCount(0);
  await expect(closing).toContainText('Escolha a forma de pagamento.');
  await expect(closing).toContainText(
    'Complete os itens antes de gerar: cor do item 1 e gola do item 1.',
  );
  await expect(closing).toContainText(
    'Marque quem faz a arte em Arte do pedido.',
  );
  await expect(closing).toContainText('pedido pendente');
});

test('says an order needs an item when the server refuses one without items', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'ORDER_NOT_CONFIRMABLE', fields: ['items'] },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(closing).toContainText('O pedido precisa de ao menos um item.');
});

test('reviews and generates the order by keyboard alone, giving the focus back on Esc (PFI-19)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  const generate = closing.getByRole('button', { name: 'Gerar pedido' });
  await generate.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleDescription(
    /o PDF da ficha fica disponível/u,
  );
  const amount = dialog.getByLabel('Valor final');
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');

  // Tab walks the dialog in reading order and never leaves it.
  await page.keyboard.type('4820');
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Pix')).toBeFocused();
  await expect(amount).toHaveValue('4.820,00');
  await page.keyboard.press('Space');
  await expect(dialog.getByLabel('Pix')).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Voltar' })).toBeFocused();
  await page.keyboard.press('Tab');
  const submit = dialog.getByRole('button', {
    name: 'Confirmar e gerar ficha',
  });
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  expect(
    await dialog.evaluate((element) => {
      const active = element.ownerDocument.activeElement;
      return (
        !active ||
        active === element.ownerDocument.body ||
        element.contains(active)
      );
    }),
  ).toBe(true);

  // Esc closes without writing and gives the focus back to the rail.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(generate).toBeFocused();
  expect(writes).toHaveLength(0);

  // Enter in the amount sends the confirmation.
  await page.keyboard.press('Enter');
  await expect(amount).toBeFocused();
  await amount.fill('1.180,00');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(closing).toContainText('Pedido confirmado e ficha gerada.');
  await expect(
    closing.getByRole('heading', { name: 'Fechamento e pagamento' }),
  ).toBeFocused();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    action: 'confirm',
    body: {
      amountText: '1.180,00',
      expectedVersion: 2,
      paymentCondition: 'pix',
    },
  });
});

test('sends one confirmation for a double Enter while it is on its way (PFI-19, PCL-09)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  // Registered after the mock, so it runs first and holds the answer.
  await page.route('**/api/v1/orders/order-pendente/confirm', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/pedidos/order-pendente');

  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Cartão de débito').check();
  const submit = dialog.getByRole('button', {
    name: 'Confirmar e gerar ficha',
  });
  await submit.focus();
  await page.keyboard.press('Enter');
  const busy = dialog.locator('button[type="submit"]');
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  await expect(busy).toHaveText('Gerando…');
  await expect(busy).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  release();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Fechamento e pagamento' }),
  ).toContainText('Cartão de débito');
  expect(writes.filter((call) => call.action === 'confirm')).toHaveLength(1);
});

test('closes the dialog on a blocker outside it and leads to the next step (PFI-19, PCL-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  let refused = false;
  // The server knows what the page did not: the art was unmarked elsewhere.
  await page.route('**/api/v1/orders/order-pendente/confirm', async (route) => {
    writes.push({ action: 'confirm', body: route.request().postDataJSON() });
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    refused = true;
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'ORDER_NOT_CONFIRMABLE', fields: ['artwork'] },
      }),
    });
  });
  await page.route('**/api/v1/orders/order-pendente', async (route) => {
    if (!refused || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        order: {
          ...pendingOrder,
          ficha: {
            ...pendingOrder.ficha,
            artwork: {
              feito_pela_silmer: false,
              feito_pelo_cliente: false,
              files: [],
              sem_estampa: false,
            },
          },
          missingFields: ['artwork', 'finalAmount', 'paymentCondition'],
          version: 3,
        },
      }),
    });
  });

  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    refused = false;
    await page.setViewportSize({ height, width });
    await page.goto('/pedidos/order-pendente');
    const phone = width < 768;
    const opener = phone
      ? page.locator('.op-mobile-action').getByRole('button', {
          name: 'Gerar pedido',
        })
      : page
          .getByRole('region', { name: 'Fechamento e pagamento' })
          .getByRole('button', { name: 'Gerar pedido' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
    await dialog.getByLabel('Valor final').fill('4.820,00');
    await dialog.getByLabel('Pix').check();
    await dialog
      .getByRole('button', { name: 'Confirmar e gerar ficha' })
      .click();

    await expect(dialog).toHaveCount(0);
    const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
    await expect(progress.getByRole('status')).toHaveText('2 de 3 prontos');
    const closing = page.getByRole('region', {
      name: 'Fechamento e pagamento',
    });
    await expect(closing).toContainText('pedido pendente');
    await expect(closing).toContainText(
      'Marque quem faz a arte em Arte do pedido.',
    );
    await expect(closing.locator('#closing-readiness')).toHaveText(
      'Falta para gerar: quem faz a arte. Valor e forma de pagamento você informa ao gerar.',
    );
    // The focus is on the button of the next step: the progress's on a
    // wide screen, the fixed footer's on a phone.
    const step = phone
      ? page.locator('.op-mobile-action').getByRole('button', {
          name: 'Marcar quem faz a arte',
        })
      : progress.getByRole('button', { name: 'Marcar quem faz a arte' });
    await expect(step).toBeFocused();
  }
  expect(writes.filter((call) => call.action === 'confirm')).toHaveLength(2);
  expect(writes[0].body).toEqual({
    amountText: '4.820,00',
    expectedVersion: 2,
    paymentCondition: 'pix',
  });
});

test('keeps the dialog open with the message when the connection drops (PFI-19)', async ({
  page,
}) => {
  await mockOrders(page);
  let attempts = 0;
  await page.route('**/api/v1/orders/order-pendente/confirm', async (route) => {
    attempts += 1;
    await route.abort('internetdisconnected');
  });
  await page.goto('/pedidos/order-pendente');

  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(
    'Sem conexão com o servidor. O pedido não foi gerado; tente de novo.',
  );
  await expect(alert).toBeFocused();
  await expect(dialog).toBeVisible();
  // What was typed stays for the next try.
  await expect(dialog.getByLabel('Valor final')).toHaveValue('4.820,00');
  await expect(dialog.getByLabel('Pix')).toBeChecked();
  await expect(
    page.getByRole('region', { name: 'Fechamento e pagamento' }),
  ).toContainText('pedido pendente');
  expect(attempts).toBe(1);
});

test('keeps the dialog open and asks to reload when the order changed (PFI-19, PCL-09)', async ({
  page,
}) => {
  await mockOrders(page, {
    writeFailure: { body: { code: 'VERSION_CONFLICT' }, status: 409 },
  });
  await page.goto('/pedidos/order-pendente');

  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await dialog.getByLabel('Valor final').fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(
    'Este pedido mudou. Cancele a edição para ver a versão atual.',
  );
  await expect(alert).toBeFocused();
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeDisabled();
});

test('keeps the dialog accessible and thumb sized, light and dark (PFI-19)', async ({
  page,
}) => {
  await mockOrders(page);
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    // The app ignores the system scheme: the theme is the saved choice that
    // index.html puts on <html data-theme> before the bundle loads.
    await page.addInitScript((value) => {
      globalThis.localStorage.setItem('silmer-theme', value);
    }, theme);
    for (const [width, height] of [
      [390, 844],
      [1280, 800],
    ]) {
      await page.setViewportSize({ height, width });
      await page.goto('/pedidos/order-pendente');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const opener =
        width < 768
          ? page.locator('.op-mobile-action').getByRole('button', {
              name: 'Gerar pedido',
            })
          : page
              .getByRole('region', { name: 'Fechamento e pagamento' })
              .getByRole('button', { name: 'Gerar pedido' });
      await opener.click();
      const dialog = page.getByRole('dialog', {
        name: 'Gerar o pedido 07-CRM?',
      });
      await expect(dialog.getByLabel('Valor final')).toBeFocused();
      // The errors too, so their contrast is checked.
      await dialog
        .getByRole('button', { name: 'Confirmar e gerar ficha' })
        .click();
      await expect(dialog).toContainText('Escolha a forma de pagamento.');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      const box = await dialog.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      const targets = [
        dialog.getByLabel('Valor final'),
        ...(await dialog.locator('.op-condition').all()),
        ...(await dialog.getByRole('button').all()),
      ];
      expect(targets).toHaveLength(6);
      for (const target of targets) {
        expect(
          (await target.boundingBox())?.height ?? 0,
        ).toBeGreaterThanOrEqual(44);
      }
      // 8px between the payment options.
      const options = await dialog.locator('.op-condition').all();
      const first = await options[0].boundingBox();
      const second = await options[1].boundingBox();
      const apart =
        Math.round(second?.y ?? 0) === Math.round(first?.y ?? 0)
          ? (second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0))
          : (second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0));
      expect(Math.round(apart)).toBeGreaterThanOrEqual(8);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
});

test('keeps "Gerar pedido" as the only primary button of the page (PFI-13)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  // One visible primary per screen size: the closing panel on a wide
  // screen, the fixed footer on a phone (mobile first).
  const primary = page.locator('main button.primary:visible');
  await expect(primary).toHaveText(['Gerar pedido']);
  await expect(primary).not.toHaveClass(/op-mobile/u);
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(primary).toHaveText(['Gerar pedido']);
  await expect(page.locator('.op-mobile-action button.primary')).toBeVisible();
  await page.setViewportSize({ height: 800, width: 1280 });

  // PFI-19: the dialog has one primary of its own.
  await page.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog.locator('button.primary')).toHaveText([
    'Confirmar e gerar ficha',
  ]);
  await expect(dialog.getByRole('button')).toHaveText([
    'Voltar',
    'Confirmar e gerar ficha',
  ]);
  await dialog.getByRole('button', { name: 'Voltar' }).click();
  await expect(dialog).toHaveCount(0);

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: 'Editar' }).click();
  await expect(primary).toHaveText(['Gerar pedido']);
});

test('makes the next step the only primary while one is missing (PFI-13, PFI-16)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [incompleteOrder],
  });
  await page.goto('/pedidos/order-pendente');

  // Wide screen: the next step on top is the primary; "Gerar pedido" stays
  // in the rail, unavailable, with what is missing beside it.
  const primary = page.locator('main button.primary:visible');
  await expect(primary).toHaveText(['Informar previsão de entrega']);
  const generate = page
    .getByRole('region', { name: 'Fechamento e pagamento' })
    .getByRole('button', { name: 'Gerar pedido' });
  await expect(generate).toHaveAttribute('aria-disabled', 'true');
  await expect(generate).toHaveAttribute(
    'aria-describedby',
    'closing-readiness',
  );

  // Phone: the fixed footer carries the next step, never "Gerar pedido".
  await page.setViewportSize({ height: 844, width: 390 });
  const footer = page.locator('.op-mobile-action');
  const step = footer.getByRole('button', {
    name: 'Informar previsão de entrega',
  });
  await expect(primary).toHaveText(['Informar previsão de entrega']);
  await expect(footer.locator('button.primary')).toHaveText(
    'Informar previsão de entrega',
  );
  await expect(
    footer.getByRole('button', { name: 'Gerar pedido' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerar pedido' })).toHaveCount(
    0,
  );
  await expect(step).toHaveAccessibleDescription('Passo 1 de 3 para gerar');
  const box = await footer.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844 - 64);
  expect((await step.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The progress is in the first screen, above the sections.
  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const progressBox = await progress.boundingBox();
  expect(
    (progressBox?.y ?? 0) + (progressBox?.height ?? 0),
  ).toBeLessThanOrEqual(box?.y ?? 0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The footer opens the summary on the promised delivery; nothing confirms.
  await step.click();
  await expect(
    page
      .getByRole('region', { name: 'Resumo do pedido' })
      .getByLabel('Previsão de entrega'),
  ).toBeFocused();
  await expect(footer).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('reaches and opens the next step by keyboard, and announces the count (PFI-15)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [incompleteOrder] });
  await page.goto('/pedidos/order-pendente');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();

  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const next = progress.getByRole('button', {
    name: 'Informar previsão de entrega',
  });
  await expect(progress.locator('li[aria-current="step"]')).toContainText(
    'Previsão de entrega',
  );
  // From the heading, the next step comes before any section control.
  let presses = 0;
  while (
    presses < 4 &&
    !(await next.evaluate((el) => el === el.ownerDocument.activeElement))
  ) {
    await page.keyboard.press('Tab');
    presses += 1;
  }
  await expect(next).toBeFocused();
  expect(presses).toBeLessThanOrEqual(3);

  await page.keyboard.press('Enter');
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const delivery = summary.getByLabel('Previsão de entrega');
  await expect(delivery).toBeFocused();

  // PFI-06: with a section open the step waits, focusable, and says why.
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toHaveAccessibleDescription(
    'Salve ou cancele a edição aberta.',
  );

  await delivery.fill('2026-10-24');
  await summary.getByRole('button', { name: 'Salvar resumo' }).focus();
  await page.keyboard.press('Enter');
  const status = progress.getByRole('status');
  await expect(status).toHaveText('1 de 3 prontos');
  await expect(progress.locator('li[aria-current="step"]')).toContainText(
    'Itens',
  );
  await expect(progress.getByRole('button')).toHaveText(['Completar itens']);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('hides Gerar and Reabrir from whoever does not own the conversation', async ({
  page,
}) => {
  await mockOrders(page, {
    orders: [
      {
        ...confirmedOrder,
        seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
      },
    ],
  });
  await page.goto('/pedidos/order-confirmado');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText('R$ 1.180,00');
  await expect(
    closing.getByRole('button', { name: 'Reabrir pedido' }),
  ).toHaveCount(0);
  // PFI-19: the amount and the method are read, never typed, here.
  await expect(page.getByRole('button', { name: 'Gerar pedido' })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Valor final')).toHaveCount(0);
  // PIM-05: any operational session prints a confirmed order.
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
});

test('keeps the main action of the order in a fixed footer on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const footer = page.locator('.op-mobile-action');
  const generate = footer.getByRole('button', { name: 'Gerar pedido' });
  await expect(generate).toBeVisible();
  // One "Gerar pedido" and no print button on a phone: the footer holds it.
  await expect(page.getByRole('button', { name: 'Gerar pedido' })).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toHaveCount(0);
  const box = await footer.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844 - 64);
  const target = await generate.boundingBox();
  expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);

  // PFI-19: nothing is missing on the page, so the footer opens the dialog
  // with the focus on the amount; empty fields stop before any request.
  await generate.click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  const amount = dialog.getByLabel('Valor final');
  await expect(amount).toBeFocused();
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();
  await expect(dialog).toContainText('Use o formato 4.820,00.');
  await expect(dialog).toContainText('Escolha a forma de pagamento.');
  await expect(amount).toBeFocused();
  await amount.fill('4.820,00');
  await dialog.getByLabel('Pix').check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(generate).toBeFocused();

  // EDIT-01: the items are edited in place, so their open fold keeps the
  // footer; it steps aside only for a section still in the Editar model.
  const items = page.getByRole('region', { name: ITEMS });
  await items.getByRole('button', { name: /^Itens e especificações/u }).click();
  await expect(items.getByLabel('Modelo', { exact: true })).toBeEditable();
  await expect(generate).toBeVisible();
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await summary.getByRole('button', { name: /^Resumo do pedido/u }).click();
  await summary.getByRole('button', { name: 'Editar resumo' }).click();
  await expect(footer).toHaveCount(0);
});

test('keeps a ready pending order within 1.800 px on a phone (RFC 024)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');
  await expect(
    page.getByRole('heading', { name: 'Pedido 07-CRM' }),
  ).toBeFocused();

  // Nothing missing: the summary is the open fold (PFI-18) and the progress
  // is one line under the same heading and status (PFI-15).
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(
    summary.getByRole('button', { name: /^Resumo do pedido/u }),
  ).toHaveAttribute('aria-expanded', 'true');
  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  await expect(progress.getByRole('status')).toHaveText(
    'Tudo pronto para gerar · 3 de 3',
  );
  await expect(progress.getByRole('listitem')).toHaveCount(0);
  const height = await page.evaluate(
    () => globalThis.document.documentElement.scrollHeight,
  );
  expect(height).toBeLessThanOrEqual(1800);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('generates a confirmed order PDF from the footer without covering the page', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const footer = page.locator('.op-mobile-action');
  await expect(footer.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Gerar PDF' })).toHaveCount(1);
  await page.evaluate(() =>
    globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight),
  );
  const last = await page.locator('.op-rail > :last-child').boundingBox();
  const bar = await footer.boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);

  // The shell's bottom navigation (4rem) sits right below the footer.
  expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(844 - 64);

  // From 48rem the action is back in the header and the footer is gone.
  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(footer).toBeHidden();
  await expect(
    page.locator('.op-head-actions').getByRole('button', {
      name: 'Gerar PDF',
    }),
  ).toBeVisible();
});

test('shows the reopen notice above the footer and the bottom navigation', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page, { orders: [ownConfirmedOrder] });
  await page.goto('/pedidos/order-confirmado');

  await page.getByRole('button', { name: 'Reabrir pedido' }).click();
  await page.getByRole('button', { name: 'Reabrir pedido 05-CRM' }).click();
  const toast = page.locator('.notice-toast');
  await expect(toast).toContainText('Pedido 05-CRM reaberto.');
  const footer = page.locator('.op-mobile-action');
  // PFI-16: the reopened fixture predates ADR 020 (its item has no
  // technique), so the footer carries that step instead of "Gerar pedido".
  await expect(
    footer.getByRole('button', { name: 'Completar itens' }),
  ).toBeVisible();
  await expect(
    footer.getByRole('button', { name: 'Gerar pedido' }),
  ).toHaveCount(0);
  const note = await toast.boundingBox();
  const bar = await footer.boundingBox();
  expect((note?.y ?? 0) + (note?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test.describe('the items on a phone with touch', () => {
  test.use({ hasTouch: true, viewport: { height: 844, width: 390 } });

  test('edits the sizes with the thumb: every control of the item is 44 px, with no stepper (EDIT-06, PFI-18)', async ({
    page,
  }) => {
    await mockOrders(page, { orders: [pricedPendingOrder] });
    // PFI-18: the hash opens the fold of the items.
    await page.goto('/pedidos/order-pendente#itens');

    const items = page.getByRole('region', { name: ITEMS });
    const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
    await expect(quantity).toHaveAttribute('inputmode', 'numeric');
    await expect(
      items.getByLabel('Subtotal do tamanho M, item 1'),
    ).toHaveAttribute('inputmode', 'decimal');
    await items
      .getByRole('group', { name: 'Adicionais do item 1, não obrigatórios' })
      .getByRole('button', { name: 'Público' })
      .click();

    /** @type {[string, import('@playwright/test').Locator][]} */
    const targets = [
      ['o tamanho', items.getByLabel('Tamanho, linha 1 do item 1')],
      ['a quantidade', quantity],
      ['o subtotal', items.getByLabel('Subtotal do tamanho M, item 1')],
      ['o novo tamanho', page.locator('#item-0-new-size')],
      ['a quantidade do novo tamanho', page.locator('#item-0-new-qty')],
      ['Modelo', items.getByLabel('Modelo', { exact: true })],
      ['Outra malha', items.getByRole('button', { name: 'Outra malha' })],
      ['Adicionar item', items.getByRole('button', { name: 'Adicionar item' })],
      [
        '+ Quantidade informada',
        items.getByRole('button', {
          exact: true,
          name: 'Quantidade informada',
        }),
      ],
    ];
    for (const chip of await items
      .getByRole('group', { exact: true, name: 'Público' })
      .getByRole('button')
      .all()) {
      targets.push([`o chip ${await chip.innerText()}`, chip]);
    }
    for (const chip of await items
      .getByRole('button', { name: /^Não aplicável: /u })
      .all()) {
      targets.push(['o chip Não aplicável', chip]);
    }
    for (const [name, target] of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
    // The icon buttons are 44 px both ways.
    for (const button of [
      items.getByRole('button', { name: 'Remover tamanho M do item 1' }),
      items.getByRole('button', { name: 'Mais ações do item 1' }),
    ]) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    // EDIT-06: the quantity is typed; nothing steps it or adds a line.
    for (const name of [
      /Uma peça a mais/u,
      /Uma peça a menos/u,
      /^Adicionar tamanho/u,
      /^Adicionar modelo de malha/u,
    ]) {
      await expect(items.getByRole('button', { name })).toHaveCount(0);
    }
    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

for (const [width, height] of [
  [390, 844],
  [1366, 768],
]) {
  test(`keeps the items in edit accessible at ${width} px, with a pendência, a review, an error and the menu on screen (EDIT-01, EDIT-04)`, async ({
    page,
  }) => {
    await page.setViewportSize({ height, width });
    await mockOrders(page, { orders: [incompletePricedOrder] });
    await page.goto('/pedidos/order-pendente#itens');

    const items = page.getByRole('region', { name: ITEMS });
    await expect(items).toHaveAttribute('data-items-state', 'edit');
    // A pendência (Cor, Gola), a subtotal to look at again and an error.
    const collar = items.getByLabel('Gola', { exact: true });
    await collar.fill('GOLA V');
    await collar.press('Enter');
    await expect(items.getByText('Confira o subtotal.')).toHaveCount(2);
    const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
    await quantity.fill('0');
    await quantity.press('Enter');
    await expect(items.getByRole('alert')).toHaveCount(1);
    await expect(items.locator('.op-field-gap')).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // The menu of the item and the confirmation asked inside the card.
    await items.getByRole('button', { name: 'Mais ações do item 1' }).click();
    await expect(items.getByRole('menu')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await items.getByRole('menuitem', { name: 'Remover item' }).click();
    await expect(
      items.getByRole('group', {
        name: 'Remover o item 1 e os tamanhos dele?',
      }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
  });
}

test('fits the items in edit in 320 px, without scrolling sideways (EDIT-01, EDIT-06)', async ({
  page,
}) => {
  await page.setViewportSize({ height: 780, width: 320 });
  await mockOrders(page, { orders: [twoItemsOrder] });
  await page.goto('/pedidos/order-pendente#itens');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items.locator('.op-item')).toHaveCount(2);
  // The longest things the section shows: a review on a line, the chips of
  // the audience and the open menu.
  const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
  await quantity.fill('1000000');
  await quantity.press('Enter');
  await expect(items.getByText('Confira o subtotal.')).toHaveCount(1);
  await items
    .getByRole('group', { name: 'Adicionais do item 1, não obrigatórios' })
    .getByRole('button', { name: 'Público' })
    .click();
  await items.getByRole('button', { name: 'Mais ações do item 1' }).click();
  await expect(items.getByRole('menu')).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  for (const control of await items
    .locator('input, button, [role="menuitem"]')
    .all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});

const repeatedSizes = {
  ...confirmedOrder,
  ficha: {
    ...confirmedOrder.ficha,
    items: [
      {
        ...confirmedOrder.ficha.items[0],
        grade: [
          { quantidade: 10, tamanho: 'G' },
          { quantidade: 5, tamanho: 'P' },
          { quantidade: 30, tamanho: 'M' },
          { quantidade: 2, tamanho: 'm' },
          { quantidade: 13, tamanho: 'GG' },
        ],
      },
    ],
  },
  id: 'order-repeated',
  totalPieces: 60,
};

test('reads sizes in the canonical order, as heavy as their quantity, and flags a repeated size', async ({
  page,
}) => {
  await mockOrders(page, { orders: [repeatedSizes] });
  await page.goto('/pedidos/order-repeated');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const sizes = items.getByRole('list', { name: 'Tamanhos do item 1' });
  await expect(sizes.getByRole('listitem')).toHaveText([
    /^P\s*5\s*peças$/u,
    /^M\s*30\s*peças, tamanho repetido$/u,
    /^m\s*2\s*peças, tamanho repetido$/u,
    /^G\s*10\s*peças$/u,
    /^GG\s*13\s*peças$/u,
  ]);
  const weights = await sizes
    .getByRole('listitem')
    .first()
    .evaluate((tile) =>
      [...tile.querySelectorAll('.op-grade-tile-size, .op-grade-tile-qty')].map(
        (part) => {
          const style = globalThis.getComputedStyle(part);
          return `${style.fontSize} ${style.fontWeight}`;
        },
      ),
    );
  expect(weights).toHaveLength(2);
  expect(weights[0]).toBe(weights[1]);
  await expect(items).toContainText(
    'O tamanho M aparece em mais de uma linha. Junte as quantidades numa linha só.',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // On a phone the tiles wrap inside the item instead of running past it.
  // PFI-18: the items fold opens first, so the tiles are really measured.
  await page.setViewportSize({ height: 844, width: 390 });
  await items.getByRole('button', { name: /^Itens e especificações/u }).click();
  await expect(sizes).toBeVisible();
  const fits = await sizes.evaluate((list) => {
    const item = /** @type {HTMLElement} */ (list.closest('.op-item'));
    const edge = item.getBoundingClientRect().right;
    return [...list.children].every(
      (tile) => tile.getBoundingClientRect().right <= edge,
    );
  });
  expect(fits).toBe(true);
});

test('never writes a size twice: the blank row adds to the line it has and a rename is refused (EDIT-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const size = page.locator('#item-0-new-size');
  // "m" is M: the quantity is added to the line the item has, with a notice.
  await size.fill('m');
  await size.press('Enter');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(2, {
      action: 'change_quantity',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_M,
      quantity: 105,
    }),
  );
  await expect(items.locator('[data-items-announcement]')).toHaveText(
    'O tamanho M já estava no item 1: a quantidade foi somada e agora é 105.',
  );
  await expect(items.locator('[data-items-announcement]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await expect(items.getByLabel('Quantidade do tamanho M, item 1')).toHaveValue(
    '105',
  );
  await expect(items.locator('.op-size-row')).toHaveCount(3);
  await expect(size).toHaveValue('');
  await expect(size).toBeFocused();
  await expect(items.getByText(/aparece em mais de uma linha/u)).toHaveCount(0);

  // Renaming a line into a size the item has is refused at the line.
  const second = items.getByLabel('Tamanho, linha 2 do item 1');
  await second.fill('m');
  await second.press('Enter');
  const row = items.locator(`[data-line-id="${PRICED_LINE_G}"]`);
  await expect(row.getByRole('alert')).toHaveText(
    'O tamanho m já está neste item. Some a quantidade na outra linha.',
  );
  await expect(second).toHaveAttribute('aria-invalid', 'true');
  await expect(second).toHaveValue('m');
  await expect(second).toBeFocused();
  expect(writes).toHaveLength(1);

  // Another name is one command, and the subtotal asks for a look.
  await second.fill('GG');
  await second.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, {
      action: 'rename_line',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_G,
      size: 'GG',
    }),
  );
  await expect(second).toHaveValue('GG');
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(row).toContainText('Confira o subtotal.');
  await expect(
    items.getByLabel('Quantidade do tamanho GG, item 1'),
  ).toHaveValue('50');
});

test('creates sizes from the blank row by keyboard: one with Enter, a list typed and a list pasted (EDIT-06)', async ({
  context,
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const blank = items.locator('[data-blank-row]');
  const size = page.locator('#item-0-new-size');
  const quantity = page.locator('#item-0-new-qty');
  const hint = page.locator('#item-0-sizes-hint');
  /** @param {string} name @param {number} pieces */
  const added = (name, pieces) => ({
    action: 'add_line',
    groupId: PRICED_GROUP_ID,
    quantity: pieces,
    size: name,
  });
  // The blank row is the last one and is not a size: nothing to remove, and
  // one line says what it does.
  await expect(items.locator('.op-size-row').last()).toHaveAttribute(
    'data-blank-row',
    '',
  );
  await expect(blank.getByRole('button')).toHaveCount(0);
  await expect(size).toHaveAccessibleDescription(
    'A linha em branco é o próximo tamanho.',
  );

  // A size alone waits for its quantity: Enter walks to it and sends nothing.
  await size.focus();
  await page.keyboard.type('GG');
  await page.keyboard.press('Enter');
  await expect(quantity).toBeFocused();
  expect(writes).toHaveLength(0);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 1);
  // The new line takes the focus on its subtotal; another blank row follows.
  await expect(
    items.getByLabel('Subtotal do tamanho GG, item 1'),
  ).toBeFocused();
  await expect(size).toHaveValue('');
  await expect(quantity).toHaveValue('');

  // Without a quantity nothing is created: the same hint on leaving the row
  // and on Enter, never an error (design.md §20, BlankRow).
  await size.fill('XGG');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(hint).toHaveText('Informe a quantidade para criar o tamanho.');
  await quantity.focus();
  await page.keyboard.press('Enter');
  await expect(hint).toHaveText('Informe a quantidade para criar o tamanho.');
  await expect(hint.getByRole('alert')).toHaveCount(0);
  await expect(quantity).not.toHaveAttribute('aria-invalid', /./u);
  await expect(size).toHaveValue('XGG');
  expect(writes).toHaveLength(1);
  // A quantity that is typed and is not one is an error, on the quantity.
  await quantity.fill('dez');
  await page.keyboard.press('Enter');
  await expect(hint.getByRole('alert')).toHaveText(
    'Use uma quantidade inteira maior que zero.',
  );
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await expect(size).toHaveValue('XGG');
  expect(writes).toHaveLength(1);
  await quantity.fill('');
  await size.fill('');
  await expect(hint.getByRole('alert')).toHaveCount(0);

  // A size of two words, with the quantity in its own cell, is one line.
  await size.fill('EX G');
  await size.press('Enter');
  await expect(quantity).toBeFocused();
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 2);

  // A list typed in the size cell creates one line per pair.
  await size.fill('P 20 XG 7');
  await size.press('Enter');
  await expectSaved(page, writes, 4);
  await expect(size).toBeFocused();

  // A pasted list too, at once; a size the item has is added to its line.
  await page.evaluate(() =>
    globalThis.navigator.clipboard.writeText('PP 3 G 2'),
  );
  await page.keyboard.press('ControlOrMeta+V');
  await expectSaved(page, writes, 6);
  await expect(items.locator('[data-items-announcement]')).toHaveText(
    'O tamanho G já estava no item 1: a quantidade foi somada e agora é 52.',
  );
  expect(sectionWrites(writes).map((write) => write.value)).toEqual([
    added('GG', 10),
    added('EX G', 4),
    added('P', 20),
    added('XG', 7),
    added('PP', 3),
    {
      action: 'change_quantity',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_G,
      quantity: 52,
    },
  ]);
  expect(sectionWrites(writes).map((write) => write.expectedVersion)).toEqual([
    2, 3, 4, 5, 6, 7,
  ]);
  await expect(items.locator('.op-size-row:not([data-blank-row])')).toHaveCount(
    7,
  );
  await expect(items.locator('.op-item-total')).toContainText('196 peças');

  // A list with a size lacking its quantity is refused whole, not guessed.
  await size.fill('P 20 M');
  await size.press('Enter');
  await expect(hint.getByRole('alert')).toHaveText(
    'Escreva o tamanho e a quantidade, por exemplo: M 60.',
  );
  await expect(size).toHaveValue('P 20 M');
  expect(writes).toHaveLength(6);
});

test('moves, removes and keeps an item from "Mais ações", by keyboard, giving the focus back (EDIT-01, EDIT-05)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [twoItemsOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const titles = items.getByRole('heading', { level: 3 });
  const firstMenu = items.getByRole('button', { name: 'Mais ações do item 1' });
  const secondMenu = items.getByRole('button', {
    name: 'Mais ações do item 2',
  });
  /** @param {string} name */
  const action = (name) => items.getByRole('menuitem', { name });
  await expect(firstMenu).toHaveAttribute('aria-haspopup', 'menu');
  await expect(firstMenu).toHaveAttribute('aria-expanded', 'false');

  // Enter opens the menu on its first action; the arrows walk what is
  // available and wrap; Esc closes it and gives the focus back.
  await firstMenu.focus();
  await page.keyboard.press('Enter');
  await expect(firstMenu).toHaveAttribute('aria-expanded', 'true');
  await expect(items.getByRole('menu', { name: 'Ações do item 1' })).toHaveText(
    /Duplicar para outro público\s*Mover para cima\s*Mover para baixo\s*Remover item/u,
  );
  await expect(action('Duplicar para outro público')).toBeFocused();
  await expect(action('Mover para cima')).toBeDisabled();
  await page.keyboard.press('ArrowDown');
  await expect(action('Mover para baixo')).toBeFocused();
  await page.keyboard.press('End');
  await expect(action('Remover item')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(action('Duplicar para outro público')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(action('Remover item')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(action('Duplicar para outro público')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(items.getByRole('menu')).toHaveCount(0);
  await expect(firstMenu).toBeFocused();
  expect(writes).toHaveLength(0);

  // "Mover para baixo" is one command; the focus follows the item.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)[0]).toEqual(
    command(2, {
      action: 'reorder_groups',
      groupIds: [SECOND_GROUP_ID, PRICED_GROUP_ID],
    }),
  );
  await expect(titles).toHaveText([
    /^Item\s*1\s*REGATA$/u,
    /^Item\s*2\s*CAMISETA$/u,
  ]);
  await expect(secondMenu).toBeFocused();

  // "Remover item" asks inside the card, with the focus on "Manter"; Esc
  // and "Manter" keep the item and give the focus back.
  const confirm = items.getByRole('group', {
    name: 'Remover o item 2 e os tamanhos dele?',
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(confirm.getByRole('button', { name: 'Manter' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(secondMenu).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  await expect(secondMenu).toBeFocused();
  await expect(titles).toHaveCount(2);
  expect(writes).toHaveLength(1);

  // "Remover" is one command; the focus goes to the item that is left.
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(confirm.getByRole('button', { name: 'Remover' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 2);
  expect(sectionWrites(writes)[1]).toEqual(
    command(3, { action: 'remove_group', groupId: PRICED_GROUP_ID }),
  );
  await expect(titles).toHaveText([/^Item\s*1\s*REGATA$/u]);
  await expect(firstMenu).toBeFocused();
  await expect(items.locator('.op-items-total')).toContainText('150 peças');
});

test('sends nothing for a field left as it was, whatever its kind (EDIT-02)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  // The same value typed again, then Enter and leaving the field.
  for (const [label, same] of [
    ['Modelo', 'CAMISETA'],
    ['Modelo de malha', 'DRY FIT 100% POLIÉSTER'],
    ['Tamanho, linha 1 do item 1', 'M'],
    ['Quantidade do tamanho M, item 1', '100'],
    ['Subtotal do tamanho M, item 1', '3.200,00'],
    ['Subtotal do tamanho G, item 1', 'R$ 1.600,00'],
  ]) {
    const field = items.getByLabel(label, { exact: true });
    await field.press('Enter');
    await field.fill(same);
    await field.press('Enter');
    await page.keyboard.press('Tab');
  }
  // An empty blank row is not a size.
  await page.locator('#item-0-new-size').press('Enter');
  await page.locator('#item-0-new-qty').press('Enter');
  await expect(items.getByRole('alert')).toHaveCount(0);
  await expect(items.getByRole('status')).toHaveText('');

  // The first request the page sends is the first real change.
  const colour = items.getByLabel('Cor', { exact: true });
  await colour.fill('PRETA');
  await colour.press('Enter');
  await expectSaved(page, writes, 1);
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'update_group',
      attributes: { cor: 'PRETA' },
      groupId: PRICED_GROUP_ID,
    }),
  ]);
  await expect(items.getByLabel('Subtotal do tamanho G, item 1')).toHaveValue(
    '1.600,00',
  );
});

test('says "Salvando…" and then "Salvo" in the one status region of the head, one save at a time (EDIT-02, EDIT-08)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  /** @type {Array<() => void>} */
  const held = [];
  // Registered after the mock, so it runs first and holds each answer.
  await page.route(
    '**/api/v1/orders/order-pendente/sections/size-pricing',
    async (route) => {
      await new Promise((resolve) => {
        held.push(() => resolve(null));
      });
      await route.fallback();
    },
  );
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const status = items.locator('.op-sheet-head').getByRole('status');
  await expect(items.getByRole('status')).toHaveCount(1);
  await expect(status).toHaveText('');

  const colour = items.getByLabel('Cor', { exact: true });
  await colour.fill('PRETA');
  await colour.press('Enter');
  await expect.poll(() => held.length).toBe(1);
  await expect(status).toHaveText('Salvando…');
  await expect(status).toBeVisible();

  // A second change typed meanwhile waits for the first answer; what is
  // typed is not touched by it.
  const collar = items.getByLabel('Gola', { exact: true });
  await collar.fill('GOLA V');
  await collar.press('Enter');
  await expect(collar).toHaveValue('GOLA V');
  expect(held).toHaveLength(1);
  held[0]();
  await expect.poll(() => held.length).toBe(2);
  await expect(status).toHaveText('Salvando…');
  await expect(collar).toHaveValue('GOLA V');
  held[1]();
  await expect(status).toHaveText('Salvo');
  await expect(status.locator('svg')).toHaveCount(1);
  expect(sectionWrites(writes)).toEqual([
    command(2, {
      action: 'update_group',
      attributes: { cor: 'PRETA' },
      groupId: PRICED_GROUP_ID,
    }),
    command(3, {
      action: 'update_group',
      attributes: { gola: 'GOLA V' },
      groupId: PRICED_GROUP_ID,
    }),
  ]);
  // The status is the only word about it: no toast.
  await expect(page.locator('.notice-toast')).toHaveCount(0);

  // "Salvo" speaks of the fields and leaves with them.
  await page
    .getByRole('region', { name: 'Resumo do pedido' })
    .getByRole('button', { name: 'Editar resumo' })
    .click();
  await expect(status).toHaveText('');
});

test('keeps every subtotal that awaits a look with one button, one command per size (EDIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [pricedPendingOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  const keepAll = page.locator('#item-0-keep-all');
  await expect(keepAll).toHaveCount(0);
  // A changed attribute puts the subtotal of every size up for review.
  const colour = items.getByLabel('Cor', { exact: true });
  await colour.fill('PRETA');
  await colour.press('Enter');
  await expectSaved(page, writes, 1);
  await expect(items.getByText('Confira o subtotal.')).toHaveCount(2);
  await expect(keepAll).toHaveText('Manter os 2 subtotais');

  await keepAll.focus();
  await page.keyboard.press('Enter');
  await expectSaved(page, writes, 3);
  expect(sectionWrites(writes).slice(1)).toEqual([
    command(3, {
      action: 'review_subtotal',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_M,
      subtotalCents: 320000,
    }),
    command(4, {
      action: 'review_subtotal',
      groupId: PRICED_GROUP_ID,
      lineId: PRICED_LINE_G,
      subtotalCents: 160000,
    }),
  ]);
  await expect(items.getByText('Confira o subtotal.')).toHaveCount(0);
  await expect(keepAll).toHaveCount(0);
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*150 peças · R\$ 4\.800,00$/u,
  );
});

test('keeps a reopened order without subtotals editable, by the whole list and without the Subtotal column (EDIT-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, {
    onWrite: (call) => writes.push(call),
    orders: [reopenedOrder],
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'edit');
  await expect(items).toHaveAttribute('data-items-mode', 'plain');
  await expect(items.locator('.op-sizes-head span')).toHaveText([
    'Tamanho',
    'Quantidade',
  ]);
  await expect(
    items.getByRole('textbox', { name: /^Subtotal do tamanho/u }),
  ).toHaveCount(0);
  await expect(items.getByText('Falta o subtotal')).toHaveCount(0);

  const stored = {
    ...pendingOrder.ficha.items[0],
    publico: '',
    quantidade_informada: null,
  };
  const quantity = items.getByLabel('Quantidade do tamanho M, item 1');
  await quantity.fill('120');
  await quantity.press('Enter');
  await expectSaved(page, writes, 1);
  // Without a subtotal Enter walks down the quantities.
  await expect(
    items.getByLabel('Quantidade do tamanho G, item 1'),
  ).toBeFocused();
  await page.locator('#item-0-new-size').fill('GG 10');
  await page.locator('#item-0-new-size').press('Enter');
  await expectSaved(page, writes, 2);
  // One request per change still, each with the whole list of items; the
  // subtotals by size are never started on a reopened order.
  expect(sectionWrites(writes)).toEqual([
    {
      expectedVersion: 2,
      section: 'items',
      value: [
        {
          ...stored,
          grade: [
            { quantidade: 120, tamanho: 'M' },
            { quantidade: 50, tamanho: 'G' },
          ],
        },
      ],
    },
    {
      expectedVersion: 3,
      section: 'items',
      value: [
        {
          ...stored,
          grade: [
            { quantidade: 120, tamanho: 'M' },
            { quantidade: 50, tamanho: 'G' },
            { quantidade: 10, tamanho: 'GG' },
          ],
        },
      ],
    },
  ]);
  await expect(items).toHaveAttribute('data-items-mode', 'plain');
  await expect(items.locator('.op-items-total')).toHaveText(
    /^Total do pedido\s*180 peças$/u,
  );
});

for (const reader of [
  {
    label: 'a confirmed order (PFI-10)',
    order: {
      ...pricedPendingOrder,
      confirmedAt: '2026-09-09T19:20:00.000Z',
      confirmedBy: { id: 'seller-marina', name: 'Marina Aguiar' },
      missingFields: [],
      orderDate: '2026-09-09',
      paymentCondition: 'pix',
      status: 'confirmado',
    },
  },
  {
    label: 'whoever does not own the order (PAU-01)',
    order: { ...pricedPendingOrder, seller: OTHER_SELLER },
  },
  {
    label: 'a store order (LOJ-07)',
    order: { ...pricedPendingOrder, origin: 'loja' },
  },
]) {
  test(`reads the items as text, without a field or an action, for ${reader.label} (EDIT-01)`, async ({
    page,
  }) => {
    /** @type {any[]} */
    const writes = [];
    await mockOrders(page, {
      onWrite: (call) => writes.push(call),
      orders: [reader.order],
    });
    await page.goto('/pedidos/order-pendente');

    const items = page.getByRole('region', { name: ITEMS });
    if (/** @type {any} */ (reader.order).origin === 'loja') {
      // A store order has its own read-only page (LOJ-34): the items section,
      // editable or not, is not part of it, and nothing can be written.
      await expect(page.getByText(/travado, sem edição/u)).toBeVisible();
      await expect(items).toHaveCount(0);
      await expect(page.locator('[data-items-state]')).toHaveCount(0);
      await expect(page.getByRole('textbox')).toHaveCount(0);
      expect(writes).toHaveLength(0);
      return;
    }
    await expect(items).toHaveAttribute('data-items-state', 'read');
    await expect(items.getByRole('textbox')).toHaveCount(0);
    await expect(items.getByRole('button')).toHaveCount(0);
    await expect(items.locator('input, select, textarea')).toHaveCount(0);
    await expect(items.getByRole('status')).toHaveText('');
    await expect(items.locator('dl.op-points')).toBeVisible();
    await expect(
      items
        .getByRole('list', { name: 'Tamanhos do item 1' })
        .getByRole('listitem'),
    ).toHaveText([/^M\s*100\s*peças$/u, /^G\s*50\s*peças$/u]);
    await expect(
      items
        .getByRole('table', { name: 'Tamanhos e subtotais do item 1' })
        .locator('tbody tr'),
    ).toHaveText([/^M\s*100\s*R\$ 3\.200,00$/u, /^G\s*50\s*R\$ 1\.600,00$/u]);
    await expect(items.locator('.op-items-total')).toHaveText(
      /^Total do pedido\s*150 peças · R\$ 4\.800,00$/u,
    );
    expect(writes).toHaveLength(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test('reads the filled extras of a confirmed order for the shop floor, one by one (PIT-02, EDIT-05)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const items = page.getByRole('region', { name: ITEMS });
  await expect(items).toHaveAttribute('data-items-state', 'read');
  // No block to open: each extra with data is a point of the item.
  await expect(items.getByRole('button', { name: /Adicionais/u })).toHaveCount(
    0,
  );
  for (const [label, value] of [
    ['Cor do tecido — manga direita', 'VERDE BANDEIRA'],
    ['Cor do tecido — manga esquerda', 'VERDE BANDEIRA'],
    ['Viés das mangas', 'VERDE'],
  ]) {
    const point = items
      .locator('dl.op-points > div')
      .filter({ has: page.getByText(label, { exact: true }) });
    await expect(point.locator('dd')).toHaveText(value);
  }
  // What holds no data is not listed empty.
  await expect(items.getByText('Público', { exact: true })).toHaveCount(0);
  await expect(
    items.getByText('Quantidade informada', { exact: true }),
  ).toHaveCount(0);
});
