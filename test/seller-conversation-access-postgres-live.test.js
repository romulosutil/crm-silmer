import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Pool } from 'pg';
import { createApi } from '../apps/api/src/app.js';
import { createInboundMediaRuntime } from '../apps/api/src/inbound-media-runtime.js';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { createOperationReadService } from '../apps/api/src/operation-runtime.js';
import { createConversationReminderRuntime } from '../apps/api/src/conversation-reminder-runtime.js';
import { createDashboardRuntime } from '../apps/api/src/dashboard-runtime.js';
import { createOrderApiRuntime } from '../apps/api/src/order-runtime.js';
import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { PostgresChatMediaUploadRepository } from '../modules/integration-reliability/src/postgres-chat-media-upload-repository.js';
import { encryptJson } from '../modules/orders/src/adapters/envelope.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresContactIdentityRepository,
  createContactIdentityService,
  encryptContactDetails,
} from '../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresInboxReadRepository,
  PostgresInboxRepository,
  createInboxService,
  createSubjectService,
  lockConversationAccess,
} from '../modules/inbox-channels/src/index.js';
import { PostgresOrderAssistanceRepository } from '../modules/inbox-channels/src/adapters/postgres-order-assistance.js';

const connectionString = process.env.TEST_DATABASE_URL;
const key = Buffer.alloc(32, 87);

