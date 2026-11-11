import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// INBOX-RD-T01/T02/T03/T08: wider list, "Mensagem nova", grouped history,
// header targets and the Atendimento tabs, against the simulated API.
// Synthetic data only.
test.use({
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  // @ts-ignore reducedMotion exists at runtime
  reducedMotion: 'reduce',
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'crm_csrf',
      value: 'synthetic-csrf',
      url: baseURL ?? 'http://127.0.0.1:4293',
    },
  ]);
});

/** @param {import('@playwright/test').Page} page */
async function keepEventSources(page) {
  await page.addInitScript(() => {
    const scope = /** @type {any} */ (globalThis);
    const Base = scope.EventSource;
    /** @type {any[]} */
    const sources = [];
    scope.__sources = sources;
    scope.EventSource = class extends Base {
      /** @param {...any} args */
      constructor(...args) {
        super(...args);
        sources.push(this);
      }
    };
  });
}

/** @param {import('@playwright/test').Page} page */
async function liveChange(page) {
  await page.evaluate(() => {
    const source = /** @type {any} */ (globalThis).__sources.at(-1);
    source.dispatchEvent(
      new globalThis.MessageEvent('inbox.conversation.changed', { data: '{}' }),
    );
  });
}

/**
 * The customer writes again in a conversation the list already knows.
 *
 * @param {Array<Record<string, any>>} items
 * @param {string} id
 * @param {string} at ISO instant
 */
