import { randomBytes, randomUUID } from 'node:crypto';

import {
  N8nConflictError,
  N8nForbiddenError,
  N8nValidationError,
} from './errors.js';
import { fingerprint } from './crypto.js';

const EVENT_TYPES = new Set([
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'message.send.requested',
  'message.send.unknown',
  'lead.updated',
  'handoff.requested',
  'workflow.failed',
]);
const EVENTS_WITH_RESOLVABLE_CONVERSATION = new Set([
  'message.delivered',
  'message.failed',
  'message.read',
  'message.send.unknown',
  'message.sent',
]);

/**
 * Domain boundary consumed by the HTTP adapter. Transport authentication is
 * complete before this service runs, but the technical actor is still fenced
 * here so an internal caller cannot bypass least privilege accidentally.
 *
 * @param {{
 *   repository: {
 *     receiveInbound(input: any, runtime: any): Promise<any>,
 *     storeAttachment(input: any, runtime: any): Promise<any>,
 *     claimAiTurn(input: any, runtime: any): Promise<any>,
 *     recordEvent(input: any, runtime: any): Promise<any>,
 *     reserveSend?: (input: any, runtime: any) => Promise<any>,
 *     enqueuePanelCommand?: (input: any, runtime: any) => Promise<any>,
 *   },
 *   clock?: () => Date,
 *   idFactory?: (kind: string) => string,
 *   tokenFactory?: () => string,
 *   claimLeaseMs?: number,
 * }} options
 */
