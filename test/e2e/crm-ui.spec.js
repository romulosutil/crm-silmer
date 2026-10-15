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
        gola: 'GOLA OLÍMPICA',
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

/** @param {import('@playwright/test').Page} page @param {{assistant?: boolean, assistantKeepsOwner?: boolean, conflict?: boolean, confirmOnRefresh?: boolean, empty?: boolean, failBoard?: boolean, failDetailOnce?: boolean, failedDelivery?: boolean, liveEvent?: Record<string, unknown>|null, longThread?: boolean, manyContacts?: boolean, manyConversations?: boolean, mixedAuthors?: boolean, newMessageOnRefresh?: boolean, noAdmin?: boolean, onBoard?:()=>void, onCreateOrder?:(body:any)=>void, onHandoffClaim?:(body:any)=>void, onInboxList?:(params:URLSearchParams)=>void, onMessage?:(body:any)=>void, order?: any, otherOwner?: boolean, pendingHandoff?:boolean, siteChat?:boolean, suggestion?:boolean, waitingQueue?:boolean}} [options] */
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
    ...(options.siteChat
      ? {
          channel: 'site_chat',
          contact: {
            ...inboxConversation.contact,
            externalId: '999001899004479995964365389745407152128',
            phone: '5527999991234',
            phoneSource: 'site_unverified',
          },
        }
      : {}),
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
          deliveryErrorCode: options.failedDelivery
            ? 'N8N_COMMAND_HTTP_401'
            : null,
          deliveryStatus: options.failedDelivery ? 'failed' : null,
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
    if (path === '/api/v1/orders/summary' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          averageTicketCents: 125000,
          confirmedCount: 2,
          pendingCount: 1,
          soldAmountCents: 250000,
          totalPiecesSold: 300,
        }),
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
      const currentConversation = withOrder();
      const items = options.empty
        ? []
        : waiting.length
          ? waiting
          : options.manyConversations
            ? Array.from({ length: 40 }, (_, index) => ({
                ...currentConversation,
                contact: {
                  ...currentConversation.contact,
                  label: `Cliente de teste ${index + 1}`,
                },
                id: index
                  ? `conversation-${index + 1}`
                  : currentConversation.id,
              }))
            : [
                options.newMessageOnRefresh && inboxListCalls > 1
                  ? {
                      ...currentConversation,
                      lastMessage: {
                        ...currentConversation.lastMessage,
                        id: 'message-new',
                        preview: 'Mensagem nova de teste',
                      },
                    }
                  : currentConversation,
              ];
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
    if (
      /^\/api\/v1\/inbox\/conversations\/[^/]+\/subjects$/u.test(path) &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          currentSubjectId: null,
          links: [],
          orders: [],
          ordersHasMore: false,
          subjects: [],
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
          items: options.empty
            ? []
            : options.manyContacts
              ? Array.from({ length: 60 }, (_, index) => ({
                  ...contact,
                  id: index ? `contact-${index + 1}` : contact.id,
                  label: index
                    ? `Cliente de teste ${index + 1}`
                    : contact.label,
                }))
              : [contact],
          nextCursor: null,
          totalCount: options.empty ? 0 : options.manyContacts ? 60 : 1,
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

  await expect(
    page.getByRole('heading', { name: 'Dashboard', level: 1 }),
  ).toBeFocused();
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
  await expect(page.getByText('R$ 2.500,00')).toBeVisible();
  await expect(
    page
      .getByText('Vendas', { exact: true })
      .locator('..')
      .locator('.kpi-value'),
  ).toHaveText('2');
  await expect(page.getByText('Peças por venda')).toBeVisible();

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
  await expect(
    page.getByRole('heading', { name: 'Clientes', level: 1 }),
  ).toBeFocused();
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('selects a conversation subject by keyboard and restores focus', async ({
  page,
}) => {
  await mockCrm(page);
  let currentSubjectId = 'subject-general';
  await page.route(
    '**/api/v1/inbox/conversations/conversation-1/subjects?*',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          currentSubjectId,
          links: [],
          orders: [],
          ordersHasMore: false,
          subjects: [
            {
              id: 'subject-general',
              kind: 'geral',
              orderId: null,
              orderNumber: null,
              orderStatus: null,
              position: 1,
              isCurrent: currentSubjectId === 'subject-general',
              selectedSource: 'human',
              version: 1,
            },
            {
              id: 'subject-order',
              kind: 'pedido',
              orderId: 'order-1',
              orderNumber: '01-CRM',
              orderStatus: 'pendente',
              position: 2,
              isCurrent: currentSubjectId === 'subject-order',
              selectedSource: 'human',
              version: 1,
            },
          ],
        }),
      });
    },
  );
  await page.route(
    '**/api/v1/inbox/conversations/conversation-1/subjects/subject-order/select',
    async (route) => {
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      currentSubjectId = 'subject-order';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ currentSubjectId, version: 2 }),
      });
    },
  );

  await page.goto('/inbox');
  // The subjects sit in the context panel, closed by default below 1440 px.
  await page.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const panel = page.locator('.subject-panel');
  const select = panel.getByRole('button', { name: 'Selecionar' });
  await expect(select).toBeVisible();
  await select.focus();
  await select.press('Enter');
  await expect(
    panel.getByRole('heading', { name: 'Assuntos deste atendimento' }),
  ).toBeFocused();
  await expect(panel.getByRole('status')).toHaveText('Assunto atual alterado.');
  expect(currentSubjectId).toBe('subject-order');
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
  await expect(
    page.getByText('Atendimento de Studio Malu assumido.', { exact: true }),
  ).toBeVisible();
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
  // Glossário: the badge uses the words of its tab.
  await expect(
    page.locator('.inbox-list .badge', { hasText: 'Com vendedor' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await expect(
    page.getByRole('button', { name: 'Repassar atendimento' }),
  ).toBeVisible();

  await mockCrm(page, { assistant: true, assistantKeepsOwner: true });
  await page.reload();
  await expect(
    page.locator('.inbox-list .badge', { hasText: 'Com o agente' }),
  ).toBeVisible();
  await expect(page.locator('.conv-identity')).not.toContainText('Você');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await expect(
    page.getByRole('button', { name: 'Repassar atendimento' }),
  ).toHaveCount(0);
});

test('never offers to hand the conversation back to the AI and keeps the actions on the keyboard', async ({
  page,
}) => {
  // ADR 015: a conversation with a person never goes back to the bot.
  /** @type {string[]} */
  const handBackRequests = [];
  page.on('request', (request) => {
    if (/return-to-ai|reactivate/u.test(request.url())) {
      handBackRequests.push(request.url());
    }
  });
  await mockCrm(page);
  await page.goto('/inbox');
  const actions = page.locator('.conv-actions');
  const order = actions.getByRole('button', { name: /^Pedido/ });
  await expect(order).toBeVisible();
  await expect(page.getByRole('button', { name: /Devolver/ })).toHaveCount(0);
  await expect(page.getByText(/à IA/u)).toHaveCount(0);

  // Achado 1: two visible actions and the rest under "Mais", in one tab
  // sequence with no gap where the removed button was.
  await order.focus();
  for (const name of ['Encerrar conversa', 'Mais ações', 'Detalhes']) {
    await page.keyboard.press('Tab');
    await expect(actions.getByRole('button', { name })).toBeFocused();
  }
  await expect(actions.locator('button:visible')).toHaveCount(4);

  // "Mais" opens from the keyboard on its first entry; Esc hands focus back.
  const more = actions.getByRole('button', { name: 'Mais ações' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(
    actions.getByRole('button', { name: 'Repassar atendimento' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    actions.getByRole('button', { name: 'Arquivar conversa' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(
    actions.getByRole('button', { name: 'Repassar atendimento' }),
  ).toBeHidden();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Repassar venda para')).toBeFocused();
  // The contact sits with the client, in the context panel.
  await actions.getByRole('button', { name: 'Detalhes' }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Detalhes' })
      .getByRole('link', { name: 'Ver contato' }),
  ).toHaveAttribute('href', '/clientes/contact-1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // With the agent, or waiting for a seller, taking over is the only change.
  for (const state of [{ assistant: true }, { pendingHandoff: true }]) {
    await mockCrm(page, state);
    await page.reload();
    await expect(
      actions.getByRole('button', { name: 'Assumir atendimento' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Devolver/ })).toHaveCount(0);
  }
  expect(handBackRequests).toEqual([]);
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

test('keeps a long conversation list inside its own scrollable column', async ({
  page,
}) => {
  await mockCrm(page, { manyConversations: true });
  await page.goto('/inbox');
  await expect(page.locator('.inbox-list .conversation-row')).toHaveCount(40);
  const listMetrics = () =>
    page.locator('.inbox-list').evaluate((element) => {
      const root = globalThis.document.documentElement;
      // Scrolled to the bottom of the page, where the top bar overlaps most.
      globalThis.scrollTo(0, root.scrollHeight);
      return {
        clientHeight: element.clientHeight,
        listTop: element.getBoundingClientRect().top,
        overflowY: globalThis.getComputedStyle(element).overflowY,
        pageHeight: root.scrollHeight,
        scrollHeight: element.scrollHeight,
        topbarBottom: globalThis.document
          .querySelector('.app-topbar')
          ?.getBoundingClientRect().bottom,
        viewportHeight: globalThis.innerHeight,
      };
    });

  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await listMetrics();
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.clientHeight).toBeLessThan(metrics.viewportHeight);
    // The page no longer grows with the list it holds.
    expect(metrics.pageHeight).toBeLessThan(metrics.scrollHeight);
    if (viewport.width >= 1200) {
      // Beside the thread, the list stays fully below the sticky top bar.
      expect(metrics.listTop).toBeGreaterThanOrEqual(
        Number(metrics.topbarBottom),
      );
    }
  }
  await page.evaluate(() => globalThis.scrollTo(0, 0));

  const lastConversation = page.getByRole('button', {
    name: /Cliente de teste 40/u,
  });
  await lastConversation.focus();
  await expect(lastConversation).toBeInViewport();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('identifies customer, assistant, and seller messages in the conversation', async ({
  page,
}) => {
  await mockCrm(page, { mixedAuthors: true });
  await page.goto('/inbox');

  await expect(
    page.locator(".message[data-from='cliente'] .msg-role"),
  ).toHaveText('Cliente');
  // Glossário (achado 5): one name for the assistant, from the brand.
  await expect(
    page.locator(".message[data-from='agente'] .msg-author"),
  ).toHaveText('Agente');
  await expect(
    page.locator(".message[data-from='humano'] .msg-author"),
  ).toHaveText('Vendedor');
  await expect(page.getByText('Assistente Silmer')).toHaveCount(0);
  await expect(page.getByText('Entrega: sent')).toHaveCount(0);
});

test('shows a failed delivery code to the seller in the Inbox', async ({
  page,
}) => {
  await mockCrm(page, { failedDelivery: true, mixedAuthors: true });
  await page.goto('/inbox');
  await expect(
    page.getByText('Falha no envio · código técnico: N8N_COMMAND_HTTP_401'),
  ).toBeVisible();
});

test('shows the declared site phone instead of the synthetic chat ID', async ({
  page,
}) => {
  await mockCrm(page, { siteChat: true });
  await page.goto('/inbox');
  await expect(page.locator('.conv-identity')).toContainText(
    /\+55 \(27\) 99999-1234\s*·\s*telefone informado no site/u,
  );
  await expect(
    page.getByText('999001899004479995964365389745407152128'),
  ).toHaveCount(0);
  await page.locator('#inbox-search').fill('5527999991234');
  await expect(
    page.getByRole('button', { name: /Studio Malu/u }),
  ).toBeVisible();
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

test('refreshes the Inbox manually when live updates fail and keeps focus on live refresh', async ({
  page,
}) => {
  const inboxQueries = /** @type {Array<Record<string, string>>} */ ([]);
  await page.addInitScript(() => {
    const testGlobal = /** @type {any} */ (globalThis);
    class FakeEventSource extends globalThis.EventTarget {
      constructor() {
        super();
        testGlobal.__inboxSource = this;
      }
      close() {}
    }
    testGlobal.EventSource = FakeEventSource;
  });
  await mockCrm(page, {
    // The tab totals (`limit=1`) ride along; only the list reads count here.
    onInboxList: (params) => {
      if (params.get('limit') !== '1') {
        inboxQueries.push(Object.fromEntries(params));
      }
    },
  });
  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: /Studio Malu/ })).toBeVisible();
  await page.getByLabel('Fila').selectOption('mine');
  await expect
    .poll(() => inboxQueries.at(-1)?.assignedUserId)
    .toBe('operator-1');

  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__inboxSource.dispatchEvent(
      new globalThis.Event('error'),
    );
  });
  await expect(page.getByText(/Reconectando atualizações/)).toBeVisible();
  const manualRefresh = page.getByRole('button', {
    name: 'Atualizar conversas',
  });
  await manualRefresh.click();
  await expect.poll(() => inboxQueries.length).toBeGreaterThan(2);
  expect(inboxQueries.at(-1)?.assignedUserId).toBe('operator-1');

  const search = page.locator('#inbox-search');
  await search.focus();
  const beforeReconnect = inboxQueries.length;
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__inboxSource.dispatchEvent(
      new globalThis.Event('open'),
    );
  });
  await expect.poll(() => inboxQueries.length).toBeGreaterThan(beforeReconnect);
  expect(inboxQueries.at(-1)?.assignedUserId).toBe('operator-1');
  await expect(search).toBeFocused();
  await expect(page.getByText(/Reconectando atualizações/)).toHaveCount(0);

  const beforeEvent = inboxQueries.length;
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__inboxSource.dispatchEvent(
      new globalThis.MessageEvent('inbox.conversation.changed', {
        data: JSON.stringify({ conversationId: 'conversation-1' }),
      }),
    );
  });
  await expect.poll(() => inboxQueries.length).toBeGreaterThan(beforeEvent);
  await expect(search).toBeFocused();
});

test('finds a new last message after the live event without moving search focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const testGlobal = /** @type {any} */ (globalThis);
    class FakeEventSource extends globalThis.EventTarget {
      constructor() {
        super();
        testGlobal.__inboxSource = this;
      }
      close() {}
    }
    testGlobal.EventSource = FakeEventSource;
  });
  await mockCrm(page, { newMessageOnRefresh: true });
  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: /Studio Malu/ })).toBeVisible();
  const search = page.locator('#inbox-search');
  await expect(page.locator('#inbox-search-help')).toContainText(
    'até 100 conversas carregadas',
  );
  await search.fill('Mensagem nova');
  await expect(search).toBeFocused();
  await expect(page.getByRole('button', { name: /Studio Malu/ })).toHaveCount(
    0,
  );

  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__inboxSource.dispatchEvent(
      new globalThis.MessageEvent('inbox.conversation.changed', {
        data: JSON.stringify({ conversationId: 'conversation-1' }),
      }),
    );
  });
  await expect(page.getByRole('button', { name: /Studio Malu/ })).toContainText(
    'Mensagem nova de teste',
  );
  await expect(search).toBeFocused();
});

