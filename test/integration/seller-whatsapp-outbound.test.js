import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { createChatMediaApiRuntime } from '../../apps/api/src/chat-media-runtime.js';
import { createOrderBillingChatRuntime } from '../../apps/api/src/order-billing-chat-runtime.js';
import { createOrderBillingRuntime } from '../../apps/api/src/order-billing-runtime.js';
import { createInboundMediaRuntime } from '../../apps/api/src/inbound-media-runtime.js';
import { createN8nApiRuntime } from '../../apps/api/src/n8n-runtime.js';
import { registerOrderRoutes } from '../../apps/api/src/order-routes.js';
import {
  ChatMediaValidator,
  PostgresChatMediaDraftCleanup,
  PostgresChatMediaUploadRepository,
  PostgresTransientMediaRepository,
  PrivateMediaVolume,
} from '../../modules/integration-reliability/src/index.js';
import {
  KEY as orderKey,
  seed as seedOrder,
} from '../support/order-billing-chat-fixture.js';
import { PostgresAuditTrail } from '../../modules/audit-privacy/src/index.js';
import { contactPhoneHash } from '../../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../../modules/database/src/index.js';
import {
  createInboxService,
  PostgresInboxRepository,
  PostgresInboxReadRepository,
} from '../../modules/inbox-channels/src/index.js';
import {
  createN8nIntegrationService,
  decryptJson,
  encryptJson,
  PostgresN8nCommandOutbox,
  PostgresN8nCommandStore,
  PostgresN8nIntegrationRepository,
} from '../../modules/n8n-integration/src/index.js';

const now = new Date('2026-11-17T21:10:00.000Z');
const key = Buffer.alloc(32, 88);
const sellerA = 'wap-e08-seller-a';
const sellerB = 'wap-e08-seller-b';
const personalSendSellers = new Set([sellerA, sellerB]);
const recipient = '+5511000000088';

