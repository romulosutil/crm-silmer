import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { AccessControlError } from './authorization.js';

/**
 * @typedef {'COMMERCIAL_ADMIN'} IdentityCapability
 * @typedef {'Vendedor'} OperationalFunction
 * @typedef {{ memory: number, parallelism: number, passes: number, tagLength?: number }} PasswordParameters
 * @typedef {{
 *   capabilities: IdentityCapability[],
 *   createdAt?: string | null,
 *   disabledAt?: string | null,
 *   email: string,
 *   functionName: OperationalFunction,
 *   id: string,
 *   name: string,
 *   passwordHash: string,
 * }} IdentityUser
 * @typedef {{
 *   email?: string,
 *   name?: string,
 *   passwordHash?: string,
 * }} IdentityUserPatch
 * @typedef {{
 *   absoluteExpiresAt: string,
 *   csrfHash: string,
 *   createdAt: string,
 *   lastSeenAt: string,
 *   revokedAt: string | null,
 *   tokenHash: string,
 *   userId: string,
 * }} IdentitySession
 * @typedef {{
 *   authenticateSession: (tokenHash: string, touchedAt: string, idleExpiresBefore: string) => IdentitySession | null | Promise<IdentitySession | null>,
 *   createSession: (session: IdentitySession) => void | Promise<void>,
 *   createUser: (user: IdentityUser) => void | Promise<void>,
 *   findSession: (tokenHash: string) => IdentitySession | null | Promise<IdentitySession | null>,
 *   findUserByEmail: (email: string) => IdentityUser | null | undefined | Promise<IdentityUser | null | undefined>,
 *   findUserById: (id: string) => IdentityUser | null | Promise<IdentityUser | null>,
 *   hasUsers: () => boolean | Promise<boolean>,
 *   insertInitialUser: (user: IdentityUser) => boolean | Promise<boolean>,
 *   listUsers: () => IdentityUser[] | Promise<IdentityUser[]>,
 *   setUserDisabled: (id: string, disabledAt: string | null) => IdentityUser | null | Promise<IdentityUser | null>,
 *   updateUser: (id: string, patch: IdentityUserPatch) => IdentityUser | null | Promise<IdentityUser | null>,
 *   inspect: () => {
 *     sessions: IdentitySession[],
 *     users: IdentityUser[],
 *   } | Promise<{
 *     sessions: IdentitySession[],
 *     users: IdentityUser[],
 *   }>,
 *   revokeSession: (tokenHash: string, revokedAt: string) => void | Promise<void>,
 *   touchSession: (tokenHash: string, touchedAt: string) => void | Promise<void>,
 *   validateCsrfSession: (tokenHash: string, csrfHash: string, touchedAt: string, idleExpiresBefore: string) => IdentitySession | null | Promise<IdentitySession | null>,
 * }} IdentityRepository
 * @typedef {{
 *   actor: string,
 *   action: string,
 *   target: {type: string, id: string},
 *   version: string | number,
 *   reason: string,
 *   correlationId: string,
 * }} IdentityAuditEvent
 */

/** @type {Readonly<Required<PasswordParameters>>} */
const DEFAULT_PASSWORD_PARAMETERS = Object.freeze({
  memory: 19_456,
  parallelism: 2,
  passes: 2,
  tagLength: 32,
});
const UNKNOWN_USER_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=2$xMr8EkVto6XX3sYwTVTyOA$pM1ue-Zt9HInxnqVdW8WDGRrCyxnKUZm8IK-O-32cLM';
/** @type {Set<OperationalFunction>} */
const FUNCTIONS = new Set(['Vendedor']);
/** @type {OperationalFunction} */
const DEFAULT_FUNCTION = 'Vendedor';

/** @param {string | Uint8Array} value */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string | Uint8Array} left @param {string | Uint8Array} right */
function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {import('node:crypto').Argon2Parameters} parameters
 * @returns {Promise<Buffer>}
 */