function customerWrites(items, id, at) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing synthetic conversation ${id}`);
  item.updatedAt = at;
  item.lastMessage = {
    ...item.lastMessage,
    id: `message-${id}-${at}`,
    direction: 'inbound',
    authorKind: 'contact',
    preview: 'Mensagem sintética nova',
    text: 'Mensagem sintética nova',
    occurredAt: at,
  };
}

/** @param {import('@playwright/test').Page} page @param {string} id */
const card = (page, id) =>
  page.locator(`.conversation-row[data-conversation-id="${id}"]`);
/** @param {import('@playwright/test').Page} page */
const shellStatus = (page) => page.locator('p.sr-only[role="status"]').first();

test.describe('INBOX-RD-02: mensagem nova', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('first load marks nothing; an arrival marks the card once and opening clears it', async ({
    page,
  }) => {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    await keepEventSources(page);
    await page.goto('/inbox');
    await card(page, 'r-gabi').waitFor();
    // Negative: nothing arrived yet, so nothing is marked.
    await expect(page.locator('[data-unread="true"]')).toHaveCount(0);
    await expect(page.locator('.inbox-unread-notice')).toHaveCount(0);
    await expect(card(page, 'r-gabi')).toHaveAttribute('aria-current', 'true');

    customerWrites(items, 'r-fabio', '2026-11-06T17:29:00.000Z');
    await liveChange(page);
    const fabio = card(page, 'r-fabio');
    await expect(fabio).toHaveAttribute('data-unread', 'true');
    // The seal is the first one, with words and an icon, never color alone.
    const seal = fabio.locator('.conv-badges .badge').first();
    await expect(seal).toHaveText('Mensagem nova');
    await expect(seal).toHaveAttribute('data-tone', 'info');
    await expect(seal.locator('svg')).toHaveCount(1);
    expect(
      await fabio.locator('.conv-badges > .badge:not([data-overflow])').count(),
    ).toBeLessThanOrEqual(2);
    await expect(
      page.getByRole('button', { name: /^Mensagem nova\. Cliente Fábio R\./u }),
    ).toHaveCount(1);
    const preview = await fabio
      .locator('.conv-preview')
      .evaluate((element) => globalThis.getComputedStyle(element).fontWeight);
    expect(preview).toBe('500');
    // One announcement, by the shell's status region; the list summary is
    // not a live region for this silent read.
    await expect(shellStatus(page)).toHaveText(
      'Mensagem nova na Caixa de Entrada.',
    );
    await expect(page.locator('.inbox-list-summary')).toHaveAttribute(
      'aria-live',
      'off',
    );
    await expect(
      page.locator('.inbox-unread-notice [role="status"]'),
    ).toHaveCount(0);

    await fabio.click();
    await expect(fabio).toHaveAttribute('aria-current', 'true');
    await expect(fabio).not.toHaveAttribute('data-unread', 'true');
    await expect(page.locator('[data-unread="true"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('a message in the open conversation never marks it', async ({
    page,
  }) => {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    await keepEventSources(page);
    await page.goto('/inbox/r-joao');
    await expect(card(page, 'r-joao')).toHaveAttribute('aria-current', 'true');
    customerWrites(items, 'r-joao', '2026-11-06T17:29:30.000Z');
    await liveChange(page);
    await expect(card(page, 'r-joao').locator('.conv-preview')).toContainText(
      'Mensagem sintética nova',
    );
    await expect(card(page, 'r-joao')).not.toHaveAttribute(
      'data-unread',
      'true',
    );
    await expect(page.locator('[data-unread="true"]')).toHaveCount(0);
  });

  test('the notice shows marks from another tab and "Ver mensagens novas" brings the focus to them', async ({
    page,
  }) => {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    await keepEventSources(page);
    await page.goto('/inbox');
    await card(page, 'r-gabi').waitFor();
    customerWrites(items, 'r-fabio', '2026-11-06T17:29:00.000Z');
    await liveChange(page);
    await expect(card(page, 'r-fabio')).toHaveAttribute('data-unread', 'true');
    // Every mark in sight: no notice.
    await expect(page.locator('.inbox-unread-notice')).toHaveCount(0);

    await page.getByRole('tab', { name: /^Aguardando/u }).click();
    await card(page, 'a-katia').waitFor();
    const notice = page.locator('.inbox-unread-notice');
    await expect(notice).toContainText(
      '1 conversa com mensagem nova em Responder',
    );
    await notice.getByRole('button', { name: 'Ver mensagens novas' }).click();
    await expect(
      page.getByRole('tab', { name: /^Responder/u }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(card(page, 'r-fabio')).toBeFocused();
    await expect(page.locator('.inbox-list')).toHaveJSProperty('scrollTop', 0);
    await expect(notice).toHaveCount(0);
  });

  test('a search that hides a marked card shows the notice; the button clears it', async ({
    page,
  }) => {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    await keepEventSources(page);
    await page.goto('/inbox');
    await card(page, 'r-gabi').waitFor();
    customerWrites(items, 'r-fabio', '2026-11-06T17:29:00.000Z');
    await liveChange(page);
    await expect(card(page, 'r-fabio')).toHaveAttribute('data-unread', 'true');
    await page.locator('#inbox-search').fill('Gabi');
    const notice = page.locator('.inbox-unread-notice');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Ver mensagens novas' }).click();
    await expect(page.locator('#inbox-search')).toHaveValue('');
    await expect(card(page, 'r-fabio')).toBeFocused();
  });

  test('blocked browser storage keeps the Inbox working', async ({ page }) => {
    await page.addInitScript(() => {
      // Private mode or a full quota: every read and write is refused.
      const deny = () => {
        throw new Error('storage blocked');
      };
      globalThis.Storage.prototype.getItem = deny;
      globalThis.Storage.prototype.setItem = deny;
      globalThis.Storage.prototype.removeItem = deny;
    });
    const errors = /** @type {string[]} */ ([]);
    // Only the app's own code: the theme bootstrap inline in index.html is
    // outside this slice.
    page.on('pageerror', (error) => {
      if (String(error.stack).includes('/assets/')) errors.push(error.message);
    });
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    await keepEventSources(page);
    await page.goto('/inbox');
    await card(page, 'r-gabi').waitFor();
    customerWrites(items, 'r-fabio', '2026-11-06T17:29:00.000Z');
    await liveChange(page);
    await expect(card(page, 'r-fabio')).toHaveAttribute('data-unread', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('INBOX-RD-03: histórico agrupado', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  /** Synthetic thread around NOW (Fri 06/11/2026 14:30 in São Paulo). */
  const THREAD = [
    // Yesterday 23:58, then today 00:03: five minutes, but another day.
    [
      'd1',
      'contact',
      'inbound',
      '2026-11-06T02:58:00.000Z',
      'Mensagem de ontem',
    ],
    [
      'c1',
      'contact',
      'inbound',
      '2026-11-06T03:03:00.000Z',
      'Primeira de hoje',
    ],
    ['c2', 'contact', 'inbound', '2026-11-06T03:04:00.000Z', 'Segunda de hoje'],
    // Nineteen minutes later: a pause opens a new group.
    ['c3', 'contact', 'inbound', '2026-11-06T03:23:00.000Z', 'CEP 29700-010'],
    [
      'a1',
      'assistant',
      'outbound',
      '2026-11-06T03:24:00.000Z',
      'Resposta da IA',
    ],
    ['a2', 'assistant', 'outbound', '2026-11-06T03:25:00.000Z', 'Mais da IA'],
    ['h1', 'human', 'outbound', '2026-11-06T03:26:00.000Z', 'Falhou'],
    ['h2', 'human', 'outbound', '2026-11-06T03:27:00.000Z', 'Depois da falha'],
    [
      'h3',
      'human',
      'outbound',
      '2026-11-06T03:28:00.000Z',
      'Junto da anterior',
    ],
  ].map(([id, authorKind, direction, occurredAt, preview]) => ({
    id,
    type: 'text',
    authorKind,
    authorId: authorKind === 'human' ? 'seller-bia' : null,
    direction,
    occurredAt,
    preview,
    text: preview,
    status: id === 'h1' ? 'failed' : 'delivered',
    deliveryStatus: id === 'h1' ? 'failed' : 'delivered',
  }));

  test('groups by author, day and pause; each message still says who and when', async ({
    page,
  }) => {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    const joao = items.find((item) => item.id === 'r-joao');
    await page.route('**/api/v1/inbox/conversations/r-joao', (route) =>
      route.fulfill({
        json: { conversation: joao, messages: THREAD, suggestion: null },
      }),
    );
    await page.goto('/inbox/r-joao');
    const thread = page.getByRole('list', { name: 'Histórico da conversa' });
    await expect(thread.locator('.message')).toHaveCount(THREAD.length);
    const starts = await thread
      .locator('.message[data-group-start="true"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-message-id')),
      );
    // d1 (first), c1 (new day), c3 (pause), a1 (author), h1 (failed send,
    // alone), h2 (after the failure); c2, a2 and h3 join their group.
    expect(starts).toEqual(['d1', 'c1', 'c3', 'a1', 'h1', 'h2']);
    await expect(thread.locator('.msg-head')).toHaveCount(6);
    await expect(thread.locator('.msg-head').first()).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // Author and time per message, also inside a group.
    await expect(
      thread.locator('[data-message-id="c2"] .sr-only').first(),
    ).toHaveText('Cliente João V., 00:04:');
    await expect(
      thread.locator('[data-message-id="a2"] .sr-only').first(),
    ).toHaveText('Agente, IA, 00:25:');
    await expect(
      thread.locator('[data-message-id="d1"] .sr-only').first(),
    ).toHaveText('Cliente João V., 05/11, 23:58:');
    await expect(thread.locator('[data-message-id="c2"] .msg-time')).toHaveText(
      '00:04',
    );
    // Shortcuts, delivery notices and metadata keep working inside groups.
    await expect(
      thread
        .locator('[data-message-id="c3"]')
        .getByRole('button', { name: 'Cotar para CEP 29700-010' }),
    ).toBeVisible();
    await expect(
      thread.locator('[data-message-id="h1"] .message-delivery-notice'),
    ).toBeVisible();
    // 4 px inside a group, 16 px before the next.
    const gaps = await thread.evaluate((element) => {
      const style = (/** @type {string} */ id) =>
        globalThis.getComputedStyle(
          /** @type {Element} */ (
            element.querySelector(`[data-message-id="${id}"]`)
          ),
        ).marginBlockStart;
      return { inGroup: style('c2'), newGroup: style('c3') };
    });
    expect(gaps).toEqual({ inGroup: '4px', newGroup: '16px' });
    // Reading column: centered, never wider than 48rem; bubbles up to 34rem.
    const column = await thread.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      const bubbles = [...element.querySelectorAll('.msg-bubble')].map(
        (bubble) => bubble.getBoundingClientRect().width,
      );
      return {
        content:
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
        widest: Math.max(...bubbles),
      };
    });
    expect(column.content).toBeLessThanOrEqual(768 + 1);
    expect(Math.abs(column.left - column.right)).toBeLessThanOrEqual(1);
    expect(column.widest).toBeLessThanOrEqual(544 + 1);
    // No 700 in the conversation.
    const bold = await page
      .locator('.inbox-conversation')
      .evaluate(
        (element) =>
          [...element.querySelectorAll('*')].filter(
            (node) =>
              node.checkVisibility() &&
              Number(globalThis.getComputedStyle(node).fontWeight) >= 700,
          ).length,
      );
    expect(bold).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

test.describe('INBOX-RD-03: cabeçalho da conversa', () => {
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`header actions are 40 px with a mouse, 8 px apart, at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await installMocks(page, { writes: [], unmocked: [] });
      await page.goto('/inbox/r-carla');
      const take = page.getByRole('button', {
        name: 'Assumir atendimento',
        exact: true,
      });
      await expect(take).toBeVisible();
      const minimum = viewport.width <= 768 ? 44 : 40;
      const sizes = await page
        .locator('.conv-actions')
        .evaluate((element) =>
          [...element.querySelectorAll(':scope > button, .conv-more > button')]
            .filter((node) => node.checkVisibility())
            .map((node) => Math.round(node.getBoundingClientRect().height)),
        );
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(minimum);
      expect(
        await page
          .locator('.conv-actions')
          .evaluate(
            (element) => globalThis.getComputedStyle(element).columnGap,
          ),
      ).toBe('8px');
    });
  }

  test('the order status in the header is icon and words', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    const joao = /** @type {Record<string, any>} */ (
      items.find((item) => item.id === 'r-joao')
    );
    joao.order = { id: 'order-77', number: '77-CRM', status: 'pendente' };
    await page.goto('/inbox/r-joao');
    const seal = page.locator('.conv-order-link .badge');
    await expect(seal).toHaveText('Pendente');
    await expect(seal).toHaveAttribute('data-tone', 'warning');
    await expect(seal.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(page.locator('.conv-order-link')).toHaveAccessibleName(
      'Abrir pedido 77-CRM, pendente',
    );
  });
});

