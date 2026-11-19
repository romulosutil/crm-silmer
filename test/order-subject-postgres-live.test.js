import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createOrderApiRuntime } from '../apps/api/src/order-runtime.js';
import { createApi } from '../apps/api/src/app.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { briefingToFicha } from '../modules/orders/src/domain/ficha.js';
import { encryptJson } from '../modules/orders/src/adapters/envelope.js';
import { syntheticItems, syntheticArtwork } from './fixtures/order-items.js';
import { fixturePricing } from './fixtures/size-pricing.js';
import { createSubjectService } from '../modules/inbox-channels/src/application/subject-service.js';
import { InMemoryObjectStorage } from '../modules/orders/src/adapters/in-memory-order-files.js';
import {
  contactPhoneHash,
  normalizeContactPhone,
} from '../modules/contacts/src/domain/contact-details.js';

const url = process.env.TEST_DATABASE_URL;
const KEY = Buffer.alloc(32, 57);
const NOW = new Date('2026-11-17T12:00:00.000Z');
const seller = {
  id: 'subject-seller',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
};
const environment = {
  FAB_CODE: '01',
  N8N_INTEGRATION_ENVELOPE_KEY: KEY.toString('base64'),
  CONTACT_IDENTITY_ENVELOPE_KEY: KEY.toString('base64'),
  CONTACT_IDENTITY_LOOKUP_KEY: KEY.toString('base64'),
  IDEMPOTENCY_ENVELOPE_KEY: KEY.toString('base64'),
  ORDER_SUBJECT_CREATION_ENABLED: 'true',
  ORDER_SUBJECT_READERS_READY: 'true',
  ORDER_SUBJECT_SELLER_IDS: seller.id,
};