test('filters the Inbox on one segmented axis with totals, combined with the queue', async ({
  page,
}) => {
  const inboxQueries = /** @type {Array<Record<string, string>>} */ ([]);
  const countQueries = /** @type {Array<Record<string, string>>} */ ([]);
  await mockCrm(page, {
    onInboxList: (params) =>
      (params.get('limit') === '1' ? countQueries : inboxQueries).push(
        Object.fromEntries(params),
      ),
  });
  await page.goto('/inbox');

  const tabs = page.getByRole('group', { name: 'Estado das conversas' });
  /** @param {string} name */
  const tab = (name) =>
    tabs.getByRole('button', { name: new RegExp(`^${name}`, 'u') });

  // PCX-01: the conversation-state filter is gone, name and options alike.
  await expect(page.getByText('Situação', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Requer atenção' }),
  ).toHaveCount(0);
  // Achado 1: one axis, archived included, each tab with its total.
  await expect(tabs.getByRole('button')).toHaveText([
    /^Todas\s*1$/u,
    /^Aguardando vendedor\s*1$/u,
    /^Com o agente\s*1$/u,
    /^Com vendedor\s*1$/u,
    /^Arquivadas\s*1$/u,
  ]);
  await expect(tab('Todas')).toHaveAttribute('aria-pressed', 'true');
  expect(countQueries.slice(0, 4)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ archived: 'false', pendingHandoff: 'true' }),
      expect.objectContaining({ archived: 'true' }),
    ]),
  );

  // PCX-05: the queue keeps deciding whose conversations are listed, and the
  // totals follow it.
  await page.getByLabel('Fila').selectOption('mine');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ assignedUserId: 'operator-1' });
  await expect
    .poll(() => countQueries.at(-1)?.assignedUserId)
    .toBe('operator-1');

  // PCX-02: the four states, each combined with the queue already chosen.
  await tab('Aguardando vendedor').click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ assignedUserId: 'operator-1', pendingHandoff: 'true' });
  expect(inboxQueries.at(-1)?.automationState).toBeUndefined();
  await expect(tab('Aguardando vendedor')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await tab('Com o agente').click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      assignedUserId: 'operator-1',
      automationState: 'assistant',
      pendingHandoff: 'false',
    });

  await page.getByLabel('Fila').selectOption('unassignedHumanHandoff');
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      automationState: 'assistant',
      pendingHandoff: 'false',
      unassignedHumanHandoff: 'true',
    });
  expect(inboxQueries.at(-1)?.assignedUserId).toBeUndefined();

  await tab('Com vendedor').click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({
      automationState: 'human',
      pendingHandoff: 'false',
      unassignedHumanHandoff: 'true',
    });

  // PCX-05: archived conversations are the last tab of the same axis.
  await tab('Arquivadas').click();
  await expect
    .poll(() => inboxQueries.at(-1))
    .toMatchObject({ archived: 'true', unassignedHumanHandoff: 'true' });
  expect(inboxQueries.at(-1)?.automationState).toBeUndefined();
  expect(inboxQueries.at(-1)?.pendingHandoff).toBeUndefined();

  await tab('Todas').click();
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

  await page
    .getByRole('group', { name: 'Estado das conversas' })
    .getByRole('button', { name: /^Aguardando vendedor/u })
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
  await expect(drawer).toContainText('Falta valor final e forma de pagamento');
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

