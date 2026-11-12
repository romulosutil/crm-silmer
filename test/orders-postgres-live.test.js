import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import {
  createConversationShippingRuntime,
  createShippingQuoteReader,
} from '../apps/api/src/conversation-shipping-runtime.js';
import { readDashboardPerformance } from '../apps/api/src/dashboard-runtime.js';
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
import { InMemoryObjectStorage } from '../modules/orders/src/adapters/in-memory-order-files.js';
import { PostgresOrderFileRepository } from '../modules/orders/src/adapters/postgres-order-file-repository.js';
import { S3ObjectStorage } from '../modules/orders/src/adapters/s3-object-storage.js';
import { createOrderFileService } from '../modules/orders/src/application/order-file-service.js';
import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import {
  OrderConflictError,
  OrderForbiddenError,
} from '../modules/orders/src/domain/errors.js';
import { defineOrderRepositoryContract } from './orders-repository-contract.test.js';
import { orderContextsFrom } from './fixtures/order-contexts.js';
import { syntheticItems } from './fixtures/order-items.js';
import { persistFixturePricing, priceDraft } from './fixtures/size-pricing.js';

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
  // Order creation now requires a callable phone. The order suite uses a
  // synthetic manual alias when it seeds a non-WhatsApp channel.
  await pool.query(
    `INSERT INTO crm.contact_phone_lookup
       (contact_id, identity_id, phone_hash, source)
     VALUES ($1, $2, $3, $4)`,
    [
      resolved.contact.id,
      whatsapp ? resolved.identity.id : null,
      runId.padEnd(64, '0'),
      whatsapp ? 'whatsapp' : 'manual',
    ],
  );
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
    await pool.query(
      `INSERT INTO crm.users (id, email, password_hash, name)
       VALUES ('seller-contract', 'seller-contract@example.test',
               '$argon2id$synthetic', 'Vendedor Contrato')`,
    );
    // ADR 080: the freight write re-reads that its actor is an active Vendedor.
    await pool.query(
      `INSERT INTO crm.user_functions (user_id, function_name)
       VALUES ('seller-contract', 'Vendedor')`,
    );
  });
  after(async () => {
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await pool.end();
  });

  defineOrderRepositoryContract('PostgreSQL', async () => ({
    newConversationId: async () => {
      const id = await seedConversation(pool);
      await pool.query(
        `UPDATE crm.conversations SET assigned_user_id = 'seller-contract'
         WHERE id = $1`,
        [id],
      );
      return id;
    },
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
        readOrderContexts: orderContextsFrom(() => ({
          briefing: {
            city_or_postal_code: `${canary}-cidade`,
            delivery_address: `${canary}-endereco`,
            order_name: `${canary}-evento`,
            product_type: 'camisa',
          },
          customerName: `${canary}-cliente`,
        })),
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

  /**
   * A closed conversation owned by one seller, next to a seller with no claim
   * on it. `attempt` sends a complete order, so only the guards can stop it.
   */
  async function seedClosedConversation() {
    const tag = randomUUID().replaceAll('-', '').slice(0, 10);
    const conversationId = await seedConversation(pool);
    const owner = {
      id: `closed-owner-${tag}`,
      kind: 'human',
      capabilities: [],
    };
    const outsider = {
      id: `closed-outsider-${tag}`,
      kind: 'human',
      capabilities: [],
    };
    for (const [id, name] of [
      [owner.id, 'Vendedor Dono'],
      [outsider.id, 'Vendedor Sem Posse'],
    ]) {
      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash, name)
         VALUES ($1, $2, '$argon2id$synthetic', $3)`,
        [id, `${id}@example.test`, name],
      );
    }
    await pool.query(
      `UPDATE crm.conversations
       SET assigned_user_id = $2, state = 'sem_lead', terminal_at = now(),
           version = version + 1
       WHERE id = $1`,
      [conversationId, owner.id],
    );
    const orderId = randomUUID();
    return {
      /** @param {{id: string, kind: string, capabilities: string[]}} actor */
      attempt: (actor) =>
        repository.createPending({
          actor,
          conversationId,
          correlationId: `correlation-closed-${tag}`,
          createdBy: actor.id,
          createdByKind: 'user',
          fabCode: '01',
          ficha: {
            artwork: {
              feito_pelo_cliente: true,
              feito_pela_silmer: false,
              files: [],
              sem_estampa: false,
            },
            items: /** @type {any} */ (syntheticItems()),
            observations: [],
            serviceData: {},
            summary: {
              aplicacao: null,
              cliente: 'Cliente Sintetico',
              data_entrega_confirmada: '2026-10-24',
              nome: 'Evento Sintetico',
            },
          },
          firstContactAt: NOW.toISOString(),
          id: orderId,
          missingFields: ['finalAmount', 'paymentCondition'],
          now: NOW,
          totalPieces: 32,
        }),
      async assertNothingCreated() {
        const orders = await pool.query(
          'SELECT count(*) AS total FROM crm.orders WHERE conversation_id = $1',
          [conversationId],
        );
        assert.equal(Number(orders.rows[0].total), 0);
        const events = await pool.query(
          `SELECT count(*) AS total FROM crm.domain_events
           WHERE aggregate_type = 'order' AND aggregate_id = $1`,
          [orderId],
        );
        assert.equal(Number(events.rows[0].total), 0);
      },
      outsider,
      owner,
    };
  }

  test('a closed conversation answers an actor without ownership as forbidden, hiding that it is closed', async () => {
    const { assertNothingCreated, attempt, outsider } =
      await seedClosedConversation();
    await assert.rejects(attempt(outsider), (/** @type {any} */ error) => {
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.statusCode, 403);
      assert.ok(error instanceof OrderForbiddenError);
      return true;
    });
    await assertNothingCreated();
  });

  test('a closed conversation refuses a new order from its owner as a conflict', async () => {
    const { assertNothingCreated, attempt, owner } =
      await seedClosedConversation();
    await assert.rejects(attempt(owner), (/** @type {any} */ error) => {
      assert.equal(error.code, 'CONVERSATION_CLOSED');
      assert.equal(error.statusCode, 409);
      assert.ok(error instanceof OrderConflictError);
      return true;
    });
    await assertNothingCreated();
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
      contactLookupKey: Buffer.alloc(32, 66),
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
    assert.deepEqual(
      await port.readOrderContexts([conversation.id, `missing-${runId}`]),
      new Map([
        [
          conversation.id,
          {
            briefing: {
              order_name: 'Equipe Sintetica',
              product_type: 'camisa',
            },
            customerName: 'Conceição Sintética',
            openedAt: NOW.toISOString(),
          },
        ],
      ]),
    );
    assert.deepEqual(await port.readOrderContexts([]), new Map());

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
      contactLookupKey: Buffer.alloc(32, 66),
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
    assert.equal(
      (await port.readOrderContexts([unnamed])).get(unnamed)?.customerName,
      null,
    );
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
      (await port.readOrderContexts([promoted])).get(promoted)?.customerName,
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

  test('the client follows the renamed contact while pending and stays on the generated order (ADR 018)', async () => {
    const tag = randomUUID().replaceAll('-', '').slice(0, 8);
    const port = new PostgresOrderConversationPort({
      contactEnvelopeKey: CONTACT_KEY,
      contactLookupKey: Buffer.alloc(32, 66),
      database: databaseFor(pool),
      envelopeKey: ENVELOPE_KEY,
    });
    const service = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: port,
      fabCode: '01',
      repository,
    });
    const actor = { capabilities: [], id: `seller-${tag}`, kind: 'human' };
    // An Instagram contact: its "@handle" must never become the client.
    const conversationId = await seedConversation(pool);
    await pool.query(
      `INSERT INTO crm.users (id, email, password_hash, name)
       VALUES ($1, $2, '$argon2id$synthetic', 'Vendedor Nome')`,
      [actor.id, `${actor.id}@example.test`],
    );
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = $2 WHERE id = $1',
      [conversationId, actor.id],
    );
    await pool.query(
      `UPDATE crm.conversations
       SET briefing_version = 1, briefing_envelope = $2::jsonb,
           briefing_updated_at = $3
       WHERE id = $1`,
      [
        conversationId,
        JSON.stringify(
          encryptJson(
            { customer_name: 'Nome Dito Ao Bot', product_type: 'camisa' },
            `n8n-briefing:${conversationId}:1`,
            ENVELOPE_KEY,
          ),
        ),
        NOW,
      ],
    );
    /** @param {string|null} name @param {'automation'|'manual'} source */
    const nameContact = (name, source) =>
      pool.query(
        `UPDATE crm.contacts contact
         SET display_name = $2, display_name_source = $3,
             version = contact.version + 1
         FROM crm.conversations conversation
         JOIN crm.contact_identities identity
           ON identity.id = conversation.contact_identity_id
         WHERE conversation.id = $1 AND contact.id = identity.current_contact_id`,
        [conversationId, name, source],
      );
    // The unfiltered listing sorts by (updated_at, id) and this suite runs on
    // a fixed clock, so a random id decides where the order lands among the
    // earlier tests' orders: walk the pages instead of trusting the first.
    /** @param {string} orderId */
    const inListing = async (orderId) => {
      /** @type {string|null} */
      let cursor = null;
      do {
        const page = await service.list({ cursor });
        const listed = page.items.find(
          (/** @type {any} */ order) => order.id === orderId,
        );
        if (listed) return listed;
        cursor = page.nextCursor;
      } while (cursor);
      return undefined;
    };
    /** @param {string} orderId */
    const shown = async (orderId) => {
      const listed = await inListing(orderId);
      return {
        current: (await service.currentForConversation(conversationId))?.ficha
          .summary.cliente,
        detail: (await service.get(orderId)).ficha.summary.cliente,
        list: listed?.ficha.summary.cliente,
      };
    };
    /** @param {string} cliente */
    const everywhere = (cliente) => ({
      current: cliente,
      detail: cliente,
      list: cliente,
    });
    /** @param {string} orderId */
    const orderEvents = async (orderId) =>
      (
        await pool.query(
          `SELECT event_type FROM crm.domain_events
           WHERE aggregate_type = 'order' AND aggregate_id = $1
           ORDER BY stream_cursor`,
          [orderId],
        )
      ).rows.map((row) => row.event_type);

    const { order: created } = await service.ensurePendingFromIntent({
      conversationId,
      correlationId: `correlation-follow-${tag}`,
    });
    assert.equal(created.ficha.summary.cliente, 'Nome Dito Ao Bot');

    // PCT-01: the name the bot promoted, then the one a person typed, reach
    // the pending order on every read, and the search finds it by the new
    // name; the order itself does not change.
    await nameContact(`Cliente Promovida ${tag}`, 'automation');
    assert.deepEqual(
      await shown(created.id),
      everywhere(`Cliente Promovida ${tag}`),
    );
    await nameContact(`Cliente Renomeada ${tag}`, 'manual');
    assert.deepEqual(
      await shown(created.id),
      everywhere(`Cliente Renomeada ${tag}`),
    );
    const found = await service.list({ q: `renomeada ${tag}` });
    assert.deepEqual(
      found.items.map((/** @type {any} */ order) => [
        order.id,
        order.ficha.summary.cliente,
      ]),
      [[created.id, `Cliente Renomeada ${tag}`]],
    );
    const untouched = await repository.findById(created.id);
    assert.equal(untouched?.version, created.version);
    assert.equal(untouched?.updatedAt, created.updatedAt);
    assert.deepEqual(await orderEvents(created.id), ['order.created']);

    // A name cleared by a person falls back to the bot's, never the handle.
    await nameContact(null, 'manual');
    assert.deepEqual(await shown(created.id), everywhere('Nome Dito Ao Bot'));

    // PCT-02: generating writes down the name the order showed then.
    await nameContact(`Cliente Renomeada ${tag}`, 'manual');
    const promised = await service.patchSection({
      actor,
      correlationId: `correlation-follow-summary-${tag}`,
      expectedVersion: created.version,
      orderId: created.id,
      section: 'summary',
      value: {
        aplicacao: null,
        data_entrega_confirmada: '2026-10-24',
        nome: null,
      },
    });
    const ready = await service.patchSection({
      actor,
      correlationId: `correlation-follow-items-${tag}`,
      expectedVersion: promised.version,
      orderId: created.id,
      section: 'items',
      value: [
        {
          cor: 'AZUL',
          cor_costas: '',
          cor_frente: '',
          cor_manga_direita: '',
          cor_manga_esquerda: '',
          estampa: '',
          gola: 'GOLA REDONDA',
          grade: [{ quantidade: 3, tamanho: 'M' }],
          malhas: ['DRY FIT'],
          modelo: '',
          tipo: 'CAMISA',
          tipo_servico: 'Sem estampa',
          vies_gola: '',
          vies_mangas: '',
        },
      ],
    });
    let marked = await service.patchSection({
      actor,
      correlationId: `correlation-follow-artwork-${tag}`,
      expectedVersion: ready.version,
      orderId: created.id,
      section: 'artwork',
      value: {
        feito_pela_silmer: false,
        feito_pelo_cliente: false,
        sem_estampa: true,
      },
    });
    marked = await priceDraft(service, marked, 15000, actor);
    await nameContact(`Cliente Na Geracao ${tag}`, 'manual');
    const generated = await service.confirm({
      actor,
      amountText: '150,00',
      correlationId: `correlation-follow-confirm-${tag}`,
      expectedVersion: marked.version,
      orderId: created.id,
      paymentCondition: 'pix',
    });
    assert.equal(generated.ficha.summary.cliente, `Cliente Na Geracao ${tag}`);
    assert.equal(
      (await repository.findById(created.id))?.ficha.summary.cliente,
      `Cliente Na Geracao ${tag}`,
    );
    await nameContact(`Cliente Depois ${tag}`, 'manual');
    assert.deepEqual(
      await shown(created.id),
      everywhere(`Cliente Na Geracao ${tag}`),
    );

    // PCT-03: reopened, it follows the contact again.
    const reopened = await service.reopen({
      actor,
      correlationId: `correlation-follow-reopen-${tag}`,
      expectedVersion: generated.version,
      orderId: created.id,
    });
    assert.equal(reopened.ficha.summary.cliente, `Cliente Depois ${tag}`);
    assert.deepEqual(
      await shown(created.id),
      everywhere(`Cliente Depois ${tag}`),
    );
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
        contactLookupKey: Buffer.alloc(32, 66),
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
    const withItems = await runtime.patchSection({
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
          estampa: 'Logo · frente',
          gola: 'GOLA V',
          grade: [{ quantidade: 3, tamanho: 'M' }],
          malhas: ['DRY FIT'],
          modelo: 'TRADICIONAL',
          tipo: 'CAMISA',
          tipo_servico: 'DTF',
          vies_gola: 'AZUL',
          vies_mangas: 'NAO APLICAVEL',
        },
      ],
    });
    let ready = await runtime.patchSection({
      ...patch,
      expectedVersion: withItems.version,
      idempotencyKey: `artwork-${runId}`,
      section: 'artwork',
      value: { feito_pela_silmer: false, feito_pelo_cliente: true },
    });
    ready = await priceDraft(runtime, ready, 15000, actor);
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
        readOrderContexts: orderContextsFrom(() => ({
          briefing,
          customerName: null,
        })),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const actor = { capabilities: [], id: `seller-${runId}`, kind: 'human' };
    await pool.query(
      `INSERT INTO crm.users (id, email, password_hash, name)
       VALUES ($1, $2, '$argon2id$synthetic', 'Vendedor Sete Pontos')`,
      [actor.id, `${actor.id}@example.test`],
    );
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = $2 WHERE id = $1',
      [conversationId, actor.id],
    );

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
      'items[0].tipo_servico',
      'items[0].malhas',
      'items[0].grade',
      'items[0].gola',
      'artwork',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
      'sizePricing',
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
    // ADR 020: who makes the art lands on the order; no place was said.
    assert.equal(order.ficha.items[0].estampa, '');
    assert.equal(order.ficha.artwork.feito_pelo_cliente, true);
    assert.deepEqual(order.ficha.items[0].malhas, ['algodão']);
    assert.equal(order.ficha.items[0].gola, '');
    assert.equal(order.ficha.summary.aplicacao, null);
    assert.equal(order.ficha.serviceData.artwork_technique, 'estampada');
    assert.equal(order.ficha.serviceData.collar, 'Definir com o vendedor');
    assert.equal(order.totalPieces, 30);
    assert.deepEqual(order.missingFields, [
      'items[0].tipo_servico',
      'items[0].gola',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
      'sizePricing',
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
        'items[0].tipo_servico',
        'items[0].gola',
        'items[1].cor',
        'items[1].tipo_servico',
        'items[1].grade',
        'items[1].gola',
        'summary.data_entrega_confirmada',
        'finalAmount',
        'paymentCondition',
        'sizePricing',
      ],
    });

    const complete = await service.patchSection({
      actor,
      correlationId: `correlation-complete-${runId}`,
      expectedVersion: partial.version,
      orderId: order.id,
      section: 'items',
      value: [
        { ...first, gola: 'gola redonda', tipo_servico: 'Silk' },
        {
          ...first,
          cor: 'branca',
          gola: 'regata',
          grade: [{ quantidade: 4, tamanho: 'GG' }],
          tipo: 'regata',
          tipo_servico: 'DTF',
        },
      ],
    });
    assert.deepEqual(complete.missingFields, [
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
      'sizePricing',
    ]);
    const priced = await priceDraft(service, complete, 98000, actor);
    await assert.rejects(confirm(priced, { amountText: '980,00' }), {
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
    const typed = await promise(priced, '24/10/2026');
    await assert.rejects(
      confirm(typed, { amountText: '980,00', paymentCondition: 'pix' }),
      {
        code: 'ORDER_NOT_CONFIRMABLE',
        fields: ['summary.data_entrega_confirmada'],
      },
    );
    const ready = await promise(typed, '2026-10-24');
    assert.deepEqual(ready.missingFields, ['paymentCondition']);
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
        readOrderContexts: async () => new Map(),
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
      'items[0].tipo_servico',
      'items[0].malhas',
      'items[0].grade',
      'items[0].gola',
      'artwork',
      'summary.data_entrega_confirmada',
      'finalAmount',
      'paymentCondition',
      'sizePricing',
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

  test('a transfer between the first owner check and the write rejects every human order mutation', async () => {
    const tag = randomUUID().replaceAll('-', '').slice(0, 10);
    const conversationId = await seedConversation(pool);
    const owner = { id: `seller-old-${tag}`, kind: 'human', capabilities: [] };
    const nextOwner = `seller-new-${tag}`;
    const admin = {
      id: `admin-${tag}`,
      kind: 'human',
      capabilities: ['COMMERCIAL_ADMIN'],
    };
    for (const [id, name] of [
      [owner.id, 'Vendedor Anterior'],
      [nextOwner, 'Vendedor Atual'],
      [admin.id, 'Admin Sintetico'],
    ]) {
      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash, name)
         VALUES ($1, $2, '$argon2id$synthetic', $3)`,
        [id, `${id}@example.test`, name],
      );
    }
    await pool.query(
      `INSERT INTO crm.user_functions (user_id, function_name) VALUES ($1, 'Vendedor')`,
      [admin.id],
    );
    await pool.query(
      `INSERT INTO crm.user_capabilities (user_id, capability)
       VALUES ($1, 'COMMERCIAL_ADMIN')`,
      [admin.id],
    );
    const transfer = (/** @type {string} */ userId) =>
      pool.query(
        `UPDATE crm.conversations
         SET assigned_user_id = $2, version = version + 1
         WHERE id = $1`,
        [conversationId, userId],
      );
    await transfer(owner.id);

    let created = await repository.createPending({
      conversationId,
      correlationId: `correlation-race-create-${tag}`,
      createdBy: null,
      createdByKind: 'automation',
      fabCode: '01',
      ficha: {
        artwork: {
          feito_pelo_cliente: true,
          feito_pela_silmer: false,
          files: [],
          sem_estampa: false,
        },
        items: /** @type {any} */ (syntheticItems()),
        observations: [],
        serviceData: {},
        summary: {
          aplicacao: null,
          cliente: 'Cliente Sintetico',
          data_entrega_confirmada: '2026-10-24',
          nome: 'Evento Sintetico',
        },
      },
      firstContactAt: NOW.toISOString(),
      id: randomUUID(),
      missingFields: ['finalAmount', 'paymentCondition'],
      now: NOW,
      totalPieces: 32,
    });
    created = await persistFixturePricing(repository, created, 15000, owner);
    const port = new PostgresOrderConversationPort({
      contactEnvelopeKey: CONTACT_KEY,
      contactLookupKey: Buffer.alloc(32, 66),
      database: databaseFor(pool),
      envelopeKey: ENVELOPE_KEY,
    });
    /** @type {{checked: {promise: Promise<void>, resolve: () => void}, resume: {promise: Promise<void>, resolve: () => void}}|null} */
    let barrier = null;
    const service = createOrderService({
      async authorizeOwnership({ actor, conversationId: id }) {
        const assignment = await port.readAssignment(id);
        if (
          assignment?.assignedUserId !== actor.id &&
          !(actor.capabilities ?? []).includes('COMMERCIAL_ADMIN')
        ) {
          throw Object.assign(new Error('not the owner'), {
            code: 'FORBIDDEN',
            statusCode: 403,
          });
        }
        if (barrier) {
          const pending = barrier;
          barrier = null;
          pending.checked.resolve();
          await pending.resume.promise;
        }
      },
      clock: () => NOW,
      conversations: {
        readOrderContexts: orderContextsFrom(() => ({
          briefing: null,
          customerName: 'Cliente Sintetico',
        })),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const eventCount = async () =>
      Number(
        (
          await pool.query(
            `SELECT count(*) AS total FROM crm.domain_events
             WHERE aggregate_type = 'order' AND aggregate_id = $1`,
            [created.id],
          )
        ).rows[0].total,
      );
    const deferred = () => {
      /** @type {() => void} */
      let resolve = () => {};
      /** @type {Promise<void>} */
      const promise = new Promise((done) => {
        resolve = () => done();
      });
      return { promise, resolve };
    };
    /** @param {() => Promise<unknown>} command */
    const loseOwnerBeforeWrite = async (command) => {
      const before = await repository.findById(created.id);
      const beforeEvents = await eventCount();
      barrier = { checked: deferred(), resume: deferred() };
      const pending = barrier;
      const result = command();
      await Promise.race([
        pending.checked.promise,
        result.then(
          () => {
            throw new Error('command ended before the ownership barrier');
          },
          (error) => {
            throw error;
          },
        ),
      ]);
      try {
        await transfer(nextOwner);
      } finally {
        pending.resume.resolve();
      }
      await assert.rejects(result, { code: 'FORBIDDEN', statusCode: 403 });
      assert.deepEqual(await repository.findById(created.id), before);
      assert.equal(await eventCount(), beforeEvents);
      await transfer(owner.id);
    };

    await loseOwnerBeforeWrite(() =>
      service.patchSection({
        actor: owner,
        correlationId: `correlation-race-section-${tag}`,
        expectedVersion: created.version,
        orderId: created.id,
        section: 'observations',
        value: [],
      }),
    );
    await loseOwnerBeforeWrite(() =>
      service.confirm({
        actor: owner,
        amountText: '150,00',
        correlationId: `correlation-race-confirm-${tag}`,
        expectedVersion: created.version,
        orderId: created.id,
        paymentCondition: 'pix',
      }),
    );
    const confirmed = await service.confirm({
      actor: owner,
      amountText: '150,00',
      correlationId: `correlation-race-ready-${tag}`,
      expectedVersion: created.version,
      orderId: created.id,
      paymentCondition: 'pix',
    });
    await loseOwnerBeforeWrite(() =>
      service.recordMilestones({
        actor: owner,
        correlationId: `correlation-race-milestones-${tag}`,
        deliveredOn: null,
        expectedVersion: confirmed.version,
        orderId: created.id,
        paidOn: '2026-09-12',
      }),
    );
    await loseOwnerBeforeWrite(() =>
      service.reopen({
        actor: owner,
        correlationId: `correlation-race-reopen-${tag}`,
        expectedVersion: confirmed.version,
        orderId: created.id,
      }),
    );

    // A stale capability claim cannot replace the locked database grant.
    await transfer(nextOwner);
    await assert.rejects(
      service.recordMilestones({
        actor: { ...owner, capabilities: ['COMMERCIAL_ADMIN'] },
        correlationId: `correlation-fake-admin-${tag}`,
        deliveredOn: null,
        expectedVersion: confirmed.version,
        orderId: created.id,
        paidOn: '2026-09-12',
      }),
      { code: 'FORBIDDEN', statusCode: 403 },
    );
    const grantedAdmin = await service.recordMilestones({
      actor: admin,
      correlationId: `correlation-real-admin-${tag}`,
      deliveredOn: null,
      expectedVersion: confirmed.version,
      orderId: created.id,
      paidOn: '2026-09-12',
    });
    assert.equal(grantedAdmin.paidOn, '2026-09-12');
  });

  // ADR 023: the file catalog takes the order locks, keeps the five-file
  // limit under concurrency and seals the original name. With
  // TEST_OBJECT_STORAGE_* set, the bytes go through a real RustFS/S3.
  test('order files keep five references under concurrency and seal their names', async () => {
    const canary = `PII-canary-${randomUUID()}`;
    const conversationId = await seedConversation(pool);
    await pool.query(
      `UPDATE crm.conversations SET assigned_user_id = 'seller-contract'
       WHERE id = $1`,
      [conversationId],
    );
    const owner = {
      capabilities: [],
      id: 'seller-contract',
      kind: 'human',
    };
    const orderService = createOrderService({
      authorizeOwnership: async () => {},
      clock: () => NOW,
      conversations: {
        readOrderContexts: orderContextsFrom(() => ({
          briefing: { order_name: 'Equipe Sintetica' },
          customerName: 'Cliente Sintetico',
        })),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const { order } = await orderService.ensurePendingFromIntent({
      conversationId,
      correlationId: 'correlation-files',
    });
    const storage = process.env.TEST_OBJECT_STORAGE_ENDPOINT
      ? new S3ObjectStorage({
          accessKeyId: String(process.env.TEST_OBJECT_STORAGE_ACCESS_KEY_ID),
          bucket: String(process.env.TEST_OBJECT_STORAGE_BUCKET),
          endpoint: process.env.TEST_OBJECT_STORAGE_ENDPOINT,
          region: process.env.TEST_OBJECT_STORAGE_REGION ?? 'us-east-1',
          secretAccessKey: String(
            process.env.TEST_OBJECT_STORAGE_SECRET_ACCESS_KEY,
          ),
        })
      : new InMemoryObjectStorage();
    const files = createOrderFileService({
      authorizeOwnership: async () => {},
      files: new PostgresOrderFileRepository({
        database: databaseFor(pool),
        envelopeKey: ENVELOPE_KEY,
      }),
      orders: repository,
      storage,
    });
    const pdf = (/** @type {number} */ index) =>
      Buffer.from(`%PDF-1.7\n% synthetic ${index}\n`);

    const attempts = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6, 7].map((index) =>
        files.upload({
          actor: owner,
          content: pdf(index),
          name: `${canary}-${index}.pdf`,
          orderId: order.id,
          slot: 'reference',
        }),
      ),
    );
    assert.equal(
      attempts.filter((attempt) => attempt.status === 'fulfilled').length,
      5,
    );
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        assert.equal(attempt.reason.code, 'FILE_LIMIT_REACHED');
      }
    }

    const first = await files.upload({
      actor: owner,
      content: pdf(8),
      name: 'arte-final.pdf',
      orderId: order.id,
      slot: 'final',
    });
    const second = await files.upload({
      actor: owner,
      content: pdf(9),
      name: 'arte-final-v2.pdf',
      orderId: order.id,
      slot: 'final',
    });
    assert.equal(second.files.final?.name, 'arte-final-v2.pdf');
    assert.equal(second.files.references.length, 5);
    assert.equal(
      await storage.getObject(/** @type {any} */ (first.file).objectKey),
      null,
      'the replaced final art is gone from storage',
    );
    const opened = await files.openContent(order.id, second.file.id);
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), pdf(9));

    const raw = await pool.query(
      `SELECT to_jsonb(order_files.*)::text AS row FROM crm.order_files
       WHERE order_id = $1`,
      [order.id],
    );
    assert.equal(raw.rows.length, 6);
    for (const row of raw.rows) {
      assert.doesNotMatch(row.row, new RegExp(canary, 'u'));
    }

    await assert.rejects(
      new PostgresOrderFileRepository({
        database: databaseFor(pool),
        envelopeKey: ENVELOPE_KEY,
      }).remove(order.id, second.file.id, {
        actor: { ...owner, id: 'seller-intruder' },
      }),
      { code: 'FORBIDDEN', statusCode: 403 },
    );
    const removed = await files.remove({
      actor: owner,
      fileId: second.file.id,
      orderId: order.id,
    });
    assert.equal(removed.files.final, null);
    assert.equal(await storage.getObject(second.file.objectKey), null);
  });

  test('manual delivery: PostgreSQL permits one concurrent confirmation and preserves payment', async () => {
    const conversationId = await seedConversation(pool, {
      channel: 'whatsapp',
    });
    const contactId = (
      await pool.query(
        `SELECT identity.current_contact_id
      FROM crm.conversations conversation JOIN crm.contact_identities identity
      ON identity.id = conversation.contact_identity_id WHERE conversation.id = $1`,
        [conversationId],
      )
    ).rows[0].current_contact_id;
    const actor = { id: 'seller-contract', kind: 'human', capabilities: [] };
    const now = new Date('2026-10-22T01:30:00.000Z');
    const service = createOrderService({
      authorizeOwnership: async () => undefined,
      authorizeManualOwnership: async ({ actor: principal, ownerId }) => {
        assert.equal(principal.id, ownerId);
      },
      clock: () => now,
      conversations: {
        readOrderContexts: async () => new Map(),
        readContactNames: async () =>
          new Map([[contactId, 'Cliente Sintético']]),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    let order = await service.createForContact({
      actor,
      contactId,
      correlationId: 'manual-delivery-create',
      idempotencyKey: randomUUID(),
    });
    assert.equal(order.firstContactAt, order.createdAt);
    for (const [section, value] of Object.entries({
      summary: {
        nome: 'Evento Sintético',
        data_entrega_confirmada: '2026-10-24',
      },
      items: syntheticItems(),
      artwork: { feito_pelo_cliente: true, feito_pela_silmer: false },
    })) {
      order = await service.patchSection({
        actor,
        correlationId: 'manual-delivery-edit',
        orderId: order.id,
        expectedVersion: order.version,
        section,
        value,
      });
    }
    order = await priceDraft(service, order, 10000, actor);
    order = await service.confirm({
      actor,
      correlationId: 'manual-delivery-confirm',
      orderId: order.id,
      expectedVersion: order.version,
      amountText: '100,00',
      paymentCondition: 'pix',
    });
    order = await service.recordMilestones({
      actor,
      correlationId: 'manual-delivery-paid',
      orderId: order.id,
      expectedVersion: order.version,
      paidOn: '2026-10-20',
    });
    assert.ok(
      (await service.deliveryTasks({ actor })).some(
        (item) => item.id === order.id,
      ),
    );
    const command = {
      actor,
      correlationId: 'manual-delivery-done',
      orderId: order.id,
      expectedVersion: order.version,
    };
    const results = await Promise.allSettled([
      service.confirmDelivery(command),
      service.confirmDelivery(command),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected?.reason.code, 'VERSION_CONFLICT');
    const delivered = await service.get(order.id);
    assert.equal(delivered.deliveredOn, '2026-10-21');
    assert.equal(delivered.paidOn, '2026-10-20');
    assert.equal(delivered.version, order.version + 1);
    assert.ok(
      !(await service.deliveryTasks({ actor })).some(
        (item) => item.id === order.id,
      ),
    );
    const events = await pool.query(
      `SELECT count(*)::integer AS count FROM crm.domain_events
      WHERE aggregate_id = $1 AND event_type = 'order.milestones_saved'`,
      [order.id],
    );
    assert.equal(events.rows[0].count, 2);
  });

  test('OLIST-T20b encrypted composition roundtrip, restart and concurrent version fencing', async () => {
    const conversationId = await seedConversation(pool);
    await pool.query(
      "UPDATE crm.conversations SET assigned_user_id = 'seller-contract' WHERE id=$1",
      [conversationId],
    );
    const serviceFor = (/** @type {PostgresOrderRepository} */ repository) =>
      createOrderService({
        repository,
        authorizeOwnership: async () => {},
        clock: () => NOW,
        fabCode: '01',
        conversations: {
          readOrderContexts: orderContextsFrom(() => ({
            briefing: null,
            customerName: 'Sintético',
          })),
          searchConversationIds: async () => [],
        },
      });
    const service = serviceFor(repository);
    let { order } = await service.ensurePendingFromIntent({
      conversationId,
      correlationId: 'correlation-pricing-pg',
    });
    const actor = { id: 'seller-contract', kind: 'human', capabilities: [] };
    order = await service.patchSection({
      actor,
      correlationId: 'correlation-pricing-pg',
      orderId: order.id,
      expectedVersion: order.version,
      section: 'items',
      value: syntheticItems().map((item) => ({
        ...item,
        grade: [{ tamanho: 'M', quantidade: 3 }],
      })),
    });
    const apply = (
      /** @type {any} */ service,
      /** @type {any} */ order,
      /** @type {unknown} */ value,
    ) =>
      service.patchSection({
        actor,
        correlationId: 'correlation-pricing-pg',
        orderId: order.id,
        expectedVersion: order.version,
        section: 'size-pricing',
        value,
      });
    const initialized = await apply(service, order, { action: 'initialize' });
    const group = initialized.ficha.sizePricing[0];
    const target = { groupId: group.id, lineId: group.lines[0].id };
    const restarted = serviceFor(
      new PostgresOrderRepository({
        database: databaseFor(pool),
        envelopeKey: ENVELOPE_KEY,
      }),
    );
    assert.deepEqual(
      (await restarted.get(order.id)).ficha.sizePricing,
      initialized.ficha.sizePricing,
    );
    const raw = (
      await pool.query(
        'SELECT ficha_envelope::text AS envelope FROM crm.orders WHERE id=$1',
        [order.id],
      )
    ).rows[0].envelope;
    assert.ok(!raw.includes(group.id));
    assert.ok(!raw.includes('subtotalCents'));
    const results = await Promise.allSettled(
      [service, restarted].map((service, i) =>
        apply(service, initialized, {
          action: 'review_subtotal',
          ...target,
          subtotalCents: 100 + i,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected');
    assert.equal(failed.reason.code, 'VERSION_CONFLICT');
    const reviewed = await restarted.get(order.id);
    const changed = await apply(restarted, reviewed, {
      action: 'change_quantity',
      ...target,
      quantity: 5,
    });
    assert.equal(changed.totalPieces, 8);
    assert.equal(changed.ficha.items[0].grade[0].quantidade, 5);
    assert.equal(changed.ficha.sizePricing[0].lines[0].subtotalReviewed, false);
    assert.equal(changed.finalAmountCents, null);
    const events = (
      await pool.query(
        "SELECT payload FROM crm.domain_events WHERE aggregate_id=$1 AND event_type='order.section_saved'",
        [order.id],
      )
    ).rows;
    assert.equal(events.length, 4);
    assert.ok(!JSON.stringify(events).includes('subtotal'));
    let edited = await apply(restarted, changed, {
      action: 'add_line',
      groupId: group.id,
      size: 'G',
      quantity: 2,
    });
    const gId = edited.ficha.sizePricing[0].lines[1].id;
    edited = await apply(restarted, edited, {
      action: 'reorder_lines',
      groupId: group.id,
      lineIds: [gId, target.lineId],
    });
    assert.deepEqual(
      edited.ficha.items[0].grade.map(
        (/** @type {any} */ line) => line.tamanho,
      ),
      ['G', 'M'],
    );
    edited = await apply(restarted, edited, {
      action: 'update_group',
      groupId: group.id,
      attributes: { cor: 'VERDE' },
    });
    edited = await apply(restarted, edited, {
      action: 'remove_line',
      groupId: group.id,
      lineId: gId,
    });
    const roundtrip = await service.get(order.id);
    assert.equal(roundtrip.ficha.items[0].cor, 'VERDE');
    assert.equal(roundtrip.ficha.sizePricing?.[0].lines[0].id, target.lineId);
    assert.deepEqual(roundtrip.ficha.sizePricing, edited.ficha.sizePricing);
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = NULL WHERE id=$1',
      [conversationId],
    );
    await assert.rejects(
      apply(service, edited, {
        action: 'review_subtotal',
        ...target,
        subtotalCents: 200,
      }),
      { code: 'FORBIDDEN' },
    );
    assert.equal((await restarted.get(order.id)).version, edited.version);
  });

  test('OLIST-T21 calculated totals and settlement/check invalidation share the encrypted PostgreSQL write', async () => {
    const conversationId = await seedConversation(pool);
    await pool.query(
      "UPDATE crm.conversations SET assigned_user_id='seller-contract' WHERE id=$1",
      [conversationId],
    );
    const actor = { id: 'seller-contract', kind: 'human', capabilities: [] };
    const service = createOrderService({
      repository,
      authorizeOwnership: async () => {},
      clock: () => NOW,
      fabCode: '01',
      conversations: {
        readOrderContexts: orderContextsFrom(() => ({
          briefing: null,
          customerName: 'Sintético',
        })),
        searchConversationIds: async () => [],
      },
    });
    let { order } = await service.ensurePendingFromIntent({
      conversationId,
      correlationId: 't21-sql',
    });
    const command = (/** @type {any} */ order) => ({
      actor,
      orderId: order.id,
      expectedVersion: order.version,
      correlationId: 't21-sql',
    });
    const apply = (/** @type {any} */ order, /** @type {unknown} */ value) =>
      service.patchSection({
        ...command(order),
        section: 'size-pricing',
        value,
      });
    for (const [section, value] of Object.entries({
      items: syntheticItems().map((item, i) => ({
        ...item,
        grade: [{ tamanho: 'M', quantidade: i === 0 ? 10 : 20 }],
      })),
      summary: { nome: null, data_entrega_confirmada: '2026-10-24' },
      artwork: { feito_pelo_cliente: true, feito_pela_silmer: false },
    }))
      order = await service.patchSection({ ...command(order), section, value });
    order = await apply(order, { action: 'initialize' });
    const groups = order.ficha.sizePricing;
    assert.ok(groups);
    const target = { groupId: groups[0].id, lineId: groups[0].lines[0].id };
    for (const [index, subtotalCents] of [18000, 32000].entries()) {
      order = await apply(order, {
        action: 'review_subtotal',
        groupId: groups[index].id,
        lineId: groups[index].lines[0].id,
        subtotalCents,
      });
    }
    const rawTotal = async () =>
      Number(
        (
          await pool.query(
            'SELECT final_amount_cents FROM crm.orders WHERE id=$1',
            [order.id],
          )
        ).rows[0].final_amount_cents,
      );
    assert.equal(order.finalAmountCents, 50000);
    assert.equal(await rawTotal(), 50000);
    order = await service.confirm({
      ...command(order),
      paymentCondition: 'pix',
    });
    order = await service.recordMilestones({
      ...command(order),
      paidOn: '2026-09-11',
      deliveredOn: null,
    });
    // Seed a historical completed check; the existing trigger must append its
    // invalidation rather than erase any event when commercial price changes.
    await pool.query(
      'INSERT INTO crm.order_finance(order_id, version, completed_at, completed_by) VALUES($1,1,$2,$3)',
      [order.id, NOW, actor.id],
    );
    await pool.query(
      "INSERT INTO crm.order_finance_events(id,order_id,version,order_version,action,actor_id,reason,occurred_at,correlation_id) VALUES($1,$2,1,$3,'completed',$4,'FINANCE_ROUTINE_COMPLETED',$5,'t21-sql')",
      [randomUUID(), order.id, order.version, actor.id, NOW],
    );
    order = await service.reopen(command(order));
    assert.equal(order.paidOn, '2026-09-11');
    order = await apply(order, {
      action: 'review_subtotal',
      ...target,
      subtotalCents: 17000,
    });
    assert.equal(order.finalAmountCents, 49000);
    assert.equal(await rawTotal(), 49000);
    assert.equal(order.paidOn, null);
    const finance = (
      await pool.query(
        'SELECT completed_at, completed_by, version FROM crm.order_finance WHERE order_id=$1',
        [order.id],
      )
    ).rows[0];
    assert.equal(finance.completed_at, null);
    assert.equal(finance.completed_by, null);
    assert.equal(Number(finance.version), 2);
    const history = (
      await pool.query(
        'SELECT action FROM crm.order_finance_events WHERE order_id=$1 ORDER BY version',
        [order.id],
      )
    ).rows.map((row) => row.action);
    assert.deepEqual(history, ['completed', 'invalidated']);
    order = await apply(order, {
      action: 'review_subtotal',
      ...target,
      subtotalCents: 18000,
    });
    assert.equal(order.finalAmountCents, 50000);
    assert.equal(order.paidOn, null);
    order = await service.recordMilestones({
      ...command(order),
      paidOn: '2026-09-11',
      deliveredOn: null,
    });
    order = await apply(order, {
      action: 'change_quantity',
      ...target,
      quantity: 15,
    });
    assert.equal(order.finalAmountCents, null);
    assert.equal(order.paidOn, null);
    const unpriced = (
      await pool.query(
        'SELECT final_amount_cents,paid_on FROM crm.orders WHERE id=$1',
        [order.id],
      )
    ).rows[0];
    assert.equal(unpriced.final_amount_cents, null);
    assert.equal(unpriced.paid_on, null);
    order = await apply(order, {
      action: 'change_quantity',
      ...target,
      quantity: 10,
    });
    await assert.rejects(
      service.confirm({ ...command(order), paymentCondition: 'pix' }),
      { code: 'ORDER_NOT_CONFIRMABLE' },
    );
    order = await apply(order, {
      action: 'review_subtotal',
      ...target,
      subtotalCents: 18000,
    });
    const results = await Promise.allSettled([
      service.confirm({ ...command(order), paymentCondition: 'pix' }),
      apply(order, {
        action: 'review_subtotal',
        ...target,
        subtotalCents: 16000,
      }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected');
    assert.equal(failed.reason.code, 'VERSION_CONFLICT');
    const persisted = await service.get(order.id);
    assert.equal(persisted.version, order.version + 1);
    assert.equal(await rawTotal(), persisted.finalAmountCents);
    assert.equal(
      persisted.finalAmountCents,
      persisted.status === 'confirmado' ? 50000 : 48000,
    );
  });

  // ------------------------------------------------------------------
  // OLC-T01 / ADR 080 (OLC-05a-j): the order's freight. Synthetic data.
  const FREIGHT_KEY = Buffer.alloc(32, 71);
  const FREIGHT_CONTEXT = 'synthetic-freight-context';
  const FREIGHT_PACKAGE = Object.freeze({
    fromPostalCode: '01001000',
    heightCm: 10,
    insuranceValueCents: 10000,
    lengthCm: 20,
    toPostalCode: '20040020',
    weightGrams: 800,
    widthCm: 15,
  });
  const PIECES_CENTS = 50000;

  /**
   * A conversation in human hands owned by a seller, next to another seller
   * and an admin who is not its responsible; a pending order priced by size
   * and its subject; the orders runtime with the estimate reader the API
   * wires; and the conversation shipping runtime with a synthetic provider.
   */
  async function freightHarness() {
    const tag = randomUUID().replaceAll('-', '').slice(0, 10);
    const database = databaseFor(pool);
    const seller = {
      capabilities: [],
      id: `freight-seller-${tag}`,
      kind: 'human',
    };
    const other = {
      capabilities: [],
      id: `freight-other-${tag}`,
      kind: 'human',
    };
    const admin = {
      capabilities: ['COMMERCIAL_ADMIN'],
      id: `freight-admin-${tag}`,
      kind: 'human',
    };
    for (const person of [seller, other, admin]) {
      await pool.query(
        `INSERT INTO crm.users (id, email, password_hash, name)
         VALUES ($1, $2, '$argon2id$synthetic', $3)`,
        [person.id, `${person.id}@example.test`, `Pessoa ${person.id}`],
      );
      await pool.query(
        `INSERT INTO crm.user_functions (user_id, function_name)
         VALUES ($1, 'Vendedor')`,
        [person.id],
      );
    }
    await pool.query(
      `INSERT INTO crm.user_capabilities (user_id, capability, granted_by)
       VALUES ($1, 'COMMERCIAL_ADMIN', $2)`,
      [admin.id, seller.id],
    );
    const conversationId = await seedConversation(pool);
    await pool.query(
      `UPDATE crm.conversations
       SET assigned_user_id = $2, automation_state = 'human' WHERE id = $1`,
      [conversationId, seller.id],
    );
    const conversationVersion = Number(
      (
        await pool.query(
          'SELECT version FROM crm.conversations WHERE id = $1',
          [conversationId],
        )
      ).rows[0].version,
    );
    const quotes = createShippingQuoteReader({
      configured: true,
      contextKey: FREIGHT_CONTEXT,
      key: FREIGHT_KEY,
    });
    const runtime = createOrderRuntime({
      access: {
        authorizeRead: async () => ({ actor: null }),
        authorizeWrite: async () => ({ actor: null }),
      },
      auditTrail: new PostgresAuditTrail(database),
      clock: () => NOW,
      conversations: new PostgresOrderConversationPort({
        contactEnvelopeKey: CONTACT_KEY,
        contactLookupKey: Buffer.alloc(32, 66),
        database,
        envelopeKey: ENVELOPE_KEY,
      }),
      fabCode: '01',
      freightNoticeDatabase: database,
      freightQuotes: quotes,
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 66),
      }),
      repository,
    });
    const provider = { priceCents: 2590 };
    const shipping = createConversationShippingRuntime(database, {
      calculate: async () => ({
        services: [
          {
            company: 'Correios',
            deliveryDays: 5,
            id: 1,
            name: 'PAC',
            priceCents: provider.priceCents,
          },
          {
            company: 'Correios',
            deliveryDays: 2,
            id: 2,
            name: 'SEDEX',
            priceCents: provider.priceCents + 2000,
          },
        ],
        unavailable: [],
      }),
      clock: () => NOW,
      contextKey: FREIGHT_CONTEXT,
      environment: 'sandbox',
      key: FREIGHT_KEY,
      requireConfigured: () => {},
    });
    let keys = 0;
    /** @param {any} actor @param {Record<string, unknown>} extra @returns {any} */
    const command = (actor, extra) => ({
      actor,
      correlationId: `correlation-freight-${tag}`,
      idempotencyKey: `freight-${tag}-${(keys += 1)}`,
      ...extra,
    });
    /** @param {any} [actor] @param {string} [conversation] */
    async function pricedOrder(actor = seller, conversation = conversationId) {
      let order = (
        await runtime.createManual(
          command(actor, {
            conversationId: conversation,
            expectedVersion: conversationVersion,
          }),
        )
      ).order;
      for (const [section, value] of Object.entries({
        summary: {
          aplicacao: null,
          data_entrega_confirmada: '2026-10-24',
          nome: null,
        },
        items: syntheticItems(),
        artwork: { feito_pela_silmer: false, feito_pelo_cliente: true },
      })) {
        order = await runtime.patchSection(
          command(actor, {
            expectedVersion: order.version,
            orderId: order.id,
            section,
            value,
          }),
        );
      }
      return priceDraft(runtime, order, PIECES_CENTS, actor);
    }
    /** @param {any} order */
    async function subjectFor(order) {
      const subjectId = `subject-${tag}-${order.id}`;
      await pool.query(
        `INSERT INTO crm.conversation_subjects
           (id, conversation_id, contact_id, order_id, kind, position,
            created_by, created_by_kind, created_at, updated_at)
         SELECT $1, conversation_id, contact_id, id, 'pedido',
                (SELECT count(*) + 1 FROM crm.conversation_subjects
                 WHERE conversation_id = orders.conversation_id),
                $2, 'human', $3, $3
         FROM crm.orders WHERE id = $4`,
        [subjectId, seller.id, NOW, order.id],
      );
      return subjectId;
    }
    /** Quotes the order as it is now and selects one service.
     * @param {any} order @param {string} subjectId @param {number} serviceId */
    async function selectedQuote(order, subjectId, serviceId) {
      const target = {
        orderId: order.id,
        orderVersion: order.version,
        subjectId,
      };
      const { quote } = await shipping.quote(
        command(seller, {
          body: { ...target, ...FREIGHT_PACKAGE },
          conversationId,
        }),
      );
      await shipping.select(
        command(seller, {
          body: { ...target, serviceId },
          conversationId,
          quoteId: quote.id,
        }),
      );
      return quote.id;
    }
    /** @param {string} orderId */
    const row = async (orderId) =>
      (await pool.query('SELECT * FROM crm.orders WHERE id = $1', [orderId]))
        .rows[0];
    /** @param {string} orderId */
    const freightEvents = async (orderId) =>
      (
        await pool.query(
          `SELECT kind, order_version, pieces_cents, freight_cents,
                  previous_freight_cents, total_cents, source, quote_id,
                  quote_service_id, quoted_cents, actor_id
           FROM crm.order_freight_events WHERE order_id = $1
           ORDER BY order_version, kind`,
          [orderId],
        )
      ).rows.map((event) =>
        Object.fromEntries(
          Object.entries(event).map(([key, value]) => [
            key,
            typeof value === 'string' && /^\d+$/u.test(value)
              ? Number(value)
              : value,
          ]),
        ),
      );
    return {
      admin,
      command,
      conversationId,
      freightEvents,
      other,
      pricedOrder,
      provider,
      row,
      runtime,
      selectedQuote,
      seller,
      shipping,
      subjectFor,
      tag,
    };
  }

  test('OLC-05h/i PostgreSQL: only the active responsible seller writes the freight, serialized, idempotent and audited without values', async () => {
    const h = await freightHarness();
    const order = await h.pricedOrder();
    const before = await h.row(order.id);
    assert.equal(before.freight_cents, '0');
    assert.equal(before.pricing_rule, 'pieces-v1');
    assert.equal(Number(before.final_amount_cents), PIECES_CENTS);

    /** @param {any} actor @param {any} current @param {unknown} freightCents */
    const inform = (actor, current, freightCents) =>
      h.runtime.setFreight(
        h.command(actor, {
          expectedVersion: current.version,
          freightCents,
          orderId: current.id,
        }),
      );
    /** The repository alone, as if the service check had been skipped.
     * @param {any} actor */
    const write = (actor) =>
      repository.saveFreight(
        { ...order, updatedAt: NOW.toISOString() },
        {
          actor,
          correlationId: `correlation-freight-${h.tag}`,
          expectedVersion: order.version,
          freight: { cents: 3750, source: 'seller' },
        },
      );

    // An admin who is not the responsible seller edits this order by the
    // current rule, and yet is denied its freight by API and repository.
    for (const actor of [h.admin, h.other]) {
      await assert.rejects(inform(actor, order, 3750), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      await assert.rejects(write(actor), {
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    }
    for (const actor of [
      { ...h.seller, kind: 'assistant' },
      { capabilities: [], id: 'AUTOMATION_EXECUTOR', kind: 'automation' },
      undefined,
    ]) {
      await assert.rejects(write(actor), { code: 'FORBIDDEN' });
    }
    // The responsible seller, disabled or no longer a Vendedor, is denied
    // inside the write even with a still valid session actor.
    await pool.query('UPDATE crm.users SET disabled_at = $2 WHERE id = $1', [
      h.seller.id,
      NOW,
    ]);
    await assert.rejects(write(h.seller), { code: 'FORBIDDEN' });
    await pool.query('UPDATE crm.users SET disabled_at = NULL WHERE id = $1', [
      h.seller.id,
    ]);
    await pool.query(
      "UPDATE crm.user_functions SET function_name = 'Financeiro' WHERE user_id = $1",
      [h.seller.id],
    );
    await assert.rejects(write(h.seller), { code: 'FORBIDDEN' });
    await pool.query(
      "UPDATE crm.user_functions SET function_name = 'Vendedor' WHERE user_id = $1",
      [h.seller.id],
    );
    // Invalid values and a stale version write nothing either.
    for (const [value, code] of /** @type {[unknown, string][]} */ ([
      [-1, 'FREIGHT_INVALID'],
      [0.5, 'FREIGHT_INVALID'],
      ['3750', 'FREIGHT_INVALID'],
      [null, 'FREIGHT_INVALID'],
      [Number.MAX_SAFE_INTEGER + 1, 'FREIGHT_OVERFLOW'],
      [Number.MAX_SAFE_INTEGER, 'FREIGHT_OVERFLOW'],
    ])) {
      await assert.rejects(inform(h.seller, order, value), {
        code,
        statusCode: 422,
      });
    }
    await assert.rejects(
      h.runtime.setFreight(
        h.command(h.seller, {
          expectedVersion: order.version + 1,
          freightCents: 3750,
          orderId: order.id,
        }),
      ),
      { code: 'VERSION_CONFLICT', statusCode: 409 },
    );
    assert.deepEqual(await h.row(order.id), before);
    assert.deepEqual(await h.freightEvents(order.id), []);

    // Two commands on independent connections: exactly one wins.
    const outcomes = await Promise.allSettled(
      [3750, 4100].map((freightCents) => inform(h.seller, order, freightCents)),
    );
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [
      'fulfilled',
      'rejected',
    ]);
    const lost = /** @type {PromiseRejectedResult} */ (
      outcomes.find((outcome) => outcome.status === 'rejected')
    );
    assert.equal(lost.reason.code, 'VERSION_CONFLICT');
    const won = /** @type {PromiseFulfilledResult<any>} */ (
      outcomes.find((outcome) => outcome.status === 'fulfilled')
    ).value;
    const freight = won.freight.cents;
    assert.ok([3750, 4100].includes(freight));
    assert.equal(won.version, order.version + 1);
    assert.equal(won.finalAmountCents, PIECES_CENTS + freight);
    assert.deepEqual(won.amounts, {
      freightCents: freight,
      piecesCents: PIECES_CENTS,
      totalCents: PIECES_CENTS + freight,
    });
    assert.equal(won.freight.source, 'seller');
    assert.equal(won.freight.pricingRule, 'pieces-freight-v1');
    assert.deepEqual(won.freight.setBy, {
      id: h.seller.id,
      name: `Pessoa ${h.seller.id}`,
    });
    const stored = await h.row(order.id);
    assert.equal(Number(stored.freight_cents), freight);
    assert.equal(Number(stored.final_amount_cents), PIECES_CENTS + freight);
    assert.equal(stored.freight_source, 'seller');
    assert.equal(stored.freight_set_by, h.seller.id);
    assert.equal(stored.pricing_rule, 'pieces-freight-v1');
    assert.equal(stored.version, before.version + 1);
    assert.equal(stored.commercial_revision, before.commercial_revision + 1);
    assert.deepEqual(await h.freightEvents(order.id), [
      {
        actor_id: h.seller.id,
        freight_cents: freight,
        kind: 'set',
        order_version: won.version,
        pieces_cents: PIECES_CENTS,
        previous_freight_cents: 0,
        quote_id: null,
        quote_service_id: null,
        quoted_cents: null,
        source: 'seller',
        total_cents: PIECES_CENTS + freight,
      },
    ]);

    // Replay with the same key answers the same and writes nothing more;
    // another body under that key is refused.
    const input = h.command(h.seller, {
      expectedVersion: won.version,
      freightCents: 5000,
      orderId: order.id,
    });
    const first = await h.runtime.setFreight(input);
    const [replayed, concurrent] = await Promise.all([
      h.runtime.setFreight({ ...input }),
      h.runtime.setFreight({ ...input }),
    ]);
    assert.deepEqual(replayed, first);
    assert.deepEqual(concurrent, first);
    await assert.rejects(
      h.runtime.setFreight({ ...input, freightCents: 5001 }),
      { code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 },
    );
    assert.equal((await h.row(order.id)).version, first.version);
    assert.equal((await h.freightEvents(order.id)).length, 2);

    // Events and audit carry identifiers, action and version: no value.
    const events = await pool.query(
      `SELECT event_type, payload FROM crm.domain_events
       WHERE aggregate_type = 'order' AND aggregate_id = $1
         AND event_type = 'order.freight_updated' ORDER BY stream_cursor`,
      [order.id],
    );
    assert.equal(events.rows.length, 2);
    for (const event of events.rows) {
      assert.deepEqual(event.payload, {
        conversationId: h.conversationId,
        orderId: order.id,
      });
    }
    const audits = await pool.query(
      `SELECT actor_id, action, target_type, target_id, version, reason
       FROM crm.audit_events WHERE target_id = $1 AND action = 'order.freight'
       ORDER BY version::integer`,
      [order.id],
    );
    assert.deepEqual(
      audits.rows.map((audit) => [audit.actor_id, audit.version, audit.reason]),
      [
        [h.seller.id, String(order.version), 'order.freight'],
        [h.seller.id, String(won.version), 'order.freight'],
      ],
    );
    const record = await pool.query(
      `SELECT response::text AS response FROM crm.idempotency_records
       WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    assert.equal(record.rows.length, 1);
    assert.doesNotMatch(record.rows[0].response, /5000|freight/u);

    // A quantity change asks for the subtotal again and keeps the freight.
    const [group] = first.ficha.sizePricing;
    const edited = await h.runtime.patchSection(
      h.command(h.seller, {
        expectedVersion: first.version,
        orderId: order.id,
        section: 'size-pricing',
        value: {
          action: 'change_quantity',
          groupId: group.id,
          lineId: group.lines[0].id,
          quantity: group.lines[0].quantity + 1,
        },
      }),
    );
    assert.equal(edited.finalAmountCents, null);
    assert.equal(edited.freight.cents, 5000);
    const unpriced = await h.row(order.id);
    assert.equal(unpriced.final_amount_cents, null);
    assert.equal(Number(unpriced.freight_cents), 5000);
    const repriced = await h.runtime.patchSection(
      h.command(h.seller, {
        expectedVersion: edited.version,
        orderId: order.id,
        section: 'size-pricing',
        value: {
          action: 'review_subtotal',
          groupId: group.id,
          lineId: group.lines[0].id,
          subtotalCents: group.lines[0].subtotalCents + 700,
        },
      }),
    );
    assert.equal(repriced.finalAmountCents, PIECES_CENTS + 700 + 5000);
    assert.equal(
      Number((await h.row(order.id)).final_amount_cents),
      PIECES_CENTS + 700 + 5000,
    );

    // The conversation moves to the admin: now the admin is the responsible
    // seller, and the previous one is denied.
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = $2 WHERE id = $1',
      [h.conversationId, h.admin.id],
    );
    await assert.rejects(inform(h.seller, repriced, 100), {
      code: 'FORBIDDEN',
    });
    const byAdmin = await inform(h.admin, repriced, 100);
    assert.equal(byAdmin.freight.cents, 100);
    assert.equal(byAdmin.freight.setBy?.id, h.admin.id);
    assert.equal((await h.row(order.id)).freight_set_by, h.admin.id);

    // A local cancellation is not a commercial recalculation: it passes the
    // guard of migration 0076, keeps the freight and ends the order.
    const cancelled = await h.runtime.cancel(
      h.command(h.admin, {
        expectedVersion: byAdmin.version,
        orderId: order.id,
        reason: 'Motivo sintetico',
      }),
    );
    assert.equal(cancelled.effectiveStatus, 'cancelado');
    assert.equal(cancelled.freight.cents, 100);
    assert.equal(Number((await h.row(order.id)).freight_cents), 100);
    await assert.rejects(inform(h.admin, cancelled, 0), {
      code: 'ORDER_CANCELLED',
      statusCode: 409,
    });
  });

  test('OLC-05h PostgreSQL: an estimate is applied by identity; stale, foreign and unselected ones are refused and later ones never change the freight', async () => {
    const h = await freightHarness();
    let order = await h.pricedOrder();
    const subjectId = await h.subjectFor(order);
    /** @param {any} current @param {string} quoteId @param {number} serviceId */
    const apply = (current, quoteId, serviceId) =>
      h.runtime.setFreight(
        h.command(h.seller, {
          expectedVersion: current.version,
          orderId: current.id,
          quote: { quoteId, serviceId },
        }),
      );
    const read = async () => (await h.runtime.get(order.id)).order;

    // A quoted and selected estimate changes nothing by itself.
    const quoteId = await h.selectedQuote(order, subjectId, 2);
    assert.equal((await h.row(order.id)).freight_cents, '0');
    assert.equal(Number((await h.row(order.id)).version), order.version);
    // The selected current estimate differs from "no freight": a warning.
    assert.equal((await read()).freight.quoteNotice, 'divergent');

    // The service that is not the selected one, and an unknown estimate.
    await assert.rejects(apply(order, quoteId, 1), {
      code: 'INVALID_SHIPPING_SERVICE',
      statusCode: 422,
    });
    await assert.rejects(apply(order, `quote-${randomUUID()}`, 2), {
      code: 'SHIPPING_QUOTE_NOT_FOUND',
      statusCode: 404,
    });
    // Another order's estimate answers like a missing one.
    const foreign = await freightHarness();
    const foreignOrder = await foreign.pricedOrder();
    const foreignQuote = await foreign.selectedQuote(
      foreignOrder,
      await foreign.subjectFor(foreignOrder),
      2,
    );
    await assert.rejects(apply(order, foreignQuote, 2), {
      code: 'SHIPPING_QUOTE_NOT_FOUND',
      statusCode: 404,
    });
    assert.equal((await h.row(order.id)).freight_cents, '0');
    assert.deepEqual(await h.freightEvents(order.id), []);

    // Applied: the server read the price (SEDEX 45,90) from the envelope.
    const applied = await apply(order, quoteId, 2);
    assert.equal(applied.freight.cents, 4590);
    assert.equal(applied.freight.source, 'quote');
    assert.equal(applied.freight.quoteId, quoteId);
    assert.equal(applied.freight.serviceId, 2);
    assert.equal(applied.freight.quotedCents, 4590);
    assert.equal(applied.freight.quoteNotice, null);
    assert.equal(applied.finalAmountCents, PIECES_CENTS + 4590);
    const stored = await h.row(order.id);
    assert.equal(stored.freight_source, 'quote');
    assert.equal(stored.freight_quote_id, quoteId);
    assert.equal(stored.freight_quote_service_id, 2);
    assert.equal(Number(stored.freight_quoted_cents), 4590);
    assert.equal(Number(stored.final_amount_cents), PIECES_CENTS + 4590);
    assert.deepEqual(await h.freightEvents(order.id), [
      {
        actor_id: h.seller.id,
        freight_cents: 4590,
        kind: 'set',
        order_version: applied.version,
        pieces_cents: PIECES_CENTS,
        previous_freight_cents: 0,
        quote_id: quoteId,
        quote_service_id: 2,
        quoted_cents: 4590,
        source: 'quote',
        total_cents: PIECES_CENTS + 4590,
      },
    ]);
    order = applied;

    // The order moved one version: that estimate is stale by ADR 054 and
    // cannot be applied again. The stored freight is untouched.
    await assert.rejects(apply(order, quoteId, 2), {
      code: 'SHIPPING_QUOTE_STALE',
      statusCode: 409,
    });

    // A new estimate with another price, quoted and selected afterwards,
    // never changes the stored freight: it only raises the warning.
    h.provider.priceCents = 3100;
    const newer = await h.selectedQuote(order, subjectId, 1);
    const after = await h.row(order.id);
    assert.equal(Number(after.freight_cents), 4590);
    assert.equal(after.freight_quote_id, quoteId);
    assert.equal(Number(after.final_amount_cents), PIECES_CENTS + 4590);
    assert.equal(Number(after.version), order.version);
    assert.equal((await read()).freight.quoteNotice, 'divergent');

    // The seller declares another value: P1 keeps the quoted one beside it.
    const declared = await h.runtime.setFreight(
      h.command(h.seller, {
        expectedVersion: order.version,
        freightCents: 2000,
        orderId: order.id,
      }),
    );
    assert.equal(declared.freight.source, 'seller');
    assert.equal(declared.freight.quoteId, null);
    assert.equal(declared.freight.quotedCents, null);
    assert.deepEqual((await h.freightEvents(order.id)).at(-1), {
      actor_id: h.seller.id,
      freight_cents: 2000,
      kind: 'set',
      order_version: declared.version,
      pieces_cents: PIECES_CENTS,
      previous_freight_cents: 4590,
      quote_id: newer,
      quote_service_id: 1,
      quoted_cents: 3100,
      source: 'seller',
      total_cents: PIECES_CENTS + 2000,
    });
    // That newer estimate is stale now as well.
    await assert.rejects(apply(declared, newer, 1), {
      code: 'SHIPPING_QUOTE_STALE',
    });
    order = declared;

    // Apply a current one, then change the grade: the origin estimate goes
    // stale, which is a warning and does not block the confirmation (P2).
    const third = await h.selectedQuote(order, subjectId, 1);
    order = await apply(order, third, 1);
    assert.equal(order.freight.cents, 3100);
    assert.equal(order.freight.quoteNotice, null);
    order = await h.runtime.patchSection(
      h.command(h.seller, {
        expectedVersion: order.version,
        orderId: order.id,
        section: 'observations',
        value: ['Conferir arte'],
      }),
    );
    assert.equal(order.freight.quoteNotice, 'stale');
    const confirmed = await h.runtime.confirm(
      h.command(h.seller, {
        expectedVersion: order.version,
        orderId: order.id,
        paymentCondition: 'pix',
      }),
    );
    assert.equal(confirmed.status, 'confirmado');
    assert.equal(confirmed.finalAmountCents, PIECES_CENTS + 3100);
    assert.equal(confirmed.freight.quoteNotice, null);
    assert.deepEqual((await h.freightEvents(order.id)).at(-1), {
      actor_id: h.seller.id,
      freight_cents: 3100,
      kind: 'confirmed',
      order_version: confirmed.version,
      pieces_cents: PIECES_CENTS,
      previous_freight_cents: null,
      quote_id: third,
      quote_service_id: 1,
      quoted_cents: 3100,
      source: 'quote',
      total_cents: PIECES_CENTS + 3100,
    });
    // The estimate itself was never rewritten by the order.
    const estimate = await pool.query(
      'SELECT selected_service_id, superseded_at FROM crm.shipping_quotes WHERE id = $1',
      [third],
    );
    assert.deepEqual(estimate.rows, [
      { selected_service_id: 1, superseded_at: null },
    ]);
  });

  test('OLC-05a/i/j PostgreSQL: the confirmation freezes total and freight; reopening and a new freight invalidate settlement; Dashboard and performance sum the single total', async () => {
    const h = await freightHarness();
    const today = '2026-09-12';
    const sold = async () =>
      repository.summary({
        dailyFrom: today,
        dailyTo: today,
        from: today,
        to: today,
      });
    const performance = async () =>
      (
        await readDashboardPerformance(databaseFor(pool), {
          actorId: h.seller.id,
          from: today,
          to: today,
        })
      ).rows.find((/** @type {any} */ entry) => entry.userId === h.seller.id);
    const baseline = await sold();
    assert.equal((await performance())?.soldAmountCents ?? 0, 0);

    let order = await h.pricedOrder();
    order = await h.runtime.setFreight(
      h.command(h.seller, {
        expectedVersion: order.version,
        freightCents: 3750,
        orderId: order.id,
      }),
    );
    /** @param {any} actor @param {any} current @param {Record<string, unknown>} [extra] */
    const confirm = (actor, current, extra = {}) =>
      h.runtime.confirm(
        h.command(actor, {
          expectedVersion: current.version,
          orderId: current.id,
          paymentCondition: 'pix',
          ...extra,
        }),
      );
    // The legacy declaration of the pieces alone is refused.
    await assert.rejects(confirm(h.seller, order, { amountText: '500,00' }), {
      code: 'SIZE_PRICING_AMOUNT_MISMATCH',
      statusCode: 422,
    });
    assert.equal((await h.row(order.id)).status, 'pendente');

    // An admin confirms by the current rule and the freight stays the
    // seller's, frozen with the total.
    const confirmed = await confirm(h.admin, order, { amountText: '537,50' });
    assert.equal(confirmed.status, 'confirmado');
    assert.equal(confirmed.finalAmountCents, PIECES_CENTS + 3750);
    assert.equal(confirmed.confirmedBy?.id, h.admin.id);
    assert.equal(confirmed.freight.cents, 3750);
    assert.equal(confirmed.freight.setBy?.id, h.seller.id);
    const frozen = await h.row(order.id);
    assert.equal(Number(frozen.final_amount_cents), PIECES_CENTS + 3750);
    assert.equal(Number(frozen.freight_cents), 3750);
    assert.equal(frozen.freight_set_by, h.seller.id);
    assert.equal(frozen.pricing_rule, 'pieces-freight-v1');
    assert.deepEqual((await h.freightEvents(order.id)).at(-1), {
      actor_id: h.admin.id,
      freight_cents: 3750,
      kind: 'confirmed',
      order_version: confirmed.version,
      pieces_cents: PIECES_CENTS,
      previous_freight_cents: null,
      quote_id: null,
      quote_service_id: null,
      quoted_cents: null,
      source: 'seller',
      total_cents: PIECES_CENTS + 3750,
    });

    // No command changes the freight of a confirmed order, for anyone.
    for (const actor of [h.seller, h.admin]) {
      await assert.rejects(
        h.runtime.setFreight(
          h.command(actor, {
            expectedVersion: confirmed.version,
            freightCents: 0,
            orderId: order.id,
          }),
        ),
        (/** @type {any} */ error) =>
          ['ORDER_STATUS_CONFLICT', 'FORBIDDEN'].includes(error.code),
      );
    }
    await assert.rejects(
      repository.saveFreight(
        /** @type {any} */ ({ ...confirmed, updatedAt: NOW.toISOString() }),
        {
          actor: h.seller,
          correlationId: `correlation-freight-${h.tag}`,
          expectedVersion: confirmed.version,
          freight: { cents: 0, source: 'seller' },
        },
      ),
      { code: 'ORDER_STATUS_CONFLICT', statusCode: 409 },
    );
    assert.equal(Number((await h.row(order.id)).freight_cents), 3750);

    // OLC-05j / P3: the Dashboard "vendido" and the seller's performance
    // count the single total, freight included, without splitting it.
    const afterSale = await sold();
    assert.equal(
      afterSale.period.soldAmountCents - baseline.period.soldAmountCents,
      PIECES_CENTS + 3750,
    );
    assert.equal(
      afterSale.soldAmountCents - baseline.soldAmountCents,
      PIECES_CENTS + 3750,
    );
    assert.equal(
      (afterSale.daily[0]?.soldAmountCents ?? 0) -
        (baseline.daily[0]?.soldAmountCents ?? 0),
      PIECES_CENTS + 3750,
    );
    assert.equal((await performance())?.soldAmountCents, PIECES_CENTS + 3750);

    // Settled and checked by Financeiro, then reopened: freight and total
    // stay as they were, like any reopened order.
    let current = await h.runtime.recordMilestones(
      h.command(h.seller, {
        deliveredOn: null,
        expectedVersion: confirmed.version,
        orderId: order.id,
        paidOn: '2026-09-11',
      }),
    );
    await pool.query(
      'INSERT INTO crm.order_finance(order_id, version, completed_at, completed_by) VALUES($1,1,$2,$3)',
      [order.id, NOW, h.seller.id],
    );
    await pool.query(
      "INSERT INTO crm.order_finance_events(id,order_id,version,order_version,action,actor_id,reason,occurred_at,correlation_id) VALUES($1,$2,1,$3,'completed',$4,'FINANCE_ROUTINE_COMPLETED',$5,'freight-live')",
      [randomUUID(), order.id, current.version, h.seller.id, NOW],
    );
    current = await h.runtime.reopen(
      h.command(h.seller, {
        expectedVersion: current.version,
        orderId: order.id,
      }),
    );
    assert.equal(current.status, 'pendente');
    assert.equal(current.freight.cents, 3750);
    assert.equal(current.finalAmountCents, PIECES_CENTS + 3750);
    assert.equal(current.paidOn, '2026-09-11');

    // A new freight changes the total: the earlier settlement does not
    // prove the new amount, exactly as a changed subtotal.
    current = await h.runtime.setFreight(
      h.command(h.seller, {
        expectedVersion: current.version,
        freightCents: 4200,
        orderId: order.id,
      }),
    );
    assert.equal(current.finalAmountCents, PIECES_CENTS + 4200);
    assert.equal(current.paidOn, null);
    const reviewed = await h.row(order.id);
    assert.equal(reviewed.paid_on, null);
    const finance = (
      await pool.query(
        'SELECT completed_at, completed_by, version FROM crm.order_finance WHERE order_id=$1',
        [order.id],
      )
    ).rows[0];
    assert.equal(finance.completed_at, null);
    assert.equal(finance.completed_by, null);
    assert.equal(Number(finance.version), 2);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT action, reason FROM crm.order_finance_events WHERE order_id=$1 ORDER BY version',
          [order.id],
        )
      ).rows,
      [
        { action: 'completed', reason: 'FINANCE_ROUTINE_COMPLETED' },
        { action: 'invalidated', reason: 'ORDER_AMOUNT_CHANGED' },
      ],
    );
    const again = await confirm(h.seller, current);
    assert.equal(again.finalAmountCents, PIECES_CENTS + 4200);
    assert.deepEqual(
      (await h.freightEvents(order.id)).map((event) => [
        event.kind,
        event.freight_cents,
        event.total_cents,
      ]),
      [
        ['set', 3750, PIECES_CENTS + 3750],
        ['confirmed', 3750, PIECES_CENTS + 3750],
        ['set', 4200, PIECES_CENTS + 4200],
        ['confirmed', 4200, PIECES_CENTS + 4200],
      ],
    );
    assert.equal((await performance())?.soldAmountCents, PIECES_CENTS + 4200);

    // Rollback guard on the real row: a writer that does not declare the
    // freight-aware rule cannot recalculate or reopen it; a paid day passes.
    await assert.rejects(
      pool.query(
        'UPDATE crm.orders SET final_amount_cents = $2 WHERE id = $1',
        [order.id, PIECES_CENTS],
      ),
      { code: '23514', constraint: 'order_freight_rule_required' },
    );
    await assert.rejects(
      pool.query("UPDATE crm.orders SET status = 'pendente' WHERE id = $1", [
        order.id,
      ]),
      { code: '23514', constraint: 'order_freight_rule_required' },
    );
    const revision = (await h.row(order.id)).commercial_revision;
    const paid = await h.runtime.recordMilestones(
      h.command(h.seller, {
        deliveredOn: null,
        expectedVersion: again.version,
        orderId: order.id,
        paidOn: '2026-09-12',
      }),
    );
    assert.equal(paid.paidOn, '2026-09-12');
    assert.equal(paid.finalAmountCents, PIECES_CENTS + 4200);
    // The paid day is not commercially exportable content.
    const milestone = await h.row(order.id);
    assert.equal(milestone.version, again.version + 1);
    assert.equal(milestone.commercial_revision, revision);

    // OLC-05d: a pending order without size pricing (legacy) takes no
    // freight and keeps the pieces-only rule.
    const legacyConversation = await seedConversation(pool);
    await pool.query(
      'UPDATE crm.conversations SET assigned_user_id = $2 WHERE id = $1',
      [legacyConversation, h.seller.id],
    );
    const legacyVersion = Number(
      (
        await pool.query(
          'SELECT version FROM crm.conversations WHERE id = $1',
          [legacyConversation],
        )
      ).rows[0].version,
    );
    const legacy = (
      await h.runtime.createManual(
        h.command(h.seller, {
          conversationId: legacyConversation,
          expectedVersion: legacyVersion,
        }),
      )
    ).order;
    await assert.rejects(
      h.runtime.setFreight(
        h.command(h.seller, {
          expectedVersion: legacy.version,
          freightCents: 100,
          orderId: legacy.id,
        }),
      ),
      { code: 'SIZE_PRICING_NOT_INITIALIZED', statusCode: 409 },
    );
    const legacyRow = await h.row(legacy.id);
    assert.equal(legacyRow.freight_cents, '0');
    assert.equal(legacyRow.pricing_rule, 'pieces-v1');
    assert.equal(legacyRow.freight_source, null);
    assert.deepEqual(legacy.amounts, {
      freightCents: 0,
      piecesCents: null,
      totalCents: null,
    });
  });

  test('PED-RD-09: the order payload resolves a merged contact on read, follows chains and unmerge', async () => {
    const runId = randomUUID().replaceAll('-', '');
    const database = databaseFor(pool);
    const { contacts } = channelServices(pool);
    const actor = { capabilities: [], id: 'seller-contract', kind: 'human' };
    const operator = { functionName: 'Vendedor', id: actor.id, kind: 'human' };
    /** @param {string} conversationId */
    const identityOf = async (conversationId) =>
      (
        await pool.query(
          `SELECT identity.id, identity.version, identity.current_contact_id
           FROM crm.conversations conversation
           JOIN crm.contact_identities identity
             ON identity.id = conversation.contact_identity_id
           WHERE conversation.id = $1`,
          [conversationId],
        )
      ).rows[0];
    const idX = await identityOf(await seedConversation(pool));
    const idY = await identityOf(await seedConversation(pool));
    const idZ = await identityOf(await seedConversation(pool));
    const [x, y, z] = [idX, idY, idZ].map((row) => row.current_contact_id);
    const service = createOrderService({
      authorizeOwnership: async () => undefined,
      authorizeManualOwnership: async () => undefined,
      clock: () => NOW,
      conversations: {
        readOrderContexts: async () => new Map(),
        readContactNames: async () => new Map([[x, 'Cliente Sintético']]),
        searchConversationIds: async () => [],
      },
      fabCode: '01',
      repository,
    });
    const created = await service.createForContact({
      actor,
      contactId: x,
      correlationId: `correlation-ped-rd-${runId}`,
      idempotencyKey: randomUUID(),
    });
    const runtime = createOrderRuntime({
      access: {
        authorizeRead: async () => ({ actor }),
        authorizeWrite: async () => ({ actor }),
      },
      auditTrail: new PostgresAuditTrail(database),
      conversations: new PostgresOrderConversationPort({
        contactEnvelopeKey: CONTACT_KEY,
        contactLookupKey: Buffer.alloc(32, 66),
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
    const shownIds = async () => ({
      detail: (await runtime.get(created.id)).order.contactId,
      listed: (await runtime.list({ limit: 100 })).items.find(
        (/** @type {any} */ item) => item.id === created.id,
      )?.contactId,
    });
    const stored = async () =>
      (
        await pool.query('SELECT contact_id FROM crm.orders WHERE id = $1', [
          created.id,
        ])
      ).rows[0].contact_id;
    /** @param {any} identity @param {string} target @param {string} key */
    const merge = async (identity, target, key) =>
      contacts.mergeIdentity({
        actor: operator,
        correlationId: `correlation-${key}-${runId}`,
        expectedVersion: Number(
          (await identityOf(await conversationOf(identity.id))).version,
        ),
        idempotencyKey: `${key}-${runId}`,
        identityId: identity.id,
        reason: 'Vínculo sintético confirmado por operador',
        targetContactId: target,
      });
    /** @param {string} identityId */
    const conversationOf = async (identityId) =>
      (
        await pool.query(
          'SELECT id FROM crm.conversations WHERE contact_identity_id = $1',
          [identityId],
        )
      ).rows[0].id;

    assert.deepEqual(await shownIds(), { detail: x, listed: x });

    const xToY = await merge(idX, y, 'merge-xy');
    assert.deepEqual(await shownIds(), { detail: y, listed: y });
    assert.equal(await stored(), x, 'the stored contact_id is never written');

    await merge(idY, z, 'merge-yz');
    assert.deepEqual(await shownIds(), { detail: z, listed: z });
    assert.equal(await stored(), x);

    const unmergedXY = await contacts.unmergeIdentity({
      actor: operator,
      correlationId: `correlation-unmerge-${runId}`,
      expectedVersion: Number(
        (await identityOf(await conversationOf(idX.id))).version,
      ),
      idempotencyKey: `unmerge-${runId}`,
      linkId: xToY.link.id,
      reason: 'Vínculo sintético revertido por operador',
    });
    assert.equal(unmergedXY.link.status, 'reverted');
    // X's link is gone; Y still resolves to Z, X resolves back to itself.
    assert.deepEqual(await shownIds(), { detail: x, listed: x });
    assert.equal(await stored(), x);

    // A cycle (Z back to Y on another identity) is cut, not looped.
    await pool.query(
      `INSERT INTO crm.identity_links
         (id, contact_identity_id, source_contact_id, target_contact_id,
          status, merged_by, merge_reason, merge_correlation_id,
          merge_idempotency_key, merge_fingerprint, merged_at)
       VALUES ($1, $2, $3, $4, 'active', 'seller-contract', 'ciclo sintético',
               $5, $6, $7, $8)`,
      [
        randomUUID(),
        idZ.id,
        z,
        y,
        `correlation-cycle-${runId}`,
        `cycle-${runId}`,
        'f'.repeat(64),
        NOW,
      ],
    );
    const port = new PostgresOrderConversationPort({
      contactEnvelopeKey: CONTACT_KEY,
      contactLookupKey: Buffer.alloc(32, 66),
      database,
      envelopeKey: ENVELOPE_KEY,
    });
    assert.deepEqual(
      Object.fromEntries(await port.readCurrentContactIds([y, z, x])),
      { [y]: z, [z]: y, [x]: x },
    );
  });
}
