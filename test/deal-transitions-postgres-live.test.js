import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresDealAutomationFencePort,
  PostgresDealRepository,
  createDealCommandService,
  createDealLossReasonCipher,
} from '../modules/deals-pipeline/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T16:00:00.000Z');

/** @param {Pool} pool */
function databaseFor(pool) {
  return {
    query: pool.query.bind(pool),
    /** @param {(client: any) => Promise<any>} work */
    transaction: (work) => withTransaction(pool, work),
  };
}

if (connectionString) {
  test('PostgreSQL persists fenced Deal commands atomically under replay and concurrency', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(databaseName, 'crm_silmer_test');
    const pool = new Pool({ connectionString, max: 12 });
    const database = databaseFor(pool);
    const runId = randomUUID().replaceAll('-', '');
    let auditSequence = 0;
    const repository = new PostgresDealRepository();
    const lossReasonCipher = createDealLossReasonCipher({
      key: Buffer.alloc(32, 72),
    });
    const service = createDealCommandService({
      auditPort: new PostgresAuditTrail(database, {
        clock: () => NOW,
        idFactory: () => `audit-deal-${runId}-${++auditSequence}`,
      }),
      automationFencePort: new PostgresDealAutomationFencePort(),
      clock: () => NOW,
      dealRepository: repository,
      eventPort: new PostgresDomainEventStore(),
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 73),
      }),
      lossReasonCipher,
      qualificationPort: { evaluateGate: async () => ({ blockers: [] }) },
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await pool.query(
        `INSERT INTO crm.contacts
           (id, provisional, version, created_at, updated_at)
         VALUES ($1, false, 1, $2, $2)`,
        [`contact-${runId}`, NOW],
      );
      await pool.query(
        `INSERT INTO crm.contact_identities
           (id, current_contact_id, provider, provider_account_id, channel,
            external_identity_lookup_hash, identity_kind, phone_status,
            identity_envelope, key_version, version, created_at, updated_at)
         VALUES ($1, $2, 'meta', $3, 'instagram', $4, 'handle', 'pending',
                 $5::jsonb, 1, 1, $6, $6)`,
        [
          `identity-${runId}`,
          `contact-${runId}`,
          `account-${runId}`,
          'a'.repeat(64),
          JSON.stringify({
            algorithm: 'AES-256-GCM',
            keyVersion: 1,
            version: 1,
          }),
          NOW,
        ],
      );
      await pool.query(
        `INSERT INTO crm.conversations
           (id, contact_identity_id, provider, provider_account_id,
            external_conversation_id, cycle_number, state, automation_state,
            automation_epoch, version, opened_at, last_message_at)
         VALUES ($1, $2, 'meta', $3, $4, 1, 'em_analise', 'assistant',
                 4, 1, $5, $5)`,
        [
          `conversation-${runId}`,
          `identity-${runId}`,
          `account-${runId}`,
          `external-conversation-${runId}`,
          NOW,
        ],
      );
      await withTransaction(pool, (transaction) =>
        repository.createFromConversation(
          {
            contactId: `contact-${runId}`,
            createdAt: NOW.toISOString(),
            id: `deal-${runId}`,
            sourceConversationId: `conversation-${runId}`,
          },
          { transaction },
        ),
      );
      const base = {
        actor: { id: 'AUTOMATION_EXECUTOR', kind: 'AUTOMATION_EXECUTOR' },
        automationEpoch: 4,
        conversationId: `conversation-${runId}`,
        correlationId: `deal-correlation-${runId}`,
        dealId: `deal-${runId}`,
        direction: 'advance',
        expectedVersion: 1,
        idempotencyKey: `deal-transition-${runId}`,
        reason: 'Gate técnico validado',
      };
      const first = await service.transitionDeal(base);
      assert.deepEqual(await service.transitionDeal(base), first);

      const concurrent = await Promise.allSettled([
        service.transitionDeal({
          ...base,
          expectedVersion: 2,
          idempotencyKey: `deal-concurrent-a-${runId}`,
        }),
        service.transitionDeal({
          ...base,
          expectedVersion: 2,
          idempotencyKey: `deal-concurrent-b-${runId}`,
        }),
      ]);
      assert.equal(
        concurrent.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.equal(
        concurrent.filter(({ status }) => status === 'rejected').length,
        1,
      );

      await assert.rejects(
        service.transitionDeal({
          ...base,
          automationEpoch: 3,
          expectedVersion: 3,
          idempotencyKey: `deal-stale-${runId}`,
        }),
        (error) =>
          /** @type {{code?: unknown}} */ (error)?.code === 'DEAL_CONFLICT',
      );

      const sensitiveReason = 'Cliente desistiu por questão familiar';
      await service.loseDeal({
        actor: {
          functionName: 'Vendedor',
          id: `seller-${runId}`,
          kind: 'human',
        },
        correlationId: `deal-loss-correlation-${runId}`,
        dealId: `deal-${runId}`,
        expectedVersion: 3,
        idempotencyKey: `deal-loss-${runId}`,
        reason: sensitiveReason,
      });

      const persisted = await pool.query(
        `SELECT
           d.stage, d.status, d.version, d.loss_reason_envelope,
           (SELECT count(*)::integer FROM crm.deal_gates) AS gates,
           (SELECT count(*)::integer FROM crm.deal_stage_history) AS history,
           (SELECT count(*)::integer FROM crm.domain_events) AS events,
           (SELECT count(*)::integer FROM crm.audit_events
              WHERE action IN ('deal.transition', 'deal.lose')) AS audits
         FROM crm.deals d WHERE d.id = $1`,
        [`deal-${runId}`],
      );
      assert.equal(persisted.rows[0].stage, 'estampa');
      assert.equal(persisted.rows[0].status, 'lost');
      assert.equal(Number(persisted.rows[0].version), 4);
      assert.equal(persisted.rows[0].gates, 2);
      assert.equal(persisted.rows[0].history, 4);
      assert.equal(persisted.rows[0].events, 3);
      assert.equal(persisted.rows[0].audits, 3);
      assert.equal(
        lossReasonCipher.decrypt(
          persisted.rows[0].loss_reason_envelope,
          `deal-${runId}`,
        ),
        sensitiveReason,
      );
      assert.doesNotMatch(
        JSON.stringify(persisted.rows[0]),
        /questão familiar/iu,
      );
      const leaked = await pool.query(
        `SELECT
           EXISTS(SELECT 1 FROM crm.audit_events WHERE reason ILIKE '%familiar%')
             OR EXISTS(SELECT 1 FROM crm.domain_events
                       WHERE payload::text ILIKE '%familiar%')
             OR EXISTS(SELECT 1 FROM crm.deal_stage_history
                       WHERE reason ILIKE '%familiar%') AS leaked`,
      );
      assert.equal(leaked.rows[0].leaked, false);

      await assert.rejects(
        pool.query(
          `UPDATE crm.deal_gates SET blockers = '["tampered"]'::jsonb
           WHERE deal_id = $1`,
          [`deal-${runId}`],
        ),
        (error) => /** @type {{code?: unknown}} */ (error)?.code === '23514',
      );
      for (const table of [
        'deal_gates',
        'deal_stage_history',
        'domain_events',
      ]) {
        await assert.rejects(
          pool.query(`TRUNCATE TABLE crm.${table}`),
          (error) => /** @type {{code?: unknown}} */ (error)?.code === '23514',
        );
      }
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
