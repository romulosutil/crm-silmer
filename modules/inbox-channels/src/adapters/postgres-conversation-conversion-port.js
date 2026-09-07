import { InboxConflictError } from '../domain/errors.js';
import { freezeInboxRecord } from '../domain/inbox.js';

/** @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable */

/** @param {unknown} candidate @param {string} field @returns {Queryable} */
function requireQueryable(candidate, field) {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (candidate).query) !==
      'function'
  ) {
    throw new TypeError(`${field} must implement query`);
  }
  return /** @type {Queryable} */ (candidate);
}

/**
 * Transaction-scoped Inbox port used by the cross-context conversion
 * coordinator. It is the only T03.1 adapter allowed to mutate conversations.
 */
export class PostgresConversationConversionPort {
  /** @param {{conversationId: string, expectedVersion: number, actorKind: string, automationEpoch?: number}} input @param {{transaction: any}} context */
  async lockForConversion(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const selected = await transaction.query(
      `SELECT id, contact_identity_id, state, automation_state,
              automation_epoch, version, terminal_at
       FROM crm.conversations
       WHERE id = $1
       FOR UPDATE`,
      [input.conversationId],
    );
    const conversation = selected.rows[0];
    if (!conversation)
      throw new InboxConflictError('Conversation was not found');
    if (
      Number(conversation.version) !== input.expectedVersion ||
      conversation.terminal_at !== null
    ) {
      throw new InboxConflictError(
        'Conversation changed before it could be converted',
      );
    }
    if (
      input.actorKind === 'AUTOMATION_EXECUTOR' &&
      (conversation.automation_state !== 'assistant' ||
        Number(conversation.automation_epoch) !== input.automationEpoch)
    ) {
      throw new InboxConflictError(
        'Automation command is stale or the conversation is under human control',
      );
    }
    return mapConversionConversation(conversation);
  }

  /** @param {{conversationId: string, expectedVersion: number, occurredAt: string, actorKind: string, automationEpoch?: number}} input @param {{transaction: any}} context */
  async completeConversion(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const automated = input.actorKind === 'AUTOMATION_EXECUTOR';
    const updated = await transaction.query(
      `UPDATE crm.conversations
       SET state = 'convertida_em_lead', terminal_at = $2,
           last_message_at = GREATEST(last_message_at, $2),
           version = version + 1
       WHERE id = $1 AND version = $3 AND terminal_at IS NULL
         ${
           automated
             ? "AND automation_state = 'assistant' AND automation_epoch = $4"
             : ''
         }
       RETURNING id, contact_identity_id, state, version, terminal_at`,
      automated
        ? [
            input.conversationId,
            input.occurredAt,
            input.expectedVersion,
            input.automationEpoch,
          ]
        : [input.conversationId, input.occurredAt, input.expectedVersion],
    );
    if (!updated.rows[0]) {
      throw new InboxConflictError(
        'Conversation changed before it could be converted',
      );
    }
    return mapConversionConversation(updated.rows[0]);
  }
}

/** @param {any} row */
function mapConversionConversation(row) {
  return freezeInboxRecord({
    id: row.id,
    identityId: row.contact_identity_id,
    state: row.state,
    terminalAt: row.terminal_at === null ? null : iso(row.terminal_at),
    version: Number(row.version),
  });
}

/** @param {string|Date} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