export function createN8nIntegrationService({
  repository,
  clock = () => new Date(),
  idFactory = (kind) => `${kind}-${randomUUID()}`,
  tokenFactory = () => randomBytes(32).toString('base64url'),
  claimLeaseMs = 60_000,
}) {
  for (const [candidate, method] of [
    [repository?.receiveInbound, 'receiveInbound'],
    [repository?.storeAttachment, 'storeAttachment'],
    [repository?.claimAiTurn, 'claimAiTurn'],
    [repository?.recordEvent, 'recordEvent'],
  ]) {
    if (typeof candidate !== 'function') {
      throw new N8nValidationError(`repository must implement ${method}`);
    }
  }
  if (
    typeof clock !== 'function' ||
    typeof idFactory !== 'function' ||
    typeof tokenFactory !== 'function' ||
    !Number.isSafeInteger(claimLeaseMs) ||
    claimLeaseMs < 1_000 ||
    claimLeaseMs > 300_000
  ) {
    throw new N8nValidationError('Invalid n8n integration runtime');
  }

  const runtime = Object.freeze({
    claimLeaseMs,
    clock,
    idFactory,
    tokenFactory,
  });

  return Object.freeze({
    /** @param {any} input */
    async receiveInbound(input) {
      const technical = normalizeTechnical(input?.technical);
      requireSchema(input?.schema_version);
      const occurredAt = instant(input?.occurred_at, 'occurred_at');
      const channel = /** @type {'instagram'|'whatsapp'} */ (
        oneOf(input?.channel, ['instagram', 'whatsapp'], 'channel')
      );
      const provider = identifier(input?.provider ?? 'meta', 'provider', 64);
      const providerAccountId = identifier(
        input?.metadata?.provider_account_id ??
          input?.metadata?.phone_number_id ??
          input?.provider_account_id,
        'metadata.provider_account_id',
        512,
      );
      const externalIdentityId = normalizeChannelIdentity(
        channel,
        input?.contact?.external_id ??
          input?.contact?.ig_id ??
          input?.contact?.wa_id,
      );
      const externalMessageId = identifier(
        input?.message?.external_id,
        'message.external_id',
        512,
      );
      const externalConversationId = identifier(
        input?.external_conversation_id ?? externalIdentityId,
        'external_conversation_id',
        512,
      );
      const messageType = oneOf(
        input?.message?.type,
        [
          'audio',
          'button',
          'document',
          'image',
          'interactive',
          'text',
          'video',
        ],
        'message.type',
      );
      const content = normalizeMessageContent(input?.message, messageType);
      const canonicalMessageType = ['button', 'interactive'].includes(
        messageType,
      )
        ? 'text'
        : messageType;
      const identityKind = channel === 'whatsapp' ? 'phone' : 'handle';
      const displayHandle =
        channel === 'instagram'
          ? optionalString(input?.contact?.name ?? input?.contact?.handle, 512)
          : null;

      return translateConflict(() =>
        repository.receiveInbound(
          Object.freeze({
            briefing: plainObject(input?.briefing ?? {}),
            channel,
            correlationId: technical.correlationId,
            eventFingerprint: fingerprint({
              channel,
              contact: input.contact,
              eventId: input.event_id,
              message: input.message,
              occurredAt,
              provider,
              providerAccountId,
            }),
            externalConversationId,
            externalEventId: identifier(input?.event_id, 'event_id', 512),
            externalIdentityId,
            externalMessageId,
            identityKind,
            displayHandle,
            message: { content, type: canonicalMessageType },
            occurredAt,
            phoneStatus: channel === 'whatsapp' ? 'confirmed' : 'pending',
            provider,
            providerAccountId,
            technical,
          }),
          runtime,
        ),
      );
    },

    /** @param {any} input */
    async storeAttachment(input) {
      const technical = normalizeTechnical(input?.technical);
      const contentSha256 = sha256(
        input?.contentSha256 ?? input?.content_sha256,
        'contentSha256',
      );
      const transientMediaId = identifier(
        input?.transientMediaId ?? input?.transient_media_id,
        'transientMediaId',
        512,
      );
      const normalized = Object.freeze({
        contentSha256,
        conversationId: identifier(
          input?.conversationId ?? input?.conversation_id,
          'conversationId',
          512,
        ),
        correlationId: technical.correlationId,
        eventFingerprint: fingerprint({
          contentSha256,
          externalId: input?.externalId ?? input?.external_id,
          filename: input?.filename,
          mimeType: input?.mimeType ?? input?.mime_type,
          size: input?.size,
          transientMediaId,
        }),
        externalId: identifier(
          input?.externalId ?? input?.external_id,
          'externalId',
          512,
        ),
        filename: safeFilename(input?.filename),
        mimeType: identifier(
          input?.mimeType ?? input?.mime_type,
          'mimeType',
          255,
        ),
        size: nonNegativeInteger(input?.size, 'size'),
        transientMediaId,
        technical,
      });
      return translateConflict(() =>
        repository.storeAttachment(normalized, runtime),
      );
    },

    /** @param {any} input */
    async claimAiTurn(input) {
      const technical = normalizeTechnical(input?.technical);
      requireSchema(input?.schema_version);
      const revision = positiveInteger(input?.revision, 'revision');
      const automationEpoch = nonNegativeInteger(
        input?.automation_epoch,
        'automation_epoch',
      );
      const normalized = Object.freeze({
        automationEpoch,
        claimId: identifier(
          input?.claim_id ?? idFactory('ai-turn-claim'),
          'claim_id',
          512,
        ),
        conversationId: identifier(
          input?.conversation_id,
          'conversation_id',
          512,
        ),
        eventFingerprint: fingerprint({
          automationEpoch,
          conversationId: input?.conversation_id,
          lastEventId: input?.last_event_id,
          revision,
          workerId: input?.worker_id,
        }),
        lastEventId: identifier(input?.last_event_id, 'last_event_id', 512),
        revision,
        technical,
        workerId: identifier(input?.worker_id, 'worker_id', 128),
      });
      return translateConflict(() =>
        repository.claimAiTurn(normalized, runtime),
      );
    },

    /** @param {any} input */
    async recordEvent(input) {
      const technical = normalizeTechnical(input?.technical);
      requireSchema(input?.schema_version);
      const eventType = oneOf(
        input?.event_type,
        [...EVENT_TYPES],
        'event_type',
      );
      const occurredAt = instant(input?.occurred_at, 'occurred_at');
      const conversationId =
        (input?.conversation_id === null ||
          input?.conversation_id === undefined) &&
        (eventType === 'workflow.failed' ||
          EVENTS_WITH_RESOLVABLE_CONVERSATION.has(eventType))
          ? null
          : identifier(input?.conversation_id, 'conversation_id', 512);
      const normalized = Object.freeze({
        aiModel: optionalString(input?.ai_model, 128),
        aiProvider:
          input?.ai_provider === undefined
            ? null
            : oneOf(input.ai_provider, ['openai', 'gemini'], 'ai_provider'),
        automationEpoch:
          input?.automation_epoch === undefined
            ? null
            : nonNegativeInteger(input.automation_epoch, 'automation_epoch'),
        claimToken: optionalString(input?.claim_token, 512),
        claimId: optionalString(input?.claim_id, 512),
        commandId: optionalString(input?.command_id, 512),
        conversationId,
        correlationId: technical.correlationId,
        eventFingerprint: fingerprint(stripTechnical(input)),
        eventId: identifier(input?.event_id, 'event_id', 512),
        eventType,
        expectedVersion:
          input?.expected_version === undefined
            ? null
            : positiveInteger(input.expected_version, 'expected_version'),
        externalMessageId: optionalString(
          input?.external_message_id ?? input?.message?.external_id,
          512,
        ),
        failure: input?.failure ? plainObject(input.failure) : null,
        handoff: input?.handoff ? plainObject(input.handoff) : null,
        leadPatch: input?.lead_patch ? plainObject(input.lead_patch) : null,
        message: input?.message ? plainObject(input.message) : null,
        occurredAt,
        promptVersion: optionalString(input?.prompt_version, 128),
        revision:
          input?.revision === undefined
            ? null
            : positiveInteger(input.revision, 'revision'),
        status: optionalString(input?.status, 64),
        technical,
      });
      return translateConflict(() =>
        repository.recordEvent(normalized, runtime),
      );
    },

    /** Transactional panel-to-n8n send reservation used by human APIs. */
    async reserveSend(/** @type {any} */ input) {
      const operation = repository.reserveSend;
      if (typeof operation !== 'function') {
        throw new N8nValidationError(
          'repository does not implement reserveSend',
        );
      }
      return translateConflict(() => operation(input, runtime));
    },

    /** Transactional non-message command hook (take_over/return_to_ai/close). */
    async enqueuePanelCommand(/** @type {any} */ input) {
      const operation = repository.enqueuePanelCommand;
      if (typeof operation !== 'function') {
        throw new N8nValidationError(
          'repository does not implement enqueuePanelCommand',
        );
      }
      return translateConflict(() => operation(input, runtime));
    },
  });
}

