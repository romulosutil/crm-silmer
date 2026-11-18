import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createApi } from '../../apps/api/src/app.js';
import { createSellerWhatsAppFirstSendRuntime } from '../../apps/api/src/seller-whatsapp-first-send-runtime.js';
import {
  contactPhoneHash,
  encryptContactDetails,
} from '../../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../../modules/database/src/index.js';
import {
  createN8nIntegrationService,
  decryptJson,
  encryptJson,
  PostgresN8nCommandOutbox,
  PostgresN8nCommandStore,
  PostgresN8nIntegrationRepository,
} from '../../modules/n8n-integration/src/index.js';
import { createSafeLogger } from '../../modules/shared/src/index.js';

// WAP-E10 / WAP-T04-03 (WAP-22/23/24/32) on a real synthetic PostgreSQL 17.
const now = new Date('2026-11-18T12:00:00.000Z');
const key = Buffer.alloc(32, 77);
const A = 'wap-e10-seller-a';
const B = 'wap-e10-seller-b';
const D = 'wap-e10-seller-d';
const S = 'wap-e10-seller-s';
const sellers = [A, B, D, S];
const allowlist = JSON.stringify(sellers);
const personalSendSellers = new Set(sellers);
const environment = {
  SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
  SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: allowlist,
  SELLER_WHATSAPP_SEND_ENABLED: 'true',
  SELLER_WHATSAPP_SEND_SELLER_IDS: allowlist,
  SELLER_CLIENTS_ENABLED: 'true',
  SELLER_CLIENTS_SELLER_IDS: allowlist,
  CONTACT_IDENTITY_ENVELOPE_KEY: key.toString('base64'),
  CONTACT_IDENTITY_LOOKUP_KEY: key.toString('base64'),
  INBOX_MESSAGE_ENVELOPE_KEY: key.toString('base64'),
  IDEMPOTENCY_ENVELOPE_KEY: key.toString('base64'),
};

/** @param {any} client @param {string} sellerId */
async function seedSeller(client, sellerId) {
  await client.query(
    `INSERT INTO crm.users(id,email,password_hash,name)
     VALUES ($1,$2,'$argon2id$synthetic','Pessoa sintética')`,
    [sellerId, `${sellerId}@example.test`],
  );
  await client.query(
    "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
    [sellerId],
  );
}

