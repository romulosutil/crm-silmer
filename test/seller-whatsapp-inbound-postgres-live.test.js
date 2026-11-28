import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  createN8nIntegrationService,
  PostgresN8nIntegrationRepository,
} from '../modules/n8n-integration/src/index.js';
import { PostgresSellerWhatsAppRepository } from '../modules/inbox-channels/src/adapters/postgres-seller-whatsapp.js';
import { encryptJson } from '../modules/n8n-integration/src/crypto.js';
import { contactPhoneHash } from '../modules/contacts/src/index.js';

const url = process.env.TEST_DATABASE_URL;
const KEY = Buffer.alloc(32, 41);
const NOW = new Date('2026-11-17T12:00:00.000Z');
const A = 'inbound-seller-a',
  B = 'inbound-seller-b';
const TOKEN = 'synthetic-generation-token-0000000000000001';

if (!url)
  test(
    'WAP-E04 inbound PostgreSQL requires dedicated TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
else {
  assert.match(new URL(url).pathname, /^\/crm_silmer_test(?:_[a-z0-9_]+)?$/u);
  test('WAP-E04 atomic personal ingress, deduplication, rollback and inactive administration', async (t) => {
    const pool = new Pool({ connectionString: url, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    let seq = 0;
    const repository = new PostgresN8nIntegrationRepository({
      database,
      envelopeKey: KEY,
      personalInboundEnabled: true,
      personalInboundSellerIds: [A, B],
    });
    const service = createN8nIntegrationService({
      repository,
      clock: () => NOW,
      idFactory: (kind) => `${kind}-wap-inbound-${++seq}`,
    });
    const control = new PostgresSellerWhatsAppRepository(database, {
      envelopeKey: KEY,
      lookupKey: KEY,
      enabled: true,
      sellerAllowlist: [A, B],
      generalNumberDigest: 'f'.repeat(64),
    });
    /** @param {string} seller */
    async function line(seller) {
      const source = {
        lineId: randomUUID(),
        accountId: randomUUID(),
        bindingId: randomUUID(),
        generation: 1,
      };
      const instance = `wap_${randomUUID().replaceAll('-', '')}`;
      const number = seller === A ? '5511990000081' : '5511990000091';
      const digest = contactPhoneHash(number, KEY);
      const encrypted = JSON.stringify(
        encryptJson({ number }, 'synthetic-number', KEY),
      );
      await database.transaction(async (/** @type {any} */ tx) => {
        await tx.query(
          `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,number_digest,number_envelope,confirmed_number_envelope,state,generation,version,verified_at,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,'connected',1,1,$7,$7,$7)`,
          [
            source.lineId,
            seller,
            source.accountId,
            instance,
            digest,
            encrypted,
            NOW,
          ],
        );
        await tx.query(
          `INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at) VALUES($1,'personal',$2,$3)`,
          [digest, source.lineId, NOW],
        );
        await tx.query(
          `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
          VALUES($1,$2,$3,$4,1,$5,$6::jsonb,$7)`,
          [
            source.bindingId,
            source.lineId,
            source.accountId,
            instance,
            createHash('sha256')
              .update(TOKEN + seller)
              .digest('hex'),
            encrypted,
            NOW,
          ],
        );
      });
      return { source, instance, number };
    }
    /** @param {any} origin @param {string} id @param {any} [extra] */
    function inbound(origin, id, extra = {}) {
      return {
        schema_version: '1.0',
        channel: 'whatsapp',
        provider: 'evolution',
        source: origin.source,
        metadata: { provider_account_id: origin.source.accountId },
        contact: { wa_id: '5511990000082' },
        event_id: id,
        message: { external_id: id, type: 'text', text: 'Mensagem sintética' },
        occurred_at: NOW.toISOString(),
        technical: {
          actor: 'AUTOMATION_EXECUTOR',
          correlationId: `correlation-${id}`,
          idempotencyKey: `${origin.source.accountId}:${id}`,
          credentialVersion: 'current',
          executionId: 'synthetic-inbound-execution',
          requestId: `request-${id}`,
          workflowKey: 'seller-whatsapp-inbound',
          workflowVersion: '1.0',
        },
        ...extra,
      };
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      for (const seller of [A, B]) {
        await pool.query(
          `INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic seller')`,
          [seller, `${seller}@example.test`],
        );
        await pool.query(
          `INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')`,
          [seller],
        );
      }
      const a = await line(A),
        b = await line(B);
      await t.test(
        'default off, empty allowlist and missing/forged source deny before persistence',
        async () => {
          for (const options of [
            {},
            { personalInboundEnabled: true },
            { personalInboundEnabled: true, personalInboundSellerIds: [B] },
          ]) {
            const closed = createN8nIntegrationService({
              repository: new PostgresN8nIntegrationRepository({
                database,
                envelopeKey: KEY,
                ...options,
              }),
            });
            await assert.rejects(closed.receiveInbound(inbound(a, 'denied')), {
              code: 'N8N_FORBIDDEN',
            });
          }
          await assert.rejects(
            service.receiveInbound(
              inbound(a, 'missing', { source: undefined }),
            ),
            { code: 'N8N_FORBIDDEN' },
          );
          await assert.rejects(
            service.receiveInbound(
              inbound(a, 'forged', {
                source: { ...b.source, accountId: a.source.accountId },
              }),
            ),
            { code: 'WHATSAPP_GENERATION_STALE' },
          );
          const wrongWorkflow = inbound(a, 'wrong-workflow');
          wrongWorkflow.technical.workflowKey = 'general-workflow';
          await assert.rejects(service.receiveInbound(wrongWorkflow), {
            code: 'N8N_FORBIDDEN',
          });
          assert.deepEqual(
            (
              await control.verifyIngress({
                source: a.source,
                instance: a.instance,
                token: TOKEN + A,
                sender: a.number + '@s.whatsapp.net',
              })
            ).source,
            a.source,
          );
          await assert.rejects(
            control.verifyIngress({
              source: a.source,
              instance: a.instance,
              token: TOKEN + A,
              sender: '5511990000000@s.whatsapp.net',
            }),
            { code: 'FORBIDDEN' },
          );
          assert.equal(
            (await pool.query('SELECT count(*)::integer n FROM crm.messages'))
              .rows[0].n,
            0,
          );
        },
      );
      let first = /** @type {any} */ (null);
      await t.test(
        'two independent connections race distinct events without an ownerless window',
        async () => {
          const responses = await Promise.all([
            service.receiveInbound(inbound(a, 'race-1')),
            service.receiveInbound(inbound(a, 'race-2')),
          ]);
          first = responses[0];
          assert.equal(
            responses[0].conversation_id,
            responses[1].conversation_id,
          );
          const state = (
            await pool.query(
              'SELECT assigned_user_id,automation_state,inbound_revision FROM crm.conversations WHERE id=$1',
              [first.conversation_id],
            )
          ).rows[0];
          assert.equal(state.assigned_user_id, A);
          assert.equal(state.automation_state, 'human');
          assert.equal(Number(state.inbound_revision), 2);
          assert.equal(
            (await pool.query('SELECT count(*)::integer n FROM crm.contacts'))
              .rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer n FROM crm.seller_client_links WHERE seller_id=$1 AND provenance='personal_inbound'",
                [A],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(first.mode, 'human_active');
          for (const field of [
            'briefing',
            'recent_messages',
            'sellers',
            'contact_context',
          ])
            assert.equal(field in first, false);
          for (const table of ['orders', 'n8n_commands', 'handoffs'])
            assert.equal(
              (await pool.query(`SELECT count(*)::integer n FROM crm.${table}`))
                .rows[0].n,
              0,
            );
        },
      );
      await t.test(
        'same provider ID in another line has separate history; proven shared Contact stays one',
        async () => {
          const second = await service.receiveInbound(inbound(b, 'race-1'));
          assert.notEqual(first.conversation_id, second.conversation_id);
          assert.notEqual(
            first.contact_id,
            second.contact_id,
            'telephone equality alone must not merge Contact',
          );
          // An explicit identity-link proof is separate from inbound discovery.
          await pool.query(
            'UPDATE crm.contact_identities SET current_contact_id=$1 WHERE current_contact_id=$2',
            [first.contact_id, second.contact_id],
          );
          const shared = await service.receiveInbound(inbound(b, 'shared-2'));
          assert.equal(shared.contact_id, first.contact_id);
          assert.equal(shared.conversation_id, second.conversation_id);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM crm.seller_client_links WHERE contact_id=$1',
                [first.contact_id],
              )
            ).rows[0].n,
            2,
          );
        },
      );
      await t.test(
        'same event/message under a new request key does not duplicate or increment revision',
        async () => {
          const before = (
            await pool.query(
              'SELECT inbound_revision FROM crm.conversations WHERE id=$1',
              [first.conversation_id],
            )
          ).rows[0];
          const input = inbound(a, 'race-1');
          input.technical.idempotencyKey = 'different-retry-key';
          const response = await service.receiveInbound(input);
          const changed = inbound(a, 'race-1');
          changed.technical.idempotencyKey = 'different-content-retry';
          changed.message.text = 'Outro conteúdo sintético';
          await assert.rejects(service.receiveInbound(changed), {
            code: 'IDEMPOTENCY_CONFLICT',
          });
          assert.equal(response.duplicate, true);
          assert.deepEqual(
            (
              await pool.query(
                'SELECT inbound_revision FROM crm.conversations WHERE id=$1',
                [first.conversation_id],
              )
            ).rows[0],
            before,
          );
        },
      );
      await t.test(
        'failure after identity/link/conversation writes rolls the entire inbound back',
        async () => {
          await pool.query(
            `CREATE FUNCTION crm.synthetic_fail_inbound() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`,
          );
          await pool.query(
            'CREATE TRIGGER synthetic_fail_inbound BEFORE INSERT ON crm.messages FOR EACH ROW EXECUTE FUNCTION crm.synthetic_fail_inbound()',
          );
          const counts = (
            await pool.query(
              'SELECT (SELECT count(*) FROM crm.contacts) contacts,(SELECT count(*) FROM crm.seller_client_links) links,(SELECT count(*) FROM crm.conversations) conversations',
            )
          ).rows[0];
          await assert.rejects(
            service.receiveInbound(
              inbound(a, 'rollback', { contact: { wa_id: '5511990000083' } }),
            ),
          );
          assert.deepEqual(
            (
              await pool.query(
                'SELECT (SELECT count(*) FROM crm.contacts) contacts,(SELECT count(*) FROM crm.seller_client_links) links,(SELECT count(*) FROM crm.conversations) conversations',
              )
            ).rows[0],
            counts,
          );
          await pool.query(
            'DROP TRIGGER synthetic_fail_inbound ON crm.messages',
          );
        },
      );
      await t.test(
        'reconnect rejects old inbound and old delivery callback; never relabels source',
        async (reconnect) => {
          await pool.query(
            "UPDATE crm.seller_whatsapp_lines SET generation=2,version=2,state='connected' WHERE id=$1",
            [a.source.lineId],
          );
          await pool.query(
            'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE id=$1',
            [a.source.bindingId, NOW],
          );
          await assert.rejects(
            service.receiveInbound(inbound(a, 'old-after-reconnect')),
            { code: 'WHATSAPP_GENERATION_STALE' },
          );
          const next = { ...a.source, bindingId: randomUUID(), generation: 2 };
          const nextToken = 'synthetic-generation-2-token-0000000';
          await pool.query(
            `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
            SELECT $1,line_id,account_id,instance_name,2,$2,token_envelope,created_at FROM crm.seller_whatsapp_bindings WHERE id=$3`,
            [
              next.bindingId,
              createHash('sha256').update(nextToken).digest('hex'),
              a.source.bindingId,
            ],
          );
          const verify = {
            source: next,
            instance: a.instance,
            token: nextToken,
            sender: a.number + '@s.whatsapp.net',
          };
          const cutover = Math.floor(NOW.getTime() / 1000);
          assert.deepEqual(
            await control.verifyIngress({
              ...verify,
              messageTimestamp: cutover - 1,
            }),
            { source: next, instance: a.instance, ignored: 'before_cutover' },
          );
          assert.deepEqual(
            await control.verifyIngress({
              ...verify,
              messageTimestamp: cutover,
            }),
            { source: next, instance: a.instance },
          );
          await assert.rejects(
            control.verifyIngress({
              ...verify,
              token: TOKEN + A,
              messageTimestamp: cutover - 1,
            }),
            { code: 'FORBIDDEN' },
          );
          const relabeled = inbound(a, 'race-1', { source: next });
          relabeled.technical.idempotencyKey = 'relabel-old-event';
          await assert.rejects(service.receiveInbound(relabeled), {
            code: 'IDEMPOTENCY_CONFLICT',
          });
          await assert.rejects(
            service.recordEvent({
              schema_version: '1.0',
              event_id: 'old-ack',
              event_type: 'message.delivered',
              external_message_id: 'race-1',
              source: a.source,
              occurred_at: NOW.toISOString(),
              technical: inbound(a, 'old-ack').technical,
            }),
            { code: 'WHATSAPP_GENERATION_STALE' },
          );
          assert.equal(
            (
              await pool.query(
                'SELECT max(generation)::integer generation FROM crm.personal_whatsapp_inbound p JOIN crm.messages m ON m.id=p.message_id WHERE m.provider_account_id=$1',
                [a.source.accountId],
              )
            ).rows[0].generation,
            1,
          );

          await reconnect.test(
            'WAP-09/10: mixed reconnect burst keeps old events out and saves each new event once',
            async () => {
              const preCutover = new Date(NOW.getTime() - 1_000).toISOString();
              const burst = Array.from({ length: 63 }, (_, index) => {
                const batch = [
                  inbound(a, `reconnect-burst-revoked-${index}`),
                  inbound(a, `reconnect-burst-before-${index}-a`, {
                    source: next,
                    occurred_at: preCutover,
                  }),
                  inbound(a, `reconnect-burst-before-${index}-b`, {
                    source: next,
                    occurred_at: preCutover,
                  }),
                ];
                if (index < 27) {
                  const id = `reconnect-burst-current-${index}`;
                  batch.push(
                    inbound(a, id, { source: next }),
                    inbound(a, id, { source: next }),
                  );
                }
                return batch;
              }).flat();

              const counts = {
                revoked: 0,
                beforeCutover: 0,
                saved: 0,
                duplicate: 0,
              };
              for (let offset = 0; offset < burst.length; offset += 8) {
                const outcomes = await Promise.allSettled(
                  burst
                    .slice(offset, offset + 8)
                    .map((event) => service.receiveInbound(event)),
                );
                for (const outcome of outcomes) {
                  if (outcome.status === 'fulfilled') {
                    assert.equal(outcome.value.accepted, true);
                    counts[outcome.value.duplicate ? 'duplicate' : 'saved']++;
                  } else {
                    assert.equal(
                      outcome.reason.code,
                      'WHATSAPP_GENERATION_STALE',
                    );
                    if (outcome.reason.diagnosticCode === undefined)
                      counts.revoked++;
                    else {
                      assert.equal(
                        outcome.reason.diagnosticCode,
                        'WHATSAPP_EVENT_BEFORE_CUTOVER',
                      );
                      counts.beforeCutover++;
                    }
                  }
                }
              }
              assert.deepEqual(counts, {
                revoked: 63,
                beforeCutover: 126,
                saved: 27,
                duplicate: 27,
              });

              const { rows } = await pool.query(
                `SELECT p.generation::int AS generation, count(*)::int AS count,
                      bool_and(m.external_message_id LIKE 'reconnect-burst-current-%') AS current_only
               FROM crm.messages m
               JOIN crm.personal_whatsapp_inbound p ON p.message_id = m.id
               WHERE m.provider_account_id = $1 AND m.external_message_id LIKE $2
               GROUP BY p.generation`,
                [next.accountId, 'reconnect-burst-%'],
              );
              assert.deepEqual(rows, [
                { generation: 2, count: 27, current_only: true },
              ]);
            },
          );
        },
      );
      await t.test(
        'inactive owner authenticates prior origin only into private administrative pending',
        async () => {
          await pool.query('UPDATE crm.users SET disabled_at=$2 WHERE id=$1', [
            B,
            NOW,
          ]);
          const verified = await control.verifyIngress({
            source: b.source,
            instance: b.instance,
            token: TOKEN + B,
          });
          assert.deepEqual(verified.source, b.source);
          const existingPending = await service.receiveInbound(
            inbound(b, 'inactive-existing'),
          );
          assert.equal(
            (
              await pool.query(
                'SELECT state FROM crm.conversations WHERE id=$1',
                [existingPending.conversation_id],
              )
            ).rows[0].state,
            'requer_atencao',
          );
          const pending = await service.receiveInbound(
            inbound(b, 'inactive', {
              contact: { wa_id: '5511990000084' },
              external_conversation_id: 'inactive-new',
            }),
          );
          const state = (
            await pool.query(
              'SELECT state,assigned_user_id,automation_state FROM crm.conversations WHERE id=$1',
              [pending.conversation_id],
            )
          ).rows[0];
          assert.deepEqual(state, {
            state: 'requer_atencao',
            assigned_user_id: B,
            automation_state: 'human',
          });
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM crm.seller_client_links WHERE contact_id=$1',
                [pending.contact_id],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT p.administrative_pending FROM crm.personal_whatsapp_inbound p JOIN crm.messages m ON m.id=p.message_id WHERE m.conversation_id=$1',
                [pending.conversation_id],
              )
            ).rows[0].administrative_pending,
            true,
          );
        },
      );
      await t.test(
        'general line retains the existing assistant journey without source',
        async () => {
          const general = await service.receiveInbound(
            inbound(a, 'general', {
              provider: 'meta',
              source: undefined,
              metadata: { phone_number_id: 'general-synthetic-account' },
            }),
          );
          assert.equal(general.mode, 'ai_active');
        },
      );
    } finally {
      await pool.end();
    }
  });
}
