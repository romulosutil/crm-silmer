import { createHash } from 'node:crypto';

import { createIdempotentCommandExecutor } from '@crm-silmer/integration-reliability';

import {
  WorkConflictError,
  WorkForbiddenError,
  WorkValidationError,
} from './errors.js';

const HANDOFF_REASONS = new Set([
  'customer_requested_human',
  'price_before_quote',
  'unresolved_blocker',
  'low_confidence',
]);
const COMMERCIAL_REASONS = new Set(['price_before_quote']);
const TASK_REASONS = new Set([
  'manual_follow_up',
  'task_started',
  'task_completed',
  'task_cancelled',
]);
const HANDOFF_ACTION_REASONS = new Set([
  'handoff_accepted',
  'handoff_claimed',
  'manual_transfer',
  'handoff_resolved',
]);

/** @param {any} dependencies */
export function createWorkManagementService(dependencies) {
  assertDependencies(dependencies);
  const slaMinutes = dependencies.slaMinutes ?? 240;
  if (
    !Number.isSafeInteger(slaMinutes) ||
    slaMinutes < 5 ||
    slaMinutes > 10_080
  ) {
    throw new WorkValidationError('SLA must be between 5 and 10080 minutes');
  }
  requireString(dependencies.slaPolicyVersion, 'slaPolicyVersion');
  const clock = dependencies.clock ?? (() => new Date());
  const execute = createIdempotentCommandExecutor({
    auditTrail: dependencies.auditPort,
    idempotencyStore: dependencies.idempotencyStore,
  });

  /** @param {any} command @param {string} action @param {string} targetType @param {string} targetId @param {any} fingerprint @param {string|number} version @param {(context: any) => Promise<any>} work */
  function run(
    command,
    action,
    targetType,
    targetId,
    fingerprint,
    version,
    work,
  ) {
    return execute(
      {
        action,
        actor: command.actor.id,
        command: compactJson(fingerprint),
        correlationId: command.correlationId,
        key: command.idempotencyKey,
        reason: command.reasonCode,
        target: { id: targetId, type: targetType },
        version,
      },
      async (transaction) => work({ transaction }),
    ).catch((error) => {
      if (
        error?.code === 'DEAL_CONFLICT' ||
        error?.code === 'INBOX_CONFLICT' ||
        error?.code === '23505'
      ) {
        throw new WorkConflictError();
      }
      throw error;
    });
  }

  /** @param {any} event @param {any} context */
  async function appendEvent(event, context) {
    await dependencies.eventPort.append(event, context);
  }

  /** @param {any} input */
  async function assignDeal(input) {
    validateHumanCommon(
      input,
      new Set(['manual_assignment', 'handoff_assignment', 'manual_transfer']),
    );
    requireId(input.assignedUserId, 'assignedUserId');
    requireVersion(input.expectedDealVersion, 'expectedDealVersion');
    return run(
      input,
      'deal.assign',
      'deal',
      input.dealId,
      {
        assignedUserId: input.assignedUserId,
        expectedDealVersion: input.expectedDealVersion,
      },
      `${input.expectedDealVersion}->${input.expectedDealVersion + 1}`,
      async (context) => {
        const result = await dependencies.repository.assignDeal(
          { ...input, occurredAt: clock().toISOString() },
          context,
        );
        await appendEvent(
          dealEvent(input, result.deal, 'deal.assigned', {
            assignedUserId: result.deal.assignedUserId,
            reasonCode: input.reasonCode,
          }),
          context,
        );
        return result;
      },
    );
  }

  /** @param {any} input */
  async function createTask(input) {
    validateHumanCommon(input, new Set(['manual_follow_up']));
    if (input.type !== 'follow_up')
      throw new WorkValidationError(
        'Only follow_up tasks can be created directly',
      );
    requireId(input.assignedUserId, 'assignedUserId');
    requireVersion(input.expectedDealVersion, 'expectedDealVersion');
    const dueAt = requireFutureInstant(input.dueAt, clock(), 'dueAt');
    const text = requireBoundedText(input.text, 'text', 4096);
    return run(
      input,
      'task.create',
      'deal',
      input.dealId,
      {
        assignedUserId: input.assignedUserId,
        dueAt,
        expectedDealVersion: input.expectedDealVersion,
        textDigest: digest(text),
        type: input.type,
      },
      `${input.expectedDealVersion}->${input.expectedDealVersion + 1}`,
      async (context) => {
        const occurredAt = clock().toISOString();
        const result = await dependencies.repository.createTask(
          {
            ...input,
            dueAt,
            occurredAt,
            textEnvelope: dependencies.cipher.encrypt(
              text,
              `${input.dealId}:task:text`,
            ),
          },
          context,
        );
        await appendEvent(
          dealEvent(input, result.deal, 'deal.task.created', {
            taskId: result.task.id,
            taskType: result.task.type,
            taskVersion: result.task.version,
          }),
          context,
        );
        return result;
      },
    );
  }

  /** @param {any} input @param {'start'|'complete'|'cancel'} action */
  async function updateTask(input, action) {
    const reasonByAction = {
      cancel: 'task_cancelled',
      complete: 'task_completed',
      start: 'task_started',
    };
    validateHumanCommon(input, TASK_REASONS);
    if (input.reasonCode !== reasonByAction[action]) {
      throw new WorkValidationError('reasonCode does not match task action');
    }
    requireId(input.taskId, 'taskId');
    requireVersion(input.expectedTaskVersion, 'expectedTaskVersion');
    return run(
      input,
      `task.${action}`,
      'task',
      input.taskId,
      { action, expectedTaskVersion: input.expectedTaskVersion },
      `${input.expectedTaskVersion}->${input.expectedTaskVersion + 1}`,
      async (context) => {
        const result = await dependencies.repository.updateTask(
          { ...input, action, occurredAt: clock().toISOString() },
          context,
        );
        await appendEvent(
          {
            aggregateId: result.task.id,
            aggregateType: 'task',
            aggregateVersion: result.task.version,
            correlationId: input.correlationId,
            occurredAt: clock(),
            payload: {
              dealId: result.task.dealId,
              status: result.task.status,
              version: result.task.version,
            },
            type: {
              cancel: 'task.cancelled',
              complete: 'task.completed',
              start: 'task.started',
            }[action],
          },
          context,
        );
        return result;
      },
    );
  }

  /** @param {any} input */
  async function createHandoff(input) {
    validateHandoffCreate(input);
    const summary = requireBoundedText(input.summary, 'summary', 8192);
    const occurredAt = clock().toISOString();
    const dueAt = new Date(
      clock().getTime() + slaMinutes * 60_000,
    ).toISOString();
    return run(
      input,
      'handoff.create',
      'deal',
      input.dealId,
      {
        assignedUserId: input.assignedUserId,
        automationContext: input.automationContext,
        automationEpoch: input.automationEpoch,
        conversationId: input.conversationId,
        expectedConversationVersion: input.expectedConversationVersion,
        expectedDealVersion: input.expectedDealVersion,
        reasonCode: input.reasonCode,
        summaryDigest: digest(summary),
      },
      `${input.expectedDealVersion}->${input.expectedDealVersion + 1}`,
      async (context) => {
        const result = await dependencies.repository.createHandoff(
          {
            ...input,
            commercialReason: COMMERCIAL_REASONS.has(input.reasonCode),
            dueAt,
            occurredAt,
            slaMinutes,
            slaPolicyVersion: dependencies.slaPolicyVersion,
            summaryEnvelope: dependencies.cipher.encrypt(
              summary,
              `${input.dealId}:${input.conversationId}:handoff:summary`,
            ),
            taskTextEnvelope: dependencies.cipher.encrypt(
              'Retorno humano solicitado',
              `${input.dealId}:${input.conversationId}:handoff:task`,
            ),
          },
          context,
        );
        await appendEvent(
          dealEvent(input, result.deal, 'deal.handoff.created', {
            assignedUserId: result.handoff.assignedUserId,
            conversationId: result.conversation.id,
            conversationVersion: result.conversation.version,
            handoffId: result.handoff.id,
            reasonCode: result.handoff.reasonCode,
            taskId: result.task.id,
          }),
          context,
        );
        return result;
      },
    );
  }

  /** @param {any} input @param {'accept'|'transfer'|'resolve'} action */
  async function updateHandoff(input, action) {
    validateHumanCommon(input, HANDOFF_ACTION_REASONS);
    const expectedReason = {
      accept: 'handoff_accepted',
      resolve: 'handoff_resolved',
      transfer: 'manual_transfer',
    }[action];
    if (input.reasonCode !== expectedReason) {
      throw new WorkValidationError('reasonCode does not match handoff action');
    }
    requireId(input.handoffId, 'handoffId');
    requireVersion(input.expectedHandoffVersion, 'expectedHandoffVersion');
    requireVersion(input.expectedTaskVersion, 'expectedTaskVersion');
    requireVersion(input.expectedDealVersion, 'expectedDealVersion');
    requireVersion(
      input.expectedConversationVersion,
      'expectedConversationVersion',
    );
    if (action === 'transfer')
      requireId(input.assignedUserId, 'assignedUserId');
    return run(
      input,
      `handoff.${action}`,
      'handoff',
      input.handoffId,
      {
        action,
        assignedUserId: input.assignedUserId,
        expectedConversationVersion: input.expectedConversationVersion,
        expectedDealVersion: input.expectedDealVersion,
        expectedHandoffVersion: input.expectedHandoffVersion,
        expectedTaskVersion: input.expectedTaskVersion,
      },
      `${input.expectedHandoffVersion}->${input.expectedHandoffVersion + 1}`,
      async (context) => {
        const result = await dependencies.repository.updateHandoff(
          { ...input, action, occurredAt: clock().toISOString() },
          context,
        );
        await appendEvent(
          {
            aggregateId: result.handoff.id,
            aggregateType: 'handoff',
            aggregateVersion: result.handoff.version,
            correlationId: input.correlationId,
            occurredAt: clock(),
            payload: {
              assignedUserId: result.handoff.assignedUserId,
              dealId: result.handoff.dealId,
              status: result.handoff.status,
              taskId: result.task.id,
              version: result.handoff.version,
            },
            type: {
              accept: 'handoff.accepted',
              resolve: 'handoff.resolved',
              transfer: 'handoff.transferred',
            }[action],
          },
          context,
        );
        return result;
      },
    );
  }

  /** @param {any} input */
  async function claimHandoff(input) {
    validateHumanCommon(
      { ...input, reasonCode: input.reasonCode ?? 'handoff_claimed' },
      new Set(['handoff_claimed']),
    );
    requireId(input.handoffId, 'handoffId');
    requireVersion(input.expectedHandoffVersion, 'expectedHandoffVersion');
    const command = {
      ...input,
      reasonCode: input.reasonCode ?? 'handoff_claimed',
    };
    return run(
      command,
      'handoff.claim',
      'handoff',
      input.handoffId,
      { expectedHandoffVersion: input.expectedHandoffVersion },
      `${input.expectedHandoffVersion}->${input.expectedHandoffVersion + 1}`,
      async (context) => {
        const result = await dependencies.repository.claimHandoff(
          { ...command, occurredAt: clock().toISOString() },
          context,
        );
        await appendEvent(
          {
            aggregateId: result.handoff.id,
            aggregateType: 'handoff',
            aggregateVersion: result.handoff.version,
            correlationId: input.correlationId,
            occurredAt: clock(),
            payload: {
              assignedUserId: result.handoff.assignedUserId,
              conversationId: result.handoff.conversationId,
              status: result.handoff.status,
              targetRole: result.handoff.targetRole,
              version: result.handoff.version,
            },
            type: 'handoff.claimed',
          },
          context,
        );
        return result;
      },
    );
  }

  return Object.freeze({
    acceptHandoff: (/** @type {any} */ input) => updateHandoff(input, 'accept'),
    assignDeal,
    cancelTask: (/** @type {any} */ input) => updateTask(input, 'cancel'),
    claimHandoff,
    completeTask: (/** @type {any} */ input) => updateTask(input, 'complete'),
    createHandoff,
    createTask,
    resolveHandoff: (/** @type {any} */ input) =>
      updateHandoff(input, 'resolve'),
    startTask: (/** @type {any} */ input) => updateTask(input, 'start'),
    transferHandoff: (/** @type {any} */ input) =>
      updateHandoff(input, 'transfer'),
  });
}

