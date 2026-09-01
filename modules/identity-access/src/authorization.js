export const CAPABILITIES = Object.freeze({
  COMMERCIAL_ADMIN: 'COMMERCIAL_ADMIN',
  PRIVACY_OFFICER: 'PRIVACY_OFFICER',
  TECHNICAL_PRIVACY_EXECUTOR: 'TECHNICAL_PRIVACY_EXECUTOR',
});

/**
 * @typedef {'COMMERCIAL_ADMIN'|'PRIVACY_OFFICER'|'TECHNICAL_PRIVACY_EXECUTOR'} Capability
 * @typedef {'Atendimento'|'Vendedor'} OperationalFunction
 */

const operationalActions = new Set([
  'conversation.read',
  'deal.draft.edit',
  'deal.draft.read',
]);
/** @type {Map<string, Capability>} */
const actionCapabilities = new Map([
  ['order-form.approve', CAPABILITIES.COMMERCIAL_ADMIN],
  ['order-form.cancel', CAPABILITIES.COMMERCIAL_ADMIN],
  ['order-form.resend', CAPABILITIES.COMMERCIAL_ADMIN],
  ['order-form.retry', CAPABILITIES.COMMERCIAL_ADMIN],
  ['order-form.send', CAPABILITIES.COMMERCIAL_ADMIN],
  ['quote.approve', CAPABILITIES.COMMERCIAL_ADMIN],
  ['sale.approve', CAPABILITIES.COMMERCIAL_ADMIN],
  ['privacy.legal-hold.authorize', CAPABILITIES.PRIVACY_OFFICER],
  ['privacy.retention.execute', CAPABILITIES.TECHNICAL_PRIVACY_EXECUTOR],
]);
/** @type {Set<Capability>} */
const knownCapabilities = new Set(Object.values(CAPABILITIES));
/** @type {Set<Capability>} */
const mfaRequiredCapabilities = new Set([
  CAPABILITIES.COMMERCIAL_ADMIN,
  CAPABILITIES.TECHNICAL_PRIVACY_EXECUTOR,
]);

export class AccessControlError extends Error {
  /** @param {number} statusCode @param {string} code @param {string} message */
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AccessControlError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** @param {string} message */
function forbidden(message) {
  return new AccessControlError(403, 'FORBIDDEN', message);
}

/** @param {string} message */
function invalidRequest(message) {
  return new AccessControlError(400, 'INVALID_REQUEST', message);
}

/**
 * @typedef {{ id: string, kind?: 'human'|'assistant', functionName: OperationalFunction, capabilities: Capability[] }} AccessActor
 */

/**
 * Enforces the same deny-by-default policy that API guards and UI capability
 * views consume. The UI may hide controls, but this policy remains authoritative.
 * @param {AccessActor} actor
 * @param {string} action
 */
export function authorize(actor, action) {
  if (actor.kind === 'assistant') throw forbidden('Forbidden');
  if (
    operationalActions.has(action) &&
    ['Atendimento', 'Vendedor'].includes(actor.functionName)
  ) {
    return;
  }
  const required = actionCapabilities.get(action);
  if (!required || !actor.capabilities.includes(required)) {
    throw forbidden('Forbidden');
  }
}

/**
 * @typedef {{
 *   actorId: string,
 *   capability: Capability,
 *   correlationId: string,
 *   reason: string,
 *   targetId: string
 * }} CapabilityCommand
 */

/**
 * @param {{
 *   auditPort: { append: (event: {
 *     actor: string,
 *     action: string,
 *     target: {type: string, id: string},
 *     version: string | number,
 *     reason: string,
 *     correlationId: string,
 *   }) => Promise<unknown> },
 *   clock?: () => Date,
 *   repository: {
 *     findUser: (id: string) => Promise<(AccessActor & {mfaEnrolled: boolean}) | null>,
 *     grant: (id: string, capability: Capability, grantedBy: string) => Promise<unknown>,
 *     revoke: (id: string, capability: Capability) => Promise<unknown>,
 *     revokePrivilegedSessions: (id: string, occurredAt: string) => Promise<unknown>
 *   }
 * }} options
 */
export function createAccessControlService({
  auditPort,
  clock = () => new Date(),
  repository,
}) {
  /** @param {CapabilityCommand} input */
  async function validate(input) {
    if (!knownCapabilities.has(input.capability)) {
      throw invalidRequest('Unknown capability');
    }
    requireNonEmpty(input.actorId, 'actorId');
    requireNonEmpty(input.targetId, 'targetId');
    requireNonEmpty(input.reason, 'reason');
    requireNonEmpty(input.correlationId, 'correlationId');
    const actor = await repository.findUser(input.actorId);
    const target = await repository.findUser(input.targetId);
    if (!actor || !target) throw invalidRequest('User not found');
    if (!actor.capabilities.includes(CAPABILITIES.COMMERCIAL_ADMIN)) {
      throw forbidden('Forbidden');
    }
    return { actor, target };
  }

  /** @param {'granted'|'revoked'} change @param {CapabilityCommand} input */
  async function audit(change, input) {
    await auditPort.append({
      action: `identity.capability.${change}`,
      actor: input.actorId,
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: input.targetId, type: 'user' },
      version: input.capability,
    });
  }

  /** @param {CapabilityCommand} input */
  async function grantCapability(input) {
    const { target } = await validate(input);
    if (input.actorId === input.targetId) {
      throw forbidden('An Admin cannot self-assign capabilities');
    }
    if (mfaRequiredCapabilities.has(input.capability) && !target.mfaEnrolled) {
      throw forbidden('MFA enrollment is required');
    }
    await repository.grant(input.targetId, input.capability, input.actorId);
    await audit('granted', input);
  }

  /** @param {CapabilityCommand} input */
  async function revokeCapability(input) {
    await validate(input);
    if (
      input.capability === CAPABILITIES.COMMERCIAL_ADMIN &&
      input.actorId === input.targetId
    ) {
      throw forbidden('Another Admin must revoke COMMERCIAL_ADMIN');
    }
    await repository.revoke(input.targetId, input.capability);
    await repository.revokePrivilegedSessions(
      input.targetId,
      clock().toISOString(),
    );
    await audit('revoked', input);
  }

  return Object.freeze({ grantCapability, revokeCapability });
}

/** @param {unknown} value @param {string} field */
function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
