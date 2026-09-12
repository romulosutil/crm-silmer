import { InboxConflictError } from '../domain/errors.js';

export class PostgresHandoffConversationPort {
  /** @param {{conversationId: string, expectedVersion: number, contactId: string, automationEpoch?: number, requireAutomationFence?: boolean}} input @param {{transaction: any}} context */
  async lock(input, context) {
    const database = queryable(context);
    const result = await database.query(
      `SELECT conversation.id, conversation.version, conversation.state,
              conversation.automation_state, conversation.automation_epoch,
              conversation.assigned_user_id, conversation.terminal_at,
              identity.current_contact_id
       FROM crm.conversations AS conversation
       JOIN crm.contact_identities AS identity
         ON identity.id = conversation.contact_identity_id
       WHERE conversation.id = $1
       FOR UPDATE OF conversation`,
      [input.conversationId],
    );
    const value = mapConversation(result.rows[0]);
    if (
      value.version !== input.expectedVersion ||
      value.terminalAt ||
      value.contactId !== input.contactId
    ) {
      throw new InboxConflictError('Conversation version or contact conflicts');
    }
    if (
      input.requireAutomationFence &&
      (value.automationState !== 'assistant' ||
        value.automationEpoch !== input.automationEpoch)
    ) {
      throw new InboxConflictError('Automation fence is stale');
    }
    return value;
  }

  /** @param {{conversation: any, assignedUserId: string, occurredAt: string, incrementEpoch: boolean}} input @param {{transaction: any}} context */
  async assignHuman(input, context) {
    const database = queryable(context);
    const updated = await database.query(
      `UPDATE crm.conversations
       SET automation_state = 'human',
           automation_epoch = automation_epoch + CASE WHEN $3 THEN 1 ELSE 0 END,
           assigned_user_id = $4,
           state = 'em_atendimento',
           version = version + 1,
           last_message_at = GREATEST(last_message_at, $5)
       WHERE id = $1 AND version = $2 AND terminal_at IS NULL
       RETURNING id, version, state, automation_state, automation_epoch,
                 assigned_user_id, terminal_at`,
      [
        input.conversation.id,
        input.conversation.version,
        input.incrementEpoch,
        input.assignedUserId,
        input.occurredAt,
      ],
    );
    if (updated.rows.length !== 1) throw new InboxConflictError();
    return mapConversation({
      ...updated.rows[0],
      current_contact_id: input.conversation.contactId,
    });
  }
}

/** @param {any} context */
function queryable(context) {
  if (
    !context?.transaction ||
    typeof context.transaction.query !== 'function'
  ) {
    throw new TypeError('context.transaction must implement query');
  }
  return context.transaction;
}

/** @param {any} row */
function mapConversation(row) {
  if (!row) throw new InboxConflictError('Stored conversation was not found');
  return Object.freeze({
    assignedUserId: row.assigned_user_id,
    automationEpoch: Number(row.automation_epoch),
    automationState: row.automation_state,
    contactId: row.current_contact_id,
    id: row.id,
    state: row.state,
    terminalAt: row.terminal_at
      ? new Date(row.terminal_at).toISOString()
      : null,
    version: Number(row.version),
  });
}