/** @param {any} input */
function validateHandoffCreate(input) {
  validateCommon(input, HANDOFF_REASONS);
  requireId(input.assignedUserId, 'assignedUserId');
  requireId(input.conversationId, 'conversationId');
  requireVersion(input.expectedDealVersion, 'expectedDealVersion');
  requireVersion(
    input.expectedConversationVersion,
    'expectedConversationVersion',
  );
  const automation = input.actor.kind === 'AUTOMATION_EXECUTOR';
  if (automation) {
    if (input.actor.id !== 'AUTOMATION_EXECUTOR')
      throw new WorkForbiddenError();
    requireEpoch(input.automationEpoch);
    requireAutomationContext(input.automationContext);
  } else {
    validateHuman(input.actor);
    if (
      input.automationEpoch !== undefined ||
      input.automationContext !== undefined
    ) {
      throw new WorkValidationError(
        'Automation fields are only accepted for automation',
      );
    }
  }
}

/** @param {any} input @param {Set<string>} reasons */
function validateHumanCommon(input, reasons) {
  validateCommon(input, reasons);
  validateHuman(input.actor);
}

/** @param {any} input @param {Set<string>} reasons */
function validateCommon(input, reasons) {
  if (!input || typeof input !== 'object') throw new WorkValidationError();
  requireId(input.dealId ?? input.taskId ?? input.handoffId, 'targetId');
  requireId(input.actor?.id, 'actor.id');
  requireId(input.correlationId, 'correlationId');
  requireId(input.idempotencyKey, 'idempotencyKey');
  if (!reasons.has(input.reasonCode))
    throw new WorkValidationError('reasonCode is invalid');
}

