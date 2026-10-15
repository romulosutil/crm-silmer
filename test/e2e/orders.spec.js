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

  const print = page.getByRole('button', { name: 'Imprimir ficha' });
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

test('lists exactly what is missing to generate, point by point (PFI-09, PFI-15, PFI-16, PIT-05, PIT-06, TEC-03)', async ({
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
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, gola do item 1, quem faz a arte, entrega prometida, valor final e forma de pagamento.',
  );
  await expect(page.getByText('Ainda em branco na ficha')).toHaveCount(0);

  // PFI-15: the real progress on top, in the order of the page, with only
  // the next step as a button; the amount and payment method are not steps.
  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const count = progress.getByRole('status');
  await expect(count).toHaveText('0 de 3 prontos');
  await expect(progress.getByRole('listitem')).toHaveText([
    /Entrega prometida\s*falta: a data combinada/u,
    /Itens\s*falta: cor do item 1 e gola do item 1/u,
    /Arte do pedido\s*falta: quem faz a arte/u,
  ]);
  await expect(progress.getByRole('button')).toHaveText([
    'Informar entrega prometida',
  ]);

  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, gola do item 1, quem faz a arte e entrega prometida.',
  );
  await expect(count).toHaveText('0 de 3 prontos');
  // PFI-16: what is filled elsewhere keeps "Gerar pedido" unavailable but
  // focusable; activating it leads to the next step and never confirms.
  const generate = closing.getByRole('button', { name: 'Gerar pedido' });
  await expect(generate).toHaveAttribute('aria-disabled', 'true');
  await generate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const delivery = summary.getByLabel('Entrega prometida');
  await expect(delivery).toBeFocused();
  expect(writes.filter((call) => call.action === 'confirm')).toHaveLength(0);

  // Saving the delivery moves the progress without reloading the page.
  await delivery.fill('2026-10-24');
  await summary.getByRole('button', { name: 'Salvar resumo' }).click();
  await expect(count).toHaveText('1 de 3 prontos');
  await expect(readiness).toHaveText(
    'Falta para gerar: cor do item 1, gola do item 1 e quem faz a arte.',
  );

  // The next step opens the items editor.
  await progress.getByRole('button', { name: 'Completar itens' }).click();
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByLabel('Cor', { exact: true }).fill('BRANCA');
  await items.getByLabel('Gola', { exact: true }).fill('GOLA V');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(count).toHaveText('2 de 3 prontos');
  await expect(readiness).toHaveText('Falta para gerar: quem faz a arte.');

  // ADR 020: the last step sends the seller to who makes the art.
  await progress
    .getByRole('button', { name: 'Marcar quem faz a arte' })
    .click();
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  await expect(artwork.getByLabel('O cliente envia a arte')).toBeFocused();
  await artwork.getByLabel('Sem estampa').check();
  await artwork.getByRole('button', { name: 'Salvar arte' }).click();
  await expect(count).toHaveText('3 de 3 prontos');
  await expect(progress.getByRole('button')).toHaveCount(0);
  await expect(readiness).toHaveText(
    'Tudo pronto. Gerar confirma o pedido e libera a ficha.',
  );
  await expect(generate).not.toHaveAttribute('aria-disabled', /./u);
  // The paid day stays empty: generating means paid until the CRM handles
  // payments.
  await expect(
    page.getByRole('region', { name: 'Datas do pedido' }),
  ).toContainText('Pago em');
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' }),
  ).toBeVisible();
});

test('prints a confirmed order from its page', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const print = page.getByRole('button', { name: 'Imprimir ficha' });
  await expect(print).toBeEnabled();
  const [document] = await Promise.all([
    page.context().waitForEvent('page'),
    print.click(),
  ]);
  expect(document.url()).toContain('/api/v1/orders/order-confirmado/print');
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
  await expect(page.locator('.op-mobile-action')).toHaveText('Imprimir ficha');

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
    'Entrega prometida',
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
    summary.getByLabel('Entrega prometida'),
  ).toHaveAccessibleDescription('A data combinada com o cliente.');
  await expect(summary.getByLabel(/Técnica/u)).toHaveCount(0);
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
  await expect(artwork).toContainText('PNG, JPEG, WebP, CDR');

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
  for (const file of files) {
    const code = (await readFile(file, 'utf8'))
      .replaceAll(/<!--[\s\S]*?-->/gu, '')
      .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
      .replaceAll(/(^|[^:])\/\/.*$/gmu, '$1');
    // Comments may cite the pilot; code and templates take `brand`.
    expect(code, file.pathname).not.toContain(brand.companyName);
  }
});

