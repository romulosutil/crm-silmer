import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  checkDatabaseReadiness,
  loadMigrations,
  migrate,
} from '../modules/database/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
/** @param {string} character */
const hash = (character) => character.repeat(64);

if (connectionString) {
  test('Phase 1 schema upgrades safely and enforces persistent invariants', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live schema test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 6 });
    const migrations = await loadMigrations();
    const baseline = migrations.find(({ version }) => version === '0001');
    const phase1 = migrations.find(({ version }) => version === '0002');
    const identityApiHardening = migrations.find(
      ({ version }) => version === '0003',
    );
    assert.ok(baseline);
    assert.ok(phase1);
    assert.ok(identityApiHardening);

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');

      assert.deepEqual(await migrate(pool, { migrations: [baseline] }), {
        applied: ['0001'],
        phase: 'expand',
      });
      assert.deepEqual(
        await migrate(pool, { migrations: [baseline, phase1] }),
        {
          applied: ['0002'],
          phase: 'expand',
        },
      );
      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: ['0003'],
        phase: 'expand',
      });
      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: [],
        phase: 'expand',
      });
      assert.equal(await checkDatabaseReadiness(pool, [baseline]), true);
      assert.equal(await checkDatabaseReadiness(pool, migrations), true);

      const throttleColumns = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'crm'
           AND table_name = 'authentication_throttles'
         ORDER BY column_name`,
      );
      assert.deepEqual(
        throttleColumns.rows.map(({ column_name: columnName }) => columnName),
        [
          'blocked_until',
          'failure_count',
          'scope',
          'subject_hash',
          'updated_at',
          'window_started_at',
        ],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash)
           VALUES ('account', 'raw-account@example.test')`,
        ),
        /authentication_throttles_subject_hash_check/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash)
           VALUES ('network', '192.0.2.1')`,
        ),
        /authentication_throttles_subject_hash_check/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash)
           VALUES ('email', $1)`,
          [hash('1')],
        ),
        /authentication_throttles_scope_check/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash, failure_count)
           VALUES ('account', $1, -1)`,
          [hash('2')],
        ),
        /authentication_throttles_failure_count_check/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash, failure_count, window_started_at,
              blocked_until, updated_at)
           VALUES ('account', $1, 1, '2026-09-01T12:00:00.000Z',
             '2026-09-01T11:59:59.000Z', '2026-09-01T12:00:00.000Z')`,
          [hash('3')],
        ),
        /authentication_throttles_time_order_check/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.authentication_throttles
             (scope, subject_hash, failure_count, blocked_until)
           VALUES ('network', $1, 0, now() + interval '1 minute')`,
          [hash('4')],
        ),
        /authentication_throttles_block_requires_failure_check/iu,
      );
      await pool.query(
        `INSERT INTO crm.authentication_throttles
           (scope, subject_hash, failure_count, window_started_at,
            blocked_until, updated_at)
         VALUES
           ('account', $1, 3, now() - interval '1 minute',
             now() + interval '5 minutes', now()),
           ('network', $2, 0, now(), NULL, now())`,
        [hash('5'), hash('6')],
      );
      const throttleRows = await pool.query(
        `SELECT scope, subject_hash, failure_count, blocked_until
         FROM crm.authentication_throttles
         ORDER BY scope`,
      );
      assert.deepEqual(
        throttleRows.rows.map(({ blocked_until: blockedUntil, ...row }) => ({
          ...row,
          blocked: blockedUntil !== null,
        })),
        [
          {
            blocked: true,
            failure_count: 3,
            scope: 'account',
            subject_hash: hash('5'),
          },
          {
            blocked: false,
            failure_count: 0,
            scope: 'network',
            subject_hash: hash('6'),
          },
        ],
      );

      await assert.rejects(
        pool.query(
          `INSERT INTO crm.idempotency_records
             (scope, idempotency_key, fingerprint, actor_id, action,
              target_type, target_id, version, reason, correlation_id,
              status, completed_at)
           VALUES ('admin-1:order.approve', 'completed-without-response', $1,
             'admin-1', 'order.approve', 'order', 'order-1', '1',
             'authorized', 'correlation-completed', 'completed', now())`,
          [hash('7')],
        ),
        /idempotency_records_completed_response_check/iu,
      );

      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash)
         VALUES ('admin-1', 'admin@example.test', '$argon2id$v=19$fixture')`,
      );
      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash)
         VALUES ('seller-1', 'seller@example.test', '$argon2id$v=19$fixture')`,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.users (id, email, password_hash)
           VALUES ('duplicate-email', 'ADMIN@example.test', '$argon2id$v=19$fixture')`,
        ),
        /users_email_lower_unique/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.users (id, email, password_hash)
           VALUES ('plaintext-user', 'plain@example.test', 'plaintext')`,
        ),
        /users_password_hash_check/iu,
      );

      await pool.query(
        `INSERT INTO crm.user_functions (user_id, function_name)
         VALUES ('admin-1', 'Atendimento')`,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.user_functions (user_id, function_name)
           VALUES ('admin-1', 'Vendedor')`,
        ),
        /user_functions_pkey/iu,
      );
      await pool.query(
        `INSERT INTO crm.user_capabilities
           (user_id, capability, granted_by)
         VALUES ('seller-1', 'COMMERCIAL_ADMIN', 'admin-1')`,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.user_capabilities
             (user_id, capability, granted_by)
           VALUES ('seller-1', 'PRIVACY_OFFICER', 'seller-1')`,
        ),
        /user_capabilities_grant_separation_check/iu,
      );

      await pool.query(
        `INSERT INTO crm.sessions
           (token_hash, user_id, csrf_hash, absolute_expires_at)
         VALUES ($1, 'admin-1', $2, now() + interval '12 hours')`,
        [hash('a'), hash('b')],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.sessions
             (token_hash, user_id, csrf_hash, absolute_expires_at)
           VALUES ('raw-session-token', 'admin-1', $1, now() + interval '12 hours')`,
          [hash('c')],
        ),
        /sessions_token_hash_check/iu,
      );
      await pool.query(
        `INSERT INTO crm.invitations
           (id, email, function_name, token_hash, created_by, expires_at)
         VALUES ('invite-1', 'new@example.test', 'Vendedor', $1, 'admin-1', now() + interval '1 day')`,
        [hash('d')],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.invitations
             (id, email, function_name, token_hash, created_by, expires_at)
           VALUES ('invite-2', 'other@example.test', 'Vendedor', $1, 'admin-1', now() + interval '1 day')`,
          [hash('d')],
        ),
        /invitations_token_hash_key/iu,
      );
      await pool.query(
        `INSERT INTO crm.mfa_factors (user_id, encrypted_secret)
         VALUES ('admin-1', 'v1.fixture.fixture.fixture')`,
      );
      await pool.query(
        `INSERT INTO crm.mfa_recovery_codes (user_id, code_hash)
         VALUES ('admin-1', $1)`,
        [hash('e')],
      );

      await pool.query(
        `INSERT INTO crm.audit_events
           (id, actor_id, action, target_type, target_id, version, reason, correlation_id)
         VALUES ('audit-1', 'admin-1', 'identity.user.created', 'user', 'seller-1', '1', 'authorized', 'correlation-1')`,
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.audit_events SET reason = 'rewritten' WHERE id = 'audit-1'`,
        ),
        /immutable/iu,
      );
      await assert.rejects(
        pool.query(`DELETE FROM crm.audit_events WHERE id = 'audit-1'`),
        /immutable/iu,
      );

      await pool.query(
        `INSERT INTO crm.idempotency_records
           (scope, idempotency_key, fingerprint, actor_id, action, target_type,
            target_id, version, reason, correlation_id, status)
         VALUES ('admin-1:order.approve', 'request-1', $1, 'admin-1',
           'order.approve', 'order', 'order-1', '1', 'authorized',
           'correlation-2', 'pending')`,
        [hash('f')],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.idempotency_records
             (scope, idempotency_key, fingerprint, actor_id, action,
              target_type, target_id, version, reason, correlation_id, status)
           VALUES ('admin-1:order.approve', 'request-1', $1, 'admin-1',
             'order.approve', 'order', 'order-1', '1', 'authorized',
             'correlation-3', 'pending')`,
          [hash('0')],
        ),
        /idempotency_records_pkey/iu,
      );
      await pool.query(
        `UPDATE crm.idempotency_records
         SET status = 'completed', response = '{"ok":true}', completed_at = now()
         WHERE scope = 'admin-1:order.approve' AND idempotency_key = 'request-1'`,
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.idempotency_records SET response = '{"ok":false}'
           WHERE scope = 'admin-1:order.approve' AND idempotency_key = 'request-1'`,
        ),
        /completed idempotency record is immutable/iu,
      );
      await assert.rejects(
        pool.query(
          `DELETE FROM crm.idempotency_records
           WHERE scope = 'admin-1:order.approve' AND idempotency_key = 'request-1'`,
        ),
        /completed idempotency record is immutable/iu,
      );
      await assert.rejects(
        pool.query('TRUNCATE crm.idempotency_records'),
        /immutable/iu,
      );

      const configuration = {
        channels: {
          instagram: { enabled: false },
          whatsapp: { enabled: true },
        },
        fab: { code: '01', displayName: 'FAB 01' },
        featureFlags: { vendedor_silmer_autonomia_comercial: false },
        pix: { keyReference: 'secret://pix/main', maskedKey: '***1234' },
        recipient: {
          name: 'Rose',
          phoneReference: 'secret://crm/order-recipient-phone',
        },
        templates: { onboarding: { enabled: true, version: 'v1' } },
      };
      await pool.query(
        `INSERT INTO crm.configuration_versions
           (id, version, created_by, reason, values)
         VALUES ('configuration-1', 1, 'admin-1', 'initial', $1)`,
        [configuration],
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.configuration_versions SET reason = 'rewritten'
           WHERE id = 'configuration-1'`,
        ),
        /immutable/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.configuration_versions
             (id, version, created_by, reason, values)
           VALUES ('configuration-2', 2, 'admin-1', 'unsafe', $1)`,
          [
            {
              ...configuration,
              pix: { keyReference: 'raw-key', maskedKey: '1234' },
            },
          ],
        ),
        /configuration_versions_values_check/iu,
      );

      await pool.query(
        `INSERT INTO crm.catalog_versions
           (id, number, status, created_by, reason)
         VALUES ('catalog-1', 1, 'draft', 'admin-1', 'initial')`,
      );
      await pool.query(
        `INSERT INTO crm.catalog_products (catalog_version_id, code, name)
         VALUES ('catalog-1', 'CAM', 'Camisa')`,
      );
      await pool.query(
        `INSERT INTO crm.catalog_models
           (catalog_version_id, code, name, product_code)
         VALUES ('catalog-1', 'CAM-01', 'Camisa essencial', 'CAM')`,
      );
      await pool.query(
        `INSERT INTO crm.catalog_materials (catalog_version_id, code, name)
         VALUES ('catalog-1', 'DRY', 'Dry fit')`,
      );
      await pool.query(
        `INSERT INTO crm.catalog_techniques (catalog_version_id, code, name)
         VALUES ('catalog-1', 'SUB', 'Sublimação')`,
      );
      await pool.query(
        `UPDATE crm.catalog_versions
         SET status = 'published', published_at = now(), published_by = 'admin-1'
         WHERE id = 'catalog-1'`,
      );
      await assert.rejects(
        pool.query(
          `UPDATE crm.catalog_products SET name = 'Rewritten'
           WHERE catalog_version_id = 'catalog-1' AND code = 'CAM'`,
        ),
        /published catalog/iu,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.catalog_materials (catalog_version_id, code, name)
           VALUES ('catalog-1', 'NEW', 'Late material')`,
        ),
        /published catalog/iu,
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
