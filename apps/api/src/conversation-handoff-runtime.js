import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { PostgresOperationalUserPort } from '@crm-silmer/identity-access';
import {
  createIdempotentCommandExecutor,
  PostgresDomainEventStore,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';

/**
 * Owns the human handoff lifecycle for a conversation. A handoff is not a
 * commercial object: it is an operational request associated only with the
 * conversation that needs a person.
 *
 * @param {any} database
 * @param {{environment?: Record<string, string|undefined>}} [options]
 */
export function createConversationHandoffRuntime(database, options = {}) {
  if (!database || typeof database.transaction !== 'function') {
    throw new TypeError('A transactional PostgreSQL database is required');
  }
  const environment = options.environment ?? process.env;
  const execute = createIdempotentCommandExecutor({
    auditTrail: /** @type {any} */ (new PostgresAuditTrail(database)),
    idempotencyStore: new PostgresIdempotencyRecordStore({
      database,
      envelopeKey: readEnvelopeKey(
        environment.IDEMPOTENCY_ENVELOPE_KEY,
        'IDEMPOTENCY_ENVELOPE_KEY',
      ),
    }),
  });
  const eventPort = new PostgresDomainEventStore();
  const users = new PostgresOperationalUserPort();

  return Object.freeze({
    /** @param {any} input */
    async claimHandoff(input) {
      validateClaim(input);
      const reasonCode = input.reasonCode ?? 'handoff_claimed';
      return execute(
        {
          action: 'handoff.claim',
          actor: input.actor.id,
          command: compactJson({
            expectedConversationVersion: input.expectedConversationVersion,
            expectedHandoffVersion: input.expectedHandoffVersion,
          }),
          correlationId: input.correlationId,
          key: input.idempotencyKey,
          reason: reasonCode,
          target: { id: input.handoffId, type: 'handoff' },
          version: `${input.expectedHandoffVersion}->${input.expectedHandoffVersion + 1}`,
        },
        async (transaction) => {
          const result = await claimConversationHandoff(transaction, users, {
            ...input,
            occurredAt: new Date().toISOString(),
            reasonCode,
          });
          await eventPort.append(
            {
              aggregateId: result.handoff.id,
              aggregateType: 'handoff',
              aggregateVersion: result.handoff.version,
              correlationId: input.correlationId,
              occurredAt: new Date(),
              payload: {
                assignedUserId: result.handoff.assignedUserId,
                conversationId: result.handoff.conversationId,
                status: result.handoff.status,
                targetRole: result.handoff.targetRole,
                version: result.handoff.version,
              },
              type: 'handoff.claimed',
            },
            { transaction },
          );
          return result;
        },
      );
    },
  });
}

/** @param {any} transaction @param {any} users @param {any} input */
async function claimConversationHandoff(transaction, users, input) {
  const locator = (
    await transaction.query(
      'SELECT conversation_id FROM crm.handoffs WHERE id = $1',
      [input.handoffId],
    )
  ).rows[0];
  if (!locator) throw conflict('Handoff was not found');

  const conversation = (
    await transaction.query(
      'SELECT * FROM crm.conversations WHERE id = $1 FOR UPDATE',
      [locator.conversation_id],
    )
  ).rows[0];
  if (!conversation) throw conflict('Conversation was not found');
  if (
    input.expectedConversationVersion !== undefined &&
    Number(conversation.version) !== input.expectedConversationVersion
  ) {
    throw conflict('Conversation was changed');
  }

  const user = await users.lockActive(
    { userId: input.actor.id },
    { transaction },
  );
  if (!user) throw invalid('Assignee is unavailable');

  const row = (
    await transaction.query(
      'SELECT * FROM crm.handoffs WHERE id = $1 FOR UPDATE',
      [input.handoffId],
    )
  ).rows[0];
  const handoff = mapHandoff(row);
  if (
    handoff.version !== input.expectedHandoffVersion ||
    handoff.status !== 'pending' ||
    handoff.assignedUserId !== null
  ) {
    throw conflict('Handoff was already claimed');
  }
  if (user.functionName !== handoff.targetRole) throw forbidden();
  if (conversation.automation_state !== 'human' || conversation.terminal_at) {
    throw conflict('Conversation is not awaiting a human');
  }

  const changedConversation = (
    await transaction.query(
      `UPDATE crm.conversations
       SET assigned_user_id = $2, state = 'em_atendimento', version = version + 1
       WHERE id = $1 AND automation_state = 'human' AND terminal_at IS NULL
       RETURNING id, automation_state, automation_epoch, assigned_user_id,
                 state, version, terminal_at`,
      [handoff.conversationId, user.id],
    )
  ).rows[0];
  if (!changedConversation) throw conflict();

  const changedHandoff = mapHandoff(
    (
      await transaction.query(
        `UPDATE crm.handoffs
         SET assigned_user_id = $3, status = 'accepted', version = version + 1,
             updated_at = $4
         WHERE id = $1 AND version = $2 AND status = 'pending'
           AND assigned_user_id IS NULL
         RETURNING *`,
        [handoff.id, handoff.version, user.id, input.occurredAt],
      )
    ).rows[0],
  );
  await transaction.query(
    `INSERT INTO crm.handoff_history
       (handoff_id, resulting_version, from_status, to_status, assigned_user_id,
        target_role, actor_id, reason_code, correlation_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      changedHandoff.id,
      changedHandoff.version,
      handoff.status,
      changedHandoff.status,
      changedHandoff.assignedUserId,
      changedHandoff.targetRole,
      input.actor.id,
      input.reasonCode,
      input.correlationId,
      input.occurredAt,
    ],
  );
  return Object.freeze({
    conversation: Object.freeze({
      assignedUserId: changedConversation.assigned_user_id,
      automationEpoch: Number(changedConversation.automation_epoch),
      automationState: changedConversation.automation_state,
      id: changedConversation.id,
      state: changedConversation.state,
      terminalAt: null,
      version: Number(changedConversation.version),
    }),
    handoff: changedHandoff,
  });
}

/** @param {any} input */
function validateClaim(input) {
  if (!input || typeof input !== 'object') throw invalid();
  if (
    input.actor?.kind !== 'human' ||
    input.actor.functionName !== 'Vendedor'
  ) {
    throw forbidden();
  }
  for (const [value, name] of [
    [input.handoffId, 'handoffId'],
    [input.actor.id, 'actor.id'],
    [input.correlationId, 'correlationId'],
    [input.idempotencyKey, 'idempotencyKey'],
  ]) {
    if (typeof value !== 'string' || value.trim() === '')
      throw invalid(`${name} is required`);
  }
  if (
    !Number.isSafeInteger(input.expectedHandoffVersion) ||
    input.expectedHandoffVersion < 1
  ) {
    throw invalid('expectedHandoffVersion is invalid');
  }
  if (
    input.expectedConversationVersion !== undefined &&
    (!Number.isSafeInteger(input.expectedConversationVersion) ||
      input.expectedConversationVersion < 1)
  ) {
    throw invalid('expectedConversationVersion is invalid');
  }
  if (
    input.reasonCode !== undefined &&
    input.reasonCode !== 'handoff_claimed'
  ) {
    throw invalid('reasonCode is invalid');
  }
}

/** @param {any} row */
function mapHandoff(row) {
  if (!row) throw conflict('Stored handoff was not found');
  return Object.freeze({
    assignedUserId: row.assigned_user_id,
    conversationId: row.conversation_id,
    id: row.id,
    status: row.status,
    targetRole: row.target_role,
    version: Number(row.version),
  });
}

/** @param {any} value */
function compactJson(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  );
}

/** @param {string} [message] */
function conflict(message = 'Conversation handoff conflict') {
  return Object.assign(new Error(message), {
    code: 'INBOX_CONFLICT',
    statusCode: 409,
  });
}

/** @param {string} [message] */
function invalid(message = 'Invalid handoff command') {
  return Object.assign(new Error(message), {
    code: 'HANDOFF_INVALID',
    statusCode: 422,
  });
}

function forbidden() {
  return Object.assign(new Error('Forbidden'), {
    code: 'HANDOFF_FORBIDDEN',
    statusCode: 403,
  });
}

/** @param {string|undefined} value @param {string} name */
function readEnvelopeKey(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`${name} must use base64url`);
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}
