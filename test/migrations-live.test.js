import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { createServerApi } from '../apps/api/src/server.js';
import {
  checkDatabaseReadiness,
  loadMigrations,
  migrate,
} from '../modules/database/src/index.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;

if (connectionString) {
  test('PostgreSQL live: zero, upgrade, concurrency, readiness and app rollback', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live migration test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 6 });
    const builtIn = (await loadMigrations()).filter(
      ({ version }) => version === '0001',
    );
    const concurrent = {
      checksum: 'live-concurrent-v1',
      name: 'live_concurrent',
      phase: /** @type {const} */ ('expand'),
      sql: 'CREATE TABLE crm.live_concurrent (id integer PRIMARY KEY)',
      version: '9001',
    };
    const upgrade = {
      checksum: 'live-upgrade-v1',
      name: 'live_upgrade',
      phase: /** @type {const} */ ('expand'),
      sql: 'ALTER TABLE crm.live_concurrent ADD COLUMN label text',
      version: '9002',
    };

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');

      assert.deepEqual(await migrate(pool, { migrations: builtIn }), {
        applied: ['0001'],
        phase: 'expand',
      });
      assert.deepEqual(await migrate(pool, { migrations: builtIn }), {
        applied: [],
        phase: 'expand',
      });

      const concurrentResults = await Promise.all([
        migrate(pool, { migrations: [...builtIn, concurrent] }),
        migrate(pool, { migrations: [...builtIn, concurrent] }),
      ]);
      assert.deepEqual(
        concurrentResults.flatMap(({ applied }) => applied),
        ['9001'],
      );

      assert.deepEqual(
        await migrate(pool, {
          migrations: [...builtIn, concurrent, upgrade],
        }),
        { applied: ['9002'], phase: 'expand' },
      );
      assert.equal(
        await checkDatabaseReadiness(pool, builtIn),
        true,
        'the previous app remains compatible after a later expand migration',
      );

      const api = createServerApi({
        logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
        readiness: () => checkDatabaseReadiness(pool, builtIn),
      });
      const response = await api.inject({ url: '/api/health/ready' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, 'ready');
      await api.close();
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
