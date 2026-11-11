// @ts-nocheck -- doubles de navegador (EventSource, Storage) sem tipos.
import { expect, test } from '@playwright/test';

// INBOX-RD-07 (navegação agrupada) e INBOX-RD-02 parte 2 (contador e título
// no shell). A API e o EventSource são simulados; nenhum dado real.

const ADMIN = {
  capabilities: ['COMMERCIAL_ADMIN'],
  email: 'admin@crm-silmer.local',
  functionName: 'Vendedor',
  id: 'admin-1',
  name: 'Admin Comercial',
};
const SELLER = {
  capabilities: [],
  email: 'vendedor@example.test',
  functionName: 'Vendedor',
  id: 'seller-1',
  name: 'Vendedora',
};
const DESKTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

/** @param {string} id @param {string} messageId */
function conversation(id, messageId) {
  return {
    id,
    bucket: 'respond',
    lastMessage: { id: messageId, direction: 'inbound' },
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{user?: Record<string, any>, blockStorage?: boolean}} [options]
 */
async function mount(page, { user = ADMIN, blockStorage = false } = {}) {
  const state = { items: [conversation('c1', 'm1')], listRequests: 0 };
  await page.addInitScript((blocked) => {
    /** @type {any[]} */
    const sources = [];
    class FakeEventSource {
      constructor() {
        this.listeners = new Map();
        sources.push(this);
        globalThis.setTimeout(() => this.emit('open', {}), 0);
      }
      addEventListener(name, listener) {
        this.listeners.set(name, [
          ...(this.listeners.get(name) ?? []),
          listener,
        ]);
      }
      emit(name, payload) {
        for (const listener of this.listeners.get(name) ?? [])
          listener({
            type: name,
            data: JSON.stringify(payload),
            lastEventId: '',
          });
      }
      close() {}
    }
    globalThis.EventSource = FakeEventSource;
    globalThis.__emitInbox = (name) =>
      sources.forEach((source) => source.emit(name, { type: name }));
    if (blocked) {
      // Só as chaves do CRM falham; o tema (fora do escopo) segue funcionando.
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        const original = globalThis.Storage.prototype[method];
        globalThis.Storage.prototype[method] = function (key, ...rest) {
          if (String(key).startsWith('crm.'))
            throw new globalThis.DOMException('blocked', 'SecurityError');
          return original.call(this, key, ...rest);
        };
      }
    }
  }, blockStorage);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (path === '/api/v1/sessions/current') return json({ user });
    if (path === '/api/v1/inbox/conversations') {
      state.listRequests += 1;
      return json({ items: state.items, totalCount: state.items.length });
    }
    return json({ items: [], counts: {}, data: null });
  });
  return state;
}

/** @param {import('@playwright/test').Page} page */
async function arrive(page, state, messageId) {
  state.items = [conversation('c1', messageId)];
  await page.evaluate(() =>
    globalThis.__emitInbox('inbox.conversation.changed'),
  );
}

