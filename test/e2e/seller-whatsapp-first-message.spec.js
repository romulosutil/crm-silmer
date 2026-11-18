import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// WAP-T04-04 (WAP-22/23/24/32): browser projections are synthetic; the
// server transaction, replay and isolation are covered by the API tests.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

const KEY = /^[a-f0-9-]{36}$/u;
const ANA = {
  id: 'contact-r-ana',
  label: 'Cliente Ana T.',
  displayName: 'Cliente Ana T.',
  identities: [],
  provisional: false,
  shared: false,
  version: 3,
  registration: null,
};
const SECOND = {
  id: 'contact-second',
  label: 'Cliente sintético B',
  displayName: 'Cliente sintético B',
  identities: [],
  provisional: false,
  shared: false,
  version: 1,
  registration: null,
};

/** @param {string} contactId @param {Record<string, any>} [overrides] */
function previewOf(contactId, overrides = {}) {
  return {
    contact: {
      id: contactId,
      name: contactId === ANA.id ? ANA.label : SECOND.label,
      version: contactId === ANA.id ? ANA.version : SECOND.version,
    },
    link: { id: `link-${contactId}`, version: 2 },
    line: {
      id: 'line-synthetic',
      version: 5,
      generation: 7,
      state: 'connected',
      maskedNumber: '••••0000',
    },
    recipient: { maskedNumber: '••••1234' },
    conversation: null,
    available: true,
    restriction: null,
    ...overrides,
  };
}

/** @param {boolean} [reused] */
function accepted(reused = false) {
  return {
    status: reused ? 200 : 201,
    json: {
      conversation: { id: 'r-ana', version: 4, reused, cycleNumber: 1 },
      message: { id: 'message-synthetic', status: 'queued' },
    },
  };
}

function gate() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}

/**
 * @typedef {{contactId: string, body: any, key: string|undefined, csrf: string|undefined}} Write
 * @typedef {{status?: number, json?: any}|'timedout'} Answer
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   respond?: (write: Write, index: number) => Answer|Promise<Answer>,
 *   preview?: (contactId: string) => {status?: number, json: any},
 * }} [options]
 */
async function setup(page, options = {}) {
  await installMocks(page, {}, { fixedClock: false });
  const state = {
    /** @type {string[]} */ previews: [],
    /** @type {Write[]} */ writes: [],
    /** @type {Promise<unknown>[]} */ settled: [],
    preview:
      options.preview ??
      ((/** @type {string} */ contactId) => ({
        json: { preview: previewOf(contactId) },
      })),
    respond: options.respond ?? (() => accepted()),
  };
  await page
    .context()
    .addCookies([
      { name: 'crm_csrf', value: 'synthetic', url: 'http://127.0.0.1:4173' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/me/clients')
      return route.fulfill({
        json: { items: [ANA, SECOND], totalCount: 2, nextCursor: null },
      });
    if (path === '/api/v1/orders')
      return route.fulfill({ json: { items: [], nextCursor: null } });
    const detail = /^\/api\/v1\/contacts\/([^/]+)$/u.exec(path);
    if (detail && [ANA.id, SECOND.id].includes(detail[1]))
      return route.fulfill({
        json: {
          contact: detail[1] === ANA.id ? ANA : SECOND,
          identities: [],
          conversations: [],
          deals: [],
        },
      });
    const preview =
      /^\/api\/v1\/contacts\/([^/]+)\/whatsapp\/first-message-preview$/u.exec(
        path,
      );
    if (preview && request.method() === 'GET') {
      state.previews.push(preview[1]);
      return route.fulfill(state.preview(preview[1]));
    }
    const command =
      /^\/api\/v1\/contacts\/([^/]+)\/whatsapp\/conversations$/u.exec(path);
    if (command && request.method() === 'POST') {
      const write = {
        contactId: command[1],
        body: request.postDataJSON(),
        key: request.headers()['idempotency-key'],
        csrf: request.headers()['x-csrf-token'],
      };
      state.writes.push(write);
      const done = (async () => {
        const answer = await state.respond(write, state.writes.length - 1);
        if (answer === 'timedout') return route.abort('timedout');
        return route.fulfill(answer);
      })().catch(() => {});
      state.settled.push(done);
      return done;
    }
    return route.fallback();
  });
  return state;
}

/** @param {import('@playwright/test').Page} page */
function composer(page) {
  const region = page.getByRole('region', {
    name: 'Primeira mensagem pelo WhatsApp',
  });
  return {
    region,
    start: region.getByRole('button', { name: 'Iniciar conversa' }),
    field: region.getByLabel('Mensagem para o cliente'),
    send: region.getByRole('button', {
      name: /^(Enviar primeira mensagem|Verificar e reenviar)$/u,
    }),
    cancel: region.getByRole('button', { name: 'Cancelar' }),
    alert: region.getByRole('alert'),
  };
}

async function noHorizontalScroll(/** @type {any} */ page) {
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test('WAP-32: abrir o cliente e compor não enviam nem criam conversa', async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await expect(ui.start).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Meus pedidos deste cliente' }),
  ).toBeVisible();
  expect(state.previews).toEqual([]);
  await ui.start.click();
  await expect(ui.field).toBeFocused();
  await expect(ui.region.getByText('Cliente Ana T.')).toBeVisible();
  await expect(ui.region.getByText('••••1234')).toBeVisible();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await expect(ui.region.getByText('Abre um novo atendimento')).toBeVisible();
  await ui.field.fill('Olá, Ana!');
  await ui.field.press('Enter');
  await ui.field.pressSequentially('Tudo bem?');
  await expect(ui.field).toHaveValue('Olá, Ana!\nTudo bem?');
  expect(state.previews).toEqual([ANA.id]);
  expect(state.writes).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Completar cadastro' }),
  ).toBeEnabled();
});

