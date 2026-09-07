import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  DealConflictError,
  DealForbiddenError,
  DealValidationError,
  createDealConversionService,
} from '../modules/deals-pipeline/src/index.js';
import {
  InMemoryDomainEventStore,
  InMemoryIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const NOW = new Date('2026-09-07T15:00:00.000Z');
const HUMAN = Object.freeze({
  functionName: 'Atendimento',
  id: 'user-attendant-1',
  kind: 'human',
});
const AUTOMATION = Object.freeze({
  id: 'AUTOMATION_EXECUTOR',
  kind: 'AUTOMATION_EXECUTOR',
});

function command(overrides = {}) {
  return {
    actor: HUMAN,
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
    expectedVersion: 3,
    idempotencyKey: 'convert-1',
    reason: 'Intenção comercial confirmada',
    ...overrides,
  };
}

function harness() {
  /** @type {any[]} */
  const deals = [];
  const state = {
    automationEpoch: 0,
    automationState: 'assistant',
    contact: { id: 'contact-1', provisional: true, version: 1 },
    conversation: {
      id: 'conversation-1',
      identityId: 'identity-1',
      state: 'em_analise',
      terminalAt: null,
      version: 3,
    },
    deals,
  };
  /** @type {Array<[string, unknown]>} */
  const contexts = [];
  let dealSequence = 0;
  const auditPort = new InMemoryAuditTrail({
    clock: () => NOW,
    idFactory: () => 'audit-1',
  });
  const eventPort = new InMemoryDomainEventStore({
    clock: () => NOW,
    idFactory: () => 'event-1',
  });
  const service = createDealConversionService({
    auditPort,
    clock: () => NOW,
    contactPort: {
      /** @param {any} input @param {any} context */
      async promoteIdentityContact(input, context) {
        contexts.push(['contact', context]);
        assert.equal(input.identityId, state.conversation.identityId);
        if (state.contact.provisional) {
          state.contact.provisional = false;
          state.contact.version += 1;
        }
        return structuredClone(state.contact);
      },
    },
    dealRepository: {
      /** @param {any} input @param {any} context */
      async createFromConversation(input, context) {
        contexts.push(['deal', context]);
        if (
          state.deals.some(
            (deal) => deal.sourceConversationId === input.sourceConversationId,
          )
        ) {
          throw new DealConflictError('Conversation already has a deal');
        }
        const deal = {
          contactId: input.contactId,
          createdAt: input.createdAt,
          id: input.id,
          sourceConversationId: input.sourceConversationId,
          stage: 'produto',
          updatedAt: input.createdAt,
          version: 1,
        };
        state.deals.push(deal);
        return structuredClone(deal);
      },
    },
    eventPort,
    idFactory: () => `deal-${++dealSequence}`,
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    inboxPort: {
      /** @param {any} input @param {any} context */
      async completeConversion(input, context) {
        contexts.push(['inbox-complete', context]);
        assert.equal(input.expectedVersion, state.conversation.version);
        if (
          input.actorKind === 'AUTOMATION_EXECUTOR' &&
          (state.automationState !== 'assistant' ||
            input.automationEpoch !== state.automationEpoch)
        ) {
          throw new DealConflictError('Automation command is fenced');
        }
        state.conversation.state = 'convertida_em_lead';
        state.conversation.terminalAt = input.occurredAt;
        state.conversation.version += 1;
        return structuredClone(state.conversation);
      },
      /** @param {any} input @param {any} context */
      async lockForConversion(input, context) {
        contexts.push(['inbox-lock', context]);
        if (
          input.conversationId !== state.conversation.id ||
          state.conversation.terminalAt !== null ||
          input.expectedVersion !== state.conversation.version ||
          (input.actorKind === 'AUTOMATION_EXECUTOR' &&
            (state.automationState !== 'assistant' ||
              input.automationEpoch !== state.automationEpoch))
        ) {
          throw new DealConflictError('Conversation cannot be converted');
        }
        return structuredClone(state.conversation);
      },
    },
  });
  return { auditPort, contexts, eventPort, service, state };
}

test('converts one conversation into its existing Contact and exactly one Deal', async () => {
  const { auditPort, contexts, eventPort, service, state } = harness();

  const result = await service.convertConversation(command());

  assert.deepEqual(result, {
    contact: { id: 'contact-1', provisional: false, version: 2 },
    conversation: {
      id: 'conversation-1',
      identityId: 'identity-1',
      state: 'convertida_em_lead',
      terminalAt: NOW.toISOString(),
      version: 4,
    },
    deal: {
      contactId: 'contact-1',
      createdAt: NOW.toISOString(),
      id: 'deal-1',
      sourceConversationId: 'conversation-1',
      stage: 'produto',
      updatedAt: NOW.toISOString(),
      version: 1,
    },
  });
  assert.equal(state.deals.length, 1);
  assert.deepEqual(eventPort.list()[0].payload, {
    stage: 'produto',
    version: 1,
  });
  assert.deepEqual(
    contexts.map(([name]) => name),
    ['inbox-lock', 'contact', 'deal', 'inbox-complete'],
  );
  assert.deepEqual(await auditPort.list(), [
    {
      action: 'conversation.convert',
      actor: HUMAN.id,
      correlationId: 'correlation-1',
      id: 'audit-1',
      occurredAt: NOW.toISOString(),
      reason: 'Intenção comercial confirmada',
      target: { id: 'conversation-1', type: 'conversation' },
      version: 3,
    },
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.deal));
});

test('replays identical manual or automated conversion without duplicate effects', async () => {
  for (const actor of [HUMAN, AUTOMATION]) {
    const { auditPort, service, state } = harness();
    const input = command({
      actor,
      ...(actor === AUTOMATION ? { automationEpoch: 0 } : {}),
    });

    const [first, replay] = await Promise.all([
      service.convertConversation(input),
      service.convertConversation(input),
    ]);

    assert.deepEqual(replay, first);
    assert.notEqual(replay, first);
    assert.equal(state.deals.length, 1);
    assert.equal((await auditPort.list()).length, 1);
  }
});

test('rejects stale versions, reused keys, unauthorized actors and incomplete commands', async () => {
  const { service } = harness();
  await assert.rejects(
    service.convertConversation(command({ expectedVersion: 2 })),
    DealConflictError,
  );

  const first = command({ idempotencyKey: 'reused-key' });
  await service.convertConversation(first);
  await assert.rejects(
    service.convertConversation({ ...first, reason: 'Outra intenção' }),
    (error) =>
      /** @type {{code?: unknown}} */ (error)?.code ===
      'IDEMPOTENCY_KEY_REUSED',
  );

  const fresh = harness().service;
  await assert.rejects(
    fresh.convertConversation(
      command({ actor: { id: 'assistant-1', kind: 'assistant' } }),
    ),
    DealForbiddenError,
  );
  await assert.rejects(
    fresh.convertConversation(command({ reason: '' })),
    DealValidationError,
  );
  await assert.rejects(
    fresh.convertConversation(command({ expectedVersion: 0 })),
    DealValidationError,
  );
});

test('fences stale automation after takeover without blocking a current human', async () => {
  const automated = harness();
  await assert.rejects(
    automated.service.convertConversation(command({ actor: AUTOMATION })),
    DealValidationError,
  );

  automated.state.automationEpoch = 2;
  automated.state.automationState = 'human';
  await assert.rejects(
    automated.service.convertConversation(
      command({ actor: AUTOMATION, automationEpoch: 1 }),
    ),
    DealConflictError,
  );
  assert.equal(automated.state.deals.length, 0);

  await assert.rejects(
    automated.service.convertConversation(command({ automationEpoch: 2 })),
    DealValidationError,
  );
  const converted = await automated.service.convertConversation(command());
  assert.equal(converted.deal.stage, 'produto');
});
