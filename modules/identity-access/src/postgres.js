const bootstrapAdvisoryLock = 0x49414d31;
const base64urlPattern = /^[a-zA-Z0-9_-]+$/u;

/**
 * @typedef {'COMMERCIAL_ADMIN'|'PRIVACY_OFFICER'|'TECHNICAL_PRIVACY_EXECUTOR'} IdentityCapability
 * @typedef {'Atendimento'|'Vendedor'} OperationalFunction
 * @typedef {{ authTag: string, ciphertext: string, iv: string, keyVersion: number }} EncryptedSecret
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
 * @typedef {{
 *   encryptedSecret: EncryptedSecret,
 *   lastCounter: number | null,
 *   recoveryCodeHashes: Set<string>,
 * }} MfaFactor
 * @typedef {{
 *   query: (
 *     sql: string,
 *     values?: unknown[],
 *   ) => Promise<{rows: any[]}>
 * }} Queryable
 */

const userSelect = `
  SELECT
    u.id,
    u.email,
    u.password_hash,
    f.function_name,
    COALESCE(
      (
        SELECT array_agg(c.capability ORDER BY c.capability)
        FROM crm.user_capabilities AS c
        WHERE c.user_id = u.id
      ),
      ARRAY[]::text[]
    ) AS capabilities
  FROM crm.users AS u
  JOIN crm.user_functions AS f ON f.user_id = u.id
`;

const sessionReturning = `
  s.token_hash,
  s.user_id,
  s.csrf_hash,
  s.created_at,
  s.last_seen_at,
  s.absolute_expires_at,
  s.revoked_at,
  s.mfa_verified
`;

/**
 * Creates an adapter over a queryable PostgreSQL client. Callers must pass a
 * transaction-bound PoolClient for mutations that form one domain command.
 * The adapter deliberately never issues BEGIN, COMMIT, or ROLLBACK.
 *
 * @param {Queryable} database
 */