test('requires a technique for each item before the seller can generate the order (TEC-01)', async ({
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
  await expect(closing).toContainText('técnica do item 1');
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  const technique = items.getByLabel('Técnica', { exact: true });
  await expect(technique).toHaveAccessibleDescription(
    'Silk, DTF, sublimação, bordado… ou Sem estampa. Obrigatória para gerar.',
  );
  await technique.fill('BORDADO');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(closing).not.toContainText('técnica do item 1');
  await expect(items).toContainText('BORDADO');
});

test('keeps garment, colour and collar data from older fichas when saving an item', async ({
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
  await mockOrders(page, {
    orders: [legacy],
    onWrite: (call) => writes.push(call),
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items).toContainText('Item 1 · — · 150 peças');
  await expect(items).toContainText('OLÍMPICA - VERDE');
  // ADR 020: the old model stays stored, without a field or a notice.
  await expect(items).not.toContainText('GOLA OLÍMPICA');
  await expect(items.getByText('Modelo', { exact: true })).toHaveCount(0);
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Modelo', { exact: true })).toHaveCount(0);
  await expect(items.getByLabel('Tipo de roupa')).toHaveValue('');
  await expect(items.getByLabel('Cor', { exact: true })).toHaveValue('BRANCA');
  await expect(items.getByLabel('Gola', { exact: true })).toHaveValue(
    'OLÍMPICA - VERDE',
  );
  await items.getByLabel('Tipo de roupa').fill('CAMISETA');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(items.getByText('Modelo', { exact: true })).toHaveCount(0);

  expect(writes[0].body.value[0]).toMatchObject({
    cor: 'BRANCA',
    gola: 'OLÍMPICA - VERDE',
    modelo: 'GOLA OLÍMPICA',
    tipo: 'CAMISETA',
    vies_gola: 'OLÍMPICA - VERDE',
  });
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
  await expect(summary).toContainText('Entrega prometida');
  await expect(trail).not.toContainText('Pedido fechado');
  await expect(trail).not.toContainText('Entrega prometida');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
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
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
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

test('reads each item with the seven points in order and the extras closed (PFI-03, PIT-01, PIT-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items).toContainText('1 item · 150 peças');
  const card = items.getByRole('group', {
    name: 'Item 1 · CAMISETA · 150 peças',
  });
  await expect(
    card.getByRole('heading', {
      level: 3,
      name: 'Item 1 · CAMISETA · 150 peças',
    }),
  ).toBeVisible();
  const points = card.locator('dl').first();
  await expect(points.locator(':scope > div > dt')).toHaveText([
    'Tipo de roupa',
    'Cor',
    'Quantidade',
    'Técnica',
    'Modelo de malha',
    'Tamanhos',
    'Gola',
  ]);
  await expect(points.locator(':scope > div > dd')).toHaveText([
    'CAMISETA',
    'BRANCA',
    '150 peças',
    'SUBLIMAÇÃO TOTAL',
    'DRY FIT 100% POLIÉSTER',
    /^M\s*100\s*peças\s*G\s*50\s*peças$/u,
    'GOLA REDONDA',
  ]);
  await expect(card.getByRole('listitem')).toHaveText([
    /^M\s*100\s*peças$/u,
    /^G\s*50\s*peças$/u,
  ]);

  // PIT-02: the extras start closed and do not show their values.
  const toggle = card.getByRole('button', {
    name: /Adicionais \(não obrigatórios\)/u,
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(
    card.getByText('Cor do tecido — frente', { exact: true }),
  ).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(
    card.getByText('Cor do tecido — frente', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Modelo', { exact: true })).toHaveCount(0);
  // ADR 020: the print is a reference; the part colours are the fabric's.
  await expect(card.locator('dl').nth(1).locator('dt')).toHaveText([
    'Estampa (referência)',
    'Cor do tecido — frente',
    'Cor do tecido — costas',
    'Cor do tecido — manga direita',
    'Cor do tecido — manga esquerda',
    'Viés das mangas',
  ]);
  await expect(card.locator('dl').nth(1).locator('dd').first()).toHaveText(
    'Logo · frente',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('opens and closes the extras with the keyboard, keeping the focus (PIT-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const toggle = items.getByRole('button', {
    name: /Adicionais \(não obrigatórios\)/u,
  });
  const extras = items.locator(
    `#${await toggle.getAttribute('aria-controls')}`,
  );
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(extras).toBeVisible();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(extras).toBeHidden();
  await expect(toggle).toBeFocused();

  // While editing, the extras are closed again and open the same way.
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Tipo de roupa')).toBeFocused();
  const editToggle = items.getByRole('button', {
    name: 'Adicionais (não obrigatórios)',
  });
  await expect(editToggle).toHaveAttribute('aria-expanded', 'false');
  const reference = items.getByLabel('Estampa (referência)');
  await expect(reference).toBeHidden();
  await editToggle.focus();
  await page.keyboard.press('Enter');
  await expect(reference).toBeVisible();
  await expect(reference).toHaveAccessibleDescription(
    'O que vai estampado e onde, se ajudar a produção.',
  );
  await expect(editToggle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(reference).toBeFocused();
});

test('edits the seven points and the extras of an item (PIT-01, PIT-02, PIT-03)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByText('Quantidade', { exact: true })).toBeVisible();
  await items.getByLabel('Tipo de roupa').fill('REGATA');
  await items.getByLabel('Cor', { exact: true }).fill('PRETA');
  await items.getByLabel('Técnica', { exact: true }).fill('SILK 4 CORES');
  await items.getByLabel('Modelo de malha 1').fill('ALGODÃO');
  await items.getByLabel('Gola', { exact: true }).fill('REGATA');
  await items
    .getByRole('button', { name: 'Adicionais (não obrigatórios)' })
    .click();
  await items.getByLabel('Estampa (referência)').fill('Logo · costas');
  await items.getByLabel('Cor do tecido — frente').fill('PRETA');

  // A second item stays half filled: it saves and is listed as missing.
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  await page.locator('#item-1-tipo').fill('BONÉ');
  await page.locator('#item-1-tecnica').fill('BORDADO');
  await items.getByRole('button', { name: 'Salvar itens' }).click();

  await expect(
    items.getByRole('heading', { name: 'Item 1 · REGATA · 150 peças' }),
  ).toBeVisible();
  await expect(
    items.getByRole('heading', { name: 'Item 2 · BONÉ · 0 peças' }),
  ).toBeVisible();
  const [first, second] = writes[0].body.value;
  expect(first).toMatchObject({
    cor: 'PRETA',
    cor_frente: 'PRETA',
    estampa: 'Logo · costas',
    gola: 'REGATA',
    malhas: ['ALGODÃO'],
    tipo: 'REGATA',
    tipo_servico: 'SILK 4 CORES',
  });
  expect(second).toMatchObject({
    grade: [],
    malhas: [],
    tipo: 'BONÉ',
    tipo_servico: 'BORDADO',
  });
  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing).toContainText(
    'Falta para gerar: cor do item 2, modelo de malha do item 2, tamanhos do item 2, gola do item 2, valor final e forma de pagamento.',
  );
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
  const noSizes = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], grade: [] }],
      serviceData: { quantity: '30 peças' },
    },
    id: 'order-sem-tamanhos',
    missingFields: ['items[0].grade', 'finalAmount', 'paymentCondition'],
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
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items.locator('dl').first()).toContainText(
    '— (cliente informou 30 peças)',
  );
  await expect(summary).not.toContainText('é diferente');
});

test('names the fields the way the PO asked (PIT-10)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const main = page.locator('main');
  for (const label of [
    'Tipo de roupa',
    'Tamanhos',
    'Modelo de malha',
    'Forma de pagamento',
  ]) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }
  for (const old of [
    'Condição de pagamento',
    'Grade',
    'Malhas',
    'Ainda em branco na ficha',
    // ADR 020: one name per concept.
    'Tipo de serviço',
    'Técnica da arte (referência)',
    'Definição da gola',
    'Evento / Nome',
    'Pagamento',
    'Entrega realizada',
  ]) {
    await expect(main.getByText(old, { exact: true })).toHaveCount(0);
  }

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

test('edits the grade and recomputes every total from it (PFI-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho M').fill('120');
  await expect(items).toContainText('170 peças');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items).toContainText('1 item · 170 peças');
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary).toContainText('170');
  expect(writes).toHaveLength(1);
  expect(writes[0].section).toBe('items');
  expect(writes[0].body.value[0].grade).toEqual([
    { quantidade: 120, tamanho: 'M' },
    { quantidade: 50, tamanho: 'G' },
  ]);
});