test.describe('INBOX-RD-08: painel Atendimento', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the two sections are real tabs, by keyboard, with the order first', async ({
    page,
  }) => {
    await installMocks(
      page,
      { writes: [], unmocked: [] },
      { fixedClock: false },
    );
    await page.goto('/inbox/r-joao');
    const toggle = page.getByRole('button', {
      name: 'Detalhes do atendimento',
      exact: true,
    });
    await toggle.click();
    const drawer = page.getByRole('dialog', {
      name: 'Atendimento',
      exact: true,
    });
    const list = drawer.getByRole('tablist', { name: 'Seções do atendimento' });
    await expect(list).toBeVisible();
    const orders = list.getByRole('tab', { name: 'Pedidos e assuntos' });
    const summary = list.getByRole('tab', { name: 'Resumo' });
    // The default section did not change.
    await expect(orders).toHaveAttribute('aria-selected', 'true');
    await expect(orders).toHaveAttribute('tabindex', '0');
    await expect(summary).toHaveAttribute('tabindex', '-1');
    const ordersPanel = drawer.getByRole('tabpanel', {
      name: 'Pedidos e assuntos',
    });
    await expect(ordersPanel).toBeVisible();
    // The order summary is the panel's first block.
    expect(
      await ordersPanel.evaluate(
        (element) =>
          element.firstElementChild?.classList.contains(
            'context-order-summary',
          ) ?? false,
      ),
    ).toBe(true);
    await expect(
      ordersPanel.getByRole('heading', { name: 'Assuntos do atendimento' }),
    ).toBeVisible();

    await orders.focus();
    await page.keyboard.press('ArrowRight');
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute('aria-selected', 'true');
    await expect(ordersPanel).toBeHidden();
    const summaryPanel = drawer.getByRole('tabpanel', { name: 'Resumo' });
    await expect(summaryPanel).toContainText('Responsável');
    await page.keyboard.press('ArrowRight');
    await expect(orders).toBeFocused();
    await page.keyboard.press('End');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Home');
    await expect(orders).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute('tabindex', '0');
    await expect(orders).toHaveAttribute('tabindex', '-1');
    // Tab leaves the tablist for the panel, not for the other tab.
    await page.keyboard.press('Tab');
    await expect(summaryPanel).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

test.describe('INBOX-RD-01: lista mais larga', () => {
  for (const [width, expected] of [
    [1366, 300],
    [1024, 245.76],
    [800, 224],
  ]) {
    test(`the list column is ${expected}px at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await installMocks(page, { writes: [], unmocked: [] });
      await page.goto('/inbox');
      await card(page, 'r-gabi').waitFor();
      const box = await page.locator('.inbox-list-pane').boundingBox();
      expect(Math.abs((box?.width ?? 0) - expected)).toBeLessThanOrEqual(1);
    });
  }

  test('a phone keeps the list across the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMocks(page, { writes: [], unmocked: [] });
    await page.goto('/inbox');
    await card(page, 'r-gabi').waitFor();
    const box = await page.locator('.inbox-list-pane').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(340);
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
  });
});
