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
