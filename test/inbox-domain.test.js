import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INBOX_STATES,
  InMemoryInboxRepository,
  InboxConflictError,
  InboxForbiddenError,
  InboxValidationError,
  createInboxService,
} from '../modules/inbox-channels/src/index.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const ATTENDANT = Object.freeze({
  functionName: 'Vendedor',
  id: 'user-attendant-1',
  kind: 'human',
});

function createHarness() {
  /** @type {any[]} */
  const audits = [];
  let sequence = 0;
  const repository = new InMemoryInboxRepository();
  const service = createInboxService({
    auditPort: {
      append: async (/** @type {any} */ event) =>
        audits.push(structuredClone(event)),
    },
    clock: () => NOW,
    idFactory: (/** @type {string} */ kind) => `${kind}-${++sequence}`,
    repository,
  });
  return { audits, repository, service };
}

function inbound(overrides = {}) {
  return {
    contactId: 'contact-1',
    correlationId: 'correlation-inbound-1',
    externalConversationId: 'external-conversation-1',
    externalMessageId: 'external-message-1',
    identityId: 'identity-1',
    message: { content: { ciphertext: 'sealed-message-1' }, type: 'text' },
    occurredAt: NOW.toISOString(),
    provider: 'meta',
    providerAccountId: 'account-a',
    ...overrides,
  };
}

test('defines the approved backlog states and receives inbound without creating commercial state', async () => {
  assert.deepEqual(
    [...INBOX_STATES],
    [
      'nova',
      'em_analise',
      'em_atendimento',
      'requer_atencao',
      'convertida_em_lead',
      'sem_lead',
    ],
  );
  const { service } = createHarness();

  const received = await service.receiveInbound(inbound());
  assert.equal(received.conversation.state, 'nova');
  assert.equal(received.conversation.cycleNumber, 1);
  assert.equal(received.message.conversationId, received.conversation.id);
  assert.equal('dealId' in received, false);
  assert.equal('leadId' in received, false);
  assert.equal('cardId' in received, false);
  assert.equal(received.message.content.text, undefined);
});

test('replays a provider-scoped message once and isolates equal ids across provider accounts', async () => {
  const { service } = createHarness();
  const first = await service.receiveInbound(inbound());
  const replay = await service.receiveInbound(inbound());
  const isolated = await service.receiveInbound(
    inbound({
      contactId: 'contact-2',
      correlationId: 'correlation-account-b',
      identityId: 'identity-2',
      providerAccountId: 'account-b',
    }),
  );

  assert.deepEqual(replay, first);
  assert.notEqual(isolated.conversation.id, first.conversation.id);
  assert.notEqual(isolated.message.id, first.message.id);
});

test('updates the active conversation exactly once for each new inbound message', async () => {
  const { service } = createHarness();
  const first = await service.receiveInbound(inbound());
  const secondInput = inbound({
    correlationId: 'correlation-message-2',
    externalMessageId: 'external-message-2',
    occurredAt: '2026-09-02T12:01:00.000Z',
  });

  const second = await service.receiveInbound(secondInput);
  const replay = await service.receiveInbound(secondInput);

  assert.equal(second.conversation.id, first.conversation.id);
  assert.equal(second.conversation.version, first.conversation.version + 1);
  assert.equal(second.conversation.updatedAt, secondInput.occurredAt);
  assert.deepEqual(replay, second);
});

test('creates exactly one new cycle after terminal state and preserves the old cycle', async () => {
  const { service } = createHarness();
  const first = await service.receiveInbound(inbound());
  const terminal = await service.transitionConversation({
    actor: ATTENDANT,
    conversationId: first.conversation.id,
    correlationId: 'correlation-terminal',
    expectedVersion: first.conversation.version,
    idempotencyKey: 'terminal-key',
    reason: 'Sem oportunidade comercial',
    state: 'sem_lead',
  });
  assert.equal(terminal.state, 'sem_lead');
  assert.equal(terminal.terminalAt, NOW.toISOString());

  const [second, third] = await Promise.all([
    service.receiveInbound(
      inbound({
        correlationId: 'correlation-message-2',
        externalMessageId: 'external-message-2',
      }),
    ),
    service.receiveInbound(
      inbound({
        correlationId: 'correlation-message-3',
        externalMessageId: 'external-message-3',
      }),
    ),
  ]);
  assert.equal(second.conversation.id, third.conversation.id);
  assert.notEqual(second.conversation.id, first.conversation.id);
  assert.equal(second.conversation.cycleNumber, 2);
  assert.equal(second.conversation.state, 'nova');
  assert.equal(terminal.state, 'sem_lead');
});