test('WAP-22: envia o contrato exato com as versões da conferência', async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('  Olá, Ana! Tudo bem?  ');
  await ui.send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  await expect(page.locator('.notice-toast')).toContainText(
    'Primeira mensagem enviada para a fila',
  );
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].contactId).toBe(ANA.id);
  expect(state.writes[0].body).toEqual({
    text: 'Olá, Ana! Tudo bem?',
    expectedContactVersion: 3,
    expectedLinkVersion: 2,
    expectedLineVersion: 5,
    expectedGeneration: 7,
    expectedConversation: null,
  });
  expect(state.writes[0].key).toMatch(KEY);
  expect(state.writes[0].csrf).toBe('synthetic');
});

test('WAP-23: duplo clique e Ctrl+Enter durante o envio geram um só comando', async ({
  page,
}) => {
  const hold = gate();
  const state = await setup(page, {
    respond: async () => {
      await hold.promise;
      return accepted();
    },
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Olá, Ana!');
  await ui.send.dblclick();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(ui.send).toHaveAttribute('aria-disabled', 'true');
  await ui.field.press('Control+Enter');
  await ui.send.click({ force: true });
  hold.release();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].key).toMatch(KEY);
});

const CONVERSATION_CHANGED =
  'Este atendimento mudou desde que você abriu a mensagem (outra aba ou o cliente respondeu). Confira de novo antes de enviar.';

/** Server double: one active conversation; a stale `null` is refused. */
function sharedServer() {
  const server = {
    committed: false,
    /** @param {string} contactId */
    preview: (contactId) => ({
      json: {
        preview: previewOf(contactId, {
          conversation: server.committed ? { id: 'r-ana', version: 4 } : null,
        }),
      },
    }),
    /** @param {Write} write @returns {Answer} */
    respond: (write) => {
      if (server.committed && write.body.expectedConversation === null)
        return {
          status: 409,
          json: { code: 'CONVERSATION_VERSION_CONFLICT' },
        };
      const reused = server.committed;
      server.committed = true;
      return accepted(reused);
    },
  };
  return server;
}

