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
