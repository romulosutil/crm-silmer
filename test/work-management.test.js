import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  InMemoryDomainEventStore,
  InMemoryIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';
import {
  InMemoryWorkManagementRepository,
  createHandoffCipher,
  createWorkManagementService,
} from '../modules/work-management/src/index.js';

const NOW = new Date('2026-09-07T18:00:00.000Z');
const SELLER = Object.freeze({
  functionName: 'Vendedor',
  id: 'seller-1',
  kind: 'human',
});
const ATTENDANT = Object.freeze({
  functionName: 'Atendimento',
  id: 'attendant-1',
  kind: 'human',
});
const AUTOMATION = Object.freeze({
  id: 'AUTOMATION_EXECUTOR',
  kind: 'AUTOMATION_EXECUTOR',
});

/** @param {any} [options] */
function harness(options = {}) {
  let auditId = 0;
  let eventId = 0;
  const auditPort = new InMemoryAuditTrail({
    clock: () => NOW,
    idFactory: () => `work-audit-${++auditId}`,
  });
  const eventPort = new InMemoryDomainEventStore({
    clock: () => NOW,
    idFactory: () => `work-event-${++eventId}`,
  });
  const repository = new InMemoryWorkManagementRepository({
    conversations: [
      {
        assignedUserId: null,
        automationEpoch: 2,
        automationState: 'assistant',
        contactId: options.conversationContactId ?? 'contact-1',
        id: 'conversation-1',
        state: 'requer_atencao',
        terminalAt: null,
        version: 3,
      },
    ],
    deals: [
      {
        assignedUserId: null,
        contactId: 'contact-1',
        id: 'deal-1',
        status: 'active',
        version: 1,
      },
    ],
    idFactory: (() => {
      let value = 0;
      return (kind) => `${kind}-${++value}`;
    })(),
    users: [
      { disabledAt: null, functionName: 'Vendedor', id: 'seller-1' },
      { disabledAt: null, functionName: 'Vendedor', id: 'seller-2' },
      { disabledAt: null, functionName: 'Atendimento', id: 'attendant-1' },
      {
        disabledAt: NOW.toISOString(),
        functionName: 'Vendedor',
        id: 'disabled-1',
      },
    ],
  });
  const service = createWorkManagementService({
    auditPort,
    cipher: createHandoffCipher({ key: Buffer.alloc(32, 72) }),
    clock: () => NOW,
    eventPort,
    idempotencyStore: new InMemoryIdempotencyRecordStore(),
    repository,
    slaMinutes: options.slaMinutes ?? 240,
    slaPolicyVersion: 'technical-default-v1',
  });
  return { auditPort, eventPort, repository, service };
}

function createHandoff(overrides = {}) {
  return {
    actor: AUTOMATION,
    assignedUserId: 'seller-1',
    automationContext: {
      executionId: 'execution-1',
      workflowKey: 'seller-workflow',
      workflowVersion: 'v1',
    },
    automationEpoch: 2,
    conversationId: 'conversation-1',
    correlationId: 'correlation-handoff-1',
    dealId: 'deal-1',
    expectedConversationVersion: 3,
    expectedDealVersion: 1,
    idempotencyKey: 'handoff-key-1',
    reasonCode: 'price_before_quote',
    summary: 'Cliente Maria pediu preço antes do orçamento.',
    ...overrides,
  };
}

test('creates exactly one fenced handoff task atomically without leaking summary', async () => {
  const { auditPort, eventPort, repository, service } = harness();
  const input = createHandoff();
  const first = await service.createHandoff(input);
  const replay = await service.createHandoff(input);

  assert.deepEqual(replay, first);
  assert.equal(first.deal.assignedUserId, 'seller-1');
  assert.equal(first.deal.version, 2);
  assert.equal(first.conversation.automationEpoch, 3);
  assert.equal(first.conversation.automationState, 'human');
  assert.equal(first.conversation.state, 'em_atendimento');
  assert.equal(first.handoff.status, 'pending');
  assert.equal(first.task.status, 'pending');
  assert.equal(first.task.dueAt, '2026-09-07T22:00:00.000Z');
  assert.equal(
    repository
      .listTasks()
      .filter((/** @type {any} */ task) => task.handoffId === first.handoff.id)
      .length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(repository.snapshot()), /Cliente Maria/iu);
  assert.doesNotMatch(
    JSON.stringify(await auditPort.list()),
    /Cliente Maria/iu,
  );
  assert.doesNotMatch(JSON.stringify(eventPort.list()), /Cliente Maria/iu);

  await assert.rejects(
    service.createHandoff(createHandoff({ idempotencyKey: 'competing-key' })),
    (/** @type {any} */ error) =>
      error.code === 'WORK_CONFLICT' && error.statusCode === 409,
  );
});

test('rejects stale automation, contact mismatch, disabled assignee and commercial handoff to Atendimento', async () => {
  await assert.rejects(
    harness().service.createHandoff(createHandoff({ automationEpoch: 1 })),
    (/** @type {any} */ error) => error.code === 'WORK_CONFLICT',
  );
  await assert.rejects(
    harness({ conversationContactId: 'contact-2' }).service.createHandoff(
      createHandoff(),
    ),
    (/** @type {any} */ error) => error.code === 'WORK_CONFLICT',
  );
  await assert.rejects(
    harness().service.createHandoff(
      createHandoff({ assignedUserId: 'disabled-1' }),
    ),
    (/** @type {any} */ error) => error.code === 'WORK_INVALID',
  );
  await assert.rejects(
    harness().service.createHandoff(
      createHandoff({ assignedUserId: 'attendant-1' }),
    ),
    (/** @type {any} */ error) => error.code === 'WORK_INVALID',
  );
  await assert.rejects(
    harness().service.assignDeal({
      actor: { ...SELLER, id: 'disabled-1' },
      assignedUserId: 'seller-1',
      correlationId: 'disabled-actor-correlation',
      dealId: 'deal-1',
      expectedDealVersion: 1,
      idempotencyKey: 'disabled-actor-key',
      reasonCode: 'manual_assignment',
    }),
    (/** @type {any} */ error) => error.code === 'WORK_INVALID',
  );
});

