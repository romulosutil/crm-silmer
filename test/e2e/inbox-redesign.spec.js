import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockConversationShipping } from './support/conversation-shipping-mock.js';
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

// INBOX-RD-05: the composer in two rows. Synthetic data only.
/** @param {import('@playwright/test').Page} page */
async function fakeRecorder(page) {
  await page.addInitScript(() => {
    const scope = /** @type {any} */ (globalThis);
    scope.__capture = { requests: 0 };
    const stream = { getTracks: () => [{ stop() {} }] };
    scope.navigator.mediaDevices.getUserMedia = () => {
      scope.__capture.requests += 1;
      return Promise.resolve(stream);
    };
    scope.MediaRecorder = class extends scope.EventTarget {
      /** @param {string} type */
      static isTypeSupported(type) {
        return type === 'audio/ogg;codecs=opus';
      }
      /** @param {unknown} _stream @param {{mimeType:string}} config */
      constructor(_stream, config) {
        super();
        this.mimeType = config.mimeType;
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
      }
    };
  });
}

/** @param {import('@playwright/test').Page} page @param {string[]} names */
async function edges(page, names) {
  return page.evaluate(
    (labels) =>
      labels.map((label) => {
        const node = [
          ...globalThis.document.querySelectorAll('.inbox-composer button'),
        ].find((button) => button.getAttribute('aria-label') === label);
        if (!node) throw new Error(`Missing button ${label}`);
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    names,
  );
}

test.describe('INBOX-RD-05: compositor', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  const COMPOSER = '.inbox-composer';

  test('two rows: the field on top, media and order groups 8 px apart, one primary last', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const composer = page.locator(COMPOSER);
    const media = composer.getByRole('group', { name: 'Mídia', exact: true });
    const order = composer.getByRole('group', { name: 'Pedido', exact: true });
    await expect(media).toBeVisible();
    await expect(order).toBeVisible();
    /** @param {import('@playwright/test').Locator} group */
    const labels = (group) =>
      group
        .getByRole('button')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('aria-label')),
        );
    expect(await labels(media)).toEqual(['Anexar arquivo', 'Gravar áudio']);
    expect(await labels(order)).toEqual([
      'Cobranças e pagamentos',
      'Cotar frete',
    ]);
    // Focus order is the visual order: media, order, then the primary.
    const names = [
      'Anexar arquivo',
      'Gravar áudio',
      'Cobranças e pagamentos',
      'Cotar frete',
      'Enviar resposta',
    ];
    const boxes = await edges(page, names);
    for (let index = 1; index < boxes.length; index += 1)
      expect(boxes[index].left).toBeGreaterThan(boxes[index - 1].right);
    // 8 px between buttons inside a group.
    expect(Math.round(boxes[1].left - boxes[0].right)).toBe(8);
    expect(Math.round(boxes[3].left - boxes[2].right)).toBe(8);
    // The rule between the groups has 8 px on each side.
    const divider = await composer
      .locator('.composer-divider')
      .evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
    expect(Math.round(divider.left - boxes[1].right)).toBe(8);
    expect(Math.round(boxes[2].left - divider.right)).toBe(8);
    // Tabbing from the field walks the same order.
    await page.locator('#reply').fill('Resposta sintética');
    await page.locator('#reply').focus();
    for (const name of names) {
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('button', { name, exact: true }),
      ).toBeFocused();
    }
    // The field sits above the tool row; only "Enviar resposta" is primary.
    const rows = await page.evaluate(() => {
      const field = globalThis.document
        .querySelector('#reply')
        ?.getBoundingClientRect();
      const bar = globalThis.document
        .querySelector('.media-composer__toolbar')
        ?.getBoundingClientRect();
      return { field: field?.bottom ?? 0, bar: bar?.top ?? 0 };
    });
    expect(rows.field).toBeLessThanOrEqual(rows.bar);
    await expect(composer.locator('button.primary')).toHaveCount(1);
    await expect(composer.locator('button.primary')).toHaveAccessibleName(
      'Enviar resposta',
    );
    // Every tool is a quiet button, 44 px at least.
    for (const button of await composer
      .locator('.composer-group button')
      .all()) {
      await expect(button).toHaveClass(/quiet/u);
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('a group with no visible tool is not drawn, nor is its divider', async ({
    page,
  }) => {
    // CONV-ACL-01: an own closed conversation remains readable, while its
    // composer cannot send or offer order tools.
    const { conversations } = await mockConversationShipping(page);
    for (const conversation of conversations) conversation.state = 'encerrada';
    await page.goto('/inbox/shipping-conversation-1');
    const composer = page.locator(COMPOSER);
    await expect(
      composer.getByRole('group', { name: 'Mídia', exact: true }),
    ).toBeVisible();
    await expect(
      composer.getByRole('group', { name: 'Pedido', exact: true }),
    ).toHaveCount(0);
    await expect(composer.locator('.composer-divider')).toHaveCount(0);
  });

  test('the field has the Field anatomy and the outer box is gone', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const field = page.locator('#reply');
    await expect(field).toBeVisible();
    const tokens = await page.evaluate(() => {
      const probe = globalThis.document.createElement('div');
      probe.style.cssText =
        'border:1px solid var(--color-border-strong);background:var(--color-surface);border-radius:var(--radius-md);';
      globalThis.document.body.append(probe);
      const style = globalThis.getComputedStyle(probe);
      const resolved = {
        border: style.borderTopColor,
        fill: style.backgroundColor,
        radius: style.borderTopLeftRadius,
      };
      probe.remove();
      const own = globalThis.getComputedStyle(
        /** @type {Element} */ (globalThis.document.querySelector('#reply')),
      );
      const recorder = globalThis.getComputedStyle(
        /** @type {Element} */ (
          globalThis.document.querySelector('.inbox-composer .audio-recorder')
        ),
      );
      return {
        resolved,
        own: {
          border: own.borderTopColor,
          width: own.borderTopWidth,
          fill: own.backgroundColor,
          radius: own.borderTopLeftRadius,
          size: own.fontSize,
          weight: own.fontWeight,
        },
        outer: {
          width: recorder.borderTopWidth,
          fill: recorder.backgroundColor,
        },
      };
    });
    expect(tokens.own.border).toBe(tokens.resolved.border);
    expect(tokens.own.width).toBe('1px');
    expect(tokens.own.fill).toBe(tokens.resolved.fill);
    expect(tokens.own.radius).toBe(tokens.resolved.radius);
    expect(tokens.own.size).toBe('14px');
    expect(tokens.own.weight).toBe('400');
    // No box around the whole composer.
    expect(tokens.outer.width).toBe('0px');
    expect(tokens.outer.fill).toBe('rgba(0, 0, 0, 0)');
    // Focus swaps the border for the focus color and adds the halo.
    await field.focus();
    const focused = await field.evaluate((node) => {
      const style = globalThis.getComputedStyle(node);
      return { shadow: style.boxShadow, border: style.borderTopColor };
    });
    expect(focused.shadow).not.toBe('none');
    expect(focused.border).not.toBe(tokens.resolved.border);
    // The label stays for the screen reader; the placeholder is unchanged.
    await expect(page.getByLabel('Responder', { exact: true })).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', 'Escreva uma mensagem…');
  });

  test('words appear beside the icons only where the composer is 40rem wide', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const composer = page.locator(COMPOSER);
    await expect(composer).toBeVisible();
    /** @param {string} width */
    const labelWidths = async (width) =>
      composer.evaluate((node, value) => {
        const box = /** @type {HTMLElement} */ (node);
        // The padding centers the reading column; the content is the width.
        box.style.inlineSize = value;
        box.style.paddingInline = '0';
        return [...node.querySelectorAll('.composer-label')].map((label) =>
          Math.round(label.getBoundingClientRect().width),
        );
      }, width);
    // 48rem box, 16 px of padding on each side: 736 px of content, wide.
    const wide = await labelWidths('48rem');
    expect(wide).toHaveLength(3);
    for (const width of wide) expect(width).toBeGreaterThan(20);
    await expect(
      composer.getByRole('button', { name: 'Enviar resposta' }),
    ).toContainText('Enviar resposta');
    // Attach and record never carry words.
    await expect(
      composer.getByRole('group', { name: 'Mídia', exact: true }),
    ).not.toContainText(/\S/u);
    // 36rem box: narrow, icons only, the names stay on aria-label and title.
    const narrow = await labelWidths('36rem');
    for (const width of narrow) expect(width).toBeLessThanOrEqual(1);
    for (const name of [
      'Cobranças e pagamentos',
      'Cotar frete',
      'Enviar resposta',
    ]) {
      const button = composer.getByRole('button', { name, exact: true });
      await expect(button).toHaveAttribute(
        'title',
        new RegExp(`^${name}`, 'u'),
      );
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeLessThan(60);
    }
  });

  test('unavailable: aria-disabled with the reason visible, focusable and inert', async ({
    page,
  }) => {
    await fakeRecorder(page);
    const { calls, conversations } = await mockConversationShipping(page);
    for (const conversation of conversations) conversation.state = 'encerrada';
    await page.goto('/inbox/shipping-conversation-1');
    const composer = page.locator(COMPOSER);
    const reason = 'A conversa está encerrada.';
    const help = page.locator('#reply-help');
    await expect(help).toBeVisible();
    await expect(help).toHaveText(reason);
    const field = page.getByLabel('Responder', { exact: true });
    await expect(field).toHaveAttribute('aria-disabled', 'true');
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toHaveAccessibleDescription(reason);
    let chooser = false;
    page.on('filechooser', () => (chooser = true));
    for (const name of ['Anexar arquivo', 'Gravar áudio', 'Enviar resposta']) {
      const button = composer.getByRole('button', { name, exact: true });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      // Not the native attribute: the control keeps the keyboard.
      expect(
        await button.evaluate((node) => node.hasAttribute('disabled')),
      ).toBe(false);
      await expect(button).toHaveAccessibleDescription(reason);
      await button.focus();
      await expect(button).toBeFocused();
      await button.dispatchEvent('click');
      await button.press('Enter');
      await button.press('Space');
    }
    await page.waitForTimeout(300);
    expect(chooser).toBe(false);
    expect(
      await page.evaluate(
        () => /** @type {any} */ (globalThis).__capture.requests,
      ),
    ).toBe(0);
    expect(calls).toEqual([]);
    await expect(composer.locator('.composer-status')).toHaveCount(0);
    // The muted look says "unavailable"; the reason is words, not color.
    expect(
      await composer
        .getByRole('button', { name: 'Enviar resposta', exact: true })
        .evaluate((node) => globalThis.getComputedStyle(node).cursor),
    ).toBe('not-allowed');
  });

  test('available with no text: Enviar stays natively disabled, never aria-disabled', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const send = page
      .locator(COMPOSER)
      .getByRole('button', { name: 'Enviar resposta', exact: true });
    await expect(send).toBeDisabled();
    await expect(send).not.toHaveAttribute('aria-disabled', 'true');
    await page.locator('#reply').fill('Resposta sintética');
    await expect(send).toBeEnabled();
  });

  for (const viewport of [
    { width: 1366, height: 768, touch: false },
    { width: 390, height: 844, touch: true },
  ]) {
    test(`recording keeps the tool row in view at ${viewport.width}px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        locale: 'pt-BR',
      });
      const page = await context.newPage();
      await fakeRecorder(page);
      await mockConversationShipping(page);
      await page.goto('/inbox/shipping-conversation-1');
      const composer = page.locator(COMPOSER);
      const record = composer.getByRole('button', {
        name: 'Gravar áudio',
        exact: true,
      });
      await record.click();
      const stop = composer.getByRole('button', {
        name: 'Parar gravação',
        exact: true,
      });
      await expect(stop).toBeFocused();
      await expect(
        composer.getByText('Gravando áudio. Pare para revisar.'),
      ).toBeVisible();
      await expect(composer.getByText(/\d+ de 300 segundos/)).toBeVisible();
      await expect(
        composer.getByRole('button', {
          name: 'Descartar gravação',
          exact: true,
        }),
      ).toBeVisible();
      // The rest is unavailable while recording, with the native attribute.
      for (const name of [
        'Gravar áudio',
        'Cobranças e pagamentos',
        'Cotar frete',
        'Enviar resposta',
      ])
        await expect(
          composer.getByRole('button', { name, exact: true }),
        ).toBeDisabled();
      // Status between the field and the bar; the whole bar stays in view.
      const layout = await page.evaluate(() => {
        const rect = (/** @type {string} */ selector) =>
          /** @type {Element} */ (
            globalThis.document.querySelector(selector)
          ).getBoundingClientRect();
        return {
          field: rect('#reply').bottom,
          status: rect('.composer-status').top,
          bar: rect('.media-composer__toolbar'),
          view: globalThis.innerHeight,
          composer: rect('.inbox-composer'),
          thread: rect('.thread'),
        };
      });
      expect(layout.status).toBeGreaterThanOrEqual(layout.field);
      expect(layout.bar.top).toBeGreaterThanOrEqual(layout.status);
      expect(layout.bar.bottom).toBeLessThanOrEqual(layout.view);
      expect(layout.thread.bottom).toBeLessThanOrEqual(layout.composer.top + 1);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      // Esc discards and gives the focus back to Gravar áudio.
      await page.keyboard.press('Escape');
      await expect(stop).toHaveCount(0);
      await expect(record).toBeFocused();
      await expect(record).toBeEnabled();
      await context.close();
    });
  }

  test('axe: idle and unavailable, light and dark, have no violations', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    await expect(page.locator(COMPOSER)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      globalThis.document.documentElement.dataset.theme = 'dark';
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const { conversations } = await mockConversationShipping(page);
    for (const conversation of conversations) conversation.state = 'encerrada';
    await page.goto('/inbox/shipping-conversation-1');
    await expect(page.locator('#reply-help')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      globalThis.document.documentElement.dataset.theme = 'dark';
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('on a phone the history stays above the composer, the bar hides while typing and targets are 44 px apart by 8', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const field = page.locator('#reply');
    await expect(page.locator('.mobile-nav')).toBeVisible();
    await field.focus();
    await field.fill('Primeira linha\nSegunda linha\nTerceira linha');
    // The existing rule that takes the bottom bar away while the composer
    // holds the focus keeps working.
    await expect(page.locator('.mobile-nav')).toBeHidden();
    const layout = await page.evaluate(() => {
      const rect = (/** @type {string} */ selector) =>
        /** @type {Element} */ (
          globalThis.document.querySelector(selector)
        ).getBoundingClientRect();
      const last = /** @type {Element} */ (
        globalThis.document.querySelector('.thread')?.lastElementChild
      ).getBoundingClientRect();
      return {
        last: last.bottom,
        composer: rect('.inbox-composer').top,
        bar: rect('.media-composer__toolbar').bottom,
        view: globalThis.innerHeight,
        font: globalThis.getComputedStyle(
          /** @type {Element} */ (globalThis.document.querySelector('#reply')),
        ).fontSize,
        fits:
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      };
    });
    expect(layout.last).toBeLessThanOrEqual(layout.composer + 1);
    expect(layout.bar).toBeLessThanOrEqual(layout.view);
    expect(layout.font).toBe('16px');
    expect(layout.fits).toBe(true);
    const boxes = await edges(page, ['Anexar arquivo', 'Gravar áudio']);
    expect(Math.round(boxes[1].left - boxes[0].right)).toBe(8);
    for (const box of boxes) expect(box.width).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  for (const viewport of [
    { width: 1366, height: 768, touch: false },
    { width: 390, height: 844, touch: true },
  ]) {
    test(`a long history keeps its last message above the composer as it grows at ${viewport.width}px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        locale: 'pt-BR',
      });
      const page = await context.newPage();
      await fakeRecorder(page);
      await page.addInitScript(() => {
        const original = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (...args) => {
          const response = await original(...args);
          const input = /** @type {any} */ (args[0]);
          const url = String(input?.url ?? input);
          if (!url.endsWith('/inbox/conversations/shipping-conversation-1'))
            return response;
          const json = await response.clone().json();
          const base = json.messages[0];
          json.messages = Array.from({ length: 30 }, (_, index) => ({
            ...base,
            id: `history-${index}`,
            preview: `Mensagem sintética ${index}`,
            text: `Mensagem sintética ${index}`,
            occurredAt: `2026-11-02T14:${String(index).padStart(2, '0')}:00.000Z`,
          }));
          return new globalThis.Response(JSON.stringify(json), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };
      });
      await mockConversationShipping(page);
      await page.goto('/inbox/shipping-conversation-1');
      const field = page.locator('#reply');
      await expect(field).toBeVisible();
      await expect(page.getByText('Mensagem sintética 29')).toBeVisible();
      const tail = () =>
        page.evaluate(() => {
          const thread = /** @type {Element} */ (
            globalThis.document.querySelector('.thread')
          );
          const last = /** @type {Element} */ (
            thread.lastElementChild
          ).getBoundingClientRect();
          const composer = /** @type {Element} */ (
            globalThis.document.querySelector('.inbox-composer')
          ).getBoundingClientRect();
          const distance =
            thread.scrollHeight - thread.clientHeight - thread.scrollTop;
          return {
            last: last.bottom,
            composer: composer.top,
            distance,
            pinned: Math.abs(distance) <= 1,
          };
        });
      await field.focus();
      await field.fill('Primeira linha\nSegunda linha\nTerceira linha');
      await expect.poll(async () => (await tail()).pinned).toBe(true);
      let state = await tail();
      expect(state.last).toBeLessThanOrEqual(state.composer);
      await field.fill('');
      await page
        .getByRole('button', { name: 'Gravar áudio', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Parar gravação', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => JSON.stringify(await tail()), {
          message: 'distance to the end after the recording line appears',
        })
        .toContain('"pinned":true');
      state = await tail();
      expect(state.last).toBeLessThanOrEqual(state.composer);
      await context.close();
    });
  }

  test('a history scrolled up to read is left alone when the composer grows', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    await fakeRecorder(page);
    await page.addInitScript(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args) => {
        const response = await original(...args);
        const input = /** @type {any} */ (args[0]);
        const url = String(input?.url ?? input);
        if (!url.endsWith('/inbox/conversations/shipping-conversation-1'))
          return response;
        const json = await response.clone().json();
        const base = json.messages[0];
        json.messages = Array.from({ length: 30 }, (_, index) => ({
          ...base,
          id: `history-${index}`,
          preview: `Mensagem sintética ${index}`,
          text: `Mensagem sintética ${index}`,
          occurredAt: `2026-11-02T14:${String(index).padStart(2, '0')}:00.000Z`,
        }));
        return new globalThis.Response(JSON.stringify(json), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
    });
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    await expect(page.getByText('Mensagem sintética 29')).toBeVisible();
    const thread = page.locator('.thread');
    const distance = () =>
      thread.evaluate((element) =>
        Math.round(
          element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      );
    await thread.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(distance).toBeGreaterThan(200);
    const before = await distance();
    await page
      .getByRole('button', { name: 'Gravar áudio', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Parar gravação', exact: true }),
    ).toBeVisible();
    // Give a late observer callback the chance to (wrongly) scroll.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          );
        }),
    );
    expect(await thread.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await distance()).toBeGreaterThanOrEqual(before);
    await context.close();
  });
});