function deriveArgon2(parameters) {
  return new Promise((resolve, reject) => {
    argon2('argon2id', parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(
  /** @type {string} */
  password,
  /** @type {PasswordParameters} */
  parameters = DEFAULT_PASSWORD_PARAMETERS,
) {
  if (typeof password !== 'string' || password === '') {
    throw new TypeError('Password must be a non-empty string');
  }
  const nonce = randomBytes(16);
  const settings = { ...DEFAULT_PASSWORD_PARAMETERS, ...parameters };
  const key = await deriveArgon2({
    memory: settings.memory,
    message: password,
    nonce,
    parallelism: settings.parallelism,
    passes: settings.passes,
    tagLength: settings.tagLength,
  });
  return [
    '$argon2id',
    'v=19',
    `m=${settings.memory},t=${settings.passes},p=${settings.parallelism}`,
    nonce.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** @param {string} password @param {string} encoded */
export async function verifyPassword(password, encoded) {
  try {
    const [, algorithm, version, settingsText, nonceText, keyText] =
      encoded.split('$');
    if (algorithm !== 'argon2id' || version !== 'v=19') return false;
    const settings = Object.fromEntries(
      settingsText.split(',').map((entry) => entry.split('=')),
    );
    const expected = Buffer.from(keyText, 'base64url');
    const actual = await deriveArgon2({
      memory: Number(settings.m),
      message: password,
      nonce: Buffer.from(nonceText, 'base64url'),
      parallelism: Number(settings.p),
      passes: Number(settings.t),
      tagLength: expected.length,
    });
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** @param {IdentityUser} user */
function freezeUser(user) {
  return Object.freeze({
    capabilities: Object.freeze([...user.capabilities]),
    createdAt: user.createdAt ?? null,
    disabledAt: user.disabledAt ?? null,
    email: user.email,
    functionName: user.functionName,
    id: user.id,
    name: user.name,
  });
}

/** @returns {IdentityRepository} */
export function createInMemoryIdentityRepository() {
  /** @type {Map<string, IdentityUser>} */
  const users = new Map();
  /** @type {Map<string, string>} */
  const emails = new Map();
  /** @type {Map<string, IdentitySession>} */
  const sessions = new Map();

  /**
   * @param {string} tokenHash
   * @param {string} touchedAt
   * @param {string} idleExpiresBefore
   */
  function activeSession(tokenHash, touchedAt, idleExpiresBefore) {
    const session = sessions.get(tokenHash);
    if (
      !session ||
      session.revokedAt ||
      new Date(session.absoluteExpiresAt) <= new Date(touchedAt) ||
      new Date(session.lastSeenAt) <= new Date(idleExpiresBefore)
    ) {
      return null;
    }
    return session;
  }

  return Object.freeze({
    /** @param {string} tokenHash @param {string} touchedAt @param {string} idleExpiresBefore */
    authenticateSession(tokenHash, touchedAt, idleExpiresBefore) {
      const session = activeSession(tokenHash, touchedAt, idleExpiresBefore);
      if (!session) return null;
      session.lastSeenAt = touchedAt;
      return { ...session };
    },
    /** @param {IdentitySession} session */
    createSession(session) {
      sessions.set(session.tokenHash, { ...session });
    },
    /** @param {IdentityUser} user */
    createUser(user) {
      if (emails.has(user.email.toLowerCase())) throw new Error('User exists');
      users.set(user.id, {
        createdAt: new Date().toISOString(),
        disabledAt: null,
        ...user,
        capabilities: [...user.capabilities],
      });
      emails.set(user.email.toLowerCase(), user.id);
    },
    /** @param {string} tokenHash */
    findSession(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    /** @param {string} email */
    findUserByEmail(email) {
      const id = emails.get(email.toLowerCase());
      const user = id ? users.get(id) : null;
      return user && !user.disabledAt ? user : null;
    },
    /** @param {string} id */
    findUserById(id) {
      return users.get(id) ?? null;
    },
    hasUsers() {
      return users.size > 0;
    },
    /** @param {IdentityUser} user */
    insertInitialUser(user) {
      if (users.size > 0) return false;
      this.createUser(user);
      return true;
    },
    inspect() {
      return {
        sessions: [...sessions.values()].map((session) => ({ ...session })),
        users: [...users.values()].map((user) => ({
          ...user,
          capabilities: [...user.capabilities],
        })),
      };
    },
    listUsers() {
      return [...users.values()]
        .map((user) => ({ ...user, capabilities: [...user.capabilities] }))
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    },
    /** @param {string} tokenHash @param {string} revokedAt */
    revokeSession(tokenHash, revokedAt) {
      const session = sessions.get(tokenHash);
      if (session) session.revokedAt = revokedAt;
    },
    /** @param {string} id @param {string | null} disabledAt */
    setUserDisabled(id, disabledAt) {
      const user = users.get(id);
      if (!user) return null;
      user.disabledAt = disabledAt;
      return { ...user, capabilities: [...user.capabilities] };
    },
    /** @param {string} tokenHash @param {string} touchedAt */
    touchSession(tokenHash, touchedAt) {
      const session = sessions.get(tokenHash);
      if (session) session.lastSeenAt = touchedAt;
    },
    /** @param {string} id @param {IdentityUserPatch} patch */
    updateUser(id, patch) {
      const user = users.get(id);
      if (!user) return null;
      if (patch.email !== undefined) {
        const taken = emails.get(patch.email.toLowerCase());
        if (taken && taken !== id) throw new Error('User exists');
        emails.delete(user.email.toLowerCase());
        emails.set(patch.email.toLowerCase(), id);
        user.email = patch.email;
      }
      if (patch.name !== undefined) user.name = patch.name;
      if (patch.passwordHash !== undefined) {
        user.passwordHash = patch.passwordHash;
      }
      return { ...user, capabilities: [...user.capabilities] };
    },
    /** @param {string} tokenHash @param {string} csrfHash @param {string} touchedAt @param {string} idleExpiresBefore */
    validateCsrfSession(tokenHash, csrfHash, touchedAt, idleExpiresBefore) {
      const session = activeSession(tokenHash, touchedAt, idleExpiresBefore);
      if (!session || !constantTimeEqual(session.csrfHash, csrfHash)) {
        return null;
      }
      session.lastSeenAt = touchedAt;
      return { ...session };
    },
  });
}

/**
 * @param {{
 *   auditPort: {append: (event: IdentityAuditEvent) => Promise<unknown>},
 *   clock?: () => Date,
 *   idFactory?: (prefix: string) => string,
 *   passwordParameters?: PasswordParameters,
 *   passwordVerifier?: typeof verifyPassword,
 *   repository: IdentityRepository,
 *   sessionAbsoluteMs?: number,
 *   sessionIdleMs?: number,
 *   tokenFactory?: () => string,
 *   unknownUserPasswordHash?: string,
 * }} options
 */
export function createIdentityAccessService({
  auditPort,
  clock = () => new Date(),
  idFactory = (prefix) => `${prefix}-${randomBytes(16).toString('hex')}`,
  passwordParameters = DEFAULT_PASSWORD_PARAMETERS,
  passwordVerifier = verifyPassword,
  repository,
  sessionAbsoluteMs = 12 * 60 * 60 * 1000,
  sessionIdleMs = 30 * 60 * 1000,
  tokenFactory = () => randomBytes(32).toString('base64url'),
  unknownUserPasswordHash = UNKNOWN_USER_PASSWORD_HASH,
}) {
  if (
    !Number.isFinite(sessionAbsoluteMs) ||
    sessionAbsoluteMs <= 0 ||
    !Number.isFinite(sessionIdleMs) ||
    sessionIdleMs <= 0 ||
    sessionIdleMs > sessionAbsoluteMs
  ) {
    throw new TypeError('Session expiry settings are invalid');
  }
  if (!unknownUserPasswordHash.startsWith('$argon2id$v=19$')) {
    throw new TypeError('Unknown-user password hash must use Argon2id');
  }

  /** @param {IdentityAuditEvent} event */
  async function record(event) {
    await auditPort.append(Object.freeze(event));
  }

  /** @param {{
   *   correlationId: string,
   *   email: string,
   *   functionName?: OperationalFunction,
   *   name: string,
   *   password: string,
   *   reason: string,
   * }} input */
  async function bootstrapAdmin(input) {
    requireNonEmptyString(input.email, 'email');
    requireNonEmptyString(input.name, 'name');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const functionName = input.functionName ?? DEFAULT_FUNCTION;
    if (!FUNCTIONS.has(functionName)) throw new Error('Invalid function');
    const passwordHash = await hashPassword(input.password, passwordParameters);
    /** @type {IdentityUser} */
    const user = {
      capabilities: ['COMMERCIAL_ADMIN'],
      email: input.email,
      functionName,
      id: idFactory('user'),
      name: input.name.trim(),
      passwordHash,
    };
    if (!(await repository.insertInitialUser(user))) {
      throw new Error('Identity access is already initialized');
    }
    await record({
      action: 'identity.admin.bootstrapped',
      actor: 'bootstrap-authority',
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: user.id, type: 'user' },
      version: 1,
    });
    return { user: freezeUser(user) };
  }

  /** @param {string} actorId */
  async function requireAdmin(actorId) {
    requireNonEmptyString(actorId, 'actorId');
    const actor = await repository.findUserById(actorId);
    if (!actor?.capabilities.includes('COMMERCIAL_ADMIN')) {
      throw new AccessControlError(
        403,
        'FORBIDDEN',
        'Operation requires COMMERCIAL_ADMIN',
      );
    }
    return actor;
  }

  /** @param {string} id */
  function userNotFound(id) {
    return new AccessControlError(404, 'NOT_FOUND', `Unknown user ${id}`);
  }

  /** @param {{
   *   actorId: string,
   *   correlationId: string,
   *   email: string,
   *   name: string,
   *   password: string,
   *   reason: string,
   * }} input */
  async function createOperationalUser(input) {
    requireNonEmptyString(input.email, 'email');
    requireNonEmptyString(input.name, 'name');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const actor = await requireAdmin(input.actorId);
    const passwordHash = await hashPassword(input.password, passwordParameters);
    /** @type {IdentityUser} */
    const user = {
      capabilities: [],
      email: input.email,
      functionName: DEFAULT_FUNCTION,
      id: idFactory('user'),
      name: input.name.trim(),
      passwordHash,
    };
    try {
      await repository.createUser(user);
    } catch (error) {
      throw asDuplicateEmail(error);
    }
    await record({
      action: 'identity.user.created',
      actor: actor.id,
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: user.id, type: 'user' },
      version: 1,
    });
    return Object.freeze({ user: freezeUser(user) });
  }

  /** @param {{actorId: string}} input */
  async function listUsers(input) {
    await requireAdmin(input.actorId);
    const rows = await repository.listUsers();
    return Object.freeze({
      users: Object.freeze(rows.map((row) => freezeUser(row))),
    });
  }

  /** @param {{
   *   actorId: string,
   *   correlationId: string,
   *   disabled: boolean,
   *   reason: string,
   *   targetId: string,
   * }} input */
  async function setUserDisabled(input) {
    requireNonEmptyString(input.targetId, 'targetId');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const actor = await requireAdmin(input.actorId);
    if (actor.id === input.targetId) {
      throw new AccessControlError(
        400,
        'INVALID_REQUEST',
        'An administrator cannot disable their own account',
      );
    }
    const updated = await repository.setUserDisabled(
      input.targetId,
      input.disabled ? clock().toISOString() : null,
    );
    if (!updated) throw userNotFound(input.targetId);
    await record({
      action: input.disabled
        ? 'identity.user.disabled'
        : 'identity.user.enabled',
      actor: actor.id,
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: updated.id, type: 'user' },
      version: 1,
    });
    return Object.freeze({ user: freezeUser(updated) });
  }

  /** @param {{
   *   actorId: string,
   *   correlationId: string,
   *   email?: string,
   *   name?: string,
   *   password?: string,
   *   reason: string,
   *   targetId: string,
   * }} input */
  async function updateUser(input) {
    requireNonEmptyString(input.targetId, 'targetId');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const actor = await requireAdmin(input.actorId);
    /** @type {IdentityUserPatch} */
    const patch = {};
    if (input.email !== undefined) {
      requireNonEmptyString(input.email, 'email');
      patch.email = input.email;
    }
    if (input.name !== undefined) {
      requireNonEmptyString(input.name, 'name');
      patch.name = input.name.trim();
    }
    if (input.password !== undefined) {
      patch.passwordHash = await hashPassword(
        input.password,
        passwordParameters,
      );
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('Update requires at least one field');
    }
    let updated;
    try {
      updated = await repository.updateUser(input.targetId, patch);
    } catch (error) {
      throw asDuplicateEmail(error);
    }
    if (!updated) throw userNotFound(input.targetId);
    await record({
      action: 'identity.user.updated',
      actor: actor.id,
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: updated.id, type: 'user' },
      version: 1,
    });
    return Object.freeze({ user: freezeUser(updated) });
  }

  /** @param {{
   *   email: string,
   *   password: string,
   * }} input */
  async function login(input) {
    const user = await repository.findUserByEmail(input.email);
    const passwordMatches = await passwordVerifier(
      input.password,
      user?.passwordHash ?? unknownUserPasswordHash,
    );
    if (!user || !passwordMatches) {
      throw new Error('Invalid credentials');
    }
    const sessionToken = tokenFactory();
    const csrfToken = tokenFactory();
    const now = clock();
    await repository.createSession({
      absoluteExpiresAt: new Date(
        now.getTime() + sessionAbsoluteMs,
      ).toISOString(),
      csrfHash: digest(csrfToken),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
      tokenHash: digest(sessionToken),
      userId: user.id,
    });
    return Object.freeze({
      body: Object.freeze({ user: freezeUser(user) }),
      cookie: `crm_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      csrfToken,
      sessionToken,
    });
  }

  function sessionWindow() {
    const now = clock();
    return {
      idleExpiresBefore: new Date(now.getTime() - sessionIdleMs).toISOString(),
      touchedAt: now.toISOString(),
    };
  }

  /** @param {string} sessionToken */
  async function authenticate(sessionToken) {
    const window = sessionWindow();
    const session = await repository.authenticateSession(
      digest(sessionToken),
      window.touchedAt,
      window.idleExpiresBefore,
    );
    if (!session) throw new Error('Invalid or expired session');
    return Object.freeze({
      userId: session.userId,
    });
  }

  /** @param {string} sessionToken @param {string} csrfToken */
  async function assertCsrf(sessionToken, csrfToken) {
    const window = sessionWindow();
    const session = await repository.validateCsrfSession(
      digest(sessionToken),
      digest(csrfToken),
      window.touchedAt,
      window.idleExpiresBefore,
    );
    if (!session) throw new Error('CSRF validation failed');
    return Object.freeze({
      userId: session.userId,
    });
  }

  /** @param {string} sessionToken */
  async function logout(sessionToken) {
    await repository.revokeSession(digest(sessionToken), clock().toISOString());
  }

  return Object.freeze({
    assertCsrf,
    authenticate,
    bootstrapAdmin,
    createOperationalUser,
    listUsers,
    login,
    logout,
    setUserDisabled,
    updateUser,
  });
}

/** @param {unknown} value @param {string} field */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * Translates the two shapes a duplicated e-mail can take — the in-memory
 * guard and the PostgreSQL `users_email_lower_unique` violation — into one
 * typed error the HTTP port can map without inspecting messages.
 *
 * @param {unknown} error
 */
function asDuplicateEmail(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code;
  const message = error instanceof Error ? error.message : '';
  if (code === '23505' || message === 'User exists') {
    return new AccessControlError(
      409,
      'EMAIL_ALREADY_REGISTERED',
      'Email already registered',
    );
  }
  return error;
}

export { createPostgresIdentityRepository } from './postgres.js';
export { PostgresOperationalUserPort } from './postgres-operational-user-port.js';
export { createPostgresAccessRepository } from './postgres-access.js';
export { createPostgresAuthenticationThrottle } from './authentication-throttle.js';
export {
  AUTOMATION_EXECUTOR_ACTIONS,
  AUTOMATION_EXECUTOR_ACTOR,
  createAutomationCredentials,
} from './automation-credentials.js';
export {
  AccessControlError,
  CAPABILITIES,
  OPERATIONAL_ACTIONS,
  authorize,
  createAccessControlService,
} from './authorization.js';