test(
  'WAP-E04: personal conversation SQL, commands and replay retain current line/owner/link scope',
  {
    skip: !connectionString,
  },
  async (t) => {
    assert.ok(connectionString);
    assert.equal(new URL(connectionString).pathname, '/crm_silmer_test');
    const pool = new Pool({ connectionString, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const prefix = randomUUID();
    const sellerA = 'scope-a-' + prefix;
    const sellerB = 'scope-b-' + prefix;
    const admin = 'scope-admin-' + prefix;
    // WAP-07/08: a seller with no wallet link and no order of this client.
    const stranger = 'scope-stranger-' + prefix;
    const actor = (/** @type {string} */ id) => ({
      id,
      kind: 'human',
      functionName: 'Vendedor',
      capabilities: id === admin ? ['COMMERCIAL_ADMIN'] : [],
    });
    const reader = (/** @type {string} */ id) =>
      id === admin ? { actorId: id } : { actorId: id, visibilityActorId: id };
    const inbox = new PostgresInboxReadRepository({
      database,
      contactEnvelopeKey: key,
      messageEnvelopeKey: key,
    });
    const subjects = createSubjectService(database);
    const assistance = new PostgresOrderAssistanceRepository({
      database,
      envelopeKey: key,
      createPending: async () => assert.fail('No order creation in scope test'),
    });
    const mutations = createInboxService({
      repository: new PostgresInboxRepository({
        database,
        envelopeKey: key,
        outboundMessageOutbox: {
          enqueueChannelMessage: async () => assert.fail('No automatic send'),
        },
      }),
    });
    const identities = createContactIdentityService({
      auditPort: new PostgresAuditTrail(database),
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: key,
        lookupKey: key,
      }),
    });
    try {
      await migrate(pool, { migrations: await loadMigrations() });
      for (const id of [sellerA, sellerB, admin, stranger]) {
        await pool.query(
          "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic scope')",
          [id, id + '@example.test'],
        );
        await pool.query(
          "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
          [id],
        );
      }
      await pool.query(
        "INSERT INTO crm.user_capabilities(user_id,capability,granted_by) VALUES($1,'COMMERCIAL_ADMIN',$2)",
        [admin, sellerA],
      );
      const accountA = randomUUID(),
        accountB = randomUUID();
      /** @param {string} account @param {string|null} owner @param {string} handle */
      async function seedConversation(account, owner, handle) {
        const identity = await identities.resolveInboundIdentity({
          provider: 'evolution',
          providerAccountId: account,
          channel: 'whatsapp',
          identityKind: 'phone',
          phoneStatus: 'confirmed',
          displayHandle: null,
          externalIdentityId: handle,
          correlationId: randomUUID(),
          occurredAt: new Date().toISOString(),
        });
        const id = 'scope-conversation-' + randomUUID();
        await pool.query(
          `INSERT INTO crm.conversations
        (id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,state,automation_state,assigned_user_id,version,opened_at,last_message_at)
        VALUES($1,$2,'evolution',$3,$1,1,'em_atendimento','human',$4,1,now(),now())`,
          [id, identity.identity.id, account, owner],
        );
        return {
          id,
          identityId: identity.identity.id,
          contactId: identity.contact.id,
        };
      }
      const own = await seedConversation(accountA, sellerA, '5511987000011');
      const other = await seedConversation(accountB, sellerB, '5511987000011');
      await seedConversation(
        'scope-general-' + prefix,
        sellerA,
        '5511987000012',
      );
      // Same official Contact across two lines never grants the other history.
      await pool.query(
        'UPDATE crm.contact_identities SET current_contact_id=$2 WHERE id=$1',
        [other.identityId, own.contactId],
      );
      for (const [seller, account] of [
        [sellerA, accountA],
        [sellerB, accountB],
      ]) {
        const lineId = randomUUID();
        await database.transaction(async (/** @type {any} */ tx) => {
          await tx.query(
            `INSERT INTO crm.seller_whatsapp_lines
        (id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,'disconnected',2,1,now(),now())`,
            [
              lineId,
              seller,
              account,
              'wap_' + lineId.replaceAll('-', ''),
              lineId.replaceAll('-', '').padEnd(64, '0'),
              JSON.stringify(
                encryptContactDetails(
                  { phone: '5511987000099', email: null },
                  key,
                ),
              ),
            ],
          );
          await tx.query(
            "INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at) VALUES($1,'personal',$2,now())",
            [lineId.replaceAll('-', '').padEnd(64, '0'), lineId],
          );
        });
        await pool.query(
          `INSERT INTO crm.seller_client_links
        (id,seller_id,contact_id,provenance,status,version,created_by,updated_by,created_at,updated_at)
        VALUES($1,$2,$3,'explicit_link','active',1,$2,$2,now(),now())`,
          [randomUUID(), seller, own.contactId],
        );
      }
      const operations = createOperationReadService({
        database,
        inboxRepository: inbox,
        contactRepository: {},
        handoffRepository: {},
        cursorKey: key,
      });
      const cursorPage = await operations.listInbox(
        { limit: 1, assignedUserId: sellerA },
        { actorId: sellerA, capabilities: [] },
      );
      assert.ok(
        cursorPage.nextCursor,
        'fixture must issue a real paginated cursor',
      );
      const mediaFixture = new URL(
        './fixtures/media-composer.png',
        import.meta.url,
      );
      const bytes = await readFile(mediaFixture);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const transientId = 'media-' + randomUUID(),
        retainedId = randomUUID(),
        messageId = 'scope-message-' + randomUUID();
      await pool.query(
        `INSERT INTO crm.messages
        (id,conversation_id,provider,provider_account_id,external_message_id,direction,author_kind,author_id,message_type,content_envelope,status,occurred_at,created_at)
        VALUES($1,$2,'evolution',$3,$1,'inbound','contact',$4,'image',$5::jsonb,'received',now(),now())`,
        [
          messageId,
          own.id,
          accountA,
          own.identityId,
          JSON.stringify(
            encryptJson(
              { text: 'Synthetic attachment' },
              'message:' + messageId,
              key,
            ),
          ),
        ],
      );
      await pool.query(
        `INSERT INTO crm.transient_media
        (id,provider,provider_account_id,external_media_id,media_type,metadata_fingerprint,first_received_at,expires_at,availability_status,validation_status,storage_key,size_bytes,content_sha256,detected_mime_type,stored_at)
        VALUES($1,'evolution',$2,$1,'image',$3,now(),now()+interval '1 day','available','clean',$4,$5,$6,'image/png',now())`,
        [
          transientId,
          accountA,
          'a'.repeat(64),
          randomUUID(),
          bytes.length,
          sha256,
        ],
      );
      await pool.query(
        'INSERT INTO crm.attachments(message_id,transient_media_id) VALUES($1,$2)',
        [messageId, transientId],
      );
      await pool.query(
        `INSERT INTO crm.chat_media
        (id,conversation_id,uploaded_by,upload_command_id,request_fingerprint,kind,origin,filename_envelope,storage_bucket_alias,input_size_bytes,reservation_bytes,state,validation_status,size_bytes,original_sha256,content_sha256,detected_mime_type,processed_at)
        VALUES($1::uuid,$2,$3,$1::text,$4,'image','attachment',$5::jsonb,'chat-dev',$6,0,'ready','clean',$6,$7,$7,'image/png',now())`,
        [
          retainedId,
          own.id,
          sellerA,
          'b'.repeat(64),
          JSON.stringify(
            encryptJson('synthetic.png', 'media:' + retainedId, key),
          ),
          bytes.length,
          sha256,
        ],
      );
      let privateReads = 0;
      let currentActor = actor(sellerA);
      const access = {
        authorizeRead: async () => ({ actor: currentActor }),
        authorizeWrite: async () => ({ actor: currentActor }),
      };
      const orderPort = new PostgresOrderConversationPort({
        database,
        envelopeKey: key,
        contactEnvelopeKey: key,
        contactLookupKey: key,
      });
      const orderRepository = new PostgresOrderRepository({
        database,
        envelopeKey: key,
      });
      const order = await orderRepository.createPending({
        id: randomUUID(),
        actor: actor(sellerA),
        conversationId: own.id,
        correlationId: randomUUID(),
        createdBy: sellerA,
        createdByKind: 'user',
        fabCode: '01',
        firstContactAt: new Date().toISOString(),
        now: new Date(),
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
        missingFields: ['items'],
        totalPieces: 0,
      });
      const orders = createOrderApiRuntime(database, {
        access,
        environment: {
          N8N_INTEGRATION_ENVELOPE_KEY: key.toString('base64url'),
          CONTACT_IDENTITY_ENVELOPE_KEY: key.toString('base64url'),
          CONTACT_IDENTITY_LOOKUP_KEY: key.toString('base64url'),
          IDEMPOTENCY_ENVELOPE_KEY: key.toString('base64url'),
          FAB_CODE: '01',
        },
      });
      const retained = createChatMediaApiRuntime({
        repository: new PostgresChatMediaUploadRepository({ database }),
        access,
        spoolRoot: fileURLToPath(new URL('.', import.meta.url)),
        envelopeKey: key,
        store: {
          async head() {
            privateReads++;
            return { sizeBytes: bytes.length, sha256, mimeType: 'image/png' };
          },
          async read() {
            privateReads++;
            return {
              sizeBytes: bytes.length,
              sha256,
              mimeType: 'image/png',
              contentRange: null,
              stream: Readable.from(bytes),
            };
          },
        },
      });
      const media = createInboundMediaRuntime({
        database,
        access,
        retained,
        mediaVolume: {
          async resolvePath() {
            privateReads++;
            return fileURLToPath(mediaFixture);
          },
        },
      });
      const api = createApi(
        {},
        {
          inboundMedia: media,
          orders,
          logger: createSafeLogger({
            service: 'crm-silmer-api',
            sink: () => {},
          }),
        },
      );
      t.after(() => api.close());
      /** @param {string} id */
      const fetchMedia = (id) =>
        api.inject({
          method: 'GET',
          headers: { cookie: 'crm_session=synthetic' },
          url: `/api/v1/conversations/${own.id}/media/${id}/content`,
        });
      async function denyBothMedia() {
        const before = privateReads;
        for (const id of [transientId, retainedId])
          assert.equal((await fetchMedia(id)).statusCode, 404);
        assert.equal(
          privateReads,
          before,
          'denial must happen before any file or RustFS read',
        );
      }
      /** WAP-07/08: the order's seller and a reader with the Contact in the
       * wallet keep the commercial detail without chat; any other seller
       * gets 404 (Tech Lead, 18/11/2026).
       * @param {boolean} [contactVisible] */
      async function commercialWithoutChat(contactVisible = true) {
        assert.deepEqual(
          await orderPort.readVisibleConversationIds([own.id], currentActor),
          new Set(),
        );
        const commercial = await api.inject({
          method: 'GET',
          url: `/api/v1/orders/${order.id}`,
          headers: { cookie: 'crm_session=synthetic' },
        });
        if (contactVisible) {
          assert.equal(commercial.statusCode, 200);
          assert.equal(commercial.json().order.conversationId, null);
          assert.equal(commercial.json().order.lastMessage, null);
        } else {
          assert.equal(commercial.statusCode, 404);
          assert.deepEqual(commercial.json(), {
            error: { code: 'ORDER_NOT_FOUND' },
          });
        }
        const throughConversation = await api.inject({
          method: 'GET',
          url: `/api/v1/conversations/${own.id}/order`,
          headers: { cookie: 'crm_session=synthetic' },
        });
        assert.equal(throughConversation.statusCode, 404);
      }
      await t.test(
        'both public media paths authorize SQL before file or retained-object access',
        async () => {
          assert.deepEqual(
            await orderPort.readVisibleConversationIds(
              [own.id, other.id],
              actor(sellerA),
            ),
            new Set([own.id]),
          );
          for (const id of [transientId, retainedId]) {
            const response = await fetchMedia(id);
            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.rawPayload, bytes);
          }
          currentActor = actor(sellerB);
          await denyBothMedia();
          await commercialWithoutChat();
          currentActor = actor(sellerA);
        },
      );
      await t.test(
        'two portfolios share only the Contact; disconnected history remains readable',
        async () => {
          assert.equal(
            (await inbox.get(own.id, reader(sellerA))).conversation
              .personalLine,
            true,
          );
          // WAP-11: the holder reads whether the line can send; nobody else
          // learns anything about it (no state, no number).
          const usable = async (/** @type {string} */ id) =>
            (await inbox.get(own.id, reader(id))).conversation
              .personalLineUsable;
          assert.equal(await usable(sellerA), false, 'disconnected line');
          const ownLine = (
            await pool.query(
              'SELECT id,account_id,instance_name,generation FROM crm.seller_whatsapp_lines WHERE seller_id=$1',
              [sellerA],
            )
          ).rows[0];
          const confirmed = JSON.stringify(
            encryptContactDetails({ phone: '5511987000099', email: null }, key),
          );
          await pool.query(
            `UPDATE crm.seller_whatsapp_lines SET state='connected',verified_at=now(),
               confirmed_number_envelope=$2::jsonb,version=version+1 WHERE id=$1`,
            [ownLine.id, confirmed],
          );
          assert.equal(await usable(sellerA), false, 'no active binding');
          const bindingId = randomUUID();
          await pool.query(
            `INSERT INTO crm.seller_whatsapp_bindings
             (id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now())`,
            [
              bindingId,
              ownLine.id,
              ownLine.account_id,
              ownLine.instance_name,
              ownLine.generation,
              bindingId.replaceAll('-', '').padEnd(64, 'a'),
              confirmed,
            ],
          );
          assert.equal(await usable(sellerA), true, 'connected holder');
          assert.equal(await usable(admin), false, 'admin is not the holder');
          // Scoped to this suite's owner: an unfiltered administrator list
          // reads every suite's rows in the shared test database, sealed with
          // other keys.
          const listed = (
            await inbox.list(
              { limit: 100, assignedUserId: sellerA },
              reader(admin),
            )
          ).items.find((/** @type {any} */ item) => item.id === own.id);
          assert.ok(listed, 'the holder conversation is listed');
          assert.equal(
            'personalLineUsable' in listed,
            false,
            'the list never carries the line state',
          );
          for (const state of ['blocked', 'awaiting_pairing', 'unknown']) {
            await pool.query(
              'UPDATE crm.seller_whatsapp_lines SET state=$2,version=version+1 WHERE id=$1',
              [ownLine.id, state],
            );
            assert.equal(await usable(sellerA), false, state);
          }
          await pool.query(
            'UPDATE crm.seller_whatsapp_bindings SET revoked_at=now() WHERE id=$1',
            [bindingId],
          );
          await pool.query(
            "UPDATE crm.seller_whatsapp_lines SET state='disconnected',version=version+1 WHERE id=$1",
            [ownLine.id],
          );
          assert.equal(await usable(sellerA), false, 'revoked binding');
          await assert.rejects(inbox.get(other.id, reader(sellerA)), {
            code: 'CONVERSATION_NOT_FOUND',
          });
          await assert.rejects(
            inbox.assistantContext(other.id, reader(sellerA)),
            { code: 'CONVERSATION_NOT_FOUND' },
          );
          await assert.rejects(subjects.list(other.id, '', actor(sellerA)), {
            statusCode: 403,
          });
          await assert.rejects(
            assistance.list({
              conversationId: other.id,
              actor: actor(sellerA),
            }),
            { statusCode: 403 },
          );
          assert.equal(
            (await subjects.list(own.id, '', actor(sellerA))).subjects.length,
            0,
          );
          assert.equal(
            (
              await assistance.list({
                conversationId: own.id,
                actor: actor(sellerA),
              })
            ).suggestions.length,
            0,
          );
          assert.equal(
            (await inbox.get(other.id, reader(admin))).conversation.id,
            other.id,
          );
          const list = await inbox.list(
            { limit: 1, assignedUserId: sellerB },
            reader(sellerA),
          );
          assert.equal(list.totalCount, 0);
          assert.deepEqual(list.items, []);
        },
      );
      await t.test(
        'personal line without owner never enters public list/count/detail/context',
        async () => {
          await pool.query(
            "UPDATE crm.conversations SET state='requer_atencao' WHERE id=$1",
            [own.id],
          );
          const before = await inbox.list(
            { limit: 100, owner: 'unassigned', state: 'requer_atencao' },
            reader(sellerA),
          );
          await pool.query(
            'UPDATE crm.conversations SET assigned_user_id=NULL WHERE id=$1',
            [own.id],
          );
          const after = await inbox.list(
            { limit: 100, owner: 'unassigned', state: 'requer_atencao' },
            reader(sellerA),
          );
          assert.equal(after.totalCount, before.totalCount);
          assert.equal(
            after.items.some((/** @type {any} */ item) => item.id === own.id),
            false,
          );
          await assert.rejects(inbox.get(own.id, reader(sellerA)), {
            code: 'CONVERSATION_NOT_FOUND',
          });
          await assert.rejects(
            inbox.assistantContext(own.id, reader(sellerA)),
            { code: 'CONVERSATION_NOT_FOUND' },
          );
          await denyBothMedia();
          assert.equal(
            (await inbox.get(own.id, reader(admin))).conversation.id,
            own.id,
          );
          await pool.query(
            'UPDATE crm.conversations SET assigned_user_id=$2 WHERE id=$1',
            [own.id, sellerA],
          );
        },
      );
      const reminders = createConversationReminderRuntime(database, {
        access: {},
        idempotencyEnvelopeKey: key,
      });
      const reminderInput = {
        actor: actor(sellerA),
        conversationId: own.id,
        body: {
          expectedVersion: 1,
          remindAt: new Date(Date.now() + 3600000).toISOString(),
        },
        idempotencyKey: 'synthetic-personal-reminder',
        correlationId: 'synthetic-reminder',
      };
      await reminders.set(reminderInput);
      const command = {
        actor: actor(sellerA),
        conversationId: own.id,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        reason: 'Synthetic authorization check',
        state: 'requer_atencao',
      };
      await t.test(
        'Contact reanchor while awaiting its lock conflicts before a stale-scope projection',
        async () => {
          const movedContact = 'scope-moved-' + randomUUID();
          await pool.query(
            'INSERT INTO crm.contacts(id,created_at,updated_at) VALUES($1,now(),now())',
            [movedContact],
          );
          await pool.query(
            `INSERT INTO crm.seller_client_links
          (id,seller_id,contact_id,provenance,status,version,created_by,updated_by,created_at,updated_at)
          VALUES($1,$2,$3,'explicit_link','active',1,$2,$2,now(),now())`,
            [randomUUID(), sellerA, movedContact],
          );
          const merger = await pool.connect();
          const applicationName = 'scope-race-' + prefix;
          try {
            await merger.query('BEGIN');
            await merger.query(
              'SELECT id FROM crm.contacts WHERE id=$1 FOR UPDATE',
              [own.contactId],
            );
            const pending = database.transaction(
              async (/** @type {any} */ tx) => {
                await tx.query(
                  "SELECT set_config('application_name',$1,true)",
                  [applicationName],
                );
                return lockConversationAccess(tx, own.id, sellerA);
              },
            );
            const refused = assert.rejects(pending, {
              code: 'INBOX_CONFLICT',
              statusCode: 409,
            });
            let waiting = false;
            for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
              const blocked = await pool.query(
                "SELECT query FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                [applicationName],
              );
              waiting = blocked.rows.some((/** @type {any} */ row) =>
                row.query.includes('FROM crm.contacts'),
              );
              if (!waiting)
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.equal(
              waiting,
              true,
              'real PostgreSQL must prove the old Contact lock waiter',
            );
            await merger.query(
              'UPDATE crm.contact_identities SET current_contact_id=$2 WHERE id=$1',
              [own.identityId, movedContact],
            );
            await merger.query('COMMIT');
            await refused;
            await pool.query(
              'UPDATE crm.contact_identities SET current_contact_id=$2 WHERE id=$1',
              [own.identityId, own.contactId],
            );
          } finally {
            await merger.query('ROLLBACK');
            merger.release();
          }
        },
      );
      await t.test(
        'generic transfer and administrator takeover cannot change a personal titular',
        async () => {
          for (const id of [sellerA, admin]) {
            await assert.rejects(
              mutations.transferConversation({
                ...command,
                actor: actor(id),
                targetUserId: sellerB,
              }),
              { code: 'INBOX_FORBIDDEN' },
            );
          }
          await assert.rejects(
            mutations.takeover({ ...command, actor: actor(admin) }),
            { code: 'INBOX_FORBIDDEN' },
          );
          assert.equal(
            (
              await pool.query(
                'SELECT assigned_user_id FROM crm.conversations WHERE id=$1',
                [own.id],
              )
            ).rows[0].assigned_user_id,
            sellerA,
          );
        },
      );
      await t.test(
        'personal send stays closed before the E08 transport capability, without message or outbox',
        async () => {
          const counts = async () =>
            (
              await pool.query(
                `SELECT
          (SELECT count(*) FROM crm.messages WHERE conversation_id=$1) messages,
          (SELECT count(*) FROM crm.outbox_jobs job JOIN crm.messages message ON message.id=job.message_id WHERE message.conversation_id=$1) jobs`,
                [own.id],
              )
            ).rows[0];
          const before = await counts();
          await assert.rejects(
            mutations.sendHumanMessage({
              ...command,
              messageType: 'text',
              content: { text: 'Synthetic personal send' },
            }),
            { code: 'WHATSAPP_SEND_UNAVAILABLE', statusCode: 503 },
          );
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        'revocation invalidates mutations and idempotent replay; other portfolio stays isolated',
        async () => {
          const result = await mutations.transitionConversation(command);
          assert.equal(result.version, 2);
          assert.equal(
            (await mutations.transitionConversation(command)).id,
            own.id,
          );
          await pool.query(
            "UPDATE crm.seller_client_links SET status='revoked',revoked_at=now(),updated_at=now(),version=version+1 WHERE seller_id=$1 AND contact_id=$2",
            [sellerA, own.contactId],
          );
          await assert.rejects(mutations.transitionConversation(command), {
            code: 'INBOX_FORBIDDEN',
          });
          await assert.rejects(
            operations.listInbox(
              {
                limit: 1,
                assignedUserId: sellerA,
                cursor: cursorPage.nextCursor,
              },
              { actorId: sellerA, capabilities: [] },
            ),
            { code: 'INVALID_CURSOR' },
          );
          await denyBothMedia();
          // Commercial visibility survives: A still sells this order.
          await commercialWithoutChat();
          currentActor = actor(stranger);
          await commercialWithoutChat(false);
          currentActor = actor(sellerA);
          await assert.rejects(inbox.get(own.id, reader(sellerA)), {
            code: 'CONVERSATION_NOT_FOUND',
          });
          await assert.rejects(subjects.list(own.id, '', actor(sellerA)), {
            statusCode: 403,
          });
          await assert.rejects(
            assistance.list({ conversationId: own.id, actor: actor(sellerA) }),
            { statusCode: 403 },
          );
          assert.equal(
            (await inbox.get(other.id, reader(sellerB))).conversation.id,
            other.id,
          );
        },
      );
      await t.test(
        'reminder replay and Central projections cannot reopen revoked personal scope',
        async () => {
          await assert.rejects(reminders.set(reminderInput), {
            statusCode: 403,
            code: 'FORBIDDEN',
          });
          await pool.query(
            'UPDATE crm.conversations SET archived_at=NULL,terminal_at=NULL WHERE id=$1',
            [own.id],
          );
          const dashboard = createDashboardRuntime(database, {
            access: {},
            orderEnvelopeKey: key,
            idempotencyEnvelopeKey: key,
          });
          const actions = await dashboard.actions({ actor: actor(sellerA) });
          assert.equal(
            actions.items.some(
              (/** @type {any} */ item) =>
                item.targetType === 'conversation' && item.targetId === own.id,
            ),
            false,
          );
          const commercial = actions.items.find(
            (/** @type {any} */ item) =>
              item.targetType === 'order' && item.targetId === order.id,
          );
          assert.ok(commercial, 'commercial action remains accessible');
          assert.equal(commercial.conversationId, null);
          await assert.rejects(
            dashboard.decide({
              actor: actor(sellerA),
              actionId: `conversation:${own.id}`,
              decision: 'schedule',
              expectedVersion: 2,
              sourceRevision: 'synthetic',
              expectedDecisionVersion: 0,
              remindAt: new Date(Date.now() + 3600000).toISOString(),
              idempotencyKey: 'synthetic-revoked-action',
              correlationId: 'synthetic-action',
            }),
            { statusCode: 403, code: 'FORBIDDEN' },
          );
        },
      );
      await t.test(
        'an active-user check revalidates stale administrator claims before any projection',
        async () => {
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [admin],
          );
          await assert.rejects(
            database.transaction((/** @type {any} */ tx) =>
              lockConversationAccess(tx, other.id, admin),
            ),
            { code: 'FORBIDDEN' },
          );
        },
      );
    } finally {
      await pool.end();
    }
  },
);