// INBOX-RD-04: the phone header in three rows, and the first tap on the
// composer tools. Synthetic data only.
test.describe('INBOX-RD-04: cabeçalho no celular', () => {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} id
   * @param {Record<string, any> | null} [order]
   */
  async function openHeader(page, id, order) {
    const { items } = await installMocks(page, { writes: [], unmocked: [] });
    if (order) {
      const item = items.find((candidate) => candidate.id === id);
      if (item) /** @type {Record<string, any>} */ (item).order = order;
    }
    await page.goto(`/inbox/${id}`);
    await page.locator('header.conv-head').waitFor();
  }

  /** @param {import('@playwright/test').Page} page */
  const headerBoxes = (page) =>
    page.evaluate(() => {
      const head = /** @type {Element} */ (
        globalThis.document.querySelector('header.conv-head')
      ).getBoundingClientRect();
      /** @param {string} selector */
      const box = (selector) => {
        const node = globalThis.document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top - head.top,
          bottom: rect.bottom - head.top,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        head: { height: head.height, width: head.width },
        back: box('.conv-back'),
        name: box('.conv-contact-name'),
        order: box('.conv-order-link'),
        identity: box('.conv-identity'),
        take: box('.conv-actions > .primary'),
        more: box('.conv-more > button'),
        details: box('.conv-context-toggle'),
        fits:
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      };
    });

  for (const width of [390, 320]) {
    test.describe(`at ${width}px`, () => {
      test.use({
        viewport: { width, height: width === 390 ? 844 : 568 },
        hasTouch: true,
        isMobile: true,
      });

      test('back, name and the two actions share row one; the order link and the identity follow', async ({
        page,
      }) => {
        await openHeader(page, 'r-elisa');
        const boxes = await headerBoxes(page);
        const { back, name, more, details, order, identity } = boxes;
        if (!back || !name || !more || !details || !order || !identity)
          throw new Error('Missing header part');
        expect(back.top).toBe(name.top);
        expect(more.top).toBe(name.top);
        expect(details.top).toBe(name.top);
        expect(order.top).toBeGreaterThanOrEqual(name.bottom);
        expect(identity.top).toBeGreaterThanOrEqual(order.bottom);
        // 44 px to the touch, 8 px between the two actions, nothing past
        // the edge.
        for (const box of [back, name, more, details, order])
          expect(box.height).toBeGreaterThanOrEqual(44);
        for (const box of [back, more, details])
          expect(box.width).toBeGreaterThanOrEqual(44);
        expect(Math.round(details.left - more.right)).toBe(8);
        expect(boxes.fits).toBe(true);
        expect(boxes.head.height).toBeLessThanOrEqual(130);
      });

      test('a long name is cut with an ellipsis and keeps its full accessible name', async ({
        page,
      }) => {
        await openHeader(page, 'r-carla');
        const button = page.getByRole('button', {
          name: 'Dados de Cliente Carla Regina Albuquerque de Souza Mendonça',
          exact: true,
        });
        await expect(button).toBeVisible();
        const cut = await button.locator('span').evaluate((node) => ({
          overflow: node.scrollWidth > node.clientWidth,
          style: globalThis.getComputedStyle(node).textOverflow,
        }));
        expect(cut).toEqual({ overflow: true, style: 'ellipsis' });
        expect((await headerBoxes(page)).fits).toBe(true);
      });

      test('Assumir atendimento takes the last row, full width, under the other parts', async ({
        page,
      }) => {
        await openHeader(page, 'r-carla', {
          id: 'order-77',
          number: '77-CRM',
          status: 'pendente',
        });
        await expect(
          page.getByRole('button', {
            name: 'Assumir atendimento',
            exact: true,
          }),
        ).toBeVisible();
        const boxes = await headerBoxes(page);
        const { name, details, order, identity, take } = boxes;
        if (!name || !details || !order || !identity || !take)
          throw new Error('Missing header part');
        expect(details.top).toBe(name.top);
        expect(take.top).toBeGreaterThanOrEqual(identity.bottom);
        expect(take.height).toBeGreaterThanOrEqual(44);
        expect(boxes.head.width - take.width).toBeLessThanOrEqual(24);
        expect(boxes.fits).toBe(true);
      });
    });
  }

  test.describe('on the desktop', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('the header stays one row of flex boxes', async ({ page }) => {
      await openHeader(page, 'r-elisa');
      const flow = await page.evaluate(() => {
        /** @param {string} selector */
        const display = (selector) =>
          globalThis.getComputedStyle(
            /** @type {Element} */ (
              globalThis.document.querySelector(selector)
            ),
          ).display;
        return [
          display('header.conv-head'),
          display('.conv-title'),
          display('.conv-actions'),
        ];
      });
      expect(flow).toEqual(['flex', 'block', 'flex']);
      expect((await headerBoxes(page)).head.height).toBeLessThan(100);
    });
  });
});