test('refuses a quantity that is not a whole piece, on the line (PFI-04)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho M').fill('0');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items.getByRole('alert').first()).toContainText(
    'Use uma quantidade inteira maior que zero.',
  );
  expect(writes).toHaveLength(0);
});

test('accepts "Não aplicável" on sleeves and viés (PFI-07)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items
    .getByRole('button', { name: 'Adicionais (não obrigatórios)' })
    .click();
  await items.getByLabel('Cor do tecido — manga direita não se aplica').check();
  await items.getByRole('button', { name: 'Salvar' }).click();

  await items
    .getByRole('button', { name: /Adicionais \(não obrigatórios\)/u })
    .click();
  await expect(items.getByText('NÃO APLICÁVEL')).toBeVisible();
  expect(writes[0].body.value[0].cor_manga_direita).toBe('NAO APLICAVEL');
});

test('keeps every summary and item field as text typed by hand (PFI-14)', async ({
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

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByLabel('Tipo de roupa')).toBeEditable();
  await expect(lists).toHaveCount(0);
});

test('adds and removes items, fabrics and grade lines', async ({ page }) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByRole('button', { name: 'Adicionar tamanho' }).click();
  await items.getByLabel('Tamanho da linha 3').fill('GG');
  await items.getByLabel('Quantidade do tamanho GG').fill('10');
  await items
    .getByRole('button', { name: 'Adicionar modelo de malha' })
    .click();
  await items.getByLabel('Modelo de malha 2').fill('HELANCA LIGHT');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items).toContainText('1 item · 160 peças');
  expect(writes[0].body.value[0].grade).toHaveLength(3);
  expect(writes[0].body.value[0].malhas).toEqual([
    'DRY FIT 100% POLIÉSTER',
    'HELANCA LIGHT',
  ]);
});

