import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

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
 *   mfaVerified: boolean,
 *   revokedAt: string | null,
 *   tokenHash: string,
 *   userId: string,
 * }} IdentitySession
 * @typedef {{ authTag: string, ciphertext: string, iv: string, keyVersion: number }} EncryptedSecret
 * @typedef {{
 *   encryptedSecret: EncryptedSecret,
 *   lastCounter: number | null,
 *   recoveryCodeHashes: Set<string>,
 * }} MfaFactor
 * @typedef {{
 *   authenticateSession: (tokenHash: string, touchedAt: string, idleExpiresBefore: string) => IdentitySession | null | Promise<IdentitySession | null>,
 *   consumeInvitation: (tokenHash: string, now: Date) => IdentityInvitation | null | Promise<IdentityInvitation | null>,
 *   consumeRecoveryCode: (userId: string, codeHash: string) => boolean | Promise<boolean>,
 *   createInvitation: (invitation: IdentityInvitation) => void | Promise<void>,
 *   createSession: (session: IdentitySession) => void | Promise<void>,
 *   createUser: (user: IdentityUser) => void | Promise<void>,
 *   enrollFactor: (userId: string, factor: {encryptedSecret: EncryptedSecret, recoveryCodeHashes: Iterable<string>}) => void | Promise<void>,
 *   findFactor: (userId: string) => MfaFactor | null | Promise<MfaFactor | null>,
 *   findSession: (tokenHash: string) => IdentitySession | null | Promise<IdentitySession | null>,
 *   findUserByEmail: (email: string) => IdentityUser | null | undefined | Promise<IdentityUser | null | undefined>,
 *   findUserById: (id: string) => IdentityUser | null | Promise<IdentityUser | null>,
 *   hasUsers: () => boolean | Promise<boolean>,
 *   insertInitialUser: (user: IdentityUser) => boolean | Promise<boolean>,
 *   inspect: () => {
 *     factors: Array<{encryptedSecret: EncryptedSecret, recoveryCodeHashes: string[]}>,
 *     sessions: IdentitySession[],
 *     users: IdentityUser[],
 *   } | Promise<{
 *     factors: Array<{encryptedSecret: EncryptedSecret, recoveryCodeHashes: string[]}>,
 *     sessions: IdentitySession[],
 *     users: IdentityUser[],
 *   }>,
 *   revokeSession: (tokenHash: string, revokedAt: string) => void | Promise<void>,
 *   touchSession: (tokenHash: string, touchedAt: string) => void | Promise<void>,
 *   useTotpCounter: (userId: string, counter: number) => boolean | Promise<boolean>,
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
/** @type {Set<IdentityCapability>} */
const PRIVILEGED_CAPABILITIES = new Set([
  'COMMERCIAL_ADMIN',
  'TECHNICAL_PRIVACY_EXECUTOR',
]);
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

/** @param {Buffer} secret @param {Buffer} key @returns {Readonly<EncryptedSecret>} */
function encryptSecret(secret, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Object.freeze({
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
  });
}

/** @param {EncryptedSecret} encrypted @param {Buffer} key */
function decryptSecret(encrypted, key) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]);
}

