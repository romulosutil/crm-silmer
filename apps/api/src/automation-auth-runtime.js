import {
  AUTOMATION_EXECUTOR_ACTOR,
  createAutomationCredentials,
} from '@crm-silmer/identity-access';

const AUTOMATION_TARGET = Object.freeze({
  id: AUTOMATION_EXECUTOR_ACTOR.id,
  type: 'technical-actor',
});

export class AutomationAuthError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'AutomationAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @typedef {{
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }} AutomationAuditEvent
 */

/**
 * @param {{
 *   auditPort: {append: (event: AutomationAuditEvent) => Promise<unknown>},
 *   environment?: Record<string, string|undefined>,
 * }} options
 */
export function createAutomationAuthRuntime({
  auditPort,
  environment = process.env,
}) {
  if (!auditPort || typeof auditPort.append !== 'function') {
    throw new TypeError('An auditPort with append is required');
  }
  const clientId = requireEnvironmentValue(
    environment.CRM_AUTOMATION_CLIENT_ID,
    'CRM_AUTOMATION_CLIENT_ID',
  );
  const currentSecret = requireEnvironmentSecret(
    environment.CRM_AUTOMATION_CLIENT_SECRET,
    'CRM_AUTOMATION_CLIENT_SECRET',
  );
  const previousSecret = optionalEnvironmentSecret(
    environment.CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET,
    'CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET',
  );
  const credentials = createAutomationCredentials({
    clientId,
    currentSecret,
    ...(previousSecret === undefined ? {} : { previousSecret }),
  });

  /**
   * @param {{action: string, correlationId: string}} input
   * @param {string} actor
   * @param {string} auditAction
   * @param {string} reason
   * @param {string} version
   * @param {number} statusCode
   * @param {string} code
   * @returns {Promise<never>}
   */
  async function deny(
    input,
    actor,
    auditAction,
    reason,
    version,
    statusCode,
    code,
  ) {
    await auditPort.append(
      Object.freeze({
        action: auditAction,
        actor,
        correlationId: input.correlationId,
        reason,
        target: AUTOMATION_TARGET,
        version,
      }),
    );
    throw new AutomationAuthError(statusCode, code);
  }

  return Object.freeze({
    /**
     * @param {{action: string, authorization: unknown, correlationId: string}} input
     */
    async authorize(input) {
      requireNonEmptyString(input.action, 'action');
      requireNonEmptyString(input.correlationId, 'correlationId');
      const presented = parseBasicAuthorization(input.authorization);
      const principal = presented
        ? credentials.authenticate(presented.clientId, presented.secret)
        : null;
      if (!principal) {
        return deny(
          input,
          'UNAUTHENTICATED_AUTOMATION_CALLER',
          'automation.authentication.denied',
          'AUTOMATION_CREDENTIAL_REJECTED',
          'unverified',
          401,
          'INVALID_AUTOMATION_CREDENTIALS',
        );
      }
      if (!credentials.isActionAllowed(input.action)) {
        return deny(
          input,
          principal.actor.id,
          'automation.authorization.denied',
          'AUTOMATION_ACTION_FORBIDDEN',
          principal.credentialVersion,
          403,
          'FORBIDDEN_AUTOMATION_ACTION',
        );
      }
      return principal;
    },
  });
}

/** @param {unknown} authorization */
function parseBasicAuthorization(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(authorization);
  if (!match || match[1].length % 4 === 1) return null;
  const encoded = match[1];
  const decodedBytes = Buffer.from(encoded, 'base64');
  const canonical = decodedBytes.toString('base64').replace(/=+$/u, '');
  if (canonical !== encoded.replace(/=+$/u, '')) return null;
  const decoded = decodedBytes.toString('utf8');
  if (decoded.includes('\uFFFD')) return null;
  const separator = decoded.indexOf(':');
  if (separator <= 0 || separator === decoded.length - 1) return null;
  return {
    clientId: decoded.slice(0, separator),
    secret: decoded.slice(separator + 1),
  };
}

/** @param {string|undefined} value @param {string} name */
function requireEnvironmentValue(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** @param {string|undefined} value @param {string} name */
function requireEnvironmentSecret(value, name) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  return value;
}

/** @param {string|undefined} value @param {string} name */
function optionalEnvironmentSecret(value, name) {
  if (value === undefined) return undefined;
  return requireEnvironmentSecret(value, name);
}

/** @param {unknown} value @param {string} field */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
