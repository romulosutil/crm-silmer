import { createHash } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { projectOrderReceipt } from '../../modules/orders/src/print/order-receipt.js';
import {
  eventStreamBody,
  mockOrders,
  ownConfirmedOrder,
  pendingOrder,
  pricedPendingOrder,
} from './support/orders-mock.js';

const DIALOG = { name: /Recibo do pedido/u };
/** @param {import('@playwright/test').Page} page @param {any} [options] */
async function setup(page, options = {}) {
  const fixtures = options.orders ?? [ownConfirmedOrder, pendingOrder];
  const state = await mockOrders(page, {
    ...options,
    orders: fixtures.map((/** @type {any} */ order) => ({
      receiptAvailable: true,
      ...structuredClone(order),
    })),
  });
  const control = {
    previewStatus: 0,
    pdfStatus: 0,
    previewReads: 0,
    pdfReads: 0,
    /** @type {Promise<void>|null} */ previewGate: null,
    /** @type {Promise<void>|null} */ pdfGate: null,
  };
  const projection = (/** @type {any} */ order) =>
    projectOrderReceipt(order, { issuedAt: new Date('2026-11-13T01:00:00Z') });
  const hash = (/** @type {any} */ receipt) =>
    createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  await page.route(
    /\/api\/v1\/orders\/([^/]+)\/receipt(?:\/pdf)?(?:\?|$)/u,
    async (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split('/')[4];
      const order = state.orders.find((order) => order.id === id);
      const pdf = url.pathname.endsWith('/pdf');
      if (pdf) {
        control.pdfReads++;
        if (control.pdfGate) await control.pdfGate;
      } else {
        control.previewReads++;
        if (control.previewGate) await control.previewGate;
      }
      const status = pdf ? control.pdfStatus : control.previewStatus;
      if (status || !order || order.receiptAvailable !== true) {
        const code =
          status === 409
            ? 'RECEIPT_STALE'
            : status === 503
              ? 'SERVICE_UNAVAILABLE'
              : 'FORBIDDEN';
        return route.fulfill({
          status: status || 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code } }),
        });
      }
      const receipt = projection(order);
      const fingerprint = hash(receipt);
      if (pdf) {
        if (
          url.searchParams.get('expectedVersion') !== String(receipt.version) ||
          url.searchParams.get('fingerprint') !== fingerprint
        )
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'RECEIPT_STALE' } }),
          });
        return route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          body: '%PDF-1.4\n% synthetic receipt\n',
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ receipt, fingerprint }),
      });
    },
  );
  return { ...state, control };
}

test('RCP-01/02/12: list action is between PDF/open and returns to the same filtered row and scroll', async ({
  page,
}) => {
  const many = Array.from({ length: 35 }, (_, i) => ({
    ...pendingOrder,
    id: `order-row-${i}`,
    number: `${10 + i}-CRM`,
    ficha: {
      ...pendingOrder.ficha,
      summary: {
        ...pendingOrder.ficha.summary,
        cliente: `Cliente exemplo ${i}`,
      },
    },
  }));
  await setup(page, { orders: [ownConfirmedOrder, ...many] });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/pedidos');
  const confirmed = page
    .locator('.order-table tbody tr')
    .filter({ hasText: '05-CRM' });
  await expect(confirmed.locator('.row-actions')).toHaveText(
    /Gerar PDF\s*05-CRM\s*Recibo\s*05-CRM\s*Abrir pedido/u,
  );
  const search = page.getByRole('searchbox');
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/orders' &&
      url.searchParams.get('q') === 'Cliente'
    );
  });
  await search.fill('Cliente');
  await filtered;
  await expect(search).toHaveValue('Cliente');
  const list = page.getByRole('region', { name: 'Pedidos pendentes' });
  const button = list.getByRole('button', {
    name: 'Recibo 44-CRM',
    exact: true,
  });
  await button.focus();
  const before = await list.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('article')).toContainText('Cliente exemplo 34');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(search).toHaveValue('Cliente');
  expect(await list.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(page).toHaveURL(/\/pedidos$/u);
});

