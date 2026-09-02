export {
  ChannelContractError,
  createCanonicalInboundEnvelope,
  createCanonicalOutboundEnvelope,
  createScopedExternalId,
} from './domain/channel-envelope.js';
export { assertChannelAdapterContract } from './ports/contracts.js';
export {
  createMetaWhatsAppNormalizer,
  META_WHATSAPP_MAX_EVENTS_PER_CALLBACK,
  META_WHATSAPP_STALE_AFTER_HOURS,
  MetaWhatsAppWebhookPayloadError,
  normalizeMetaWhatsAppWebhook,
} from './adapters/meta-whatsapp.js';
export { InMemoryInboxRepository } from './adapters/in-memory-inbox-repository.js';
export { PostgresInboxRepository } from './adapters/postgres-inbox-repository.js';
export {
  createChannelEventHandler,
  createChannelEventJobHandler,
} from './application/channel-event-handler.js';
export { createInboxService } from './application/inbox-service.js';
export {
  InboxConflictError,
  InboxError,
  InboxForbiddenError,
  InboxValidationError,
} from './domain/errors.js';
export { INBOX_STATES, TERMINAL_INBOX_STATES } from './domain/inbox.js';