/** @param {any} actor */
function validateHuman(actor) {
  if (
    actor?.kind !== 'human' ||
    !['Atendimento', 'Vendedor'].includes(actor.functionName)
  ) {
    throw new WorkForbiddenError();
  }
}

/** @param {any} context */
function requireAutomationContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new WorkValidationError('automationContext is required');
  }
  const keys = Object.keys(context).sort();
  if (
    keys.join(',') !== 'executionId,workflowKey,workflowVersion' ||
    keys.some(
      (key) => typeof context[key] !== 'string' || context[key].trim() === '',
    )
  ) {
    throw new WorkValidationError('automationContext is invalid');
  }
}

/** @param {unknown} value */
function requireEpoch(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new WorkValidationError(
      'automationEpoch must be a non-negative integer',
    );
  }
}

/** @param {unknown} value @param {string} field */
function requireVersion(value, field) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new WorkValidationError(`${field} must be a positive integer`);
  }
}

/** @param {unknown} value @param {string} field */
function requireId(value, field) {
  const normalized = requireString(value, field);
  if (
    normalized.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(normalized)
  ) {
    throw new WorkValidationError(`${field} is invalid`);
  }
  return normalized;
}

/** @param {unknown} value @param {string} field */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkValidationError(`${field} is required`);
  }
  return value.trim();
}

