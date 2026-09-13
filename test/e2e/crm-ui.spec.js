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
/**
 * PCX-03/PCX-04: three conversations the agent stopped, each for a different
 * reason and waiting for a different length of time. They are declared out of
 * order on purpose, so a list that renders them oldest-first proves it sorted
 * rather than echoed the answer.
 *
 * @param {Date} now
 */
function waitingConversations(now) {
  /** @param {number} minutes */
  const ago = (minutes) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();
  return [
    ['conversation-1', 'Studio Malu', 'price_before_quote', 134],
    ['conversation-2', 'Time Fênix Futsal', 'customer_requested_human', 1623],
    ['conversation-3', 'Igreja Nova Aliança', 'briefing_complete', 47],
  ].map(([id, label, reasonCode, waitedMinutes]) => ({
    ...conversation,
    assignedUser: null,
    contact: { ...conversation.contact, label: String(label) },
    handoff: {
      createdAt: ago(Number(waitedMinutes)),
      dueAt: '2026-09-08T16:10:00.000Z',
      id: `handoff-${id}`,
      reasonCode,
      status: 'pending',
      targetRole: 'Vendedor',
      version: 1,
    },
    id: String(id),
    requiresAttention: true,
    state: 'requer_atencao',
  }));
}

/**
 * One SSE payload delivered on connect, with a long retry so the reconnect
 * does not turn a single event into a refresh loop during the test.
 *
 * @param {Record<string, unknown>|null} event
 */
function eventStreamBody(event) {
  if (!event) return 'retry: 60000\n\n: connected\n\n';
  return [
    'retry: 60000',
    '',
    `event: ${event.type}`,
    'id: evt-2',
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}

/** The pending order of `conversation-1`, as the orders read model presents it. */
const conversationOrder = {
  confirmedAt: null,
  confirmedBy: null,
  conversationId: 'conversation-1',
  createdAt: '2026-09-08T12:30:00.000Z',
  fabCode: 'FAB 01',
  ficha: {
    items: [
      {
        grade: [
          { quantidade: 100, tamanho: 'M' },
          { quantidade: 50, tamanho: 'G' },
        ],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'CAMISETA',
      },
    ],
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Studio Malu',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2027',
    },
  },
  finalAmountCents: null,
  id: 'order-pendente',
  missingFields: ['finalAmount', 'paymentCondition'],
  number: '07-CRM',
  orderDate: null,
  paymentCondition: null,
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'operator-1', name: 'Marina Aguiar' },
  status: 'pendente',
  totalPieces: 150,
  updatedAt: '2026-09-08T12:46:00.000Z',
  version: 2,
};