test('makes takeover, human send and explicit reactivation atomic and idempotent', async () => {
  const { audits, service } = createHarness();
  const received = await service.receiveInbound(inbound());
  const takeoverCommand = {
    actor: ATTENDANT,
    conversationId: received.conversation.id,
    correlationId: 'correlation-takeover',
    expectedVersion: received.conversation.version,
    idempotencyKey: 'takeover-key',
    reason: 'Cliente pediu atendimento humano',
  };
  const [takeover, replay] = await Promise.all([
    service.takeover(takeoverCommand),
    service.takeover(takeoverCommand),
  ]);
  assert.deepEqual(replay, takeover);
  assert.equal(takeover.automationState, 'human');
  assert.equal(takeover.automationEpoch, 1);

  const sent = await service.sendHumanMessage({
    actor: ATTENDANT,
    content: { ciphertext: 'sealed-human-message' },
    conversationId: takeover.id,
    correlationId: 'correlation-send',
    expectedVersion: takeover.version,
    idempotencyKey: 'send-key',
    messageType: 'text',
    reason: 'Resposta operacional',
  });
  assert.equal(sent.direction, 'outbound');
  assert.equal(sent.authorId, ATTENDANT.id);

  const reactivated = await service.reactivateAgent({
    actor: ATTENDANT,
    conversationId: takeover.id,
    correlationId: 'correlation-reactivate',
    expectedVersion: sent.conversationVersion,
    idempotencyKey: 'reactivate-key',
    reason: 'Retomar assistência explicitamente',
  });
  assert.equal(reactivated.automationState, 'assistant');
  assert.equal(reactivated.automationEpoch, 2);
  assert.equal(
    audits.filter(({ action }) => action === 'conversation.takeover').length,
    1,
  );
});

test('rejects assistant mutations and stale expectedVersion without side effects', async () => {
  const { audits, service } = createHarness();
  const received = await service.receiveInbound(inbound());
  const base = {
    actor: {
      functionName: 'Vendedor',
      id: 'assistant-1',
      kind: 'assistant',
    },
    conversationId: received.conversation.id,
    correlationId: 'correlation-forbidden',
    expectedVersion: received.conversation.version,
    idempotencyKey: 'forbidden-key',
    reason: 'Tentativa sintética',
  };
  for (const actor of [
    base.actor,
    { functionName: 'Admin', id: 'user-admin-1', kind: 'human' },
  ]) {
    await assert.rejects(
      service.takeover({ ...base, actor }),
      InboxForbiddenError,
    );
  }
  await assert.rejects(
    service.transitionConversation({
      ...base,
      actor: ATTENDANT,
      expectedVersion: received.conversation.version + 1,
      state: 'em_analise',
    }),
    InboxConflictError,
  );
  assert.equal(audits.length, 0);
});

test('reserves converted state for the transactional lead conversion task', async () => {
  const { audits, service } = createHarness();
  const received = await service.receiveInbound(inbound());

  await assert.rejects(
    service.transitionConversation({
      actor: ATTENDANT,
      conversationId: received.conversation.id,
      correlationId: 'correlation-premature-conversion',
      expectedVersion: received.conversation.version,
      idempotencyKey: 'premature-conversion-key',
      reason: 'Conversão sem Negócio não pode ser parcial',
      state: 'convertida_em_lead',
    }),
    InboxValidationError,
  );
  assert.equal(audits.length, 0);
});

test('stores stage suggestion separately from official conversation state', async () => {
  const { service } = createHarness();
  const received = await service.receiveInbound(inbound());
  const suggestion = await service.recordSuggestion({
    actor: {
      functionName: 'Vendedor',
      id: 'assistant-1',
      kind: 'assistant',
    },
    conversationId: received.conversation.id,
    correlationId: 'correlation-suggestion',
    proposedStage: 'Especificacao',
    question: 'Colocar este lead em Especificação?',
    sourceMessageId: received.message.id,
  });

  assert.equal(suggestion.status, 'pending');
  assert.equal(suggestion.proposedStage, 'Especificacao');
  assert.equal(suggestion.question, 'Colocar este lead em Especificação?');
  assert.equal(suggestion.conversationState, undefined);
  assert.equal(suggestion.officialField, undefined);
  assert.equal(received.conversation.state, 'nova');
});

const OTHER_SELLER = Object.freeze({
  functionName: 'Vendedor',
  id: 'user-attendant-2',
  kind: 'human',
});
const ADMIN = Object.freeze({
  capabilities: ['COMMERCIAL_ADMIN'],
  functionName: 'Vendedor',
  id: 'user-admin-1',
  kind: 'human',
});

/** @param {any} service */
async function conversationOwnedByAttendant(service) {
  const received = await service.receiveInbound(inbound());
  return service.takeover({
    actor: ATTENDANT,
    conversationId: received.conversation.id,
    correlationId: 'correlation-takeover-own',
    expectedVersion: received.conversation.version,
    idempotencyKey: 'takeover-own',
    reason: 'Assumindo o atendimento',
  });
}

