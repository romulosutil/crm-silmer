import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadMigrations, migrate } from '../modules/database/src/index.js';

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = next;
    await previous;
    return release;
  }
}

class MigrationPool {
  constructor() {
    this.applied = new Map();
    /** @type {string[]} */
    this.executed = [];
    this.mutex = new Mutex();
  }

  async connect() {
    return new MigrationClient(this);
  }
}

class MigrationClient {
  /** @param {MigrationPool} pool */
  constructor(pool) {
    this.pool = pool;
    /** @type {(() => void) | undefined} */
    this.releaseLock = undefined;
  }

  /**
   * @param {string} sql
   * @param {unknown[]} values
   */
  async query(sql, values = []) {
    if (sql.includes('pg_advisory_lock')) {
      this.releaseLock = await this.pool.mutex.acquire();
      return { rows: [] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      this.releaseLock?.();
      this.releaseLock = undefined;
      return { rows: [{ unlocked: true }] };
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS crm_meta.schema_migrations')) {
      return { rows: [] };
    }
    if (sql.startsWith('SELECT version,')) {
      return { rows: [...this.pool.applied.values()] };
    }
    if (sql.startsWith('INSERT INTO crm_meta.schema_migrations')) {
      const [version, name, phase, checksum] = values;
      this.pool.applied.set(version, { checksum, name, phase, version });
      return { rows: [] };
    }
    if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
      this.pool.executed.push(sql);
    }
    return { rows: [] };
  }

  release() {
    this.releaseLock?.();
  }
}

const expandOne = {
  checksum: 'checksum-1',
  name: 'foundation',
  phase: /** @type {const} */ ('expand'),
  sql: 'CREATE TABLE foundation (id integer)',
  version: '0001',
};
const expandTwo = {
  checksum: 'checksum-2',
  name: 'upgrade',
  phase: /** @type {const} */ ('expand'),
  sql: 'ALTER TABLE foundation ADD COLUMN name text',
  version: '0002',
};
const contractThree = {
  checksum: 'checksum-3',
  name: 'retire_legacy',
  phase: /** @type {const} */ ('contract'),
  sql: 'DROP VIEW legacy_foundation',
  version: '0003',
};

test('migrates an empty database, upgrades once, and is idempotent', async () => {
  const pool = new MigrationPool();

  assert.deepEqual(await migrate(pool, { migrations: [expandOne] }), {
    applied: ['0001'],
    phase: 'expand',
  });
  assert.deepEqual(
    await migrate(pool, { migrations: [expandOne, expandTwo] }),
    { applied: ['0002'], phase: 'expand' },
  );
  assert.deepEqual(
    await migrate(pool, { migrations: [expandOne, expandTwo] }),
    { applied: [], phase: 'expand' },
  );
  assert.deepEqual(pool.executed, [expandOne.sql, expandTwo.sql]);
});

test('serializes concurrent migration runs with a session advisory lock', async () => {
  const pool = new MigrationPool();

  const results = await Promise.all([
    migrate(pool, { migrations: [expandOne, expandTwo] }),
    migrate(pool, { migrations: [expandOne, expandTwo] }),
  ]);

  assert.equal(results.flatMap(({ applied }) => applied).length, 2);
  assert.deepEqual(pool.executed, [expandOne.sql, expandTwo.sql]);
});

test('keeps contract migrations explicit and rejects changed history', async () => {
  const pool = new MigrationPool();
  await migrate(pool, { migrations: [expandOne, contractThree] });
  assert.deepEqual(pool.executed, [expandOne.sql]);

  await migrate(pool, {
    migrations: [expandOne, contractThree],
    phase: 'contract',
  });
  assert.deepEqual(pool.executed, [expandOne.sql, contractThree.sql]);

  await assert.rejects(
    migrate(pool, {
      migrations: [{ ...expandOne, checksum: 'changed' }],
    }),
    /checksum/iu,
  );
});

test('loads versioned forward-only migrations in deterministic order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crm-migrations-'));
  try {
    await writeFile(
      join(directory, '0002_upgrade.expand.sql'),
      expandTwo.sql,
      'utf8',
    );
    await writeFile(
      join(directory, '0001_foundation.expand.sql'),
      expandOne.sql,
      'utf8',
    );

    const migrations = await loadMigrations(directory);
    assert.deepEqual(
      migrations.map(({ name, phase, version }) => ({ name, phase, version })),
      [
        { name: 'foundation', phase: 'expand', version: '0001' },
        { name: 'upgrade', phase: 'expand', version: '0002' },
      ],
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