/** @param {unknown} value @param {string} field @param {number} max */
function requireBoundedText(value, field, max) {
  const normalized = requireString(value, field);
  if (normalized.length > max)
    throw new WorkValidationError(`${field} is too long`);
  return normalized;
}

/** @param {unknown} value @param {Date} now @param {string} field */
function requireFutureInstant(value, now, field) {
  const normalized = requireString(value, field);
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== normalized ||
    parsed.getTime() <= now.getTime()
  ) {
    throw new WorkValidationError(`${field} must be a future ISO instant`);
  }
  return normalized;
}

/** @param {string} value */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {any} value @returns {any} */
function compactJson(value) {
  if (Array.isArray(value)) return value.map(compactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, compactJson(nested)]),
    );
  }
  return value;
}

/** @param {any} input @param {any} deal @param {string} type @param {any} payload */
function dealEvent(input, deal, type, payload) {
  return {
    aggregateId: deal.id,
    aggregateType: 'deal',
    aggregateVersion: deal.version,
    correlationId: input.correlationId,
    occurredAt: new Date(deal.updatedAt),
    payload: { ...payload, version: deal.version },
    type,
  };
}

/** @param {any} dependencies */
function assertDependencies(dependencies) {
  for (const [port, method, name] of [
    [dependencies?.auditPort, 'append', 'auditPort'],
    [dependencies?.cipher, 'encrypt', 'cipher'],
    [dependencies?.eventPort, 'append', 'eventPort'],
    [dependencies?.idempotencyStore, 'execute', 'idempotencyStore'],
    [dependencies?.repository, 'assignDeal', 'repository'],
    [dependencies?.repository, 'createTask', 'repository'],
    [dependencies?.repository, 'updateTask', 'repository'],
    [dependencies?.repository, 'createHandoff', 'repository'],
    [dependencies?.repository, 'claimHandoff', 'repository'],
    [dependencies?.repository, 'updateHandoff', 'repository'],
  ]) {
    if (!port || typeof port[method] !== 'function') {
      throw new WorkValidationError(`${name} must implement ${method}`);
    }
  }
}
