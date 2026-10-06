import { Pool } from 'pg';

import { loadMigrations } from './migrations.js';
import { withTransaction } from './transactions.js';

/**
 * @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }} Queryable
 * @typedef {{ checksum: string, phase: 'expand' | 'contract', version: string }} RequiredMigration
 */

/**
 * @param {Queryable} database
 * @param {readonly RequiredMigration[]} migrations
 */
export async function checkDatabaseReadiness(database, migrations) {
  await database.query('SELECT 1');
  const result = await database.query(
    'SELECT version, phase, checksum FROM crm_meta.schema_migrations ORDER BY version',
  );
  const applied = new Map(result.rows.map((row) => [row.version, row]));

  return migrations
    .filter(({ phase }) => phase === 'expand')
    .every(
      ({ checksum, version }) => applied.get(version)?.checksum === checksum,
    );
}

/**
 * @param {{ connectionString: string, applicationName?: string, connectionTimeoutMillis?: number, max?: number }} options
 */
export function createDatabase({
  connectionString,
  applicationName = 'crm-silmer-api',
  connectionTimeoutMillis = 5000,
  max = 10,
}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    application_name: applicationName,
    connectionTimeoutMillis,
    connectionString,
    max,
  });
  const migrations = loadMigrations();
  /**
   * @template T
   * @param {(client: import('pg').PoolClient) => Promise<T>} work
   */
  const transaction = (work) => withTransaction(pool, work);
  return Object.freeze({
    close: () => pool.end(),
    /** Dedicated session without BEGIN, e.g. an upload writer advisory lease.
     * @template T @param {(client: import('pg').PoolClient) => Promise<T>} work */
    connection: async (work) => {
      const client = await pool.connect();
      try {
        const result = await work(client);
        client.release();
        return result;
      } catch (error) {
        client.release(
          error instanceof Error ? error : new Error('Connection work failed'),
        );
        throw error;
      }
    },
    query: pool.query.bind(pool),
    readiness: async () => checkDatabaseReadiness(pool, await migrations),
    transaction,
  });
}