test('RCP-01/03/06: list downloads a confirmed receipt and keeps the factory PDF independent', async ({
  page,
}) => {
  const { control } = await setup(page);
  await page.goto('/pedidos');
  const row = page.locator('tbody tr').filter({ hasText: '05-CRM' });
  await row.getByRole('button', { name: 'Recibo 05-CRM', exact: true }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('article')).toContainText('Pedido confirmado');
  await expect(dialog.getByRole('article')).not.toContainText('provisório');
  await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Baixar PDF' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath('receipt-desktop.png'),
    fullPage: true,
  });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('recibo-05-CRM.pdf');
  expect(control.pdfReads).toBe(1);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  const factory = page.waitForEvent('download');
  await row
    .getByRole('button', { name: 'Gerar PDF 05-CRM', exact: true })
    .click();
  expect((await factory).suggestedFilename()).toBe('pedido-05-CRM.pdf');
});

test('RCP-01/03/04: detail preserves existing actions and pending receipt shows unknown prices', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/pedidos/order-pendente');
  const open = page.getByRole('button', {
    name: 'Recibo do pedido',
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Abrir conversa' }),
  ).toBeVisible();
  await open.click();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('article')).toContainText(
    'Pedido pendente · resumo provisório, sujeito a alterações.',
  );
  await expect(dialog.locator('.receipt-total')).toHaveText(
    'Total do pedidoA definir',
  );
  await expect(dialog.getByRole('article')).not.toContainText('R$ 0,00');
  await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(open).toBeFocused();
});

test('RCP-08: absent/false receiptAvailable never gains access from owner, admin or Olist flags', async ({
  page,
}) => {
  await setup(page, {
    orders: [
      { ...ownConfirmedOrder, receiptAvailable: false },
      { ...pendingOrder, receiptAvailable: undefined },
    ],
    user: { capabilities: ['COMMERCIAL_ADMIN'], olistEnabled: true },
  });
  await page.goto('/pedidos');
  await expect(page.getByRole('button', { name: /^Recibo/u })).toHaveCount(0);
  await page.goto('/pedidos/order-confirmado');
  await expect(
    page.getByRole('button', { name: 'Recibo do pedido' }),
  ).toHaveCount(0);
});

test('RCP-07/09: PDF failure permits explicit retry; stale preview discards data and requires refresh', async ({
  page,
}) => {
  const { control, orders } = await setup(page);
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  control.pdfStatus = 503;
  await dialog.getByRole('button', { name: 'Baixar PDF' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Não foi possível gerar o recibo. Tente novamente.',
  );
  control.pdfStatus = 409;
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Baixar PDF' })).toHaveCount(
    0,
  );
  control.pdfStatus = 0;
  orders[0].version += 1;
  orders[0].ficha.summary.cliente = 'Cliente atualizado';
  await dialog.getByRole('button', { name: 'Atualizar prévia' }).click();
  await expect(dialog.getByRole('article')).toContainText('Cliente atualizado');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar PDF' }).click();
  expect((await download).suggestedFilename()).toBe('recibo-05-CRM.pdf');
});

test('RCP-08: permission loss during download removes content and does not retry', async ({
  page,
}) => {
  const { control } = await setup(page);
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  control.pdfStatus = 403;
  await dialog.getByRole('button', { name: 'Baixar PDF' }).click();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText(
    'Seu acesso a este recibo mudou',
  );
  await expect(
    dialog.getByRole('button', { name: /Atualizar|Tentar novamente|Baixar/u }),
  ).toHaveCount(0);
});