test('checks a new customer phone privately and requires choosing an existing candidate', async ({
  page,
}) => {
  await mockCrm(page);
  /** @type {any[]} */
  const searched = [];
  let createdContacts = 0;
  await page.route('**/api/v1/contacts/search', async (route) => {
    const request = route.request();
    searched.push(request.postDataJSON());
    expect(request.method()).toBe('POST');
    expect(request.url()).not.toContain('98765');
    expect(request.headers()['x-csrf-token']).toBe('csrf-test');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            ...contact,
            id: 'site-contact',
            identities: [
              {
                channel: 'site_chat',
                externalId: '999123456789012',
                id: 'site-identity',
                kind: 'handle',
                phoneStatus: 'pending',
              },
            ],
            label: 'Ana do site',
            phone: '5511987654321',
            phoneSource: 'site_unverified',
          },
          {
            ...contact,
            id: 'whatsapp-contact',
            label: 'Ana WhatsApp',
            phone: '5511987654321',
            phoneSource: 'whatsapp',
          },
        ],
        nextCursor: null,
        totalCount: 2,
      }),
    });
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/v1/contacts' &&
      request.method() === 'POST'
    ) {
      createdContacts += 1;
    }
  });
  await page.goto('/pedidos');
  await page.evaluate(() => {
    globalThis.document.cookie = 'crm_csrf=csrf-test; Path=/; SameSite=Lax';
  });
  await page.getByRole('button', { name: 'Novo pedido' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo pedido' });
  await dialog.getByLabel('Nome', { exact: true }).fill('Ana Nova');
  await dialog
    .getByLabel('Telefone', { exact: true })
    .last()
    .fill('(11) 98765-4321');
  await expect(
    dialog.getByText('Esse telefone já aparece no CRM.'),
  ).toBeVisible();
  await expect(
    dialog.getByText('informado no site · não confirmado'),
  ).toBeVisible();
  await expect(dialog.getByText('999123456789012')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Criar pedido' }).click();
  await expect(
    dialog
      .getByRole('alert')
      .filter({ hasText: 'Escolha um cliente da lista' }),
  ).toBeVisible();
  expect(createdContacts).toBe(0);
  expect(searched.some((search) => search.q === '(11) 98765-4321')).toBe(true);
  await dialog.getByRole('button', { name: /Selecionar Ana do site/ }).click();
  await expect(dialog.getByText('Cliente selecionado:')).toBeVisible();
  const unverifiedPhone = dialog
    .getByRole('status')
    .filter({ hasText: 'Este telefone foi informado no chat' });
  await expect(unverifiedPhone).toBeFocused();
  await expect(
    dialog.getByRole('button', { name: 'Criar pedido' }),
  ).toBeDisabled();
  await expect(
    unverifiedPhone.getByRole('link', { name: 'ficha do contato' }),
  ).toHaveAttribute('href', '/clientes/site-contact');

  await dialog.getByRole('button', { name: 'Trocar cliente' }).click();
  await dialog.getByLabel('Buscar cliente por telefone ou nome').fill('Ana');
  await dialog.getByRole('button', { name: /Selecionar Ana WhatsApp/ }).click();
  await expect(
    dialog.getByRole('button', { name: 'Criar pedido' }),
  ).toBeEnabled();
});

test('opens a client by clicking the whole row while keeping its keyboard link', async ({
  page,
}) => {
  await mockCrm(page);
  await page.goto('/clientes');
  await page
    .getByRole('row', { name: /Studio Malu/ })
    .getByRole('cell', { name: /Canônico/ })
    .click();
  await expect(page).toHaveURL('/clientes/contact-1');
  await page.getByRole('link', { name: 'Studio Malu' }).focus();
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeFocused();
});

test('keeps a long client list inside its own scrollable table', async ({
  page,
}) => {
  await mockCrm(page, { manyContacts: true });
  await page.goto('/clientes/contact-1');
  const table = page.getByRole('region', {
    name: /Clientes; role horizontalmente/u,
  });
  await expect(table.getByRole('row')).toHaveCount(61);
  await expect(
    page.getByRole('heading', { name: 'Studio Malu' }),
  ).toBeVisible();
  const tableMetrics = () =>
    table.evaluate((element) => {
      const root = globalThis.document.documentElement;
      // Scrolled to the bottom of the page, where the top bar overlaps most.
      globalThis.scrollTo(0, root.scrollHeight);
      const panel = element.closest('.list-panel');
      return {
        clientHeight: element.clientHeight,
        headingTop: element.querySelector('th')?.getBoundingClientRect().top,
        pageHeight: root.scrollHeight,
        panelBottom: panel?.getBoundingClientRect().bottom,
        panelTop: panel?.getBoundingClientRect().top,
        scrollHeight: element.scrollHeight,
        tableTop: element.getBoundingClientRect().top,
        topbarBottom: globalThis.document
          .querySelector('.app-topbar')
          ?.getBoundingClientRect().bottom,
        viewportHeight: globalThis.innerHeight,
      };
    });

  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await tableMetrics();
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.clientHeight).toBeLessThan(metrics.viewportHeight);
    // The page no longer grows with the list it holds.
    expect(metrics.pageHeight).toBeLessThan(metrics.scrollHeight);
    if (viewport.width >= 1200) {
      // Beside the contact card, the list stays whole below the top bar.
      expect(metrics.panelTop).toBeGreaterThanOrEqual(
        Number(metrics.topbarBottom),
      );
      expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.viewportHeight);
    }
  }

  // The column headings stay on top while the rows scroll under them.
  await table.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const pinned = await tableMetrics();
  expect(Math.abs(Number(pinned.headingTop) - pinned.tableTop)).toBeLessThan(2);

  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await table.evaluate((element) => {
    element.scrollTop = 0;
  });
  const lastClient = page.getByRole('link', { name: 'Cliente de teste 60' });
  await lastClient.focus();
  await expect(lastClient).toBeInViewport();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('recovers the client list after an initial server failure without showing an empty list', async ({
  page,
}) => {
  await mockCrm(page);
  let reads = 0;
  await page.route(/\/api\/v1\/contacts\?/u, async (route) => {
    reads += 1;
    if (reads > 1) return route.fallback();
    return route.fulfill({
      body: JSON.stringify({ code: 'UNAVAILABLE' }),
      contentType: 'application/problem+json',
      status: 503,
    });
  });
  await page.goto('/clientes');

  await expect(
    page.getByRole('heading', { name: 'Clientes indisponíveis' }),
  ).toBeVisible();
  await expect(page.getByText('Nenhum contato encontrado')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Clientes', exact: true }),
  ).toBeFocused();
});

