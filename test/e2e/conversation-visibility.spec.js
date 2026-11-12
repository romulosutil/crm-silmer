import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// CONV-ACL-01 / CONV-ACL-T01: synthetic API responses exercise browser
// cleanup; authorization and SQL visibility are verified by API tests.
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

/** @param {import('@playwright/test').Page} page @param {boolean} [admin] */
async function open(page, admin = false) {
  const mock = await installMocks(
    page,
    { writes: [], unmocked: [] },
    { admin },
  );
  await page.addInitScript(() => {
    const scope = /** @type {any} */ (globalThis);
    const Base = scope.EventSource;
    scope.__visibilitySources = [];
    scope.EventSource = class extends Base {
      /** @param {...any} args */
      constructor(...args) {
        super(...args);
        scope.__visibilitySources.push(this);
      }
    };
  });
  await page.goto('/inbox/r-joao');
  await expect(page.locator('#conversation-r-joao')).toBeVisible();
  return mock.items;
}

/** @param {import('@playwright/test').Page} page @param {string} [type] */
async function emit(page, type = 'stream.reset') {
  await page.evaluate((eventType) => {
    /** @type {any} */ (globalThis).__visibilitySources
      .at(-1)
      .dispatchEvent(new globalThis.MessageEvent(eventType, { data: '{}' }));
  }, type);
}

for (const admin of [false, true]) {
  test(`CONV-ACL-01: responsável mostra o escopo de ${admin ? 'administrador' : 'vendedor'}`, async ({
    page,
  }) => {
    await open(page, admin);
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await expect(
      page.getByRole('radio', {
        name: 'Todos',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('#inbox-visibility-hint')).toHaveCount(
      admin ? 0 : 1,
    );
    await expect(
      page.getByRole('radio', { name: 'Minhas', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('radio', { name: 'Sem dono', exact: true }),
    ).toBeVisible();
  });
}

test('CONV-ACL-01: reset esconde conversa e diálogos antes da releitura e negação remove o rascunho', async ({
  page,
}) => {
  await open(page);
  const composer = page.getByRole('textbox', {
    name: 'Responder',
    exact: true,
  });
  await composer.fill('Rascunho sintético de acesso revogado');
  await page
    .getByRole('button', { name: 'Dados de Cliente João V.', exact: true })
    .click();
  await page.getByRole('button', { name: 'Editar nome', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nome do contato', exact: true })
    .fill('Nome sintético reservado');
  let denied = false;
  await page.route('**/api/v1/inbox/conversations/r-joao', async (route) => {
    denied = true;
    return route.fulfill({
      status: 404,
      json: { error: { code: 'CONVERSATION_NOT_FOUND' } },
    });
  });
  // Keep the list unreadable: a reset must remove cached rows even if the
  // replacement page fails, and still revalidate a direct conversation URL.
  await page.route('**/api/v1/inbox/conversations?**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'SERVICE_UNAVAILABLE' } },
    }),
  );
  await emit(page);
  await expect(page.locator('#conversation-r-joao')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(
    page.getByText('Olá, gostaria de um orçamento de uniformes.', {
      exact: true,
    }),
  ).toHaveCount(0);
  // Retry the direct address after a list recovers: the denial must clear the
  // private draft too, before any future authorized opening of the same id.
  await page.unroute('**/api/v1/inbox/conversations?**');
  await emit(page);
  await expect.poll(() => denied).toBe(true);
  await expect(
    page
      .getByText('Esta conversa não está disponível para seu acesso.', {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.unroute('**/api/v1/inbox/conversations/r-joao');
  await emit(page);
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('');
});

test('CONV-ACL-01: releitura silenciosa negada limpa também contato em edição', async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole('button', { name: 'Dados de Cliente João V.', exact: true })
    .click();
  await page.getByRole('button', { name: 'Editar nome', exact: true }).click();
  await page.route('**/api/v1/inbox/conversations/r-joao', (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } }),
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

test('CONV-ACL-01: reset preserva rascunho depois de revalidar acesso permitido', async ({
  page,
}) => {
  await open(page);
  const composer = page.getByRole('textbox', {
    name: 'Responder',
    exact: true,
  });
  await composer.fill('Rascunho sintético permitido');
  await emit(page);
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('Rascunho sintético permitido');
});

test('CONV-ACL-01: reset revalida e elimina rascunho revogado também sem endereço de conversa', async ({
  page,
}) => {
  const items = await open(page);
  await page.goto('/inbox');
  const heading = page.locator('h2[id^="conversation-"]');
  await expect(heading).toBeVisible();
  const id =
    (await heading.getAttribute('id'))?.replace('conversation-', '') ?? '';
  const selected = items.find((item) => item.id === id);
  if (!selected) throw new Error('Missing synthetic selection');
  const composer = page.getByRole('textbox', {
    name: 'Responder',
    exact: true,
  });
  await composer.fill('Rascunho sintético revogado fora do endereço');
  items.splice(items.indexOf(selected), 1);
  await emit(page);
  await expect(page.locator(`#conversation-${id}`)).toHaveCount(0);
  await expect(
    page
      .getByText('Esta conversa não está disponível para seu acesso.', {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  items.push(selected);
  await emit(page);
  await page.locator(`.conversation-row[data-conversation-id="${id}"]`).click();
  await expect(page.locator(`#conversation-${id}`)).toBeVisible();
  await expect(composer).toHaveValue('');
});

for (const status of [403, 404]) {
  test(`CONV-ACL-01: verificar envio com ${status} remove o histórico sem depender de SSE`, async ({
    page,
  }) => {
    await open(page);
    await page.goto('/inbox/r-ana');
    await expect(page.locator('#conversation-r-ana')).toBeVisible();
    const composer = page.getByRole('textbox', {
      name: 'Responder',
      exact: true,
    });
    await composer.fill('Rascunho sintético antes da verificação');
    await page.route('**/api/v1/inbox/conversations/r-ana', (route) =>
      route.fulfill({
        status,
        json: {
          error: {
            code: status === 403 ? 'FORBIDDEN' : 'CONVERSATION_NOT_FOUND',
          },
        },
      }),
    );
    await page
      .getByRole('button', { name: 'Verificar envio', exact: true })
      .click();
    await expect(page.locator('#conversation-r-ana')).toHaveCount(0);
    await expect(
      page.getByText('Olá, gostaria de um orçamento de uniformes.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page
        .getByText('Esta conversa não está disponível para seu acesso.', {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole('searchbox', {
        name: 'Buscar nas conversas exibidas',
        exact: true,
      }),
    ).toBeFocused();
    await page.unroute('**/api/v1/inbox/conversations/r-ana');
    await emit(page);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue('');
  });
}