test.describe('INBOX-RD-04: ferramentas do compositor ao toque', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  /** @param {import('@playwright/test').Page} page @param {string} name */
  async function tap(page, name) {
    const button = page
      .locator('.inbox-composer')
      .getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (!box) throw new Error(`No box for ${name}`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  test('one tap on Anexar opens the file picker and the bar stays', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    await expect(page.locator('.mobile-nav')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await tap(page, 'Anexar arquivo');
    await chooser;
    await expect(page.locator('.mobile-nav')).toBeVisible();
  });

  test('one tap on Gravar áudio asks for the microphone once', async ({
    page,
  }) => {
    await fakeRecorder(page);
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    await expect(page.locator('.mobile-nav')).toBeVisible();
    await tap(page, 'Gravar áudio');
    await expect(
      page
        .locator('.inbox-composer')
        .getByRole('button', { name: 'Parar gravação', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => /** @type {any} */ (globalThis).__capture.requests,
      ),
    ).toBe(1);
  });

  test('the bar leaves while the reply field has the focus and comes back when it loses it', async ({
    page,
  }) => {
    await mockConversationShipping(page);
    await page.goto('/inbox/shipping-conversation-1');
    const nav = page.locator('.mobile-nav');
    await expect(nav).toBeVisible();
    const field = page.locator('#reply');
    const box = await field.boundingBox();
    if (!box) throw new Error('No reply box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field).toBeFocused();
    await expect(nav).toBeHidden();
    await field.evaluate((node) => node.blur());
    await expect(nav).toBeVisible();
  });
});
