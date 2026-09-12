import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const session = {
  user: {
    id: 'operator-1',
    functionName: 'Vendedor',
    capabilities: ['COMMERCIAL_ADMIN'],
  },
};
const card = {
  id: 'deal-1',
  version: 4,
  stage: 'product',
  identification: { customerLabel: 'Cliente 028', orderName: 'Pedido 1042' },
  responsible: { displayLabel: 'Equipe comercial' },
  qualification: { nextPendingField: 'Quantidade', blockerCount: 1 },
  nextTask: { title: 'Confirmar quantidade', dueAt: '2026-09-08T12:00:00Z' },
  stageEnteredAt: '2026-09-06T12:00:00Z',
};
const contact = {
  activeDealCount: 1,
  createdAt: '2026-09-01T12:00:00.000Z',
  id: 'contact-1',
  identities: [
    {
      channel: 'whatsapp',
      displayHandle: 'Studio Malu',
      externalId: '5511999999999',
      id: 'identity-1',
      kind: 'phone',
      phoneStatus: 'confirmed',
    },
  ],
  label: 'Studio Malu',
  latestActivityAt: '2026-09-08T12:00:00.000Z',
  provisional: false,
  updatedAt: '2026-09-08T12:00:00.000Z',
  version: 2,
};
const conversation = {
  assignedUser: { functionName: 'Vendedor', id: 'operator-1' },
  automationEpoch: 2,
  automationState: 'human',
  channel: 'whatsapp',
  contact: {
    displayHandle: 'Studio Malu',
    externalId: '5511999999999',
    id: contact.id,
    label: 'Studio Malu',
  },
  deal: { id: card.id, stage: 'produto', status: 'active' },
  handoff: null,
  id: 'conversation-1',
  lastMessage: {
    deliveryStatus: null,
    direction: 'inbound',
    authorId: 'contact-1',
    authorKind: 'contact',
    id: 'message-1',
    occurredAt: '2026-09-08T12:00:00.000Z',
    preview: 'Preciso de 120 camisetas.',
    status: 'received',
    type: 'text',
  },
  openedAt: '2026-09-08T11:00:00.000Z',
  requiresAttention: false,
  state: 'em_atendimento',
  terminalAt: null,
  updatedAt: '2026-09-08T12:00:00.000Z',
  version: 3,
};
/** @param {import('@playwright/test').Page} page @param {{assistant?: boolean, assistantKeepsOwner?: boolean, conflict?: boolean, empty?: boolean, failBoard?: boolean, failDetailOnce?: boolean, longThread?: boolean, mixedAuthors?: boolean, onBoard?:()=>void, onHandoffClaim?:(body:any)=>void, onMessage?:(body:any)=>void, pendingHandoff?:boolean}} [options] */
async function mockCrm(page, options = {}) {
  let conflict = options.conflict ?? false;
  let failDetail = options.failDetailOnce ?? false;
  const inboxConversation = options.pendingHandoff
    ? {
        ...conversation,
        assignedUser: null,
        handoff: {
          dueAt: '2026-09-08T16:10:00.000Z',
          id: 'handoff-1',
          status: 'pending',
          targetRole: 'Vendedor',
          version: 1,
        },
        requiresAttention: true,
        state: 'requer_atencao',
      }
    : options.assistant
      ? {
          ...conversation,
          assignedUser: options.assistantKeepsOwner
            ? conversation.assignedUser
            : null,
          automationState: 'assistant',
        }
      : conversation;
  const detailMessages = options.mixedAuthors
    ? [
        conversation.lastMessage,
        {
          ...conversation.lastMessage,
          authorId: 'AUTOMATION_EXECUTOR',
          authorKind: 'assistant',
          deliveryStatus: 'sent',
          direction: 'outbound',
          id: 'message-assistant',
          preview: 'Posso ajudar a organizar seu pedido.',
        },
        {
          ...conversation.lastMessage,
          authorId: 'operator-1',
          authorKind: 'human',
          direction: 'outbound',
          id: 'message-human',
          preview: 'Vou assumir seu atendimento agora.',
        },
      ]
    : options.longThread
      ? Array.from({ length: 30 }, (_, index) => ({
          ...conversation.lastMessage,
          id: `message-${index + 1}`,
          preview: `Mensagem de teste ${index + 1}: detalhes do atendimento.`,
        }))
      : [conversation.lastMessage];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/sessions/current') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
      return;
    }
    if (path === '/api/v1/events') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: ': connected\n\n',
      });
      return;
    }
    if (path === '/api/v1/kanban' && request.method() === 'GET') {
      options.onBoard?.();
      if (options.failBoard) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          eventCursor: 'evt-8',
          columns: options.empty
            ? []
            : [
                {
                  cards: [card],
                  count: 1,
                  items: [card],
                  label: 'Produto',
                  stage: 'product',
                  total: 1,
                },
              ],
        }),
      });
      return;
    }
    if (path === '/api/v1/inbox/conversations' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: options.empty ? [] : [inboxConversation],
          nextCursor: null,
          totalCount: options.empty ? 0 : 1,
        }),
      });
      return;
    }
    if (
      path === '/api/v1/inbox/conversations/conversation-1' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          conversation: inboxConversation,
          messages: detailMessages,
          suggestion: null,
        }),
      });
      return;
    }
    if (
      path === '/api/v1/handoffs/handoff-1/claim' &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      options.onHandoffClaim?.(request.postDataJSON());
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      });
      return;
    }
    if (
      path === '/api/v1/conversations/conversation-1/messages' &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      const body = request.postDataJSON();
      options.onMessage?.(body);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      });
      return;
    }
    if (path === '/api/v1/contacts' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: options.empty ? [] : [contact],
          nextCursor: null,
          totalCount: options.empty ? 0 : 1,
        }),
      });
      return;
    }
    if (path === '/api/v1/contacts/contact-1' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          activeDealCount: 1,
          contact,
          conversations: [conversation],
          deals: [
            {
              assignedUser: null,
              createdAt: '2026-09-06T12:00:00.000Z',
              id: card.id,
              stage: 'produto',
              status: 'active',
              updatedAt: '2026-09-08T12:00:00.000Z',
              version: 4,
            },
          ],
          identities: contact.identities,
        }),
      });
      return;
    }
    if (path === '/api/v1/deals/deal-1' && request.method() === 'GET') {
      if (failDetail) {
        failDetail = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        headers: { ETag: '"deal-1-v4"' },
        body: JSON.stringify({
          eventCursor: 'evt-8',
          deal: {
            ...card,
            status: 'OPEN',
          },
          qualification: {
            assessments: [
              { field: 'items[0].estimatedQuantity', status: 'pending' },
              { field: 'order.customer', status: 'confirmed' },
            ],
            order: {
              commercialIntent: 'uniforme',
              customerPresent: true,
              namePresent: true,
            },
            items: [
              {
                productCode: 'camiseta',
                modelCode: 'tradicional',
                fabrics: [{ code: 'algodao' }],
                grade: [{ sizeLookup: 'M', quantity: 120 }],
                estimatedQuantity: 120,
                catalogVersionNumber: 3,
              },
            ],
            artwork: {
              techniqueCode: 'silk',
              colorsCount: 2,
              locationsCount: 1,
              status: 'pending',
            },
            logistics: {
              mode: 'delivery',
              desiredDate: '2026-09-30',
              addressPresent: true,
              pickupLocationPresent: false,
            },
            totalQuantity: 120,
          },
          nextTask: {
            id: 'task-1',
            type: 'follow_up',
            status: 'pending',
            version: 2,
            dueAt: '2026-09-08T12:00:00Z',
          },
          tasks: [
            {
              id: 'task-1',
              type: 'follow_up',
              status: 'pending',
              version: 2,
              dueAt: '2026-09-08T12:00:00Z',
            },
          ],
          handoffs: [
            {
              id: 'handoff-1',
              reasonCode: 'automation_sla',
              status: 'pending',
              version: 1,
              dealVersion: 4,
              conversationVersion: 3,
              taskId: 'task-handoff-1',
              taskVersion: 1,
            },
          ],
          gates: [
            {
              fromStage: 'produto',
              blockers: ['items[0].estimatedQuantity'],
              sourceVersion: 4,
              evaluatedAt: '2026-09-06T12:00:00Z',
            },
          ],
          history: [
            {
              eventKind: 'deal.created',
              occurredAt: '2026-09-06T12:00:00Z',
              resultingVersion: 1,
            },
          ],
        }),
      });
      return;
    }
    if (
      path === '/api/v1/deals/deal-1/transitions' &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.postDataJSON()).toMatchObject({
        direction: 'forward',
        expectedVersion: 4,
      });
      if (conflict) {
        conflict = false;
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'STALE_VERSION' }),
        });
      } else await route.fulfill({ status: 204 });
      return;
    }
    if (path === '/api/v1/tasks/task-1/start' && request.method() === 'POST') {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.postDataJSON()).toEqual({
        expectedTaskVersion: 2,
        reasonCode: 'manual_follow_up',
      });
      await route.fulfill({ contentType: 'application/json', body: '{}' });
      return;
    }
    if (
      path === '/api/v1/handoffs/handoff-1/accept' &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.postDataJSON()).toEqual({
        expectedConversationVersion: 3,
        expectedDealVersion: 4,
        expectedHandoffVersion: 1,
        expectedTaskVersion: 1,
        reasonCode: 'handoff_accepted',
      });
      await route.fulfill({ contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: '{}',
    });
  });
}

