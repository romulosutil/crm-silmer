/**
 * @typedef {{ type: string, id: string }} AuditTarget
 * @typedef {{
 *   actor: string,
 *   action: string,
 *   target: AuditTarget,
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * } & Record<string, unknown>} AuditEventInput
 * @typedef {{
 *   id: string,
 *   actor: string,
 *   action: string,
 *   target: AuditTarget,
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 *   occurredAt: string,
 * }} AuditEvent
 */

export class AuditEventValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AuditEventValidationError';
    this.code = 'INVALID_AUDIT_EVENT';
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function immutableClone(value) {
  const clone = structuredClone(value);
  return deepFreeze(clone);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AuditEventValidationError(`${field} must be a non-empty string`);
  }
}

/** @param {AuditEventInput} input */
function validateAuditEvent(input) {
  requireNonEmptyString(input.actor, 'actor');
  requireNonEmptyString(input.action, 'action');
  requireNonEmptyString(input.reason, 'reason');
  requireNonEmptyString(input.correlationId, 'correlationId');
  if (input.target === null || typeof input.target !== 'object') {
    throw new AuditEventValidationError('target must identify a type and id');
  }
  requireNonEmptyString(input.target.type, 'target.type');
  requireNonEmptyString(input.target.id, 'target.id');
  if (
    (typeof input.version !== 'string' && typeof input.version !== 'number') ||
    input.version === '' ||
    (typeof input.version === 'number' && !Number.isFinite(input.version))
  ) {
    throw new AuditEventValidationError('version must be a string or number');
  }
}

export class InMemoryAuditTrail {
  /** @type {AuditEvent[]} */
  #events = [];

  /** @type {() => Date} */
  #clock;

  /** @type {() => string} */
  #idFactory;

  /**
   * @param {{ clock?: () => Date, idFactory?: () => string }} [options]
   */
  constructor(options = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  /**
   * The adapter deliberately has no update/delete operation. Inputs are
   * projected onto the allowed envelope so content and secrets cannot leak
   * into business evidence through incidental properties.
   *
   * @param {AuditEventInput} input
   * @returns {Promise<Readonly<AuditEvent>>}
   */
  async append(input) {
    validateAuditEvent(input);
    const event = /** @type {AuditEvent} */ ({
      id: this.#idFactory(),
      actor: input.actor,
      action: input.action,
      target: { type: input.target.type, id: input.target.id },
      version: input.version,
      reason: input.reason,
      correlationId: input.correlationId,
      occurredAt: this.#clock().toISOString(),
    });
    const stored = immutableClone(event);
    this.#events.push(stored);
    return immutableClone(stored);
  }

  /** @returns {Promise<ReadonlyArray<Readonly<AuditEvent>>>} */
  async list() {
    return immutableClone(this.#events);
  }
}
import { randomUUID } from 'node:crypto';
