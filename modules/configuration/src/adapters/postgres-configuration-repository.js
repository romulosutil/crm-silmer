import { createConfigurationVersion } from '../domain/configuration-version.js';

const CONFIGURATION_ADVISORY_LOCK = 0x43464731;

/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>}} Queryable
 * @typedef {{lockCurrent?: boolean, transaction?: Queryable}} RepositoryContext
 */

/** @param {unknown} candidate @param {string} field */
function requireQueryable(candidate, field) {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (candidate).query) !==
      'function'
  ) {
    throw new TypeError(`${field} must implement query`);
  }
  return /** @type {Queryable} */ (candidate);
}

/** @param {unknown} value @param {string} field */
function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Stored configuration ${field} is invalid`);
  }
  return value;
}

/** @param {unknown} value */
function isoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError('Stored configuration created_at is invalid');
}

/** @param {Record<string, unknown>} row */
function mapConfiguration(row) {
  return createConfigurationVersion({
    actorId: requireString(row.created_by, 'created_by'),
    createdAt: isoString(row.created_at),
    id: requireString(row.id, 'id'),
    reason: requireString(row.reason, 'reason'),
    values: row.values,
    version: Number(row.version),
  });
}

/**
 * PostgreSQL adapter for immutable configuration versions. The write service
 * requests a transaction-scoped advisory lock before reading the current
 * version, making expectedVersion validation serializable.
 *
 * @param {Queryable} queryable
 */
export function createPostgresConfigurationRepository(queryable) {
  const fallback = requireQueryable(queryable, 'queryable');

  /** @param {RepositoryContext} [context] */
  function database(context = {}) {
    return Object.hasOwn(context, 'transaction')
      ? requireQueryable(context.transaction, 'context.transaction')
      : fallback;
  }

  return Object.freeze({
    /** @param {ReturnType<typeof createConfigurationVersion>} version @param {RepositoryContext} context */
    async append(version, context) {
      const client = requireQueryable(
        context?.transaction,
        'context.transaction',
      );
      await client.query(
        `INSERT INTO crm.configuration_versions
           (id, version, created_by, reason, values, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          version.id,
          version.version,
          version.createdBy,
          version.reason,
          JSON.stringify(version.values),
          version.createdAt,
        ],
      );
    },

    /** @param {RepositoryContext} [context] */
    async findCurrent(context = {}) {
      const client = database(context);
      if (context.lockCurrent === true) {
        requireQueryable(context.transaction, 'context.transaction');
        await client.query('SELECT pg_advisory_xact_lock($1)', [
          CONFIGURATION_ADVISORY_LOCK,
        ]);
      }
      const result = await client.query(
        `SELECT id, version, created_by, reason, values, created_at
         FROM crm.configuration_versions
         ORDER BY version DESC
         LIMIT 1`,
      );
      return result.rows[0] ? mapConfiguration(result.rows[0]) : null;
    },
  });
}