test('renders the five-stage Kanban and opens a deal with keyboard', async ({
  page,
}) => {
  await mockCrm(page);
  await page.goto('/kanban');
  await expect(
    page.getByRole('heading', { name: 'Kanban comercial' }),
  ).toBeFocused();
  for (const name of [
    'Produto',
    'Especificação',
    'Estampa',
    'Logística',
    'Fechamento',
  ])
    await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Cliente 028')).toBeVisible();
  await page.getByRole('link', { name: /Cliente 028/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/negocios/deal-1');
  await expect(
    page.getByRole('heading', { name: 'Cliente 028' }),
  ).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Transferências e retomadas' }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL('/negocios/deal-1');
  await expect(
    page.getByRole('heading', { name: 'Cliente 028' }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Aceitar retomada' }),
  ).toBeVisible();
  const startTask = page.getByRole('button', { name: 'Iniciar' });
  await startTask.click();
  await expect(page.getByRole('status')).toHaveText(
    'Tarefa atualizada: iniciar.',
  );
  await expect(startTask).toBeFocused();
  const acceptHandoff = page.getByRole('button', { name: 'Aceitar retomada' });
  await acceptHandoff.click();
  await expect(page.getByRole('status')).toHaveText(
    'Aceitar retomada concluída.',
  );
  await expect(acceptHandoff).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('exposes the CRM screens as authenticated Vue routes', async ({
  page,
}) => {
  await mockCrm(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeFocused();
  for (const name of [
    'Dashboard',
    'Caixa de Entrada',
    'Kanban',
    'Clientes',
    'Conta',
  ]) {
    await expect(
      page
        .getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('link', { name }),
    ).toBeVisible();
  }
  await expect(page.getByText('Studio Malu').first()).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Caixa de Entrada' })
    .press('Enter');
  await expect(page).toHaveURL('/inbox');
  await expect(
    page.getByRole('heading', { name: 'Caixa de Entrada' }),
  ).toBeFocused();
  await expect(page.getByRole('button', { name: /Studio Malu/ })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Clientes' })
    .press('Enter');
  await expect(page).toHaveURL('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('claims a pending handoff from its conversation in the Caixa de Entrada', async ({
  page,
}) => {
  let claimedBody;
  await mockCrm(page, {
    onHandoffClaim: (body) => (claimedBody = body),
    pendingHandoff: true,
  });
  await page.goto('/inbox');
  await page.evaluate(() => {
    globalThis.document.cookie = 'crm_csrf=csrf-test; Path=/; SameSite=Lax';
  });
  await expect(
    page.getByRole('heading', { name: 'Caixa de Entrada' }),
  ).toBeFocused();
  await expect(page.getByText('Aguardando vendedor')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Handoffs pendentes' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Assumir atendimento' }).click();
  await expect(page.locator('.audit-note')).toContainText(
    'Atendimento de Studio Malu assumido.',
  );
  expect(claimedBody).toEqual({
    expectedConversationVersion: 3,
    expectedHandoffVersion: 1,
    reasonCode: 'handoff_claimed',
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('labels human and AI service distinctly and only permits transfer after takeover', async ({
  page,
}) => {
  await mockCrm(page);
  await page.goto('/inbox');
  await expect(
    page.locator('.inbox-list .badge', {
      hasText: 'Em atendimento por vendedor',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Repassar atendimento' }),
  ).toBeVisible();

  await mockCrm(page, { assistant: true, assistantKeepsOwner: true });
  await page.reload();
  await expect(
    page.locator('.inbox-list .badge', { hasText: 'Em atendimento por IA' }),
  ).toBeVisible();
  await expect(page.locator('.conv-identity')).not.toContainText('Você');
  await expect(
    page.getByRole('button', { name: 'Repassar atendimento' }),
  ).toHaveCount(0);
});

test('keeps a long conversation inside its own scrollable message area', async ({
  page,
}) => {
  await mockCrm(page, { longThread: true });
  await page.goto('/inbox');
  const metrics = await page.locator('.thread').evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: globalThis.getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));

  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
});

test('identifies customer, assistant, and seller messages in the conversation', async ({
  page,
}) => {
  await mockCrm(page, { mixedAuthors: true });
  await page.goto('/inbox');

  await expect(
    page.locator(".message[data-from='cliente'] .msg-role"),
  ).toHaveText('Cliente');
  await expect(
    page.locator(".message[data-from='agente'] .msg-role"),
  ).toHaveText('IA');
  await expect(
    page.locator(".message[data-from='humano'] .msg-role"),
  ).toHaveText('Vendedor');
  await expect(page.getByText('Entrega: sent')).toHaveCount(0);
});

test('restores search focus after removing filter controls', async ({
  page,
}) => {
  await mockCrm(page);

  await page.goto('/clientes');
  const clientSearch = page.locator('#client-search');
  await clientSearch.fill('inexistente');
  const clearClientSearch = page.getByRole('button', {
    name: 'Limpar busca',
  });
  await clearClientSearch.focus();
  await clearClientSearch.press('Enter');
  await expect(clientSearch).toBeFocused();

  await page.goto('/inbox');
  const inboxSearch = page.locator('#inbox-search');
  await inboxSearch.fill('inexistente');
  const clearInboxSearch = page.getByRole('button', {
    name: 'Limpar busca',
  });
  await clearInboxSearch.focus();
  await clearInboxSearch.press('Enter');
  await expect(inboxSearch).toBeFocused();
});

test('does not expose the technical contact identifier in the client list', async ({
  page,
}) => {
  await mockCrm(page);

  await page.goto('/clientes');

  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();
  await expect(page.getByText(contact.id, { exact: true })).toHaveCount(0);
});

test('simplifies the client summary without operational status or count', async ({
  page,
}) => {
  await mockCrm(page);

  await page.goto('/clientes');

  await expect(page.getByRole('button', { name: 'Editar nome' })).toBeVisible();
  await expect(page.getByText('Cadastro provisório')).toHaveCount(0);
  await expect(
    page.locator('.client-facts').getByText('Conversas'),
  ).toHaveCount(0);
});

test('formats the contact phone without an editable input', async ({
  page,
}) => {
  await mockCrm(page);

  await page.goto('/clientes');

  await expect(page.locator('.contact-phone dd')).toHaveText(
    '+55 (11) 99999-9999',
  );
  await expect(page.locator('.contact-phone input')).toHaveCount(0);
  await expect(page.getByText('Telefone: confirmed')).toHaveCount(0);
  await expect(
    page.locator('.contact-channels').getByText('WhatsApp', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.contact-channels')
      .getByText(contact.identities[0].externalId, { exact: true }),
  ).toHaveCount(0);
});

test('formats the phone in the active conversation identity', async ({
  page,
}) => {
  await mockCrm(page, { assistant: true });

  await page.goto('/inbox');

  await expect(page.locator('.conv-identity')).toContainText(
    '+55 (11) 99999-9999 · Em atendimento por IA',
  );
});

test('sends an authorized human reply through the official command', async ({
  page,
}) => {
  let sentBody;
  await mockCrm(page, { onMessage: (body) => (sentBody = body) });
  await page.goto('/inbox');
  await page.evaluate(() => {
    globalThis.document.cookie = 'crm_csrf=csrf-test; Path=/; SameSite=Lax';
  });
  await page.getByLabel('Responder').fill('Resposta persistida');
  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(page.getByText('Mensagem aceita para envio.')).toBeVisible();
  expect(sentBody).toEqual({
    content: { text: 'Resposta persistida' },
    expectedVersion: 3,
    messageType: 'text',
    reason: 'Resposta humana na Caixa de Entrada',
  });
});

test('keeps the official command authoritative and refetches after 409', async ({
  page,
}) => {
  await mockCrm(page, { conflict: true });
  await page.goto('/kanban');
  const move = page.getByRole('button', { name: /Mover Cliente 028/ });
  await move.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cliente 028' });
  await dialog.getByLabel('Etapa adjacente').selectOption('specification');
  await dialog.getByLabel('Motivo').fill('Dados confirmados');
  await dialog
    .getByRole('button', { name: 'Confirmar mudança' })
    .press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    'mudou enquanto você trabalhava',
  );
  await expect(page.getByText('Cliente 028')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Mover Cliente 028/ }),
  ).toBeFocused();
});

test('uses one SSE per session and refetches without stealing focus', async ({
  page,
}) => {
  let boardRequests = 0;
  await page.addInitScript(() => {
    const testGlobal = /** @type {any} */ (globalThis);
    testGlobal.__kanbanSources = [];
    class FakeEventSource extends globalThis.EventTarget {
      constructor() {
        super();
        testGlobal.__kanbanSources.push(this);
      }
      close() {}
    }
    testGlobal.EventSource = FakeEventSource;
  });
  await mockCrm(page, { onBoard: () => (boardRequests += 1) });
  await page.goto('/kanban');
  const move = page.getByRole('button', { name: /Mover Cliente 028/ });
  await move.focus();
  await page.evaluate(() => {
    const testGlobal = /** @type {any} */ (globalThis);
    const event = new globalThis.MessageEvent('kanban.card.changed', {
      data: JSON.stringify({ dealId: 'deal-1', dealVersion: 5 }),
    });
    Object.defineProperty(event, 'lastEventId', { value: 'evt-9' });
    testGlobal.__kanbanSources[0].dispatchEvent(event);
  });
  await expect.poll(() => boardRequests).toBeGreaterThan(1);
  await expect(move).toBeFocused();
  expect(
    await page.evaluate(
      () => /** @type {any} */ (globalThis).__kanbanSources.length,
    ),
  ).toBe(1);
});

test('supports empty and error states without accessibility violations', async ({
  page,
}) => {
  await mockCrm(page, { empty: true });
  await page.goto('/kanban');
  await expect(page.getByText('Nenhum negócio nesta etapa.')).toHaveCount(5);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('reflows at 320px, 200% zoom and reduced motion', async ({ page }) => {
  await mockCrm(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/kanban');
  await page.evaluate(() => {
    globalThis.document.documentElement.style.zoom = '2';
  });
  await expect(page.getByLabel('Etapa visível')).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth >
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('renders a recoverable board error', async ({ page }) => {
  await mockCrm(page, { failBoard: true });
  await page.goto('/kanban');
  await expect(
    page.getByRole('main').getByText('Não foi possível carregar o Kanban.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Tentar novamente' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('restores focus after retrying a failed deal detail', async ({ page }) => {
  await mockCrm(page, { failDetailOnce: true });
  await page.goto('/negocios/deal-1');
  const retry = page.getByRole('button', { name: 'Tentar novamente' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(
    page.getByRole('heading', { name: 'Cliente 028' }),
  ).toBeFocused();
});