test('RCP-09: preview read failure allows explicit retry', async ({ page }) => {
  const { control } = await setup(page);
  control.previewStatus = 503;
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('alert')).toHaveText(
    'Não foi possível carregar o recibo. Tente novamente.',
  );
  await expect(dialog.getByRole('article')).toHaveCount(0);
  control.previewStatus = 0;
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.getByRole('article')).toContainText('Buffet Casa Rosa');
  expect(control.previewReads).toBe(2);
});

for (const type of [
  'inbox.order.changed',
  'inbox.conversation.changed',
  'inbox.contact.changed',
]) {
  test(`RCP-07: unrelated ${type} preserves the open receipt`, async ({
    page,
  }) => {
    let reads = 0;
    await setup(page, { onList: () => reads++ });
    /** @type {()=>void} */ let send = () => {};
    const gate = new Promise((resolve) => {
      send = () => resolve(undefined);
    });
    await page.route(/\/api\/v1\/events\?/u, async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: eventStreamBody({
          type,
          payload: {
            orderId: 'other-order',
            conversationId: 'other-conversation',
            contactId: 'other-contact',
          },
        }),
      });
    });
    await page.goto('/pedidos');
    await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog.getByRole('article')).toContainText('Buffet Casa Rosa');
    const before = reads;
    send();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(dialog.getByRole('article')).toContainText('Buffet Casa Rosa');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });
}

test('RCP-07/08: relevant SSE and refreshed access metadata discard the document', async ({
  page,
}) => {
  const { orders } = await setup(page);
  /** @type {()=>void} */ let send = () => {};
  const gate = new Promise((resolve) => {
    send = () => resolve(undefined);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: eventStreamBody({
        type: 'inbox.order.changed',
        payload: { orderId: 'order-confirmado' },
      }),
    });
  });
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('article')).toContainText('Buffet Casa Rosa');
  orders[0].receiptAvailable = false;
  send();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText(
    'Seu acesso a este recibo mudou',
  );
  await expect(
    dialog.getByRole('button', { name: /Atualizar|Tentar novamente|Baixar/u }),
  ).toHaveCount(0);
});

test('RCP-07: closing a loading preview and opening another target rejects the late response', async ({
  page,
}) => {
  const { control } = await setup(page);
  /** @type {()=>void} */ let release = () => {};
  control.previewGate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('status')).toHaveText('Carregando recibo…');
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  control.previewGate = null;
  await page.getByRole('button', { name: 'Recibo 07-CRM' }).click();
  await expect(dialog.getByRole('article')).toContainText('Colégio Ápice');
  release();
  await expect(dialog.getByRole('article')).not.toContainText(
    'Buffet Casa Rosa',
  );
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
    'Recibo do pedido 07-CRM',
  );
});

test('RCP-07: closing an in-flight download never downloads prepared bytes into another preview', async ({
  page,
}) => {
  const { control } = await setup(page);
  /** @type {()=>void} */ let release = () => {};
  control.pdfGate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto('/pedidos');
  await page.getByRole('button', { name: 'Recibo 05-CRM' }).click();
  const dialog = page.getByRole('dialog', DIALOG);
  await dialog.getByRole('button', { name: 'Baixar PDF' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Gerando PDF…' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Recibo 07-CRM' }).click();
  await expect(dialog.getByRole('article')).toContainText('Colégio Ápice');
  release();
  await expect.poll(() => control.pdfReads).toBe(1);
  await expect(dialog.getByRole('article')).toContainText('Colégio Ápice');
  expect(downloads).toBe(0);
});

