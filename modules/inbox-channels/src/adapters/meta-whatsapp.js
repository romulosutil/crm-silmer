import { resolveTransientMediaExpiresAt } from '@crm-silmer/audit-privacy';

import {
  createCanonicalInboundEnvelope,
  createScopedExternalId,
} from '../domain/channel-envelope.js';

const META_PROVIDER = 'meta';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_CALLBACK = 100;
const MAX_MEDIA_PER_CALLBACK = 100;
const MEDIA_TYPES = new Set(['audio', 'document', 'image', 'video']);

export class MetaWhatsAppWebhookPayloadError extends Error {
  constructor() {
    super('invalid Meta WhatsApp webhook');
    this.name = 'MetaWhatsAppWebhookPayloadError';
    this.code = 'META_WHATSAPP_WEBHOOK_INVALID';
  }
}

function invalid() {
  throw new MetaWhatsAppWebhookPayloadError();
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {string} */
function nonEmptyString(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim()
  ) {
    invalid();
  }
  return /** @type {string} */ (value);
}

/** @param {unknown} value @param {number} maximum @returns {string} */
function boundedString(value, maximum) {
  const normalized = nonEmptyString(value);
  if (Buffer.byteLength(normalized) > maximum) invalid();
  return normalized;
}

/** @param {unknown} value @returns {string|null} */
function optionalString(value) {
  if (value === undefined || value === null) return null;
  return nonEmptyString(value);
}

/** @param {unknown} value @param {number} maximum @returns {string|null} */
function optionalBoundedString(value, maximum) {
  if (value === undefined || value === null) return null;
  return boundedString(value, maximum);
}

/** @param {unknown} value @returns {unknown[]} */
function array(value) {
  if (!Array.isArray(value)) invalid();
  return /** @type {unknown[]} */ (value);
}

/** @param {unknown} value @returns {string} */
function absoluteInstant(value) {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value)
  ) {
    invalid();
  }
  const instant = new Date(/** @type {string} */ (value));
  if (Number.isNaN(instant.getTime())) invalid();
  return instant.toISOString();
}

/** @param {unknown} value @returns {string} */
function metaTimestamp(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value)) invalid();
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) invalid();
  const instant = new Date(seconds * 1000);
  if (Number.isNaN(instant.getTime())) invalid();
  return instant.toISOString();
}

/** @template T @param {T} value @returns {Readonly<T>} */
function immutableClone(value) {
  const clone = structuredClone(value);
  return deepFreeze(clone);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return /** @type {Readonly<T>} */ (value);
}

/**
 * @param {string} occurredAt
 * @param {string} receivedAt
 * @returns {'process'|'reconcile'}
 */
function dispositionFor(occurredAt, receivedAt) {
  return new Date(receivedAt).getTime() - new Date(occurredAt).getTime() >
    STALE_AFTER_MS
    ? 'reconcile'
    : 'process';
}

/**
 * @param {{
 *   accountId: string,
 *   message: unknown,
 *   phoneNumberId: string,
 *   receivedAt: string,
 * }} input
 */
function normalizeMessage(input) {
  const message = record(input.message);
  const externalMessageId = boundedString(message.id, 512);
  const senderId = boundedString(message.from, 512);
  const occurredAt = metaTimestamp(message.timestamp);
  const providerType = boundedString(message.type, 32);
  /** @type {'process'|'reconcile'} */
  let disposition = dispositionFor(occurredAt, input.receivedAt);
  let canonicalMessage;
  /** @type {null|{
   *   caption: string|null,
   *   externalId: string,
   *   mediaType: 'audio'|'document'|'image'|'video',
   *   mimeType: string|null,
   *   providerSha256: string|null,
   * }} */
  let media = null;

  if (providerType === 'text') {
    const text = record(message.text);
    canonicalMessage = {
      content: { text: nonEmptyString(text.body) },
      type: 'text',
    };
  } else if (MEDIA_TYPES.has(providerType)) {
    const providerMedia = record(message[providerType]);
    const caption = optionalString(providerMedia.caption);
    media = {
      caption,
      externalId: boundedString(providerMedia.id, 512),
      mediaType: /** @type {'audio'|'document'|'image'|'video'} */ (
        providerType
      ),
      mimeType: optionalBoundedString(providerMedia.mime_type, 255),
      providerSha256: optionalBoundedString(providerMedia.sha256, 128),
    };
    canonicalMessage = {
      content: { attachmentId: media.externalId, caption },
      type: providerType,
    };
  } else {
    disposition = 'reconcile';
    canonicalMessage = {
      content: { reasonCode: 'unsupported-message-type' },
      type: 'unsupported',
    };
  }

  const envelope = createCanonicalInboundEnvelope({
    channel: 'whatsapp',
    externalConversationId: senderId,
    externalEventId: externalMessageId,
    externalMessageId,
    identity: {
      automaticMergeAllowed: false,
      displayHandle: null,
      externalId: senderId,
      kind: 'phone',
      phoneStatus: 'confirmed',
    },
    message: canonicalMessage,
    occurredAt,
    origin: 'channel',
    provider: META_PROVIDER,
    providerAccountId: input.accountId,
    visibility: disposition === 'process' ? 'inbox' : 'reconciliation',
  });

  return {
    event: { disposition, envelope },
    media:
      media === null
        ? null
        : {
            caption: media.caption,
            expiresAt: resolveTransientMediaExpiresAt({
              mediaAt: input.receivedAt,
            }),
            externalEventId: envelope.externalEventId,
            externalMediaId: createScopedExternalId({
              externalId: media.externalId,
              provider: META_PROVIDER,
              providerAccountId: input.accountId,
            }),
            mediaType: media.mediaType,
            mimeType: media.mimeType,
            providerPhoneNumberId: input.phoneNumberId,
            providerSha256: media.providerSha256,
            receivedAt: input.receivedAt,
            state: 'metadata_only',
          },
  };
}

