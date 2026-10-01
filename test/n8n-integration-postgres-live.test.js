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
import {
  PostgresOrderConversationPort,
  PostgresOrderRepository,
  createOrderService,
} from '../modules/orders/src/index.js';

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
    const contactEnvelopeKey = Buffer.alloc(32, 72);
    const envelopeKey = Buffer.alloc(32, 71);
    const orders = createOrderService({
      authorizeOwnership: async () => {},
      conversations: new PostgresOrderConversationPort({
        contactEnvelopeKey,
        database,
        envelopeKey,
      }),
      fabCode: 'FAB-TEST',
      repository: new PostgresOrderRepository({ database, envelopeKey }),
    });
    const service = createN8nIntegrationService({
      clock: () => NOW,
      idFactory: (kind) => `${kind}-${++sequence}`,
      repository: new PostgresN8nIntegrationRepository({
        contactEnvelopeKey,
        contactLookupKey: Buffer.alloc(32, 73),
        database,
        envelopeKey,
        messageEnvelopeKey: Buffer.alloc(32, 74),
        orders,
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

      // T22/PAG-01: a pending order created before the agent's next briefing
      // patch must absorb that patch while the conversation is still with
      // the agent (message.send.requested's #mergeBriefing call site).
      const { order: pendingOnFirst } = await orders.ensurePendingFromIntent({
        conversationId: first.conversation_id,
        correlationId: 'correlation-order-1',
      });

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

      const projectedOnFirst = await orders.get(pendingOnFirst.id);
      assert.equal(projectedOnFirst.version, pendingOnFirst.version + 1);
      assert.equal(projectedOnFirst.ficha.serviceData.quantity, 30);
      assert.equal(projectedOnFirst.ficha.serviceData.segment, 'uniform');

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
      // T22/PAG-01: the handoff.requested #mergeBriefing call site also
      // projects, since automation_state is still 'assistant' at merge time
      // (the handoff itself flips it afterwards).
      const { order: pendingOnSecond } = await orders.ensurePendingFromIntent({
        conversationId: secondInbound.conversation_id,
        correlationId: 'correlation-order-2',
      });

      const handoff = await service.recordEvent({
        automation_epoch: secondInbound.automation_epoch,
        briefing_patch: { customer_name: 'Ana Horizonte' },
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
      const projectedOnSecond = await orders.get(pendingOnSecond.id);
      assert.equal(projectedOnSecond.version, pendingOnSecond.version + 1);
      assert.equal(projectedOnSecond.ficha.summary.cliente, 'Ana Horizonte');
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
      const contactName = await pool.query(
        `SELECT contact.display_name, contact.display_name_source
         FROM crm.contacts AS contact
         JOIN crm.contact_identities AS identity
           ON identity.current_contact_id = contact.id
         JOIN crm.conversations AS conversation
           ON conversation.contact_identity_id = identity.id
         WHERE conversation.id = $1`,
        [secondInbound.conversation_id],
      );
      assert.deepEqual(contactName.rows[0], {
        display_name: 'Ana Horizonte',
        display_name_source: 'automation',
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

  test('PostgreSQL seeds an order created after the agent reply with the merged briefing', async () => {
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
    const contactEnvelopeKey = Buffer.alloc(32, 72);
    const envelopeKey = Buffer.alloc(32, 71);
    const orders = createOrderService({
      authorizeOwnership: async () => {},
      conversations: new PostgresOrderConversationPort({
        contactEnvelopeKey,
        database,
        envelopeKey,
      }),
      fabCode: 'FAB-TEST',
      repository: new PostgresOrderRepository({ database, envelopeKey }),
    });
    const service = createN8nIntegrationService({
      clock: () => NOW,
      idFactory: (kind) => `${kind}-${++sequence}`,
      repository: new PostgresN8nIntegrationRepository({
        contactEnvelopeKey,
        contactLookupKey: Buffer.alloc(32, 73),
        database,
        envelopeKey,
        messageEnvelopeKey: Buffer.alloc(32, 74),
        orders,
      }),
    });
    /** @param {string} id */
    const technical = (id) => ({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${id}`,
      credentialVersion: 'current',
      executionId: id,
      idempotencyKey: id,
      requestId: `request-${id}`,
      workflowKey: 'whatsapp-mvp',
      workflowVersion: 'mvp-simple-1',
    });
    /** @param {string} waId */
    const inbound = (waId) =>
      service.receiveInbound({
        channel: 'whatsapp',
        contact: { name: 'Synthetic', wa_id: waId },
        event_id: `wamid.${waId}`,
        message: {
          external_id: `wamid.${waId}`,
          text: 'Pode fechar o pedido',
          type: 'text',
        },
        metadata: { phone_number_id: 'phone-account-1' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical(`inbound-${waId}`),
      });
    const briefingPatch = {
      order_name: 'Formatura 2026',
      product_type: 'camiseta',
      quantity: 30,
    };

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      // The MVP workflow posts the reply (or handoff) before
      // order.intent_confirmed on the same customer message: the reply's
      // projection finds no pending order yet, so the order the intent
      // creates must already carry the briefing that reply merged.
      const replied = await inbound('5527900000001');
      await service.recordEvent({
        automation_epoch: replied.automation_epoch,
        briefing_patch: briefingPatch,
        command_id: 'command-reply-first',
        conversation_id: replied.conversation_id,
        event_id: 'send-reply-first',
        event_type: 'message.send.requested',
        message: { text: 'Pedido anotado!', type: 'text' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: replied.source_revision,
        technical: technical('send-reply-first'),
      });
      const { order: afterReply } = await orders.ensurePendingFromIntent({
        conversationId: replied.conversation_id,
        correlationId: 'correlation-intent-reply-first',
      });
      assert.equal(afterReply.ficha.summary.nome, 'Formatura 2026');
      assert.equal(afterReply.ficha.items[0]?.tipo, 'camiseta');
      assert.equal(afterReply.ficha.serviceData.quantity, 30);

      // Same message ending in a handoff: automation_state leaves
      // 'assistant', so no later projection could fill the order.
      const handedOff = await inbound('5527900000002');
      await service.recordEvent({
        automation_epoch: handedOff.automation_epoch,
        briefing_patch: briefingPatch,
        conversation_id: handedOff.conversation_id,
        event_id: 'handoff-reply-first',
        event_type: 'handoff.requested',
        handoff: { reason: 'negotiation', summary: 'Cliente fechou pedido.' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: handedOff.source_revision,
        technical: technical('handoff-reply-first'),
      });
      const { order: afterHandoff } = await orders.ensurePendingFromIntent({
        conversationId: handedOff.conversation_id,
        correlationId: 'correlation-intent-handoff-first',
      });
      assert.equal(afterHandoff.ficha.summary.nome, 'Formatura 2026');
      assert.equal(afterHandoff.ficha.items[0]?.tipo, 'camiseta');
      assert.equal(afterHandoff.ficha.serviceData.quantity, 30);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });

  test('PostgreSQL caps automated messages and reserves the handoff notice (ADR 009)', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 4 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {(client: any) => Promise<any>} */ work) =>
        withTransaction(pool, work),
    };
    let sequence = 0;
    const service = createN8nIntegrationService({
      clock: () => NOW,
      idFactory: (kind) => `${kind}-cap-${++sequence}`,
      repository: new PostgresN8nIntegrationRepository({
        automationMessageCap: 3,
        database,
        envelopeKey: Buffer.alloc(32, 81),
        messageEnvelopeKey: Buffer.alloc(32, 82),
      }),
    });
    /** @param {string} id */
    const technical = (id) => ({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${id}`,
      credentialVersion: 'current',
      executionId: id,
      idempotencyKey: id,
      requestId: `request-${id}`,
      workflowKey: 'whatsapp-mvp',
      workflowVersion: 'mvp-simple-3',
    });
    /** @param {number} turn */
    const inbound = (turn) =>
      service.receiveInbound({
        channel: 'whatsapp',
        contact: { name: 'Synthetic', wa_id: '5527988887777' },
        event_id: `wamid.cap.${turn}`,
        message: {
          external_id: `wamid.cap.${turn}`,
          text: `Mensagem ${turn}`,
          type: 'text',
        },
        metadata: { phone_number_id: 'phone-account-cap' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical(`inbound-cap-${turn}`),
      });
    /** @param {any} context @param {number} turn */
    const reply = (context, turn) =>
      service.recordEvent({
        automation_epoch: context.automation_epoch,
        command_id: `command-cap-${turn}`,
        conversation_id: context.conversation_id,
        event_id: `send-cap-${turn}`,
        event_type: 'message.send.requested',
        message: { text: `Resposta ${turn}`, type: 'text' },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: context.source_revision,
        technical: technical(`send-cap-${turn}`),
      });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      for (const [id, name, disabled] of [
        ['user-seller-b', 'Marina Souza', false],
        ['user-seller-a', 'Edson Lima', false],
        ['user-seller-gone', 'Antigo Vendedor', true],
      ]) {
        await pool.query(
          `INSERT INTO crm.users (id, email, password_hash, name, disabled_at)
           VALUES ($1, $1 || '@example.test', '$argon2id$synthetic', $2, $3)`,
          [id, name, disabled ? NOW : null],
        );
        await pool.query(
          `INSERT INTO crm.user_functions (user_id, function_name)
           VALUES ($1, 'Vendedor')`,
          [id],
        );
      }

      const first = await inbound(1);
      assert.equal(first.automation_message_count, 0);
      assert.equal(first.automation_message_cap, 3);
      assert.deepEqual(first.sellers, [
        { id: 'user-seller-a', name: 'Edson' },
        { id: 'user-seller-b', name: 'Marina' },
      ]);
      assert.equal((await reply(first, 1)).send_authorized, true);

      const second = await inbound(2);
      assert.equal(second.automation_message_count, 1);
      assert.equal((await reply(second, 2)).send_authorized, true);

      // Two replies used, cap 3: the last slot belongs to the handoff notice.
      const third = await inbound(3);
      assert.equal(third.automation_message_count, 2);
      await assert.rejects(reply(third, 3), (error) => {
        assert.equal(/** @type {any} */ (error).code, 'AUTOMATION_MESSAGE_CAP');
        return true;
      });

      const handoffEvent = {
        automation_epoch: third.automation_epoch,
        conversation_id: third.conversation_id,
        event_id: 'handoff-cap',
        event_type: 'handoff.requested',
        handoff: {
          notice: {
            command_id: 'command-cap-notice',
            text: 'Vou encaminhar seu atendimento a um vendedor da Silmer.',
          },
          reason: 'iteration_limit',
          summary: 'Motivo: Limite de mensagens.',
        },
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        source_revision: third.source_revision,
        technical: technical('handoff-cap'),
      };
      const handoff = await service.recordEvent(handoffEvent);
      assert.match(handoff.handoff_id, /^handoff-cap-/u);
      assert.deepEqual(handoff.notice, {
        command_id: 'command-cap-notice',
        send_authorized: true,
      });
      const replay = await service.recordEvent(handoffEvent);
      assert.equal(replay.duplicate, true);
      assert.deepEqual(replay.notice, {
        command_id: 'command-cap-notice',
        send_authorized: false,
      });

      await service.recordEvent({
        command_id: 'command-cap-notice',
        conversation_id: third.conversation_id,
        event_id: 'sent-cap-notice',
        event_type: 'message.sent',
        external_message_id: 'wamid.cap.notice',
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical('sent-cap-notice'),
      });
      const stored = await pool.query(
        `SELECT handoff.reason_code, message.status, message.author_kind,
                conversation.automation_state
         FROM crm.handoffs AS handoff
         JOIN crm.conversations AS conversation
           ON conversation.id = handoff.conversation_id
         JOIN crm.messages AS message
           ON message.conversation_id = conversation.id
          AND message.command_id = 'command-cap-notice'
         WHERE handoff.id = $1`,
        [handoff.handoff_id],
      );
      assert.deepEqual(stored.rows[0], {
        author_kind: 'assistant',
        automation_state: 'human',
        reason_code: 'iteration_limit',
        status: 'sent',
      });
      assert.equal((await inbound(4)).automation_message_count, 3);

      // With the cap already spent, a later handoff still happens but sends
      // no notice.
      await pool.query(
        `UPDATE crm.handoffs SET status = 'resolved',
                assigned_user_id = 'user-seller-a', resolved_at = $2
         WHERE id = $1`,
        [handoff.handoff_id, NOW],
      );
      await pool.query(
        `UPDATE crm.conversations SET automation_state = 'assistant'
         WHERE id = $1`,
        [third.conversation_id],
      );
      const fifth = await inbound(5);
      const spent = await service.recordEvent({
        ...handoffEvent,
        automation_epoch: fifth.automation_epoch,
        event_id: 'handoff-cap-spent',
        handoff: {
          notice: { command_id: 'command-cap-notice-2', text: 'Aviso' },
          reason: 'price_before_quote',
          summary: 'Motivo: Perguntou o valor.',
        },
        source_revision: fifth.source_revision,
        technical: technical('handoff-cap-spent'),
      });
      assert.match(spent.handoff_id, /^handoff-cap-/u);
      assert.deepEqual(spent.notice, {
        command_id: null,
        send_authorized: false,
      });
      assert.equal((await inbound(6)).automation_message_count, 3);

      await assert.rejects(
        service.recordEvent({
          ...handoffEvent,
          event_id: 'handoff-bad-notice',
          handoff: {
            notice: { command_id: 'x', text: '  ' },
            reason: 'urgency',
          },
          technical: technical('handoff-bad-notice'),
        }),
        /handoff\.notice\.text/u,
      );
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
