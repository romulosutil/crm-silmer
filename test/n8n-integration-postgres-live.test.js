import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresN8nIntegrationRepository,
  createN8nIntegrationService,
} from '../modules/n8n-integration/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-08T15:00:00.000Z');

if (connectionString) {
  test('PostgreSQL folds revision fencing, briefing and delivery into the MVP model', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 12 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {(client: any) => Promise<any>} */ work) =>
        withTransaction(pool, work),
    };
    let sequence = 0;
    const service = createN8nIntegrationService({
      clock: () => NOW,
      idFactory: (kind) => `${kind}-${++sequence}`,
      repository: new PostgresN8nIntegrationRepository({
        contactEnvelopeKey: Buffer.alloc(32, 72),
        contactLookupKey: Buffer.alloc(32, 73),
        database,
        envelopeKey: Buffer.alloc(32, 71),
        messageEnvelopeKey: Buffer.alloc(32, 74),
      }),
    });
    /** @param {string} executionId @param {string} idempotencyKey */
    const technical = (executionId, idempotencyKey) => ({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${executionId}`,
      credentialVersion: 'current',
      executionId,
      idempotencyKey,
      requestId: `request-${executionId}`,
      workflowKey: 'whatsapp-mvp',
      workflowVersion: 'mvp-simple-1',
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      const inbound = {
        channel: 'whatsapp',
        contact: { name: 'Synthetic', wa_id: '5527999999999' },
        event_id: 'wamid.inbound.1',
        message: {
          external_id: 'wamid.inbound.1',
          text: 'Quero trinta camisas',
          type: 'text',
        },
        metadata: { phone_number_id: 'phone-account-1' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical('inbound-1', 'wamid.inbound.1'),
      };
      const [first, replay] = await allValues([
        service.receiveInbound(inbound),
        service.receiveInbound(inbound),
      ]);
      assert.equal(first.conversation_id, replay.conversation_id);
      assert.equal(first.source_revision, 1);
      assert.deepEqual([first.duplicate, replay.duplicate].sort(), [
        false,
        true,
      ]);

      // The Inbox goes live off crm.domain_events. This integration owns its
      // own persistence path, so an inbound message that lands here without an
      // event leaves every open panel silently stale.
      const inboundStream = await pool.query(
        `SELECT event_type FROM crm.domain_events
         WHERE aggregate_type = 'conversation' AND aggregate_id = $1`,
        [first.conversation_id],
      );
      assert.deepEqual(
        inboundStream.rows.map((/** @type {any} */ row) => row.event_type),
        ['conversation.message_received'],
      );

      const reservation = {
        automation_epoch: first.automation_epoch,
        briefing_patch: { quantity: 30, segment: 'uniform' },
        command_id: 'command-ai-1',
        conversation_id: first.conversation_id,
        event_id: 'send-request-1',
        event_type: 'message.send.requested',
        message: { text: 'Qual modelo voce precisa?', type: 'text' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: first.source_revision,
        technical: technical('send-1', 'send-request-1'),
      };
      assert.equal(
        (await service.recordEvent(reservation)).send_authorized,
        true,
      );
      assert.equal(
        (await service.recordEvent(reservation)).send_authorized,
        false,
      );

      await assert.rejects(
        service.recordEvent({
          ...reservation,
          command_id: 'command-ai-2',
          event_id: 'send-request-2',
          technical: technical('send-2', 'send-request-2'),
        }),
        /stale|already processed/iu,
      );

      await service.recordEvent({
        command_id: reservation.command_id,
        conversation_id: first.conversation_id,
        event_id: 'sent-1',
        event_type: 'message.sent',
        external_message_id: 'wamid.outbound.1',
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical('sent-1', 'sent-1'),
      });
      for (const eventType of [
        'message.read',
        'message.delivered',
        'message.sent',
      ]) {
        await service.recordEvent({
          command_id: reservation.command_id,
          conversation_id: first.conversation_id,
          event_id: `${eventType}-1`,
          event_type: eventType,
          external_message_id: 'wamid.outbound.1',
          occurred_at: NOW.toISOString(),
          schema_version: '1.0',
          technical: technical(`${eventType}-1`, `${eventType}-1`),
        });
      }

      const state = await pool.query(
        `SELECT conversation.briefing_version, conversation.claimed_revision,
                conversation.inbound_revision, message.delivery_status,
                message.status
         FROM crm.conversations AS conversation
         JOIN crm.messages AS message ON message.conversation_id = conversation.id
         WHERE message.command_id = 'command-ai-1'`,
      );
      assert.deepEqual(state.rows[0], {
        briefing_version: '1',
        claimed_revision: '1',
        delivery_status: 'read',
        inbound_revision: '1',
        status: 'sent',
      });

      const secondInbound = await service.receiveInbound({
        ...inbound,
        event_id: 'wamid.inbound.2',
        message: {
          external_id: 'wamid.inbound.2',
          text: 'Quero negociar com uma pessoa',
          type: 'text',
        },
        technical: technical('inbound-2', 'wamid.inbound.2'),
      });
      const handoff = await service.recordEvent({
        automation_epoch: secondInbound.automation_epoch,
        conversation_id: secondInbound.conversation_id,
        event_id: 'handoff-1',
        event_type: 'handoff.requested',
        handoff: {
          reason: 'negotiation',
          summary: 'Cliente pediu negociação.',
        },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: secondInbound.source_revision,
        technical: technical('handoff-1', 'handoff-1'),
      });
      assert.match(handoff.handoff_id, /^handoff-/u);
      const handoffState = await pool.query(
        `SELECT handoff.assigned_user_id, handoff.status, handoff.target_role,
                conversation.automation_epoch, conversation.state,
                history.to_status
         FROM crm.handoffs AS handoff
         JOIN crm.conversations AS conversation
           ON conversation.id = handoff.conversation_id
         JOIN crm.handoff_history AS history
           ON history.handoff_id = handoff.id
         WHERE handoff.id = $1`,
        [handoff.handoff_id],
      );
      assert.deepEqual(handoffState.rows[0], {
        assigned_user_id: null,
        automation_epoch: '1',
        state: 'requer_atencao',
        status: 'pending',
        target_role: 'Vendedor',
        to_status: 'pending',
      });

      const counts = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.contacts) AS contacts,
           (SELECT count(*)::integer FROM crm.conversations) AS conversations,
           (SELECT count(*)::integer FROM crm.messages) AS messages,
           (SELECT count(*)::integer FROM crm.ai_turns) AS dormant_ai_turns,
           (SELECT count(*)::integer FROM crm.automation_runs) AS dormant_runs,
           (SELECT count(*)::integer FROM crm.conversation_briefing_versions)
             AS dormant_briefing_versions,
           (SELECT count(*)::integer FROM crm.message_delivery_attempts)
             AS dormant_delivery_attempts,
           (SELECT count(*)::integer FROM crm.handoffs) AS handoffs,
           (SELECT count(*)::integer FROM crm.handoff_history)
             AS handoff_history`,
      );
      assert.deepEqual(counts.rows[0], {
        contacts: 1,
        conversations: 1,
        dormant_ai_turns: 0,
        dormant_briefing_versions: 0,
        dormant_delivery_attempts: 0,
        dormant_runs: 0,
        handoff_history: 1,
        handoffs: 1,
        messages: 3,
      });
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}

/** @param {Promise<any>[]} promises */
async function allValues(promises) {
  const settled = await Promise.allSettled(promises);
  const rejected = settled.find(({ status }) => status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  return settled.map((result) =>
    result.status === 'fulfilled' ? result.value : undefined,
  );
}
