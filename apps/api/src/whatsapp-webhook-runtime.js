import { TextDecoder } from 'node:util';

import {
  MetaWebhookPayloadError,
  verifyMetaWebhookSignature,
} from '@crm-silmer/integration-reliability';

export const WEBHOOK_BODY_LIMIT_BYTES = 1_048_576;

/**
 * @typedef {{
 *   declaredMimeType: string|null,
 *   externalMediaId: string,
 *   mediaType: 'audio'|'document'|'image'|'video',
 *   providerSha256: string|null,
 * }} WebhookMediaDescriptor
 * @typedef {{
 *   disposition: 'process'|'reconcile',
 *   event: Readonly<Record<string, unknown>>,
 *   media: readonly WebhookMediaDescriptor[],
 * }} NormalizedWebhookEvent
 * @typedef {{
 *   persistBatch(input: {
 *     correlationId: string,
 *     events: readonly NormalizedWebhookEvent[],
 *     rawBody: Buffer,
 *     receivedAt: string,
 *   }): Promise<{accepted: number, duplicates: number, reconciliation: number}>
 * }} WebhookInbox
 */

/**
 * Authenticates and validates a callback before opening the durable inbox
 * transaction. Network effects and media downloads are intentionally absent.
 *
 * @param {{
 *   appSecret: string,
 *   clock?: () => Date,
 *   inbox: WebhookInbox,
 *   normalize: (input: {callback: unknown, receivedAt: string}) => {
 *     events: readonly {disposition: string, envelope: Readonly<Record<string, any>>}[],
 *     media: readonly Readonly<{
 *       externalEventId: {key: string},
 *       externalMediaId: {externalId: string},
 *       mediaType: 'audio'|'document'|'image'|'video',
 *       mimeType: string|null,
 *       providerSha256: string|null,
 *     }>[],
 *   },
 *   verifyToken: string,
 * }} options
 */
export function createWhatsAppWebhookRuntime({
  appSecret,
  clock = () => new Date(),
  inbox,
  normalize,
  verifyToken,
}) {
  requireSecret(appSecret, 'META_APP_SECRET');
  requireSecret(verifyToken, 'META_VERIFY_TOKEN');
  if (!inbox || typeof inbox.persistBatch !== 'function') {
    throw new TypeError('A durable webhook inbox is required');
  }
  if (typeof normalize !== 'function') {
    throw new TypeError('A WhatsApp webhook normalizer is required');
  }

  return Object.freeze({
    verifyToken,
    /**
     * @param {{correlationId: string, rawBody: Buffer, signature: unknown}} input
     */
    async process({ correlationId, rawBody, signature }) {
      requireCorrelationId(correlationId);
      verifyMetaWebhookSignature(rawBody, signature, appSecret);
      const payload = parseAuthenticatedPayload(rawBody);
      const instant = clock();
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
        throw new TypeError('Webhook clock must return a valid Date');
      }
      const receivedAt = instant.toISOString();
      let normalized;
      try {
        normalized = normalize({ callback: payload, receivedAt });
      } catch {
        throw new MetaWebhookPayloadError(
          'Meta webhook body does not match the supported schema',
        );
      }
      const events = composeInboxEvents(normalized);
      if (events.length === 0) {
        throw new MetaWebhookPayloadError(
          'Meta webhook must contain at least one canonical event',
        );
      }

      const receipt = await inbox.persistBatch({
        correlationId,
        events,
        rawBody,
        receivedAt,
      });
      return Object.freeze({
        accepted: receipt.accepted,
        duplicates: receipt.duplicates,
        received: events.length,
        reconciliation: receipt.reconciliation,
      });
    },
  });
}

/**
 * @param {{
 *   events: readonly {disposition: string, envelope: Readonly<Record<string, any>>}[],
 *   media: readonly Readonly<{
 *     externalEventId: {key: string},
 *     externalMediaId: {externalId: string},
 *     mediaType: 'audio'|'document'|'image'|'video',
 *     mimeType: string|null,
 *     providerSha256: string|null,
 *   }>[],
 * }} normalized
 * @returns {readonly NormalizedWebhookEvent[]}
 */
function composeInboxEvents(normalized) {
  if (
    !normalized ||
    !Array.isArray(normalized.events) ||
    !Array.isArray(normalized.media)
  ) {
    throw new MetaWebhookPayloadError(
      'Meta webhook normalizer returned an invalid batch',
    );
  }
  const eventKeys = new Set(
    normalized.events.map(({ envelope }) => envelope?.externalEventId?.key),
  );
  if (
    eventKeys.has(undefined) ||
    normalized.media.some((item) => !eventKeys.has(item.externalEventId?.key))
  ) {
    throw new MetaWebhookPayloadError(
      'Meta webhook media metadata is not linked to its canonical event',
    );
  }
  return normalized.events.map(({ disposition, envelope }) => {
    if (disposition !== 'process' && disposition !== 'reconcile') {
      throw new MetaWebhookPayloadError(
        'Meta webhook event has an invalid disposition',
      );
    }
    const eventKey = envelope?.externalEventId?.key;
    return Object.freeze({
      disposition,
      event: envelope,
      media: Object.freeze(
        normalized.media
          .filter((item) => item.externalEventId?.key === eventKey)
          .map((item) =>
            Object.freeze({
              declaredMimeType: item.mimeType,
              externalMediaId: item.externalMediaId?.externalId,
              mediaType: item.mediaType,
              providerSha256: item.providerSha256,
            }),
          ),
      ),
    });
  });
}

/** @param {Buffer} rawBody */
function parseAuthenticatedPayload(rawBody) {
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  } catch {
    throw new MetaWebhookPayloadError('Meta webhook body is not valid UTF-8');
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new MetaWebhookPayloadError('Meta webhook body is not valid JSON');
  }
}

/** @param {unknown} value @param {string} name */
function requireSecret(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required`);
  }
}

/** @param {unknown} value */
function requireCorrelationId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('A correlation id is required');
  }
}
