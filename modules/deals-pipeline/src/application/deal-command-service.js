import { createHash } from 'node:crypto';

import { createIdempotentCommandExecutor } from '@crm-silmer/integration-reliability';

import {
  deriveDealStage,
  freezeDealRecord,
  requireExpectedVersion,
  requireNonEmpty,
} from '../domain/deal.js';
import {
  DealConflictError,
  DealForbiddenError,
  DealGateIncompleteError,
  DealValidationError,
} from '../domain/errors.js';

/** @param {any} dependencies */
export function createDealCommandService(dependencies) {
  assertDependencies(dependencies);
  const execute = createIdempotentCommandExecutor({
    auditTrail: dependencies.auditPort,
    idempotencyStore: dependencies.idempotencyStore,
  });
  const clock = dependencies.clock ?? (() => new Date());

  return Object.freeze({
    /** @param {any} input */
    async transitionDeal(input) {
      validateTransition(input);
      const command = normalizeTransition(input);
      return execute(
        requestFor(command, 'deal.transition', command.reason, {
          direction: command.direction,
          ...(command.automationEpoch === undefined
            ? {}
            : { automationEpoch: command.automationEpoch }),
          ...(command.conversationId === undefined
            ? {}
            : { conversationId: command.conversationId }),
        }),
        async (transaction) => {
          const context = { transaction };
          return dependencies.dealRepository.executeLocked(
            command,
            async (/** @type {any} */ deal) => {
              if (deal.status !== 'active') {
                throw new DealConflictError('Deal is not active');
              }
              if (command.actor.kind === 'AUTOMATION_EXECUTOR') {
                await dependencies.automationFencePort.assertCurrent(
                  {
                    automationEpoch: command.automationEpoch,
                    conversationId: command.conversationId,
                    dealId: deal.id,
                  },
                  context,
                );
              }
              const toStage = deriveDealStage(deal.stage, command.direction);
              if (!toStage) {
                throw new DealConflictError(
                  'Deal cannot cross the stage boundary',
                );
              }
              const occurredAt = clock().toISOString();
              let gate = null;
              if (command.direction === 'advance') {
                const assessment =
                  await dependencies.qualificationPort.evaluateGate(
                    { dealId: deal.id, stage: deal.stage },
                    context,
                  );
                const blockers = normalizeBlockers(assessment?.blockers);
                if (blockers.length > 0) throw new DealGateIncompleteError();
                gate = freezeDealRecord({
                  blockers: [],
                  dealId: deal.id,
                  evaluatedAt: occurredAt,
                  fromStage: deal.stage,
                  version: deal.version,
                });
              }
              const changed = await dependencies.dealRepository.applyTransition(
                {
                  actorId: command.actor.id,
                  deal,
                  direction: command.direction,
                  gate,
                  occurredAt,
                  reason: command.reason,
                  toStage,
                },
                context,
              );
              await dependencies.eventPort.append(
                {
                  aggregateId: deal.id,
                  aggregateType: 'deal',
                  aggregateVersion: changed.version,
                  correlationId: command.correlationId,
                  occurredAt: new Date(occurredAt),
                  payload: {
                    direction: command.direction,
                    fromStage: deal.stage,
                    toStage,
                    version: changed.version,
                  },
                  type: 'deal.stage.changed',
                },
                context,
              );
              return freezeDealRecord({ deal: changed, gate });
            },
            context,
          );
        },
      );
    },

    /** @param {any} input */
    async loseDeal(input) {
      validateLoss(input);
      const command = normalizeLoss(input);
      const reasonDigest = createHash('sha256')
        .update(command.reason)
        .digest('hex');
      return execute(
        requestFor(
          command,
          'deal.lose',
          'Perda registrada por decisão humana',
          {
            reasonDigest,
          },
        ),
        async (transaction) => {
          const context = { transaction };
          return dependencies.dealRepository.executeLocked(
            command,
            async (/** @type {any} */ deal) => {
              if (deal.status !== 'active') {
                throw new DealConflictError('Deal is not active');
              }
              const occurredAt = clock().toISOString();
              const envelope = dependencies.lossReasonCipher.encrypt(
                command.reason,
                deal.id,
              );
              const changed = await dependencies.dealRepository.lose(
                {
                  actorId: command.actor.id,
                  deal,
                  lossReasonEnvelope: envelope,
                  occurredAt,
                },
                context,
              );
              await dependencies.eventPort.append(
                {
                  aggregateId: deal.id,
                  aggregateType: 'deal',
                  aggregateVersion: changed.version,
                  correlationId: command.correlationId,
                  occurredAt: new Date(occurredAt),
                  payload: { stage: deal.stage, version: changed.version },
                  type: 'deal.lost',
                },
                context,
              );
              return freezeDealRecord({ deal: changed });
            },
            context,
          );
        },
      );
    },
  });
}

