import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import { PostgresDealWorkPort } from '../modules/deals-pipeline/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresOperationalUserPort } from '../modules/identity-access/src/index.js';
import { PostgresHandoffConversationPort } from '../modules/inbox-channels/src/index.js';
import {
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
} from '../modules/integration-reliability/src/index.js';
import {
  PostgresWorkManagementRepository,
  createHandoffCipher,
  createWorkManagementService,
} from '../modules/work-management/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T18:00:00.000Z');

if (connectionString) {
  test('PostgreSQL commits fenced handoff/task/event/audit atomically and rejects races', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      /** @param {(client: any) => Promise<any>} work */
      transaction: (work) => withTransaction(pool, work),
    };
    const runId = randomUUID().replaceAll('-', '');
    let auditSequence = 0;
    const dependencies = {
      auditPort: new PostgresAuditTrail(database, {
        clock: () => NOW,
        idFactory: () => `audit-work-${runId}-${++auditSequence}`,
      }),
      cipher: createHandoffCipher({ key: Buffer.alloc(32, 72) }),
      clock: () => NOW,
      eventPort: new PostgresDomainEventStore(),
      idempotencyStore: new PostgresIdempotencyRecordStore({
        database,
        envelopeKey: Buffer.alloc(32, 73),
      }),
      repository: new PostgresWorkManagementRepository({
        conversationPort: new PostgresHandoffConversationPort(),
        dealPort: new PostgresDealWorkPort(),
        userPort: new PostgresOperationalUserPort(),
      }),
      slaMinutes: 240,
      slaPolicyVersion: 'technical-default-v1',
    };
    const service = createWorkManagementService(dependencies);
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      await seed(pool, runId);

      const command = handoffCommand(runId);
      const created = await service.createHandoff(command);
      assert.deepEqual(await service.createHandoff(command), created);
      assert.equal(created.deal.version, 2);
      assert.equal(created.conversation.automationEpoch, 3);
      assert.equal(created.conversation.automationState, 'human');
      assert.equal(created.task.dueAt, '2026-09-07T22:00:00.000Z');

      const stored = await pool.query(
        `SELECT h.summary_envelope, h.sla_minutes, h.sla_policy_version,
                t.text_envelope, d.assigned_user_id, c.automation_state,
                c.automation_epoch,
                (SELECT count(*)::integer FROM crm.tasks WHERE handoff_id = h.id) task_count
         FROM crm.handoffs h
         JOIN crm.tasks t ON t.handoff_id = h.id
         JOIN crm.deals d ON d.id = h.deal_id
         JOIN crm.conversations c ON c.id = h.conversation_id
         WHERE h.id = $1`,
        [created.handoff.id],
      );
      assert.equal(stored.rows[0].task_count, 1);
      assert.equal(stored.rows[0].sla_minutes, 240);
      assert.equal(stored.rows[0].sla_policy_version, 'technical-default-v1');
      assert.equal(stored.rows[0].assigned_user_id, `seller-${runId}`);
      assert.equal(stored.rows[0].automation_state, 'human');
      assert.equal(Number(stored.rows[0].automation_epoch), 3);
      assert.doesNotMatch(JSON.stringify(stored.rows[0]), /Maria Canary/iu);
      const persistedEvidence = await pool.query(
        `SELECT jsonb_agg(payload)::text evidence FROM crm.domain_events
         WHERE aggregate_id IN ($1, $2)
         UNION ALL
         SELECT jsonb_agg(to_jsonb(audit_events))::text FROM crm.audit_events
         WHERE correlation_id = $3
         UNION ALL
         SELECT jsonb_agg(response)::text FROM crm.idempotency_records
         WHERE idempotency_key = $4`,
        [
          `deal-${runId}`,
          created.handoff.id,
          command.correlationId,
          command.idempotencyKey,
        ],
      );
      assert.doesNotMatch(
        JSON.stringify(persistedEvidence.rows),
        /Maria Canary/iu,
      );

      await assert.rejects(
        service.createHandoff({
          ...command,
          automationEpoch: 2,
          expectedDealVersion: 2,
          expectedConversationVersion: 2,
          idempotencyKey: `stale-${runId}`,
        }),
        (/** @type {any} */ error) => error.code === 'WORK_CONFLICT',
      );

      const rollbackService = createWorkManagementService({
        ...dependencies,
        eventPort: {
          async append(/** @type {any} */ event, /** @type {any} */ context) {
            await dependencies.eventPort.append(event, context);
            throw new Error('forced event failure');
          },
        },
      });
      await assert.rejects(
        rollbackService.assignDeal({
          actor: human(runId),
          assignedUserId: `seller-${runId}`,
          correlationId: `rollback-correlation-${runId}`,
          dealId: `deal-${runId}`,
          expectedDealVersion: 2,
          idempotencyKey: `rollback-key-${runId}`,
          reasonCode: 'manual_assignment',
        }),
        /forced event failure/u,
      );
      const rolledBack = await pool.query(
        `SELECT d.version,
          (SELECT count(*)::integer FROM crm.deal_assignment_history WHERE deal_id=d.id) assignments,
          (SELECT count(*)::integer FROM crm.audit_events WHERE correlation_id=$2) audits
         FROM crm.deals d WHERE d.id=$1`,
        [`deal-${runId}`, `rollback-correlation-${runId}`],
      );
      assert.deepEqual(rolledBack.rows[0], {
        assignments: 1,
        audits: 0,
        version: '2',
      });

      const task = (/** @type {string} */ key) =>
        service.createTask({
          actor: human(runId),
          assignedUserId: `seller-${runId}`,
          correlationId: `task-correlation-${key}-${runId}`,
          dealId: `deal-${runId}`,
          dueAt: '2026-09-08T18:00:00.000Z',
          expectedDealVersion: 2,
          idempotencyKey: `task-${key}-${runId}`,
          reasonCode: 'manual_follow_up',
          text: 'Maria Canary deve receber retorno.',
          type: 'follow_up',
        });
      const raced = await Promise.allSettled([task('a'), task('b')]);
      assert.equal(
        raced.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.equal(
        raced.filter(({ status }) => status === 'rejected').length,
        1,
      );
      assert.doesNotMatch(
        JSON.stringify(
          await pool.query('SELECT payload FROM crm.domain_events'),
        ),
        /Maria Canary/iu,
      );
    } finally {
      await pool.end();
    }
  });
} else {
  test(
    'PostgreSQL work-management live test requires TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
}

/** @param {string} runId */
function handoffCommand(runId) {
  return {
    actor: { id: 'AUTOMATION_EXECUTOR', kind: 'AUTOMATION_EXECUTOR' },
    assignedUserId: `seller-${runId}`,
    automationContext: {
      executionId: `execution-${runId}`,
      workflowKey: 'handoff-workflow',
      workflowVersion: 'v1',
    },
    automationEpoch: 2,
    conversationId: `conversation-${runId}`,
    correlationId: `handoff-correlation-${runId}`,
    dealId: `deal-${runId}`,
    expectedConversationVersion: 1,
    expectedDealVersion: 1,
    idempotencyKey: `handoff-key-${runId}`,
    reasonCode: 'price_before_quote',
    summary: 'Maria Canary pediu atendimento humano.',
  };
}

/** @param {string} runId */
function human(runId) {
  return { functionName: 'Vendedor', id: `seller-${runId}`, kind: 'human' };
}

/** @param {Pool} pool @param {string} runId */
async function seed(pool, runId) {
  await pool.query(
    `INSERT INTO crm.users (id, email, password_hash, created_at)
     VALUES ($1, $2, '$argon2id$fixture', $3)`,
    [`seller-${runId}`, `${runId}@example.test`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.user_functions (user_id, function_name, assigned_at)
     VALUES ($1, 'Vendedor', $2)`,
    [`seller-${runId}`, NOW],
  );
  await pool.query(
    `INSERT INTO crm.contacts (id, provisional, version, created_at, updated_at)
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
      'b'.repeat(64),
      JSON.stringify({ algorithm: 'AES-256-GCM', keyVersion: 1, version: 1 }),
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.conversations
       (id, contact_identity_id, provider, provider_account_id,
        external_conversation_id, cycle_number, state, automation_state,
        automation_epoch, version, opened_at, last_message_at)
     VALUES ($1, $2, 'meta', $3, $4, 1, 'requer_atencao', 'assistant', 2, 1, $5, $5)`,
    [
      `conversation-${runId}`,
      `identity-${runId}`,
      `account-${runId}`,
      `external-${runId}`,
      NOW,
    ],
  );
  await pool.query(
    `INSERT INTO crm.deals
       (id, contact_id, source_conversation_id, stage, status, version, created_at, updated_at)
     VALUES ($1, $2, $3, 'produto', 'active', 1, $4, $4)`,
    [`deal-${runId}`, `contact-${runId}`, `conversation-${runId}`, NOW],
  );
}
