import { createHmac, timingSafeEqual } from 'node:crypto';

/* global fetch */

export class MetaWebhookAuthenticationError extends Error {
  constructor() {
    super('Meta webhook signature is invalid');
    this.name = 'MetaWebhookAuthenticationError';
    this.code = 'META_WEBHOOK_SIGNATURE_INVALID';
  }
}

export class MetaWebhookPayloadError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MetaWebhookPayloadError';
    this.code = 'META_WEBHOOK_PAYLOAD_INVALID';
  }
}

export class MetaApiError extends Error {
  /**
   * @param {string} code
   * @param {number} statusCode
   * @param {{dispatchProvenAbsent?: boolean}} [options]
   */
  constructor(code, statusCode, options = {}) {
    super(`Meta API rejected the request with ${code}`);
    this.name = 'MetaApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.dispatchProvenAbsent = options.dispatchProvenAbsent ?? false;
  }
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

/** @param {unknown} value @param {string} field */
function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * @param {Buffer} rawBody
 * @param {unknown} signature
 * @param {string} appSecret
 */
export function verifyMetaWebhookSignature(rawBody, signature, appSecret) {
  requireNonEmpty(appSecret, 'appSecret');
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') {
    throw new MetaWebhookAuthenticationError();
  }
  const match = /^sha256=([a-f0-9]{64})$/iu.exec(signature);
  if (!match) throw new MetaWebhookAuthenticationError();

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const actual = Buffer.from(match[1], 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new MetaWebhookAuthenticationError();
  }
}

/** @typedef {{ key: string, value: Readonly<Record<string, string>> }} MetaEvent */

/** @param {unknown} payload @returns {MetaEvent[]} */
function extractMetaEvents(payload) {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    /** @type {{object?: unknown}} */ (payload).object !==
      'whatsapp_business_account'
  ) {
    throw new MetaWebhookPayloadError('Unexpected Meta webhook object');
  }

  const events = [];
  const entries = /** @type {{entry?: unknown[]}} */ (payload).entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== 'object') continue;
    const accountId = String(
      /** @type {{id?: unknown}} */ (entry).id ?? 'unknown-account',
    );
    const changes = /** @type {{changes?: unknown[]}} */ (entry).changes;
    for (const change of Array.isArray(changes) ? changes : []) {
      if (change === null || typeof change !== 'object') continue;
      const value = /** @type {{value?: unknown}} */ (change).value;
      if (value === null || typeof value !== 'object') continue;
      const envelope =
        /** @type {{
         * metadata?: {phone_number_id?: unknown},
         * messages?: unknown[],
         * statuses?: unknown[],
         * }} */ (value);
      const phoneNumberId = String(
        envelope.metadata?.phone_number_id ?? 'unknown-phone',
      );

      for (const message of Array.isArray(envelope.messages)
        ? envelope.messages
        : []) {
        if (message === null || typeof message !== 'object') continue;
        const item =
          /** @type {{id?: unknown, timestamp?: unknown, type?: unknown}} */ (
            message
          );
        if (typeof item.id !== 'string' || item.id === '') continue;
        events.push({
          key: `${accountId}:${phoneNumberId}:message:${item.id}`,
          value: immutableClone({
            accountId,
            eventId: item.id,
            eventType: 'message',
            messageType: String(item.type ?? 'unknown'),
            occurredAt: String(item.timestamp ?? ''),
            phoneNumberId,
          }),
        });
      }

      for (const statusEvent of Array.isArray(envelope.statuses)
        ? envelope.statuses
        : []) {
        if (statusEvent === null || typeof statusEvent !== 'object') continue;
        const item =
          /** @type {{id?: unknown, status?: unknown, timestamp?: unknown}} */ (
            statusEvent
          );
        if (
          typeof item.id !== 'string' ||
          item.id === '' ||
          typeof item.status !== 'string' ||
          item.status === ''
        ) {
          continue;
        }
        const occurredAt = String(item.timestamp ?? '');
        events.push({
          key: `${accountId}:${phoneNumberId}:status:${item.id}:${item.status}:${occurredAt}`,
          value: immutableClone({
            accountId,
            eventId: `${item.id}:${item.status}:${occurredAt}`,
            eventType: 'status',
            occurredAt,
            phoneNumberId,
            providerMessageId: item.id,
            status: item.status,
          }),
        });
      }
    }
  }
  return events;
}