/** @param {any} client @param {string} sellerId @param {string} number */
async function seedLine(client, sellerId, number) {
  const source = {
    lineId: randomUUID(),
    accountId: randomUUID(),
    bindingId: randomUUID(),
    generation: 1,
  };
  const instance = `wap_${source.lineId.replaceAll('-', '')}`;
  const sealed = encryptJson({ number }, 'synthetic', key);
  const confirmed = encryptJson(
    { number },
    `seller-whatsapp-confirmed:${source.lineId}`,
    key,
  );
  await client.query(
    `INSERT INTO crm.users(id,email,password_hash,name)
    VALUES ($1,$2,'$argon2id$synthetic','Pessoa sintética')`,
    [sellerId, `${sellerId}@example.test`],
  );
  await client.query(
    "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
    [sellerId],
  );
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
      confirmed,
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

/** @param {any} line @param {string} id @param {any} [overrides] */
function external(line, id, overrides = {}) {
  return {
    schema_version: '1.0',
    event_type: 'message.external.sent',
    event_id: `${line.source.accountId}:${id}`,
    occurred_at: now.toISOString(),
    external_message_id: id,
    from_me: true,
    origin: 'device',
    source: line.source,
    instance: line.instance,
    to: recipient,
    message: { type: 'text', text: 'Envio sintético' },
    technical: technical(`${line.source.accountId}:${id}`),
    ...overrides,
  };
}

test(
  'WAP-E08 PostgreSQL fences dispatch and reconciles concurrent device/HTTP proofs',
  { timeout: 60_000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'Set TEST_DATABASE_URL for the synthetic E08 database',
    );
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/crm_silmer_test_wap_e08');
    const pool = new Pool({ connectionString: url.href });
    t.after(() => pool.end());
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    await migrate(pool, { migrations: await loadMigrations() });
    const a = await database.transaction((/** @type {any} */ client) =>
      seedLine(client, sellerA, '5511000000188'),
    );
    const b = await database.transaction((/** @type {any} */ client) =>
      seedLine(client, sellerB, '5511000000288'),
    );
    const repository = new PostgresN8nIntegrationRepository({
      database,
      envelopeKey: key,
      personalInboundEnabled: true,
      personalInboundSellerIds: [sellerA, sellerB],
      personalSendSellers,
    });
    const service = createN8nIntegrationService({
      repository,
      clock: () => now,
    });
    const defaultOff = createN8nIntegrationService({
      repository: new PostgresN8nIntegrationRepository({
        database,
        envelopeKey: key,
      }),
      clock: () => now,
    });
    const inbox = createInboxService({
      clock: () => now,
      auditPort: new PostgresAuditTrail(database),
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: key,
        outboundMessageOutbox: new PostgresN8nCommandOutbox({
          envelopeKey: key,
          personalSendSellers,
        }),
      }),
    });
    const store = new PostgresN8nCommandStore({
      database,
      envelopeKey: key,
      personalSendSellers,
    });
    const reader = new PostgresInboxReadRepository({
      database,
      contactEnvelopeKey: key,
      messageEnvelopeKey: key,
    });

    /** @param {any} line */
    const conversation = async (line) =>
      (
        await pool.query(
          'SELECT * FROM crm.conversations WHERE provider_account_id=$1',
          [line.source.accountId],
        )
      ).rows[0];
    /** @param {any} line @param {string} id */
    const messages = async (line, id) =>
      (
        await pool.query(
          'SELECT * FROM crm.messages WHERE provider_account_id=$1 AND external_message_id=$2',
          [line.source.accountId, id],
        )
      ).rows;
    /** @param {any} line */
    async function queue(line) {
      const c = await conversation(line);
      const commandId = `send-${randomUUID()}`;
      const message = await inbox.sendHumanMessage({
        actor: { id: line.sellerId, kind: 'human', functionName: 'Vendedor' },
        conversationId: c.id,
        expectedVersion: Number(c.version),
        messageType: 'text',
        content: { text: 'Resposta sintética' },
        correlationId: commandId,
        idempotencyKey: commandId,
        reason: 'synthetic',
      });
      return { commandId, messageId: message.id };
    }
    /** @param {{commandId:string,messageId:string}} queued @param {any} line */
    async function prepare(queued, line) {
      const { commandId } = queued;
      const delivery = await store.loadForDelivery(commandId, { now });
      assert.ok(delivery);
      assert.equal(delivery.payload.to, recipient);
      assert.equal(
        delivery.payload.whatsapp_target.source.accountId,
        line.source.accountId,
      );
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
      const preflight = {
        commandId,
        technical: reserve.technical,
        now,
        dispatch: true,
      };
      return { ...queued, reserve, preflight, executionId };
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
    /** @param {any} line @param {string} id @param {string} status */
    const ack = (line, id, status) =>
      service.recordEvent({
        schema_version: '1.0',
        event_type: `message.${status}`,
        event_id: `${id}:${status}`,
        external_message_id: id,
        occurred_at: now.toISOString(),
        source: line.source,
        technical: technical(`${line.source.accountId}:${id}:${status}`),
      });

    await t.test(
      'validates fromMe, workflow, instance, generation, and account without new inbound or AI',
      async () => {
        await assert.rejects(defaultOff.recordEvent(external(a, 'deny')), {
          code: 'N8N_FORBIDDEN',
        });
        for (const fields of [
          { from_me: false },
          { origin: 'human' },
          { command_id: 'forged' },
          { message: { type: 'image', text: '', url: 'forged' } },
          { occurred_at: 'invalid' },
        ])
          await assert.rejects(
            service.recordEvent(external(a, 'invalid', fields)),
            { code: 'N8N_INVALID' },
          );
        for (const fields of [
          { instance: b.instance },
          { source: b.source, instance: a.instance },
          { source: { ...a.source, generation: 2 } },
        ])
          await assert.rejects(
            service.recordEvent(external(a, 'stale', fields)),
            { code: 'WHATSAPP_GENERATION_STALE' },
          );
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM crm.messages'))
            .rows[0].n,
          0,
        );
        assert.equal(
          (await service.recordEvent(external(a, 'same-id'))).duplicate,
          false,
        );
        assert.equal(
          (await service.recordEvent(external(b, 'same-id'))).duplicate,
          false,
        );
        assert.equal(
          (await service.recordEvent(external(a, 'same-id'))).duplicate,
          true,
        );
        await assert.rejects(
          service.recordEvent(external(a, 'same-id', { to: '+5511000000488' })),
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
        assert.equal((await conversation(a)).inbound_revision, '0');
        assert.equal(
          (await messages(a, 'same-id'))[0].status,
          'outcome_unknown',
        );
        assert.equal(
          (await messages(b, 'same-id'))[0].author_id,
          b.source.lineId,
        );
        for (const table of ['orders', 'outbox_jobs', 'ai_suggestions'])
          assert.equal(
            (await pool.query(`SELECT count(*)::int AS n FROM crm.${table}`))
              .rows[0].n,
            0,
          );
      },
    );

    await t.test(
      'echo first, concurrent replay and earlier receipt preserve one CRM message and its author',
      async () => {
        const command = await prepare(await queue(a), a);
        assert.equal(
          (await service.recordEvent(command.reserve)).send_authorized,
          true,
        );
        assert.equal(
          (await service.recordEvent(command.reserve)).send_authorized,
          false,
        );
        const dispatches = await Promise.allSettled([
          repository.readReservedSend(command.preflight),
          repository.readReservedSend(command.preflight),
        ]);
        assert.deepEqual(
          dispatches
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value),
          [{ valid: true, instance: a.instance, to: recipient }],
        );
        assert.deepEqual(
          dispatches
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason.code),
          ['WHATSAPP_SEND_UNAVAILABLE'],
        );
        assert.equal(
          await store.markDelivered(command.commandId, {
            attemptId: command.executionId,
            now,
          }),
          false,
        );
        const id = 'echo-first';
        await ack(a, id, 'read');
        await service.recordEvent(external(a, id));
        await Promise.all([
          ack(a, id, 'delivered'),
          service.recordEvent(sent(command, id)),
          service.recordEvent(external(a, id)),
        ]);
        const rows = await messages(a, id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, command.messageId);
        assert.equal(rows[0].author_kind, 'human');
        assert.equal(rows[0].delivery_status, 'read');
        assert.equal(
          await store.markDelivered(command.commandId, {
            attemptId: command.executionId,
            now,
          }),
          true,
        );
        assert.equal((await conversation(a)).inbound_revision, '0');
      },
    );

    await t.test(
      'HTTP first, one global ID per account, and an external media gap',
      async () => {
        const command = await prepare(await queue(b), b);
        await service.recordEvent(command.reserve);
        await assert.rejects(service.recordEvent(sent(command, 'http-first')), {
          code: 'N8N_CONFLICT',
        });
        await repository.readReservedSend(command.preflight);
        await service.recordEvent(sent(command, 'http-first'));
        await Promise.all([
          service.recordEvent(external(b, 'http-first')),
          service.recordEvent(external(b, 'http-first')),
        ]);
        await service.recordEvent(
          external(a, 'http-first', {
            message: { type: 'image', text: 'Imagem sintética' },
          }),
        );
        assert.equal((await messages(b, 'http-first'))[0].author_id, sellerB);
        const thread = await reader.get((await conversation(a)).id, {
          actorId: sellerA,
        });
        const media = thread.messages.find(
          /** @param {any} m */ (m) => m.type === 'image',
        );
        assert.ok(media);
        assert.equal(media.origin, 'device');
        assert.equal(media.media.state, 'unavailable');
        assert.equal(media.media.contentUrl, null);

        const directory = await mkdtemp(join(tmpdir(), 'crm-wap-e08-media-'));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const volume = new PrivateMediaVolume({
          rootDirectory: directory,
          maxBytes: 10 * 1024 * 1024,
          maxFileBytes: 5 * 1024 * 1024,
          repository: new PostgresTransientMediaRepository({ database }),
          now: () => now,
          scanner: {
            async scan() {
              return {
                clean: true,
                detectedMimeType: 'image/png',
                signatureUpdatedAt: now,
              };
            },
          },
        });
        const keyString = key.toString('base64');
        const runtime = createN8nApiRuntime(database, {
          mediaVolume: volume,
          clock: () => now,
          environment: {
            N8N_INTEGRATION_ENVELOPE_KEY: keyString,
            CONTACT_IDENTITY_ENVELOPE_KEY: keyString,
            CONTACT_IDENTITY_LOOKUP_KEY: keyString,
            INBOX_MESSAGE_ENVELOPE_KEY: keyString,
            SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
            SELLER_WHATSAPP_INBOUND_SELLER_IDS: JSON.stringify([
              sellerA,
              sellerB,
            ]),
          },
        });
        const bytes = await readFile(
          new URL('../fixtures/media-composer.png', import.meta.url),
        );
        const attachment = {
          conversationId: thread.conversation.id,
          externalId: 'http-first',
          externalBindingId: a.source.bindingId,
          contentSha256: createHash('sha256').update(bytes).digest('hex'),
          stream: bytes,
          filename: 'synthetic.png',
          size: bytes.length,
          mimeType: 'image/png',
          technical: technical('attachment-a'),
        };
        await assert.rejects(
          runtime.storeAttachment({
            ...attachment,
            externalBindingId: b.source.bindingId,
          }),
          { code: 'N8N_FORBIDDEN' },
        );
        const stored = await runtime.storeAttachment(attachment);
        assert.equal(stored.accepted, true);
        const updated = await reader.get(thread.conversation.id, {
          actorId: sellerA,
        });
        const file = updated.messages.find(
          (/** @type {any} */ m) => m.id === media.id,
        )?.media;
        assert.equal(file.state, 'attached');
        const readerRuntime = createInboundMediaRuntime({
          database,
          access: {},
          mediaVolume: volume,
          clock: () => now,
        });
        const actor = {
          id: sellerA,
          kind: 'human',
          functionName: 'Vendedor',
          capabilities: [],
        };
        await assert.rejects(
          readerRuntime.content({
            conversationId: thread.conversation.id,
            mediaId: file.mediaId,
            actor: { ...actor, id: sellerB },
          }),
          { statusCode: 404 },
        );
        assert.ok(file.contentUrl.endsWith('/content'));
      },
    );

    await t.test(
      'sends the generated ficha once through the reserved personal source and fences a stale order',
      async (subtest) => {
        const spoolRoot = await mkdtemp(join(tmpdir(), 'wap-e08-ficha-'));
        subtest.after(() => rm(spoolRoot, { recursive: true, force: true }));
        /** @type {Map<string, {bytes:Buffer, sizeBytes:number, sha256:string, mimeType:string}>} */
        const objects = new Map();
        const media = createChatMediaApiRuntime({
          repository: new PostgresChatMediaUploadRepository({ database }),
          access: {},
          spoolRoot,
          envelopeKey: key,
          orderPdfValidator: new ChatMediaValidator({
            now: () => now,
            scanner: {
              async scan(/** @type {string} */ path) {
                const bytes = await readFile(path);
                assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
                return {
                  clean: true,
                  detectedMimeType: 'application/pdf',
                  signatureUpdatedAt: now,
                };
              },
            },
          }),
          store: {
            async putValidated(
              /** @type {any} */ {
                key: id,
                stream,
                sizeBytes,
                sha256,
                mimeType,
              },
            ) {
              const chunks = [];
              for await (const chunk of stream) chunks.push(chunk);
              const bytes = Buffer.concat(chunks);
              assert.equal(bytes.length, sizeBytes);
              assert.equal(
                createHash('sha256').update(bytes).digest('hex'),
                sha256,
              );
              objects.set(id, { bytes, sizeBytes, sha256, mimeType });
            },
            async head(/** @type {string} */ id) {
              return objects.get(id);
            },
            async read(/** @type {string} */ id) {
              const object = objects.get(id);
              assert.ok(object);
              return {
                ...object,
                stream: Readable.from([object.bytes]),
                contentRange: null,
              };
            },
          },
        });
        const keyString = key.toString('base64');
        const pdf = createN8nApiRuntime(database, {
          mediaVolume: new PrivateMediaVolume({
            rootDirectory: join(spoolRoot, 'transient'),
            maxBytes: 1024,
            maxFileBytes: 512,
            repository: new PostgresTransientMediaRepository({ database }),
            scanner: {
              async scan() {
                throw new Error(
                  'Generated PDFs use the retained-media scanner',
                );
              },
            },
          }),
          clock: () => now,
          environment: {
            N8N_INTEGRATION_ENVELOPE_KEY: keyString,
            CONTACT_IDENTITY_ENVELOPE_KEY: keyString,
            CONTACT_IDENTITY_LOOKUP_KEY: keyString,
            INBOX_MESSAGE_ENVELOPE_KEY: keyString,
            SELLER_WHATSAPP_SEND_ENABLED: 'true',
            SELLER_WHATSAPP_SEND_SELLER_IDS: JSON.stringify([
              ...personalSendSellers,
            ]),
          },
        }).orderWhatsAppPdf(media);
        assert.ok(pdf);

        const c = await conversation(a);
        const orderId = await seedOrder(pool, {
          conversationId: c.id,
          owner: sellerA,
        });
        const api = Fastify();
        subtest.after(() => api.close());
        const actor = { id: sellerA, kind: 'human' };
        /** @param {any} input */
        function authorizeRead({ action, cookie }) {
          assert.ok(['order.read', 'order.print'].includes(action));
          return {
            actor: cookie === 'session=b' ? { ...actor, id: sellerB } : actor,
          };
        }
        registerOrderRoutes(
          api,
          {
            authorizeRead,
            authorizeWrite(/** @type {any} */ input) {
              assert.equal(input.action, 'order.print');
              if (input.csrfToken !== 'synthetic-csrf')
                throw Object.assign(new Error('CSRF'), {
                  statusCode: 403,
                  code: 'FORBIDDEN',
                });
              return authorizeRead(input);
            },
            async get(/** @type {string} */ id) {
              const {
                rows: [row],
              } = await pool.query('SELECT * FROM crm.orders WHERE id=$1', [
                id,
              ]);
              return {
                order: {
                  id,
                  number: row.number,
                  status: row.status,
                  version: Number(row.version),
                  origin: row.origin,
                  conversationId: row.conversation_id,
                  ficha: decryptJson(
                    row.ficha_envelope,
                    `order-ficha:${id}`,
                    orderKey,
                  ),
                },
              };
            },
          },
          () => ({ correlationId: randomUUID(), requestId: randomUUID() }),
          undefined,
          undefined,
          pdf,
        );
        const path = `/api/v1/orders/${orderId}/pdf/whatsapp`;
        const detail = await api.inject(`/api/v1/orders/${orderId}`);
        assert.equal(detail.json().order.pdfWhatsAppAvailable, true);
        const otherDetail = await api.inject({
          url: `/api/v1/orders/${orderId}`,
          headers: { cookie: 'session=b' },
        });
        assert.equal(otherDetail.json().order.pdfWhatsAppAvailable, undefined);
        const preview = await api.inject(`${path}?expectedVersion=1`);
        assert.equal(preview.statusCode, 200, preview.body);
        assert.match(
          String(preview.headers['cache-control']),
          /private, no-store/u,
        );
        const {
          preparation,
          sender,
          recipient: maskedRecipient,
        } = preview.json();
        assert.equal(sender, '••••0188');
        assert.equal(maskedRecipient, '••••0088');
        const crossSeller = await api.inject({
          url: `${path}?expectedVersion=1`,
          headers: { cookie: 'session=b' },
        });
        // WAP-07/08 (PO, 18/11/2026): A's private client's order is not
        // found for B, so no masked number or preparation reaches B.
        assert.equal(crossSeller.statusCode, 404, crossSeller.body);
        assert.equal(crossSeller.json().error.code, 'ORDER_NOT_FOUND');
        assert.doesNotMatch(crossSeller.body, /0188|0088/u);
        const intent = {
          method: /** @type {const} */ ('POST'),
          url: path,
          headers: {
            'idempotency-key': randomUUID(),
            'x-csrf-token': 'synthetic-csrf',
          },
          payload: { expectedVersion: 1, preparation },
        };
        assert.equal(
          (
            await api.inject({
              ...intent,
              payload: { ...intent.payload, to: '+5511000000999' },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await api.inject({
              ...intent,
              headers: { 'idempotency-key': randomUUID() },
            })
          ).statusCode,
          403,
        );
        const staleConfirmation = await api.inject({
          ...intent,
          payload: { expectedVersion: 1, preparation: '0'.repeat(64) },
        });
        assert.equal(staleConfirmation.statusCode, 409);
        const results = await Promise.all([
          api.inject(intent),
          api.inject(intent),
        ]);
        for (const result of results)
          assert.equal(result.statusCode, 202, result.body);
        const [first, second] = results.map((result) => result.json());
        assert.deepEqual(first, second);
        assert.equal(first.conversationId, c.id);
        const {
          rows: [message],
        } = await pool.query('SELECT * FROM crm.messages WHERE id=$1', [
          first.messageId,
        ]);
        assert.equal(message.message_type, 'document');
        assert.equal(message.author_id, sellerA);
        assert.equal(message.provider_account_id, a.source.accountId);
        const {
          rows: [counts],
        } = await pool.query(
          `SELECT (SELECT count(*) FROM crm.messages WHERE message_type='document' AND conversation_id=$1)::int AS messages,
          (SELECT count(*) FROM crm.n8n_commands WHERE message_id=$2)::int AS commands`,
          [c.id, first.messageId],
        );
        assert.deepEqual(counts, { messages: 1, commands: 1 });
        const command = await prepare(
          { commandId: message.command_id, messageId: message.id },
          a,
        );
        assert.equal(command.reserve.message.mime_type, 'application/pdf');
        assert.equal(
          (await service.recordEvent(command.reserve)).send_authorized,
          true,
        );
        const retained = await repository.readReservedMedia(command.preflight);
        const content = await media.reservedContent(retained);
        assert.equal(content.headers['Content-Type'], 'application/pdf');
        assert.match(
          content.headers['Content-Disposition'] ?? '',
          /^attachment;/u,
        );
        const chunks = [];
        for await (const chunk of content.stream) chunks.push(chunk);
        const pdfBytes = Buffer.concat(chunks);
        assert.equal(
          createHash('sha256').update(pdfBytes).digest('hex'),
          command.reserve.message.sha256,
        );
        assert.deepEqual(await repository.readReservedSend(command.preflight), {
          valid: true,
          instance: a.instance,
          to: recipient,
        });
        await assert.rejects(repository.readReservedSend(command.preflight), {
          code: 'WHATSAPP_SEND_UNAVAILABLE',
        });
        await pool.query(
          'UPDATE crm.orders SET version=version+1 WHERE id=$1',
          [orderId],
        );
        await service.recordEvent(sent(command, 'synthetic-ficha-receipt'));
        assert.equal(
          (await messages(a, 'synthetic-ficha-receipt'))[0].id,
          first.messageId,
        );
        assert.equal(
          (await api.inject(`${path}?expectedVersion=1`)).statusCode,
          409,
        );

        const nextPreview = await api.inject(`${path}?expectedVersion=2`);
        assert.equal(nextPreview.statusCode, 200);
        const next = await api.inject({
          ...intent,
          headers: { ...intent.headers, 'idempotency-key': randomUUID() },
          payload: {
            expectedVersion: 2,
            preparation: nextPreview.json().preparation,
          },
        });
        assert.equal(next.statusCode, 202, next.body);
        const {
          rows: [queued],
        } = await pool.query(
          'SELECT command_id FROM crm.messages WHERE id=$1',
          [next.json().messageId],
        );
        const stale = await prepare(
          { commandId: queued.command_id, messageId: next.json().messageId },
          a,
        );
        assert.equal(
          (await service.recordEvent(stale.reserve)).send_authorized,
          true,
        );
        await pool.query(
          'UPDATE crm.orders SET version=version+1 WHERE id=$1',
          [orderId],
        );
        await assert.rejects(repository.readReservedMedia(stale.preflight), {
          code: 'VERSION_CONFLICT',
        });
        await assert.rejects(repository.readReservedSend(stale.preflight), {
          code: 'VERSION_CONFLICT',
        });

        assert.ok(media.storeOrderPdf);
        const orphan = await media.storeOrderPdf({
          pdf: pdfBytes,
          filename: 'ficha-sintetica.pdf',
          actorId: sellerA,
          conversationId: c.id,
        });
        await pool.query(
          "UPDATE crm.chat_media SET created_at=now()-interval '25 hours' WHERE id=$1",
          [orphan],
        );
        const cleanup = new PostgresChatMediaDraftCleanup({
          database,
          store: {
            async deleteDraft(/** @type {string} */ id) {
              objects.delete(id);
            },
          },
          spoolRoot,
          bucketAlias: 'chat-dev',
        });
        await cleanup.runOnce();
        const released = await pool.query(
          "SELECT 1 FROM crm.chat_media WHERE id=$1 AND reservation_bytes=0 AND state='lost'",
          [orphan],
        );
        assert.equal(released.rowCount, 1);
        assert.equal(objects.has(orphan), false);
        assert.equal(objects.has(retained.id), true);
      },
    );

    await t.test(
      'commercial ACL and stale target fence the send while checkout and replayed payment continue',
      async () => {
        const environment = {
          ORDER_BILLING_ENABLED: 'true',
          ORDER_BILLING_CHAT_SEND_ENABLED: 'true',
          N8N_INTEGRATION_ENVELOPE_KEY: key.toString('base64'),
          IDEMPOTENCY_ENVELOPE_KEY: key.toString('base64'),
          INBOX_MESSAGE_ENVELOPE_KEY: key.toString('base64'),
          SELLER_WHATSAPP_SEND_ENABLED: 'true',
          SELLER_WHATSAPP_SEND_SELLER_IDS: JSON.stringify([
            ...personalSendSellers,
          ]),
        };
        const actor = { id: sellerA, kind: 'human' };
        const options = {
          clock: () => now,
          environment,
          access: {
            authorizeRead: async () => ({ actor }),
            authorizeWrite: async () => ({ actor }),
          },
          outboundMessageOutbox: new PostgresN8nCommandOutbox({
            envelopeKey: key,
            personalSendSellers,
          }),
        };
        const chat = createOrderBillingChatRuntime(database, options);
        const finance = createOrderBillingRuntime(database, {
          ...options,
          billingChat: chat,
        });
        const c = await conversation(a);
        const other = await conversation(b);
        const orderId = await seedOrder(pool, {
          conversationId: c.id,
          owner: sellerA,
          amount: 120000,
        });
        const { contact_id: contactId, version: version } = (
          await pool.query(
            'SELECT contact_id,version FROM crm.orders WHERE id=$1',
            [orderId],
          )
        ).rows[0];
        await pool.query(
          `INSERT INTO crm.seller_client_links(id,seller_id,contact_id,provenance,source_id,status,version,created_by,updated_by,created_at,updated_at)
      VALUES(gen_random_uuid(),$1,$2,'explicit_link',NULL,'active',1,$1,$3,$4,$4)`,
          [sellerB, contactId, sellerA, now],
        );
        const input = {
          actor,
          orderId,
          conversationId: c.id,
          expectedVersion: Number(version),
          expectedBillingVersion: 0,
          expectedConversationVersion: Number(c.version),
          action: 'issue',
          percent: 30,
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
        };
        await assert.rejects(
          chat.submit({
            ...input,
            actor: { ...actor, id: sellerB },
            conversationId: other.id,
          }),
          { code: 'FORBIDDEN' },
        );
        const intent = await chat.submit(input);
        assert.equal(intent.state, 'waiting_link');
        await pool.query(
          "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
          [sellerB],
        );
        try {
          const otherAdmin = { ...actor, id: sellerB };
          await assert.rejects(
            chat.getIntent({ actor: otherAdmin, orderId, intentId: intent.id }),
            { code: 'BILLING_NOT_FOUND' },
          );
          await assert.rejects(
            chat.submit({
              ...input,
              actor: otherAdmin,
              idempotencyKey: randomUUID(),
            }),
            { code: 'FORBIDDEN' },
          );
          const history = await chat.getHistory({ actor: otherAdmin, orderId });
          assert.ok(
            history.items.some(
              (/** @type {any} */ event) => event.intentId === intent.id,
            ),
          );
        } finally {
          await pool.query(
            "DELETE FROM crm.user_capabilities WHERE user_id=$1 AND capability='COMMERCIAL_ADMIN'",
            [sellerB],
          );
        }
        await pool.query(
          'UPDATE crm.contacts SET version=version+1,updated_at=$2 WHERE id=$1',
          [contactId, now],
        );
        const executionId = randomUUID();
        const context = {
          chargeId: intent.chargeId,
          executionId,
          correlationId: randomUUID(),
        };
        assert.equal((await finance.reserve(context)).allowed, true);
        await finance.created({
          ...context,
          checkoutUrl: `https://pay.infinitepay.io/synthetic/${intent.chargeId}`,
        });
        const blocked = (
          await pool.query(
            'SELECT state,command_id FROM crm.order_billing_send_intents WHERE id=$1',
            [intent.id],
          )
        ).rows[0];
        assert.deepEqual(blocked, { state: 'blocked', command_id: null });
        await pool.query(
          "UPDATE crm.seller_whatsapp_lines SET state='disconnecting',generation=2,verified_at=NULL,version=version+1 WHERE id=$1",
          [a.source.lineId],
        );
        const payment = {
          chargeId: intent.chargeId,
          transactionNsu: randomUUID(),
          invoiceSlug: randomUUID(),
          amountCents: intent.amountCents,
          paidAmountCents: intent.amountCents,
          method: 'pix',
          installments: 1,
          receiptUrl: null,
          correlationId: randomUUID(),
        };
        await Promise.all([finance.payment(payment), finance.payment(payment)]);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM crm.order_billing_payments WHERE charge_id=$1',
              [intent.chargeId],
            )
          ).rows[0].n,
          1,
        );
        await database.transaction(async (/** @type {any} */ client) => {
          await client.query(
            'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE id=$1',
            [a.source.bindingId, now],
          );
          const replacement = randomUUID();
          await client.query(
            `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
        SELECT $1,line_id,account_id,instance_name,3,$2,token_envelope,$3 FROM crm.seller_whatsapp_bindings WHERE id=$4`,
            [
              replacement,
              createHash('sha256').update(replacement).digest('hex'),
              now,
              a.source.bindingId,
            ],
          );
          await client.query(
            "UPDATE crm.seller_whatsapp_lines SET state='connected',generation=3,verified_at=$2,version=version+1 WHERE id=$1",
            [a.source.lineId, now],
          );
          a.source = { ...a.source, bindingId: replacement, generation: 3 };
        });
        await finance.created({
          ...context,
          checkoutUrl: `https://pay.infinitepay.io/synthetic/${intent.chargeId}`,
        });
        const after = (
          await pool.query(
            `SELECT (SELECT count(*)::int FROM crm.order_billing_charges WHERE order_id=$1) AS charges,
      (SELECT count(*)::int FROM crm.order_billing_send_intents WHERE order_id=$1 AND command_id IS NOT NULL) AS sends`,
            [orderId],
          )
        ).rows[0];
        assert.deepEqual(after, { charges: 1, sends: 0 });
      },
    );

    await t.test(
      'disconnect wins against a reservation; revocation wins at dispatch; already dispatched settles',
      async () => {
        const deniedByFlag = await queue(b);
        const disabled = new PostgresN8nCommandStore({
          database,
          envelopeKey: key,
        });
        assert.equal(
          await disabled.loadForDelivery(deniedByFlag.commandId, { now }),
          null,
        );
        const denied = (
          await pool.query(
            'SELECT status,last_error_code,whatsapp_dispatched_at FROM crm.n8n_commands WHERE command_id=$1',
            [deniedByFlag.commandId],
          )
        ).rows[0];
        assert.deepEqual(denied, {
          status: 'failed',
          last_error_code: 'WHATSAPP_SEND_UNAVAILABLE',
          whatsapp_dispatched_at: null,
        });
        const beforeReserve = await prepare(await queue(b), b);
        const beforeDispatch = await prepare(await queue(a), a);
        await service.recordEvent(beforeDispatch.reserve);
        const started = await prepare(await queue(b), b);
        await service.recordEvent(started.reserve);
        await repository.readReservedSend(started.preflight);
        const disconnector = await pool.connect();
        try {
          await disconnector.query('BEGIN');
          await disconnector.query(
            "UPDATE crm.seller_whatsapp_lines SET state='disconnecting', generation=2, verified_at=NULL, version=version+1 WHERE id=$1",
            [b.source.lineId],
          );
          const attempt = assert.rejects(
            service.recordEvent(beforeReserve.reserve),
            { code: 'WHATSAPP_SEND_UNAVAILABLE' },
          );
          await disconnector.query('COMMIT');
          await attempt;
        } finally {
          disconnector.release();
        }
        const revoker = await pool.connect();
        try {
          const { contact_identity_id: identity } = await conversation(a);
          await revoker.query('BEGIN');
          await revoker.query(
            'SELECT c.id FROM crm.contacts c JOIN crm.contact_identities i ON i.current_contact_id=c.id WHERE i.id=$1 FOR UPDATE OF c',
            [identity],
          );
          await revoker.query(
            "UPDATE crm.seller_client_links SET status='revoked',version=version+1,revoked_at=$2 WHERE seller_id=$1",
            [sellerA, now],
          );
          const attempt = assert.rejects(
            repository.readReservedSend(beforeDispatch.preflight),
            { code: 'WHATSAPP_SEND_UNAVAILABLE' },
          );
          await revoker.query('COMMIT');
          await attempt;
        } finally {
          revoker.release();
        }
        const result = sent(started, 'after-disconnect');
        await assert.rejects(
          service.recordEvent({ ...result, source: a.source }),
          { code: 'N8N_CONFLICT' },
        );
        assert.equal((await service.recordEvent(result)).accepted, true);
        assert.equal((await messages(b, 'after-disconnect')).length, 1);
        assert.equal(
          await store.loadForDelivery(started.commandId, { now }),
          null,
        );
        await assert.rejects(
          service.recordEvent(external(b, 'old-generation')),
          { code: 'WHATSAPP_GENERATION_STALE' },
        );
      },
    );
  },
);
