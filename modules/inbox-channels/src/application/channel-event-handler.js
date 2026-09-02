import { InboxValidationError } from '../domain/errors.js';

/** @param {any} dependencies @returns {any} */
export function createChannelEventHandler({
  auditPort = /** @type {any} */ ({ append: async () => undefined }),
  contactIdentityService,
  inboxService,
  logger = /** @type {any} */ ({ error: () => undefined }),
}) {
  if (
    typeof contactIdentityService?.resolveInboundIdentity !== 'function' ||
    typeof inboxService?.receiveInbound !== 'function'
  ) {
    throw new InboxValidationError(
      'channel event handler ports are incomplete',
    );
  }

  return Object.freeze({
    async process(
      /** @type {{channelEventId?: string, correlationId: string, event: any}} */ {
        channelEventId,
        correlationId,
        event,
      },
    ) {
      try {
        const identity = event.identity;
        const resolved = await contactIdentityService.resolveInboundIdentity({
          channel: event.channel,
          correlationId,
          displayHandle: identity.displayHandle,
          externalIdentityId: identity.externalId.externalId,
          identityKind: identity.kind,
          occurredAt: event.occurredAt,
          phoneStatus: identity.phoneStatus,
          provider: event.provider,
          providerAccountId: event.providerAccountId,
        });
        return await inboxService.receiveInbound({
          ...(channelEventId === undefined ? {} : { channelEventId }),
          contactId: resolved.contact.id,
          correlationId,
          externalConversationId: event.externalConversationId.externalId,
          externalMessageId: event.externalMessageId.externalId,
          identityId: resolved.identity.id,
          message: {
            content: structuredClone(event.message.content),
            type: event.message.type,
          },
          occurredAt: event.occurredAt,
          provider: event.provider,
          providerAccountId: event.providerAccountId,
        });
      } catch (error) {
        const errorCode = safeErrorCode(error);
        logger.error('channel_event_processing_failed', {
          error_code: errorCode,
        });
        await auditPort.append({
          action: 'channel_event.processing_failed',
          actor: 'system',
          correlationId,
          reason: errorCode,
          target: { id: correlationId, type: 'channel_event' },
          version: 1,
        });
        throw error;
      }
    },
  });
}

/** @param {any} dependencies */
export function createChannelEventJobHandler({
  channelEventHandler,
  eventStore,
}) {
  if (
    typeof channelEventHandler?.process !== 'function' ||
    typeof eventStore?.readCanonicalEventRecord !== 'function'
  ) {
    throw new InboxValidationError('channel event job ports are incomplete');
  }

  return async (/** @type {any} */ job) => {
    if (
      typeof job?.channelEventId !== 'string' ||
      job.channelEventId.trim() === ''
    ) {
      throw new InboxValidationError('channelEventId is required');
    }
    const record = await eventStore.readCanonicalEventRecord(
      job.channelEventId,
    );
    if (!record) {
      throw new InboxValidationError('channel event was not found');
    }
    await channelEventHandler.process({
      ...record,
      channelEventId: job.channelEventId,
    });
    return Object.freeze({ outcome: 'sent' });
  };
}

/** @param {unknown} error */
function safeErrorCode(error) {
  const code =
    error && typeof error === 'object'
      ? /** @type {Record<string, unknown>} */ (error).code
      : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? code
    : 'CHANNEL_EVENT_PROCESSING_FAILED';
}
