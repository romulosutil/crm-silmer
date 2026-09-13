import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { confirmOrder } from '../modules/orders/src/domain/order.js';

const NOW = new Date('2026-09-12T15:00:00.000Z');
const OWNER = Object.freeze({
  capabilities: [],
  id: 'seller-1',
  kind: 'human',
});
const OTHER = Object.freeze({
  capabilities: [],
  id: 'seller-2',
  kind: 'human',
});

const BRIEFING = Object.freeze({
  artwork_locations: ['frente'],
  artwork_technique: 'sublimação total',
  briefing_status: 'collecting',
  colors: ['azul'],
  customer_name: 'Nome Dito Na Conversa',
  fabrics: ['dry fit'],
  next_required_field: 'sizes',
  order_name: 'Equipe Horizonte',
  product_model: 'tradicional',
  product_type: 'camisa',
  sizes: [
    { quantity: 4, size: 'P' },
    { quantity: 6, size: 'M' },
  ],
});

/** @param {{contexts?: Record<string, any>, owners?: Record<string, string|null>}} [options] */
function setup(options = {}) {
  const repository = new InMemoryOrderRepository();
  const contexts = options.contexts ?? {
    'conversation-1': { briefing: BRIEFING, customerName: 'Cliente Sintetico' },
    'conversation-2': { briefing: null, customerName: null },
  };
  const owners = options.owners ?? {
    'conversation-1': 'seller-1',
    'conversation-2': 'seller-1',
  };
  /** @type {Array<{conversationId: string, actor: any}>} */
  const ownershipChecks = [];
  let sequence = 0;
  const service = createOrderService({
    authorizeOwnership: async ({ actor, conversationId }) => {
      ownershipChecks.push({ actor, conversationId });
      if (owners[conversationId] !== actor.id) {
        const error = Object.assign(new Error('not the owner'), {
          code: 'FORBIDDEN',
          statusCode: 403,
        });
        throw error;
      }
    },
    clock: () => NOW,
    conversations: {
      readOrderContext: async (/** @type {string} */ conversationId) =>
        contexts[conversationId] ?? null,
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    idFactory: () => {
      sequence += 1;
      return `order-${sequence}`;
    },
    repository,
  });
  return { ownershipChecks, repository, service };
}

test('an intent without a pending order creates one pre-filled from the pre-ficha', async () => {
  const { repository, service } = setup();
  const result = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-intent',
  });

  assert.equal(result.created, true);
  const { order } = result;
  assert.equal(order.status, 'pendente');
  assert.equal(order.number, '01-CRM');
  assert.equal(order.fabCode, '01');
  assert.equal(order.createdByKind, 'automation');
  assert.equal(order.createdBy, null);
  assert.equal(order.createdAt, NOW.toISOString());
  assert.equal(order.ficha.summary.cliente, 'Cliente Sintetico');
  assert.equal(order.ficha.summary.nome, 'Equipe Horizonte');
  assert.equal(order.ficha.summary.aplicacao, 'sublimação total');
  assert.deepEqual(order.ficha.items[0].grade, [
    { quantidade: 4, tamanho: 'P' },
    { quantidade: 6, tamanho: 'M' },
  ]);
  assert.deepEqual(order.ficha.serviceData.colors, ['azul']);
  assert.equal(order.totalPieces, 10);
  assert.deepEqual(order.missingFields.slice(0, 3), [
    'finalAmount',
    'paymentCondition',
    'summary.data_entrega_confirmada',
  ]);
  assert.deepEqual(await repository.findById(order.id), order);
});

test('the customer falls back to the pre-ficha name and then to empty', async () => {
  const { service } = setup({
    contexts: {
      a: { briefing: BRIEFING, customerName: null },
      b: { briefing: null, customerName: null },
    },
  });
  const a = await service.ensurePendingFromIntent({
    conversationId: 'a',
    correlationId: 'correlation-a',
  });
  const b = await service.ensurePendingFromIntent({
    conversationId: 'b',
    correlationId: 'correlation-b',
  });
  assert.equal(a.order.ficha.summary.cliente, 'Nome Dito Na Conversa');
  assert.equal(b.order.ficha.summary.cliente, '');
  assert.deepEqual(b.order.ficha.items, []);
  assert.equal(b.order.totalPieces, 0);
  assert.equal(b.order.missingFields[0], 'items');
});

test('a repeated intent returns the existing pending order', async () => {
  const { repository, service } = setup();
  const first = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
  });
  const again = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-2',
  });
  assert.equal(again.created, false);
  assert.deepEqual(again.order, first.order);

  const concurrent = await Promise.all([
    service.ensurePendingFromIntent({
      conversationId: 'conversation-2',
      correlationId: 'correlation-3',
    }),
    service.ensurePendingFromIntent({
      conversationId: 'conversation-2',
      correlationId: 'correlation-4',
    }),
  ]);
  assert.equal(concurrent[0].order.id, concurrent[1].order.id);
  assert.equal(
    (await repository.listByConversation('conversation-2')).length,
    1,
  );
});

test('an intent on a conversation with only confirmed orders creates a new pending one', async () => {
  const { repository, service } = setup();
  const { order } = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
  });
  await repository.saveStatus(
    confirmOrder(order, {
      actorId: 'seller-1',
      amountCents: 1000,
      now: NOW,
      paymentCondition: 'pix',
    }),
    { correlationId: 'correlation-confirm', expectedVersion: order.version },
  );

  const next = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-2',
  });
  assert.equal(next.created, true);
  assert.notEqual(next.order.id, order.id);
  assert.equal(next.order.number, '02-CRM');
});