test('keeps loaded clients visible when a live refresh fails', async ({
  page,
}) => {
  await mockCrm(page);
  let reads = 0;
  await page.route(/\/api\/v1\/contacts\?/u, async (route) => {
    reads += 1;
    if (reads !== 2) return route.fallback();
    return route.fulfill({
      body: JSON.stringify({ code: 'UNAVAILABLE' }),
      contentType: 'application/problem+json',
      status: 503,
    });
  });
  /** @type {() => void} */
  let sendEvent = () => {};
  const eventGate = new Promise((resolve) => {
    sendEvent = () => resolve(null);
  });
  await page.route(/\/api\/v1\/events\?/u, async (route) => {
    await eventGate;
    return route.fulfill({
      body: eventStreamBody({
        contactId: 'contact-1',
        type: 'inbox.contact.changed',
      }),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.goto('/clientes');
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();

  sendEvent();
  await expect(page.getByRole('alert')).toContainText(
    'Os dados exibidos podem estar desatualizados.',
  );
  await expect(page.getByRole('link', { name: 'Studio Malu' })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(3);
});

test('lets a keyboard user scroll the client table on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCrm(page);
  await page.goto('/clientes');

  const tableRegion = page.getByRole('region', {
    name: /Clientes; role horizontalmente/u,
  });
  await expect(tableRegion).toBeVisible();
  await expect(
    page.getByText('Deslize a tabela para ver todas as colunas.'),
  ).toBeVisible();
  expect(
    await tableRegion.evaluate((element) => element.scrollWidth),
  ).toBeGreaterThan(
    await tableRegion.evaluate((element) => element.clientWidth),
  );
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  await tableRegion.press('ArrowRight');
  await expect
    .poll(() => tableRegion.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
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

test('opens a conversation by its address and keeps the Inbox while moving between them', async ({
  page,
}) => {
  await mockCrm(page, { waitingQueue: true });
  await page.goto('/inbox/conversation-3');

  await expect(
    page.getByRole('heading', { name: 'Caixa de Entrada', level: 1 }),
  ).toBeFocused();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Igreja Nova Aliança' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Igreja Nova Aliança/u }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Caixa de Entrada' }),
  ).toHaveAttribute('aria-current', 'page');

  // The opened conversation stays while the search narrows the list.
  const search = page.locator('#inbox-search');
  await search.fill('Studio');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Igreja Nova Aliança' }),
  ).toBeVisible();

  // Picking another one changes the address, not the Inbox around it.
  const studio = page.getByRole('button', { name: /Studio Malu/u });
  await studio.click();
  await expect(page).toHaveURL('/inbox/conversation-1');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Studio Malu' }),
  ).toBeVisible();
  await expect(search).toHaveValue('Studio');
  await expect(studio).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL('/inbox/conversation-3');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Igreja Nova Aliança' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('opens the conversation straight from the Dashboard and from Clientes', async ({
  page,
}) => {
  await mockCrm(page);
  await page.goto('/dashboard');
  const recent = page
    .locator('.pend-list')
    .getByRole('link', { name: 'Studio Malu' });
  await expect(recent).toHaveAttribute('href', '/inbox/conversation-1');
  await recent.click();
  await expect(page).toHaveURL('/inbox/conversation-1');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Studio Malu' }),
  ).toBeVisible();

  await page.goto('/clientes/contact-1');
  await expect(
    page.locator('.history-list').getByRole('link', { name: 'WhatsApp' }),
  ).toHaveAttribute('href', '/inbox/conversation-1');
});