test('keeps an assigned conversation off limits to every other seller', async () => {
  const { service } = createHarness();
  const owned = await conversationOwnedByAttendant(service);
  assert.equal(owned.assignedUserId, ATTENDANT.id);

  await assert.rejects(
    service.takeover({
      actor: OTHER_SELLER,
      conversationId: owned.id,
      correlationId: 'correlation-steal',
      expectedVersion: owned.version,
      idempotencyKey: 'steal-takeover',
      reason: 'Tentativa de assumir conversa alheia',
    }),
    InboxForbiddenError,
  );
  await assert.rejects(
    service.sendHumanMessage({
      actor: OTHER_SELLER,
      content: { ciphertext: 'sealed-steal' },
      conversationId: owned.id,
      correlationId: 'correlation-steal-send',
      expectedVersion: owned.version,
      idempotencyKey: 'steal-send',
      messageType: 'text',
      reason: 'Tentativa de responder conversa alheia',
    }),
    InboxForbiddenError,
  );
  await assert.rejects(
    service.reactivateAgent({
      actor: OTHER_SELLER,
      conversationId: owned.id,
      correlationId: 'correlation-steal-reactivate',
      expectedVersion: owned.version,
      idempotencyKey: 'steal-reactivate',
      reason: 'Tentativa de devolver conversa alheia',
    }),
    InboxForbiddenError,
  );
});

test('lets the owner and an administrator hand a conversation to another seller', async () => {
  const { audits, service } = createHarness();
  const owned = await conversationOwnedByAttendant(service);

  const transferred = await service.transferConversation({
    actor: ATTENDANT,
    conversationId: owned.id,
    correlationId: 'correlation-transfer',
    expectedVersion: owned.version,
    idempotencyKey: 'transfer-key',
    reason: 'Repasse de venda',
    targetUserId: OTHER_SELLER.id,
  });
  assert.equal(transferred.assignedUserId, OTHER_SELLER.id);
  assert.equal(
    audits.filter(({ action }) => action === 'conversation.transferred').length,
    1,
  );

  // The previous owner lost the conversation with the transfer.
  await assert.rejects(
    service.reactivateAgent({
      actor: ATTENDANT,
      conversationId: transferred.id,
      correlationId: 'correlation-after-transfer',
      expectedVersion: transferred.version,
      idempotencyKey: 'after-transfer',
      reason: 'Tentativa após repasse',
    }),
    InboxForbiddenError,
  );

  // An administrator overrides ownership and can move it back.
  const returned = await service.transferConversation({
    actor: ADMIN,
    conversationId: transferred.id,
    correlationId: 'correlation-admin-transfer',
    expectedVersion: transferred.version,
    idempotencyKey: 'admin-transfer',
    reason: 'Correção administrativa',
    targetUserId: ATTENDANT.id,
  });
  assert.equal(returned.assignedUserId, ATTENDANT.id);
});

test('rejects a transfer that targets the actor itself', async () => {
  const { service } = createHarness();
  const owned = await conversationOwnedByAttendant(service);
  await assert.rejects(
    service.transferConversation({
      actor: ATTENDANT,
      conversationId: owned.id,
      correlationId: 'correlation-self-transfer',
      expectedVersion: owned.version,
      idempotencyKey: 'self-transfer',
      reason: 'Repasse inválido',
      targetUserId: ATTENDANT.id,
    }),
    InboxValidationError,
  );
});

test('classifies inbox domain failures for the HTTP boundary', async () => {
  // Regression guard: these errors carried no statusCode, so the API answered
  // an ownership refusal with 500 SERVICE_UNAVAILABLE and never surfaced a
  // version conflict as a conflict.
  const { service } = createHarness();
  const owned = await conversationOwnedByAttendant(service);

  const forbidden = await service
    .takeover({
      actor: OTHER_SELLER,
      conversationId: owned.id,
      correlationId: 'correlation-status-forbidden',
      expectedVersion: owned.version,
      idempotencyKey: 'status-forbidden',
      reason: 'Conversa de outro vendedor',
    })
    .catch((/** @type {any} */ error) => error);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.code, 'INBOX_FORBIDDEN');

  const conflict = await service
    .takeover({
      actor: ATTENDANT,
      conversationId: owned.id,
      correlationId: 'correlation-status-conflict',
      expectedVersion: owned.version + 99,
      idempotencyKey: 'status-conflict',
      reason: 'Versao velha',
    })
    .catch((/** @type {any} */ error) => error);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.code, 'INBOX_CONFLICT');

  const invalid = await service
    .transferConversation({
      actor: ATTENDANT,
      conversationId: owned.id,
      correlationId: 'correlation-status-invalid',
      expectedVersion: owned.version,
      idempotencyKey: 'status-invalid',
      reason: 'Repasse para si mesmo',
      targetUserId: ATTENDANT.id,
    })
    .catch((/** @type {any} */ error) => error);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.code, 'INBOX_INVALID');
});
