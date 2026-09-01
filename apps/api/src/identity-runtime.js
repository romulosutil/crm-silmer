import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  createAccessControlService,
  createIdentityAccessService,
  createPostgresAccessRepository,
  createPostgresAuthenticationThrottle,
  createPostgresIdentityRepository,
} from '@crm-silmer/identity-access';
import {
  fingerprintCommand,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';

class IdentityHttpError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'IdentityHttpError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @typedef {{
 *   query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>,
 *   transaction: <T>(work: (client: any) => Promise<T>) => Promise<T>
 * }} TransactionalDatabase
 */

/**
 * Composes the identity HTTP port with transaction-bound PostgreSQL adapters.
 * Secrets are decoded once and retained only in process memory.
 *
 * @param {TransactionalDatabase} database
 * @param {Record<string, string|undefined>} [environment]
 */
export function createIdentityApiRuntime(database, environment = process.env) {
  if (!database || typeof database.transaction !== 'function') {
    throw new TypeError('A transactional database is required');
  }
  const allowedOrigins = readOrigins(environment.APP_ORIGIN);
  const bootstrapToken = requireSecret(
    environment.IDENTITY_BOOTSTRAP_TOKEN,
    'IDENTITY_BOOTSTRAP_TOKEN',
  );
  const identityEnvelopeKey = readKey(
    environment.IDENTITY_ENVELOPE_KEY,
    'IDENTITY_ENVELOPE_KEY',
  );
  const idempotencyEnvelopeKey = readKey(
    environment.IDEMPOTENCY_ENVELOPE_KEY,
    'IDEMPOTENCY_ENVELOPE_KEY',
  );
  const throttleHmacKey = readKey(
    environment.AUTH_THROTTLE_HMAC_KEY,
    'AUTH_THROTTLE_HMAC_KEY',
  );
  const idempotency = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: idempotencyEnvelopeKey,
  });

  /** @param {any} client */
  function identityService(client) {
    return createIdentityAccessService({
      auditPort: new PostgresAuditTrail(client),
      envelopeKey: identityEnvelopeKey,
      repository: createPostgresIdentityRepository(client),
    });
  }

  /** @param {any} client @param {{sessionToken: string, csrfToken: string}} input @param {boolean} requireMfa */
  async function authenticatedSession(client, input, requireMfa) {
    try {
      const session = await identityService(client).assertCsrf(
        input.sessionToken,
        input.csrfToken,
      );
      if (requireMfa && !session.mfaVerified) {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
      return session;
    } catch (error) {
      if (error instanceof IdentityHttpError) throw error;
      throw new IdentityHttpError(403, 'FORBIDDEN');
    }
  }

  /** @param {{sessionToken: string, csrfToken: string}} input @param {boolean} requireMfa */
  function preflight(input, requireMfa = true) {
    return database.transaction((client) =>
      authenticatedSession(client, input, requireMfa),
    );
  }

  /**
   * @template T
   * @param {{actorId: string, action: string, command: unknown, correlationId: string, idempotencyKey: string, reason: string, target: {type: string, id: string}}} metadata
   * @param {(client: any, actorId: string) => Promise<T>} effect
   */
  function executeIdempotent(metadata, effect) {
    return idempotency.execute(
      {
        action: metadata.action,
        actor: metadata.actorId,
        correlationId: metadata.correlationId,
        fingerprint: fingerprintCommand({
          action: metadata.action,
          command: metadata.command,
          reason: metadata.reason,
          target: metadata.target,
          version: 1,
        }),
        key: metadata.idempotencyKey,
        reason: metadata.reason,
        scope: `${metadata.actorId}:${metadata.action}`,
        target: metadata.target,
        version: 1,
      },
      (client) => effect(client, metadata.actorId),
    );
  }

  return Object.freeze({
    allowedOrigins,

    /** @param {{correlationId: string, password: string, token: string}} input */
    async acceptInvitation(input) {
      try {
        return await database.transaction((client) =>
          identityService(client).acceptInvitation(input),
        );
      } catch {
        throw new IdentityHttpError(400, 'INVALID_REQUEST');
      }
    },

    /** @param {{bootstrapToken: string, correlationId: string, email: string, functionName: 'Atendimento'|'Vendedor', password: string, reason: string}} input */
    async bootstrap(input) {
      if (!equalSecret(input.bootstrapToken, bootstrapToken)) {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
      try {
        return await database.transaction(async (client) => {
          const service = identityService(client);
          const result = await service.bootstrapAdmin(input);
          const secret = randomBytes(20);
          const enrollment = await service.enrollTotp({
            actorId: result.user.id,
            correlationId: input.correlationId,
            reason: 'Bootstrap MFA enrollment',
            secret,
          });
          return {
            mfa: {
              algorithm: 'SHA1',
              digits: 6,
              period: 30,
              recoveryCodes: enrollment.recoveryCodes,
              secret: base32(secret),
            },
            user: result.user,
          };
        });
      } catch (error) {
        if (error instanceof IdentityHttpError) throw error;
        throw new IdentityHttpError(409, 'IDENTITY_ALREADY_INITIALIZED');
      }
    },

    /** @param {{capability: string, change: 'grant'|'revoke', correlationId: string, csrfToken: string, idempotencyKey: string, reason: string, sessionToken: string, targetId: string}} input */
    async changeCapability(input) {
      const preflightSession = await preflight(input);
      const action = `identity.capability.${input.change}`;
      return executeIdempotent(
        {
          action,
          actorId: preflightSession.userId,
          command: {
            capability: input.capability,
            change: input.change,
            targetId: input.targetId,
          },
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          target: { id: input.targetId, type: 'user' },
        },
        async (client, actorId) => {
          const session = await authenticatedSession(client, input, true);
          if (session.userId !== actorId) {
            throw new IdentityHttpError(403, 'FORBIDDEN');
          }
          const service = createAccessControlService({
            auditPort: new PostgresAuditTrail(client),
            repository: createPostgresAccessRepository(client),
          });
          const command = {
            actorId,
            capability: /** @type {any} */ (input.capability),
            correlationId: input.correlationId,
            reason: input.reason,
            targetId: input.targetId,
          };
          if (input.change === 'grant') {
            await service.grantCapability(command);
          } else {
            await service.revokeCapability(command);
          }
          return { changed: true };
        },
      );
    },

    /** @param {{correlationId: string, csrfToken: string, email: string, expiresAt: string, functionName: 'Atendimento'|'Vendedor', idempotencyKey: string, reason: string, sessionToken: string}} input */
    async createInvitation(input) {
      const preflightSession = await preflight(input);
      return executeIdempotent(
        {
          action: 'identity.invitation.create',
          actorId: preflightSession.userId,
          command: {
            email: input.email,
            expiresAt: input.expiresAt,
            functionName: input.functionName,
          },
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          target: {
            id: createHash('sha256').update(input.idempotencyKey).digest('hex'),
            type: 'invitation-request',
          },
        },
        async (client, actorId) => {
          const session = await authenticatedSession(client, input, true);
          if (session.userId !== actorId) {
            throw new IdentityHttpError(403, 'FORBIDDEN');
          }
          return identityService(client).createInvitation({
            actorId,
            correlationId: input.correlationId,
            email: input.email,
            expiresAt: new Date(input.expiresAt),
            functionName: input.functionName,
            reason: input.reason,
          });
        },
      );
    },

    /** @param {{sessionToken: string}} input */
    async current(input) {
      try {
        return await database.transaction(async (client) => {
          const service = identityService(client);
          const session = await service.authenticate(input.sessionToken);
          const user = await createPostgresIdentityRepository(
            client,
          ).findUserById(session.userId);
          if (!user) throw new Error('User not found');
          return {
            mfaVerified: session.mfaVerified,
            user: {
              capabilities: user.capabilities,
              functionName: user.functionName,
              id: user.id,
            },
          };
        });
      } catch {
        throw new IdentityHttpError(401, 'INVALID_CREDENTIALS');
      }
    },

    /** @param {{correlationId: string, csrfToken: string, idempotencyKey: string, reason: string, sessionToken: string}} input */
    async enrollMfa(input) {
      const preflightSession = await preflight(input, false);
      return executeIdempotent(
        {
          action: 'identity.mfa.enroll',
          actorId: preflightSession.userId,
          command: { enroll: true },
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          target: { id: preflightSession.userId, type: 'user' },
        },
        async (client, actorId) => {
          const session = await authenticatedSession(client, input, false);
          if (session.userId !== actorId) {
            throw new IdentityHttpError(403, 'FORBIDDEN');
          }
          const secret = randomBytes(20);
          const enrollment = await identityService(client).enrollTotp({
            actorId,
            correlationId: input.correlationId,
            reason: input.reason,
            secret,
          });
          return {
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            recoveryCodes: enrollment.recoveryCodes,
            secret: base32(secret),
          };
        },
      );
    },

    /** @param {{email: string, network: string, password: string, recoveryCode?: string, totpCode?: string}} input */
    async login(input) {
      const outcome = await database.transaction(async (client) => {
        const throttle = createPostgresAuthenticationThrottle(client, {
          hmacKey: throttleHmacKey,
        });
        await throttle.lock(input);
        const state = await throttle.check(input);
        if (!state.allowed) return { kind: 'throttled' };
        try {
          const result = await identityService(client).login(input);
          await throttle.resetAccount(input.email);
          return { kind: 'success', result };
        } catch {
          await throttle.recordFailure(input);
          return { kind: 'invalid' };
        }
      });
      if (outcome.kind === 'throttled') {
        throw new IdentityHttpError(429, 'AUTHENTICATION_THROTTLED');
      }
      if (outcome.kind !== 'success') {
        throw new IdentityHttpError(401, 'INVALID_CREDENTIALS');
      }
      return outcome.result;
    },

    /** @param {{csrfToken: string, sessionToken: string}} input */
    async logout(input) {
      try {
        await database.transaction(async (client) => {
          const service = identityService(client);
          await service.assertCsrf(input.sessionToken, input.csrfToken);
          await service.logout(input.sessionToken);
        });
      } catch {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
    },
  });
}

/** @param {string|undefined} value @param {string} name */
function readKey(value, name) {
  const encoded = requireSecret(value, name);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error(`${name} must use base64url`);
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

/** @param {string|undefined} value @param {string} name */
function requireSecret(value, name) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  return value;
}

/** @param {string|undefined} value */
function readOrigins(value) {
  if (!value) throw new Error('APP_ORIGIN is required');
  const origins = value
    .split(',')
    .map((candidate) => new URL(candidate).origin);
  if (origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('APP_ORIGIN entries must use HTTPS');
  }
  return Object.freeze([...new Set(origins)]);
}

/** @param {string} left @param {string} right */
function equalSecret(left, right) {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** @param {Buffer} input */
function base32(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
