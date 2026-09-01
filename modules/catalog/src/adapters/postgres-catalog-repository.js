import { createPublishedCatalogVersion } from '../domain/catalog-version.js';
import { CatalogConflictError } from '../domain/errors.js';

const CATALOG_ADVISORY_LOCK = 0x43415431;

/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: Array<Record<string, unknown>>}>}} Queryable
 * @typedef {{expectedLatestNumber?: number, lockLatest?: boolean, transaction?: Queryable}} RepositoryContext
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
    throw new TypeError(`Stored catalog ${field} is invalid`);
  }
  return value;
}

/** @param {unknown} value */
function isoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError('Stored catalog timestamp is invalid');
}

/** @param {Record<string, unknown>} row */
function mapCatalog(row) {
  return createPublishedCatalogVersion({
    id: requireString(row.id, 'id'),
    number: Number(row.number),
    publishedAt: isoString(row.published_at),
    publishedBy: requireString(row.published_by, 'published_by'),
    reason: requireString(row.reason, 'reason'),
    values: {
      materials: row.materials,
      models: row.models,
      products: row.products,
      techniques: row.techniques,
    },
  });
}

/**
 * PostgreSQL adapter that stages every catalog as a draft, inserts its
 * normalized entries and publishes it in the caller's transaction.
 *
 * @param {Queryable} queryable
 */
export function createPostgresCatalogRepository(queryable) {
  const fallback = requireQueryable(queryable, 'queryable');

  /** @param {RepositoryContext} [context] */
  function database(context = {}) {
    return Object.hasOwn(context, 'transaction')
      ? requireQueryable(context.transaction, 'context.transaction')
      : fallback;
  }

  return Object.freeze({
    /** @param {ReturnType<typeof createPublishedCatalogVersion>} version @param {RepositoryContext} context */
    async append(version, context) {
      const client = requireQueryable(
        context?.transaction,
        'context.transaction',
      );
      const expectedLatestNumber = context.expectedLatestNumber;
      if (!Number.isSafeInteger(expectedLatestNumber)) {
        throw new TypeError('context.expectedLatestNumber must be an integer');
      }
      await client.query('SELECT pg_advisory_xact_lock($1)', [
        CATALOG_ADVISORY_LOCK,
      ]);
      const latest = await client.query(
        'SELECT COALESCE(MAX(number), 0) AS number FROM crm.catalog_versions',
      );
      const currentLatestNumber = Number(latest.rows[0]?.number ?? 0);
      if (currentLatestNumber !== expectedLatestNumber) {
        throw new CatalogConflictError(
          /** @type {number} */ (expectedLatestNumber),
          currentLatestNumber,
        );
      }

      await client.query(
        `INSERT INTO crm.catalog_versions
           (id, number, status, created_by, reason, created_at)
         VALUES ($1, $2, 'draft', $3, $4, $5)`,
        [
          version.id,
          version.number,
          version.publishedBy,
          version.reason,
          version.publishedAt,
        ],
      );
      await insertEntries(
        client,
        'catalog_products',
        version.id,
        version.values.products,
      );
      await insertModels(client, version.id, version.values.models);
      await insertEntries(
        client,
        'catalog_materials',
        version.id,
        version.values.materials,
      );
      await insertEntries(
        client,
        'catalog_techniques',
        version.id,
        version.values.techniques,
      );
      const published = await client.query(
        `UPDATE crm.catalog_versions
         SET status = 'published', published_by = $2, published_at = $3
         WHERE id = $1 AND status = 'draft'
         RETURNING id`,
        [version.id, version.publishedBy, version.publishedAt],
      );
      if (published.rows.length !== 1) {
        throw new Error('Catalog draft could not be published');
      }
    },

    /** @param {string} id */
    async findById(id) {
      const result = await fallback.query(
        `SELECT
           version.id,
           version.number,
           version.reason,
           version.published_by,
           version.published_at,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'code', entry.code, 'name', entry.name) ORDER BY entry.code), '[]'::jsonb)
            FROM crm.catalog_products AS entry
            WHERE entry.catalog_version_id = version.id) AS products,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'code', entry.code, 'name', entry.name,
              'productCode', entry.product_code) ORDER BY entry.code), '[]'::jsonb)
            FROM crm.catalog_models AS entry
            WHERE entry.catalog_version_id = version.id) AS models,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'code', entry.code, 'name', entry.name) ORDER BY entry.code), '[]'::jsonb)
            FROM crm.catalog_materials AS entry
            WHERE entry.catalog_version_id = version.id) AS materials,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'code', entry.code, 'name', entry.name) ORDER BY entry.code), '[]'::jsonb)
            FROM crm.catalog_techniques AS entry
            WHERE entry.catalog_version_id = version.id) AS techniques
         FROM crm.catalog_versions AS version
         WHERE version.id = $1 AND version.status = 'published'`,
        [id],
      );
      return result.rows[0] ? mapCatalog(result.rows[0]) : null;
    },

    /** @param {RepositoryContext} [context] */
    async list(context = {}) {
      const client = database(context);
      if (context.lockLatest === true) {
        requireQueryable(context.transaction, 'context.transaction');
        await client.query('SELECT pg_advisory_xact_lock($1)', [
          CATALOG_ADVISORY_LOCK,
        ]);
      }
      const result = await client.query(
        `SELECT number
         FROM crm.catalog_versions
         WHERE status = 'published'
         ORDER BY number`,
      );
      return result.rows.map((row) => ({ number: Number(row.number) }));
    },
  });
}

/** @param {Queryable} client @param {string} table @param {string} versionId @param {readonly {code: string, name: string}[]} entries */
async function insertEntries(client, table, versionId, entries) {
  for (const entry of entries) {
    await client.query(
      `INSERT INTO crm.${table} (catalog_version_id, code, name)
       VALUES ($1, $2, $3)`,
      [versionId, entry.code, entry.name],
    );
  }
}

/** @param {Queryable} client @param {string} versionId @param {readonly {code: string, name: string, productCode: string}[]} models */
async function insertModels(client, versionId, models) {
  for (const model of models) {
    await client.query(
      `INSERT INTO crm.catalog_models
         (catalog_version_id, code, name, product_code)
       VALUES ($1, $2, $3, $4)`,
      [versionId, model.code, model.name, model.productCode],
    );
  }
}
