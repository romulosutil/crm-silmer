import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// WAP-E04 / T02-07. Synthetic browser projections; server authorization and
// PostgreSQL isolation are covered separately. No provider or real account.
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

/** @param {import('@playwright/test').Page} page */
async function captureEvents(page) {
  await page.addInitScript(() => {
    class Source extends globalThis.EventTarget {
      constructor() {
        super();
        const scope = /** @type {any} */ (globalThis);
        scope.__wapSource = this;
        setTimeout(() => this.dispatchEvent(new globalThis.Event('open')), 20);
      }
      close() {}
    }
    globalThis.EventSource = /** @type {any} */ (Source);
  });
}

/** @param {import('@playwright/test').Page} page @param {string} [type] */
async function emit(page, type = 'stream.reset') {
  await page.evaluate((name) => {
    /** @type {any} */ (globalThis).__wapSource.dispatchEvent(
      new globalThis.MessageEvent(name, { data: '{}' }),
    );
  }, type);
}

/** @param {import('@playwright/test').Page} page @param {string} suffix */
async function clients(page, suffix) {
  await captureEvents(page);
  const contact = {
    id: `client-${suffix}`,
    label: `Cliente sintético ${suffix}`,
    displayName: `Cliente sintético ${suffix}`,
    identities: [],
    provisional: false,
    version: 1,
    phone: '5511999990000',
    phoneSource: 'manual',
    email: `${suffix}@example.com`,
    registration: null,
  };
  const state = { revoked: false, relationsRevoked: false };
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/sessions/current')
      return route.fulfill({
        json: {
          user: {
            id: `seller-${suffix}`,
            name: 'Vendedor sintético',
            capabilities: [],
          },
        },
      });
    if (path === '/api/v1/contacts')
      return route.fulfill({
        json: {
          items: state.revoked ? [] : [contact],
          totalCount: state.revoked ? 0 : 1,
          nextCursor: state.revoked ? null : 'page-2',
        },
      });
    if (path === `/api/v1/contacts/${contact.id}`)
      return route.fulfill(
        state.revoked
          ? { status: 404, json: { error: { code: 'CONTACT_NOT_FOUND' } } }
          : {
              json: {
                contact,
                identities: [],
                conversations: state.relationsRevoked
                  ? []
                  : [
                      {
                        id: `private-${suffix}`,
                        channel: 'whatsapp',
                        automationState: 'human',
                      },
                    ],
                deals: [],
              },
            },
      );
    return route.fulfill({ json: {} });
  });
  await page.goto(`/clientes/${contact.id}`);
  await expect(page.locator(`#client-${contact.id}`)).toBeVisible();
  return { contact, state };
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`WAP-T02-07: duas sessões isoladas, revogação e resposta atrasada em ${viewport.width}px`, async ({
    browser,
  }) => {
    const first = await browser.newContext({ viewport });
    const second = await browser.newContext({ viewport });
    try {
      const a = await first.newPage();
      const b = await second.newPage();
      const sessionA = await clients(a, 'a');
      await clients(b, 'b');
      await expect(
        a.getByText('Cliente sintético b', { exact: true }),
      ).toHaveCount(0);
      await expect(
        b.getByText('Cliente sintético a', { exact: true }),
      ).toHaveCount(0);

      const title = a.getByRole('heading', { name: 'Clientes', exact: true });
      await expect(title).toBeFocused();
      await emit(a);
      await expect(a.locator(`#client-${sessionA.contact.id}`)).toBeVisible();
      await expect(title).toBeFocused();

      const open = a.getByRole('button', {
        name: 'Completar cadastro',
        exact: true,
      });
      await open.focus();
      await a.keyboard.press('Enter');
      await expect(
        a.getByRole('radio', { name: 'Física', exact: true }),
      ).toBeFocused();
      await a
        .getByRole('textbox', { name: 'Nome completo', exact: true })
        .fill('Rascunho privado sintético');
      expect((await new AxeBuilder({ page: a }).analyze()).violations).toEqual(
        [],
      );

      let release = () => {};
      const waiting = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      let started = false;
      // Model an old response whose underlying transport cannot be cancelled.
      // The view must also check request identity, independently of AbortSignal.
      await a.evaluate(() => {
        const original = globalThis.fetch;
        globalThis.fetch = (input, options) =>
          original(
            input,
            String(input).includes('cursor=')
              ? { ...options, signal: undefined }
              : options,
          );
      });
      await a.route('**/api/v1/contacts?*cursor=*', async (route) => {
        started = true;
        await waiting;
        await route.fulfill({
          json: {
            items: [
              {
                ...sessionA.contact,
                id: 'old-private',
                label: 'Conteúdo antigo revogado',
              },
            ],
            nextCursor: null,
            totalCount: 2,
          },
        });
      });
      await a
        .getByRole('button', { name: 'Carregar mais clientes', exact: true })
        .click();
      await expect.poll(() => started).toBe(true);
      sessionA.state.revoked = true;
      await emit(a);
      await expect(
        a.getByRole('textbox', { name: 'Nome completo', exact: true }),
      ).toHaveCount(0);
      await expect(a.locator(`#client-${sessionA.contact.id}`)).toHaveCount(0);
      await expect(
        a.getByRole('searchbox', {
          name: 'Buscar cliente por nome ou telefone',
        }),
      ).toBeFocused();
      const lateResponse = a.waitForResponse((response) =>
        response.url().includes('cursor='),
      );
      release();
      await (await lateResponse).finished();
      await expect(
        a.getByText('Este cliente não está disponível para seu acesso.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        a.getByText('Conteúdo antigo revogado', { exact: true }),
      ).toHaveCount(0);
      await expect(b.locator('#client-client-b')).toBeVisible();
      expect((await new AxeBuilder({ page: a }).analyze()).violations).toEqual(
        [],
      );
      await a.screenshot({
        path: `test-results/wap-e04-revoked-${viewport.width}.png`,
        fullPage: true,
      });
      const overflow = await a.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth >
          globalThis.innerWidth,
      );
      expect(overflow).toBe(false);
    } finally {
      await first.close();
      await second.close();
    }
  });
}

