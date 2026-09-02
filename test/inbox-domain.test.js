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
  functionName: 'Atendimento',
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
      functionName: 'Atendimento',
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
      functionName: 'Atendimento',
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