/** @param {any} input */
function validateTransition(input) {
  validateCommon(input);
  if (!['advance', 'retreat'].includes(input.direction)) {
    throw new DealValidationError('direction must be advance or retreat');
  }
  const automation = input.actor.kind === 'AUTOMATION_EXECUTOR';
  if (automation && input.direction !== 'advance')
    throw new DealForbiddenError();
  if (automation) {
    requireAutomationEpoch(input.automationEpoch);
    requireNonEmpty(input.conversationId, 'conversationId');
  }
  if (
    !automation &&
    (input.automationEpoch !== undefined || input.conversationId !== undefined)
  ) {
    throw new DealValidationError(
      'automationEpoch is only accepted for automation',
    );
  }
}

/** @param {any} input */
function validateLoss(input) {
  validateCommon(input);
  if (input.actor.kind !== 'human') throw new DealForbiddenError();
}

/** @param {any} input */
function validateCommon(input) {
  const actor = input?.actor;
  const human =
    actor?.kind === 'human' &&
    actor.functionName === 'Vendedor';
  const automation =
    actor?.kind === 'AUTOMATION_EXECUTOR' && actor.id === 'AUTOMATION_EXECUTOR';
  if (!human && !automation) throw new DealForbiddenError();
  for (const field of ['dealId', 'correlationId', 'idempotencyKey', 'reason']) {
    requireNonEmpty(input[field], field);
  }
  requireNonEmpty(actor.id, 'actor.id');
  requireExpectedVersion(input.expectedVersion);
}

/** @param {any} input */
function normalizeTransition(input) {
  return freezeDealRecord({
    ...normalizeCommon(input),
    direction: input.direction,
    ...(input.automationEpoch === undefined
      ? {}
      : { automationEpoch: input.automationEpoch }),
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: input.conversationId.trim() }),
  });
}

/** @param {any} input */
function normalizeLoss(input) {
  return freezeDealRecord(normalizeCommon(input));
}

/** @param {any} input */
function normalizeCommon(input) {
  return {
    actor: freezeDealRecord({
      ...(input.actor.kind === 'human'
        ? { functionName: input.actor.functionName }
        : {}),
      id: input.actor.id,
      kind: input.actor.kind,
    }),
    correlationId: input.correlationId.trim(),
    dealId: input.dealId.trim(),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey.trim(),
    reason: input.reason.trim(),
  };
}

/** @param {any} command @param {string} action @param {string} auditReason @param {any} body */
function requestFor(command, action, auditReason, body) {
  return {
    action,
    actor: command.actor.id,
    command: body,
    correlationId: command.correlationId,
    key: command.idempotencyKey,
    reason: auditReason,
    target: { id: command.dealId, type: 'deal' },
    version: command.expectedVersion,
  };
}

/** @param {unknown} value */
function normalizeBlockers(value) {
  if (!Array.isArray(value)) {
    throw new DealConflictError('Qualification gate is unavailable');
  }
  return value.map((blocker) => String(blocker));
}

/** @param {unknown} value */
function requireAutomationEpoch(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new DealValidationError(
      'automationEpoch must be a non-negative integer',
    );
  }
}

/** @param {any} dependencies */
function assertDependencies(dependencies) {
  const required = [
    [dependencies?.automationFencePort, 'assertCurrent', 'automationFencePort'],
    [dependencies?.auditPort, 'append', 'auditPort'],
    [dependencies?.dealRepository, 'executeLocked', 'dealRepository'],
    [dependencies?.dealRepository, 'applyTransition', 'dealRepository'],
    [dependencies?.dealRepository, 'lose', 'dealRepository'],
    [dependencies?.eventPort, 'append', 'eventPort'],
    [dependencies?.idempotencyStore, 'execute', 'idempotencyStore'],
    [dependencies?.lossReasonCipher, 'encrypt', 'lossReasonCipher'],
    [dependencies?.qualificationPort, 'evaluateGate', 'qualificationPort'],
  ];
  for (const [port, method, name] of required) {
    if (!port || typeof port[method] !== 'function') {
      throw new DealValidationError(`${name} must implement ${method}`);
    }
  }
}
