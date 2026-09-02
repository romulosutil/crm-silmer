import { createHash } from 'node:crypto';

import {
  ContactIdentityForbiddenError,
  ContactIdentityValidationError,
} from './errors.js';

const HUMAN_FUNCTIONS = new Set(['Atendimento', 'Vendedor']);

/** @param {unknown} value @param {number} maximum */
export function requiredString(value, maximum) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim() ||
    Buffer.byteLength(value) > maximum
  ) {
    throw new ContactIdentityValidationError();
  }
  return value;
}

/** @param {unknown} value */
export function canonicalInstant(value) {
  const string = requiredString(value, 64);
  const instant = new Date(string);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== string) {
    throw new ContactIdentityValidationError();
  }
  return instant.toISOString();
}

/** @param {unknown} actor */
export function requireHumanOperator(actor) {
  if (
    actor === null ||
    typeof actor !== 'object' ||
    /** @type {Record<string, unknown>} */ (actor).kind !== 'human' ||
    !HUMAN_FUNCTIONS.has(
      String(/** @type {Record<string, unknown>} */ (actor).functionName),
    )
  ) {
    throw new ContactIdentityForbiddenError();
  }
  return {
    functionName: String(
      /** @type {Record<string, unknown>} */ (actor).functionName,
    ),
    id: requiredString(/** @type {Record<string, unknown>} */ (actor).id, 128),
    kind: 'human',
  };
}

/** @param {Record<string, unknown>} input */
export function normalizeInboundIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContactIdentityValidationError();
  }
  const provider = requiredString(input.provider, 64);
  if (provider !== provider.toLowerCase()) {
    throw new ContactIdentityValidationError();
  }
  const channel = requiredString(input.channel, 32);
  const identityKind = requiredString(input.identityKind, 32);
  const phoneStatus = requiredString(input.phoneStatus, 32);
  const displayHandle = input.displayHandle;
  if (
    (channel === 'instagram' &&
      (identityKind !== 'handle' ||
        phoneStatus !== 'pending' ||
        typeof displayHandle !== 'string' ||
        !/^@[A-Za-z0-9._]+$/u.test(displayHandle))) ||
    (channel === 'whatsapp' &&
      (identityKind !== 'phone' ||
        phoneStatus !== 'confirmed' ||
        displayHandle !== null)) ||
    !['instagram', 'whatsapp'].includes(channel)
  ) {
    throw new ContactIdentityValidationError();
  }
  if (typeof displayHandle === 'string') requiredString(displayHandle, 256);
  return Object.freeze({
    channel,
    correlationId: requiredString(input.correlationId, 128),
    displayHandle,
    externalIdentityId: requiredString(input.externalIdentityId, 512),
    identityKind,
    occurredAt: canonicalInstant(input.occurredAt),
    phoneStatus,
    provider,
    providerAccountId: requiredString(input.providerAccountId, 512),
  });
}

/**
 * @param {Record<string, unknown>} input
 * @param {'merge'|'unmerge'} operation
 * @returns {Readonly<Record<string, any>>}
 */
export function normalizeHumanCommand(input, operation) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContactIdentityValidationError();
  }
  const actor = requireHumanOperator(input.actor);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContactIdentityValidationError();
  }
  const normalized = {
    actor,
    correlationId: requiredString(input.correlationId, 128),
    expectedVersion,
    idempotencyKey: requiredString(input.idempotencyKey, 512),
    reason: requiredString(input.reason, 2048),
  };
  if (operation === 'merge') {
    return Object.freeze({
      ...normalized,
      identityId: requiredString(input.identityId, 128),
      targetContactId: requiredString(input.targetContactId, 128),
    });
  }
  return Object.freeze({
    ...normalized,
    linkId: requiredString(input.linkId, 128),
  });
}

/** @param {unknown[]} values */
export function commandFingerprint(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

/** @template T @param {T} value @returns {T} */
export function clone(value) {
  return structuredClone(value);
}
