import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import {
  PostgresContactIdentityRepository,
  createContactIdentityService,
} from '../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresInboxRepository,
  createInboxService,
} from '../modules/inbox-channels/src/index.js';
import { encryptJson } from '../modules/orders/src/adapters/envelope.js';
import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { defineOrderRepositoryContract } from './orders-repository-contract.test.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-12T12:00:00.000Z');
const ENVELOPE_KEY = Buffer.alloc(32, 61);
const CONTACT_KEY = Buffer.alloc(32, 65);

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    transaction: (/** @type {any} */ work) => withTransaction(pool, work),
  };
}

/** @param {Pool} pool */
function channelServices(pool) {
  const database = databaseFor(pool);
  const auditPort = { append: async () => undefined };
  return {
    contacts: createContactIdentityService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: CONTACT_KEY,
        lookupKey: Buffer.alloc(32, 63),
      }),
    }),
    inbox: createInboxService({
      auditPort,
      clock: () => NOW,
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: Buffer.alloc(32, 64),
        outboundMessageOutbox: { enqueueChannelMessage: async () => undefined },
      }),
    }),
  };
}

/**
 * Creates a conversation through the channel services, so its identity
 * envelope is real and the order search can decrypt it.
 *
 * @param {Pool} pool
 * @param {{channel?: 'instagram'|'whatsapp', externalIdentityId?: string}} [options]
 */
async function seedConversation(pool, options = {}) {
  const runId = randomUUID().replaceAll('-', '');
  const whatsapp = options.channel === 'whatsapp';
  const { contacts, inbox } = channelServices(pool);
  const resolved = await contacts.resolveInboundIdentity({
    channel: whatsapp ? 'whatsapp' : 'instagram',
    correlationId: `correlation-identity-${runId}`,
    displayHandle: whatsapp ? null : `@orders_${runId.slice(0, 8)}`,
    externalIdentityId: options.externalIdentityId ?? `identity-${runId}`,
    identityKind: whatsapp ? 'phone' : 'handle',
    occurredAt: NOW.toISOString(),
    phoneStatus: whatsapp ? 'confirmed' : 'pending',
    provider: 'meta',
    providerAccountId: `account-orders-${runId}`,
  });
  const { conversation } = await inbox.receiveInbound({
    contactId: resolved.contact.id,
    correlationId: `correlation-message-${runId}`,
    externalConversationId: `conversation-${runId}`,
    externalMessageId: `message-${runId}`,
    identityId: resolved.identity.id,
    message: { content: { text: 'Quero orçamento' }, type: 'text' },
    occurredAt: NOW.toISOString(),
    provider: 'meta',
    providerAccountId: `account-orders-${runId}`,
  });
  return /** @type {string} */ (conversation.id);
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

  test('reads owner, customer, pre-ficha and search matches from the conversation', async () => {
    const runId = randomUUID().replaceAll('-', '');
    const database = databaseFor(pool);
    const phone = `55119${runId.replace(/\D/gu, '').padEnd(8, '7').slice(0, 8)}`;
    const conversation = {
      id: await seedConversation(pool, {
        channel: 'whatsapp',
        externalIdentityId: phone,
      }),
    };
    const sellerId = `seller-port-${runId}`;
    await pool.query(
      `INSERT INTO crm.users (id, email, password_hash, name)
       VALUES ($1, $2, '$argon2id$synthetic', 'Vendedora Sintetica')`,
      [sellerId, `${sellerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO crm.user_functions (user_id, function_name)
       VALUES ($1, 'Vendedor')`,
      [sellerId],
    );
    await pool.query(
      `UPDATE crm.contacts contact SET display_name = 'Conceição Sintética'
       FROM crm.conversations conversation
       JOIN crm.contact_identities identity
         ON identity.id = conversation.contact_identity_id
       WHERE conversation.id = $1 AND contact.id = identity.current_contact_id`,
      [conversation.id],
    );
    await pool.query(
      `UPDATE crm.conversations
       SET assigned_user_id = $2, briefing_version = 3,
           briefing_envelope = $3::jsonb, briefing_updated_at = $4
       WHERE id = $1`,
      [
        conversation.id,
        sellerId,
        JSON.stringify(
          encryptJson(
            { order_name: 'Equipe Sintetica', product_type: 'camisa' },
            `n8n-briefing:${conversation.id}:3`,
            ENVELOPE_KEY,
          ),
        ),
        NOW,
      ],
    );
    const port = new PostgresOrderConversationPort({
      contactEnvelopeKey: CONTACT_KEY,
      database,
      envelopeKey: ENVELOPE_KEY,
    });

    assert.deepEqual(await port.readAssignment(conversation.id), {
      assignedUserId: sellerId,
    });
    assert.equal(await port.readAssignment(`missing-${runId}`), null);
    assert.deepEqual(
      await port.readAssignments([conversation.id, `missing-${runId}`]),
      new Map([[conversation.id, sellerId]]),
    );
    assert.deepEqual(await port.readAssignments([]), new Map());
    assert.deepEqual(
      await port.readUserNames([sellerId, `missing-${runId}`]),
      new Map([[sellerId, 'Vendedora Sintetica']]),
    );
    assert.deepEqual(await port.readUserNames([]), new Map());
    assert.deepEqual(await port.readOrderContext(conversation.id), {
      briefing: { order_name: 'Equipe Sintetica', product_type: 'camisa' },
      customerName: 'Conceição Sintética',
    });
    assert.equal(await port.readOrderContext(`missing-${runId}`), null);

    // Search only looks at conversations that already have orders.
    assert.deepEqual(await port.searchConversationIds('conceicao'), []);
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: port,
      fabCode: '01',
      repository,
    });
    await service.ensurePendingFromIntent({
      conversationId: conversation.id,
      correlationId: `correlation-port-${runId}`,
    });
    assert.deepEqual(await port.searchConversationIds('CONCEICAO sint'), [
      conversation.id,
    ]);
    assert.deepEqual(
      await port.searchConversationIds(
        `(${phone.slice(2, 4)}) ${phone.slice(4, 9)}`,
      ),
      [conversation.id],
    );
    assert.deepEqual(await port.searchConversationIds('ninguem'), []);
    assert.deepEqual(await port.searchConversationIds('12'), []);
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
