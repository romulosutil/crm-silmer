const bootstrapAdvisoryLock = 0x49414d31;

/**
 * @typedef {'COMMERCIAL_ADMIN'|'PRIVACY_OFFICER'|'TECHNICAL_PRIVACY_EXECUTOR'} IdentityCapability
 * @typedef {'Atendimento'|'Vendedor'} OperationalFunction
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
  s.revoked_at
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
             absolute_expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.tokenHash,
          session.userId,
          session.csrfHash,
          session.createdAt,
          session.lastSeenAt,
          session.absoluteExpiresAt,
          session.revokedAt,
        ],
      );
    },

    /** @param {IdentityUser} user */
    async createUser(user) {
      await insertUser(user);
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
            revoked_at
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
      const [users, sessions] = await Promise.all([
        database.query(`${userSelect} ORDER BY u.id`),
        database.query(
          `SELECT token_hash, user_id, csrf_hash, created_at, last_seen_at,
              absolute_expires_at, revoked_at
           FROM crm.sessions
           ORDER BY token_hash`,
        ),
      ]);
      return {
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
    revokedAt: toIsoString(row.revoked_at),
    tokenHash: /** @type {string} */ (row.token_hash),
    userId: /** @type {string} */ (row.user_id),
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