test('on a phone the address decides between the list and the conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCrm(page, { waitingQueue: true });
  await page.goto('/inbox');

  await expect(page.locator('.inbox-list')).toBeVisible();
  await expect(page.locator('.inbox-conversation')).toBeHidden();
  await page.getByRole('button', { name: /Studio Malu/u }).click();
  await expect(page).toHaveURL('/inbox/conversation-1');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Studio Malu' }),
  ).toBeFocused();
  await expect(page.locator('.inbox-list')).toBeHidden();
  await expect(page.getByLabel('Responder')).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Mobile first (ADR 035): the reply sits above the bottom navigation bar.
  const composer = await page.locator('.inbox-composer').boundingBox();
  const bar = await page.locator('.mobile-nav').boundingBox();
  if (!composer || !bar) throw new Error('Composer and bar must be visible');
  expect(composer.y + composer.height).toBeLessThanOrEqual(bar.y + 1);

  // Secondary actions live in the "Mais" bottom sheet, with 44 px targets.
  const more = page.getByRole('button', { name: 'Mais ações' });
  expect((await more.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await more.click();
  const sheet = page.locator('#conv-more-menu');
  await expect(sheet.getByRole('button')).toHaveText([
    'Detalhes da conversa',
    'Arquivar conversa',
    'Encerrar conversa',
  ]);
  await expect(
    sheet.getByRole('button', { name: 'Detalhes da conversa' }),
  ).toBeFocused();
  for (const box of await sheet
    .getByRole('button')
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    )) {
    expect(box).toBeGreaterThanOrEqual(44);
  }
  const sheetBox = await sheet.boundingBox();
  if (!sheetBox) throw new Error('The sheet must be visible');
  expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(bar.y + 1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();

  await page.getByRole('link', { name: 'Conversas', exact: true }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(
    page.getByRole('button', { name: /Studio Malu/u }),
  ).toBeFocused();
});

test('on a phone the reply goes right above the keyboard while typing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCrm(page);
  await page.goto('/inbox/conversation-1');
  const bar = page.locator('.mobile-nav');
  await expect(bar).toBeVisible();
  await page.getByLabel('Responder').focus();
  // The navigation bar steps aside; the composer takes the bottom edge.
  await expect(bar).toBeHidden();
  const composer = await page.locator('.inbox-composer').boundingBox();
  if (!composer) throw new Error('The composer must be visible');
  expect(composer.y + composer.height).toBeGreaterThan(844 - 8);
  await page.getByLabel('Responder').blur();
  await expect(bar).toBeVisible();
});