export function createPostgresIdentityRepository(database) {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A PostgreSQL queryable is required');
  }

  /** @param {IdentityUser} user */
  async function insertUser(user) {
    await database.query(
      `INSERT INTO crm.users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [user.id, user.email, user.passwordHash],
    );
    await database.query(
      `INSERT INTO crm.user_functions (user_id, function_name)
       VALUES ($1, $2)`,
      [user.id, user.functionName],
    );
    for (const capability of user.capabilities) {
      await database.query(
        `INSERT INTO crm.user_capabilities
           (user_id, capability, granted_by)
         VALUES ($1, $2, NULL)`,
        [user.id, capability],
      );
    }
  }

  return Object.freeze({
    /** @param {string} tokenHash @param {string} touchedAt @param {string} idleExpiresBefore */
    async authenticateSession(tokenHash, touchedAt, idleExpiresBefore) {
      const result = await database.query(
        `UPDATE crm.sessions AS s
         SET last_seen_at = $2
         FROM crm.users AS u
         WHERE s.token_hash = $1
           AND u.id = s.user_id
           AND u.disabled_at IS NULL
           AND s.revoked_at IS NULL
           AND s.absolute_expires_at > $2::timestamptz
           AND s.last_seen_at > $3::timestamptz
         RETURNING ${sessionReturning}`,
        [tokenHash, touchedAt, idleExpiresBefore],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    },

    /** @param {string} tokenHash @param {Date} now */
    async consumeInvitation(tokenHash, now) {
      const result = await database.query(
        `WITH candidate AS (
           SELECT token_hash
           FROM crm.invitations
           WHERE token_hash = $1
             AND consumed_at IS NULL
             AND expires_at > $2
           FOR UPDATE
         )
         UPDATE crm.invitations AS invitation
         SET consumed_at = $2
         FROM candidate
         WHERE invitation.token_hash = candidate.token_hash
         RETURNING invitation.id, invitation.email,
           invitation.function_name, invitation.token_hash,
           invitation.created_by, invitation.expires_at,
           invitation.consumed_at`,
        [tokenHash, now],
      );
      return result.rows[0] ? mapInvitation(result.rows[0]) : null;
    },

    /** @param {string} userId @param {string} codeHash */
    async consumeRecoveryCode(userId, codeHash) {
      const result = await database.query(
        `UPDATE crm.mfa_recovery_codes
         SET consumed_at = now()
         WHERE user_id = $1
           AND code_hash = $2
           AND consumed_at IS NULL
         RETURNING code_hash`,
        [userId, codeHash],
      );
      return result.rows.length === 1;
    },

    /** @param {IdentityInvitation} invitation */
    async createInvitation(invitation) {
      await database.query(
        `INSERT INTO crm.invitations
           (id, email, function_name, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          invitation.id,
          invitation.email,
          invitation.functionName,
          invitation.tokenHash,
          invitation.createdBy,
          invitation.expiresAt,
        ],
      );
    },

    /** @param {IdentitySession} session */
    async createSession(session) {
      await database.query(
        `INSERT INTO crm.sessions
           (token_hash, user_id, csrf_hash, created_at, last_seen_at,
            absolute_expires_at, revoked_at, mfa_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          session.tokenHash,
          session.userId,
          session.csrfHash,
          session.createdAt,
          session.lastSeenAt,
          session.absoluteExpiresAt,
          session.revokedAt,
          session.mfaVerified,
        ],
      );
    },

    /** @param {IdentityUser} user */
    async createUser(user) {
      await insertUser(user);
    },

    /** @param {string} userId @param {{encryptedSecret: EncryptedSecret, recoveryCodeHashes: Iterable<string>}} factor */
    async enrollFactor(userId, factor) {
      await database.query(
        `INSERT INTO crm.mfa_factors (user_id, encrypted_secret)
         VALUES ($1, $2)`,
        [userId, encodeEncryptedSecret(factor.encryptedSecret)],
      );
      for (const codeHash of factor.recoveryCodeHashes) {
        await database.query(
          `INSERT INTO crm.mfa_recovery_codes (user_id, code_hash)
           VALUES ($1, $2)`,
          [userId, codeHash],
        );
      }
    },

    /** @param {string} userId */
    async findFactor(userId) {
      const result = await database.query(
        `SELECT
           factor.encrypted_secret,
           factor.last_counter,
           COALESCE(
             array_agg(recovery.code_hash ORDER BY recovery.code_hash)
               FILTER (
                 WHERE recovery.code_hash IS NOT NULL
                   AND recovery.consumed_at IS NULL
               ),
             ARRAY[]::text[]
           ) AS recovery_code_hashes
         FROM crm.mfa_factors AS factor
         LEFT JOIN crm.mfa_recovery_codes AS recovery
           ON recovery.user_id = factor.user_id
         WHERE factor.user_id = $1
         GROUP BY factor.user_id, factor.encrypted_secret, factor.last_counter`,
        [userId],
      );
      return result.rows[0] ? mapFactor(result.rows[0]) : null;
    },

    /** @param {string} tokenHash */
    async findSession(tokenHash) {
      const result = await database.query(
        `SELECT
           token_hash,
           user_id,
           csrf_hash,
           created_at,
           last_seen_at,
           absolute_expires_at,
           revoked_at,
           mfa_verified
         FROM crm.sessions
         WHERE token_hash = $1`,
        [tokenHash],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    },

    /** @param {string} email */
    async findUserByEmail(email) {
      const result = await database.query(
        `${userSelect}
         WHERE lower(u.email) = lower($1)
           AND u.disabled_at IS NULL`,
        [email],
      );
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    /** @param {string} id */
    async findUserById(id) {
      const result = await database.query(`${userSelect} WHERE u.id = $1`, [
        id,
      ]);
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    },

    async hasUsers() {
      const result = await database.query(
        `SELECT EXISTS (SELECT 1 FROM crm.users) AS has_users`,
      );
      return result.rows[0]?.has_users === true;
    },

    /** @param {IdentityUser} user */
    async insertInitialUser(user) {
      await database.query('SELECT pg_advisory_xact_lock($1)', [
        bootstrapAdvisoryLock,
      ]);
      const existing = await database.query(
        `SELECT EXISTS (SELECT 1 FROM crm.users) AS has_users`,
      );
      if (existing.rows[0]?.has_users === true) return false;
      await insertUser(user);
      return true;
    },

    async inspect() {
      const [users, sessions, factors] = await Promise.all([
        database.query(`${userSelect} ORDER BY u.id`),
        database.query(
          `SELECT token_hash, user_id, csrf_hash, created_at, last_seen_at,
             absolute_expires_at, revoked_at, mfa_verified
           FROM crm.sessions
           ORDER BY token_hash`,
        ),
        database.query(
          `SELECT
             factor.encrypted_secret,
             factor.last_counter,
             COALESCE(
               array_agg(recovery.code_hash ORDER BY recovery.code_hash)
                 FILTER (
                   WHERE recovery.code_hash IS NOT NULL
                     AND recovery.consumed_at IS NULL
                 ),
               ARRAY[]::text[]
             ) AS recovery_code_hashes
           FROM crm.mfa_factors AS factor
           LEFT JOIN crm.mfa_recovery_codes AS recovery
             ON recovery.user_id = factor.user_id
           GROUP BY factor.user_id, factor.encrypted_secret, factor.last_counter
           ORDER BY factor.user_id`,
        ),
      ]);
      return {
        factors: factors.rows.map((row) => {
          const factor = mapFactor(row);
          return {
            encryptedSecret: factor.encryptedSecret,
            recoveryCodeHashes: [...factor.recoveryCodeHashes],
          };
        }),
        sessions: sessions.rows.map(mapSession),
        users: users.rows.map(mapUser),
      };
    },

    /** @param {string} tokenHash @param {string} revokedAt */
    async revokeSession(tokenHash, revokedAt) {
      await database.query(
        `UPDATE crm.sessions
         SET revoked_at = COALESCE(revoked_at, $2::timestamptz)
         WHERE token_hash = $1`,
        [tokenHash, revokedAt],
      );
    },

    /** @param {string} tokenHash @param {string} touchedAt */
    async touchSession(tokenHash, touchedAt) {
      await database.query(
        `UPDATE crm.sessions
         SET last_seen_at = $2
         WHERE token_hash = $1
           AND revoked_at IS NULL`,
        [tokenHash, touchedAt],
      );
    },

    /** @param {string} userId @param {number} counter */
    async useTotpCounter(userId, counter) {
      const result = await database.query(
        `UPDATE crm.mfa_factors
         SET last_counter = $2
         WHERE user_id = $1
           AND (last_counter IS NULL OR last_counter < $2)
         RETURNING last_counter`,
        [userId, counter],
      );
      return result.rows.length === 1;
    },

    /** @param {string} tokenHash @param {string} csrfHash @param {string} touchedAt @param {string} idleExpiresBefore */
    async validateCsrfSession(
      tokenHash,
      csrfHash,
      touchedAt,
      idleExpiresBefore,
    ) {
      const result = await database.query(
        `UPDATE crm.sessions AS s
         SET last_seen_at = $3
         FROM crm.users AS u
         WHERE s.token_hash = $1
           AND s.csrf_hash = $2
           AND u.id = s.user_id
           AND u.disabled_at IS NULL
           AND s.revoked_at IS NULL
           AND s.absolute_expires_at > $3::timestamptz
           AND s.last_seen_at > $4::timestamptz
         RETURNING ${sessionReturning}`,
        [tokenHash, csrfHash, touchedAt, idleExpiresBefore],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    },
  });
}

/** @param {EncryptedSecret} secret */
function encodeEncryptedSecret(secret) {
  if (secret.keyVersion !== 1) {
    throw new TypeError('Unsupported MFA envelope key version');
  }
  const parts = [secret.iv, secret.ciphertext, secret.authTag];
  if (parts.some((part) => !base64urlPattern.test(part))) {
    throw new TypeError('MFA envelope fields must use base64url');
  }
  return `v1.${parts.join('.')}`;
}

/** @param {unknown} value @returns {EncryptedSecret} */
function decodeEncryptedSecret(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Stored MFA envelope must be text');
  }
  const [version, iv, ciphertext, authTag, extra] = value.split('.');
  if (
    version !== 'v1' ||
    !iv ||
    !ciphertext ||
    !authTag ||
    [iv, ciphertext, authTag].some((part) => !base64urlPattern.test(part)) ||
    extra !== undefined
  ) {
    throw new TypeError('Stored MFA envelope is invalid');
  }
  return { authTag, ciphertext, iv, keyVersion: 1 };
}

/** @param {Record<string, unknown>} row @returns {IdentityUser} */
function mapUser(row) {
  return {
    capabilities: /** @type {IdentityCapability[]} */ (row.capabilities),
    email: /** @type {string} */ (row.email),
    functionName: /** @type {OperationalFunction} */ (row.function_name),
    id: /** @type {string} */ (row.id),
    passwordHash: /** @type {string} */ (row.password_hash),
  };
}

/** @param {Record<string, unknown>} row @returns {IdentityInvitation} */
function mapInvitation(row) {
  const consumedAt = toIsoString(row.consumed_at);
  return {
    ...(consumedAt ? { consumedAt } : {}),
    createdBy: /** @type {string} */ (row.created_by),
    email: /** @type {string} */ (row.email),
    expiresAt: new Date(/** @type {string | Date} */ (row.expires_at)),
    functionName: /** @type {OperationalFunction} */ (row.function_name),
    id: /** @type {string} */ (row.id),
    tokenHash: /** @type {string} */ (row.token_hash),
  };
}

/** @param {Record<string, unknown>} row @returns {IdentitySession} */
function mapSession(row) {
  return {
    absoluteExpiresAt: requireIsoString(row.absolute_expires_at),
    createdAt: requireIsoString(row.created_at),
    csrfHash: /** @type {string} */ (row.csrf_hash),
    lastSeenAt: requireIsoString(row.last_seen_at),
    mfaVerified: row.mfa_verified === true,
    revokedAt: toIsoString(row.revoked_at),
    tokenHash: /** @type {string} */ (row.token_hash),
    userId: /** @type {string} */ (row.user_id),
  };
}

/** @param {Record<string, unknown>} row @returns {MfaFactor} */
function mapFactor(row) {
  return {
    encryptedSecret: decodeEncryptedSecret(row.encrypted_secret),
    lastCounter:
      row.last_counter === null ? null : Number(row.last_counter ?? null),
    recoveryCodeHashes: new Set(
      /** @type {string[]} */ (row.recovery_code_hashes),
    ),
  };
}

/** @param {unknown} value */
function toIsoString(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError('PostgreSQL timestamp has an invalid type');
}

/** @param {unknown} value */
function requireIsoString(value) {
  const timestamp = toIsoString(value);
  if (timestamp === null) {
    throw new TypeError('PostgreSQL timestamp must not be null');
  }
  return timestamp;
}