test('WAP-23: duas abas não geram duas primeiras mensagens', async ({
  page,
  context,
}) => {
  const server = sharedServer();
  const first = await setup(page, server);
  const other = await context.newPage();
  const second = await setup(other, server);
  for (const tab of [page, other]) {
    await tab.goto('/meus-clientes/contact-r-ana');
    const ui = composer(tab);
    await ui.start.click();
    await expect(ui.region.getByText('Abre um novo atendimento')).toBeVisible();
    await ui.field.fill('Olá, Ana!');
  }
  await composer(page).send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  const ui = composer(other);
  await ui.send.click();
  await expect(ui.alert).toContainText(CONVERSATION_CHANGED);
  await expect(ui.field).toHaveValue('Olá, Ana!');
  await expect(other).toHaveURL(/\/meus-clientes\/contact-r-ana$/u);
  const recheck = ui.region.getByRole('button', { name: 'Conferir de novo' });
  await expect(recheck).toBeFocused();
  await recheck.press('Enter');
  await expect(
    ui.region.getByText('Continua o atendimento ativo'),
  ).toBeVisible();
  await expect(ui.field).toBeFocused();
  await ui.send.click();
  await expect(other).toHaveURL(/\/inbox\/r-ana$/u);
  await expect(other.locator('.notice-toast')).toContainText(
    'no atendimento ativo',
  );
  const base = {
    text: 'Olá, Ana!',
    expectedContactVersion: 3,
    expectedLinkVersion: 2,
    expectedLineVersion: 5,
    expectedGeneration: 7,
  };
  expect(first.writes.map((write) => write.body)).toEqual([
    { ...base, expectedConversation: null },
  ]);
  expect(second.writes.map((write) => write.body)).toEqual([
    { ...base, expectedConversation: null },
    { ...base, expectedConversation: { id: 'r-ana', version: 4 } },
  ]);
  const keys = [...first.writes, ...second.writes].map((write) => write.key);
  for (const key of keys) expect(key).toMatch(KEY);
  expect(new Set(keys).size).toBe(3);
  await other.close();
});

test('WAP-24: destino inválido recusa e mantém o rascunho', async ({
  page,
}) => {
  const state = await setup(page, {
    respond: () => ({
      status: 422,
      json: { code: 'WHATSAPP_DESTINATION_INVALID' },
    }),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Rascunho para telefone inválido');
  await ui.send.click();
  await expect(ui.alert).toContainText(
    'O telefone do cliente não é um WhatsApp válido. Corrija o cadastro do cliente; o rascunho foi mantido.',
  );
  await expect(ui.field).toHaveValue('Rascunho para telefone inválido');
  await expect(ui.send).toBeFocused();
  await expect(page).toHaveURL(/\/meus-clientes\/contact-r-ana$/u);
  await expect(
    page.getByRole('button', { name: 'Completar cadastro' }),
  ).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});

test('WAP-24: tentativa incerta perdida ao recarregar não duplica o envio', async ({
  page,
}) => {
  const server = sharedServer();
  let pending = false;
  const state = await setup(page, {
    preview: server.preview,
    respond: (write, index) => {
      if (index === 0) {
        // Accepted by the server, but the answer never reaches the browser.
        pending = true;
        return 'timedout';
      }
      // The first attempt commits before this one is processed.
      if (pending) server.committed = true;
      return server.respond(write);
    },
  });
  await page.goto('/meus-clientes/contact-r-ana');
  let ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('Abre um novo atendimento')).toBeVisible();
  await ui.field.fill('Mensagem talvez enviada');
  await ui.send.click();
  await expect(ui.alert).toContainText('Não conseguimos confirmar o envio.');
  await page.reload();
  ui = composer(page);
  await ui.start.click();
  await expect(ui.field).toHaveValue('');
  await expect(ui.region.getByText('Abre um novo atendimento')).toBeVisible();
  await ui.field.fill('Mensagem talvez enviada');
  await ui.send.click();
  await expect(ui.alert).toContainText(CONVERSATION_CHANGED);
  await expect(ui.field).toHaveValue('Mensagem talvez enviada');
  await expect(page).toHaveURL(/\/meus-clientes\/contact-r-ana$/u);
  await ui.region.getByRole('button', { name: 'Conferir de novo' }).click();
  await expect(
    ui.region.getByText('Continua o atendimento ativo'),
  ).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].key).not.toBe(state.writes[0].key);
  expect(state.writes[1].body.expectedConversation).toBeNull();
  expect(
    await page.evaluate(() =>
      [globalThis.localStorage, globalThis.sessionStorage].some((store) =>
        Object.keys(store).some((key) =>
          store.getItem(key)?.includes('talvez enviada'),
        ),
      ),
    ),
  ).toBe(false);
});