test('sends the reply with Enter and breaks the line with Shift+Enter', async ({
  page,
}) => {
  /** @type {any[]} */
  const sent = [];
  await mockCrm(page, { onMessage: (body) => sent.push(body) });
  await page.goto('/inbox/conversation-1');
  await page.evaluate(() => {
    globalThis.document.cookie = 'crm_csrf=csrf-test; Path=/; SameSite=Lax';
  });
  await expect(page.locator('#reply-help')).toHaveText(
    'Enter envia · Shift+Enter quebra a linha.',
  );

  const reply = page.getByLabel('Responder');
  await reply.click();
  await page.keyboard.press('Enter');
  expect(sent).toEqual([]);
  await reply.pressSequentially('Primeira linha');
  await page.keyboard.press('Shift+Enter');
  await reply.pressSequentially('Segunda linha');
  await expect(reply).toHaveValue('Primeira linha\nSegunda linha');
  expect(sent).toEqual([]);

  await page.keyboard.press('Enter');
  await expect(page.getByText('Mensagem aceita para envio.')).toBeVisible();
  expect(sent).toEqual([
    {
      content: { text: 'Primeira linha\nSegunda linha' },
      expectedVersion: 3,
      messageType: 'text',
      reason: 'Resposta humana na Caixa de Entrada',
    },
  ]);
  await expect(reply).toHaveValue('');
  await expect(reply).toBeFocused();
});