test('WAP-T02-07: cadastro comum preserva rascunho enquanto remove relações privadas antes da releitura', async ({
  page,
}) => {
  const session = await clients(page, 'shared');
  await expect(page.locator('a[href="/inbox/private-shared"]')).toBeVisible();
  await page
    .getByRole('button', { name: 'Completar cadastro', exact: true })
    .click();
  const draft = page.getByRole('textbox', {
    name: 'Nome completo',
    exact: true,
  });
  await draft.fill('Rascunho cadastral comum');
  session.state.relationsRevoked = true;
  await page.route('**/api/v1/contacts?**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await emit(page, 'inbox.contact.changed');
  await expect(page.locator('a[href="/inbox/private-shared"]')).toHaveCount(0);
  await expect(draft).toHaveValue('Rascunho cadastral comum');
  await expect(
    page.getByText(
      'Não foi possível atualizar os clientes. Os dados exibidos podem estar desatualizados.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('WAP-T02-07: recusa de Assuntos remove histórico, rascunho e diálogo de contato', async ({
  page,
}) => {
  const mock = await installMocks(page, {}, { fixedClock: false });
  await captureEvents(page);
  const personal = /** @type {Record<string, any>|undefined} */ (
    mock.items.find((item) => item.id === 'r-joao')
  );
  if (!personal) throw new Error('Missing synthetic personal conversation');
  personal.personalLine = true;
  await page.goto('/inbox/r-joao');
  await expect(page.locator('#conversation-r-joao')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Criar pedido', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Transferir atendimento', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('textbox', { name: 'Responder', exact: true })
    .fill('Rascunho privado da linha');
  await page
    .getByRole('button', { name: 'Dados de Cliente João V.', exact: true })
    .click();
  await page.route(
    '**/api/v1/inbox/conversations/r-joao/subjects?**',
    (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: 'CONVERSATION_NOT_FOUND' } },
      }),
  );
  await emit(page, 'inbox.conversation.changed');
  await expect(page.locator('#conversation-r-joao')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(
    page.getByText('Olá, gostaria de um orçamento de uniformes.', {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('searchbox', {
      name: 'Buscar nas conversas exibidas',
      exact: true,
    }),
  ).toBeFocused();
});

for (const width of [390, 1366]) {
  test(`WAP-E08 ${width}px mostra saída da linha e mídia indisponível sem ação de envio`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const mock = await installMocks(page, {}, { fixedClock: false });
    const item = /** @type {Record<string, any>|undefined} */ (
      mock.items.find(({ id }) => id === 'r-joao')
    );
    if (!item) throw new Error('Missing synthetic personal conversation');
    item.personalLine = true;
    item.lastMessage = {
      ...item.lastMessage,
      id: 'device-observed',
      direction: 'outbound',
      authorKind: 'system',
      origin: 'device',
      type: 'image',
      status: 'outcome_unknown',
      deliveryStatus: 'outcome_unknown',
      text: null,
      preview: 'Imagem',
      media: {
        mediaId: null,
        kind: 'image',
        state: 'unavailable',
        contentUrl: null,
      },
    };
    await page.goto('/inbox/r-joao');
    const row = page.getByText('WhatsApp da linha', { exact: true });
    await expect(row).toBeVisible();
    await expect(
      page.getByText('Entrega ainda sem confirmação', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Arquivo indisponível no momento.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Verificar envio' }),
    ).toHaveCount(0);
    const details = page
      .locator('summary')
      .filter({ hasText: 'Detalhes para suporte' });
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(details).toBeFocused();
    await expect(
      page.getByText('device-observed', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      )
      .toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

// WAP-09: a personal line shows in the row and the header, in words; the
// general line keeps both as they were. The composer says where a reply
// leaves on both lines, and an administrator reading a seller's personal
// line (who cannot send there) reads that only the holder sends.
const LINE_CASES = [
  {
    name: 'vendedor na própria linha pessoal',
    id: 'r-joao',
    personal: true,
    admin: false,
    badge: 'Seu WhatsApp',
    identity: 'WhatsApp pessoal · Em atendimento · Você',
    hint: 'Sai pelo seu WhatsApp',
  },
  {
    name: 'vendedor na linha geral',
    id: 'r-ana',
    personal: false,
    admin: false,
    badge: '',
    identity: 'WhatsApp · Em atendimento · Você',
    hint: 'Sai pela linha Silmer',
  },
  {
    name: 'administrador na linha pessoal de um vendedor',
    id: 'r-bruno',
    personal: true,
    admin: true,
    badge: 'WhatsApp de Carlos',
    identity: 'WhatsApp pessoal de Carlos · Em atendimento · Carlos Lima',
    hint: 'Envio só pelo titular da linha',
  },
];

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1366]) {
    for (const scene of LINE_CASES) {
      test(`WAP-09 ${scene.name} em ${width}px ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript((appearance) => {
          globalThis.localStorage.setItem('silmer-theme', appearance);
        }, theme);
        const mock = await installMocks(
          page,
          {},
          { fixedClock: false, admin: scene.admin },
        );
        const item = /** @type {Record<string, any>|undefined} */ (
          mock.items.find(({ id }) => id === scene.id)
        );
        if (!item) throw new Error('Missing synthetic conversation');
        item.personalLine = scene.personal;
        await page.goto('/inbox');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        // The row: a quiet seal in words on a personal line, never
        // focusable; nothing on the general line.
        const row = page.locator(
          `.conversation-row[data-conversation-id="${scene.id}"]`,
        );
        await expect(row).toBeVisible();
        const badge = row.locator('[data-badge="line"]');
        if (scene.badge) {
          await expect(badge).toHaveText(scene.badge);
          await expect(badge).not.toHaveAttribute('data-tone');
        } else {
          await expect(badge).toHaveCount(0);
        }
        await expect(
          page.locator('[data-badge="line"][tabindex], [data-badge="line"] *'),
        ).toHaveCount(0);
        // Only the personal conversation carries a line; general-line rows
        // and other channels stay as they were.
        await expect(page.locator('[data-badge="line"]')).toHaveCount(
          scene.badge ? 1 : 0,
        );
        await expect(
          page.locator(
            '.conversation-row[data-conversation-id="r-hugo"] [data-badge="line"]',
          ),
        ).toHaveCount(0);

        if (theme === 'light' && width === 390)
          await page.screenshot({
            path: `test-results/wap-09-${scene.id}-${width}-list.png`,
          });

        // Keyboard order is unchanged: rows are the tab stops, the seal is not.
        await row.focus();
        await page.keyboard.press('Tab');
        await expect(row).not.toBeFocused();
        await expect(page.locator(':focus')).not.toHaveAttribute(
          'data-badge',
          'line',
        );
        await row.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/inbox/${scene.id}$`, 'u'));

        // The header names the line, then who is serving.
        await expect(page.locator('.conv-identity')).toHaveText(scene.identity);

        // Beside the send button: the exit, read with the field and the
        // button, and not a live region.
        const hint = page.locator('#reply-line');
        await expect(hint).toHaveText(scene.hint);
        await expect(hint).toBeVisible();
        await expect(hint).not.toHaveAttribute('aria-live');
        await expect(hint).not.toHaveAttribute('role');
        const field = page.getByRole('textbox', {
          name: 'Responder',
          exact: true,
        });
        await expect(field).toHaveAccessibleDescription(
          new RegExp(`${scene.hint}$`, 'u'),
        );
        await expect(
          page.getByRole('button', { name: 'Enviar resposta', exact: true }),
        ).toHaveAccessibleDescription(scene.hint);

        await expect
          .poll(() =>
            page.evaluate(
              () =>
                globalThis.document.documentElement.scrollWidth <=
                globalThis.innerWidth,
            ),
          )
          .toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        if (theme === 'light')
          await page.screenshot({
            path: `test-results/wap-09-${scene.id}-${width}.png`,
          });
      });
    }
  }
}