test.describe('navegação agrupada', () => {
  test('sidebar: quatro grupos, 4 px e 16 px, ícones distintos', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await mount(page);
    await page.goto('/conta');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('link')).toHaveText([
      'Dashboard',
      'Caixa de Entrada',
      'Pedidos',
      'Clientes',
      'Olist',
      'Melhor Envio',
      'Usuários',
      'Saúde e erros',
      'Conta',
    ]);
    const groups = nav.locator('ul.nav-group');
    await expect(groups).toHaveCount(4);
    await expect(groups.nth(0).getByRole('link')).toHaveCount(4);
    await expect(groups.nth(1).getByRole('link')).toHaveText([
      'Olist',
      'Melhor Envio',
    ]);
    await expect(groups.nth(2).getByRole('link')).toHaveText([
      'Usuários',
      'Saúde e erros',
    ]);
    await expect(groups.nth(3).getByRole('link')).toHaveText(['Conta']);
    await expect(groups.first()).toHaveCSS('row-gap', '4px');
    await expect(nav).toHaveCSS('row-gap', '16px');
    const icons = await nav
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) =>
          [...link.querySelectorAll('svg path')]
            .map((path) => path.getAttribute('d'))
            .join('|'),
        ),
      );
    expect(new Set(icons).size).toBe(icons.length);
    await expect(nav.getByRole('listitem')).toHaveCount(9);
  });

  test('rail recolhido mantém os mesmos espaços', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mount(page);
    await page.goto('/inbox');
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-sidebar',
      'compact',
    );
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.locator('ul.nav-group').first()).toHaveCSS(
      'row-gap',
      '4px',
    );
    await expect(nav).toHaveCSS('row-gap', '16px');
  });

  test('grupo sem item visível não deixa espaço nem lista vazia', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await mount(page, { user: SELLER });
    await page.goto('/conta');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('link')).toHaveText([
      'Dashboard',
      'Caixa de Entrada',
      'Pedidos',
      'Clientes',
      'Conta',
    ]);
    await expect(nav.locator('ul.nav-group')).toHaveCount(2);
  });

  test('celular: folha "Mais" agrupada, 4 px e 16 px', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mount(page);
    await page.goto('/conta');
    await page
      .getByRole('navigation', { name: 'Navegação móvel' })
      .getByRole('button', { name: 'Mais' })
      .click();
    const sheet = page.getByRole('region', { name: 'Mais opções' });
    const groups = sheet.locator('ul.nav-group');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0).getByRole('link')).toHaveText([
      'Olist',
      'Melhor Envio',
    ]);
    await expect(groups.nth(1).getByRole('link')).toHaveText([
      'Usuários',
      'Saúde e erros',
    ]);
    await expect(groups.nth(2).getByRole('link')).toHaveText(['Conta']);
    await expect(groups.first()).toHaveCSS('row-gap', '4px');
    await expect(groups.nth(1)).toHaveCSS('margin-top', '16px');
    const box = await groups.nth(0).getByRole('link').first().boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('contador e título da Caixa', () => {
  for (const [name, viewport] of [
    ['1366x768', DESKTOP],
    ['390x844', PHONE],
  ]) {
    test(`conta, titula e anuncia uma chegada (${name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const state = await mount(page);
      await page.goto('/conta');
      await expect(page.getByRole('heading', { name: /Conta/u })).toBeVisible();
      // Linha de base: a primeira leitura não marca nada.
      await expect.poll(() => state.listRequests).toBeGreaterThan(0);
      await expect(page).toHaveTitle('CRM Silmer');
      await expect(page.locator('.nav-count')).toHaveCount(0);

      await arrive(page, state, 'm2');
      await expect(page).toHaveTitle('(1) CRM Silmer');
      const link =
        viewport === PHONE
          ? page
              .getByRole('navigation', { name: 'Navegação móvel' })
              .getByRole('link', {
                name: 'Caixa de Entrada, 1 conversa com mensagem nova',
              })
          : page
              .getByRole('navigation', { name: 'Navegação principal' })
              .getByRole('link', {
                name: /Caixa de Entrada 1 conversa com mensagem nova/u,
              });
      await expect(link).toBeVisible();
      await expect(
        page.getByRole('status').filter({
          hasText: 'Mensagem nova na Caixa de Entrada.',
        }),
      ).toHaveCount(1);
      const stored = await page.evaluate(() =>
        globalThis.localStorage.getItem('crm.inbox.unread.v1'),
      );
      expect(stored).toContain('c1');
      expect(stored).not.toContain('Olá');

      // Uma resposta tira a marca e o título volta ao normal.
      state.items = [
        {
          ...conversation('c1', 'm3'),
          lastMessage: { id: 'm3', direction: 'outbound' },
        },
      ];
      await page.evaluate(() =>
        globalThis.__emitInbox('inbox.conversation.changed'),
      );
      await expect(page).toHaveTitle('CRM Silmer');
      await expect(page.locator('.nav-count')).toHaveCount(0);
    });
  }

  test('sem storage o aviso funciona só em memória, sem erro', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await mount(page, { blockStorage: true });
    await page.goto('/conta');
    await expect.poll(() => state.listRequests).toBeGreaterThan(0);
    await arrive(page, state, 'm2');
    await expect(page).toHaveTitle('(1) CRM Silmer');
    expect(errors).toEqual([]);
  });

  test('sair da conta limpa o estado e o título', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const state = await mount(page);
    await page.goto('/conta');
    await expect.poll(() => state.listRequests).toBeGreaterThan(0);
    await arrive(page, state, 'm2');
    await expect(page).toHaveTitle('(1) CRM Silmer');
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveTitle('CRM Silmer');
    expect(
      await page.evaluate(() =>
        globalThis.localStorage.getItem('crm.inbox.unread.v1'),
      ),
    ).toBeNull();
  });
});
