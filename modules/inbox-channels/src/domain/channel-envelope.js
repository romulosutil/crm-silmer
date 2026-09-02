const CHANNELS = new Set(['instagram', 'whatsapp']);
const INBOUND_FIELDS = new Set([
  'channel',
  'externalConversationId',
  'externalEventId',
  'externalMessageId',
  'identity',
  'message',
  'occurredAt',
  'origin',
  'provider',
  'providerAccountId',
  'visibility',
]);
const IDENTITY_FIELDS = new Set([
  'automaticMergeAllowed',
  'displayHandle',
  'externalId',
  'kind',
  'phoneStatus',
]);
const MESSAGE_FIELDS = new Set(['content', 'type']);
const ATTACHMENT_CONTENT_FIELDS = new Set(['attachmentId', 'caption']);
const TEMPLATE_CONTENT_FIELDS = new Set(['templateKey', 'variables']);
const TEXT_CONTENT_FIELDS = new Set(['text']);
const UNSUPPORTED_CONTENT_FIELDS = new Set(['reasonCode']);
const UNSUPPORTED_REASON_CODES = new Set([
  'malformed-provider-event',
  'unsupported-message-type',
  'unsupported-provider-message',
]);
const OUTBOUND_FIELDS = new Set([
  'channel',
  'commandId',
  'externalConversationId',
  'message',
  'provider',
  'providerAccountId',
  'recipientExternalId',
]);

export class ChannelContractError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ChannelContractError';
    this.code = 'CHANNEL_CONTRACT_INVALID';
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

/** @param {unknown} value @param {string} field @returns {string} */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ChannelContractError(`${field} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new ChannelContractError(
      `${field} must not contain outer whitespace`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
function requireRecord(value, field) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ChannelContractError(`${field} must be a plain object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {Set<string>} allowed
 * @param {string} field
 */
function rejectUnknownFields(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ChannelContractError(`${field} has unknown fields`);
    }
  }
}

/** @param {unknown} value @returns {'instagram'|'whatsapp'} */
function requireChannel(value) {
  if (typeof value !== 'string' || !CHANNELS.has(value)) {
    throw new ChannelContractError('channel must be instagram or whatsapp');
  }
  return /** @type {'instagram'|'whatsapp'} */ (value);
}

/**
 * A collision-safe representation of an external identifier. Provider account
 * is part of the identity because different tenants can reuse the same ID.
 *
 * @param {{externalId: unknown, provider: unknown, providerAccountId: unknown}} input
 */
export function createScopedExternalId(input) {
  const provider = requireString(input.provider, 'provider');
  if (provider !== provider.toLowerCase()) {
    throw new ChannelContractError(
      'provider must use its lowercase canonical id',
    );
  }
  const providerAccountId = requireString(
    input.providerAccountId,
    'providerAccountId',
  );
  const externalId = requireString(input.externalId, 'externalId');
  return immutableClone({
    externalId,
    key: JSON.stringify([provider, providerAccountId, externalId]),
    provider,
    providerAccountId,
  });
}

/**
 * @param {unknown} value
 * @param {{provider: string, providerAccountId: string, channel: 'instagram'|'whatsapp'}} scope
 */
function canonicalIdentity(value, scope) {
  const identity = requireRecord(value, 'identity');
  rejectUnknownFields(identity, IDENTITY_FIELDS, 'identity');
  if (identity.automaticMergeAllowed !== false) {
    throw new ChannelContractError(
      'identity automatic merge must remain disabled without verified evidence',
    );
  }

  const kind = requireString(identity.kind, 'identity.kind');
  const phoneStatus = requireString(
    identity.phoneStatus,
    'identity.phoneStatus',
  );
  if (!['handle', 'phone'].includes(kind)) {
    throw new ChannelContractError('identity.kind must be handle or phone');
  }
  if (!['confirmed', 'pending'].includes(phoneStatus)) {
    throw new ChannelContractError(
      'identity.phoneStatus must be confirmed or pending',
    );
  }

  const displayHandle = identity.displayHandle;
  if (displayHandle !== null && typeof displayHandle !== 'string') {
    throw new ChannelContractError(
      'identity.displayHandle must be a string or null',
    );
  }
  if (
    scope.channel === 'instagram' &&
    (kind !== 'handle' ||
      phoneStatus !== 'pending' ||
      typeof displayHandle !== 'string' ||
      !/^@[A-Za-z0-9._]+$/u.test(displayHandle))
  ) {
    throw new ChannelContractError(
      'Instagram inbound identity must remain a pending @handle',
    );
  }
  if (
    scope.channel === 'whatsapp' &&
    (kind !== 'phone' || phoneStatus !== 'confirmed' || displayHandle !== null)
  ) {
    throw new ChannelContractError(
      'WhatsApp identity must use a confirmed phone and no display handle',
    );
  }

  return {
    automaticMergeAllowed: false,
    displayHandle,
    externalId: createScopedExternalId({
      externalId: identity.externalId,
      provider: scope.provider,
      providerAccountId: scope.providerAccountId,
    }),
    kind,
    mergePolicy: 'verified-evidence-only',
    phoneStatus,
  };
}

