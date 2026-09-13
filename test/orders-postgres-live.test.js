import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { defineOrderRepositoryContract } from './orders-repository-contract.test.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-12T12:00:00.000Z');
const ENVELOPE_KEY = Buffer.alloc(32, 61);

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
}

/** @param {Pool} pool */
async function seedConversation(pool) {
  const id = `conversation-${randomUUID()}`;
  await pool.query(
    `INSERT INTO crm.contacts (id, provisional, version, created_at, updated_at)
     VALUES ($1, false, 1, $2, $2)`,
    [`contact-${id}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contact_identities
       (id, current_contact_id, provider, provider_account_id, channel,
        external_identity_lookup_hash, identity_kind, phone_status,
        identity_envelope, key_version, version, created_at, updated_at)
     VALUES ($1, $2, 'meta', 'account-orders-live', 'instagram', $3, 'handle',
             'pending', $4::jsonb, 1, 1, $5, $5)`,
    [
      `identity-${id}`,
      `contact-${id}`,
      randomUUID().replaceAll('-', '').padEnd(64, '0'),
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.conversations
       (id, contact_identity_id, provider, provider_account_id,
        external_conversation_id, cycle_number, state, automation_state,
        automation_epoch, version, opened_at, last_message_at)
     VALUES ($1, $2, 'meta', 'account-orders-live', $3, 1, 'nova',
             'assistant', 0, 1, $4, $4)`,
    [id, `identity-${id}`, `external-${id}`, NOW],
  );
  return id;
}

if (connectionString) {
  const databaseName = new URL(connectionString).pathname.slice(1);
  assert.equal(
    databaseName,
    'crm_silmer_test',
    'orders live test only resets the dedicated crm_silmer_test database',
  );
  const pool = new Pool({ connectionString, max: 6 });
  const repository = new PostgresOrderRepository({
    database: databaseFor(pool),
    envelopeKey: ENVELOPE_KEY,
  });

  before(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
  });
  after(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await pool.end();
  });

  defineOrderRepositoryContract('PostgreSQL', async () => ({
    newConversationId: () => seedConversation(pool),
    readEvents: async (orderId) =>
      (
        await pool.query(
          `SELECT event_type, aggregate_version, payload
           FROM crm.domain_events
           WHERE aggregate_type = 'order' AND aggregate_id = $1
           ORDER BY stream_cursor`,
          [orderId],
        )
      ).rows.map((row) => ({
        aggregateVersion: Number(row.aggregate_version),
        eventType: row.event_type,
        payload: row.payload,
      })),
    repository,
  }));

  test('keeps every personal ficha field inside the encrypted envelope', async () => {
    const canary = `PII-canary-${randomUUID()}`;
    const conversationId = await seedConversation(pool);
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: {
        readOrderContext: async () => ({
          briefing: {
            city_or_postal_code: `${canary}-cidade`,
            delivery_address: `${canary}-endereco`,
            order_name: `${canary}-evento`,
            product_type: 'camisa',
          },
          customerName: `${canary}-cliente`,
        }),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const { order } = await service.ensurePendingFromIntent({
      conversationId,
      correlationId: 'correlation-pii',
    });
    assert.equal(order.ficha.summary.cliente, `${canary}-cliente`);
    assert.equal(
      order.ficha.serviceData.delivery_address,
      `${canary}-endereco`,
    );

    const raw = await pool.query(
      `SELECT to_jsonb(orders.*)::text AS row FROM crm.orders WHERE id = $1`,
      [order.id],
    );
    assert.doesNotMatch(raw.rows[0].row, new RegExp(canary, 'u'));
    const envelope = (
      await pool.query('SELECT ficha_envelope FROM crm.orders WHERE id = $1', [
        order.id,
      ])
    ).rows[0].ficha_envelope;
    assert.deepEqual(Object.keys(envelope).sort(), [
      'algorithm',
      'ciphertext',
      'iv',
      'keyVersion',
      'tag',
      'version',
    ]);
    const events = await pool.query(
      `SELECT payload::text AS payload FROM crm.domain_events
       WHERE aggregate_type = 'order' AND aggregate_id = $1`,
      [order.id],
    );
    assert.equal(events.rows.length, 1);
    assert.doesNotMatch(events.rows[0].payload, new RegExp(canary, 'u'));

    // The envelope is bound to its row: another key cannot read it.
    const otherKey = new PostgresOrderRepository({
      database: databaseFor(pool),
      envelopeKey: Buffer.alloc(32, 62),
    });
    await assert.rejects(otherKey.findById(order.id));
  });

  test('refuses an order for a conversation that does not exist', async () => {
    await assert.rejects(
      repository.createPending({
        conversationId: `conversation-missing-${randomUUID()}`,
        correlationId: 'correlation-missing',
        createdBy: null,
        createdByKind: 'automation',
        fabCode: '01',
        ficha: {
          items: [],
          observations: [],
          serviceData: {},
          summary: {
            aplicacao: null,
            cliente: '',
            data_entrega_confirmada: null,
            nome: null,
          },
        },
        id: randomUUID(),
        missingFields: ['items'],
        now: NOW,
        totalPieces: 0,
      }),
      { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 },
    );
  });

  test('rejects a key that is not 32 bytes', () => {
    assert.throws(
      () =>
        new PostgresOrderRepository({
          database: databaseFor(pool),
          envelopeKey: Buffer.alloc(16),
        }),
      TypeError,
    );
  });
}