/**
 * Delivery status callbacks stay visible without becoming normal inbound
 * message work. Their compound external id is a JSON tuple, never a delimiter
 * based concatenation.
 *
 * @param {{accountId: string, receivedAt: string, status: unknown}} input
 */
function normalizeStatus(input) {
  const status = record(input.status);
  const providerMessageId = boundedString(status.id, 512);
  const providerStatus = boundedString(status.status, 64);
  const providerTimestamp = boundedString(status.timestamp, 64);
  const occurredAt = metaTimestamp(providerTimestamp);
  const recipientId = boundedString(status.recipient_id, 512);
  const externalEventId = JSON.stringify([
    'status',
    providerMessageId,
    providerStatus,
    providerTimestamp,
  ]);
  if (Buffer.byteLength(externalEventId) > 512) invalid();
  const envelope = createCanonicalInboundEnvelope({
    channel: 'whatsapp',
    externalConversationId: recipientId,
    externalEventId,
    externalMessageId: providerMessageId,
    identity: {
      automaticMergeAllowed: false,
      displayHandle: null,
      externalId: recipientId,
      kind: 'phone',
      phoneStatus: 'confirmed',
    },
    message: {
      content: { reasonCode: 'unsupported-provider-message' },
      type: 'unsupported',
    },
    occurredAt,
    origin: 'channel',
    provider: META_PROVIDER,
    providerAccountId: input.accountId,
    visibility: 'reconciliation',
  });

  return { disposition: 'reconcile', envelope };
}

/**
 * Normalizes an already authenticated Meta callback. Raw bytes, HMAC, UTF-8,
 * JSON, persistence and all I/O belong to the surrounding webhook boundary.
 * This function validates the complete parsed batch before returning anything.
 *
 * @param {{
 *   businessAccountId: string,
 *   callback: unknown,
 *   phoneNumberId: string,
 *   receivedAt: string,
 * }} input
 */
export function normalizeMetaWhatsAppWebhook(input) {
  try {
    const receivedAt = absoluteInstant(input?.receivedAt);
    const expectedAccountId = boundedString(input?.businessAccountId, 512);
    const expectedPhoneNumberId = boundedString(input?.phoneNumberId, 512);
    const callback = record(input?.callback);
    if (callback.object !== 'whatsapp_business_account') invalid();
    const entries = array(callback.entry);
    if (entries.length === 0) invalid();

    const events = [];
    const media = [];
    for (const entryValue of entries) {
      const entry = record(entryValue);
      const accountId = boundedString(entry.id, 512);
      if (accountId !== expectedAccountId) invalid();
      const changes = array(entry.changes);
      if (changes.length === 0) invalid();

      for (const changeValue of changes) {
        const change = record(changeValue);
        if (change.field !== 'messages') invalid();
        const value = record(change.value);
        if (
          value.messaging_product !== undefined &&
          value.messaging_product !== 'whatsapp'
        ) {
          invalid();
        }
        const metadata = record(value.metadata);
        const phoneNumberId = boundedString(metadata.phone_number_id, 512);
        if (phoneNumberId !== expectedPhoneNumberId) invalid();
        const messages =
          value.messages === undefined ? [] : array(value.messages);
        const statuses =
          value.statuses === undefined ? [] : array(value.statuses);
        if (messages.length === 0 && statuses.length === 0) invalid();

        for (const message of messages) {
          const normalized = normalizeMessage({
            accountId,
            message,
            phoneNumberId,
            receivedAt,
          });
          events.push(normalized.event);
          if (normalized.media !== null) media.push(normalized.media);
          if (
            events.length > MAX_EVENTS_PER_CALLBACK ||
            media.length > MAX_MEDIA_PER_CALLBACK
          ) {
            invalid();
          }
        }
        for (const status of statuses) {
          events.push(normalizeStatus({ accountId, receivedAt, status }));
          if (events.length > MAX_EVENTS_PER_CALLBACK) invalid();
        }
      }
    }

    return immutableClone({ events, media, receivedAt });
  } catch (error) {
    if (error instanceof MetaWhatsAppWebhookPayloadError) throw error;
    throw new MetaWhatsAppWebhookPayloadError();
  }
}

/**
 * Binds the single-tenant account scope at startup so every callback is
 * validated against the configured WABA and phone number before persistence.
 *
 * @param {{businessAccountId: string, phoneNumberId: string}} scope
 * @returns {(input: {callback: unknown, receivedAt: string}) => ReturnType<typeof normalizeMetaWhatsAppWebhook>}
 */
export function createMetaWhatsAppNormalizer(scope) {
  if (!scope || typeof scope !== 'object') {
    throw new TypeError('Meta WhatsApp account scope is required');
  }
  const businessAccountId = configuredId(
    scope.businessAccountId,
    'businessAccountId',
  );
  const phoneNumberId = configuredId(scope.phoneNumberId, 'phoneNumberId');
  return (input) =>
    normalizeMetaWhatsAppWebhook({
      ...input,
      businessAccountId,
      phoneNumberId,
    });
}

/** @param {unknown} value @param {string} field */
function configuredId(value, field) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim() ||
    Buffer.byteLength(value) > 512
  ) {
    throw new TypeError(`Meta WhatsApp ${field} must be a bounded identifier`);
  }
  return value;
}

export const META_WHATSAPP_MAX_EVENTS_PER_CALLBACK = MAX_EVENTS_PER_CALLBACK;
export const META_WHATSAPP_STALE_AFTER_HOURS = 24;