/** @param {unknown} value @param {'inbound'|'outbound'} direction */
function canonicalMessage(value, direction) {
  const message = requireRecord(value, 'message');
  rejectUnknownFields(message, MESSAGE_FIELDS, 'message');
  const type = requireString(message.type, 'message.type');
  const content = requireRecord(message.content, 'message.content');
  const allowedTypes =
    direction === 'inbound'
      ? ['audio', 'document', 'image', 'text', 'unsupported', 'video']
      : ['audio', 'document', 'image', 'template', 'text', 'video'];
  if (!allowedTypes.includes(type)) {
    throw new ChannelContractError(
      `message.type is not supported for ${direction}`,
    );
  }

  if (type === 'text') {
    rejectUnknownFields(content, TEXT_CONTENT_FIELDS, 'message.content');
    return {
      content: { text: requireString(content.text, 'message.content.text') },
      type,
    };
  }
  if (type === 'template') {
    rejectUnknownFields(content, TEMPLATE_CONTENT_FIELDS, 'message.content');
    const variables = content.variables ?? [];
    if (
      !Array.isArray(variables) ||
      variables.some((variable) => typeof variable !== 'string')
    ) {
      throw new ChannelContractError(
        'message.content.variables must be an array of strings',
      );
    }
    return {
      content: {
        templateKey: requireString(
          content.templateKey,
          'message.content.templateKey',
        ),
        variables: structuredClone(variables),
      },
      type,
    };
  }
  if (type === 'unsupported') {
    rejectUnknownFields(content, UNSUPPORTED_CONTENT_FIELDS, 'message.content');
    const reasonCode = requireString(
      content.reasonCode,
      'message.content.reasonCode',
    );
    if (!UNSUPPORTED_REASON_CODES.has(reasonCode)) {
      throw new ChannelContractError(
        'message.content.reasonCode must be a canonical code',
      );
    }
    return {
      content: {
        reasonCode,
      },
      type,
    };
  }

  rejectUnknownFields(content, ATTACHMENT_CONTENT_FIELDS, 'message.content');
  const caption = content.caption ?? null;
  if (caption !== null && typeof caption !== 'string') {
    throw new ChannelContractError(
      'message.content.caption must be a string or null',
    );
  }
  return {
    content: {
      attachmentId: requireString(
        content.attachmentId,
        'message.content.attachmentId',
      ),
      caption,
    },
    type,
  };
}

/**
 * Validates the provider-neutral message emitted by a channel-specific inbound
 * adapter. Provider payload parsing and persistence belong to later tasks.
 *
 * @param {unknown} input
 */
export function createCanonicalInboundEnvelope(input) {
  const record = requireRecord(input, 'inbound envelope');
  rejectUnknownFields(record, INBOUND_FIELDS, 'inbound envelope');
  const provider = requireString(record.provider, 'provider');
  if (provider !== provider.toLowerCase()) {
    throw new ChannelContractError(
      'provider must use its lowercase canonical id',
    );
  }
  const providerAccountId = requireString(
    record.providerAccountId,
    'providerAccountId',
  );
  const channel = requireChannel(record.channel);
  const origin = requireString(record.origin, 'origin');
  if (!['channel', 'site'].includes(origin)) {
    throw new ChannelContractError('origin must be channel or site');
  }
  if (origin === 'site' && channel !== 'whatsapp') {
    throw new ChannelContractError(
      'site origin must keep WhatsApp as the conversation channel',
    );
  }
  const visibility = requireString(record.visibility, 'visibility');
  if (!['inbox', 'reconciliation'].includes(visibility)) {
    throw new ChannelContractError(
      'visibility must be inbox or reconciliation',
    );
  }
  const occurredAt = requireString(record.occurredAt, 'occurredAt');
  if (
    !Number.isFinite(Date.parse(occurredAt)) ||
    new Date(occurredAt).toISOString() !== occurredAt
  ) {
    throw new ChannelContractError(
      'occurredAt must be a canonical ISO instant',
    );
  }
  const scope = { channel, provider, providerAccountId };
  const message = canonicalMessage(record.message, 'inbound');
  if (message.type === 'unsupported' && visibility !== 'reconciliation') {
    throw new ChannelContractError(
      'unsupported messages must remain visible in reconciliation',
    );
  }

  return immutableClone({
    schemaVersion: 1,
    direction: 'inbound',
    provider,
    providerAccountId,
    channel,
    externalEventId: createScopedExternalId({
      externalId: record.externalEventId,
      provider,
      providerAccountId,
    }),
    externalMessageId: createScopedExternalId({
      externalId: record.externalMessageId,
      provider,
      providerAccountId,
    }),
    externalConversationId: createScopedExternalId({
      externalId: record.externalConversationId,
      provider,
      providerAccountId,
    }),
    occurredAt,
    origin,
    visibility,
    identity: canonicalIdentity(record.identity, scope),
    message,
  });
}

/**
 * Validates a provider-neutral outbound command. A concrete adapter translates
 * this envelope to its provider format in a later task.
 *
 * @param {unknown} input
 */
export function createCanonicalOutboundEnvelope(input) {
  const record = requireRecord(input, 'outbound envelope');
  rejectUnknownFields(record, OUTBOUND_FIELDS, 'outbound envelope');
  const provider = requireString(record.provider, 'provider');
  if (provider !== provider.toLowerCase()) {
    throw new ChannelContractError(
      'provider must use its lowercase canonical id',
    );
  }
  const providerAccountId = requireString(
    record.providerAccountId,
    'providerAccountId',
  );
  const channel = requireChannel(record.channel);

  return immutableClone({
    schemaVersion: 1,
    direction: 'outbound',
    provider,
    providerAccountId,
    channel,
    commandId: requireString(record.commandId, 'commandId'),
    externalConversationId: createScopedExternalId({
      externalId: record.externalConversationId,
      provider,
      providerAccountId,
    }),
    recipientExternalId: createScopedExternalId({
      externalId: record.recipientExternalId,
      provider,
      providerAccountId,
    }),
    message: canonicalMessage(record.message, 'outbound'),
  });
}