/** @param {import('@playwright/test').Page} page @param {{assistant?: boolean, assistantKeepsOwner?: boolean, conflict?: boolean, confirmOnRefresh?: boolean, empty?: boolean, failBoard?: boolean, failDetailOnce?: boolean, liveEvent?: Record<string, unknown>|null, longThread?: boolean, mixedAuthors?: boolean, noAdmin?: boolean, onBoard?:()=>void, onCreateOrder?:(body:any)=>void, onHandoffClaim?:(body:any)=>void, onInboxList?:(params:URLSearchParams)=>void, onMessage?:(body:any)=>void, order?: any, otherOwner?: boolean, pendingHandoff?:boolean, suggestion?:boolean, waitingQueue?:boolean}} [options] */
async function mockCrm(page, options = {}) {
  let conflict = options.conflict ?? false;
  let failDetail = options.failDetailOnce ?? false;
  let inboxListCalls = 0;
  const waiting = options.waitingQueue ? waitingConversations(new Date()) : [];
  // The conversation carries the order summary the Inbox read model joins in,
  // so the header button and the drawer never disagree about which order it is.
  let currentOrder = options.order === undefined ? null : options.order;
  /** @param {any} order */
  const orderSummary = (order) =>
    order ? { id: order.id, number: order.number, status: order.status } : null;
  const activeSession = options.noAdmin
    ? { user: { ...session.user, capabilities: [] } }
    : session;
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
  /** The list and the detail answer the same conversation, order included. */
  const withOrder = () => ({
    ...inboxConversation,
    ...(options.otherOwner
      ? { assignedUser: { functionName: 'Vendedor', id: 'operator-2' } }
      : {}),
    order: orderSummary(currentOrder),
  });
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
        body: JSON.stringify(activeSession),
      });
      return;
    }
    if (path === '/api/v1/events') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: eventStreamBody(options.liveEvent ?? null),
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
      options.onInboxList?.(url.searchParams);
      inboxListCalls += 1;
      // Somebody else confirmed the order between the first read and the
      // refresh the live event triggers.
      if (options.confirmOnRefresh && inboxListCalls > 1 && currentOrder) {
        currentOrder = { ...currentOrder, status: 'confirmado' };
      }
      const items = options.empty
        ? []
        : waiting.length
          ? waiting
          : [withOrder()];
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items,
          nextCursor: null,
          totalCount: items.length,
        }),
      });
      return;
    }
    const inboxDetail = /^\/api\/v1\/inbox\/conversations\/([^/]+)$/u.exec(
      path,
    );
    if (inboxDetail && request.method() === 'GET') {
      const selected =
        waiting.find((item) => item.id === inboxDetail[1]) ??
        (inboxDetail[1] === 'conversation-1' ? withOrder() : null);
      if (!selected) {
        await route.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: '{}',
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          conversation: selected,
          messages: detailMessages,
          suggestion: options.suggestion
            ? {
                automationEpoch: 2,
                createdAt: '2026-09-08T12:05:00.000Z',
                id: 'suggestion-1',
                proposedStage: 'produto',
                question: 'Confirmo a quantidade com o cliente?',
                sourceMessageId: 'message-1',
                status: 'pending',
              }
            : null,
        }),
      });
      return;
    }
    if (
      path === '/api/v1/conversations/conversation-1/order' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order: currentOrder }),
      });
      return;
    }
    if (
      path === '/api/v1/conversations/conversation-1/orders' &&
      request.method() === 'POST'
    ) {
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      const body = request.postDataJSON();
      options.onCreateOrder?.(body);
      // PCL-11: an existing pending order is answered, never a second one.
      const created = currentOrder === null;
      if (created) {
        currentOrder = {
          ...conversationOrder,
          id: 'order-novo',
          missingFields: ['items', 'finalAmount', 'paymentCondition'],
          number: '11-CRM',
          ficha: { ...conversationOrder.ficha, items: [] },
          totalPieces: 0,
          version: 1,
        };
      }
      await route.fulfill({
        status: created ? 201 : 200,
        contentType: 'application/json',
        body: JSON.stringify({ order: currentOrder }),
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

test.skip('renders the five-stage Kanban and opens a deal with keyboard', async ({
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
    'Vendedores',
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
  await expect(
    page.locator('.inbox-list').getByText('Aguardando vendedor'),
  ).toBeVisible();
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

test('filters the Inbox by queue and by who must act through the server read model', async ({
  page,
}) => {
  const inboxQueries = /** @type {Array<Record<string, string>>} */ ([]);
  await mockCrm(page, {
    onInboxList: (params) => inboxQueries.push(Object.fromEntries(params)),
  });
  await page.goto('/inbox');

  const summary = page.locator('.inbox-state-menu summary');
  const menu = page.locator('.inbox-state-panel');
  /** Each menu entry closes the panel, so every pick reopens it first. */
  /** @param {string} name */
  const pickState = async (name) => {
    await summary.click();
    await menu.getByRole('button', { name, exact: true }).click();
  };

  // PCX-01: the conversation-state filter is gone, name and options alike.
  await expect(page.getByText('Situação', { exact: true })).toHaveCount(0);
  await summary.click();
  await expect(
    menu.getByRole('button', { name: 'Requer atenção' }),
  ).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Em análise' })).toHaveCount(0);
  await summary.click();

  // PCX-05: the queue keeps deciding whose conversations are listed.
  await page.getByRole('button', { name: 'Minhas conversas' }).click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ assignedUserId: 'operator-1' });
  await expect(
    page.getByRole('button', { name: 'Minhas conversas' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // PCX-02: the four states, each combined with the queue already chosen.
  await pickState('Aguardando vendedor');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ assignedUserId: 'operator-1', pendingHandoff: 'true' });
  expect(inboxQueries.at(-1)?.automationState).toBeUndefined();

  await pickState('Com o agente');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      assignedUserId: 'operator-1',
      automationState: 'assistant',
      pendingHandoff: 'false',
    });

  await page.getByRole('button', { name: 'Aguardando atendimento' }).click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      automationState: 'assistant',
      pendingHandoff: 'false',
      unassignedHumanHandoff: 'true',
    });
  expect(inboxQueries.at(-1)?.assignedUserId).toBeUndefined();
  await expect(
    page.getByRole('button', { name: 'Aguardando atendimento' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await pickState('Com vendedor');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      automationState: 'human',
      pendingHandoff: 'false',
      unassignedHumanHandoff: 'true',
    });

  // PCX-05: archived conversations stay one click away, under any state.
  await pickState('Ver arquivadas');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      archived: 'true',
      automationState: 'human',
      pendingHandoff: 'false',
    });

  await pickState('Todas');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ archived: 'true' });
  expect(inboxQueries.at(-1)?.automationState).toBeUndefined();
  expect(inboxQueries.at(-1)?.pendingHandoff).toBeUndefined();

  await pickState('Ver caixa de entrada');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ archived: 'false' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('names the stop reason and waits, oldest first, when the seller is due', async ({
  page,
}) => {
  await mockCrm(page, { waitingQueue: true });
  await page.goto('/inbox');

  const summary = page.locator('.inbox-state-menu summary');
  await summary.click();
  await page
    .locator('.inbox-state-panel')
    .getByRole('button', { name: 'Aguardando vendedor', exact: true })
    .click();

  // PCX-04: the conversation waiting the longest leads, whatever order the
  // page happened to receive.
  await expect(page.locator('.inbox-list .conv-name')).toHaveText([
    'Time Fênix Futsal',
    'Studio Malu',
    'Igreja Nova Aliança',
  ]);

  // PCX-03/A03: the reason the agent stopped, in the seller's words.
  await expect(page.locator('.inbox-list .conv-meta .badge')).toContainText([
    'Pediu um vendedor',
    'Perguntou o valor',
    'Pré-ficha completa',
  ]);

  // PCX-03/A02: how long it has been still, counted from the handoff.
  await expect(page.locator('.inbox-list .conv-waiting')).toHaveText([
    'parado há 1d 03h',
    'parado há 2h 14min',
    'parado há 47min',
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('names the order status on the button that opens the drawer', async ({
  page,
}) => {
  // PCX-06: the three things the button can say, read from the conversation.
  await mockCrm(page, { order: conversationOrder });
  await page.goto('/inbox');
  await expect(
    page.getByRole('button', { name: 'Pedido · Pendente' }),
  ).toBeVisible();

  await mockCrm(page, {
    order: { ...conversationOrder, missingFields: [], status: 'confirmado' },
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Pedido · Confirmado' }),
  ).toBeVisible();

  await mockCrm(page, { order: null });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Pedido · Sem pedido' }),
  ).toBeVisible();
});

test('updates the order button when the order changes elsewhere', async ({
  page,
}) => {
  // PLI-08: the confirmation happened on the order page, in another tab. The
  // Inbox learns it from `inbox.order.changed`, with nobody reloading.
  await mockCrm(page, {
    confirmOnRefresh: true,
    liveEvent: {
      payload: {
        conversationId: 'conversation-1',
        orderId: 'order-pendente',
      },
      type: 'inbox.order.changed',
    },
    order: conversationOrder,
  });
  await page.goto('/inbox');

  await expect(
    page.getByRole('button', { name: 'Pedido · Confirmado' }),
  ).toBeVisible();
  expect(page.url()).toContain('/inbox');
});

test('summarises the order in a drawer that closes with Esc and gives focus back', async ({
  page,
}) => {
  await mockCrm(page, { order: conversationOrder });
  await page.goto('/inbox');

  const trigger = page.getByRole('button', { name: /^Pedido/ });
  await trigger.click();

  // PCX-07: number, status, what is missing, items, pieces, amount and the
  // one way out of the summary and into the order itself.
  const drawer = page.getByRole('dialog', { name: /Pedido 07-CRM/ });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Pendente');
  await expect(drawer).toContainText('Falta valor e condição');
  await expect(drawer).toContainText('CAMISETA · GOLA OLÍMPICA');
  await expect(drawer).toContainText('150 peças');
  await expect(drawer).toContainText('—');
  await expect(
    drawer.getByRole('link', { name: 'Abrir pedido' }),
  ).toHaveAttribute('href', '/pedidos/order-pendente?conversa=conversation-1');
  // The drawer reads the order; it never edits it.
  await expect(drawer.locator('input, textarea, select')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // PCX-09: Esc closes it and the button that opened it takes focus back.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('closes the order drawer on a click outside', async ({ page }) => {
  await mockCrm(page, { order: conversationOrder });
  await page.goto('/inbox');

  const trigger = page.getByRole('button', { name: /^Pedido/ });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: /Pedido 07-CRM/ });
  await expect(drawer).toBeVisible();

  // PCX-09: the backdrop is the dialog itself outside its panel.
  await page.mouse.click(8, 8);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('operates the order drawer with the keyboard alone', async ({ page }) => {
  await mockCrm(page, { order: conversationOrder });
  await page.goto('/inbox');

  const trigger = page.getByRole('button', { name: /^Pedido/ });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const drawer = page.getByRole('dialog', { name: /Pedido 07-CRM/ });
  await expect(drawer).toBeVisible();

  // PCX-09: focus opens inside the drawer, and Tab only ever reaches what the
  // drawer offers — the Inbox behind it is inert, so nothing there can be
  // reached or acted on while the drawer is open.
  /** @returns {Promise<string>} */
  const focusHere = () =>
    page.evaluate(() => {
      const active = globalThis.document.activeElement;
      const dialog = globalThis.document.querySelector('.order-drawer');
      if (active === globalThis.document.body) return 'body';
      return dialog?.contains(active) ? 'drawer' : 'behind';
    });

  const ring = [await focusHere()];
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Tab');
    ring.push(await focusHere());
  }
  expect(ring[0]).toBe('drawer');
  expect(ring).not.toContain('behind');
  expect(ring.slice(1)).toContain('drawer');

  await drawer.getByRole('button', { name: 'Fechar' }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('creates the order from the drawer only for the owner or an administrator', async ({
  page,
}) => {
  // PCL-11: a conversation that already has a pending order never offers it.
  await mockCrm(page, { order: conversationOrder });
  await page.goto('/inbox');
  await page.getByRole('button', { name: /^Pedido/ }).click();
  await expect(page.getByRole('button', { name: 'Criar pedido' })).toHaveCount(
    0,
  );

  // PCX-08: a reader who neither owns the conversation nor administrates it
  // sees the drawer without the action the API would refuse.
  await mockCrm(page, { noAdmin: true, order: null, otherOwner: true });
  await page.reload();
  await page.getByRole('button', { name: /^Pedido/ }).click();
  const drawer = page.getByRole('dialog', { name: /pedido/i });
  await expect(drawer).toContainText('Sem pedido');
  await expect(
    drawer.getByRole('button', { name: 'Criar pedido' }),
  ).toHaveCount(0);

  // PCL-10: the owner creates it, pre-filled from the conversation, and the
  // drawer switches to the order that came back.
  let createdBody;
  await mockCrm(page, {
    onCreateOrder: (body) => (createdBody = body),
    order: null,
  });
  await page.reload();
  await page.evaluate(() => {
    globalThis.document.cookie = 'crm_csrf=csrf-test; Path=/; SameSite=Lax';
  });
  await page.getByRole('button', { name: /^Pedido/ }).click();
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await expect(
    page.getByRole('dialog', { name: /Pedido 11-CRM/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Abrir pedido' }),
  ).toHaveAttribute('href', '/pedidos/order-novo?conversa=conversation-1');
  expect(createdBody).toEqual({ expectedVersion: 3 });
});

test('drops the pending AI suggestion block from the conversation', async ({
  page,
}) => {
  await mockCrm(page, { suggestion: true });
  await page.goto('/inbox');

  await expect(page.getByRole('button', { name: /Studio Malu/ })).toBeVisible();
  // PCX-01/D21: the block is gone even when the read model still answers one.
  await expect(page.getByText('Sugestão pendente da IA')).toHaveCount(0);
  await expect(page.locator('.suggestion')).toHaveCount(0);
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

test.skip('keeps the official command authoritative and refetches after 409', async ({
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

test.skip('uses one SSE per session and refetches without stealing focus', async ({
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

test.skip('supports empty and error states without accessibility violations', async ({
  page,
}) => {
  await mockCrm(page, { empty: true });
  await page.goto('/kanban');
  await expect(page.getByText('Nenhum negócio nesta etapa.')).toHaveCount(5);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test.skip('reflows at 320px, 200% zoom and reduced motion', async ({
  page,
}) => {
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

test.skip('renders a recoverable board error', async ({ page }) => {
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

test.skip('restores focus after retrying a failed deal detail', async ({
  page,
}) => {
  await mockCrm(page, { failDetailOnce: true });
  await page.goto('/negocios/deal-1');
  const retry = page.getByRole('button', { name: 'Tentar novamente' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(
    page.getByRole('heading', { name: 'Cliente 028' }),
  ).toBeFocused();
});