/** @param {Buffer} secret @param {Date} time @param {number} [stepSeconds] */
function totp(secret, time, stepSeconds = 30) {
  const counter = Math.floor(time.getTime() / 1000 / stepSeconds);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(value).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return { code: String(binary % 1_000_000).padStart(6, '0'), counter };
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
  /** @type {Map<string, MfaFactor>} */
  const factors = new Map();

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
    /** @param {string} userId @param {string} codeHash */
    consumeRecoveryCode(userId, codeHash) {
      const factor = factors.get(userId);
      if (!factor || !factor.recoveryCodeHashes.has(codeHash)) return false;
      factor.recoveryCodeHashes.delete(codeHash);
      return true;
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
    /** @param {string} userId @param {{encryptedSecret: EncryptedSecret, recoveryCodeHashes: Iterable<string>}} factor */
    enrollFactor(userId, factor) {
      factors.set(userId, {
        ...factor,
        lastCounter: null,
        recoveryCodeHashes: new Set(factor.recoveryCodeHashes),
      });
    },
    /** @param {string} userId */
    findFactor(userId) {
      return factors.get(userId) ?? null;
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
        factors: [...factors.values()].map((factor) => ({
          encryptedSecret: factor.encryptedSecret,
          recoveryCodeHashes: [...factor.recoveryCodeHashes],
        })),
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
    /** @param {string} userId @param {number} counter */
    useTotpCounter(userId, counter) {
      const factor = factors.get(userId);
      if (!factor || (factor.lastCounter ?? -1) >= counter) return false;
      factor.lastCounter = counter;
      return true;
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
 *   envelopeKey: Buffer,
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
  envelopeKey,
  idFactory = (prefix) => `${prefix}-${randomBytes(16).toString('hex')}`,
  passwordParameters = DEFAULT_PASSWORD_PARAMETERS,
  passwordVerifier = verifyPassword,
  repository,
  sessionAbsoluteMs = 12 * 60 * 60 * 1000,
  sessionIdleMs = 30 * 60 * 1000,
  tokenFactory = () => randomBytes(32).toString('base64url'),
  unknownUserPasswordHash = UNKNOWN_USER_PASSWORD_HASH,
}) {
  if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
    throw new TypeError('A 32-byte envelope key is required');
  }
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

  /** @param {{actorId: string, correlationId: string, reason: string, secret?: Buffer}} input */
  async function enrollTotp({
    actorId,
    correlationId,
    reason,
    secret = randomBytes(20),
  }) {
    requireNonEmptyString(actorId, 'actorId');
    requireNonEmptyString(correlationId, 'correlationId');
    requireNonEmptyString(reason, 'reason');
    if (!Buffer.isBuffer(secret) || secret.length < 20) {
      throw new TypeError('TOTP secret must contain at least 20 bytes');
    }
    const user = await repository.findUserById(actorId);
    if (!user) throw new Error('User not found');
    const recoveryCodes = Array.from({ length: 8 }, () =>
      randomBytes(9).toString('base64url'),
    );
    await repository.enrollFactor(user.id, {
      encryptedSecret: encryptSecret(secret, envelopeKey),
      recoveryCodeHashes: recoveryCodes.map(digest),
    });
    await record({
      action: 'identity.mfa.enrolled',
      actor: user.id,
      correlationId,
      reason,
      target: { id: user.id, type: 'user' },
      version: 1,
    });
    return Object.freeze({ recoveryCodes: Object.freeze(recoveryCodes) });
  }

  /**
   * @param {IdentityUser} user
   * @param {{recoveryCode?: string, totpCode?: string}} input
   */
  async function verifyMfa(user, { recoveryCode, totpCode }) {
    if (
      !user.capabilities.some((capability) =>
        PRIVILEGED_CAPABILITIES.has(capability),
      )
    ) {
      return false;
    }
    const factor = await repository.findFactor(user.id);
    if (!factor) throw new Error('MFA enrollment required');
    if (
      recoveryCode &&
      (await repository.consumeRecoveryCode(user.id, digest(recoveryCode)))
    ) {
      return true;
    }
    if (typeof totpCode === 'string') {
      const secret = decryptSecret(factor.encryptedSecret, envelopeKey);
      for (const drift of [-1, 0, 1]) {
        const candidate = totp(
          secret,
          new Date(clock().getTime() + drift * 30_000),
        );
        if (
          constantTimeEqual(totpCode, candidate.code) &&
          (await repository.useTotpCounter(user.id, candidate.counter))
        ) {
          return true;
        }
      }
    }
    throw new Error('Invalid MFA code');
  }

  /** @param {{
   *   email: string,
   *   password: string,
   *   recoveryCode?: string,
   *   totpCode?: string,
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
    const mfaRequired = user.capabilities.some((capability) =>
      PRIVILEGED_CAPABILITIES.has(capability),
    );
    const mfaVerified = mfaRequired ? await verifyMfa(user, input) : false;
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
      mfaVerified,
      revokedAt: null,
      tokenHash: digest(sessionToken),
      userId: user.id,
    });
    return Object.freeze({
      body: Object.freeze({ mfaVerified, user: freezeUser(user) }),
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
      mfaVerified: session.mfaVerified,
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
      mfaVerified: session.mfaVerified,
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
    /** @param {Buffer} secret */
    currentTotpForTesting: (secret) => totp(secret, clock()).code,
    enrollTotp,
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
export { createPostgresAccessRepository } from './postgres-access.js';
export { createPostgresAuthenticationThrottle } from './authentication-throttle.js';
export {
  AccessControlError,
  CAPABILITIES,
  authorize,
  createAccessControlService,
} from './authorization.js';