if (!url)
  test(
    'WAP-E05 requires dedicated PostgreSQL TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
else {
  assert.match(new URL(url).pathname, /^\/crm_silmer_test(?:_[a-z0-9]+)?$/u);
  test('WAP-E05: upgrade, compatible readers and atomic subject creation', async (t) => {
    const pool = new Pool({ connectionString: url, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const repository = new PostgresOrderRepository({
      database,
      envelopeKey: KEY,
    });
    const access = {
      authorizeRead: async () => ({ actor: seller }),
      authorizeWrite: async () => ({ actor: seller }),
    };
    const runtime = (overrides = {}) =>
      createOrderApiRuntime(database, {
        access,
        environment: { ...environment, ...overrides },
      });
    const migrations = await loadMigrations();
    /** @param {string} id @param {string} [contactId] */
    async function conversation(id, contactId = `contact-${id}`) {
      await pool.query(
        `INSERT INTO crm.contacts(id,display_name,display_name_source,contact_phone_hash,provisional,version,created_at,updated_at)
        VALUES($1,'Cliente Sintético','manual',$2,false,1,$3,$3) ON CONFLICT(id) DO NOTHING`,
        [contactId, randomUUID().replaceAll('-', '').padEnd(64, '0'), NOW],
      );
      const encrypted = JSON.stringify(
        encryptJson({}, 'synthetic-identity', KEY),
      );
      await pool.query(
        `INSERT INTO crm.contact_identities(id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,key_version,version,created_at,updated_at)
        VALUES($1,$2,'meta','subject-account','whatsapp',$3,'phone','confirmed',$4::jsonb,1,1,$5,$5)`,
        [
          `identity-${id}`,
          contactId,
          randomUUID().replaceAll('-', '').padEnd(64, '1'),
          encrypted,
          NOW,
        ],
      );
      await pool.query(
        `INSERT INTO crm.conversations(id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,state,automation_state,automation_epoch,assigned_user_id,version,opened_at,last_message_at)
        VALUES($1,$2,'meta','subject-account',$1,1,'em_atendimento','human',0,$3,1,$4,$4)`,
        [id, `identity-${id}`, seller.id, NOW],
      );
      return contactId;
    }
    /** @param {string} id @param {string} conv @param {string|null} [orderId] */
    async function subject(id, conv, orderId = null) {
      await pool.query(
        `INSERT INTO crm.conversation_subjects(id,conversation_id,contact_id,order_id,kind,position,is_current,created_by,created_by_kind,created_at,updated_at)
        SELECT $1,$2,identity.current_contact_id,$3,CASE WHEN $3::text IS NULL THEN 'geral' ELSE 'pedido' END,
          (SELECT COALESCE(max(position),0)+1 FROM crm.conversation_subjects WHERE conversation_id=$2),false,$4,'human',$5,$5
        FROM crm.contact_identities identity JOIN crm.conversations c ON c.contact_identity_id=identity.id WHERE c.id=$2`,
        [id, conv, orderId, seller.id, NOW],
      );
    }
    /** @param {string} id @param {string} conv */
    async function draftBeforeUpgrade(id, conv) {
      // Before 0080 this legacy INSERT deliberately names no origin column.
      const ficha = JSON.stringify(
        encryptJson(briefingToFicha(null), `order-ficha:${id}`, KEY),
      );
      await pool.query(
        `INSERT INTO crm.orders(id,number_sequence,number,conversation_id,contact_id,status,fab_code,ficha_version,ficha_envelope,total_pieces,missing_fields,created_by_kind,created_by,first_contact_at,version,created_at,updated_at)
        SELECT $1,nextval('crm.order_number_seq'),lpad(currval('crm.order_number_seq')::text,2,'0') || '-CRM',$2,identity.current_contact_id,'pendente','01',1,$3::jsonb,0,ARRAY['items'],'user',$4,$5,1,$5,$5
        FROM crm.conversations c JOIN crm.contact_identities identity ON identity.id=c.contact_identity_id WHERE c.id=$2`,
        [id, conv, ficha, seller.id, NOW],
      );
    }
    /** WAP-E03: puts a conversation on the owner's personal line and wallet.
     * @param {string} owner @param {string} conv @param {string} contact */
    async function personalLine(owner, conv, contact) {
      const id = randomUUID(),
        digest = randomUUID().replaceAll('-', '').padEnd(64, 'f');
      // One line per seller: a later conversation reuses the owner's line.
      const existing = (
        await pool.query(
          'SELECT account_id FROM crm.seller_whatsapp_lines WHERE seller_id=$1',
          [owner],
        )
      ).rows[0];
      const account = existing ? String(existing.account_id) : randomUUID();
      await database.transaction(async (/** @type {any} */ tx) => {
        if (!existing)
          await tx.query(
            `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,'disconnected',1,1,$7,$7)`,
            [
              id,
              owner,
              account,
              `wap_${randomUUID().replaceAll('-', '')}`,
              digest,
              JSON.stringify(
                encryptJson(
                  { number: '5511990000000' },
                  'synthetic-number',
                  KEY,
                ),
              ),
              NOW,
            ],
          );
        if (!existing)
          await tx.query(
            "INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at) VALUES($1,'personal',$2,$3)",
            [digest, id, NOW],
          );
        await tx.query(
          'UPDATE crm.contact_identities SET provider_account_id=$2 WHERE id=$1',
          [`identity-${conv}`, account],
        );
        await tx.query(
          'UPDATE crm.conversations SET provider_account_id=$2,assigned_user_id=$3 WHERE id=$1',
          [conv, account, owner],
        );
        await tx.query(
          `INSERT INTO crm.seller_client_links(id,seller_id,contact_id,provenance,status,version,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,'explicit_link','active',1,$2,$2,$4,$4)`,
          [randomUUID(), owner, contact, NOW],
        );
      });
    }
    /** @param {string} conv @param {string|undefined} [target] @param {string} [key] @param {number} [version] */
    function command(conv, target, key = randomUUID(), version = 1) {
      return {
        actor: seller,
        conversationId: conv,
        expectedVersion: 1,
        correlationId: randomUUID(),
        idempotencyKey: key,
        ...(target
          ? { subjectId: target, expectedSubjectVersion: version }
          : {}),
      };
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, {
        migrations: migrations.filter(({ version }) => version < '0080'),
      });
      await pool.query(
        `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,'subject-seller@example.test','$argon2id$synthetic','Vendedor Sintético')`,
        [seller.id],
      );
      await pool.query(
        `INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')`,
        [seller.id],
      );
      await conversation('upgrade');
      await draftBeforeUpgrade('upgrade-order', 'upgrade');
      await subject('upgrade-subject', 'upgrade', 'upgrade-order');
      await conversation('confirmed');
      await draftBeforeUpgrade('confirmed-order', 'confirmed');
      await subject('confirmed-subject', 'confirmed', 'confirmed-order');
      await pool.query(
        `UPDATE crm.orders SET status='confirmado',final_amount_cents=100,payment_condition='pix',confirmed_at=$1,confirmed_by=$2,order_date='2026-11-17' WHERE id='confirmed-order'`,
        [NOW, seller.id],
      );
      const confirmed = (
        await pool.query(
          "SELECT to_jsonb(o) AS data FROM crm.orders o WHERE id='confirmed-order'",
        )
      ).rows[0].data;
      await conversation('cancelled');
      await draftBeforeUpgrade('cancelled-order', 'cancelled');
      await subject('cancelled-subject', 'cancelled', 'cancelled-order');
      await pool.query(
        `UPDATE crm.orders SET cancelled_at=$2,cancelled_by=$3,cancellation_reason_envelope=$4::jsonb,version=version+1,updated_at=$2 WHERE id=$1`,
        [
          'cancelled-order',
          NOW,
          seller.id,
          JSON.stringify(
            encryptJson(
              'Motivo sintético',
              'order-cancellation:cancelled-order',
              KEY,
            ),
          ),
        ],
      );
      const cancelled = (
        await pool.query(
          "SELECT to_jsonb(o) AS data FROM crm.orders o WHERE id='cancelled-order'",
        )
      ).rows[0].data;
      await conversation('ambiguous');
      await conversation('other-cycle', 'contact-ambiguous');
      await draftBeforeUpgrade('ambiguous-order', 'ambiguous');
      await subject('ambiguous-subject', 'ambiguous', 'ambiguous-order');
      await subject('other-cycle-subject', 'other-cycle', 'ambiguous-order');
      await t.test(
        '0080 is additive, proves unique backfill and preserves immutable history',
        async () => {
          await migrate(pool, { migrations });
          const rows = (
            await pool.query(
              'SELECT id,origin_subject_id FROM crm.orders ORDER BY id',
            )
          ).rows;
          assert.deepEqual(rows, [
            { id: 'ambiguous-order', origin_subject_id: null },
            { id: 'cancelled-order', origin_subject_id: null },
            { id: 'confirmed-order', origin_subject_id: null },
            { id: 'upgrade-order', origin_subject_id: 'upgrade-subject' },
          ]);
          assert.deepEqual(
            (
              await pool.query(
                "SELECT to_jsonb(o)-'origin_subject_id' AS data FROM crm.orders o WHERE id='cancelled-order'",
              )
            ).rows[0].data,
            cancelled,
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT to_jsonb(o)-'origin_subject_id' AS data FROM crm.orders o WHERE id='confirmed-order'",
              )
            ).rows[0].data,
            confirmed,
          );
          assert.ok(
            (
              await pool.query(
                "SELECT to_regclass('crm.orders_one_pending_per_conversation') AS id",
              )
            ).rows[0].id,
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.orders SET origin_subject_id='missing' WHERE id='ambiguous-order'",
            ),
            { code: '23503' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.orders SET origin_subject_id='other-cycle-subject' WHERE id='ambiguous-order'",
            ),
            { code: '23503' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.orders SET origin_subject_id='upgrade-subject' WHERE id='ambiguous-order'",
            ),
            { code: '23503' },
          );
        },
      );
      await conversation('targets');
      await subject('target-a', 'targets');
      await subject('target-b', 'targets');
      await t.test(
        'default off, allowlist and readers/schema readiness fail closed',
        async () => {
          for (const overrides of [
            { ORDER_SUBJECT_CREATION_ENABLED: 'false' },
            { ORDER_SUBJECT_READERS_READY: 'false' },
            { ORDER_SUBJECT_SELLER_IDS: '' },
            {},
          ])
            await assert.rejects(
              runtime(overrides).createManual(command('targets', 'target-a')),
              { code: 'ORDER_SUBJECT_UNAVAILABLE' },
            );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.orders WHERE conversation_id='targets'",
              )
            ).rows[0].n,
            0,
          );
          await migrate(pool, {
            migrations: migrations.filter(({ version }) => version === '0081'),
            phase: 'contract',
          });
          assert.equal(
            (
              await pool.query(
                "SELECT to_regclass('crm.orders_one_pending_per_conversation') AS id",
              )
            ).rows[0].id,
            null,
          );
        },
      );
      await pool.query(
        `INSERT INTO crm.subject_briefings(subject_id,version,envelope,updated_at) VALUES($1,1,$2::jsonb,$3)`,
        [
          'target-a',
          JSON.stringify(
            encryptJson(
              { order_name: 'Alvo A' },
              'n8n-subject-briefing:target-a:1',
              KEY,
            ),
          ),
          NOW,
        ],
      );
      await pool.query(
        `UPDATE crm.conversations SET briefing_version=1,briefing_updated_at=now(),briefing_envelope=$2::jsonb WHERE id=$1`,
        [
          'targets',
          JSON.stringify(
            encryptJson(
              { order_name: 'Outro Assunto' },
              'n8n-briefing:targets:1',
              KEY,
            ),
          ),
        ],
      );
      /** @type {any} */
      let first;
      await t.test(
        'two keys win once, persist reciprocal origin and use only target briefing',
        async () => {
          const result = await Promise.allSettled([
            runtime().createManual(command('targets', 'target-a')),
            runtime().createManual(command('targets', 'target-a')),
          ]);
          const winner = result.find((r) => r.status === 'fulfilled');
          assert.ok(winner && winner.status === 'fulfilled');
          const loser = result.find((r) => r.status === 'rejected');
          assert.ok(loser && loser.status === 'rejected');
          assert.equal(loser.reason.code, 'VERSION_CONFLICT');
          first = winner.value.order;
          assert.equal(
            (
              await runtime().createManual(
                command('targets', 'target-a', randomUUID(), 2),
              )
            ).order.id,
            first.id,
          );
          assert.equal(first.ficha.summary.nome, 'Alvo A');
          assert.equal(first.firstContactAt, NOW.toISOString());
          const row = (
            await pool.query(
              `SELECT orders.origin_subject_id,subject.order_id FROM crm.orders orders JOIN crm.conversation_subjects subject ON subject.id=orders.origin_subject_id WHERE orders.id=$1`,
              [first.id],
            )
          ).rows[0];
          assert.deepEqual(row, {
            origin_subject_id: 'target-a',
            order_id: first.id,
          });
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.domain_events WHERE event_type='order.created' AND payload->>'conversationId'='targets'",
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        'new target creates another draft; omission and legacy projection refuse ambiguity',
        async () => {
          const second = await runtime().createManual(
            command('targets', 'target-b'),
          );
          assert.notEqual(second.order.id, first.id);
          assert.notEqual(second.order.number, first.number);
          assert.notEqual(second.order.ficha.summary.nome, 'Outro Assunto');
          await assert.rejects(
            repository.findPendingByConversation('targets'),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          await assert.rejects(runtime().createManual(command('targets')), {
            code: 'ORDER_TARGET_REQUIRED',
          });
          await assert.rejects(
            runtime().currentForConversation('targets', seller),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          await assert.rejects(
            runtime().projectAgentBriefing({
              conversationId: 'targets',
              correlationId: randomUUID(),
              briefing: { order_name: 'wrong' },
              automationState: 'assistant',
            }),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          assert.equal(
            (await runtime().list({}, seller)).items.filter(
              (/** @type {any} */ o) => o.conversationId === 'targets',
            ).length,
            2,
          );
          await assert.rejects(
            pool.query(
              `INSERT INTO crm.orders(id,number_sequence,number,conversation_id,origin_subject_id,contact_id,status,fab_code,ficha_version,ficha_envelope,total_pieces,missing_fields,created_by_kind,created_by,first_contact_at,version,created_at,updated_at)
            SELECT $2,nextval('crm.order_number_seq'),lpad(currval('crm.order_number_seq')::text,2,'0') || '-CRM',conversation_id,origin_subject_id,contact_id,'pendente',fab_code,1,ficha_envelope,0,missing_fields,'user',created_by,first_contact_at,1,created_at,updated_at FROM crm.orders WHERE id=$1`,
              [first.id, randomUUID()],
            ),
            { code: '23505', constraint: 'orders_one_pending_per_subject' },
          );
          await assert.rejects(
            pool.query(
              'UPDATE crm.orders SET conversation_id=NULL WHERE id=$1',
              [first.id],
            ),
            { code: '23514' },
          );
        },
      );
      await t.test(
        'CAS, crossed subject, historical subject, open human attendance and replay authority',
        async () => {
          await assert.rejects(
            runtime().createManual(
              command('targets', 'target-a', randomUUID(), 1),
            ),
            { code: 'VERSION_CONFLICT' },
          );
          await assert.rejects(
            runtime().createManual(command('targets', 'upgrade-subject')),
            { code: 'SUBJECT_NOT_FOUND' },
          );
          await assert.rejects(
            runtime().createManual({
              ...command('targets', 'target-a', randomUUID(), 2),
              expectedVersion: 999,
            }),
            { code: 'VERSION_CONFLICT' },
          );
          const key = randomUUID(),
            input = command('targets', 'target-a', key, 2);
          assert.equal(
            (await runtime().createManual(input)).order.id,
            first.id,
          );
          assert.equal(
            (await runtime().createManual(input)).order.id,
            first.id,
          );
          await assert.rejects(
            runtime().createManual({ ...input, subjectId: 'target-b' }),
            { code: 'IDEMPOTENCY_KEY_REUSED' },
          );
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [seller.id],
          );
          await assert.rejects(runtime().createManual(input), {
            code: 'FORBIDDEN',
          });
          await pool.query(
            'UPDATE crm.users SET disabled_at=NULL WHERE id=$1',
            [seller.id],
          );
          await pool.query(
            "UPDATE crm.conversations SET automation_state='assistant' WHERE id='targets'",
          );
          await assert.rejects(runtime().createManual(input), {
            code: 'ORDER_HUMAN_REQUIRED',
          });
          await pool.query(
            "UPDATE crm.conversations SET automation_state='human',terminal_at=now(),state='sem_lead' WHERE id='targets'",
          );
          await assert.rejects(runtime().createManual(input), {
            code: 'CONVERSATION_CLOSED',
          });
          await pool.query(
            "UPDATE crm.conversations SET terminal_at=NULL,state='em_atendimento' WHERE id='targets'",
          );
        },
      );
      await t.test(
        'audit failure rolls back order, link, event and idempotent receipt',
        async () => {
          await conversation('rollback');
          await subject('rollback-subject', 'rollback');
          const before = (
            await pool.query(
              'SELECT count(*)::int AS n FROM crm.idempotency_records',
            )
          ).rows[0].n;
          await pool.query(`CREATE FUNCTION crm.wap_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id='rollback' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER wap_test_audit_failure BEFORE INSERT ON crm.audit_events FOR EACH ROW EXECUTE FUNCTION crm.wap_test_audit_failure()`);
          await assert.rejects(
            runtime().createManual(command('rollback', 'rollback-subject')),
            /synthetic audit failure/u,
          );
          await pool.query(
            'DROP TRIGGER wap_test_audit_failure ON crm.audit_events; DROP FUNCTION crm.wap_test_audit_failure()',
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.orders WHERE conversation_id='rollback'",
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT order_id FROM crm.conversation_subjects WHERE id='rollback-subject'",
              )
            ).rows[0].order_id,
            null,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.idempotency_records',
              )
            ).rows[0].n,
            before,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.domain_events WHERE payload->>'conversationId'='rollback'",
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test(
        'compatible rollback reads multiple origins with creation off; cancellation retains origin',
        async () => {
          const off = runtime({ ORDER_SUBJECT_CREATION_ENABLED: 'false' });
          assert.equal((await off.get(first.id, seller)).order.id, first.id);
          assert.equal(
            (await off.list({}, seller)).items.filter(
              (/** @type {any} */ o) => o.conversationId === 'targets',
            ).length,
            2,
          );
          const cancelled = await runtime().cancel({
            actor: seller,
            orderId: first.id,
            expectedVersion: first.version,
            reason: 'Cancelamento sintético',
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          });
          assert.ok(cancelled);
          assert.equal(
            (await repository.findById(first.id))?.originSubjectId,
            'target-a',
          );
          await assert.rejects(
            runtime().createManual(
              command('targets', 'target-a', randomUUID(), 2),
            ),
            { code: 'ORDER_STATUS_CONFLICT' },
          );
        },
      );
      await t.test(
        'HTTP strictly validates paired target and includes target in fingerprint',
        async () => {
          const api = createApi({}, { orders: runtime() });
          try {
            for (const payload of [
              { expectedVersion: 1, subjectId: 'target-a' },
              { expectedVersion: 1, expectedSubjectVersion: 2 },
              {
                expectedVersion: 1,
                subjectId: null,
                expectedSubjectVersion: 2,
              },
              {
                expectedVersion: 1,
                subjectId: 'target-a',
                expectedSubjectVersion: 0,
              },
            ]) {
              const response = await api.inject({
                method: 'POST',
                url: '/api/v1/conversations/targets/orders',
                headers: { 'idempotency-key': randomUUID() },
                payload,
              });
              assert.equal(response.statusCode, 400, response.body);
            }
          } finally {
            await api.close();
          }
        },
      );
      await t.test(
        'legacy draft cannot coexist with unresolved explicit target',
        async () => {
          await assert.rejects(
            runtime().createManual(command('ambiguous', 'ambiguous-subject')),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          await conversation('legacy');
          // A genuine legacy draft: written while targeted creation was off.
          const legacy = await runtime({
            ORDER_SUBJECT_CREATION_ENABLED: 'false',
          }).createManual(command('legacy'));
          await assert.rejects(draftBeforeUpgrade(randomUUID(), 'legacy'), {
            code: '23505',
            constraint: 'orders_one_pending_per_legacy_conversation',
          });
          // With targeting on and zero Subjects the legacy draft is reused,
          // never wrapped in an inferred Subject.
          const reused = await runtime().createManual(command('legacy'));
          assert.equal(reused.created, false);
          assert.equal(reused.order.id, legacy.order.id);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.conversation_subjects WHERE conversation_id='legacy'",
              )
            ).rows[0].n,
            0,
          );
          await subject('legacy-new-subject', 'legacy');
          await assert.rejects(
            runtime().createManual(command('legacy', 'legacy-new-subject')),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          // P2-1: the explicit resolution (a Subject naming the legacy draft)
          // opens the second order on the new Subject.
          await createSubjectService(database).create({
            actor: seller,
            conversationId: 'legacy',
            orderId: legacy.order.id,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          const next = await runtime().createManual(
            command('legacy', 'legacy-new-subject'),
          );
          assert.equal(next.created, true);
          assert.notEqual(next.order.id, legacy.order.id);
          assert.equal(next.order.originSubjectId, 'legacy-new-subject');
        },
      );
      await t.test(
        'subject context keeps current name without copying another briefing',
        async () => {
          const port = new PostgresOrderConversationPort({
            database,
            envelopeKey: KEY,
            contactEnvelopeKey: KEY,
            contactLookupKey: KEY,
          });
          const service = createOrderService({
            repository,
            conversations: port,
            fabCode: '01',
            authorizeOwnership: async () => {},
          });
          const order = (await repository.listByConversation('targets')).find(
            (o) => !o.cancelledAt,
          );
          assert.ok(order);
          await pool.query(
            "UPDATE crm.contacts SET display_name='Nome Atual' WHERE id='contact-targets'",
          );
          assert.equal(
            (await service.get(order.id)).ficha.summary.cliente,
            'Nome Atual',
          );
        },
      );
      await t.test(
        'confirmation/reopening preserves origin, snapshots and independent target uniqueness',
        async () => {
          await conversation('reopen');
          await subject('reopen-a', 'reopen');
          const draft = await runtime().createManual(
            command('reopen', 'reopen-a'),
          );
          const raw = await repository.findById(draft.order.id);
          assert.ok(raw);
          const ficha = fixturePricing(
            {
              ...raw.ficha,
              items: syntheticItems(),
              artwork: syntheticArtwork(),
              summary: {
                ...raw.ficha.summary,
                data_entrega_confirmada: '2026-12-17',
              },
            },
            3200,
          );
          const prepared = await repository.saveSection(
            {
              ...raw,
              ficha,
              totalPieces: 32,
              missingFields: [],
              finalAmountCents: 3200,
            },
            {
              actor: seller,
              expectedVersion: raw.version,
              correlationId: randomUUID(),
            },
          );
          const confirmed = await runtime().confirm({
            actor: seller,
            orderId: raw.id,
            expectedVersion: prepared.version,
            paymentCondition: 'pix',
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          });
          assert.equal(confirmed.status, 'confirmado');
          await pool.query(
            "UPDATE crm.contacts SET display_name='Nome após confirmação' WHERE id='contact-reopen'",
          );
          assert.equal(
            (await runtime().get(raw.id, seller)).order.ficha.summary.cliente,
            confirmed.ficha.summary.cliente,
          );
          await assert.rejects(
            runtime().createManual(
              command('reopen', 'reopen-a', randomUUID(), 2),
            ),
            { code: 'ORDER_STATUS_CONFLICT' },
          );
          await subject('reopen-b', 'reopen');
          const second = await runtime().createManual(
            command('reopen', 'reopen-b'),
          );
          const opened = await runtime().reopen({
            actor: seller,
            orderId: raw.id,
            expectedVersion: confirmed.version,
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          });
          assert.equal(opened.number, confirmed.number);
          assert.equal(opened.status, 'pendente');
          assert.equal(
            (await repository.findById(raw.id))?.originSubjectId,
            'reopen-a',
          );
          assert.notEqual(second.order.id, opened.id);
          // Direct constraints protect callers even outside the human service.
          await assert.rejects(
            pool.query(
              'UPDATE crm.orders SET origin_subject_id=$2 WHERE id=$1',
              [raw.id, 'reopen-b'],
            ),
            { code: '23514' },
          );
          await assert.rejects(
            pool.query(
              "UPDATE crm.conversation_subjects SET order_id=NULL,kind='geral' WHERE id='reopen-a'",
            ),
            { code: '23503' },
          );
          // A historical legacy origin may not be reopened alongside an explicit target.
          await conversation('legacy-reopen');
          const legacy = await runtime({
            ORDER_SUBJECT_CREATION_ENABLED: 'false',
          }).createManual(command('legacy-reopen'));
          const legacyRaw = await repository.findById(legacy.order.id);
          assert.ok(legacyRaw);
          const frozen = await repository.saveStatus(
            {
              ...legacyRaw,
              status: 'confirmado',
              finalAmountCents: 100,
              paymentCondition: 'pix',
              orderDate: '2026-11-17',
              confirmedAt: NOW.toISOString(),
              confirmedBy: seller.id,
            },
            {
              actor: seller,
              expectedVersion: legacyRaw.version,
              correlationId: randomUUID(),
            },
          );
          await subject('legacy-reopen-new', 'legacy-reopen');
          const target = await runtime().createManual(
            command('legacy-reopen', 'legacy-reopen-new'),
          );
          await assert.rejects(
            runtime().reopen({
              actor: seller,
              orderId: frozen.id,
              expectedVersion: frozen.version,
              correlationId: randomUUID(),
              idempotencyKey: randomUUID(),
            }),
            { code: 'ORDER_PENDING_EXISTS' },
          );
          const targetRaw = await repository.findById(target.order.id);
          assert.ok(targetRaw);
          const targetFrozen = await repository.saveStatus(
            {
              ...targetRaw,
              status: 'confirmado',
              finalAmountCents: 100,
              paymentCondition: 'pix',
              orderDate: '2026-11-17',
              confirmedAt: NOW.toISOString(),
              confirmedBy: seller.id,
            },
            {
              actor: seller,
              expectedVersion: targetRaw.version,
              correlationId: randomUUID(),
            },
          );
          await runtime().reopen({
            actor: seller,
            orderId: frozen.id,
            expectedVersion: frozen.version,
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          });
          await assert.rejects(
            runtime().reopen({
              actor: seller,
              orderId: targetFrozen.id,
              expectedVersion: targetFrozen.version,
              correlationId: randomUUID(),
              idempotencyKey: randomUUID(),
            }),
            { code: 'ORDER_PENDING_EXISTS' },
          );
        },
      );
      await t.test(
        'unique legacy subject adoption preserves a customer named only by briefing',
        async () => {
          await conversation('name-legacy');
          await pool.query(
            "UPDATE crm.contacts SET display_name=NULL WHERE id='contact-name-legacy'",
          );
          await pool.query(
            `UPDATE crm.conversations SET briefing_version=1,briefing_updated_at=now(),briefing_envelope=$2::jsonb WHERE id=$1`,
            [
              'name-legacy',
              JSON.stringify(
                encryptJson(
                  { customer_name: 'Nome da pré-ficha' },
                  'n8n-briefing:name-legacy:1',
                  KEY,
                ),
              ),
            ],
          );
          const created = await runtime({
            ORDER_SUBJECT_CREATION_ENABLED: 'false',
          }).createManual(command('name-legacy'));
          const linked = await createSubjectService(database).create({
            actor: seller,
            conversationId: 'name-legacy',
            orderId: created.order.id,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(
            (await repository.findById(created.order.id))?.originSubjectId,
            linked.subject.id,
          );
          assert.equal(
            (await runtime().get(created.order.id, seller)).order.ficha.summary
              .cliente,
            'Nome da pré-ficha',
          );
        },
      );
      await t.test(
        'personal offline creation isolates shared Contact, Admin responsibility and concurrent revocation',
        async () => {
          const other = { ...seller, id: 'subject-other' };
          await pool.query(
            `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,'subject-other@example.test','$argon2id$synthetic','Outro Sintético')`,
            [other.id],
          );
          await pool.query(
            "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
            [other.id],
          );
          const contact = await conversation('personal');
          await conversation('personal-other', contact);
          /** @param {string} owner @param {string} conv */
          const line = (owner, conv) => personalLine(owner, conv, contact);
          await line(seller.id, 'personal');
          await line(other.id, 'personal-other');
          await subject('personal-a', 'personal');
          await subject('personal-b', 'personal');
          const key = randomUUID(),
            input = command('personal', 'personal-a', key);
          await assert.rejects(
            runtime({ ORDER_SUBJECT_CREATION_ENABLED: 'false' }).createManual(
              input,
            ),
            { code: 'ORDER_SUBJECT_UNAVAILABLE' },
          );
          // A legacy body on a personal line is still a targeted creation.
          await assert.rejects(
            runtime({ ORDER_SUBJECT_CREATION_ENABLED: 'false' }).createManual(
              command('personal'),
            ),
            { code: 'ORDER_SUBJECT_UNAVAILABLE' },
          );
          const first = await runtime().createManual(input);
          assert.equal(first.order.seller.id, seller.id);
          assert.equal(first.order.contactId, contact);
          await assert.rejects(
            runtime().createManual({
              ...input,
              actor: other,
              idempotencyKey: randomUUID(),
            }),
            { code: 'FORBIDDEN' },
          );
          const hidden = await runtime().get(first.order.id, other);
          assert.equal(hidden.order.conversationId, null);
          assert.equal(hidden.order.originSubjectId, null);
          // Explicit administration retains the actual line owner's responsibility.
          await pool.query(
            "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
            [other.id],
          );
          const admin = await runtime().createManual({
            ...command('personal', 'personal-b'),
            actor: other,
          });
          assert.equal(admin.order.seller.id, seller.id);
          const blocker = await pool.connect();
          try {
            await blocker.query('BEGIN');
            await blocker.query(
              'SELECT id FROM crm.users WHERE id=$1 FOR UPDATE',
              [seller.id],
            );
            await blocker.query(
              'SELECT id FROM crm.contacts WHERE id=$1 FOR UPDATE',
              [contact],
            );
            await blocker.query(
              "UPDATE crm.seller_client_links SET status='revoked',revoked_at=now(),version=version+1 WHERE seller_id=$1 AND contact_id=$2",
              [seller.id, contact],
            );
            const pending = runtime().createManual(input);
            const rejected = assert.rejects(pending, { code: 'FORBIDDEN' });
            const blockerPid = (
              await blocker.query('SELECT pg_backend_pid() AS pid')
            ).rows[0].pid;
            let blocked = false;
            for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
              blocked =
                (
                  await pool.query(
                    'SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
                    [blockerPid],
                  )
                ).rows.length > 0;
              if (!blocked)
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            assert.ok(blocked, 'creation must wait for the revocation lock');
            await blocker.query('COMMIT');
            await rejected;
          } finally {
            await blocker.query('ROLLBACK');
            blocker.release();
          }
          await assert.rejects(
            runtime().createManual({
              ...command('personal', 'personal-b', randomUUID(), 2),
              actor: other,
            }),
            { code: 'FORBIDDEN' },
          );
          // Commercial visibility stays independent; revoking chat never rewrites it.
          // WAP-07/08 (Tech Lead, 18/11/2026): the order's own seller keeps it.
          assert.equal(
            (await runtime().get(first.order.id, seller)).order.id,
            first.order.id,
          );
          assert.equal(
            (await runtime().get(first.order.id, other)).order.id,
            first.order.id,
          );
          // A seller who never owned it and has no wallet link does not.
          const stranger = { ...seller, id: 'subject-stranger' };
          await pool.query(
            `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,'subject-stranger@example.test','$argon2id$synthetic','Estranho Sintético')`,
            [stranger.id],
          );
          await pool.query(
            "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
            [stranger.id],
          );
          await assert.rejects(runtime().get(first.order.id, stranger), {
            code: 'ORDER_NOT_FOUND',
          });
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.orders WHERE conversation_id=$1',
                ['personal'],
              )
            ).rows[0].n,
            2,
          );
        },
      );
      await t.test(
        'WAP-E11: general line keeps legacy creation while targeted creation is off',
        async () => {
          const offSettings = [
            {
              ORDER_SUBJECT_CREATION_ENABLED: 'false',
              ORDER_SUBJECT_READERS_READY: 'false',
              ORDER_SUBJECT_SELLER_IDS: '',
            },
            { ORDER_SUBJECT_SELLER_IDS: 'someone-else' },
          ];
          /** @param {string} id */
          const legacyRows = async (id) =>
            (
              await pool.query(
                `SELECT id,origin_subject_id,status FROM crm.orders
                 WHERE conversation_id=$1 AND cancelled_at IS NULL ORDER BY number_sequence`,
                [id],
              )
            ).rows;
          /** @param {string} id */
          const confirmDraft = (id) =>
            pool.query(
              `UPDATE crm.orders SET status='confirmado',final_amount_cents=100,payment_condition='pix',confirmed_at=$2,confirmed_by=$3,order_date='2026-11-17' WHERE id=$1`,
              [id, NOW, seller.id],
            );
          for (const [index, overrides] of offSettings.entries()) {
            const off = runtime(overrides);
            // 1. A manual "geral" Subject without order does not block the line.
            const geral = `general-geral-${index}`;
            await conversation(geral);
            await subject(`${geral}-s`, geral);
            await assert.rejects(
              off.createManual(command(geral, `${geral}-s`)),
              { code: 'ORDER_SUBJECT_UNAVAILABLE' },
            );
            const key = randomUUID();
            const created = await off.createManual(
              command(geral, undefined, key),
            );
            assert.equal(created.created, true);
            assert.equal(created.order.status, 'pendente');
            assert.deepEqual(await legacyRows(geral), [
              {
                id: created.order.id,
                origin_subject_id: null,
                status: 'pendente',
              },
            ]);
            assert.equal(
              (
                await pool.query(
                  'SELECT order_id,version FROM crm.conversation_subjects WHERE id=$1',
                  [`${geral}-s`],
                )
              ).rows[0].order_id,
              null,
            );
            const replay = await off.createManual(
              command(geral, undefined, key),
            );
            assert.equal(replay.order.id, created.order.id);
            const repeat = await off.createManual(command(geral));
            assert.equal(repeat.created, false);
            assert.equal(repeat.order.id, created.order.id);
            assert.equal((await legacyRows(geral)).length, 1);
            // The Inbox asks for a Subject only when the server says so.
            assert.equal(
              (await off.currentForConversation(geral, seller))
                .subjectCreationAvailable,
              false,
            );
            // 2. A single bot Subject whose order is confirmed opens a new draft.
            const single = `general-confirmed-${index}`;
            await conversation(single);
            await draftBeforeUpgrade(`${single}-order`, single);
            await subject(`${single}-s`, single, `${single}-order`);
            await confirmDraft(`${single}-order`);
            const next = await off.createManual(command(single));
            assert.equal(next.created, true);
            assert.notEqual(next.order.id, `${single}-order`);
            assert.deepEqual(
              (await legacyRows(single)).map((row) => row.origin_subject_id),
              [null, null],
            );
            // 3. A repeat customer (two Subjects, both confirmed) reads, projects
            // and creates as before: Subject count is not pending ambiguity.
            const repeated = `general-repeat-${index}`;
            await conversation(repeated);
            for (const suffix of ['a', 'b']) {
              await draftBeforeUpgrade(`${repeated}-${suffix}`, repeated);
              await subject(
                `${repeated}-s${suffix}`,
                repeated,
                `${repeated}-${suffix}`,
              );
              await confirmDraft(`${repeated}-${suffix}`);
            }
            for (const reader of [off, runtime()]) {
              assert.equal(
                (await reader.currentForConversation(repeated, seller)).order
                  ?.status,
                'confirmado',
              );
              assert.deepEqual(
                await reader.projectAgentBriefing({
                  conversationId: repeated,
                  correlationId: randomUUID(),
                  briefing: { order_name: 'Sem pendente' },
                  automationState: 'assistant',
                }),
                { applied: false, order: null, reason: 'no_pending_order' },
              );
            }
            const third = await off.createManual(command(repeated));
            assert.equal(third.created, true);
            assert.equal(
              (await off.createManual(command(repeated))).order.id,
              third.order.id,
            );
            for (const reader of [off, runtime()]) {
              assert.equal(
                (await reader.currentForConversation(repeated, seller)).order
                  ?.id,
                third.order.id,
              );
              const projected = await reader.projectAgentBriefing({
                conversationId: repeated,
                correlationId: randomUUID(),
                briefing: { order_name: 'Projeção legada' },
                automationState: 'assistant',
              });
              assert.equal(
                projected.applied,
                true,
                projected.reason ?? undefined,
              );
              assert.equal(projected.order?.id, third.order.id);
            }
            assert.deepEqual(
              (await legacyRows(repeated)).map((row) => [
                row.origin_subject_id,
                row.status,
              ]),
              [
                [null, 'confirmado'],
                [null, 'confirmado'],
                [null, 'pendente'],
              ],
            );
          }
          // The allowlisted seller with every gate on is told targeting applies.
          assert.equal(
            (await runtime().currentForConversation('general-geral-0', seller))
              .subjectCreationAvailable,
            true,
          );
          // Real ambiguity still refuses whatever the gates say.
          await assert.rejects(
            runtime(offSettings[0]).createManual(command('reopen')),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
          await assert.rejects(
            runtime(offSettings[0]).currentForConversation('reopen', seller),
            { code: 'ORDER_TARGET_REQUIRED' },
          );
        },
      );
      await t.test(
        'P2-1: zero-Subject creation persists its own Subject and a new explicit Subject opens another order',
        async () => {
          for (const personal of [false, true]) {
            const id = personal ? 'fresh-personal' : 'fresh-general';
            const contact = await conversation(id);
            if (personal) await personalLine(seller.id, id, contact);
            const key = randomUUID();
            const first = await runtime().createManual(
              command(id, undefined, key),
            );
            assert.equal(first.created, true);
            const rows = (
              await pool.query(
                `SELECT subject.id,subject.kind,subject.order_id,subject.is_current,
                        subject.position,subject.contact_id,orders.origin_subject_id
                 FROM crm.conversation_subjects subject
                 JOIN crm.orders orders ON orders.id=$2
                 WHERE subject.conversation_id=$1`,
                [id, first.order.id],
              )
            ).rows;
            assert.equal(rows.length, 1);
            assert.deepEqual(rows[0], {
              id: rows[0].id,
              kind: 'pedido',
              order_id: first.order.id,
              is_current: true,
              position: 1,
              contact_id: contact,
              origin_subject_id: rows[0].id,
            });
            assert.equal(first.order.originSubjectId, rows[0].id);
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int AS n FROM crm.domain_events WHERE aggregate_id=$1 AND event_type='conversation.subjects_changed'",
                  [id],
                )
              ).rows[0].n,
              1,
            );
            // Replay and another key reuse the order; no second Subject.
            assert.equal(
              (await runtime().createManual(command(id, undefined, key))).order
                .id,
              first.order.id,
            );
            const again = await runtime().createManual(command(id));
            assert.equal(again.created, false);
            assert.equal(again.order.id, first.order.id);
            // WAP-33: a new target uses an explicit Subject.
            await subject(`${id}-next`, id);
            const second = await runtime().createManual(
              command(id, `${id}-next`),
            );
            assert.equal(second.created, true);
            assert.notEqual(second.order.id, first.order.id);
            assert.equal(second.order.originSubjectId, `${id}-next`);
            await assert.rejects(runtime().createManual(command(id)), {
              code: 'ORDER_TARGET_REQUIRED',
            });
          }
          // The implicit Subject shares the order's transaction.
          await conversation('fresh-rollback');
          await pool.query(`CREATE FUNCTION crm.wap_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id='fresh-rollback' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER wap_test_audit_failure BEFORE INSERT ON crm.audit_events FOR EACH ROW EXECUTE FUNCTION crm.wap_test_audit_failure()`);
          try {
            await assert.rejects(
              runtime().createManual(command('fresh-rollback')),
              /synthetic audit failure/u,
            );
          } finally {
            await pool.query(
              'DROP TRIGGER wap_test_audit_failure ON crm.audit_events; DROP FUNCTION crm.wap_test_audit_failure()',
            );
          }
          for (const table of ['orders', 'conversation_subjects'])
            assert.equal(
              (
                await pool.query(
                  `SELECT count(*)::int AS n FROM crm.${table} WHERE conversation_id='fresh-rollback'`,
                )
              ).rows[0].n,
              0,
            );
          // General line with targeted creation off keeps the legacy draft.
          await conversation('fresh-off');
          const off = await runtime({
            ORDER_SUBJECT_CREATION_ENABLED: 'false',
          }).createManual(command('fresh-off'));
          assert.equal(off.order.originSubjectId, undefined);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.conversation_subjects WHERE conversation_id='fresh-off'",
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test(
        'P1-1: a stand-alone order needs the Contact visibility of reading it',
        async () => {
          const intruder = {
            id: 'acl-intruder',
            kind: 'human',
            functionName: 'Vendedor',
            capabilities: [],
          };
          const admin = {
            id: 'acl-admin',
            kind: 'human',
            functionName: 'Vendedor',
            capabilities: ['COMMERCIAL_ADMIN'],
          };
          // A seller with a personal line of their own sees no more.
          const peer = { ...intruder, id: 'acl-peer' };
          for (const user of [intruder, admin, peer]) {
            await pool.query(
              `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Usuário Sintético')`,
              [user.id, `${user.id}@example.test`],
            );
            await pool.query(
              "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
              [user.id],
            );
          }
          await pool.query(
            "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
            [admin.id],
          );
          const privateContact = await conversation('acl-private');
          await personalLine(seller.id, 'acl-private', privateContact);
          const generalContact = await conversation('acl-general');
          const peerContact = await conversation('acl-peer-client');
          await personalLine(peer.id, 'acl-peer-client', peerContact);
          /** @param {any} actor @param {string} contactId */
          const standalone = (actor, contactId) =>
            runtime().createForContact({
              actor,
              contactId,
              idempotencyKey: randomUUID(),
              correlationId: randomUUID(),
            });
          /** @param {string} contactId */
          const manualOrders = async (contactId) =>
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.orders WHERE contact_id=$1 AND conversation_id IS NULL',
                [contactId],
              )
            ).rows[0].n;
          for (const actor of [intruder, peer])
            await assert.rejects(standalone(actor, privateContact), {
              code: 'CONTACT_NOT_FOUND',
            });
          await assert.rejects(standalone(seller, peerContact), {
            code: 'CONTACT_NOT_FOUND',
          });
          // The writer re-reads visibility under the Contact lock.
          await assert.rejects(
            repository.createPending({
              actor: intruder,
              contactId: privateContact,
              conversationId: null,
              correlationId: randomUUID(),
              createdBy: intruder.id,
              createdByKind: 'user',
              fabCode: '01',
              ficha: briefingToFicha(null),
              firstContactAt: NOW.toISOString(),
              id: randomUUID(),
              manualCreateKey: randomUUID(),
              manualOwnerId: intruder.id,
              missingFields: ['items'],
              now: NOW,
              totalPieces: 0,
            }),
            { code: 'CONTACT_NOT_FOUND' },
          );
          const api = createApi(
            {},
            {
              orders: createOrderApiRuntime(database, {
                access: {
                  authorizeRead: async () => ({ actor: intruder }),
                  authorizeWrite: async () => ({ actor: intruder }),
                },
                environment,
              }),
            },
          );
          try {
            const response = await api.inject({
              method: 'POST',
              url: '/api/v1/orders',
              headers: { 'idempotency-key': randomUUID() },
              payload: { contactId: privateContact },
            });
            assert.equal(response.statusCode, 404, response.body);
            assert.deepEqual(response.json(), {
              error: { code: 'CONTACT_NOT_FOUND' },
            });
            assert.doesNotMatch(response.body, /Sintético/u);
          } finally {
            await api.close();
          }
          assert.equal(await manualOrders(privateContact), 0);
          // The owner and an Admin keep working; a general client stays open.
          const own = await standalone(seller, privateContact);
          assert.equal(own.ficha.summary.cliente, 'Cliente Sintético');
          const byAdmin = await standalone(admin, privateContact);
          assert.equal(byAdmin.contactId, privateContact);
          const general = await standalone(intruder, generalContact);
          assert.equal(general.contactId, generalContact);
          assert.equal(await manualOrders(privateContact), 2);
        },
      );
      await t.test(
        'WAP-07/08: a private client order is absent from every read of another seller',
        async () => {
          // Users from P1-1: another seller and an Admin.
          const intruder = {
            id: 'acl-intruder',
            kind: 'human',
            functionName: 'Vendedor',
            capabilities: [],
          };
          const admin = {
            ...intruder,
            id: 'acl-admin',
            capabilities: ['COMMERCIAL_ADMIN'],
          };
          const NAME = 'Cliente Carteira Sigilosa';
          const PHONE = '11977776666';
          const privateContact = await conversation('vis-private');
          await personalLine(seller.id, 'vis-private', privateContact);
          await pool.query(
            'UPDATE crm.contacts SET display_name=$2,contact_phone_hash=$3 WHERE id=$1',
            [
              privateContact,
              NAME,
              contactPhoneHash(
                /** @type {string} */ (normalizeContactPhone(PHONE)),
                KEY,
              ),
            ],
          );
          await conversation('vis-general');
          const files = new InMemoryObjectStorage();
          /** @param {any} actor */
          const as = (actor) =>
            createOrderApiRuntime(database, {
              access: {
                authorizeRead: async () => ({ actor }),
                authorizeWrite: async () => ({ actor }),
              },
              environment,
              storage: files,
            });
          const conversationOrder = (
            await as(seller).createManual(command('vis-private'))
          ).order;
          const manualOrder = await as(seller).createForContact({
            actor: seller,
            contactId: privateContact,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          const generalOrder = (
            await as(seller).createManual(command('vis-general'))
          ).order;
          const hiddenIds = [conversationOrder.id, manualOrder.id];
          // The search decrypts each identity; give this suite's identities
          // real envelopes, the private one carrying the client's phone.
          for (const row of (
            await pool.query(
              'SELECT id,external_identity_lookup_hash FROM crm.contact_identities',
            )
          ).rows) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', KEY, iv);
            cipher.setAAD(
              Buffer.from(
                JSON.stringify([
                  'crm.contact_identities',
                  1,
                  row.external_identity_lookup_hash,
                ]),
              ),
            );
            const ciphertext = Buffer.concat([
              cipher.update(
                JSON.stringify({
                  displayHandle: null,
                  externalIdentityId:
                    row.id === 'identity-vis-private'
                      ? `55${PHONE}`
                      : '5521900000000',
                }),
              ),
              cipher.final(),
            ]);
            await pool.query(
              'UPDATE crm.contact_identities SET identity_envelope=$2::jsonb WHERE id=$1',
              [
                row.id,
                JSON.stringify({
                  algorithm: 'AES-256-GCM',
                  keyVersion: 1,
                  version: 1,
                  iv: iv.toString('base64'),
                  tag: cipher.getAuthTag().toString('base64'),
                  ciphertext: ciphertext.toString('base64'),
                }),
              ],
            );
          }
          /** @param {any} actor @param {Record<string, unknown>} [filters] */
          const everyPage = async (actor, filters = {}) => {
            /** @type {string[]} */
            const ids = [];
            let cursor = null;
            let counts;
            do {
              const page = await as(actor).list(
                { ...filters, limit: 2, ...(cursor ? { cursor } : {}) },
                actor,
              );
              counts = page.counts;
              ids.push(...page.items.map((/** @type {any} */ o) => o.id));
              cursor = page.nextCursor;
            } while (cursor);
            return { counts, ids };
          };
          const forIntruder = await everyPage(intruder);
          const forAdmin = await everyPage(admin);
          const forOwner = await everyPage(seller);
          // Pages walk the same set the counts describe, with no repeats.
          for (const view of [forIntruder, forAdmin, forOwner]) {
            assert.equal(new Set(view.ids).size, view.ids.length);
            assert.equal(
              view.ids.length,
              view.counts.pendente + view.counts.confirmado,
            );
          }
          for (const id of hiddenIds) {
            assert.ok(!forIntruder.ids.includes(id));
            assert.ok(forAdmin.ids.includes(id));
            assert.ok(forOwner.ids.includes(id));
          }
          assert.ok(forIntruder.ids.includes(generalOrder.id));
          // Earlier private clients of this suite are hidden as well; the
          // intruder reads a subset of the Admin's orders, and each order the
          // intruder misses is one whose Contact has no general-line identity
          // and no wallet link of the intruder.
          assert.ok(forIntruder.ids.every((id) => forAdmin.ids.includes(id)));
          const missing = forAdmin.ids.filter(
            (id) => !forIntruder.ids.includes(id),
          );
          assert.equal(
            forAdmin.counts.pendente +
              forAdmin.counts.confirmado -
              forIntruder.counts.pendente -
              forIntruder.counts.confirmado,
            missing.length,
          );
          const unexplained = (
            await pool.query(
              `SELECT orders.id FROM crm.orders orders
               JOIN crm.contacts contact ON contact.id=orders.contact_id
               WHERE orders.id=ANY($1::text[]) AND (EXISTS (
                 SELECT 1 FROM crm.seller_client_links link
                 WHERE link.contact_id=contact.id AND link.seller_id=$2
                   AND link.status='active') OR EXISTS (
                 SELECT 1 FROM crm.contact_identities identity
                 WHERE identity.current_contact_id=contact.id
                   AND identity.provider_account_id='subject-account'))`,
              [missing, intruder.id],
            )
          ).rows;
          assert.deepEqual(unexplained, []);
          // Name, phone and number searches find nothing for the intruder.
          for (const q of [
            'Sigilosa',
            PHONE,
            conversationOrder.number,
            manualOrder.number,
          ]) {
            const hidden = await as(intruder).list({ q }, intruder);
            assert.deepEqual(
              hidden.items.map((/** @type {any} */ o) => o.id),
              [],
              q,
            );
            assert.deepEqual(hidden.counts, { confirmado: 0, pendente: 0 }, q);
          }
          for (const actor of [seller, admin]) {
            const found = await as(actor).list({ q: 'Sigilosa' }, actor);
            assert.deepEqual(
              found.items.map((/** @type {any} */ o) => o.id).sort(),
              [...hiddenIds].sort(),
            );
            const byPhone = await as(actor).list({ q: PHONE }, actor);
            assert.ok(
              byPhone.items.some(
                (/** @type {any} */ o) => o.id === manualOrder.id,
              ),
            );
          }
          // Detail, sub-resources and commands answer as for an unknown id.
          for (const id of hiddenIds) {
            const runtime = as(intruder);
            for (const read of [
              () => runtime.get(id, intruder),
              () => runtime.priceBreakdown(id, intruder),
              () => runtime.listFiles(id, intruder),
              () => runtime.getReceipt(id, intruder),
              () =>
                runtime.patchSection({
                  actor: intruder,
                  correlationId: randomUUID(),
                  expectedVersion: 1,
                  idempotencyKey: randomUUID(),
                  orderId: id,
                  section: 'observations',
                  value: [],
                }),
              () =>
                runtime.confirm({
                  actor: intruder,
                  correlationId: randomUUID(),
                  expectedVersion: 1,
                  idempotencyKey: randomUUID(),
                  orderId: id,
                  paymentCondition: 'pix',
                }),
              () =>
                runtime.cancel({
                  actor: intruder,
                  correlationId: randomUUID(),
                  expectedVersion: 1,
                  idempotencyKey: randomUUID(),
                  orderId: id,
                  reason: 'Motivo sintético',
                }),
              () =>
                runtime.setFreight({
                  actor: intruder,
                  correlationId: randomUUID(),
                  expectedVersion: 1,
                  freightCents: 100,
                  idempotencyKey: randomUUID(),
                  orderId: id,
                }),
            ])
              await assert.rejects(read(), { code: 'ORDER_NOT_FOUND' });
            for (const actor of [seller, admin])
              assert.equal((await as(actor).get(id, actor)).order.id, id);
          }
          assert.equal(
            (await as(intruder).get(generalOrder.id, intruder)).order.id,
            generalOrder.id,
          );
          // The Painel figures leave the hidden orders out for the intruder.
          const [intruderSummary, adminSummary] = await Promise.all([
            as(intruder).summary({ period: 'hoje' }, intruder),
            as(admin).summary({ period: 'hoje' }, admin),
          ]);
          assert.equal(
            adminSummary.pendingCount - intruderSummary.pendingCount,
            forAdmin.counts.pendente - forIntruder.counts.pendente,
          );
          assert.ok(
            adminSummary.pendingCount - intruderSummary.pendingCount >=
              hiddenIds.length,
          );
          // HTTP: 404 ORDER_NOT_FOUND bodies, no name, no id echoed.
          const api = createApi({}, { orders: as(intruder) });
          try {
            for (const request of [
              { method: 'GET', url: `/api/v1/orders/${manualOrder.id}` },
              { method: 'GET', url: `/api/v1/orders/${manualOrder.id}/print` },
              { method: 'GET', url: `/api/v1/orders/${manualOrder.id}/pdf` },
              {
                method: 'GET',
                url: `/api/v1/orders/${manualOrder.id}/price-breakdown`,
              },
              { method: 'GET', url: `/api/v1/orders/${manualOrder.id}/files` },
              {
                method: 'PATCH',
                url: `/api/v1/orders/${manualOrder.id}/sections/observations`,
                headers: { 'idempotency-key': randomUUID() },
                payload: { expectedVersion: 1, value: [] },
              },
            ]) {
              const response = await api.inject(/** @type {any} */ (request));
              assert.equal(response.statusCode, 404, request.url);
              assert.deepEqual(response.json(), {
                error: { code: 'ORDER_NOT_FOUND' },
              });
              assert.doesNotMatch(response.body, /Sigilosa|Sintético/u);
            }
            for (const request of [
              { method: 'GET', url: '/api/v1/orders?q=Sigilosa' },
              {
                method: 'POST',
                url: '/api/v1/orders/search',
                payload: { q: PHONE },
              },
            ]) {
              const response = await api.inject(/** @type {any} */ (request));
              assert.equal(response.statusCode, 200, response.body);
              assert.deepEqual(response.json().items, []);
              assert.doesNotMatch(response.body, /Sigilosa/u);
            }
          } finally {
            await api.close();
          }
        },
      );
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