test('accepts, transfers and resolves while preserving dueAt and keeping automation disabled', async () => {
  const { repository, service } = harness();
  const created = await service.createHandoff(createHandoff());
  const accepted = await service.acceptHandoff({
    actor: SELLER,
    correlationId: 'accept-correlation',
    expectedConversationVersion: 4,
    expectedDealVersion: 2,
    expectedHandoffVersion: 1,
    expectedTaskVersion: 1,
    handoffId: created.handoff.id,
    idempotencyKey: 'accept-key',
    reasonCode: 'handoff_accepted',
  });
  assert.equal(accepted.handoff.status, 'accepted');
  assert.equal(accepted.task.status, 'in_progress');

  const transferred = await service.transferHandoff({
    actor: SELLER,
    assignedUserId: 'seller-2',
    correlationId: 'transfer-correlation',
    expectedConversationVersion: 4,
    expectedDealVersion: 2,
    expectedHandoffVersion: 2,
    expectedTaskVersion: 2,
    handoffId: created.handoff.id,
    idempotencyKey: 'transfer-key',
    reasonCode: 'manual_transfer',
  });
  assert.equal(transferred.task.dueAt, created.task.dueAt);
  assert.equal(transferred.task.assignedUserId, 'seller-2');
  assert.equal(transferred.conversation.automationEpoch, 3);
  assert.equal(transferred.conversation.automationState, 'human');

  const resolved = await service.resolveHandoff({
    actor: { ...SELLER, id: 'seller-2' },
    correlationId: 'resolve-correlation',
    expectedConversationVersion: 5,
    expectedDealVersion: 3,
    expectedHandoffVersion: 3,
    expectedTaskVersion: 3,
    handoffId: created.handoff.id,
    idempotencyKey: 'resolve-key',
    reasonCode: 'handoff_resolved',
  });
  assert.equal(resolved.handoff.status, 'resolved');
  assert.equal(resolved.task.status, 'completed');
  assert.equal(resolved.conversation.automationState, 'human');
  assert.equal(resolved.conversation.automationEpoch, 3);
  assert.equal(repository.listAssignmentHistory().length, 2);
});

test('assigns Deals and manages follow-up tasks while handoff tasks remain coupled', async () => {
  const { repository, service } = harness();
  const assigned = await service.assignDeal({
    actor: ATTENDANT,
    assignedUserId: 'attendant-1',
    correlationId: 'assign-correlation',
    dealId: 'deal-1',
    expectedDealVersion: 1,
    idempotencyKey: 'assign-key',
    reasonCode: 'manual_assignment',
  });
  assert.equal(assigned.deal.assignedUserId, 'attendant-1');
  assert.equal(repository.listAssignmentHistory().length, 1);

  const created = await service.createTask({
    actor: ATTENDANT,
    assignedUserId: 'attendant-1',
    correlationId: 'task-create-correlation',
    dealId: 'deal-1',
    dueAt: '2026-09-08T18:00:00.000Z',
    expectedDealVersion: 2,
    idempotencyKey: 'task-create-key',
    reasonCode: 'manual_follow_up',
    text: 'Ligar para Maria amanhã.',
    type: 'follow_up',
  });
  const started = await service.startTask({
    actor: ATTENDANT,
    correlationId: 'task-start-correlation',
    expectedTaskVersion: 1,
    idempotencyKey: 'task-start-key',
    reasonCode: 'task_started',
    taskId: created.task.id,
  });
  assert.equal(started.task.status, 'in_progress');
  const completed = await service.completeTask({
    actor: ATTENDANT,
    correlationId: 'task-complete-correlation',
    expectedTaskVersion: 2,
    idempotencyKey: 'task-complete-key',
    reasonCode: 'task_completed',
    taskId: created.task.id,
  });
  assert.equal(completed.task.status, 'completed');
  assert.doesNotMatch(
    JSON.stringify(repository.snapshot()),
    /Ligar para Maria/iu,
  );

  const handoff = await service.createHandoff(
    createHandoff({
      actor: SELLER,
      automationContext: undefined,
      automationEpoch: undefined,
      expectedDealVersion: 3,
      idempotencyKey: 'human-handoff-key',
      reasonCode: 'customer_requested_human',
    }),
  );
  await assert.rejects(
    service.cancelTask({
      actor: SELLER,
      correlationId: 'cancel-correlation',
      expectedTaskVersion: 1,
      idempotencyKey: 'cancel-key',
      reasonCode: 'task_cancelled',
      taskId: handoff.task.id,
    }),
    (/** @type {any} */ error) => error.code === 'WORK_CONFLICT',
  );
});

test('validates the technical SLA range', () => {
  assert.throws(() => harness({ slaMinutes: 4 }), /SLA/iu);
  assert.throws(() => harness({ slaMinutes: 10081 }), /SLA/iu);
});

test('computes exact UTC deadlines at both SLA boundaries without local-time drift', async () => {
  const minimum = await harness({ slaMinutes: 5 }).service.createHandoff(
    createHandoff(),
  );
  const maximum = await harness({ slaMinutes: 10_080 }).service.createHandoff(
    createHandoff(),
  );
  assert.equal(minimum.task.dueAt, '2026-09-07T18:05:00.000Z');
  assert.equal(maximum.task.dueAt, '2026-09-14T18:00:00.000Z');
});
