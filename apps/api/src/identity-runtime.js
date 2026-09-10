import { createHash, timingSafeEqual } from 'node:crypto';

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

const OPERATIONAL_ACTIONS = new Set([
  'conversation.convert',
  'deal.lose',
  'deal.fields.patch',
  'deal.transition',
  'deal.assign',
  'task.create',
  'task.start',
  'task.complete',
  'task.cancel',
  'handoff.create',
  'handoff.accept',
  'handoff.transfer',
  'handoff.resolve',
  'kanban.read',
  'deal.read',
  'deal.events.read',
  'conversation.read',
  'contact.read',
]);

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
  const allowedOrigins = readOrigins(
    environment.APP_ORIGIN,
    environment.APP_ENV === 'development',
  );
  const bootstrapToken = requireSecret(
    environment.IDENTITY_BOOTSTRAP_TOKEN,
    'IDENTITY_BOOTSTRAP_TOKEN',
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
      repository: createPostgresIdentityRepository(client),
    });
  }

  /** @param {any} client @param {{sessionToken: string, csrfToken: string}} input */
  async function authenticatedSession(client, input) {
    try {
      const session = await identityService(client).assertCsrf(
        input.sessionToken,
        input.csrfToken,
      );
      return session;
    } catch (error) {
      if (error instanceof IdentityHttpError) throw error;
      throw new IdentityHttpError(403, 'FORBIDDEN');
    }
  }

  /** @param {{sessionToken: string, csrfToken: string}} input */
  function preflight(input) {
    return database.transaction((client) =>
      authenticatedSession(client, input),
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

  /**
   * Every administrative mutation shares the same envelope: CSRF preflight,
   * idempotency record, and a re-check that the replayed actor still matches
   * the session that opened the command.
   *
   * @param {{
   *   action: string,
   *   command: Record<string, unknown>,
   *   correlationId: string,
   *   csrfToken: string,
   *   idempotencyKey: string,
   *   reason: string,
   *   sessionToken: string,
   *   target: {id: string, type: string},
   * }} metadata
   * @param {(service: ReturnType<typeof identityService>, actorId: string) => Promise<unknown>} effect
   */
  async function adminMutation(metadata, effect) {
    const preflightSession = await preflight(metadata);
    return executeIdempotent(
      {
        action: metadata.action,
        actorId: preflightSession.userId,
        command: metadata.command,
        correlationId: metadata.correlationId,
        idempotencyKey: metadata.idempotencyKey,
        reason: metadata.reason,
        target: metadata.target,
      },
      async (client, actorId) => {
        const session = await authenticatedSession(client, metadata);
        if (session.userId !== actorId) {
          throw new IdentityHttpError(403, 'FORBIDDEN');
        }
        return effect(identityService(client), actorId);
      },
    );
  }

  return Object.freeze({
    allowedOrigins,

    /** @param {{action: string, csrfToken: string, sessionToken: string}} input */
    async authorizeOperational(input) {
      if (!OPERATIONAL_ACTIONS.has(input.action)) {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
      return database.transaction(async (client) => {
        const session = await authenticatedSession(client, input);
        const user = await createPostgresIdentityRepository(
          client,
        ).findUserById(session.userId);
        if (!user || user.functionName !== 'Vendedor') {
          throw new IdentityHttpError(403, 'FORBIDDEN');
        }
        return {
          actor: {
            functionName: user.functionName,
            id: user.id,
            kind: 'human',
          },
        };
      });
    },

    /** @param {{action: string, sessionToken: string}} input */
    async authorizeOperationalRead(input) {
      if (
        !OPERATIONAL_ACTIONS.has(input.action) ||
        !input.action.endsWith('.read')
      ) {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
      return database.transaction(async (client) => {
        let session;
        try {
          session = await identityService(client).authenticate(
            input.sessionToken,
          );
        } catch {
          throw new IdentityHttpError(403, 'FORBIDDEN');
        }
        const repository = createPostgresIdentityRepository(client);
        const user = await repository.findUserById(session.userId);
        const activeUser = user
          ? await repository.findUserByEmail(user.email)
          : null;
        if (
          !activeUser ||
          activeUser.id !== session.userId ||
          activeUser.functionName !== 'Vendedor'
        ) {
          throw new IdentityHttpError(403, 'FORBIDDEN');
        }
        return {
          actor: {
            functionName: activeUser.functionName,
            id: activeUser.id,
            kind: 'human',
          },
        };
      });
    },

    /** @param {{bootstrapToken: string, correlationId: string, email: string, functionName?: 'Vendedor', name: string, password: string, reason: string}} input */
    async bootstrap(input) {
      if (!equalSecret(input.bootstrapToken, bootstrapToken)) {
        throw new IdentityHttpError(403, 'FORBIDDEN');
      }
      try {
        return await database.transaction(async (client) => {
          const service = identityService(client);
          return service.bootstrapAdmin(input);
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
          const session = await authenticatedSession(client, input);
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

    /** @param {{correlationId: string, csrfToken: string, email: string, idempotencyKey: string, name: string, password: string, reason: string, sessionToken: string}} input */
    async createUser(input) {
      return adminMutation(
        {
          action: 'identity.user.create',
          command: { email: input.email, name: input.name },
          correlationId: input.correlationId,
          csrfToken: input.csrfToken,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          sessionToken: input.sessionToken,
          target: {
            id: createHash('sha256').update(input.idempotencyKey).digest('hex'),
            type: 'user-request',
          },
        },
        (service, actorId) =>
          service.createOperationalUser({
            actorId,
            correlationId: input.correlationId,
            email: input.email,
            name: input.name,
            password: input.password,
            reason: input.reason,
          }),
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
            user: {
              capabilities: user.capabilities,
              email: user.email,
              functionName: user.functionName,
              id: user.id,
              name: user.name,
            },
          };
        });
      } catch {
        throw new IdentityHttpError(401, 'INVALID_CREDENTIALS');
      }
    },

    /** @param {{sessionToken: string}} input */
    async listUsers(input) {
      return database.transaction(async (client) => {
        const service = identityService(client);
        let session;
        try {
          session = await service.authenticate(input.sessionToken);
        } catch {
          throw new IdentityHttpError(401, 'INVALID_CREDENTIALS');
        }
        return service.listUsers({ actorId: session.userId });
      });
    },

    /** @param {{email: string, network: string, password: string}} input */
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

    /** @param {{correlationId: string, csrfToken: string, disabled: boolean, idempotencyKey: string, reason: string, sessionToken: string, targetId: string}} input */
    async setUserDisabled(input) {
      return adminMutation(
        {
          action: input.disabled
            ? 'identity.user.disable'
            : 'identity.user.enable',
          command: { disabled: input.disabled, targetId: input.targetId },
          correlationId: input.correlationId,
          csrfToken: input.csrfToken,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          sessionToken: input.sessionToken,
          target: { id: input.targetId, type: 'user' },
        },
        (service, actorId) =>
          service.setUserDisabled({
            actorId,
            correlationId: input.correlationId,
            disabled: input.disabled,
            reason: input.reason,
            targetId: input.targetId,
          }),
      );
    },

    /** @param {{correlationId: string, csrfToken: string, email?: string, idempotencyKey: string, name?: string, password?: string, reason: string, sessionToken: string, targetId: string}} input */
    async updateUser(input) {
      return adminMutation(
        {
          action: 'identity.user.update',
          // Absent fields stay absent: the fingerprint only accepts JSON
          // values, and a patch that leaves a field untouched must not be
          // confused with one that sets it.
          command: {
            ...(input.email === undefined ? {} : { email: input.email }),
            ...(input.name === undefined ? {} : { name: input.name }),
            passwordChanged: input.password !== undefined,
            targetId: input.targetId,
          },
          correlationId: input.correlationId,
          csrfToken: input.csrfToken,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          sessionToken: input.sessionToken,
          target: { id: input.targetId, type: 'user' },
        },
        (service, actorId) =>
          service.updateUser({
            actorId,
            correlationId: input.correlationId,
            email: input.email,
            name: input.name,
            password: input.password,
            reason: input.reason,
            targetId: input.targetId,
          }),
      );
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

/** @param {string|undefined} value @param {boolean} allowLoopbackHttp */
function readOrigins(value, allowLoopbackHttp) {
  if (!value) throw new Error('APP_ORIGIN is required');
  const origins = value
    .split(',')
    .map((candidate) => new URL(candidate).origin);
  if (
    origins.some(
      (origin) =>
        !origin.startsWith('https://') &&
        !(allowLoopbackHttp && isLoopbackHttpOrigin(origin)),
    )
  ) {
    throw new Error(
      'APP_ORIGIN entries must use HTTPS outside local development',
    );
  }
  return Object.freeze([...new Set(origins)]);
}

/** @param {string} origin */
function isLoopbackHttpOrigin(origin) {
  const url = new URL(origin);
  return (
    url.protocol === 'http:' &&
    ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  );
}

/** @param {string} left @param {string} right */
function equalSecret(left, right) {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