export class InMemoryMetaEventStore {
  /** @type {Map<string, Readonly<Record<string, string>>>} */
  #events = new Map();

  /** @param {MetaEvent} event @returns {Promise<boolean>} */
  async accept(event) {
    if (this.#events.has(event.key)) return false;
    this.#events.set(event.key, immutableClone(event.value));
    return true;
  }

  async list() {
    return immutableClone([...this.#events.values()]);
  }
}

/**
 * @param {{
 *   appSecret: string,
 *   eventStore: {accept(event: MetaEvent): Promise<boolean>},
 *   onEvent: (event: Readonly<Record<string, string>>) => Promise<void>,
 *   rawBody: Buffer,
 *   signature: unknown,
 * }} input
 */
export async function processMetaWebhook(input) {
  verifyMetaWebhookSignature(input.rawBody, input.signature, input.appSecret);
  let payload;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    throw new MetaWebhookPayloadError('Meta webhook body is not valid JSON');
  }

  const events = extractMetaEvents(payload);
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    if (await input.eventStore.accept(event)) {
      accepted += 1;
      await input.onEvent(event.value);
    } else {
      duplicates += 1;
    }
  }
  return { accepted, duplicates, received: events.length };
}

/**
 * @param {{
 *   accessToken: string,
 *   fetch?: typeof fetch,
 *   graphApiVersion: string,
 *   phoneNumberId: string,
 * }} options
 */
export function createMetaMessagesClient(options) {
  requireNonEmpty(options.accessToken, 'accessToken');
  requireNonEmpty(options.graphApiVersion, 'graphApiVersion');
  requireNonEmpty(options.phoneNumberId, 'phoneNumberId');
  if (!/^v\d+\.0$/u.test(options.graphApiVersion)) {
    throw new TypeError('graphApiVersion must look like v25.0');
  }
  const request = options.fetch ?? fetch;
  const url = `https://graph.facebook.com/${options.graphApiVersion}/${options.phoneNumberId}/messages`;

  return Object.freeze({
    /**
     * @param {{to: string, type: string} & Record<string, unknown>} message
     */
    async send(message) {
      requireNonEmpty(message.to, 'message.to');
      requireNonEmpty(message.type, 'message.type');
      const response = await request(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...message,
        }),
      });
      if (!response.ok) {
        let code = `HTTP_${response.status}`;
        try {
          const body = await response.json();
          const providerCode = body?.error?.code;
          if (
            typeof providerCode === 'number' ||
            typeof providerCode === 'string'
          ) {
            code = `META_${providerCode}`;
          }
        } catch {
          // The status code remains sufficient and does not copy response content.
        }
        const dispatchProvenAbsent =
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status);
        throw new MetaApiError(code, response.status, {
          dispatchProvenAbsent,
        });
      }
      const body = await response.json();
      const providerMessageId = body?.messages?.[0]?.id;
      if (typeof providerMessageId !== 'string' || providerMessageId === '') {
        throw new MetaApiError('META_RESPONSE_MISSING_WAMID', response.status);
      }
      return { providerMessageId };
    },
  });
}

/**
 * @param {{
 *   dispatch: () => Promise<{providerMessageId: string}>,
 *   fault?: 'before-dispatch'|'after-acceptance',
 * }} input
 */
export async function runMetaSendAttempt(input) {
  if (input.fault === 'before-dispatch') {
    return {
      automaticRetry: false,
      dispatchProvenAbsent: true,
      status: 'failed',
    };
  }

  let result;
  try {
    result = await input.dispatch();
  } catch (error) {
    if (error instanceof MetaApiError && error.dispatchProvenAbsent) {
      return {
        automaticRetry: false,
        dispatchProvenAbsent: true,
        status: 'failed',
      };
    }
    return {
      automaticRetry: false,
      dispatchProvenAbsent: false,
      status: 'outcome_unknown',
    };
  }

  if (input.fault === 'after-acceptance') {
    return {
      automaticRetry: false,
      dispatchProvenAbsent: false,
      status: 'outcome_unknown',
    };
  }
  return {
    automaticRetry: false,
    dispatchProvenAbsent: false,
    providerMessageId: result.providerMessageId,
    status: 'sent',
  };
}