test('WAP-24: linha offline recusa sem criar nada e mantém o rascunho', async ({
  page,
}) => {
  const state = await setup(page, {
    respond: (_write, index) =>
      index === 0
        ? { status: 503, json: { code: 'WHATSAPP_SEND_UNAVAILABLE' } }
        : accepted(),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Rascunho preservado');
  await ui.send.click();
  await expect(ui.alert).toContainText(
    'Nada foi enviado e o rascunho foi mantido.',
  );
  await expect(ui.field).toHaveValue('Rascunho preservado');
  await expect(page).toHaveURL(/\/meus-clientes\/contact-r-ana$/u);
  await expect(ui.send).toBeFocused();
  await ui.send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].key).not.toBe(state.writes[0].key);
});

test('WAP-24: timeout fica incerto e a nova tentativa reutiliza a chave', async ({
  page,
}) => {
  const state = await setup(page, {
    respond: (_write, index) => (index === 0 ? 'timedout' : accepted()),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Mensagem incerta');
  await ui.send.click();
  await expect(ui.alert).toContainText(
    'Não conseguimos confirmar o envio. Tente de novo: a mesma tentativa não gera outra mensagem.',
  );
  await expect(
    ui.region.getByRole('button', { name: 'Verificar e reenviar' }),
  ).toBeVisible();
  await expect(ui.field).toHaveAttribute('readonly', '');
  await expect(page).toHaveURL(/\/meus-clientes\/contact-r-ana$/u);
  await ui.send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].key).toBe(state.writes[0].key);
  expect(state.writes[1].body).toEqual(state.writes[0].body);
});

test('WAP-23: revisão obsoleta exige nova conferência com novas versões', async ({
  page,
}) => {
  let generation = 7;
  const state = await setup(page, {
    preview: (contactId) => ({
      json: {
        preview: previewOf(contactId, {
          line: {
            id: 'line-synthetic',
            version: generation === 7 ? 5 : 6,
            generation,
            state: 'connected',
            maskedNumber: '••••0000',
          },
        }),
      },
    }),
    respond: (_write, index) =>
      index === 0
        ? { status: 409, json: { code: 'WHATSAPP_GENERATION_STALE' } }
        : accepted(),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Mensagem conferida');
  await ui.send.click();
  await expect(ui.alert).toContainText(
    'O cadastro, o vínculo ou sua linha mudaram. Confira de novo.',
  );
  const recheck = ui.region.getByRole('button', { name: 'Conferir de novo' });
  await expect(recheck).toBeFocused();
  await expect(ui.send).toHaveAttribute('aria-disabled', 'true');
  await ui.send.click({ force: true });
  expect(state.writes).toHaveLength(1);
  generation = 8;
  await recheck.press('Enter');
  await expect(ui.field).toBeFocused();
  await expect(ui.field).toHaveValue('Mensagem conferida');
  expect(state.previews).toEqual([ANA.id, ANA.id]);
  await ui.send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].body).toMatchObject({
    expectedLineVersion: 6,
    expectedGeneration: 8,
  });
  expect(state.writes[1].key).not.toBe(state.writes[0].key);
});

test('WAP-23: trocar de cliente com envio pendente não navega e guarda o rascunho', async ({
  page,
}) => {
  const hold = gate();
  const state = await setup(page, {
    respond: async (_write, index) => {
      if (index === 0) await hold.promise;
      return accepted(index > 0);
    },
  });
  await page.goto('/meus-clientes/contact-r-ana');
  // A late answer must be ignored even if the browser still delivers it.
  await page.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) =>
      original(
        input,
        String(input).endsWith('/whatsapp/conversations')
          ? { ...options, signal: undefined }
          : options,
      );
  });
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Rascunho da Ana');
  await ui.send.click();
  await expect.poll(() => state.writes.length).toBe(1);
  await page.getByRole('link', { name: 'Cliente sintético B' }).click();
  await expect(
    page.getByRole('heading', { name: 'Cliente sintético B' }),
  ).toBeVisible();
  await expect(ui.start).toBeVisible();
  await expect(ui.field).toHaveCount(0);
  hold.release();
  await Promise.all(state.settled);
  await expect(page).toHaveURL(/\/meus-clientes\/contact-second$/u);
  await expect(page.locator('.notice-toast')).toHaveCount(0);
  await page.getByRole('link', { name: 'Cliente Ana T.' }).click();
  await expect(
    page.getByRole('heading', { name: 'Cliente Ana T.' }),
  ).toBeVisible();
  await ui.start.click();
  await expect(ui.field).toHaveValue('Rascunho da Ana');
  await expect(
    ui.region.getByRole('button', { name: 'Verificar e reenviar' }),
  ).toBeVisible();
  await ui.send.click();
  await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].key).toBe(state.writes[0].key);
});

