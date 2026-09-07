import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * @typedef {'COMMERCIAL_ADMIN'|'PRIVACY_OFFICER'|'TECHNICAL_PRIVACY_EXECUTOR'} IdentityCapability
 * @typedef {'Atendimento'|'Vendedor'} OperationalFunction
 * @typedef {{ memory: number, parallelism: number, passes: number, tagLength?: number }} PasswordParameters
 * @typedef {{
 *   capabilities: IdentityCapability[],
 *   email: string,
 *   functionName: OperationalFunction,
 *   id: string,
 *   passwordHash: string,
 * }} IdentityUser
 * @typedef {{
 *   consumedAt?: string,
 *   createdBy: string,
 *   email: string,
 *   expiresAt: Date,
 *   functionName: OperationalFunction,
 *   id: string,
 *   tokenHash: string,
 * }} IdentityInvitation
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
 *   consumeInvitation: (tokenHash: string, now: Date) => IdentityInvitation | null | Promise<IdentityInvitation | null>,
 *   createInvitation: (invitation: IdentityInvitation) => void | Promise<void>,
 *   createSession: (session: IdentitySession) => void | Promise<void>,
 *   createUser: (user: IdentityUser) => void | Promise<void>,
 *   findSession: (tokenHash: string) => IdentitySession | null | Promise<IdentitySession | null>,
 *   findUserByEmail: (email: string) => IdentityUser | null | undefined | Promise<IdentityUser | null | undefined>,
 *   findUserById: (id: string) => IdentityUser | null | Promise<IdentityUser | null>,
 *   hasUsers: () => boolean | Promise<boolean>,
 *   insertInitialUser: (user: IdentityUser) => boolean | Promise<boolean>,
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
const FUNCTIONS = new Set(['Atendimento', 'Vendedor']);

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
  if (typeof password !== 'string' || password.length < 16) {
    throw new TypeError('Password must contain at least 16 characters');
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
    functionName: user.functionName,
    id: user.id,
  });
}

/** @returns {IdentityRepository} */
export function createInMemoryIdentityRepository() {
  /** @type {Map<string, IdentityUser>} */
  const users = new Map();
  /** @type {Map<string, string>} */
  const emails = new Map();
  /** @type {Map<string, IdentityInvitation>} */
  const invitations = new Map();
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
    /** @param {string} tokenHash @param {Date} now */
    consumeInvitation(tokenHash, now) {
      const invitation = invitations.get(tokenHash);
      if (
        !invitation ||
        invitation.consumedAt ||
        invitation.expiresAt.getTime() <= now.getTime()
      ) {
        return null;
      }
      invitation.consumedAt = now.toISOString();
      return { ...invitation };
    },
    /** @param {IdentityInvitation} invitation */
    createInvitation(invitation) {
      invitations.set(invitation.tokenHash, { ...invitation });
    },
    /** @param {IdentitySession} session */
    createSession(session) {
      sessions.set(session.tokenHash, { ...session });
    },
    /** @param {IdentityUser} user */
    createUser(user) {
      if (emails.has(user.email.toLowerCase())) throw new Error('User exists');
      users.set(user.id, { ...user, capabilities: [...user.capabilities] });
      emails.set(user.email.toLowerCase(), user.id);
    },
    /** @param {string} tokenHash */
    findSession(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    /** @param {string} email */
    findUserByEmail(email) {
      const id = emails.get(email.toLowerCase());
      return id ? users.get(id) : null;
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
    /** @param {string} tokenHash @param {string} revokedAt */
    revokeSession(tokenHash, revokedAt) {
      const session = sessions.get(tokenHash);
      if (session) session.revokedAt = revokedAt;
    },
    /** @param {string} tokenHash @param {string} touchedAt */
    touchSession(tokenHash, touchedAt) {
      const session = sessions.get(tokenHash);
      if (session) session.lastSeenAt = touchedAt;
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
   *   functionName: OperationalFunction,
   *   password: string,
   *   reason: string,
   * }} input */
  async function bootstrapAdmin(input) {
    requireNonEmptyString(input.email, 'email');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    if (!FUNCTIONS.has(input.functionName)) throw new Error('Invalid function');
    const passwordHash = await hashPassword(input.password, passwordParameters);
    /** @type {IdentityUser} */
    const user = {
      capabilities: ['COMMERCIAL_ADMIN'],
      email: input.email,
      functionName: input.functionName,
      id: idFactory('user'),
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

  /** @param {{
   *   actorId: string,
   *   correlationId: string,
   *   email: string,
   *   expiresAt: Date,
   *   functionName: OperationalFunction,
   *   reason: string,
   * }} input */
  async function createInvitation(input) {
    requireNonEmptyString(input.actorId, 'actorId');
    requireNonEmptyString(input.email, 'email');
    requireNonEmptyString(input.reason, 'reason');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const actor = await repository.findUserById(input.actorId);
    if (!actor?.capabilities.includes('COMMERCIAL_ADMIN')) {
      throw new Error('Invitation requires COMMERCIAL_ADMIN');
    }
    if (!FUNCTIONS.has(input.functionName)) throw new Error('Invalid function');
    if (!(input.expiresAt instanceof Date) || input.expiresAt <= clock()) {
      throw new Error('Invitation expiry must be in the future');
    }
    const token = tokenFactory();
    const invitationId = idFactory('invitation');
    await repository.createInvitation({
      createdBy: actor.id,
      email: input.email,
      expiresAt: input.expiresAt,
      functionName: input.functionName,
      id: invitationId,
      tokenHash: digest(token),
    });
    await record({
      action: 'identity.invitation.created',
      actor: actor.id,
      correlationId: input.correlationId,
      reason: input.reason,
      target: { id: invitationId, type: 'invitation' },
      version: 1,
    });
    return Object.freeze({ expiresAt: input.expiresAt.toISOString(), token });
  }

  /** @param {{correlationId: string, password: string, token: string}} input */
  async function acceptInvitation(input) {
    requireNonEmptyString(input.token, 'token');
    requireNonEmptyString(input.correlationId, 'correlationId');
    const passwordHash = await hashPassword(input.password, passwordParameters);
    const invitation = await repository.consumeInvitation(
      digest(input.token),
      clock(),
    );
    if (!invitation) throw new Error('Invitation is invalid or expired');
    /** @type {IdentityUser} */
    const user = {
      capabilities: [],
      email: invitation.email,
      functionName: invitation.functionName,
      id: idFactory('user'),
      passwordHash,
    };
    await repository.createUser(user);
    await record({
      action: 'identity.invitation.accepted',
      actor: user.id,
      correlationId: input.correlationId,
      reason: 'Authorized invitation accepted',
      target: { id: user.id, type: 'user' },
      version: 1,
    });
    return freezeUser(user);
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
    acceptInvitation,
    assertCsrf,
    authenticate,
    bootstrapAdmin,
    createInvitation,
    login,
    logout,
  });
}

/** @param {unknown} value @param {string} field */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
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
  authorize,
  createAccessControlService,
} from './authorization.js';