test('splits an item by audience with Duplicar item, by keyboard (ADR 025, PUB-01, PUB-02, PUB-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Público').selectOption('masculino');
  await items.getByLabel('Quantidade informada').fill('150');

  const duplicate = items.getByRole('button', { name: 'Duplicar item 1' });
  await duplicate.focus();
  await page.keyboard.press('Enter');
  const copyAudience = items.locator('#item-1-publico');
  await expect(copyAudience).toBeFocused();
  await expect(
    items.getByText('Item 2 criado como cópia do item 1.'),
  ).toHaveCount(1);
  await expect(copyAudience).toHaveValue('masculino');
  await copyAudience.selectOption('feminino');
  await expect(items.locator('#item-1-informada')).toHaveValue('');
  await items.locator('#item-1-informada').fill('40');
  await items.getByRole('button', { name: 'Salvar' }).click();

  const [first, copy] = writes[0].body.value;
  expect(first.publico).toBe('masculino');
  expect(first.quantidade_informada).toBe(150);
  expect(copy.publico).toBe('feminino');
  expect(copy.quantidade_informada).toBe(40);
  expect(copy.grade).toEqual([]);
  expect(copy.tipo).toBe(first.tipo);
  expect(copy.malhas).toEqual(first.malhas);

  await expect(
    items.getByRole('heading', { name: /^Item 2 · .* · Feminino · 0 peças$/u }),
  ).toBeVisible();
  await expect(items.getByText('— (cliente informou 40)')).toBeVisible();
});

