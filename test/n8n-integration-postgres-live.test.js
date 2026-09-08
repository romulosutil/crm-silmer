import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  PostgresN8nCommandOutbox,
  PostgresN8nIntegrationRepository,
  createN8nIntegrationService,
  createPostgresN8nCommandStore,
} from '../modules/n8n-integration/src/index.js';
import { encryptJson } from '../modules/n8n-integration/src/crypto.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-09-07T15:00:00.000Z');

if (connectionString) {
  test('PostgreSQL serializes inbound, AI claim and reserved send without duplicate effects', async () => {
    assert.equal(
      new URL(connectionString).pathname.slice(1),
      'crm_silmer_test',
    );
    const pool = new Pool({ connectionString, max: 24 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {(client: any) => Promise<any>} */ work) =>
        withTransaction(pool, work),
    };
    const integrationKey = Buffer.alloc(32, 71);
    let sequence = 0;
    let currentTime = NOW;
    const repository = new PostgresN8nIntegrationRepository({
      contactEnvelopeKey: Buffer.alloc(32, 72),
      contactLookupKey: Buffer.alloc(32, 73),
      database,
      envelopeKey: integrationKey,
      messageEnvelopeKey: Buffer.alloc(32, 74),
    });
    const service = createN8nIntegrationService({
      clock: () => currentTime,
      idFactory: (kind) => `${kind}-${++sequence}`,
      repository,
      tokenFactory: () => `claim-token-${++sequence}`,
    });
    /** @param {string} executionId @param {string} idempotencyKey */
    const technical = (executionId, idempotencyKey) => ({
      actor: 'AUTOMATION_EXECUTOR',
      correlationId: `correlation-${executionId}`,
      credentialVersion: 'current',
      executionId,
      idempotencyKey,
      requestId: `request-${executionId}`,
      workflowKey: 'seller-v1',
      workflowVersion: '1.0.0',
    });

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      const inbound = {
        briefing: { segment: 'uniform' },
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
        technical: technical('inbound-execution', 'wamid.inbound.1'),
      };
      const [first, replay] = await allValues([
        service.receiveInbound(inbound),
        service.receiveInbound(inbound),
      ]);
      assert.equal(first.conversation_id, replay.conversation_id);
      assert.equal(first.automation_epoch, 0);
      assert.equal(first.revision, 1);
      assert.deepEqual([first.duplicate, replay.duplicate].sort(), [
        false,
        true,
      ]);

      const claims = await allValues(
        Array.from({ length: 4 }, (_, index) =>
          service.claimAiTurn({
            automation_epoch: 0,
            claim_id: `claim-${index}`,
            conversation_id: first.conversation_id,
            last_event_id: inbound.event_id,
            revision: 1,
            schema_version: '1.0',
            technical: technical(`claim-execution-${index}`, `claim-${index}`),
            worker_id: `worker-${index}`,
          }),
        ),
      );
      const granted = claims.filter(({ claimed }) => claimed);
      assert.equal(granted.length, 1);
      assert.match(granted[0].claim_id, /^claim-[0-3]$/u);
      assert.equal(granted[0].automation_epoch, 0);
      assert.equal(granted[0].conversation_version, 1);

      const commandId = 'command-ai-1';
      const sendRequest = {
        automation_epoch: 0,
        claim_id: granted[0].claim_id,
        claim_token: granted[0].claim_token,
        command_id: commandId,
        conversation_id: first.conversation_id,
        event_id: 'send-request-1',
        event_type: 'message.send.requested',
        message: { text: 'Qual modelo você precisa?', type: 'text' },
        occurred_at: NOW.toISOString(),
        expected_version: granted[0].conversation_version,
        revision: granted[0].revision,
        schema_version: '1.0',
        technical: technical('send-execution-1', 'send-request-1'),
      };
      const authorized = await service.recordEvent(sendRequest);
      const sendReplay = await service.recordEvent(sendRequest);
      assert.equal(authorized.send_authorized, true);
      assert.equal(sendReplay.send_authorized, false);
      await service.recordEvent({
        automation_epoch: 0,
        claim_id: granted[0].claim_id,
        claim_token: granted[0].claim_token,
        command_id: commandId,
        event_id: 'sent-result-1',
        event_type: 'message.sent',
        external_message_id: 'wamid.outbound.1',
        message: { text: 'Qual modelo vocÃª precisa?', type: 'text' },
        occurred_at: NOW.toISOString(),
        expected_version: granted[0].conversation_version,
        revision: granted[0].revision,
        schema_version: '1.0',
        technical: technical('sent-execution-1', 'sent-result-1'),
      });
      await service.recordEvent({
        event_id: 'read-status-1',
        event_type: 'message.read',
        external_message_id: 'wamid.outbound.1',
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical('read-execution-1', 'read-status-1'),
      });
      await service.recordEvent({
        event_id: 'late-sent-status-1',
        event_type: 'message.sent',
        external_message_id: 'wamid.outbound.1',
        occurred_at: NOW.toISOString(),
        schema_version: '1.0',
        technical: technical('late-sent-execution-1', 'late-sent-status-1'),
      });

      currentTime = new Date(NOW.getTime() + 1_000);
      const secondInbound = await service.receiveInbound({
        ...inbound,
        event_id: 'wamid.inbound.2',
        message: {
          external_id: 'wamid.inbound.2',
          text: 'Preciso para outubro',
          type: 'text',
        },
        occurred_at: currentTime.toISOString(),
        technical: technical('inbound-execution-2', 'wamid.inbound.2'),
      });
      const expiring = await service.claimAiTurn({
        automation_epoch: 0,
        claim_id: 'claim-expiring',
        conversation_id: first.conversation_id,
        last_event_id: 'wamid.inbound.2',
        revision: secondInbound.revision,
        schema_version: '1.0',
        technical: technical('claim-expiring-execution', 'claim-expiring'),
        worker_id: 'worker-expiring',
      });
      assert.equal(expiring.claimed, true);
      currentTime = new Date(NOW.getTime() + 62_000);
      const reclaimed = await service.claimAiTurn({
        automation_epoch: 0,
        claim_id: 'claim-reclaimed',
        conversation_id: first.conversation_id,
        last_event_id: 'wamid.inbound.2',
        revision: secondInbound.revision,
        schema_version: '1.0',
        technical: technical('claim-reclaimed-execution', 'claim-reclaimed'),
        worker_id: 'worker-reclaimed',
      });
      assert.equal(reclaimed.claimed, true);
      assert.equal(reclaimed.claim_id, 'claim-reclaimed');

      const uncertainCommandId = 'command-ai-uncertain';
      const uncertainReservation = await service.recordEvent({
        automation_epoch: 0,
        claim_id: reclaimed.claim_id,
        claim_token: reclaimed.claim_token,
        command_id: uncertainCommandId,
        conversation_id: first.conversation_id,
        event_id: 'send-request-uncertain',
        event_type: 'message.send.requested',
        expected_version: reclaimed.conversation_version,
        message: { text: 'Mensagem com resultado incerto', type: 'text' },
        occurred_at: currentTime.toISOString(),
        revision: reclaimed.revision,
        schema_version: '1.0',
        technical: technical(
          'send-execution-uncertain',
          'send-request-uncertain',
        ),
      });
      assert.equal(uncertainReservation.send_authorized, true);
      currentTime = new Date(NOW.getTime() + 123_000);
      const blockedReclaim = await service.claimAiTurn({
        automation_epoch: 0,
        claim_id: 'claim-after-uncertain-effect',
        conversation_id: first.conversation_id,
        last_event_id: 'wamid.inbound.2',
        revision: secondInbound.revision,
        schema_version: '1.0',
        technical: technical(
          'claim-after-uncertain-effect',
          'claim-after-uncertain-effect',
        ),
        worker_id: 'worker-after-uncertain-effect',
      });
      assert.equal(blockedReclaim.claimed, false);
      assert.equal(blockedReclaim.reason, 'EFFECT_OUTCOME_UNKNOWN');

      const uncertainState = await pool.query(
        `SELECT turn.effect_state, turn.status AS turn_status,
                message.delivery_status,
                attempt.status AS attempt_status
         FROM crm.ai_turns AS turn
         JOIN crm.messages AS message
           ON message.command_id = turn.effect_command_id
         JOIN crm.message_delivery_attempts AS attempt
           ON attempt.message_id = message.id
         WHERE turn.id = $1`,
        [reclaimed.claim_id],
      );
      assert.deepEqual(uncertainState.rows[0], {
        attempt_status: 'outcome_unknown',
        delivery_status: 'outcome_unknown',
        effect_state: 'outcome_unknown',
        turn_status: 'failed',
      });

      currentTime = new Date(NOW.getTime() + 124_000);
      const humanMessageId = 'human-message-1';
      const humanCommandId = 'human-command-1';
      await database.transaction(async (/** @type {any} */ client) => {
        await client.query(
          `UPDATE crm.conversations
           SET automation_state = 'human', automation_epoch = 1,
               state = 'em_atendimento', version = version + 1
           WHERE id = $1`,
          [first.conversation_id],
        );
        await client.query(
          `INSERT INTO crm.messages
             (id, conversation_id, provider, provider_account_id, command_id,
              direction, author_kind, author_id, message_type,
              content_envelope, key_version, status, occurred_at, created_at,
              automation_epoch)
           SELECT $1, id, provider, provider_account_id, $2, 'outbound',
                  'human', 'seller-1', 'text', $3::jsonb, 1, 'queued', $4, $4, 1
           FROM crm.conversations WHERE id = $5`,
          [
            humanMessageId,
            humanCommandId,
            JSON.stringify(
              encryptJson(
                { text: 'Vou preparar seu orÃ§amento.' },
                `message:${humanMessageId}`,
                Buffer.alloc(32, 74),
              ),
            ),
            currentTime,
            first.conversation_id,
          ],
        );
        await new PostgresN8nCommandOutbox({
          contactEnvelopeKey: Buffer.alloc(32, 72),
          envelopeKey: integrationKey,
          messageEnvelopeKey: Buffer.alloc(32, 74),
        }).enqueueChannelMessage(
          {
            availableAt: currentTime,
            id: 'human-command-job-1',
            idempotencyKey: humanCommandId,
            messageId: humanMessageId,
          },
          { transaction: client },
        );
      });
      const commandStore = createPostgresN8nCommandStore({
        database,
        envelopeKey: integrationKey,
      });
      const stored = await commandStore.loadForDelivery(humanCommandId, {
        now: currentTime,
      });
      assert.equal(stored.commandId, humanCommandId);
      assert.equal(
        await commandStore.markProcessing(humanCommandId, {
          attemptId: 'human-attempt-1',
          now: currentTime,
          payloadHash: stored.payloadHash,
        }),
        true,
      );
      const humanAuthorization = await service.recordEvent({
        automation_epoch: 1,
        command_id: humanCommandId,
        conversation_id: first.conversation_id,
        event_id: 'human-send-request-1',
        event_type: 'message.send.requested',
        message: stored.payload.message,
        occurred_at: currentTime.toISOString(),
        schema_version: '1.0',
        technical: technical('human-send-execution-1', 'human-send-request-1'),
      });
      assert.equal(humanAuthorization.send_authorized, true);
      await service.recordEvent({
        automation_epoch: 1,
        command_id: humanCommandId,
        event_id: 'human-sent-result-1',
        event_type: 'message.sent',
        external_message_id: 'wamid.human.outbound.1',
        message: stored.payload.message,
        occurred_at: currentTime.toISOString(),
        schema_version: '1.0',
        technical: technical('human-sent-execution-1', 'human-sent-result-1'),
      });
      assert.equal(
        await commandStore.markDelivered(humanCommandId, {
          attemptId: 'human-attempt-1',
          now: currentTime,
          providerExternalId: 'wamid.human.outbound.1',
        }),
        true,
      );

      const expiredCommandId = 'human-command-expired';
      const expiredMessageId = 'human-message-expired';
      await database.transaction(async (/** @type {any} */ client) => {
        await client.query(
          `INSERT INTO crm.messages
             (id, conversation_id, provider, provider_account_id, command_id,
              direction, author_kind, author_id, message_type,
              content_envelope, key_version, status, occurred_at, created_at,
              automation_epoch)
           SELECT $1, id, provider, provider_account_id, $2, 'outbound',
                  'human', 'seller-1', 'text', $3::jsonb, 1, 'queued', $4, $4, 1
           FROM crm.conversations WHERE id = $5`,
          [
            expiredMessageId,
            expiredCommandId,
            JSON.stringify(
              encryptJson(
                { text: 'Mensagem com lease interrompido.' },
                `message:${expiredMessageId}`,
                Buffer.alloc(32, 74),
              ),
            ),
            currentTime,
            first.conversation_id,
          ],
        );
        await new PostgresN8nCommandOutbox({
          contactEnvelopeKey: Buffer.alloc(32, 72),
          envelopeKey: integrationKey,
          messageEnvelopeKey: Buffer.alloc(32, 74),
        }).enqueueChannelMessage(
          {
            availableAt: currentTime,
            id: 'expired-command-job-1',
            idempotencyKey: expiredCommandId,
            messageId: expiredMessageId,
          },
          { transaction: client },
        );
      });
      const expiringCommand = await commandStore.loadForDelivery(
        expiredCommandId,
        { now: currentTime },
      );
      assert.equal(
        await commandStore.markProcessing(expiredCommandId, {
          attemptId: 'crashed-attempt-1',
          leaseMs: 1_000,
          now: currentTime,
          payloadHash: expiringCommand.payloadHash,
        }),
        true,
      );
      assert.equal(
        await commandStore.loadForDelivery(expiredCommandId, {
          now: new Date(currentTime.getTime() + 1_001),
        }),
        null,
      );

      const counts = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM crm.conversations) AS conversations,
           (SELECT count(*)::integer FROM crm.messages) AS messages,
           (SELECT count(*)::integer FROM crm.ai_turns) AS ai_turns,
           (SELECT count(*)::integer FROM crm.automation_runs) AS runs,
           (SELECT count(*)::integer FROM crm.n8n_commands) AS commands,
           (SELECT count(*)::integer FROM crm.message_delivery_attempts)
             AS delivery_attempts`,
      );
      assert.deepEqual(counts.rows[0], {
        ai_turns: 3,
        commands: 2,
        conversations: 1,
        delivery_attempts: 3,
        messages: 6,
        runs: 9,
      });
      assert.equal(
        (
          await pool.query(
            `SELECT delivery_status FROM crm.messages
             WHERE external_message_id = 'wamid.outbound.1'`,
          )
        ).rows[0].delivery_status,
        'read',
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT command.status, reconciliation.status AS reconciliation
             FROM crm.n8n_commands AS command
             JOIN crm.outbox_jobs AS job
               ON job.n8n_command_id = command.command_id
             JOIN crm.reconciliation_items AS reconciliation
               ON reconciliation.job_id = job.id
             WHERE command.command_id = $1`,
            [expiredCommandId],
          )
        ).rows[0],
        { reconciliation: 'open', status: 'outcome_unknown' },
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
