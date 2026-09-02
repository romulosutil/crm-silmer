import { randomUUID } from 'node:crypto';

import { InboxForbiddenError, InboxValidationError } from '../domain/errors.js';
import {
  assertInboxState,
  freezeInboxRecord,
  requireNonEmpty,
  requireVersion,
} from '../domain/inbox.js';

/** @param {any} dependencies @returns {any} */
export function createInboxService({
  auditPort = /** @type {any} */ ({ append: async () => undefined }),
  clock = () => new Date(),
  idFactory = defaultIdFactory,
  repository,
}) {
  if (
    !repository ||
    typeof repository.receiveInbound !== 'function' ||
    typeof repository.mutateConversation !== 'function' ||
    typeof repository.recordSuggestion !== 'function'
  ) {
    throw new InboxValidationError(
      'repository does not implement the inbox contract',
    );
  }
  if (typeof auditPort?.append !== 'function') {
    throw new InboxValidationError('auditPort must implement append');
  }
  if (typeof clock !== 'function' || typeof idFactory !== 'function') {
    throw new InboxValidationError('clock and idFactory must be functions');
  }
  const runtime = freezeInboxRecord({
    appendAudit: (/** @type {any} */ event, /** @type {any} */ context) =>
      auditPort.append(event, context),
    clock,
    idFactory,
  });

  return Object.freeze({
    async receiveInbound(/** @type {any} */ input) {
      validateInbound(input);
      return repository.receiveInbound(normalizeInbound(input), runtime);
    },

    async transitionConversation(/** @type {any} */ command) {
      validateHumanCommand(command);
      assertInboxState(command.state);
      if (command.state === 'convertida_em_lead') {
        throw new InboxValidationError(
          'converted state is reserved for transactional lead conversion',
        );
      }
      return repository.mutateConversation(
        'transition',
        normalizeHumanCommand(command, { state: command.state }),
        runtime,
      );
    },

    async takeover(/** @type {any} */ command) {
      validateHumanCommand(command);
      return repository.mutateConversation(
        'takeover',
        normalizeHumanCommand(command),
        runtime,
      );
    },

    async sendHumanMessage(/** @type {any} */ command) {
      validateHumanCommand(command);
      requireNonEmpty(command.messageType, 'messageType');
      validateContent(command.content);
      return repository.mutateConversation(
        'send',
        normalizeHumanCommand(command, {
          content: structuredClone(command.content),
          messageType: command.messageType,
        }),
        runtime,
      );
    },

    async reactivateAgent(/** @type {any} */ command) {
      validateHumanCommand(command);
      return repository.mutateConversation(
        'reactivate',
        normalizeHumanCommand(command),
        runtime,
      );
    },

    async recordSuggestion(/** @type {any} */ input) {
      if (input?.actor?.kind !== 'assistant') {
        throw new InboxForbiddenError();
      }
      for (const field of [
        'conversationId',
        'correlationId',
        'proposedStage',
        'question',
        'sourceMessageId',
      ]) {
        requireNonEmpty(input[field], field);
      }
      requireNonEmpty(input.actor.id, 'actor.id');
      return repository.recordSuggestion(
        freezeInboxRecord({
          actor: freezeInboxRecord({ id: input.actor.id, kind: 'assistant' }),
          conversationId: input.conversationId,
          correlationId: input.correlationId,
          proposedStage: input.proposedStage.trim(),
          question: input.question.trim(),
          sourceMessageId: input.sourceMessageId,
        }),
        runtime,
      );
    },
  });
}

/** @param {any} input */
function validateInbound(input) {
  for (const field of [
    'contactId',
    'correlationId',
    'externalConversationId',
    'externalMessageId',
    'identityId',
    'occurredAt',
    'provider',
    'providerAccountId',
  ]) {
    requireNonEmpty(input?.[field], field);
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new InboxValidationError('occurredAt must be an ISO date');
  }
  if (input.channelEventId !== undefined) {
    requireNonEmpty(input.channelEventId, 'channelEventId');
  }
  requireNonEmpty(input?.message?.type, 'message.type');
  validateContent(input?.message?.content);
}

/** @param {unknown} content */
function validateContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new InboxValidationError('message content must be an object');
  }
  if (JSON.stringify(content) === undefined) {
    throw new InboxValidationError('message content must be JSON serializable');
  }
}

/** @param {any} command */
function validateHumanCommand(command) {
  if (
    command?.actor?.kind !== 'human' ||
    !['Atendimento', 'Vendedor'].includes(command.actor.functionName)
  ) {
    throw new InboxForbiddenError();
  }
  requireNonEmpty(command.actor.id, 'actor.id');
  for (const field of [
    'conversationId',
    'correlationId',
    'idempotencyKey',
    'reason',
  ]) {
    requireNonEmpty(command[field], field);
  }
  requireVersion(command.expectedVersion);
}

/** @param {any} input */
function normalizeInbound(input) {
  return freezeInboxRecord({
    ...(input.channelEventId === undefined
      ? {}
      : { channelEventId: input.channelEventId }),
    contactId: input.contactId,
    correlationId: input.correlationId,
    externalConversationId: input.externalConversationId,
    externalMessageId: input.externalMessageId,
    identityId: input.identityId,
    message: freezeInboxRecord({
      content: structuredClone(input.message.content),
      type: input.message.type,
    }),
    occurredAt: new Date(input.occurredAt).toISOString(),
    provider: input.provider,
    providerAccountId: input.providerAccountId,
  });
}

/** @param {any} command @param {Record<string, unknown>} [extra] */
function normalizeHumanCommand(command, extra = {}) {
  return freezeInboxRecord({
    actor: freezeInboxRecord({
      functionName: command.actor.functionName,
      id: command.actor.id,
      kind: 'human',
    }),
    conversationId: command.conversationId,
    correlationId: command.correlationId,
    expectedVersion: command.expectedVersion,
    idempotencyKey: command.idempotencyKey,
    reason: command.reason.trim(),
    ...extra,
  });
}

/** @param {string} kind */
function defaultIdFactory(kind) {
  return `${kind}-${randomUUID()}`;
}
