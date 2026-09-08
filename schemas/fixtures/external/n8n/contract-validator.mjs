const commonEnvelopeKeys = Object.freeze(['schema_version']);
const automaticEnvelopeKeys = Object.freeze([
  ...commonEnvelopeKeys,
  'automation_epoch',
]);

const inboundKeys = Object.freeze([
  ...commonEnvelopeKeys,
  'channel',
  'contact',
  'event_id',
  'message',
  'metadata',
  'occurred_at',
]);

const attachmentKeys = Object.freeze([
  ...commonEnvelopeKeys,
  'content_sha256',
  'conversation_id',
  'external_id',
  'filename',
  'message_external_id',
  'mime_type',
  'size_bytes',
]);

const claimKeys = Object.freeze([
  ...automaticEnvelopeKeys,
  'claim_id',
  'conversation_id',
  'last_event_id',
  'revision',
  'worker_id',
]);

const eventKeys = Object.freeze([
  ...automaticEnvelopeKeys,
  'ai_model',
  'ai_provider',
  'attempt_id',
  'claim_id',
  'claim_token',
  'command_id',
  'conversation_id',
  'event_id',
  'event_type',
  'expected_version',
  'external_message_id',
  'failure',
  'handoff',
  'lead_patch',
  'message',
  'occurred_at',
  'prompt_version',
  'revision',
  'status',
]);

export class ContractValidationError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'ContractValidationError';
    this.code = code;
  }
}

/** @param {any} contract */
export function validateContract(contract) {
  object(contract, 'INVALID_CONTRACT');
  if (contract.schemaVersion !== '1.0') fail('UNSUPPORTED_SCHEMA_VERSION');
  if (contract.authentication?.scheme !== 'Basic') {
    fail('UNSUPPORTED_AUTHENTICATION_SCHEME');
  }
  if (contract.errorMediaType !== 'application/problem+json') {
    fail('INVALID_ERROR_MEDIA_TYPE');
  }
  exactMembers(
    contract.channels,
    ['whatsapp', 'instagram'],
    'INVALID_CHANNELS',
  );
  exactMembers(
    contract.activeChannels,
    ['whatsapp'],
    'INVALID_ACTIVE_CHANNELS',
  );
  if (!Array.isArray(contract.endpoints) || contract.endpoints.length !== 4) {
    fail('INVALID_ENDPOINT_COUNT');
  }
  const routes = new Set();
  for (const endpoint of contract.endpoints) {
    if (endpoint.method !== 'POST' || !opaque(endpoint.path)) {
      fail('INVALID_ENDPOINT');
    }
    const route = `${endpoint.method} ${endpoint.path}`;
    if (routes.has(route)) fail('DUPLICATE_ENDPOINT');
    routes.add(route);
  }
  for (const required of [
    'authorization',
    'idempotency-key',
    'x-correlation-id',
    'x-silmer-workflow-key',
    'x-silmer-workflow-version',
    'x-silmer-execution-id',
  ]) {
    if (!contract.requiredHeaders?.includes(required)) {
      fail('MISSING_REQUIRED_HEADER');
    }
  }
  if (!contract.eventTypes?.includes('message.send.requested')) {
    fail('MISSING_SEND_FENCE_EVENT');
  }
  return true;
}

/** @param {any} headers @param {any} contract @param {any} [payload] */
export function validateHeaders(headers, contract, payload) {
  object(headers, 'INVALID_HEADERS');
  for (const header of contract.requiredHeaders) {
    nonEmpty(headers[header], 'MISSING_REQUIRED_HEADER');
  }
  if (!/^Basic [A-Za-z0-9+/]+={0,2}$/u.test(headers.authorization)) {
    fail('INVALID_AUTOMATION_CREDENTIALS');
  }
  if (
    payload !== undefined &&
    headers['x-correlation-id'] !== payload.correlation_id
  ) {
    fail('CORRELATION_ID_MISMATCH');
  }
  return true;
}

/** @param {any} payload @param {any} contract */
export function validateInbound(payload, contract) {
  object(payload, 'INVALID_INBOUND');
  rejectUnknown(payload, inboundKeys);
  common(payload);
  if (!contract.channels.includes(payload.channel)) fail('UNSUPPORTED_CHANNEL');
  for (const field of ['event_id', 'occurred_at']) {
    nonEmpty(payload[field], 'INVALID_INBOUND');
  }
  object(payload.contact, 'INVALID_CONTACT');
  rejectUnknown(payload.contact, ['display_name', 'external_id']);
  nonEmpty(payload.contact.external_id, 'INVALID_CONTACT');
  object(payload.message, 'INVALID_MESSAGE');
  rejectUnknown(payload.message, [
    'attachment',
    'external_id',
    'reply_to',
    'text',
    'type',
  ]);
  nonEmpty(payload.message.external_id, 'INVALID_MESSAGE');
  nonEmpty(payload.message.type, 'INVALID_MESSAGE');
  object(payload.metadata, 'INVALID_INBOUND_METADATA');
  rejectUnknown(payload.metadata, ['provider_account_id']);
  nonEmpty(payload.metadata.provider_account_id, 'INVALID_INBOUND_METADATA');
  return true;
}

/** @param {any} payload @param {any} contract */
export function assertChannelActive(payload, contract) {
  if (!contract.activeChannels.includes(payload.channel)) {
    fail('CHANNEL_NOT_ACTIVE');
  }
  return true;
}