/** @param {any} value */
function normalizeTechnical(value) {
  if (!value || typeof value !== 'object') {
    throw new N8nForbiddenError();
  }
  const actorValue = value.actor;
  const actor =
    typeof actorValue === 'string'
      ? actorValue
      : (actorValue?.id ?? actorValue?.kind);
  if (actor !== 'AUTOMATION_EXECUTOR') throw new N8nForbiddenError();
  return Object.freeze({
    actor: 'AUTOMATION_EXECUTOR',
    correlationId: identifier(
      value.correlationId,
      'technical.correlationId',
      128,
    ),
    credentialVersion: identifier(
      String(value.credentialVersion),
      'technical.credentialVersion',
      64,
    ),
    executionId: identifier(value.executionId, 'technical.executionId', 256),
    idempotencyKey: identifier(
      value.idempotencyKey,
      'technical.idempotencyKey',
      512,
    ),
    requestId: identifier(value.requestId, 'technical.requestId', 128),
    workflowKey: identifier(value.workflowKey, 'technical.workflowKey', 128),
    workflowVersion: identifier(
      value.workflowVersion,
      'technical.workflowVersion',
      128,
    ),
  });
}

/** @param {any} message @param {string} type */
function normalizeMessageContent(message, type) {
  if (message?.content !== undefined) return plainObject(message.content);
  if (type === 'button' || type === 'interactive') {
    return {
      interaction: {
        payload: plainObject(message?.interaction ?? message?.button ?? {}),
        type,
      },
      text: typeof message?.text === 'string' ? message.text : '',
    };
  }
  if (type === 'text') {
    if (typeof message?.text !== 'string') {
      throw new N8nValidationError('message.text must be a string');
    }
    return { text: message.text };
  }
  return {
    attachmentId: identifier(
      message?.attachment?.external_id,
      'message.attachment.external_id',
      512,
    ),
    caption: typeof message?.text === 'string' ? message.text : null,
  };
}

/** @param {any} input */
function stripTechnical(input) {
  const payload = { ...input };
  delete payload.technical;
  return payload;
}

/** @param {unknown} value */
function requireSchema(value) {
  if (value !== '1.0')
    throw new N8nValidationError('schema_version must be 1.0');
}

/** @param {unknown} value @param {string[]} allowed @param {string} field */
function oneOf(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new N8nValidationError(`${field} is unsupported`);
  }
  return value;
}

/** @param {unknown} value @param {string} field @param {number} max */
function identifier(value, field, max) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > max ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new N8nValidationError(`${field} is invalid`);
  }
  return value;
}

/** @param {unknown} value @param {number} max */
function optionalString(value, max) {
  return value === null || value === undefined
    ? null
    : identifier(value, 'optional value', max);
}

/** @param {'instagram'|'whatsapp'} channel @param {unknown} value */
function normalizeChannelIdentity(channel, value) {
  const identity = identifier(value, 'contact.external_id', 512);
  if (channel === 'instagram') return identity;
  const compact = identity.startsWith('+') ? identity.slice(1) : identity;
  if (!/^[1-9][0-9]{7,14}$/u.test(compact)) {
    throw new N8nValidationError('contact.wa_id must be a valid E.164 number');
  }
  return `+${compact}`;
}

/** @param {unknown} value @param {string} field */
function instant(value, field) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new N8nValidationError(`${field} must be a canonical ISO instant`);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new N8nValidationError(`${field} must be a positive integer`);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new N8nValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function sha256(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new N8nValidationError(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

/** @param {unknown} value */
function safeFilename(value) {
  const name = identifier(value, 'filename', 255);
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..'
  ) {
    throw new N8nValidationError('filename must not contain a path');
  }
  return name;
}

/** @param {unknown} value */
function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new N8nValidationError('Expected an object');
  }
  try {
    return structuredClone(value);
  } catch {
    throw new N8nValidationError('Object must be structured-cloneable');
  }
}

/** @param {() => Promise<any>} operation */
async function translateConflict(operation) {
  try {
    return await operation();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new N8nConflictError(
        'Idempotency key was reused with a different payload',
        'IDEMPOTENCY_CONFLICT',
      );
    }
    throw error;
  }
}
