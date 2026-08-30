import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const migrationNamePattern =
  /^(?<version>\d{4})_(?<name>[a-z0-9_]+)\.(?<phase>expand|contract)\.sql$/u;
const advisoryLockKey = 0x43524d53;
const bootstrapSql = `
  CREATE SCHEMA IF NOT EXISTS crm_meta;
  CREATE TABLE IF NOT EXISTS crm_meta.schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    phase text NOT NULL CHECK (phase IN ('expand', 'contract')),
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

/**
 * @typedef {'expand' | 'contract'} MigrationPhase
 * @typedef {{ version: string, name: string, phase: MigrationPhase, checksum: string, sql: string }} Migration
 * @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>, release: () => void }} MigrationClient
 * @typedef {{ connect: () => Promise<MigrationClient> }} MigrationPool
 */

/** @param {string} sql */
function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * @param {string | URL} [directory]
 * @returns {Promise<Migration[]>}
 */
export async function loadMigrations(
  directory = new URL('../migrations/', import.meta.url),
) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {Migration[]} */
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = migrationNamePattern.exec(entry.name);
    if (!match?.groups) {
      throw new Error(`Invalid migration filename: ${entry.name}`);
    }

    const sql = await readFile(
      new URL(entry.name, ensureDirectoryUrl(directory)),
      'utf8',
    );
    migrations.push({
      checksum: checksum(sql),
      name: match.groups.name,
      phase: /** @type {MigrationPhase} */ (match.groups.phase),
      sql,
      version: match.groups.version,
    });
  }

  return normalizeMigrationPlan(migrations);
}

/** @param {Migration[]} migrations */
function normalizeMigrationPlan(migrations) {
  const plan = [...migrations].sort((left, right) =>
    left.version.localeCompare(right.version),
  );
  const versions = new Set();
  for (const migration of plan) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
  return plan;
}

/** @param {string | URL} directory */
function ensureDirectoryUrl(directory) {
  const url =
    directory instanceof URL
      ? directory
      : new URL(`file:///${directory.replaceAll('\\', '/')}`);
  return url.href.endsWith('/') ? url : new URL(`${url.href}/`);
}

/**
 * Applies forward-only migrations under a PostgreSQL session advisory lock.
 * Contract migrations are never selected unless explicitly requested.
 *
 * @param {MigrationPool} pool
 * @param {{ migrations: Migration[], phase?: MigrationPhase }} options
 */
export async function migrate(pool, { migrations, phase = 'expand' }) {
  if (phase !== 'expand' && phase !== 'contract') {
    throw new Error(`Unsupported migration phase: ${phase}`);
  }

  const client = await pool.connect();
  /** @type {unknown} */
  let failure;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLockKey]);
    await client.query(bootstrapSql);
    const plan = normalizeMigrationPlan(migrations);
    const result = await client.query(
      'SELECT version, name, phase, checksum FROM crm_meta.schema_migrations ORDER BY version',
    );
    const applied = new Map(result.rows.map((row) => [row.version, row]));

    for (const migration of plan) {
      const existing = applied.get(migration.version);
      if (
        existing &&
        (existing.checksum !== migration.checksum ||
          existing.name !== migration.name ||
          existing.phase !== migration.phase)
      ) {
        throw new Error(
          `Migration ${migration.version} does not match applied history or checksum`,
        );
      }
    }

    const pending = plan.filter(
      (migration) =>
        migration.phase === phase && !applied.has(migration.version),
    );
    for (const migration of pending) {
      await applyMigration(client, migration);
    }

    return { applied: pending.map(({ version }) => version), phase };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
    } catch (error) {
      if (failure === undefined) throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * @param {MigrationClient} client
 * @param {Migration} migration
 */
async function applyMigration(client, migration) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO crm_meta.schema_migrations
        (version, name, phase, checksum)
       VALUES ($1, $2, $3, $4)`,
      [migration.version, migration.name, migration.phase, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the migration failure.
    }
    throw error;
  }
}
