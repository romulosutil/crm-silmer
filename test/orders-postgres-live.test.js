import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import { createOrderRuntime } from '../apps/api/src/order-runtime.js';
import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import { PostgresIdempotencyRecordStore } from '../modules/integration-reliability/src/index.js';
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
  // A branch may run its own copy (crm_silmer_test_<branch>) next to others.
  assert.match(
    databaseName,
    /^crm_silmer_test(?:_[a-z0-9]+)?$/u,
    'orders live test only resets a dedicated crm_silmer_test database',
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
        firstContactAt: null,
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

    const { version: conversationVersion } = (
      await pool.query('SELECT version FROM crm.conversations WHERE id = $1', [
        conversation.id,
      ])
    ).rows[0];
    assert.deepEqual(await port.readAssignment(conversation.id), {
      assignedUserId: sellerId,
      version: Number(conversationVersion),
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
      openedAt: NOW.toISOString(),
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
    const { order } = await service.ensurePendingFromIntent({
      conversationId: conversation.id,
      correlationId: `correlation-port-${runId}`,
    });
    // PLA-02: the order keeps the day its conversation opened.
    assert.equal(order.firstContactAt, NOW.toISOString());
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
    // Fewer than four digits never match a phone; "#" never appears in a
    // seeded name or handle, so this checks only the digit rule.
    assert.deepEqual(await port.searchConversationIds('#12'), []);
  });

  test('names the customer only from a confirmed name, never the channel handle (ADR 016)', async () => {
    const database = databaseFor(pool);
    const port = new PostgresOrderConversationPort({
      contactEnvelopeKey: CONTACT_KEY,
      database,
      envelopeKey: ENVELOPE_KEY,
    });
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: port,
      fabCode: '01',
      repository,
    });
    /** @param {string} conversationId @param {Record<string, unknown>} briefing */
    const writeBriefing = (conversationId, briefing) =>
      pool.query(
        `UPDATE crm.conversations
         SET briefing_version = 2, briefing_envelope = $2::jsonb,
             briefing_updated_at = $3
         WHERE id = $1`,
        [
          conversationId,
          JSON.stringify(
            encryptJson(
              briefing,
              `n8n-briefing:${conversationId}:2`,
              ENVELOPE_KEY,
            ),
          ),
          NOW,
        ],
      );
    /** @param {string} conversationId @param {string} name @param {string} source */
    const nameContact = (conversationId, name, source) =>
      pool.query(
        `UPDATE crm.contacts contact
         SET display_name = $2, display_name_source = $3
         FROM crm.conversations conversation
         JOIN crm.contact_identities identity
           ON identity.id = conversation.contact_identity_id
         WHERE conversation.id = $1 AND contact.id = identity.current_contact_id`,
        [conversationId, name, source],
      );

    // An Instagram contact with no name: the "@handle" is not a name.
    const unnamed = await seedConversation(pool);
    assert.equal((await port.readOrderContext(unnamed))?.customerName, null);
    const blank = await service.ensurePendingFromIntent({
      conversationId: unnamed,
      correlationId: 'correlation-unnamed',
    });
    assert.equal(blank.order.ficha.summary.cliente, '');

    // Without a confirmed contact name, the name the customer gave the bot.
    const told = await seedConversation(pool, { channel: 'whatsapp' });
    await writeBriefing(told, { customer_name: 'Nome Dito Ao Bot' });
    const fromBriefing = await service.ensurePendingFromIntent({
      conversationId: told,
      correlationId: 'correlation-told',
    });
    assert.equal(fromBriefing.order.ficha.summary.cliente, 'Nome Dito Ao Bot');

    // A name promoted from the bot, or typed by a person, wins.
    const promoted = await seedConversation(pool);
    await nameContact(promoted, 'Nome Promovido', 'automation');
    await writeBriefing(promoted, { customer_name: 'Outro Nome' });
    assert.equal(
      (await port.readOrderContext(promoted))?.customerName,
      'Nome Promovido',
    );
    const renamed = await seedConversation(pool, { channel: 'whatsapp' });
    await nameContact(renamed, 'Nome Do Vendedor', 'manual');
    const byPerson = await service.ensurePendingFromIntent({
      conversationId: renamed,
      correlationId: 'correlation-renamed',
    });
    assert.equal(byPerson.order.ficha.summary.cliente, 'Nome Do Vendedor');
  });

  test('the orders runtime replays a command key and audits it once in PostgreSQL', async () => {
    const runId = randomUUID().replaceAll('-', '');
    const database = databaseFor(pool);
    const conversationId = await seedConversation(pool);
    const sellerId = `seller-runtime-${runId}`;
    await pool.query(
      `INSERT INTO crm.users (id, email, password_hash, name)
       VALUES ($1, $2, '$argon2id$synthetic', 'Vendedor Runtime')`,
      [sellerId, `${sellerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO crm.user_functions (user_id, function_name)
       VALUES ($1, 'Vendedor')`,
      [sellerId],
    );
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = $2 WHERE id = $1',
      [conversationId, sellerId],
    );
    const conversationVersion = Number(
      (
        await pool.query(
          'SELECT version FROM crm.conversations WHERE id = $1',
          [conversationId],
        )
      ).rows[0].version,
    );
    const runtime = createOrderRuntime({
      access: {
        authorizeRead: async () => ({ actor: null }),
        authorizeWrite: async () => ({ actor: null }),
      },
      auditTrail: new PostgresAuditTrail(database),
      conversations: new PostgresOrderConversationPort({
        contactEnvelopeKey: CONTACT_KEY,
        database,
        envelopeKey: ENVELOPE_KEY,
      }),
      fabCode: '01',
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 66),
      }),
      repository,
    });
    const actor = { capabilities: [], id: sellerId, kind: 'human' };

    const created = await runtime.createManual({
      actor,
      conversationId,
      correlationId: `correlation-create-${runId}`,
      expectedVersion: conversationVersion,
      idempotencyKey: `create-${runId}`,
    });
    assert.equal(created.created, true);
    assert.deepEqual(created.order.seller, {
      id: sellerId,
      name: 'Vendedor Runtime',
    });

    const patch = {
      actor,
      correlationId: `correlation-patch-${runId}`,
      expectedVersion: created.order.version,
      idempotencyKey: `patch-${runId}`,
      orderId: created.order.id,
      section: 'observations',
      value: ['Conferir arte'],
    };
    const [first, concurrent] = await Promise.all([
      runtime.patchSection(patch),
      runtime.patchSection({ ...patch }),
    ]);
    assert.deepEqual(concurrent, first);
    assert.equal(first.version, created.order.version + 1);
    const replay = await runtime.patchSection({ ...patch });
    assert.deepEqual(replay, first);
    await assert.rejects(runtime.patchSection({ ...patch, value: ['Outra'] }), {
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });

    const stored = await pool.query(
      `SELECT status, response::text AS response FROM crm.idempotency_records
       WHERE idempotency_key = $1`,
      [`patch-${runId}`],
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].status, 'completed');
    assert.doesNotMatch(stored.rows[0].response, /Conferir arte/u);
    const audits = await pool.query(
      `SELECT action FROM crm.audit_events
       WHERE target_id = $1 ORDER BY occurred_at`,
      [created.order.id],
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action),
      ['order.edit'],
    );
    const events = await pool.query(
      `SELECT event_type FROM crm.domain_events
       WHERE aggregate_type = 'order' AND aggregate_id = $1
       ORDER BY stream_cursor`,
      [created.order.id],
    );
    assert.deepEqual(
      events.rows.map((row) => row.event_type),
      ['order.created', 'order.section_saved'],
    );

    // PCL-09: two confirmations race on one version in separate transactions.
    const promised = await runtime.patchSection({
      ...patch,
      expectedVersion: first.version,
      idempotencyKey: `summary-${runId}`,
      section: 'summary',
      value: {
        aplicacao: null,
        data_entrega_confirmada: '2026-10-24',
        nome: null,
      },
    });
    const ready = await runtime.patchSection({
      ...patch,
      expectedVersion: promised.version,
      idempotencyKey: `items-${runId}`,
      section: 'items',
      value: [
        {
          cor: 'AZUL',
          cor_costas: 'AZUL',
          cor_frente: 'AZUL',
          cor_manga_direita: 'AZUL',
          cor_manga_esquerda: 'AZUL',
          estampa: 'Arte do cliente',
          gola: 'GOLA V',
          grade: [{ quantidade: 3, tamanho: 'M' }],
          malhas: ['DRY FIT'],
          modelo: 'TRADICIONAL',
          tipo: 'CAMISA',
          vies_gola: 'AZUL',
          vies_mangas: 'NAO APLICAVEL',
        },
      ],
    });
    const outcomes = await Promise.allSettled(
      ['one', 'two'].map((suffix) =>
        runtime.confirm({
          actor,
          amountText: '150,00',
          correlationId: `correlation-confirm-${runId}`,
          expectedVersion: ready.version,
          idempotencyKey: `confirm-${suffix}-${runId}`,
          orderId: ready.id,
          paymentCondition: 'pix',
        }),
      ),
    );
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [
      'fulfilled',
      'rejected',
    ]);
    const lost = /** @type {PromiseRejectedResult} */ (
      outcomes.find((outcome) => outcome.status === 'rejected')
    );
    assert.equal(lost.reason.statusCode, 409);
    const confirmedRow = await pool.query(
      `SELECT status, final_amount_cents, version FROM crm.orders WHERE id = $1`,
      [ready.id],
    );
    assert.equal(confirmedRow.rows[0].status, 'confirmado');
    assert.equal(Number(confirmedRow.rows[0].version), ready.version + 1);
    const confirmAudits = await pool.query(
      `SELECT count(*)::integer AS total FROM crm.audit_events
       WHERE target_id = $1 AND action = 'order.confirm'`,
      [ready.id],
    );
    assert.equal(confirmAudits.rows[0].total, 1);
  });

  test('an order built on the seven points: from the briefing to generating it (ADR 016)', async () => {
    const runId = randomUUID().replaceAll('-', '');
    const conversationId = await seedConversation(pool);
    /** @type {Record<string, unknown>} */
    let briefing = {
      colors: 'preta',
      customer_name: 'Cliente Sete Pontos',
      product_model: 'camiseta comum',
      quantity: 30,
    };
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: {
        readOrderContext: async () => ({ briefing, customerName: null }),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const actor = { capabilities: [], id: `seller-${runId}`, kind: 'human' };

    // The bot opens the order on the first points it has.
    const { order: created } = await service.ensurePendingFromIntent({
      conversationId,
      correlationId: `correlation-intent-${runId}`,
    });
    assert.equal(created.ficha.summary.cliente, 'Cliente Sete Pontos');
    assert.equal(created.ficha.items[0].tipo, 'camiseta comum');
    assert.equal(created.ficha.items[0].cor, 'preta');
    assert.equal(created.ficha.serviceData.quantity, 30);
    assert.deepEqual(created.missingFields, [
      'items[0].estampa',
      'items[0].malhas',
      'items[0].grade',
      'items[0].gola',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ]);

    // ...and projects the rest while it holds the conversation.
    briefing = {
      ...briefing,
      artwork_status: 'vai mandar a logo',
      artwork_technique: 'estampada',
      collar: 'Definir com o vendedor',
      fabrics: 'algodão',
      sizes: '10 P, 15 M e 5 G',
    };
    const projected = await service.projectAgentBriefing({
      automationState: 'assistant',
      briefing,
      conversationId,
      correlationId: `correlation-projection-${runId}`,
    });
    assert.equal(projected.applied, true);
    const order = /** @type {any} */ (projected.order);
    assert.equal(order.ficha.items[0].estampa, 'vai mandar a logo');
    assert.deepEqual(order.ficha.items[0].malhas, ['algodão']);
    assert.equal(order.ficha.items[0].gola, '');
    assert.equal(order.ficha.summary.aplicacao, null);
    assert.equal(order.ficha.serviceData.artwork_technique, 'estampada');
    assert.equal(order.ficha.serviceData.collar, 'Definir com o vendedor');
    assert.equal(order.totalPieces, 30);
    assert.deepEqual(order.missingFields, [
      'items[0].gola',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ]);
    const stored = await repository.findById(order.id);
    assert.deepEqual(stored?.missingFields, order.missingFields);

    // The seller saves a second item half filled.
    const [first] = order.ficha.items;
    const partial = await service.patchSection({
      actor,
      correlationId: `correlation-items-${runId}`,
      expectedVersion: order.version,
      orderId: order.id,
      section: 'items',
      value: [first, { ...first, cor: '', grade: [], tipo: 'regata' }],
    });
    assert.equal(partial.totalPieces, 30);

    /** @param {any} current @param {{amountText?: string, paymentCondition?: string}} body */
    const confirm = (current, body) =>
      service.confirm({
        actor,
        amountText: body.amountText,
        correlationId: `correlation-confirm-${runId}`,
        expectedVersion: current.version,
        orderId: current.id,
        paymentCondition: body.paymentCondition,
      });
    await assert.rejects(confirm(partial, {}), {
      code: 'ORDER_NOT_CONFIRMABLE',
      fields: [
        'items[0].gola',
        'items[1].cor',
        'items[1].grade',
        'items[1].gola',
        'summary.data_entrega_confirmada',
        'finalAmount',
        'paymentCondition',
      ],
    });

    const complete = await service.patchSection({
      actor,
      correlationId: `correlation-complete-${runId}`,
      expectedVersion: partial.version,
      orderId: order.id,
      section: 'items',
      value: [
        { ...first, gola: 'gola redonda' },
        {
          ...first,
          cor: 'branca',
          gola: 'regata',
          grade: [{ quantidade: 4, tamanho: 'GG' }],
          tipo: 'regata',
        },
      ],
    });
    assert.deepEqual(complete.missingFields, [
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ]);
    await assert.rejects(confirm(complete, { amountText: '980,00' }), {
      code: 'ORDER_NOT_CONFIRMABLE',
      fields: ['summary.data_entrega_confirmada', 'paymentCondition'],
    });

    // The promised delivery must be a real day, as the date picker stores it.
    /** @param {any} current @param {string} day */
    const promise = (current, day) =>
      service.patchSection({
        actor,
        correlationId: `correlation-promise-${runId}-${day}`,
        expectedVersion: current.version,
        orderId: current.id,
        section: 'summary',
        value: { aplicacao: null, data_entrega_confirmada: day, nome: null },
      });
    const typed = await promise(complete, '24/10/2026');
    await assert.rejects(
      confirm(typed, { amountText: '980,00', paymentCondition: 'pix' }),
      {
        code: 'ORDER_NOT_CONFIRMABLE',
        fields: ['summary.data_entrega_confirmada'],
      },
    );
    const ready = await promise(typed, '2026-10-24');
    assert.deepEqual(ready.missingFields, ['finalAmount', 'paymentCondition']);
    // Generating means the order is paid until the CRM handles payments: no
    // paid day is needed, and none is invented.
    assert.equal(ready.paidOn, null);
    const generated = await confirm(ready, {
      amountText: '980,00',
      paymentCondition: 'pix',
    });
    assert.equal(generated.status, 'confirmado');
    assert.equal(generated.totalPieces, 34);
    assert.equal(generated.paidOn, null);
    assert.equal(generated.deliveredOn, null);
    assert.deepEqual(generated.missingFields, []);
  });

  test('reads a ficha stored before ADR 016 with the new item fields blank', async () => {
    const conversationId = await seedConversation(pool);
    const legacy = await repository.createPending({
      conversationId,
      correlationId: 'correlation-legacy',
      createdBy: null,
      createdByKind: 'automation',
      fabCode: '01',
      ficha: /** @type {any} */ ({
        items: [
          {
            cor_costas: '',
            cor_frente: '',
            cor_manga_direita: '',
            cor_manga_esquerda: '',
            grade: [],
            malhas: [],
            modelo: 'camiseta comum, gola V',
            tipo: '',
            vies_gola: '',
            vies_mangas: '',
          },
        ],
        observations: [],
        serviceData: { colors: 'preta' },
        summary: {
          aplicacao: null,
          cliente: '',
          data_entrega_confirmada: null,
          nome: null,
        },
      }),
      firstContactAt: null,
      id: randomUUID(),
      missingFields: ['items', 'finalAmount', 'summary.cliente'],
      now: NOW,
      totalPieces: 0,
    });
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: {
        readOrderContext: async () => null,
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const read = await service.get(legacy.id);
    assert.deepEqual(
      [
        read.ficha.items[0].cor,
        read.ficha.items[0].estampa,
        read.ficha.items[0].gola,
      ],
      ['', '', ''],
    );
    assert.deepEqual(read.missingFields, [
      'items[0].tipo',
      'items[0].cor',
      'items[0].estampa',
      'items[0].malhas',
      'items[0].grade',
      'items[0].gola',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
    ]);
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
