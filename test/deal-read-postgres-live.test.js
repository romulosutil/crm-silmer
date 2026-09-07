import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  createDealReadService,
  PostgresDealReadRepository,
} from '../modules/deals-pipeline/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T19:00:00.000Z');

if (connectionString) {
  test('PostgreSQL read model paginates ties, invalidates ETags and serializes SSE cursors before commit', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      /** @param {(client: any) => Promise<any>} work */
      transaction: (work) => withTransaction(pool, work),
    };
    const repository = new PostgresDealReadRepository(database);
    const service = createDealReadService({
      cursorKey: Buffer.alloc(32, 91),
      repository,
    });
    const runId = randomUUID().replaceAll('-', '');
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await seed(pool, runId, 'a');
      await seed(pool, runId, 'b');

      const first = await service.getColumn({ limit: 1, stage: 'produto' });
      assert.equal(first.count, 2);
      assert.equal(first.cards[0].id, `deal-${runId}-b`);
      assert.ok(first.nextCursor);
      const second = await service.getColumn({
        cursor: first.nextCursor,
        limit: 1,
        stage: 'produto',
      });
      assert.equal(second.cards[0].id, `deal-${runId}-a`);

      const detail = await service.getDetail({ dealId: `deal-${runId}-a` });
      await pool.query(
        `INSERT INTO crm.tasks
           (id, deal_id, assigned_user_id, task_type, status, version, due_at,
            text_envelope, created_at, updated_at)
         VALUES ($1,$2,$3,'follow_up','pending',1,$4,$5::jsonb,$6,$6)`,
        [
          `task-${runId}`,
          `deal-${runId}-a`,
          `seller-${runId}`,
          new Date(NOW.getTime() + 3_600_000),
          JSON.stringify({ algorithm: 'AES-256-GCM', version: '1' }),
          NOW,
        ],
      );
      const changed = await service.getDetail({
        dealId: `deal-${runId}-a`,
        ifNoneMatch: detail.etag,
      });
      assert.equal(changed.notModified, false);
      assert.notEqual(changed.etag, detail.etag);
      assert.equal(
        /** @type {any} */ (changed).detail.tasks[0].id,
        `task-${runId}`,
      );

      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query('BEGIN');
        await clientB.query('BEGIN');
        const insertedA = await insertEvent(
          clientA,
          `event-${runId}-a`,
          `deal-${runId}-a`,
          2,
          'deal.assigned',
        );
        let secondAssigned = false;
        const pendingB = insertEvent(
          clientB,
          `event-${runId}-b`,
          `task-${runId}`,
          2,
          'task.completed',
          `deal-${runId}-a`,
        ).then((result) => {
          secondAssigned = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(
          secondAssigned,
          false,
          'second cursor waits for the first cursor transaction',
        );
        await clientA.query('COMMIT');
        const insertedB = await pendingB;
        await clientB.query('COMMIT');
        assert.ok(insertedB > insertedA);
      } finally {
        await clientA.query('ROLLBACK').catch(() => {});
        await clientB.query('ROLLBACK').catch(() => {});
        clientA.release();
        clientB.release();
      }

      const replay = await service.readEvents({
        after: 0,
        limit: 100,
        topic: 'kanban',
      });
      const taskEvent = replay.events.find(
        (/** @type {any} */ event) => event.type === 'task.completed',
      );
      assert.equal(taskEvent?.dealId, `deal-${runId}-a`);
      assert.equal(
        (
          await service.readEvents({
            after: replay.cursor + 1,
            topic: 'kanban',
          })
        ).reset?.reason,
        'cursor_ahead',
      );
    } finally {
      await pool.end();
    }
  });
}

/** @param {import('pg').PoolClient} client @param {string} id @param {string} aggregateId @param {number} version @param {string} type @param {string=} dealId */
async function insertEvent(client, id, aggregateId, version, type, dealId) {
  const result = await client.query(
    `INSERT INTO crm.domain_events
       (id, aggregate_type, aggregate_id, aggregate_version, event_type,
        payload, correlation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
     RETURNING stream_cursor`,
    [
      id,
      type.startsWith('task.') ? 'task' : 'deal',
      aggregateId,
      version,
      type,
      JSON.stringify(
        dealId ? { dealId, status: 'completed', version } : { version },
      ),
      `correlation-${id}`,
      NOW,
    ],
  );
  return Number(result.rows[0].stream_cursor);
}

/** @param {Pool} pool @param {string} runId @param {'a'|'b'} suffix */
async function seed(pool, runId, suffix) {
  if (suffix === 'a') {
    await pool.query(
      `INSERT INTO crm.users (id,email,password_hash,created_at) VALUES ($1,$2,'$argon2id$fixture',$3)`,
      [`seller-${runId}`, `${runId}@example.test`, NOW],
    );
    await pool.query(
      `INSERT INTO crm.user_functions (user_id,function_name,assigned_at) VALUES ($1,'Vendedor',$2)`,
      [`seller-${runId}`, NOW],
    );
  }
  await pool.query(
    `INSERT INTO crm.contacts (id,provisional,version,created_at,updated_at) VALUES ($1,false,1,$2,$2)`,
    [`contact-${runId}-${suffix}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contact_identities
       (id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,
        identity_kind,phone_status,identity_envelope,key_version,version,created_at,updated_at)
     VALUES ($1,$2,'meta',$3,'instagram',$4,'handle','pending',$5::jsonb,1,1,$6,$6)`,
    [
      `identity-${runId}-${suffix}`,
      `contact-${runId}-${suffix}`,
      `account-${runId}-${suffix}`,
      suffix.repeat(64),
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.conversations
       (id,contact_identity_id,provider,provider_account_id,external_conversation_id,
        cycle_number,state,automation_state,automation_epoch,version,opened_at,last_message_at)
     VALUES ($1,$2,'meta',$3,$4,1,'requer_atencao','human',1,1,$5,$5)`,
    [
      `conversation-${runId}-${suffix}`,
      `identity-${runId}-${suffix}`,
      `account-${runId}-${suffix}`,
      `external-${runId}-${suffix}`,
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.deals
       (id,contact_id,source_conversation_id,stage,status,version,created_at,updated_at,assigned_user_id)
     VALUES ($1,$2,$3,'produto','active',1,$4,$4,$5)`,
    [
      `deal-${runId}-${suffix}`,
      `contact-${runId}-${suffix}`,
      `conversation-${runId}-${suffix}`,
      NOW,
      `seller-${runId}`,
    ],
  );
}