test('an intent on an unknown conversation is refused', async () => {
  const { service } = setup();
  await assert.rejects(
    service.ensurePendingFromIntent({
      conversationId: 'missing',
      correlationId: 'correlation-x',
    }),
    { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 },
  );
});

test('the owner creates a pending order manually, pre-filled with the pre-ficha', async () => {
  const { ownershipChecks, service } = setup();
  const result = await service.createManual({
    actor: OWNER,
    conversationId: 'conversation-1',
    correlationId: 'correlation-manual',
  });
  assert.equal(result.created, true);
  assert.equal(result.order.createdByKind, 'user');
  assert.equal(result.order.createdBy, 'seller-1');
  assert.equal(result.order.ficha.summary.nome, 'Equipe Horizonte');
  assert.deepEqual(ownershipChecks, [
    { actor: OWNER, conversationId: 'conversation-1' },
  ]);

  const again = await service.createManual({
    actor: OWNER,
    conversationId: 'conversation-1',
    correlationId: 'correlation-manual-2',
  });
  assert.equal(again.created, false);
  assert.equal(again.order.id, result.order.id);
});

test('someone who does not own the conversation cannot create an order', async () => {
  const { repository, service } = setup();
  await assert.rejects(
    service.createManual({
      actor: OTHER,
      conversationId: 'conversation-1',
      correlationId: 'correlation-other',
    }),
    { code: 'FORBIDDEN', statusCode: 403 },
  );
  assert.deepEqual(await repository.listByConversation('conversation-1'), []);
  await assert.rejects(
    service.createManual({
      actor: /** @type {any} */ ({ id: 'n8n', kind: 'automation' }),
      conversationId: 'conversation-1',
      correlationId: 'correlation-automation',
    }),
    { code: 'FORBIDDEN' },
  );
});

test('the agent briefing is projected only while the conversation is with the agent', async () => {
  const { repository, service } = setup();
  const { order } = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
  });
  // The seller filled parts the agent never collects.
  const edited = await repository.saveSection(
    {
      ...order,
      ficha: {
        ...order.ficha,
        items: [
          { ...order.ficha.items[0], cor_frente: 'AZUL MARINHO' },
          {
            cor_costas: 'PRETA',
            cor_frente: 'PRETA',
            cor_manga_direita: 'NAO APLICAVEL',
            cor_manga_esquerda: 'NAO APLICAVEL',
            grade: [{ quantidade: 2, tamanho: 'G' }],
            malhas: ['HELANCA'],
            modelo: 'ESPORTIVO',
            tipo: 'SHORT',
            vies_gola: 'NAO APLICAVEL',
            vies_mangas: 'BRANCO',
          },
        ],
        observations: ['Separar por tamanho'],
        summary: {
          ...order.ficha.summary,
          data_entrega_confirmada: '30/09/2026',
        },
      },
    },
    { correlationId: 'correlation-edit', expectedVersion: 1 },
  );

  const ignored = await service.projectAgentBriefing({
    automationState: 'human',
    briefing: { ...BRIEFING, order_name: 'Nome Ignorado' },
    conversationId: 'conversation-1',
    correlationId: 'correlation-human',
  });
  assert.deepEqual(ignored, { applied: false, order: null, reason: 'human' });
  assert.deepEqual(await repository.findById(order.id), edited);

  const projected = await service.projectAgentBriefing({
    automationState: 'assistant',
    briefing: {
      ...BRIEFING,
      notes: 'Sem gola',
      order_name: 'Equipe Horizonte 2026',
      sizes: [{ quantity: 12, size: 'GG' }],
    },
    conversationId: 'conversation-1',
    correlationId: 'correlation-assistant',
  });
  assert.equal(projected.applied, true);
  const result = /** @type {any} */ (projected.order);
  assert.equal(result.version, edited.version + 1);
  assert.equal(result.ficha.summary.nome, 'Equipe Horizonte 2026');
  assert.equal(result.ficha.summary.data_entrega_confirmada, '30/09/2026');
  assert.equal(result.ficha.summary.cliente, 'Cliente Sintetico');
  assert.deepEqual(result.ficha.items[0].grade, [
    { quantidade: 12, tamanho: 'GG' },
  ]);
  assert.equal(result.ficha.items[0].cor_frente, 'AZUL MARINHO');
  assert.equal(result.ficha.items[1].tipo, 'SHORT');
  assert.deepEqual(result.ficha.observations, ['Separar por tamanho']);
  assert.equal(result.ficha.serviceData.notes, 'Sem gola');
  assert.equal(result.totalPieces, 14);
  assert.equal(result.status, 'pendente');
});

test('the projection needs a pending order and never touches a confirmed one', async () => {
  const { repository, service } = setup();
  assert.deepEqual(
    await service.projectAgentBriefing({
      automationState: 'assistant',
      briefing: BRIEFING,
      conversationId: 'conversation-1',
      correlationId: 'correlation-none',
    }),
    { applied: false, order: null, reason: 'no_pending_order' },
  );

  const { order } = await service.ensurePendingFromIntent({
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
  });
  const confirmed = await repository.saveStatus(
    confirmOrder(order, {
      actorId: 'seller-1',
      amountCents: 1000,
      now: NOW,
      paymentCondition: 'pix',
    }),
    { correlationId: 'correlation-confirm', expectedVersion: 1 },
  );
  const result = await service.projectAgentBriefing({
    automationState: 'assistant',
    briefing: { ...BRIEFING, order_name: 'Depois' },
    conversationId: 'conversation-1',
    correlationId: 'correlation-after',
  });
  assert.equal(result.applied, false);
  assert.deepEqual(await repository.findById(order.id), confirmed);
});