/** @param {any} payload */
export function validateAttachmentMetadata(payload) {
  object(payload, 'INVALID_ATTACHMENT');
  rejectUnknown(payload, attachmentKeys);
  common(payload);
  for (const field of [
    'content_sha256',
    'conversation_id',
    'external_id',
    'filename',
    'message_external_id',
    'mime_type',
  ]) {
    nonEmpty(payload[field], 'INVALID_ATTACHMENT');
  }
  if (!/^[0-9a-f]{64}$/u.test(payload.content_sha256)) {
    fail('INVALID_CONTENT_SHA256');
  }
  if (!Number.isSafeInteger(payload.size_bytes) || payload.size_bytes < 0) {
    fail('INVALID_ATTACHMENT_SIZE');
  }
  if (
    payload.filename.includes('/') ||
    payload.filename.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(payload.filename)
  ) {
    fail('UNSAFE_FILENAME');
  }
  return true;
}

/** @param {any} payload */
export function validateClaimRequest(payload) {
  object(payload, 'INVALID_CLAIM');
  rejectUnknown(payload, claimKeys);
  common(payload, true);
  for (const field of [
    'claim_id',
    'conversation_id',
    'last_event_id',
    'worker_id',
  ]) {
    nonEmpty(payload[field], 'INVALID_CLAIM');
  }
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 1) {
    fail('INVALID_CLAIM');
  }
  return true;
}

/** @param {any} payload */
export function validateClaimResponse(payload) {
  object(payload, 'INVALID_CLAIM_RESPONSE');
  rejectUnknown(payload, [
    'automation_epoch',
    'claim_id',
    'claim_token',
    'claimed',
    'conversation_id',
    'conversation_version',
    'lease_expires_at',
    'revision',
  ]);
  if (payload.claimed !== true) fail('INVALID_CLAIM_RESPONSE');
  for (const field of [
    'claim_id',
    'claim_token',
    'conversation_id',
    'lease_expires_at',
  ]) {
    nonEmpty(payload[field], 'INVALID_CLAIM_RESPONSE');
  }
  epoch(payload.automation_epoch);
  return true;
}

/** @param {any} payload @param {any} contract */
export function validateEvent(payload, contract) {
  object(payload, 'INVALID_EVENT');
  rejectUnknown(payload, eventKeys);
  common(payload, true);
  for (const field of [
    'conversation_id',
    'event_id',
    'event_type',
    'occurred_at',
  ]) {
    nonEmpty(payload[field], 'INVALID_EVENT');
  }
  if (!contract.eventTypes.includes(payload.event_type)) {
    fail('UNSUPPORTED_EVENT_TYPE');
  }
  if (payload.event_type === 'message.send.requested') {
    for (const field of ['claim_id', 'claim_token', 'command_id']) {
      nonEmpty(payload[field], 'INVALID_SEND_FENCE');
    }
    for (const field of ['expected_version', 'revision']) {
      if (!Number.isSafeInteger(payload[field]) || payload[field] < 1) {
        fail('INVALID_SEND_FENCE');
      }
    }
    object(payload.message, 'INVALID_SEND_FENCE');
  }
  if (payload.lead_patch !== undefined) {
    validateBriefingPatch(payload.lead_patch, contract);
  }
  return true;
}

/** @param {any} patch @param {any} contract */
export function validateBriefingPatch(patch, contract) {
  object(patch, 'INVALID_BRIEFING_PATCH');
  rejectUnknown(patch, contract.briefingPatchFields);
  return true;
}

/** @param {any} problem */
export function validateProblem(problem) {
  object(problem, 'INVALID_PROBLEM');
  rejectUnknown(problem, [
    'accepted',
    'correlation_id',
    'detail',
    'error',
    'instance',
    'request_id',
    'status',
    'title',
    'type',
  ]);
  for (const field of ['detail', 'instance', 'request_id', 'title', 'type']) {
    nonEmpty(problem[field], 'INVALID_PROBLEM');
  }
  if (problem.accepted !== false) fail('INVALID_PROBLEM');
  object(problem.error, 'INVALID_PROBLEM');
  rejectUnknown(problem.error, ['code']);
  nonEmpty(problem.error.code, 'INVALID_PROBLEM');
  if (!Number.isSafeInteger(problem.status) || problem.status < 400) {
    fail('INVALID_PROBLEM');
  }
  return true;
}

/** @param {any} payload @param {boolean} [requiresEpoch] */
function common(payload, requiresEpoch = false) {
  if (payload.schema_version !== '1.0') fail('UNSUPPORTED_SCHEMA_VERSION');
  if (requiresEpoch) epoch(payload.automation_epoch);
}

/** @param {any} value */
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_AUTOMATION_EPOCH');
  }
}

/** @param {Record<string, unknown>} value @param {readonly string[]} allowed */
function rejectUnknown(value, allowed) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) fail(`UNKNOWN_FIELD:${key}`);
  }
}

/** @param {any} actual @param {readonly any[]} expected @param {string} code */
function exactMembers(actual, expected, code) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(code);
  }
}

/** @param {any} value @param {string} code */
function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
}

/** @param {any} value @param {string} code */
function nonEmpty(value, code) {
  if (!opaque(value)) fail(code);
}

/** @param {any} value */
function opaque(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** @param {string} code @returns {never} */
function fail(code) {
  throw new ContractValidationError(code);
}
