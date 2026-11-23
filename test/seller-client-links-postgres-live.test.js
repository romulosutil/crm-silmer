import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  lockSellerClientContact,
  planSellerClientReconciliation,
  requireSellerClientActor,
  setSellerClientLink,
} from '../modules/contacts/src/adapters/postgres-seller-client-links.js';

const url = process.env.TEST_DATABASE_URL;
const A = 'portfolio-seller-a';
const B = 'portfolio-seller-b';
const ADMIN = 'portfolio-admin';
const FINANCE = 'portfolio-finance';
const CONTACT = 'portfolio-contact';

if (!url) {
  test(
    'Seller client link PostgreSQL races require TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  assert.equal(new URL(url).pathname, '/crm_silmer_test');
  test('WAP-E03 durable portfolio links, proof, versioning and Contact serialization', async (t) => {
    const pool = new Pool({ connectionString: url, max: 10 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const audit = new PostgresAuditTrail(database);
    /** @param {any} [fields] @param {any} [auditPort] */
    async function link(fields = {}, auditPort = audit) {
      return database.transaction(async (/** @type {any} */ tx) => {
        const actor = await requireSellerClientActor(tx, fields.actorId ?? A);
        await lockSellerClientContact(tx, fields.contactId ?? CONTACT);
        return setSellerClientLink(
          tx,
          {
            actor,
            contactId: CONTACT,
            provenance: 'explicit_link',
            correlationId: randomUUID(),
            ...fields,
          },
          auditPort,
        );
      });
    }
    async function reset() {
      await pool.query(
        'TRUNCATE crm.seller_client_link_history,crm.seller_client_links,crm.seller_client_scope_versions',
      );
      await pool.query('UPDATE crm.users SET disabled_at=NULL');
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      const migrations = await loadMigrations();
      await migrate(pool, {
        migrations: migrations.filter((m) => m.version < '0078'),
      });
      for (const id of [A, B, ADMIN, FINANCE]) {
        await pool.query(
          "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic seller')",
          [id, `${id}@example.test`],
        );
        await pool.query(
          'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2)',
          [id, id === FINANCE ? 'Financeiro' : 'Vendedor'],
        );
      }
      await pool.query(
        "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
        [ADMIN],
      );
      await pool.query(
        "INSERT INTO crm.contacts(id,display_name,provisional,created_at,updated_at) VALUES($1,'Synthetic contact',false,now(),now())",
        [CONTACT],
      );
      assert.deepEqual((await migrate(pool, { migrations })).applied, [
        '0078',
        '0079',
        '0080',
        '0082',
        '0083',
        '0084',
        '0085',
      ]);
      assert.deepEqual((await migrate(pool, { migrations })).applied, []);
      assert.equal(
        (
          await pool.query(
            'SELECT wallet_created FROM crm.contacts WHERE id=$1',
            [CONTACT],
          )
        ).rows[0].wallet_created,
        false,
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int n FROM crm.seller_client_links',
          )
        ).rows[0].n,
        0,
      );

      await t.test(
        'same pair is durable through explicit revocation and reactivation; no line required',
        async () => {
          await reset();
          const first = await link();
          const replay = await link();
          assert.equal(replay.id, first.id);
          assert.equal(replay.changed, false);
          assert.equal(replay.version, 1);
          const revoked = await link({ state: 'revoked', expectedVersion: 1 });
          assert.equal(revoked.id, first.id);
          assert.equal(revoked.status, 'revoked');
          assert.equal(revoked.version, 2);
          await assert.rejects(link(), {
            code: 'CLIENT_LINK_VERSION_CONFLICT',
          });
          const active = await link({ expectedVersion: 2 });
          assert.equal(active.id, first.id);
          assert.equal(active.version, 3);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM crm.seller_client_links',
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT version FROM crm.seller_client_scope_versions WHERE seller_id=$1',
                [A],
              )
            ).rows[0].version,
            '3',
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM crm.seller_client_link_history',
              )
            ).rows[0].n,
            3,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM crm.seller_whatsapp_lines',
              )
            ).rows[0].n,
            0,
          );
        },
      );

      await t.test(
        'two connections create one pair and two sellers share the official Contact',
        async () => {
          await reset();
          const pair = await Promise.all([link(), link()]);
          assert.equal(pair[0].id, pair[1].id);
          assert.equal(pair.filter((item) => item.changed).length, 1);
          await link({ actorId: B });
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM crm.seller_client_links WHERE contact_id=$1',
                [CONTACT],
              )
            ).rows[0].n,
            2,
          );
          assert.equal(
            (await pool.query('SELECT count(*)::int n FROM crm.contacts'))
              .rows[0].n,
            1,
          );
        },
      );

      await t.test(
        'database rejects duplicate, deletion, provenance rewrite, version jumps and history edits',
        async () => {
          await reset();
          const first = await link();
          await assert.rejects(
            pool.query(
              `INSERT INTO crm.seller_client_links
          (id,seller_id,contact_id,provenance,status,version,created_by,updated_by,created_at,updated_at)
          SELECT $1,seller_id,contact_id,provenance,status,version,created_by,updated_by,created_at,updated_at
          FROM crm.seller_client_links WHERE id=$2`,
              [randomUUID(), first.id],
            ),
            { code: '23505' },
          );
          await assert.rejects(
            pool.query('DELETE FROM crm.seller_client_links WHERE id=$1', [
              first.id,
            ]),
            { code: '23514' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.seller_client_links SET provenance='manual_create',status='revoked',revoked_at=now(),version=version+1 WHERE id=$1",
              [first.id],
            ),
            { code: '23514' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.seller_client_links SET status='revoked',revoked_at=now(),version=version+2 WHERE id=$1",
              [first.id],
            ),
            { code: '23514' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.seller_client_link_history SET status='revoked' WHERE link_id=$1",
              [first.id],
            ),
            { code: '23514' },
          );
          await assert.rejects(
            pool.query(
              'DELETE FROM crm.seller_client_link_history WHERE link_id=$1',
              [first.id],
            ),
            { code: '23514' },
          );
        },
      );

      await t.test(
        'replay revalidates active human seller; Financeiro and disabled actors denied',
        async () => {
          await reset();
          await link();
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          await assert.rejects(link(), { code: 'FORBIDDEN', statusCode: 403 });
          await assert.rejects(link({ actorId: FINANCE }), {
            code: 'FORBIDDEN',
          });
          await assert.rejects(link({ actorId: 'AUTOMATION_EXECUTOR' }), {
            code: 'FORBIDDEN',
          });
          await reset();
          await assert.rejects(link({ sellerId: B }), { code: 'FORBIDDEN' });
        },
      );

      await t.test(
        'audit failure rolls back link, immutable history, scope version and event',
        async () => {
          await reset();
          const beforeEvents = (
            await pool.query('SELECT count(*)::int n FROM crm.domain_events')
          ).rows[0].n;
          await assert.rejects(
            link(
              {},
              {
                append: async () => {
                  throw new Error('synthetic audit failure');
                },
              },
            ),
            /synthetic audit failure/u,
          );
          for (const table of [
            'seller_client_links',
            'seller_client_link_history',
            'seller_client_scope_versions',
          ]) {
            assert.equal(
              (await pool.query(`SELECT count(*)::int n FROM crm.${table}`))
                .rows[0].n,
              0,
            );
          }
          assert.equal(
            (await pool.query('SELECT count(*)::int n FROM crm.domain_events'))
              .rows[0].n,
            beforeEvents,
          );
        },
      );

      await t.test(
        'second link waits for the same Contact lock held by an editor',
        async () => {
          await reset();
          await link();
          const editor = await pool.connect();
          try {
            await editor.query('BEGIN');
            await requireSellerClientActor(editor, A);
            await lockSellerClientContact(editor, CONTACT);
            let finished = false;
            const pending = link({ actorId: B }).then((result) => {
              finished = true;
              return result;
            });
            // Ask PostgreSQL to prove the waiter instead of relying on timing.
            let blocked = false;
            for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
              const activity = await pool.query(`SELECT EXISTS(
              SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                AND wait_event_type='Lock' AND query LIKE '%crm.contacts%FOR UPDATE%'
            ) blocked`);
              blocked = activity.rows[0].blocked;
              if (!blocked)
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.equal(blocked, true);
            assert.equal(finished, false);
            assert.equal(
              (
                await editor.query(
                  "SELECT count(*)::int n FROM crm.seller_client_links WHERE contact_id=$1 AND status='active'",
                  [CONTACT],
                )
              ).rows[0].n,
              1,
            );
            await editor.query('COMMIT');
            await pending;
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int n FROM crm.seller_client_links WHERE contact_id=$1 AND status='active'",
                  [CONTACT],
                )
              ).rows[0].n,
              2,
            );
          } finally {
            await editor.query('ROLLBACK');
            editor.release();
          }
        },
      );

      await t.test(
        'reconciliation dry-run uses only proved commercial attribution and never resurrects revoked links',
        async () => {
          await reset();
          await pool.query(
            `INSERT INTO crm.orders
          (id,number_sequence,number,conversation_id,contact_id,manual_owner_id,manual_create_key,
           status,fab_code,ficha_envelope,created_by_kind,created_by,created_at,updated_at)
          VALUES('portfolio-order',1,'01-CRM',NULL,$1,$2,'portfolio-order-key',
            'pendente','SYNTHETIC','{}'::jsonb,'user',$3,now(),now())`,
            [CONTACT, A, B],
          );
          const plan = await planSellerClientReconciliation(database, [A, B]);
          assert.deepEqual(plan, {
            count: 1,
            candidates: [
              { sellerId: A, contactId: CONTACT, sourceId: 'portfolio-order' },
            ],
          });
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM crm.seller_client_links',
              )
            ).rows[0].n,
            0,
          );
          await assert.rejects(
            link({
              actorId: B,
              provenance: 'commercial_order',
              sourceId: 'portfolio-order',
            }),
            { code: 'CLIENT_LINK_PROVENANCE_INVALID' },
          );
          await link({
            provenance: 'commercial_order',
            sourceId: 'portfolio-order',
          });
          await link({ state: 'revoked', expectedVersion: 1 });
          assert.deepEqual(
            await planSellerClientReconciliation(database, [A, B]),
            { count: 0, candidates: [] },
          );
          const metadata = await pool.query(
            'SELECT action,reason FROM crm.audit_events',
          );
          assert.ok(
            metadata.rows.every((row) => row.reason === 'SELLER_CLIENT_LINK'),
          );
        },
      );
    } finally {
      await pool.end();
    }
  });
}