test('warns under an item whose sizes differ from the quantity said for it (ADR 025, PUB-02)', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade informada').fill('200');
  await expect(
    items.getByText(
      'A soma dos tamanhos (150) é diferente da quantidade informada (200)',
    ),
  ).toBeVisible();
  await items.getByLabel('Quantidade informada').fill('0');
  await items.getByRole('button', { name: 'Salvar' }).click();
  await expect(
    items.getByText('Use um número inteiro de 1 a 100000.'),
  ).toBeVisible();
  await expect(items.getByLabel('Quantidade informada')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('shows the server grade error on the line it names', async ({ page }) => {
  await mockOrders(page, {
    writeFailure: {
      body: { code: 'INVALID_GRADE', fields: ['items[0].grade[1]'], index: 1 },
      status: 422,
    },
  });
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await items.getByLabel('Quantidade do tamanho G').fill('7');
  await items.getByRole('button', { name: 'Salvar' }).click();

  await expect(items.getByRole('alert').first()).toContainText(
    'Use uma quantidade inteira maior que zero.',
  );
});

test('opens one section at a time (PFI-06)', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await summary.getByRole('button', { name: 'Editar' }).click();

  await expect(items.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await summary.getByRole('button', { name: 'Cancelar' }).click();
  await expect(items.getByRole('button', { name: 'Editar' })).toBeEnabled();
});

test('heads each section with its state in words and "Editar" naming the section (PFI-17)', async ({
  page,
}) => {
  await mockOrders(page, { orders: [incompleteOrder] });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const trail = page.getByRole('region', { name: 'Datas do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const artwork = page.getByRole('region', { name: 'Arte do pedido' });
  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });

  // The region keeps only the title as its name; the state sits beside it.
  await expect(
    page.getByRole('region', { exact: true, name: 'Itens e especificações' }),
  ).toHaveCount(1);
  const states = page.locator('main .op-sheet-state');
  await expect(states).toHaveText([
    'Falta entrega prometida',
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

  // Verb and object on every button; none says only "Editar".
  await expect(page.getByRole('button', { name: /^Editar\b/u })).toHaveText([
    'Editar resumo',
    'Editar datas',
    'Editar itens',
    'Editar arte',
    'Editar observações',
  ]);
  await expect(
    page.getByRole('button', { exact: true, name: 'Editar' }),
  ).toHaveCount(0);

  // Once the items are complete their state counts items and pieces.
  await items.getByRole('button', { name: 'Editar itens' }).click();
  await items.getByLabel('Cor', { exact: true }).fill('BRANCA');
  await items.getByLabel('Gola', { exact: true }).fill('GOLA V');
  await items.getByRole('button', { name: 'Salvar itens' }).click();
  await expect(items.locator('.op-sheet-state')).toHaveText(
    '1 item · 150 peças',
  );
  await expect(items.locator('.op-sheet-state')).toHaveAttribute(
    'data-tone',
    'ok',
  );

  // The promised delivery and who makes the art read as done once saved.
  await summary.getByRole('button', { name: 'Editar resumo' }).click();
  await summary.getByLabel('Entrega prometida').fill('2026-11-20');
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

test('keeps the other "Editar" focusable but unavailable, with the reason, while one section is open (PFI-17, PFI-06)', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const editItems = items.getByRole('button', { name: 'Editar itens' });
  await editItems.focus();
  await page.keyboard.press('Enter');
  await expect(items.getByLabel('Tipo de roupa')).toBeFocused();
  await items.getByLabel('Tipo de roupa').fill('REGATA');

  const others = page.getByRole('button', { name: /^Editar\b/u });
  await expect(others).toHaveText([
    'Editar resumo',
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

  // Enter and a click on a waiting button open nothing and keep the draft.
  const editSummary = summary.getByRole('button', { name: 'Editar resumo' });
  await editSummary.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await editSummary.dispatchEvent('click');
  await expect(editSummary).toBeFocused();
  await expect(summary.getByLabel('Nome do pedido')).toHaveCount(0);
  await expect(items.getByLabel('Tipo de roupa')).toHaveValue('REGATA');
  // After the attempt the reason shows on screen, next to the button.
  await expect(
    summary.getByText('Salve ou cancele a edição aberta.'),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Cancelling frees every "Editar" again, without the reason.
  await items.getByRole('button', { name: 'Cancelar' }).click();
  await expect(others).toHaveCount(5);
  for (const other of await others.all()) {
    await expect(other).not.toHaveAttribute('aria-disabled', /./u);
    await expect(other).not.toHaveAttribute('aria-describedby', /./u);
  }
  await expect(page.getByText('Salve ou cancele a edição aberta.')).toHaveCount(
    0,
  );
});

test('opens the items from the next step by keyboard, through the section itself (PFI-15, PFI-17)', async ({
  page,
}) => {
  const noColour = {
    ...pendingOrder,
    ficha: {
      ...pendingOrder.ficha,
      items: [{ ...pendingOrder.ficha.items[0], cor: '' }],
    },
    missingFields: ['items[0].cor', 'finalAmount', 'paymentCondition'],
  };
  await mockOrders(page, { orders: [noColour] });
  await page.goto('/pedidos/order-pendente');

  const progress = page.getByRole('region', { name: 'Para gerar o pedido' });
  const next = progress.getByRole('button', { name: 'Completar itens' });
  await next.focus();
  await page.keyboard.press('Enter');
  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await expect(items.getByLabel('Tipo de roupa')).toBeFocused();
  await expect(
    items.getByRole('button', { name: 'Salvar itens' }),
  ).toBeVisible();
  await expect(next).toHaveAttribute('aria-disabled', 'true');

  // Phone: the fixed footer opens the same editor.
  await items.getByRole('button', { name: 'Cancelar' }).click();
  await page.setViewportSize({ height: 844, width: 390 });
  const footer = page.locator('.op-mobile-action');
  const step = footer.getByRole('button', { name: 'Completar itens' });
  await step.focus();
  await page.keyboard.press('Enter');
  await expect(items.getByLabel('Tipo de roupa')).toBeFocused();
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
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/pedidos/order-pendente');
    const edits = page.getByRole('button', { name: /^Editar\b/u });
    await expect(edits).toHaveCount(5);
    for (const edit of await edits.all()) {
      const box = await edit.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // Something open, so the waiting buttons are checked too.
    await page
      .getByRole('region', { name: 'Observações do pedido' })
      .getByRole('button', { name: 'Editar observações' })
      .click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.setViewportSize({ height: 800, width: 1280 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
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
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeDisabled();

  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' });
  await expect(dialog).toContainText('R$ 4.820,00 · Pix');
  await dialog.getByRole('button', { name: 'Confirmar e gerar ficha' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(closing).toContainText('Pedido confirmado e ficha gerada.');
  await expect(closing).toContainText('R$ 4.820,00');
  await expect(closing).toContainText('Pix');
  await expect(closing).toContainText('Confirmado por Marina Aguiar');
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
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
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();

  await reopenButton.click();
  await reopenDialog
    .getByRole('button', { name: 'Reabrir pedido 07-CRM' })
    .click();
  await expect(reopenDialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeDisabled();
  await expect(closing).toContainText('pedido pendente');
  // PCL-07: the amount and the condition survive the reopen.
  await expect(closing.getByLabel('Valor final')).toHaveValue('4.820,00');
  expect(writes[1].action).toBe('reopen');
  await expect(
    closing.getByRole('heading', { name: 'Fechamento e pagamento' }),
  ).toBeFocused();
  const toast = page.locator('.notice-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Pedido 07-CRM reaberto.');
  await toast.getByRole('button', { name: 'Fechar aviso' }).click();
  await expect(toast).toHaveCount(0);
});

test('refuses a malformed amount next to the field, before the request', async ({
  page,
}) => {
  /** @type {any[]} */
  const writes = [];
  await mockOrders(page, { onWrite: (call) => writes.push(call) });
  await page.goto('/pedidos/order-pendente');

  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await closing.getByLabel('Valor final').fill('4,820.00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();

  await expect(closing).toContainText('Use o formato 4.820,00.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(0);
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
  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar e gerar ficha' })
    .click();

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
  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await closing.getByRole('button', { name: 'Gerar pedido' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar e gerar ficha' })
    .click();
  await expect(closing).toContainText('O pedido precisa de ao menos um item.');
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
  await expect(primary).toHaveText(['Informar entrega prometida']);
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
    name: 'Informar entrega prometida',
  });
  await expect(primary).toHaveText(['Informar entrega prometida']);
  await expect(footer.locator('button.primary')).toHaveText(
    'Informar entrega prometida',
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
      .getByLabel('Entrega prometida'),
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
    name: 'Informar entrega prometida',
  });
  await expect(progress.locator('li[aria-current="step"]')).toContainText(
    'Entrega prometida',
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
  const delivery = summary.getByLabel('Entrega prometida');
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
  // PIM-05: any operational session prints a confirmed order.
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
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
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toHaveCount(0);
  const box = await footer.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844 - 64);
  const target = await generate.boundingBox();
  expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Nothing is missing on the page but the amount: the focus goes there.
  await generate.click();
  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing.getByLabel('Valor final')).toBeFocused();
  await expect(closing).toContainText('Use o formato 4.820,00.');
  await closing.getByLabel('Valor final').fill('4.820,00');
  await closing.getByLabel('Pix').check();
  await generate.click();
  await expect(
    page.getByRole('dialog', { name: 'Gerar o pedido 07-CRM?' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');

  // The footer steps aside while a section is edited.
  await page
    .getByRole('region', { name: 'Itens e especificações' })
    .getByRole('button', { name: 'Editar' })
    .click();
  await expect(footer).toHaveCount(0);
});

test('prints a confirmed order from the footer without covering the page', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const footer = page.locator('.op-mobile-action');
  await expect(
    footer.getByRole('button', { name: 'Imprimir ficha' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Imprimir ficha' }),
  ).toHaveCount(1);
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
      name: 'Imprimir ficha',
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

test('edits the size grade with the thumb on a phone', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  const quantity = items.getByLabel('Quantidade do tamanho M');
  await expect(quantity).toHaveAttribute('inputmode', 'numeric');
  for (const control of [
    quantity,
    items.getByLabel('Tamanho da linha 1'),
    items.getByRole('button', { name: 'Uma peça a mais na linha 1' }),
    items.getByRole('button', { name: 'Uma peça a menos na linha 1' }),
    items.getByRole('button', { name: 'Remover linha 1' }),
    items.getByRole('button', { name: 'Adicionar tamanho' }).first(),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await items
    .getByRole('button', { name: 'Uma peça a mais na linha 1' })
    .click();
  await expect(quantity).toHaveValue('101');
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
  await page.setViewportSize({ height: 844, width: 390 });
  const fits = await sizes.evaluate((list) => {
    const item = /** @type {HTMLElement} */ (list.closest('.op-item'));
    const edge = item.getBoundingClientRect().right;
    return [...list.children].every(
      (tile) => tile.getBoundingClientRect().right <= edge,
    );
  });
  expect(fits).toBe(true);
});

test('warns about a repeated size while the seller types it', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-pendente');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  await items.getByRole('button', { name: 'Editar' }).click();
  await expect(items.getByText(/aparece em mais de uma linha/u)).toHaveCount(0);
  await items.getByRole('button', { name: 'Adicionar tamanho' }).click();
  await items.getByLabel('Tamanho da linha 3').fill('g');
  await expect(items).toContainText(
    'O tamanho G aparece em mais de uma linha.',
  );
  await items.getByLabel('Tamanho da linha 3').fill('GG');
  await expect(items.getByText(/aparece em mais de uma linha/u)).toHaveCount(0);
});

test('opens the filled extras of a confirmed order for the shop floor', async ({
  page,
}) => {
  await mockOrders(page);
  await page.goto('/pedidos/order-confirmado');

  const items = page.getByRole('region', { name: 'Itens e especificações' });
  const toggle = items.getByRole('button', {
    name: /Adicionais \(não obrigatórios\)/u,
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(
    items.getByText('Cor do tecido — manga direita', { exact: true }),
  ).toBeVisible();
  await expect(items).toContainText('VERDE BANDEIRA');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(
    items.getByText('Cor do tecido — manga direita', { exact: true }),
  ).toBeHidden();
});
