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

/**
 * One contact, identity and first-cycle conversation, written in SQL so a
 * test can seed rows between two migrations.
 *
 * @param {Pool} pool @param {string} id @param {number} index @param {Date} openedAt
 */
async function seedLiveConversation(pool, id, index, openedAt) {
  await pool.query(
    `INSERT INTO crm.contacts (id, provisional, version, created_at, updated_at)
     VALUES ($1, false, 1, $2, $2)`,
    [`contact-${id}`, openedAt],
  );
  await pool.query(
    `INSERT INTO crm.contact_identities
       (id, current_contact_id, provider, provider_account_id, channel,
        external_identity_lookup_hash, identity_kind, phone_status,
        identity_envelope, key_version, version, created_at, updated_at)
     VALUES ($1, $2, 'meta', 'account-orders', 'instagram', $3, 'handle',
             'pending', $4::jsonb, 1, 1, $5, $5)`,
    [
      `identity-${id}`,
      `contact-${id}`,
      String(index).padStart(64, '0'),
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      openedAt,
    ],
  );
  await pool.query(
    `INSERT INTO crm.conversations
       (id, contact_identity_id, provider, provider_account_id,
        external_conversation_id, cycle_number, state, automation_state,
        automation_epoch, version, opened_at, last_message_at)
     VALUES ($1, $2, 'meta', 'account-orders', $3, 1, 'nova',
             'assistant', 0, 1, $4, $4)`,
    [id, `identity-${id}`, `external-${id}`, openedAt],
  );
}

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

  // Incident of 2026-10-14: the image shipped expand migrations the database
  // did not have, so ready answered 503 while live kept answering 200.
  test('PostgreSQL live: an image ahead of the database stays unavailable until expand migrations run', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live migration test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 2 });
    const previousImage = [
      ...(await loadMigrations()).filter(({ version }) => version === '0001'),
      {
        checksum: 'live-applied-v1',
        name: 'live_applied',
        phase: /** @type {const} */ ('expand'),
        sql: 'CREATE TABLE crm.live_applied (id integer PRIMARY KEY)',
        version: '9001',
      },
    ];
    const newImage = [
      ...previousImage,
      {
        checksum: 'live-pending-a-v1',
        name: 'live_pending_a',
        phase: /** @type {const} */ ('expand'),
        sql: 'ALTER TABLE crm.live_applied ADD COLUMN label text',
        version: '9002',
      },
      {
        checksum: 'live-pending-b-v1',
        name: 'live_pending_b',
        phase: /** @type {const} */ ('expand'),
        sql: 'ALTER TABLE crm.live_applied ADD COLUMN note text',
        version: '9003',
      },
    ];

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: previousImage });
      assert.equal(
        await checkDatabaseReadiness(pool, previousImage),
        true,
        'the release that matches the database is ready',
      );
      assert.equal(await checkDatabaseReadiness(pool, newImage), false);

      // One instance through the recovery: the runbook migrates without restart.
      const api = createServerApi({
        logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
        readiness: () => checkDatabaseReadiness(pool, newImage),
      });
      try {
        const unavailable = await api.inject({ url: '/api/health/ready' });
        assert.equal(unavailable.statusCode, 503);
        assert.deepEqual(unavailable.json(), {
          service: 'crm-silmer-api',
          status: 'unavailable',
        });
        const live = await api.inject({ url: '/api/health/live' });
        assert.equal(live.statusCode, 200);
        assert.equal(live.json().status, 'ok');

        assert.deepEqual(await migrate(pool, { migrations: newImage }), {
          applied: ['9002', '9003'],
          phase: 'expand',
        });

        const ready = await api.inject({ url: '/api/health/ready' });
        assert.equal(ready.statusCode, 200);
        assert.deepEqual(ready.json(), {
          service: 'crm-silmer-api',
          status: 'ready',
        });
      } finally {
        await api.close();
      }
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL live: a checksum that diverges from applied history stays unavailable and migrate refuses it', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live migration test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 2 });
    const baseline = (await loadMigrations()).filter(
      ({ version }) => version === '0001',
    );
    const applied = {
      checksum: 'live-history-v1',
      name: 'live_history',
      phase: /** @type {const} */ ('expand'),
      sql: 'CREATE TABLE crm.live_history (id integer PRIMARY KEY)',
      version: '9001',
    };
    const appliedImage = [...baseline, applied];
    const divergentImage = [
      ...baseline,
      { ...applied, checksum: 'live-history-edited-after-apply' },
    ];

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: appliedImage });
      assert.equal(await checkDatabaseReadiness(pool, appliedImage), true);
      assert.equal(await checkDatabaseReadiness(pool, divergentImage), false);

      const api = createServerApi({
        logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
        readiness: () => checkDatabaseReadiness(pool, divergentImage),
      });
      try {
        const unavailable = await api.inject({ url: '/api/health/ready' });
        assert.equal(unavailable.statusCode, 503);
        assert.deepEqual(unavailable.json(), {
          service: 'crm-silmer-api',
          status: 'unavailable',
        });
        const live = await api.inject({ url: '/api/health/live' });
        assert.equal(live.statusCode, 200);

        await assert.rejects(migrate(pool, { migrations: divergentImage }), {
          message: 'Migration 9001 does not match applied history or checksum',
        });

        const stillUnavailable = await api.inject({
          url: '/api/health/ready',
        });
        assert.equal(stillUnavailable.statusCode, 503);
      } finally {
        await api.close();
      }

      const { rows } = await pool.query(
        `SELECT checksum FROM crm_meta.schema_migrations WHERE version = '9001'`,
      );
      assert.deepEqual(rows, [{ checksum: 'live-history-v1' }]);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL live: orders keep one pending per conversation and complete confirmations', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live migration test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 2 });
    const now = new Date('2026-09-12T12:00:00.000Z');
    /** @param {string} conversationId @param {Record<string, unknown>} [overrides] */
    const insertOrder = async (conversationId, overrides = {}) => {
      const values = {
        confirmed_at: null,
        confirmed_by: null,
        final_amount_cents: null,
        order_date: null,
        payment_condition: null,
        status: 'pendente',
        ...overrides,
      };
      const sequence = Number(
        (await pool.query(`SELECT nextval('crm.order_number_seq') AS n`))
          .rows[0].n,
      );
      await pool.query(
        `INSERT INTO crm.orders
           (id, number_sequence, number, conversation_id, contact_id, status, fab_code,
            ficha_envelope, final_amount_cents, payment_condition, order_date,
            confirmed_at, confirmed_by, created_by_kind, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, '01', '{}'::jsonb, $7, $8, $9, $10, $11,
                 'automation', $12, $12)`,
        [
          `order-${sequence}`,
          sequence,
          `${String(sequence).padStart(2, '0')}-CRM`,
          conversationId,
          `contact-${conversationId}`,
          values.status,
          values.final_amount_cents,
          values.payment_condition,
          values.order_date,
          values.confirmed_at,
          values.confirmed_by,
          now,
        ],
      );
      return sequence;
    };

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      let seeded = 0;
      const seedConversation = async (/** @type {string} */ id) => {
        seeded += 1;
        await seedLiveConversation(pool, id, seeded, now);
      };
      for (const id of [
        'conversation-a',
        'conversation-b',
        'conversation-c',
        'conversation-d',
        'conversation-e',
        'conversation-f',
      ]) {
        await seedConversation(id);
      }

      const first = await insertOrder('conversation-a');
      await assert.rejects(insertOrder('conversation-a'), {
        code: '23505',
        constraint: 'orders_one_pending_per_conversation',
      });
      await insertOrder('conversation-b');

      await assert.rejects(
        pool.query(
          `UPDATE crm.orders SET status = 'confirmado' WHERE number_sequence = $1`,
          [first],
        ),
        { code: '23514', constraint: 'orders_confirmed_fields' },
      );
      await pool.query(
        `UPDATE crm.orders
         SET status = 'confirmado', final_amount_cents = 482000,
             payment_condition = 'pix', order_date = '2026-09-12',
             confirmed_at = $2, confirmed_by = 'seller-orders'
         WHERE number_sequence = $1`,
        [first, now],
      );
      await insertOrder('conversation-a');

      for (const [
        conversation,
        overrides,
        constraint,
      ] of /** @type {const} */ ([
        ['conversation-c', { status: 'cancelado' }, 'orders_status_check'],
        [
          'conversation-d',
          { final_amount_cents: 0 },
          'orders_final_amount_cents_check',
        ],
        [
          'conversation-e',
          { payment_condition: 'boleto' },
          'orders_payment_condition_check',
        ],
      ])) {
        await assert.rejects(insertOrder(conversation, overrides), {
          code: '23514',
          constraint,
        });
      }
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.orders
             (id, number_sequence, number, conversation_id, contact_id, status, fab_code,
              ficha_envelope, created_by_kind, created_at, updated_at)
           VALUES ('order-wrong-number', 999, '12-CRM', 'conversation-f',
                   'contact-conversation-f',
                   'pendente', '01', '{}'::jsonb, 'user', $1, $1)`,
          [now],
        ),
        { code: '23514', constraint: 'orders_number_format' },
      );
      await assert.rejects(
        insertOrder('conversation-missing'),
        { code: '23503' },
        'orders belong to an existing conversation',
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL live: 0024 gives existing orders the first contact of their conversation', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live migration test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 2 });
    const openedAt = new Date('2026-09-01T13:05:00.000Z');
    const createdAt = new Date('2026-09-12T12:00:00.000Z');
    const migrations = await loadMigrations();
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, {
        migrations: migrations.filter(({ version }) => version < '0024'),
      });
      await seedLiveConversation(pool, 'conversation-old', 1, openedAt);
      await pool.query(
        `INSERT INTO crm.orders
           (id, number_sequence, number, conversation_id, status, fab_code,
            ficha_envelope, created_by_kind, created_at, updated_at)
         VALUES ('order-old', 1, '01-CRM', 'conversation-old', 'pendente',
                 '01', '{}'::jsonb, 'automation', $1, $1)`,
        [createdAt],
      );

      assert.deepEqual(
        await migrate(pool, {
          migrations: migrations.filter(({ version }) => version <= '0024'),
        }),
        { applied: ['0024'], phase: 'expand' },
      );
      const { rows } = await pool.query(
        `SELECT first_contact_at, paid_on, delivered_on, version, updated_at
         FROM crm.orders WHERE id = 'order-old'`,
      );
      assert.deepEqual(rows, [
        {
          delivered_on: null,
          first_contact_at: openedAt,
          paid_on: null,
          updated_at: createdAt,
          version: 1,
        },
      ]);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

if (connectionString) {
  test('PostgreSQL live: 0041 fills only missing manual first contact and preserves the ficha', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 2 });
    const migrations = (await loadMigrations()).filter(
      ({ version }) => version <= '0041',
    );
    const createdAt = new Date('2026-10-21T14:00:00.000Z');
    const recordedAt = new Date('2026-10-20T12:00:00.000Z');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, {
        migrations: migrations.filter(({ version }) => version < '0041'),
      });
      await seedLiveConversation(pool, 'manual-first-contact', 1, recordedAt);
      await pool.query(`INSERT INTO crm.users (id, email, password_hash, name)
        VALUES ('manual-owner', 'manual-owner@example.test', '$argon2id$synthetic', 'Vendedor Sintetico')`);
      for (let index = 1; index <= 3; index += 1) {
        await pool.query(
          `INSERT INTO crm.orders
          (id, number_sequence, number, conversation_id, contact_id, manual_owner_id,
           manual_create_key, status, fab_code, ficha_envelope, created_by_kind,
           created_by, created_at, updated_at, first_contact_at)
          VALUES ($1, $2, $3, $4, 'contact-manual-first-contact', $5, $6,
            'pendente', '01', '{"snapshot":"synthetic"}'::jsonb, 'user', 'manual-owner', $7, $7, $8)`,
          [
            `manual-date-${index}`,
            index,
            `0${index}-CRM`,
            index === 3 ? 'manual-first-contact' : null,
            index === 3 ? null : 'manual-owner',
            index === 3 ? null : `manual-key-${index}`,
            createdAt,
            index === 2 ? recordedAt : null,
          ],
        );
      }
      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: ['0041'],
        phase: 'expand',
      });
      const result =
        await pool.query(`SELECT id, first_contact_at, ficha_envelope, version, updated_at
        FROM crm.orders ORDER BY id`);
      assert.deepEqual(
        result.rows.map((row) => row.first_contact_at),
        [createdAt, recordedAt, null],
      );
      for (const row of result.rows) {
        assert.deepEqual(row.ficha_envelope, { snapshot: 'synthetic' });
        assert.equal(row.version, 1);
        assert.deepEqual(row.updated_at, createdAt);
      }
      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: [],
        phase: 'expand',
      });
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

if (connectionString) {
  // OLC-T01 / ADR 080 (OLC-05d, item 14): synthetic rows only.
  test('PostgreSQL live: 0076 adds the order freight without touching existing orders and guards a code rollback', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 2 });
    const migrations = (await loadMigrations()).filter(
      ({ version }) => version <= '0076',
    );
    const at = new Date('2026-11-01T14:00:00.000Z');
    const NEW_COLUMNS = [
      'freight_cents',
      'freight_source',
      'freight_quote_id',
      'freight_quote_service_id',
      'freight_quoted_cents',
      'freight_set_by',
      'freight_set_at',
      'pricing_rule',
      'commercial_revision',
    ];
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT to_jsonb(orders) - $1::text[] AS row FROM crm.orders ORDER BY id`,
          [NEW_COLUMNS],
        )
      ).rows.map((row) => row.row);
    /**
     * A statement the database must refuse by this constraint.
     *
     * @param {string} sql @param {string} constraint @param {unknown[]} [values]
     */
    const refused = (sql, constraint, values = []) =>
      assert.rejects(
        pool.query(sql, values),
        (/** @type {any} */ error) => {
          assert.equal(error.code, '23514', `${sql}: ${error.message}`);
          assert.equal(error.constraint, constraint, sql);
          return true;
        },
        sql,
      );
    /**
     * The same statement as the freight-aware writer runs it: with the
     * calculation rule declared in its transaction.
     *
     * @param {string} sql @param {unknown[]} [values]
     */
    async function aware(sql, values = []) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('crm.order_pricing_rule','pieces-freight-v1',true)",
        );
        const result = await client.query(sql, values);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, {
        migrations: migrations.filter(({ version }) => version < '0076'),
      });
      await seedLiveConversation(pool, 'freight-old', 1, at);
      await seedLiveConversation(pool, 'freight-other', 2, at);
      await seedLiveConversation(pool, 'freight-legacy', 3, at);
      await pool.query(`INSERT INTO crm.users (id, email, password_hash, name)
        VALUES ('freight-seller', 'freight-seller@example.test', '$argon2id$synthetic', 'Vendedor Sintetico')`);
      // A populated previous schema: a pending draft, a confirmed order with
      // its frozen total and settlement, and an untouched second draft.
      await pool.query(
        `INSERT INTO crm.orders
           (id, number_sequence, number, conversation_id, contact_id, status,
            fab_code, ficha_envelope, total_pieces, created_by_kind, created_at,
            updated_at, version)
         VALUES ('freight-pending', 1, '01-CRM', 'freight-old',
                 'contact-freight-old', 'pendente', '01',
                 '{"snapshot":"pending"}'::jsonb, 4, 'automation', $1, $1, 3),
                ('freight-plain', 3, '03-CRM', 'freight-other',
                 'contact-freight-other', 'pendente', '01',
                 '{"snapshot":"plain"}'::jsonb, 2, 'automation', $1, $1, 1)`,
        [at],
      );
      await pool.query(
        `INSERT INTO crm.orders
           (id, number_sequence, number, conversation_id, contact_id, status,
            fab_code, ficha_envelope, total_pieces, final_amount_cents,
            payment_condition, order_date, confirmed_at, confirmed_by, paid_on,
            created_by_kind, created_at, updated_at, version)
         VALUES ('freight-confirmed', 2, '02-CRM', 'freight-legacy',
                 'contact-freight-legacy', 'confirmado', '01',
                 '{"snapshot":"confirmed"}'::jsonb, 10, 50000, 'pix',
                 '2026-11-01', $1, 'freight-seller', '2026-11-01',
                 'automation', $1, $1, 7)`,
        [at],
      );
      const before = await snapshot();

      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: ['0076'],
        phase: 'expand',
      });
      // Nothing an existing order had moved: total, ficha, settlement,
      // version and updated_at included. No freight was inferred.
      assert.deepEqual(await snapshot(), before);
      const added = await pool.query(
        `SELECT id, freight_cents, freight_source, freight_quote_id,
                freight_quote_service_id, freight_quoted_cents, freight_set_by,
                freight_set_at, pricing_rule, commercial_revision
         FROM crm.orders ORDER BY id`,
      );
      assert.deepEqual(
        added.rows,
        ['freight-confirmed', 'freight-pending', 'freight-plain'].map((id) => ({
          commercial_revision: 1,
          freight_cents: '0',
          freight_quote_id: null,
          freight_quote_service_id: null,
          freight_quoted_cents: null,
          freight_set_at: null,
          freight_set_by: null,
          freight_source: null,
          id,
          pricing_rule: 'pieces-v1',
        })),
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::integer AS total FROM crm.order_freight_events',
          )
        ).rows[0].total,
        0,
      );
      assert.deepEqual(await migrate(pool, { migrations }), {
        applied: [],
        phase: 'expand',
      });

      // Without freight, a writer from before this migration behaves as it
      // always did: nothing is blocked.
      await pool.query(
        `UPDATE crm.orders SET final_amount_cents = 12000, version = version + 1
         WHERE id = 'freight-plain'`,
      );
      await pool.query(
        `UPDATE crm.orders SET final_amount_cents = NULL, version = version + 1
         WHERE id = 'freight-plain'`,
      );

      // Constraints of the datum.
      const SET = `freight_source = 'seller', freight_set_by = 'freight-seller',
        freight_set_at = now(), pricing_rule = 'pieces-freight-v1'`;
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = -1, ${SET} WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'orders_freight_cents_bounds' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 9007199254740992, ${SET} WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'orders_freight_cents_bounds' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 100 WHERE id = 'freight-pending'`,
        ),
        { code: '23514' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 100, freight_source = 'seller',
             freight_set_by = 'freight-seller', freight_set_at = now()
           WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'orders_freight_needs_rule' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 100, freight_source = 'quote',
             freight_quote_id = 'quote-synthetic', freight_quote_service_id = 1,
             freight_quoted_cents = 99, freight_set_by = 'freight-seller',
             freight_set_at = now(), pricing_rule = 'pieces-freight-v1'
           WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'orders_freight_origin_coherent' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 100, freight_source = 'other',
             freight_set_by = 'freight-seller', freight_set_at = now(),
             pricing_rule = 'pieces-freight-v1'
           WHERE id = 'freight-pending'`,
        ),
        { code: '23514' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET pricing_rule = 'pieces-v2' WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'orders_pricing_rule' },
      );

      // A writer that does not declare the rule cannot give an order freight.
      await refused(
        `UPDATE crm.orders SET freight_cents = 3750, ${SET} WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
      );
      // The freight-aware writer can: pieces 20000 + freight 3750.
      await aware(
        `UPDATE crm.orders SET freight_cents = 3750, ${SET},
           final_amount_cents = 23750, version = version + 1
         WHERE id = 'freight-pending'`,
      );

      // Rollback guard: code from before this delivery would recalculate the
      // total without the freight, or confirm it. Each is refused, closed.
      await refused(
        `UPDATE crm.orders SET final_amount_cents = 20000, version = version + 1
         WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
      );
      await refused(
        `UPDATE crm.orders SET final_amount_cents = NULL WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
      );
      await refused(
        `UPDATE crm.orders SET freight_cents = 0, freight_source = NULL,
           freight_set_by = NULL, freight_set_at = NULL
         WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
      );
      await refused(
        `UPDATE crm.orders SET status = 'confirmado', payment_condition = 'pix',
           order_date = '2026-11-02', confirmed_at = $1,
           confirmed_by = 'freight-seller', version = version + 1
         WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
        [at],
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT status, final_amount_cents, freight_cents FROM crm.orders
             WHERE id = 'freight-pending'`,
          )
        ).rows,
        [
          {
            final_amount_cents: '23750',
            freight_cents: '3750',
            status: 'pendente',
          },
        ],
      );
      // What does not touch total, status or freight still passes for that
      // older code: days of the trail, the ficha, the version, a review flag.
      await pool.query(
        `UPDATE crm.orders SET paid_on = '2026-11-02', delivered_on = '2026-11-02',
           ficha_envelope = '{"snapshot":"edited"}'::jsonb,
           finance_payment_review_required = false,
           version = version + 1, updated_at = $1
         WHERE id = 'freight-pending'`,
        [at],
      );

      // The freight-aware writer confirms it, and then the freight is frozen
      // for every writer, aware or not, until the order is pending again.
      await aware(
        `UPDATE crm.orders SET status = 'confirmado', payment_condition = 'pix',
           order_date = '2026-11-02', confirmed_at = $1,
           confirmed_by = 'freight-seller', version = version + 1
         WHERE id = 'freight-pending'`,
        [at],
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET freight_cents = 100, freight_quoted_cents = NULL
           WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'order_freight_frozen' },
      );
      await assert.rejects(
        aware(
          `UPDATE crm.orders SET status = 'pendente', freight_cents = 0
           WHERE id = 'freight-pending'`,
        ),
        { code: '23514', constraint: 'order_freight_frozen' },
      );
      // Older code cannot reopen it either; milestones still pass.
      await refused(
        `UPDATE crm.orders SET status = 'pendente', reopened_at = $1,
           reopened_by = 'freight-seller' WHERE id = 'freight-pending'`,
        'order_freight_rule_required',
        [at],
      );
      await pool.query(
        `UPDATE crm.orders SET delivered_on = '2026-11-03', version = version + 1
         WHERE id = 'freight-pending'`,
      );
      await aware(
        `UPDATE crm.orders SET status = 'pendente', reopened_at = $1,
           reopened_by = 'freight-seller', version = version + 1
         WHERE id = 'freight-pending'`,
        [at],
      );
      // A confirmed legacy order is untouched by the guard: no freight.
      await pool.query(
        `UPDATE crm.orders SET status = 'pendente', reopened_at = $1,
           reopened_by = 'freight-seller', version = version + 1
         WHERE id = 'freight-confirmed'`,
        [at],
      );

      // The freight history is append-only and carries no free text.
      await pool.query(
        `INSERT INTO crm.order_freight_events
           (id, order_id, order_version, kind, freight_cents,
            previous_freight_cents, source, actor_id, occurred_at)
         VALUES ('freight-event-1', 'freight-pending', 4, 'set', 3750, 0,
                 'seller', 'freight-seller', $1)`,
        [at],
      );
      await assert.rejects(
        pool.query(
          "UPDATE crm.order_freight_events SET freight_cents = 1 WHERE id = 'freight-event-1'",
        ),
      );
      await assert.rejects(
        pool.query(
          "DELETE FROM crm.order_freight_events WHERE id = 'freight-event-1'",
        ),
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO crm.order_freight_events
             (id, order_id, order_version, kind, pieces_cents, freight_cents,
              total_cents, actor_id, occurred_at)
           VALUES ('freight-event-2', 'freight-pending', 5, 'confirmed', 20000,
                   3750, 20000, 'freight-seller', $1)`,
          [at],
        ),
        { code: '23514', constraint: 'order_freight_events_shape' },
      );
      const columns = (
        await pool.query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'crm' AND table_name = 'order_freight_events'
           ORDER BY column_name`,
        )
      ).rows;
      assert.deepEqual(
        columns
          .filter(
            ({ data_type }) => data_type === 'text' || data_type === 'jsonb',
          )
          .map(({ column_name }) => column_name),
        ['actor_id', 'id', 'kind', 'order_id', 'quote_id', 'source'],
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
