import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  DEAL_STAGES,
  DealConflictError,
  DealForbiddenError,
  DealValidationError,
  InMemoryDealRepository,
  createDealCommandService,
  createDealLossReasonCipher,
} from '../modules/deals-pipeline/src/index.js';
import {
  InMemoryDomainEventStore,
  InMemoryIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const NOW = new Date('2026-09-07T16:00:00.000Z');
const HUMAN = Object.freeze({
  functionName: 'Atendimento',
  id: 'user-attendant-1',
  kind: 'human',
});
const AUTOMATION = Object.freeze({
  id: 'AUTOMATION_EXECUTOR',
  kind: 'AUTOMATION_EXECUTOR',
});

function transition(overrides = {}) {
  return {
    actor: HUMAN,
    correlationId: 'correlation-transition-1',
    dealId: 'deal-1',
    direction: 'advance',
    expectedVersion: 1,
    idempotencyKey: 'transition-1',
    reason: 'Gate validado',
    ...overrides,
  };
}

/** @param {{blockers?: string[], stage?: string, staleEpoch?: boolean}} [options] */
function harness({
  blockers = [],
  stage = 'produto',
  staleEpoch = false,
} = {}) {
  const auditPort = new InMemoryAuditTrail({
    clock: () => NOW,
    idFactory: () => 'audit-transition-1',
  });
  const dealRepository = new InMemoryDealRepository({
    deals: [
      {
        contactId: 'contact-1',
        createdAt: '2026-09-07T15:00:00.000Z',
        id: 'deal-1',
        sourceConversationId: 'conversation-1',
        stage,
        status: 'active',
        updatedAt: '2026-09-07T15:00:00.000Z',
        version: 1,
      },
    ],
  });
  const eventPort = new InMemoryDomainEventStore({
    clock: () => NOW,
    idFactory: () => 'event-transition-1',
  });
  const lossReasonCipher = createDealLossReasonCipher({
    key: Buffer.alloc(32, 71),
  });
  const service = createDealCommandService({
    automationFencePort: {
      /** @param {any} input */
      async assertCurrent(input) {
        if (staleEpoch || input.conversationId !== 'conversation-active-1') {
          throw new DealConflictError('Automation fence is stale');
        }
      },
    },
    auditPort,
    clock: () => NOW,
    dealRepository,
    eventPort,
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    lossReasonCipher,
    qualificationPort: {
      async evaluateGate() {
        return { blockers };
      },
    },
  });
  return { auditPort, dealRepository, eventPort, lossReasonCipher, service };
}

test('defines the canonical ordered Deal stages', () => {
  assert.deepEqual(DEAL_STAGES, [
    'produto',
    'especificacao',
    'estampa',
    'logistica',
    'fechamento',
  ]);
});

test('advances exactly one stage with an immutable gate, history and event', async () => {
  const { dealRepository, eventPort, service } = harness();

  const result = await service.transitionDeal(transition());

  assert.equal(result.deal.stage, 'especificacao');
  assert.equal(result.deal.version, 2);
  assert.deepEqual(result.gate, {
    blockers: [],
    dealId: 'deal-1',
    evaluatedAt: NOW.toISOString(),
    fromStage: 'produto',
    version: 1,
  });
  assert.deepEqual(
    dealRepository
      .listHistory('deal-1')
      .map(({ kind, fromStage, toStage }) => ({
        fromStage,
        kind,
        toStage,
      })),
    [{ fromStage: 'produto', kind: 'advanced', toStage: 'especificacao' }],
  );
  assert.equal(dealRepository.listGates('deal-1').length, 1);
  assert.deepEqual(eventPort.list()[0].payload, {
    direction: 'advance',
    fromStage: 'produto',
    toStage: 'especificacao',
    version: 2,
  });
});

test('blocks incomplete gates and invalid stage boundaries without mutation', async () => {
  const incomplete = harness({ blockers: ['produto.modelo'] });
  await assert.rejects(
    incomplete.service.transitionDeal(transition()),
    (error) =>
      error instanceof DealConflictError &&
      error.code === 'DEAL_GATE_INCOMPLETE' &&
      !String(error.message).includes('produto.modelo'),
  );
  assert.equal(incomplete.dealRepository.get('deal-1')?.version, 1);
  assert.equal(incomplete.dealRepository.listGates('deal-1').length, 0);

  const first = harness();
  await assert.rejects(
    first.service.transitionDeal(transition({ direction: 'retreat' })),
    DealConflictError,
  );
  const last = harness({ stage: 'fechamento' });
  await assert.rejects(
    last.service.transitionDeal(transition()),
    DealConflictError,
  );
  await assert.rejects(
    first.service.transitionDeal(transition({ direction: 'fechamento' })),
    DealValidationError,
  );
});

test('retreats one stage without rewriting the prior gate', async () => {
  const { dealRepository, service } = harness({ stage: 'especificacao' });
  const result = await service.transitionDeal(
    transition({ direction: 'retreat', reason: 'Correção necessária' }),
  );
  assert.equal(result.deal.stage, 'produto');
  assert.equal(result.gate, null);
  assert.equal(dealRepository.listGates('deal-1').length, 0);
  assert.equal(dealRepository.listHistory('deal-1')[0].kind, 'retreated');
});

test('serializes concurrent transitions and replays one idempotent result', async () => {
  const { dealRepository, eventPort, service } = harness();
  const results = await Promise.allSettled([
    service.transitionDeal(transition({ idempotencyKey: 'concurrent-a' })),
    service.transitionDeal(transition({ idempotencyKey: 'concurrent-b' })),
  ]);
  assert.equal(
    results.filter(({ status }) => status === 'fulfilled').length,
    1,
  );
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(dealRepository.get('deal-1')?.stage, 'especificacao');
  assert.equal(dealRepository.listHistory('deal-1').length, 1);
  assert.equal(eventPort.list().length, 1);

  const replayHarness = harness();
  const original = await replayHarness.service.transitionDeal(transition());
  const replay = await replayHarness.service.transitionDeal(transition());
  assert.deepEqual(replay, original);
  assert.equal(replayHarness.dealRepository.listHistory('deal-1').length, 1);
  assert.equal(replayHarness.eventPort.list().length, 1);
});

test('enforces actor rules and automation epoch for transitions', async () => {
  const { service } = harness();
  await assert.rejects(
    service.transitionDeal(
      transition({
        actor: AUTOMATION,
        automationEpoch: undefined,
        conversationId: 'conversation-active-1',
      }),
    ),
    DealValidationError,
  );
  const automated = await service.transitionDeal(
    transition({
      actor: AUTOMATION,
      automationEpoch: 0,
      conversationId: 'conversation-active-1',
      idempotencyKey: 'automation-transition',
    }),
  );
  assert.equal(automated.deal.stage, 'especificacao');

  const retreat = harness({ stage: 'especificacao' });
  await assert.rejects(
    retreat.service.transitionDeal(
      transition({
        actor: AUTOMATION,
        automationEpoch: 0,
        conversationId: 'conversation-active-1',
        direction: 'retreat',
      }),
    ),
    DealForbiddenError,
  );

  const stale = harness({ staleEpoch: true });
  await assert.rejects(
    stale.service.transitionDeal(
      transition({
        actor: AUTOMATION,
        automationEpoch: 0,
        conversationId: 'conversation-active-1',
        idempotencyKey: 'stale-epoch',
      }),
    ),
    DealConflictError,
  );
  assert.equal(stale.dealRepository.get('deal-1')?.version, 1);
});

test('loses only by a human, encrypts the reason and omits it from event/audit', async () => {
  const { auditPort, dealRepository, eventPort, lossReasonCipher, service } =
    harness();
  const sensitiveReason = 'Cliente desistiu por questão familiar';
  const result = await service.loseDeal({
    actor: HUMAN,
    correlationId: 'correlation-loss-1',
    dealId: 'deal-1',
    expectedVersion: 1,
    idempotencyKey: 'loss-1',
    reason: sensitiveReason,
  });

  assert.equal(result.deal.status, 'lost');
  assert.equal(result.deal.version, 2);
  const stored = dealRepository.getStored('deal-1');
  assert.notEqual(JSON.stringify(stored?.lossReasonEnvelope), sensitiveReason);
  assert.equal(
    lossReasonCipher.decrypt(stored?.lossReasonEnvelope, 'deal-1'),
    sensitiveReason,
  );
  assert.equal(eventPort.list()[0].type, 'deal.lost');
  assert.doesNotMatch(JSON.stringify(eventPort.list()), /questão familiar/iu);
  assert.doesNotMatch(JSON.stringify(auditPort.list()), /questão familiar/iu);

  const denied = harness();
  await assert.rejects(
    denied.service.loseDeal({
      actor: AUTOMATION,
      correlationId: 'correlation-loss-2',
      dealId: 'deal-1',
      expectedVersion: 1,
      idempotencyKey: 'loss-technical',
      reason: sensitiveReason,
    }),
    DealForbiddenError,
  );
});