test('RCP-09: opening waits for blur autosave to finish and uses its saved revision', async ({
  page,
}) => {
  const { control } = await setup(page, { orders: [pricedPendingOrder] });
  /** @type {()=>void} */ let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route(
    /\/api\/v1\/orders\/[^/]+\/sections\/size-pricing$/u,
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.goto('/pedidos/order-pendente');
  const field = page
    .getByRole('region', { name: 'Itens e especificações' })
    .getByLabel('Cor', { exact: true });
  await field.fill('PRETA');
  await page
    .getByRole('button', { name: 'Recibo do pedido', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Preparando recibo…' }),
  ).toBeDisabled();
  expect(control.previewReads).toBe(0);
  await page
    .getByRole('textbox', { name: 'Nome do pedido', exact: true })
    .fill('Nome salvo durante a espera');
  release();
  const dialog = page.getByRole('dialog', DIALOG);
  await expect(dialog.getByRole('article')).toContainText('PRETA');
  await expect(dialog.getByRole('article')).toContainText(
    'Nome salvo durante a espera',
  );
  await expect(dialog.locator('.receipt-footer')).toContainText('Versão 4');
});

test('RCP-09: another successful section cannot clear a failed autosave; corrected section can', async ({
  page,
}) => {
  let fail = true;
  const { control } = await setup(page, {
    orders: [pricedPendingOrder],
    sectionFailure: (/** @type {any} */ call) =>
      call.section === 'size-pricing' && fail
        ? { status: 503, body: { code: 'SERVICE_UNAVAILABLE' } }
        : null,
  });
  await page.goto('/pedidos/order-pendente');
  const field = page
    .getByRole('region', { name: 'Itens e especificações' })
    .getByLabel('Cor', { exact: true });
  await field.fill('PRETA');
  await field.press('Enter');
  await expect(page.locator('#item-0-cor-error')).toBeVisible();
  const name = page.getByRole('textbox', {
    name: 'Nome do pedido',
    exact: true,
  });
  await name.fill('Nome atualizado');
  await name.press('Enter');
  await page
    .getByRole('button', { name: 'Recibo do pedido', exact: true })
    .click();
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Corrija ou salve novamente' }),
  ).toBeVisible();
  expect(control.previewReads).toBe(0);
  fail = false;
  await page
    .locator('#item-0-cor-error')
    .getByRole('button', { name: 'Tentar de novo' })
    .click();
  await expect(page.locator('#item-0-cor-error')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Recibo do pedido', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', DIALOG).getByRole('article'),
  ).toContainText('PRETA');
});

for (const width of [320, 390])
  for (const theme of ['light', 'dark']) {
    test(`RCP-10/11: ${width}px ${theme} keeps paper/table readable, escaped and accessible`, async ({
      page,
    }) => {
      const source = structuredClone(ownConfirmedOrder);
      source.ficha.summary.cliente = '<img src=x onerror=alert(1)> Cliente';
      await setup(page, { orders: [source] });
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(
        (value) => globalThis.localStorage.setItem('crm-theme', value),
        theme,
      );
      await page.goto('/pedidos/order-confirmado');
      await page.evaluate(
        (value) => (globalThis.document.documentElement.dataset.theme = value),
        theme,
      );
      await page
        .getByRole('button', { name: 'Recibo do pedido', exact: true })
        .click();
      const dialog = page.getByRole('dialog', DIALOG);
      await expect(dialog.getByRole('article')).toContainText(
        '<img src=x onerror=alert(1)> Cliente',
      );
      expect(await dialog.locator('img,script,iframe').count()).toBe(0);
      const metrics = await dialog.evaluate((el) => ({
        overflow: el.scrollWidth - el.clientWidth,
        cells: [...el.querySelectorAll('.receipt-table td')].map(
          (cell) => globalThis.getComputedStyle(cell).color,
        ),
        paper: globalThis.getComputedStyle(
          /** @type {HTMLElement} */ (el.querySelector('.receipt-paper')),
        ).backgroundColor,
      }));
      expect(metrics.overflow).toBeLessThanOrEqual(1);
      expect(metrics.paper).toBe('rgb(255, 255, 255)');
      expect(metrics.cells.every((color) => color === 'rgb(32, 22, 52)')).toBe(
        true,
      );
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`receipt-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Recibo do pedido', exact: true }),
      ).toBeFocused();
    });
  }
