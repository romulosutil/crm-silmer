import { randomUUID } from 'node:crypto';

import { createIdempotentCommandExecutor } from '@crm-silmer/integration-reliability';

import {
  freezeDealRecord,
  requireExpectedVersion,
  requireNonEmpty,
} from '../domain/deal.js';
import {
  DealConflictError,
  DealForbiddenError,
  DealValidationError,
} from '../domain/errors.js';

/**
 * @param {{
 *   auditPort: {append: (event: any, context?: {transaction: any}) => Promise<unknown>},
 *   clock?: () => Date,
 *   contactPort: {promoteIdentityContact: Function},
 *   dealRepository: {createFromConversation: Function},
 *   eventPort: {append: Function},
 *   idFactory?: () => string,
 *   idempotencyStore: {execute: (identity: any, operation: (transaction?: unknown) => Promise<unknown>) => Promise<unknown>},
 *   inboxPort: {completeConversion: Function, lockForConversion: Function},
 * }} dependencies
 */
export function createDealConversionService(dependencies) {
  assertDependencies(dependencies);
  const {
    auditPort,
    contactPort,
    dealRepository,
    idempotencyStore,
    inboxPort,
  } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const idFactory = dependencies.idFactory ?? defaultIdFactory;
  const execute = createIdempotentCommandExecutor({
    auditTrail: auditPort,
    idempotencyStore,
  });

  return Object.freeze({
    /** @param {any} input */
    async convertConversation(input) {
      validateCommand(input);
      const command = normalizeCommand(input);
      try {
        const result = await execute(
          {
            action: 'conversation.convert',
            actor: command.actor.id,
            command: {
              ...(command.automationEpoch === undefined
                ? {}
                : { automationEpoch: command.automationEpoch }),
              conversationId: command.conversationId,
              expectedVersion: command.expectedVersion,
            },
            correlationId: command.correlationId,
            key: command.idempotencyKey,
            reason: command.reason,
            target: { id: command.conversationId, type: 'conversation' },
            version: command.expectedVersion,
          },
          async (transaction) => {
            const context = { transaction };
            const occurredAt = clock().toISOString();
            const conversation = await inboxPort.lockForConversion(
              {
                actorKind: command.actor.kind,
                automationEpoch: command.automationEpoch,
                conversationId: command.conversationId,
                expectedVersion: command.expectedVersion,
              },
              context,
            );
            const contact = await contactPort.promoteIdentityContact(
              {
                identityId: conversation.identityId,
                occurredAt,
              },
              context,
            );
            const deal = await dealRepository.createFromConversation(
              {
                contactId: contact.id,
                createdAt: occurredAt,
                id: idFactory(),
                sourceConversationId: conversation.id,
              },
              context,
            );
            await dependencies.eventPort.append(
              {
                aggregateId: deal.id,
                aggregateType: 'deal',
                aggregateVersion: deal.version,
                correlationId: command.correlationId,
                occurredAt: new Date(occurredAt),
                payload: { stage: deal.stage, version: deal.version },
                type: 'deal.created',
              },
              context,
            );
            const convertedConversation = await inboxPort.completeConversion(
              {
                actorKind: command.actor.kind,
                automationEpoch: command.automationEpoch,
                conversationId: conversation.id,
                expectedVersion: conversation.version,
                occurredAt,
              },
              context,
            );
            return freezeDealRecord({
              contact,
              conversation: convertedConversation,
              deal,
            });
          },
        );
        return freezeDealRecord(result);
      } catch (error) {
        const code = /** @type {{code?: unknown}} */ (error)?.code;
        if (
          code === 'INBOX_CONFLICT' ||
          code === 'CONTACT_IDENTITY_CONFLICT' ||
          code === 'CONTACT_IDENTITY_NOT_FOUND' ||
          code === '23505'
        ) {
          throw new DealConflictError('Conversation cannot be converted');
        }
        throw error;
      }
    },
  });
}

/** @param {any} input */
function validateCommand(input) {
  const actor = input?.actor;
  const humanAllowed =
    actor?.kind === 'human' &&
    ['Atendimento', 'Vendedor'].includes(actor.functionName);
  const automationAllowed =
    actor?.kind === 'AUTOMATION_EXECUTOR' && actor.id === 'AUTOMATION_EXECUTOR';
  if (!humanAllowed && !automationAllowed) throw new DealForbiddenError();
  requireNonEmpty(actor.id, 'actor.id');
  for (const field of [
    'conversationId',
    'correlationId',
    'idempotencyKey',
    'reason',
  ]) {
    requireNonEmpty(input[field], field);
  }
  requireExpectedVersion(input.expectedVersion);
  if (automationAllowed) {
    requireAutomationEpoch(input.automationEpoch);
  } else if (input.automationEpoch !== undefined) {
    throw new DealValidationError(
      'automationEpoch is only accepted for the automation actor',
    );
  }
}

/** @param {any} input */
function normalizeCommand(input) {
  return freezeDealRecord({
    actor: freezeDealRecord({
      ...(input.actor.kind === 'human'
        ? { functionName: input.actor.functionName }
        : {}),
      id: input.actor.id,
      kind: input.actor.kind,
    }),
    ...(input.automationEpoch === undefined
      ? {}
      : { automationEpoch: input.automationEpoch }),
    conversationId: input.conversationId.trim(),
    correlationId: input.correlationId.trim(),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey.trim(),
    reason: input.reason.trim(),
  });
}

/** @param {unknown} value */
function requireAutomationEpoch(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new DealValidationError(
      'automationEpoch must be a non-negative integer for automation commands',
    );
  }
}

/** @param {any} dependencies */
function assertDependencies(dependencies) {
  const functions = [
    [dependencies?.auditPort, 'append', 'auditPort'],
    [dependencies?.contactPort, 'promoteIdentityContact', 'contactPort'],
    [dependencies?.dealRepository, 'createFromConversation', 'dealRepository'],
    [dependencies?.idempotencyStore, 'execute', 'idempotencyStore'],
    [dependencies?.inboxPort, 'completeConversion', 'inboxPort'],
    [dependencies?.inboxPort, 'lockForConversion', 'inboxPort'],
  ];
  for (const [port, method, name] of functions) {
    if (!port || typeof port[method] !== 'function') {
      throw new DealValidationError(`${name} must implement ${method}`);
    }
  }
  if (
    dependencies.clock !== undefined &&
    typeof dependencies.clock !== 'function'
  ) {
    throw new DealValidationError('clock must be a function');
  }
  if (
    dependencies.idFactory !== undefined &&
    typeof dependencies.idFactory !== 'function'
  ) {
    throw new DealValidationError('idFactory must be a function');
  }
  if (typeof dependencies.eventPort?.append !== 'function') {
    throw new DealValidationError('eventPort must implement append');
  }
}

function defaultIdFactory() {
  return randomUUID();
}