/** Same synthetic line fixture as the E08 suite. @param {any} client @param {string} sellerId @param {string} number */
async function seedLine(client, sellerId, number) {
  await seedSeller(client, sellerId);
  const source = {
    lineId: randomUUID(),
    accountId: randomUUID(),
    bindingId: randomUUID(),
    generation: 1,
  };
  const instance = `wap_${source.lineId.replaceAll('-', '')}`;
  const sealed = encryptJson({ number }, 'synthetic', key);
  const digest = contactPhoneHash(number, key);
  await client.query(
    `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,
     number_digest,number_envelope,confirmed_number_envelope,state,generation,version,verified_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$8,'connected',1,1,$7,$7,$7)`,
    [
      source.lineId,
      sellerId,
      source.accountId,
      instance,
      digest,
      sealed,
      now,
      encryptJson(
        { number },
        `seller-whatsapp-confirmed:${source.lineId}`,
        key,
      ),
    ],
  );
  await client.query(
    `INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at)
     VALUES($1,'personal',$2,$3)`,
    [digest, source.lineId, now],
  );
  await client.query(
    `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
     VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
    [
      source.bindingId,
      source.lineId,
      source.accountId,
      instance,
      createHash('sha256').update(sellerId).digest('hex'),
      sealed,
      now,
    ],
  );
  return { source, instance, sellerId };
}

/** @param {any} client @param {string|null} phone @param {string[]} linked */
async function seedContact(client, phone, linked) {
  const id = `contact-${randomUUID()}`;
  await client.query(
    `INSERT INTO crm.contacts(id,provisional,version,created_at,updated_at,display_name,
       display_name_source,manual_create_key,manually_created_by,contact_phone_hash,
       contact_details_envelope,wallet_created)
     VALUES($1,false,1,$2,$2,'Cliente sintético','manual',$3,$4,$5,$6::jsonb,true)`,
    [
      id,
      now,
      randomUUID(),
      linked[0],
      phone ? contactPhoneHash(phone, key) : null,
      phone
        ? JSON.stringify(encryptContactDetails({ email: null, phone }, key))
        : null,
    ],
  );
  for (const seller of linked)
    await client.query(
      `INSERT INTO crm.seller_client_links(id,seller_id,contact_id,provenance,source_id,status,
         version,created_by,updated_by,created_at,updated_at)
       VALUES(gen_random_uuid(),$1,$2,'manual_create',NULL,'active',1,$1,$1,$3,$3)`,
      [seller, id, now],
    );
  return id;
}

/** @param {string} id @param {string} [executionId] */
function technical(id, executionId = 'device-ingress') {
  return {
    actor: 'AUTOMATION_EXECUTOR',
    correlationId: `correlation-${id}`,
    credentialVersion: 'current',
    executionId,
    idempotencyKey: id,
    requestId: `request-${id}`,
    workflowKey:
      executionId === 'device-ingress'
        ? 'seller-whatsapp-inbound'
        : 'evolution-panel',
    workflowVersion: '1.0',
  };
}

test(
  'WAP-E10 PostgreSQL first send composes identity, conversation and outbox atomically',
  { timeout: 120_000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'Set TEST_DATABASE_URL for the synthetic E10 database',
    );
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/crm_silmer_test_wap_e10');
    const pool = new Pool({ connectionString: url.href, max: 12 });
    t.after(() => pool.end());
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    const a = await database.transaction((/** @type {any} */ c) =>
      seedLine(c, A, '5511000000110'),
    );
    const b = await database.transaction((/** @type {any} */ c) =>
      seedLine(c, B, '5511000000210'),
    );
    const d = await database.transaction((/** @type {any} */ c) =>
      seedLine(c, D, '5511000000410'),
    );
    await database.transaction((/** @type {any} */ c) => seedSeller(c, S));

    const outbox = new PostgresN8nCommandOutbox({
      envelopeKey: key,
      personalSendSellers,
    });
    const access = {
      authorizeRead: async () => ({ actor: { id: A, kind: 'human' } }),
      authorizeWrite: async () => ({ actor: { id: A, kind: 'human' } }),
    };
    /** @param {any} [overrides] */
    const runtimeWith = (overrides = {}) =>
      createSellerWhatsAppFirstSendRuntime(database, {
        access,
        outbox,
        environment,
        clock: () => now,
        ...overrides,
      });
    const firstSend = runtimeWith();
    const repository = new PostgresN8nIntegrationRepository({
      database,
      envelopeKey: key,
      personalInboundEnabled: true,
      personalInboundSellerIds: sellers,
      personalSendSellers,
    });
    const service = createN8nIntegrationService({
      repository,
      clock: () => now,
    });
    const store = new PostgresN8nCommandStore({
      database,
      envelopeKey: key,
      personalSendSellers,
    });

    /** @param {string} sql @param {unknown[]} [values] */
    const count = async (sql, values = []) =>
      (await pool.query(`SELECT count(*)::int AS n FROM ${sql}`, values))
        .rows[0].n;
    const effects = async () => ({
      identities: await count('crm.contact_identities'),
      conversations: await count('crm.conversations'),
      messages: await count('crm.messages'),
      commands: await count('crm.n8n_commands'),
      jobs: await count('crm.outbox_jobs'),
      receipts: await count('crm.idempotency_records'),
      contacts: await count('crm.contacts'),
      audits: await count(
        "crm.audit_events WHERE action='conversation.first_message_queued'",
      ),
    });
    /** @param {any} line @param {string} contactId @param {any} [extra] */
    async function request(line, contactId, extra = {}) {
      const contact = (
        await pool.query('SELECT version FROM crm.contacts WHERE id=$1', [
          contactId,
        ])
      ).rows[0];
      const link = (
        await pool.query(
          'SELECT version FROM crm.seller_client_links WHERE seller_id=$1 AND contact_id=$2',
          [line.sellerId, contactId],
        )
      ).rows[0];
      const current = (
        await pool.query(
          'SELECT version,generation FROM crm.seller_whatsapp_lines WHERE id=$1',
          [line.source.lineId],
        )
      ).rows[0];
      // The UI sends back exactly what the side-effect free preview showed.
      const { preview } = await firstSend.preview({
        actor: { id: line.sellerId },
        contactId,
      });
      return {
        actor: { id: line.sellerId, kind: 'human' },
        contactId,
        text: 'Primeira mensagem sintética',
        expectedContactVersion: Number(contact.version),
        expectedLinkVersion: Number(link.version),
        expectedLineVersion: Number(current.version),
        expectedGeneration: Number(current.generation),
        expectedConversation: preview.conversation,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        ...extra,
      };
    }
    /** @param {any} line @param {string} phone */
    const active = async (line, phone) =>
      (
        await pool.query(
          `SELECT * FROM crm.conversations WHERE provider_account_id=$1
           AND external_conversation_id=$2 AND terminal_at IS NULL`,
          [line.source.accountId, `+${phone}`],
        )
      ).rows;
    /** @param {any} line @param {string} id @param {string} phone */
    function inbound(line, id, phone) {
      return {
        schema_version: '1.0',
        channel: 'whatsapp',
        provider: 'evolution',
        source: line.source,
        metadata: { provider_account_id: line.source.accountId },
        contact: { wa_id: phone },
        event_id: id,
        message: { external_id: id, type: 'text', text: 'Resposta sintética' },
        occurred_at: now.toISOString(),
        technical: {
          ...technical(`${line.source.accountId}:${id}`),
          executionId: 'synthetic-inbound-execution',
          workflowKey: 'seller-whatsapp-inbound',
        },
      };
    }
    /** E08 dispatch chain for a queued first-send command. @param {string} commandId @param {any} line @param {string} phone */
    async function dispatch(commandId, line, phone) {
      const delivery = await store.loadForDelivery(commandId, { now });
      assert.ok(delivery);
      assert.equal(delivery.payload.to, `+${phone}`);
      assert.equal(
        delivery.payload.whatsapp_target.source.accountId,
        line.source.accountId,
      );
      assert.equal(delivery.payload.source_revision, 0);
      const executionId = randomUUID();
      assert.equal(
        await store.markProcessing(commandId, {
          now,
          attemptId: executionId,
          payloadHash: delivery.payloadHash,
        }),
        true,
      );
      const eventId = `reserve:${commandId}`;
      const reserve = {
        schema_version: '1.0',
        event_type: 'message.send.requested',
        event_id: eventId,
        occurred_at: now.toISOString(),
        source: line.source,
        command_id: commandId,
        conversation_id: delivery.payload.conversation_id,
        message: delivery.payload.message,
        source_revision: delivery.payload.source_revision,
        automation_epoch: delivery.payload.automation_epoch,
        technical: technical(eventId, executionId),
      };
      assert.equal((await service.recordEvent(reserve)).send_authorized, true);
      assert.deepEqual(
        await repository.readReservedSend({
          commandId,
          technical: reserve.technical,
          now,
          dispatch: true,
        }),
        { valid: true, instance: line.instance, to: `+${phone}` },
      );
      return { commandId, executionId, reserve };
    }
    /** @param {any} reservation @param {string} id */
    function sent(reservation, id) {
      const event = { ...reservation.reserve };
      delete event.message;
      const eventId = `sent:${reservation.commandId}`;
      return {
        ...event,
        event_type: 'message.sent',
        event_id: eventId,
        external_message_id: id,
        technical: technical(eventId, reservation.executionId),
      };
    }
    /** @param {any} line @param {string} id @param {string} phone */
    const echo = (line, id, phone) => ({
      schema_version: '1.0',
      event_type: 'message.external.sent',
      event_id: `${line.source.accountId}:${id}`,
      occurred_at: now.toISOString(),
      external_message_id: id,
      from_me: true,
      origin: 'device',
      source: line.source,
      instance: line.instance,
      to: `+${phone}`,
      message: { type: 'text', text: 'Primeira mensagem sintética' },
      technical: technical(`${line.source.accountId}:${id}`),
    });
    /** @param {string} messageId */
    const commandOf = async (messageId) =>
      (
        await pool.query('SELECT command_id FROM crm.messages WHERE id=$1', [
          messageId,
        ])
      ).rows[0].command_id;

    const P1 = '5511900000101';
    const c1 = await database.transaction((/** @type {any} */ c) =>
      seedContact(c, P1, [A]),
    );
    /** @type {any} */
    let first;

    await t.test(
      'preview is side-effect free and the happy path composes one effect',
      async () => {
        const before = await effects();
        const { preview } = await firstSend.preview({
          actor: { id: A },
          contactId: c1,
        });
        assert.deepEqual(await effects(), before);
        assert.equal(preview.available, true);
        assert.equal(preview.restriction, null);
        assert.equal(preview.recipient.maskedNumber, '••••0101');
        assert.equal(preview.line.maskedNumber, '••••0110');
        assert.equal(preview.conversation, null);
        const input = await request(a, c1);
        first = { input, result: await firstSend.send(input) };
        assert.equal(first.result.created, true);
        const body = first.result.body;
        assert.equal(body.conversation.reused, false);
        assert.equal(body.conversation.cycleNumber, 1);
        assert.equal(body.conversation.version, 2);
        assert.equal(body.message.status, 'queued');
        const after = await effects();
        assert.deepEqual(after, {
          ...before,
          identities: before.identities + 1,
          conversations: before.conversations + 1,
          messages: before.messages + 1,
          commands: before.commands + 1,
          jobs: before.jobs + 1,
          receipts: before.receipts + 1,
          audits: before.audits + 1,
        });
        const [conversation] = await active(a, P1);
        assert.equal(conversation.id, body.conversation.id);
        assert.equal(conversation.assigned_user_id, A);
        assert.equal(conversation.automation_state, 'human');
        assert.equal(conversation.state, 'em_atendimento');
        assert.equal(conversation.inbound_revision, '0');
        const identity = (
          await pool.query('SELECT * FROM crm.contact_identities WHERE id=$1', [
            conversation.contact_identity_id,
          ])
        ).rows[0];
        assert.equal(identity.current_contact_id, c1);
        assert.equal(identity.provider_account_id, a.source.accountId);
        assert.equal(
          await count('crm.contact_phone_lookup WHERE contact_id=$1', [c1]),
          0,
        );
        const message = (
          await pool.query('SELECT * FROM crm.messages WHERE id=$1', [
            body.message.id,
          ])
        ).rows[0];
        assert.equal(message.direction, 'outbound');
        assert.equal(message.author_kind, 'human');
        assert.equal(message.author_id, A);
        assert.match(message.command_id, /^first-send:[a-f0-9]{64}$/u);
        assert.equal(
          decryptJson(message.content_envelope, `message:${message.id}`, key)
            .text,
          'Primeira mensagem sintética',
        );
        const command = (
          await pool.query(
            'SELECT * FROM crm.n8n_commands WHERE message_id=$1',
            [message.id],
          )
        ).rows[0];
        assert.equal(command.command_id, message.command_id);
        assert.equal(command.status, 'pending');
        const payload = decryptJson(
          command.payload_envelope,
          `n8n-command:${command.command_id}`,
          key,
        );
        assert.equal(payload.to, `+${P1}`);
        assert.equal(payload.whatsapp_target.contactId, c1);
        assert.equal(payload.whatsapp_target.sellerId, A);
        for (const table of ['orders', 'ai_suggestions'])
          assert.equal(await count(`crm.${table}`), 0);
        assert.equal(await count("crm.messages WHERE direction='inbound'"), 0);
        const audit = (
          await pool.query(
            "SELECT * FROM crm.audit_events WHERE action='conversation.first_message_queued'",
          )
        ).rows[0];
        assert.equal(audit.target_id, conversation.id);
        assert.doesNotMatch(JSON.stringify(audit), /5511|sintética/u);
        assert.equal(
          await count(
            "crm.domain_events WHERE aggregate_id=$1 AND event_type='conversation.message_queued'",
            [conversation.id],
          ),
          1,
        );
      },
    );

    await t.test(
      'replay returns the same effect only to a current titular',
      async () => {
        const before = await effects();
        const replay = await firstSend.send(first.input);
        assert.equal(replay.created, false);
        assert.deepEqual(replay.body, first.result.body);
        assert.deepEqual(await effects(), before);
        await assert.rejects(
          firstSend.send({ ...first.input, text: 'Outra' }),
          {
            code: 'IDEMPOTENCY_KEY_REUSED',
          },
        );
        const other = createSellerWhatsAppFirstSendRuntime(database, {
          access,
          outbox,
          clock: () => now,
          environment: {
            ...environment,
            SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: JSON.stringify([B]),
          },
        });
        await assert.rejects(other.send(first.input), { code: 'FORBIDDEN' });
        assert.deepEqual(await effects(), before);

        const http = createApi(
          {},
          {
            logger: createSafeLogger({
              service: 'crm-silmer-api',
              sink: () => {},
            }),
            sellerWhatsAppFirstSend: firstSend,
          },
        );
        t.after(() => http.close());
        const payload = {
          text: first.input.text,
          expectedContactVersion: first.input.expectedContactVersion,
          expectedLinkVersion: first.input.expectedLinkVersion,
          expectedLineVersion: first.input.expectedLineVersion,
          expectedGeneration: first.input.expectedGeneration,
          expectedConversation: (
            await firstSend.preview({ actor: { id: A }, contactId: c1 })
          ).preview.conversation,
        };
        assert.equal(
          payload.expectedConversation.id,
          first.result.body.conversation.id,
        );
        const idempotencyKey = randomUUID();
        const path = `/api/v1/contacts/${c1}/whatsapp/conversations`;
        const headers = {
          'idempotency-key': idempotencyKey,
          origin: 'https://crm.test',
        };
        const created = await http.inject({
          method: 'POST',
          url: path,
          headers,
          payload,
        });
        assert.equal(created.statusCode, 201, created.body);
        assert.equal(created.json().conversation.reused, true);
        assert.equal(
          created.json().conversation.id,
          first.result.body.conversation.id,
        );
        const again = await http.inject({
          method: 'POST',
          url: path,
          headers,
          payload,
        });
        assert.equal(again.statusCode, 200, again.body);
        assert.deepEqual(again.json(), created.json());
        assert.equal((await active(a, P1)).length, 1);
      },
    );

    const P2 = '5511900000102';
    const c2 = await database.transaction((/** @type {any} */ c) =>
      seedContact(c, P2, [A]),
    );
    /** @type {any[]} */
    let tabs = [];
    await t.test(
      'two tabs from the same preview commit one message; a re-previewed tab reuses it',
      async () => {
        const [one, two] = await Promise.all([request(a, c2), request(a, c2)]);
        assert.equal(one.expectedConversation, null);
        assert.equal(two.expectedConversation, null);
        const before = await effects();
        const results = await Promise.allSettled([
          firstSend.send(one),
          firstSend.send(two),
        ]);
        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r) => r.status === 'rejected');
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.equal(
          /** @type {any} */ (lost[0]).reason.code,
          'CONVERSATION_VERSION_CONFLICT',
        );
        const created = /** @type {any} */ (won[0]).value;
        assert.equal(created.created, true);
        assert.equal(created.body.conversation.reused, false);
        assert.deepEqual(await effects(), {
          ...before,
          identities: before.identities + 1,
          conversations: before.conversations + 1,
          messages: before.messages + 1,
          commands: before.commands + 1,
          jobs: before.jobs + 1,
          receipts: before.receipts + 1,
          audits: before.audits + 1,
        });
        assert.equal((await active(a, P2)).length, 1);
        const loser = results[0].status === 'rejected' ? one : two;
        // The losing key was rolled back: replaying it still conflicts.
        await assert.rejects(firstSend.send(loser), {
          code: 'CONVERSATION_VERSION_CONFLICT',
        });
        // A stale previewed version also conflicts.
        await assert.rejects(
          firstSend.send({
            ...(await request(a, c2)),
            expectedConversation: {
              id: created.body.conversation.id,
              version: created.body.conversation.version - 1,
            },
          }),
          { code: 'CONVERSATION_VERSION_CONFLICT' },
        );
        const deliberate = await firstSend.send(await request(a, c2));
        assert.equal(deliberate.created, true);
        assert.equal(deliberate.body.conversation.reused, true);
        assert.equal(
          deliberate.body.conversation.id,
          created.body.conversation.id,
        );
        tabs = [created, deliberate];
        assert.equal(
          await count('crm.messages WHERE conversation_id=$1', [
            created.body.conversation.id,
          ]),
          2,
        );
        assert.equal(
          await count('crm.contact_identities WHERE current_contact_id=$1', [
            c2,
          ]),
          1,
        );
      },
    );

    const P3 = '5511900000103';
    const c3 = await database.transaction((/** @type {any} */ c) =>
      seedContact(c, P3, [A]),
    );
    /** @type {any} */
    let sameKey;
    await t.test(
      'the same key in flight twice commits one effect',
      async () => {
        const input = await request(a, c3);
        const results = await Promise.all([
          firstSend.send(input),
          firstSend.send(input),
        ]);
        assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
        assert.deepEqual(results[0].body, results[1].body);
        sameKey = { input, body: results[0].body };
        assert.equal(
          await count('crm.messages WHERE conversation_id=$1', [
            results[0].body.conversation.id,
          ]),
          1,
        );
        assert.equal(
          await count('crm.n8n_commands WHERE conversation_id=$1', [
            results[0].body.conversation.id,
          ]),
          1,
        );
      },
    );

    await t.test(
      'a failure after the message insert rolls everything back',
      async () => {
        const P4 = '5511900000104';
        const c4 = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, P4, [A]),
        );
        const before = await effects();
        const failing = runtimeWith({
          outbox: {
            async enqueueChannelMessage(
              /** @type {any} */ input,
              /** @type {any} */ context,
            ) {
              await outbox.enqueueChannelMessage(input, context);
              throw new Error('synthetic failure after outbox insert');
            },
          },
        });
        const input = await request(a, c4);
        await assert.rejects(failing.send(input), /synthetic failure/u);
        assert.deepEqual(await effects(), before);
        const refusing = runtimeWith({
          outbox: new PostgresN8nCommandOutbox({
            envelopeKey: key,
            personalSendSellers: new Set(),
          }),
        });
        await assert.rejects(refusing.send(input), {
          code: 'WHATSAPP_SEND_UNAVAILABLE',
        });
        assert.deepEqual(await effects(), before);
        assert.equal((await active(a, P4)).length, 0);
        // The rolled back key is free for a later valid attempt.
        assert.equal((await firstSend.send(input)).created, true);
      },
    );

    await t.test(
      'offline line, stale versions and invalid destination create nothing',
      async () => {
        const P5 = '5511900000105';
        const c5 = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, P5, [D]),
        );
        const legacy = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, null, [D]),
        );
        // The seller's own confirmed line number is never a destination.
        const own = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, '5511000000410', [D]),
        );
        const before = await effects();
        const valid = await request(d, c5);
        for (const [change, code] of /** @type {const} */ ([
          [{ expectedContactVersion: 2 }, 'CONTACT_VERSION_CONFLICT'],
          [{ expectedLinkVersion: 2 }, 'CONTACT_VERSION_CONFLICT'],
          [{ expectedLineVersion: 2 }, 'WHATSAPP_GENERATION_STALE'],
          [{ expectedGeneration: 2 }, 'WHATSAPP_GENERATION_STALE'],
          [
            { expectedConversation: { id: 'conversation-x', version: 1 } },
            'CONVERSATION_VERSION_CONFLICT',
          ],
        ]))
          await assert.rejects(
            firstSend.send({
              ...valid,
              ...change,
              idempotencyKey: randomUUID(),
            }),
            { code },
          );
        await assert.rejects(firstSend.send(await request(d, legacy)), {
          code: 'WHATSAPP_DESTINATION_INVALID',
        });
        const ownPreview = (
          await firstSend.preview({ actor: { id: D }, contactId: own })
        ).preview;
        assert.equal(ownPreview.restriction, 'destination_invalid');
        assert.equal(ownPreview.available, false);
        assert.equal(ownPreview.conversation, null);
        await assert.rejects(firstSend.send(await request(d, own)), {
          code: 'WHATSAPP_DESTINATION_INVALID',
        });
        assert.equal(
          (await firstSend.preview({ actor: { id: D }, contactId: legacy }))
            .preview.restriction,
          'destination_invalid',
        );
        await pool.query(
          "UPDATE crm.seller_whatsapp_lines SET state='disconnected',verified_at=NULL,version=version+1 WHERE id=$1",
          [d.source.lineId],
        );
        await assert.rejects(firstSend.send(valid), {
          code: 'WHATSAPP_SEND_UNAVAILABLE',
        });
        assert.equal(
          (await firstSend.preview({ actor: { id: D }, contactId: c5 })).preview
            .restriction,
          'line_unavailable',
        );
        await pool.query(
          "UPDATE crm.seller_whatsapp_lines SET state='connected',verified_at=$2,version=version+1 WHERE id=$1",
          [d.source.lineId, now],
        );
        await pool.query(
          'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE id=$1',
          [d.source.bindingId, now],
        );
        await assert.rejects(firstSend.send(valid), {
          code: 'WHATSAPP_SEND_UNAVAILABLE',
        });
        await pool.query(
          "UPDATE crm.seller_client_links SET status='revoked',version=version+1,revoked_at=$3 WHERE seller_id=$1 AND contact_id=$2",
          [D, c5, now],
        );
        await assert.rejects(firstSend.send(valid), { code: 'NOT_FOUND' });
        await assert.rejects(
          firstSend.preview({ actor: { id: D }, contactId: c5 }),
          { code: 'NOT_FOUND' },
        );
        assert.deepEqual(await effects(), before);
      },
    );

    await t.test(
      'an identity of another Contact is never reassociated',
      async () => {
        const P6 = '5511900000106';
        // A real inbound on line A anchors the number to another Contact.
        await service.receiveInbound(inbound(a, 'foreign-identity', P6));
        const identity = (
          await pool.query(
            `SELECT i.* FROM crm.contact_identities i JOIN crm.conversations c
           ON c.contact_identity_id=i.id WHERE c.provider_account_id=$1
           AND c.external_conversation_id=$2`,
            [a.source.accountId, `+${P6}`],
          )
        ).rows[0];
        assert.ok(identity);
        const c6 = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, P6, [A]),
        );
        const before = await effects();
        const { preview } = await firstSend.preview({
          actor: { id: A },
          contactId: c6,
        });
        assert.equal(preview.restriction, 'identity_conflict');
        assert.equal(preview.conversation, null);
        assert.doesNotMatch(
          JSON.stringify(preview),
          new RegExp(`${identity.current_contact_id}|${identity.id}`, 'u'),
        );
        await assert.rejects(firstSend.send(await request(a, c6)), {
          code: 'WHATSAPP_IDENTITY_CONFLICT',
        });
        const unchanged = (
          await pool.query('SELECT * FROM crm.contact_identities WHERE id=$1', [
            identity.id,
          ])
        ).rows[0];
        assert.deepEqual(unchanged, identity);
        assert.deepEqual(await effects(), before);
      },
    );

    await t.test(
      'a closed conversation opens a new cycle and keeps its history',
      async () => {
        const [closed] = await active(a, P1);
        await pool.query(
          "UPDATE crm.conversations SET state='sem_lead',terminal_at=$2 WHERE id=$1",
          [closed.id, now],
        );
        const snapshot = (
          await pool.query('SELECT * FROM crm.conversations WHERE id=$1', [
            closed.id,
          ])
        ).rows[0];
        const history = await count('crm.messages WHERE conversation_id=$1', [
          closed.id,
        ]);
        const result = await firstSend.send(await request(a, c1));
        assert.equal(result.body.conversation.reused, false);
        assert.equal(result.body.conversation.cycleNumber, 2);
        const opened = (
          await pool.query('SELECT * FROM crm.conversations WHERE id=$1', [
            result.body.conversation.id,
          ])
        ).rows[0];
        assert.equal(opened.previous_conversation_id, closed.id);
        assert.equal(opened.contact_identity_id, closed.contact_identity_id);
        assert.deepEqual(
          (
            await pool.query('SELECT * FROM crm.conversations WHERE id=$1', [
              closed.id,
            ])
          ).rows[0],
          snapshot,
        );
        assert.equal(
          await count('crm.messages WHERE conversation_id=$1', [closed.id]),
          history,
        );
      },
    );

    await t.test(
      'the reply on the same line lands in the same Contact and conversation',
      async () => {
        const [current] = await active(a, P1);
        const contacts = await count('crm.contacts');
        await service.receiveInbound(inbound(a, 'reply-after-first-send', P1));
        const [after] = await active(a, P1);
        assert.equal(after.id, current.id);
        assert.equal(after.inbound_revision, '1');
        assert.equal(await count('crm.contacts'), contacts);
        const reply = (
          await pool.query(
            "SELECT * FROM crm.messages WHERE external_message_id='reply-after-first-send'",
          )
        ).rows[0];
        assert.equal(reply.conversation_id, current.id);
        assert.equal(reply.direction, 'inbound');
        assert.equal(
          (
            await pool.query(
              'SELECT current_contact_id FROM crm.contact_identities WHERE id=$1',
              [after.contact_identity_id],
            )
          ).rows[0].current_contact_id,
          c1,
        );
        // A further first message reuses the now replied conversation.
        const reuse = await firstSend.send(await request(a, c1));
        assert.equal(reuse.body.conversation.id, current.id);
        assert.equal(reuse.body.conversation.reused, true);
      },
    );

    await t.test(
      'other sellers never reuse or see the titular conversation',
      async () => {
        // B has its own line and an inbound conversation for the same number.
        await service.receiveInbound(inbound(b, 'b-same-number', P1));
        const [foreign] = await active(b, P1);
        assert.ok(foreign);
        const shared = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, '5511900000107', [A, B, S]),
        );
        const result = await firstSend.send(await request(a, shared));
        const sharedPreviewB = (
          await firstSend.preview({ actor: { id: B }, contactId: shared })
        ).preview;
        assert.equal(sharedPreviewB.conversation, null);
        assert.equal(sharedPreviewB.available, true);
        assert.notEqual(sharedPreviewB.line.id, a.source.lineId);
        const sharedPreviewS = (
          await firstSend.preview({ actor: { id: S }, contactId: shared })
        ).preview;
        assert.equal(sharedPreviewS.line, null);
        assert.equal(sharedPreviewS.conversation, null);
        assert.equal(sharedPreviewS.restriction, 'line_not_configured');
        await assert.rejects(
          firstSend.send({
            ...(await request(a, shared)),
            actor: { id: S, kind: 'human' },
          }),
          { code: 'FORBIDDEN' },
        );
        // A's conversation on the shared Contact is untouched by B or S.
        assert.equal(
          await count('crm.messages WHERE conversation_id=$1', [
            result.body.conversation.id,
          ]),
          1,
        );
        const before = await effects();
        const fromA = await firstSend.send(await request(a, c1));
        assert.notEqual(fromA.body.conversation.id, foreign.id);
        assert.equal(
          (
            await pool.query(
              'SELECT version FROM crm.conversations WHERE id=$1',
              [foreign.id],
            )
          ).rows[0].version,
          foreign.version,
        );
        assert.equal((await effects()).conversations, before.conversations);
        // A Contact linked only to B is invisible to A.
        const onlyB = await database.transaction((/** @type {any} */ c) =>
          seedContact(c, '5511900000108', [B]),
        );
        await assert.rejects(
          firstSend.preview({ actor: { id: A }, contactId: onlyB }),
          { code: 'NOT_FOUND' },
        );
        await assert.rejects(
          firstSend.send({
            ...(await request(b, onlyB)),
            actor: { id: A, kind: 'human' },
          }),
          { code: 'NOT_FOUND' },
        );
      },
    );

    await t.test(
      'echo before and after the HTTP result keeps one message',
      async () => {
        const [echoFirst, httpFirst] = await Promise.all(
          tabs.map(async (tab) => ({
            messageId: tab.body.message.id,
            commandId: await commandOf(tab.body.message.id),
          })),
        );
        const one = await dispatch(echoFirst.commandId, a, P2);
        await service.recordEvent(echo(a, 'first-echo-first', P2));
        await service.recordEvent(sent(one, 'first-echo-first'));
        assert.equal(
          await store.markDelivered(one.commandId, {
            attemptId: one.executionId,
            now,
          }),
          true,
        );
        const two = await dispatch(httpFirst.commandId, a, P2);
        await service.recordEvent(sent(two, 'first-http-first'));
        await Promise.all([
          service.recordEvent(echo(a, 'first-http-first', P2)),
          service.recordEvent(echo(a, 'first-http-first', P2)),
        ]);
        for (const [id, messageId] of [
          ['first-echo-first', echoFirst.messageId],
          ['first-http-first', httpFirst.messageId],
        ]) {
          const rows = (
            await pool.query(
              'SELECT * FROM crm.messages WHERE provider_account_id=$1 AND external_message_id=$2',
              [a.source.accountId, id],
            )
          ).rows;
          assert.equal(rows.length, 1);
          assert.equal(rows[0].id, messageId);
          assert.equal(rows[0].author_kind, 'human');
          assert.equal(rows[0].author_id, A);
        }
        const [conversation] = await active(a, P2);
        assert.equal(conversation.inbound_revision, '0');
        assert.equal(
          await count('crm.messages WHERE conversation_id=$1', [
            conversation.id,
          ]),
          2,
        );
      },
    );

    await t.test(
      'a dispatch timeout stays outcome_unknown without a new command',
      async () => {
        const commandId = await commandOf(sameKey.body.message.id);
        const reservation = await dispatch(commandId, a, P3);
        assert.equal(
          await store.markOutcomeUnknown(commandId, {
            attemptId: reservation.executionId,
            now,
            errorCode: 'TIMEOUT',
          }),
          true,
        );
        const message = (
          await pool.query(
            'SELECT status,delivery_status FROM crm.messages WHERE id=$1',
            [sameKey.body.message.id],
          )
        ).rows[0];
        assert.deepEqual(message, {
          status: 'outcome_unknown',
          delivery_status: 'outcome_unknown',
        });
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM crm.n8n_commands WHERE command_id=$1',
              [commandId],
            )
          ).rows[0].status,
          'outcome_unknown',
        );
        assert.equal(
          await count(
            "crm.reconciliation_items r JOIN crm.outbox_jobs j ON j.id=r.job_id WHERE j.n8n_command_id=$1 AND r.status='open'",
            [commandId],
          ),
          1,
        );
        assert.equal(await store.loadForDelivery(commandId, { now }), null);
        const commands = await count('crm.n8n_commands');
        const replay = await firstSend.send(sameKey.input);
        assert.equal(replay.created, false);
        assert.deepEqual(replay.body, sameKey.body);
        assert.equal(await count('crm.n8n_commands'), commands);
      },
    );

    await t.test(
      'first send racing an inbound reply does not deadlock',
      async () => {
        for (const [index, phone] of [
          '5511900000121',
          '5511900000122',
          '5511900000123',
          '5511900000124',
        ].entries()) {
          const contact = await database.transaction((/** @type {any} */ c) =>
            seedContact(c, phone, [A]),
          );
          const input = await request(a, contact);
          const [send, reply] = await Promise.allSettled(
            index % 2
              ? [
                  firstSend.send(input),
                  service.receiveInbound(inbound(a, `race-${index}`, phone)),
                ]
              : [
                  (async () => {
                    await Promise.resolve();
                    return firstSend.send(input);
                  })(),
                  service.receiveInbound(inbound(a, `race-${index}`, phone)),
                ],
          );
          assert.equal(
            reply.status,
            'fulfilled',
            String(/** @type {any} */ (reply).reason),
          );
          const conversations = await active(a, phone);
          assert.equal(conversations.length, 1);
          if (send.status === 'fulfilled') {
            assert.equal(send.value.body.conversation.id, conversations[0].id);
            const owner = (
              await pool.query(
                'SELECT current_contact_id FROM crm.contact_identities WHERE id=$1',
                [conversations[0].contact_identity_id],
              )
            ).rows[0].current_contact_id;
            assert.equal(owner, contact);
          } else {
            // Inbound won and anchored the number to its own new Contact.
            assert.equal(send.reason.code, 'WHATSAPP_IDENTITY_CONFLICT');
          }
        }
      },
    );

    await t.test(
      'a revoked link or disabled titular blocks the replay',
      async () => {
        await pool.query(
          "UPDATE crm.seller_client_links SET status='revoked',version=version+1,revoked_at=$3 WHERE seller_id=$1 AND contact_id=$2",
          [A, c3, now],
        );
        await assert.rejects(firstSend.send(sameKey.input), {
          code: 'NOT_FOUND',
        });
        // Disabling the titular also blocks the line (0077 trigger): keep last.
        await pool.query('UPDATE crm.users SET disabled_at=$2 WHERE id=$1', [
          A,
          now,
        ]);
        await assert.rejects(firstSend.send(first.input), {
          code: 'FORBIDDEN',
        });
        await assert.rejects(
          firstSend.preview({ actor: { id: A }, contactId: c1 }),
          { code: 'FORBIDDEN' },
        );
      },
    );
  },
);