test('keeps the reply in view and opens the history on the latest message at 1366×768', async ({
  page,
}) => {
  await mockCrm(page, { longThread: true });
  // 768 is the screen; 657 is what a browser with its bars leaves of it.
  for (const height of [768, 657]) {
    await page.setViewportSize({ width: 1366, height });
    await page.goto('/inbox/conversation-1');
    const thread = page.locator('.thread');
    await expect(thread.getByText('Mensagem de teste 30:')).toBeInViewport();
    await expect(thread.getByText('Mensagem de teste 1:')).not.toBeInViewport();
    await expect(page.getByLabel('Responder')).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole('button', { name: 'Enviar resposta' }),
    ).toBeInViewport({ ratio: 1 });
    // On a 1366 notebook the conversation comes first: context on demand.
    await expect(
      page.getByRole('complementary', { name: 'Detalhes' }),
    ).toBeHidden();
    // The workspace fits the screen: the page itself never scrolls.
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollHeight <=
          globalThis.innerHeight,
      ),
    ).toBe(true);
  }
});

test('collapses the context panel and remembers it on this browser', async ({
  page,
}) => {
  await mockCrm(page);
  // Wide enough to sit beside the conversation, the panel starts open.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/inbox/conversation-1');
  const context = page.getByRole('complementary', { name: 'Detalhes' });
  const toggle = page
    .locator('.conv-actions')
    .getByRole('button', { name: 'Detalhes' });
  await expect(context).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await context.getByRole('button', { name: 'Recolher detalhes' }).click();
  await expect(context).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Studio Malu' }),
  ).toBeVisible();
  await expect(context).toBeHidden();
  await toggle.click();
  await expect(context).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('formats the phone in the active conversation identity', async ({
  page,
}) => {
  await mockCrm(page, { assistant: true });

  await page.goto('/inbox');

  await expect(page.locator('.conv-identity')).toContainText(
    '+55 (11) 99999-9999 · Com o agente',
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