test('WAP-24: linha desconectada desabilita o envio com explicação', async ({
  page,
}) => {
  const state = await setup(page, {
    preview: (contactId) => ({
      json: {
        preview: previewOf(contactId, {
          available: false,
          restriction: 'line_unavailable',
        }),
      },
    }),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  await expect(ui.region.getByText('••••0000')).toBeVisible();
  await ui.field.fill('Mensagem retida');
  await expect(ui.send).toHaveAttribute('aria-disabled', 'true');
  await expect(ui.send).toHaveAccessibleDescription(
    /Seu WhatsApp está desconectado\. Conecte em Minha conta para enviar\./u,
  );
  await expect(
    ui.region.getByRole('link', { name: 'Abrir Minha conta' }),
  ).toHaveAttribute('href', '/conta#my-whatsapp-title');
  await ui.send.click({ force: true });
  await ui.field.press('Control+Enter');
  expect(state.writes).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Completar cadastro' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('region', { name: 'Meus pedidos deste cliente' }),
  ).toBeVisible();
});

test('WAP-22: primeiro envio desligado explica o atendimento passivo', async ({
  page,
}) => {
  const state = await setup(page, {
    preview: () => ({
      status: 503,
      json: { code: 'SELLER_WHATSAPP_FIRST_SEND_DISABLED' },
    }),
  });
  await page.goto('/meus-clientes/contact-r-ana');
  const ui = composer(page);
  await ui.start.click();
  const text =
    'O primeiro envio pelo CRM não está habilitado para você. O atendimento continua quando o cliente procurar seu WhatsApp.';
  await expect(ui.region.getByText(text)).toBeVisible();
  await expect(ui.send).toHaveAttribute('aria-disabled', 'true');
  await expect(ui.send).toHaveAccessibleDescription(text);
  await ui.field.fill('Mensagem retida');
  await ui.send.click({ force: true });
  expect(state.writes).toEqual([]);
});

for (const width of [1366, 390]) {
  test(`WAP-22: fluxo por teclado e axe em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await setup(page, {
      preview: (contactId) => ({
        json: {
          preview: previewOf(contactId, {
            conversation: { id: 'r-ana', version: 3 },
          }),
        },
      }),
      respond: (_write, index) =>
        index === 0
          ? { status: 503, json: { code: 'WHATSAPP_SEND_UNAVAILABLE' } }
          : accepted(true),
    });
    await page.goto('/meus-clientes/contact-r-ana');
    const ui = composer(page);
    await ui.start.focus();
    await page.keyboard.press('Enter');
    await expect(ui.field).toBeFocused();
    await expect(
      ui.region.getByText('Continua o atendimento ativo'),
    ).toBeVisible();
    await page.keyboard.type('Olá, Ana!');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Podemos seguir?');
    expect(state.writes).toEqual([]);
    await noHorizontalScroll(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await ui.cancel.focus();
    await page.keyboard.press('Enter');
    await expect(ui.start).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ui.field).toBeFocused();
    await expect(ui.field).toHaveValue('Olá, Ana!\nPodemos seguir?');
    await expect(ui.region.getByText('••••0000')).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(ui.alert).toContainText('Nada foi enviado');
    await expect(ui.field).toBeFocused();
    await noHorizontalScroll(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/inbox\/r-ana$/u);
    await expect(page.locator('.notice-toast')).toContainText(
      'no atendimento ativo',
    );
    expect(state.writes).toHaveLength(2);
  });
}
