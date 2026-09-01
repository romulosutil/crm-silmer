import { createHmac } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const POLICIES = Object.freeze({
  account: Object.freeze({
    baseDelaySeconds: 30,
    maximumDelaySeconds: 900,
    threshold: 3,
  }),
  network: Object.freeze({
    baseDelaySeconds: 60,
    maximumDelaySeconds: 900,
    threshold: 20,
  }),
});

/**
 * @typedef {'account'|'network'} ThrottleScope
 * @typedef {{email: string, network: string}} AuthenticationSubject
 * @typedef {{
 *   query: (
 *     sql: string,
 *     values?: unknown[],
 *   ) => Promise<{rows: Array<Record<string, unknown>>}>
 * }} Queryable
 */

/**
 * Stores HMAC-derived throttle subjects so email and network identifiers never
 * enter the throttle table or its diagnostics.
 *
 * @param {Queryable} database
 * @param {{clock?: () => Date, hmacKey: Buffer}} options
 */
export function createPostgresAuthenticationThrottle(
  database,
  { clock = () => new Date(), hmacKey },
) {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A PostgreSQL queryable is required');
  }
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length < 32) {
    throw new TypeError('A throttle HMAC key of at least 32 bytes is required');
  }
  const key = Buffer.from(hmacKey);

  /** @param {ThrottleScope} scope @param {string} subject */
  function digestSubject(scope, subject) {
    requireSubject(subject, scope);
    return createHmac('sha256', key)
      .update(`${scope}\u0000${subject.trim().toLowerCase()}`, 'utf8')
      .digest('hex');
  }

  /** @param {AuthenticationSubject} subject */
  function hashes(subject) {
    if (!subject || typeof subject !== 'object') {
      throw new TypeError('Authentication subject is required');
    }
    return {
      account: digestSubject('account', subject.email),
      network: digestSubject('network', subject.network),
    };
  }

  return Object.freeze({
    /** @param {AuthenticationSubject} subject */
    async check(subject) {
      const subjectHashes = hashes(subject);
      const now = clock();
      const result = await database.query(
        `SELECT blocked_until
         FROM crm.authentication_throttles
         WHERE ((scope = 'account' AND subject_hash = $1)
             OR (scope = 'network' AND subject_hash = $2))
           AND blocked_until > $3::timestamptz
         ORDER BY blocked_until DESC`,
        [subjectHashes.account, subjectHashes.network, now],
      );
      const retryAt = result.rows
        .map(({ blocked_until: blockedUntil }) => toIsoString(blockedUntil))
        .filter((value) => value !== null)
        .sort()
        .at(-1);
      return retryAt
        ? Object.freeze({ allowed: false, retryAt })
        : Object.freeze({ allowed: true, retryAt: null });
    },

    /** @param {AuthenticationSubject} subject */
    async recordFailure(subject) {
      const subjectHashes = hashes(subject);
      const now = clock();
      const windowCutoff = new Date(now.getTime() - WINDOW_MS);
      for (const scope of /** @type {ThrottleScope[]} */ ([
        'account',
        'network',
      ])) {
        const policy = POLICIES[scope];
        await database.query(
          `INSERT INTO crm.authentication_throttles AS throttle
             (scope, subject_hash, failure_count, window_started_at,
              blocked_until, updated_at)
           VALUES ($1, $2, 1, $3, NULL, $3)
           ON CONFLICT (scope, subject_hash) DO UPDATE
           SET
             failure_count = CASE
               WHEN throttle.updated_at < $4 THEN 1
               ELSE throttle.failure_count + 1
             END,
             window_started_at = CASE
               WHEN throttle.updated_at < $4 THEN $3
               ELSE throttle.window_started_at
             END,
             blocked_until = CASE
               WHEN (CASE
                 WHEN throttle.updated_at < $4 THEN 1
                 ELSE throttle.failure_count + 1
               END) >= $5
               THEN $3::timestamptz + make_interval(secs => LEAST(
                 $7::integer,
                 $6::integer * power(2, GREATEST(0, (CASE
                   WHEN throttle.updated_at < $4 THEN 1
                   ELSE throttle.failure_count + 1
                 END) - $5))::integer
               ))
               ELSE NULL
             END,
             updated_at = $3`,
          [
            scope,
            subjectHashes[scope],
            now,
            windowCutoff,
            policy.threshold,
            policy.baseDelaySeconds,
            policy.maximumDelaySeconds,
          ],
        );
      }
    },

    /** @param {string} email */
    async resetAccount(email) {
      await database.query(
        `DELETE FROM crm.authentication_throttles
         WHERE scope = $1 AND subject_hash = $2`,
        ['account', digestSubject('account', email)],
      );
    },
  });
}

/** @param {unknown} value @param {string} field */
function requireSubject(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} authentication subject is required`);
  }
}

/** @param {unknown} value */
function toIsoString(value) {
  if (value === undefined || value === null) return null;
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Invalid persisted authentication throttle timestamp');
  }
  return timestamp.toISOString();
}
