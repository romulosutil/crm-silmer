import { decryptContactIdentityEnvelope } from '@crm-silmer/contacts/identity-envelope';
import { decryptInboxMessageEnvelope } from './postgres-inbox-repository.js';

export class PostgresInboxReadRepository {
  /** @param {{database: {query: Function, transaction?: Function}, contactEnvelopeKey: Buffer, messageEnvelopeKey: Buffer}} options */
  constructor({ database, contactEnvelopeKey, messageEnvelopeKey }) {
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('database.query is required');
    }
    for (const [value, name] of [
      [contactEnvelopeKey, 'contactEnvelopeKey'],
      [messageEnvelopeKey, 'messageEnvelopeKey'],
    ]) {
      if (!Buffer.isBuffer(value) || value.length !== 32) {
        throw new TypeError(`${name} must be a 32-byte Buffer`);
      }
    }
    this.database = database;
    this.contactEnvelopeKey = Buffer.from(contactEnvelopeKey);
    this.messageEnvelopeKey = Buffer.from(messageEnvelopeKey);
  }

  /** @param {Record<string, any>} input */
  async list(input) {
    return this.#snapshot(async (database) => {
      const values = [];
      const predicates = [];
      for (const [field, column] of [
        ['state', 'conversation.state'],
        ['channel', 'identity.channel'],
        ['automationState', 'conversation.automation_state'],
        ['assignedUserId', 'conversation.assigned_user_id'],
      ]) {
        if (input[field] === undefined) continue;
        values.push(input[field]);
        predicates.push(`${column} = $${values.length}`);
      }
      if (input.after) {
        values.push(input.after.updatedAt, input.after.id);
        predicates.push(
          `(conversation.last_message_at, conversation.id) < ($${values.length - 1}, $${values.length})`,
        );
      }
      const where = predicates.length ? predicates.join(' AND ') : 'true';
      const countValues = input.after ? values.slice(0, -2) : [...values];
      const countWhere =
        predicates
          .filter(
            (predicate) =>
              !predicate.startsWith('(conversation.last_message_at'),
          )
          .join(' AND ') || 'true';
      values.push(input.limit + 1);
      const [page, count] = await Promise.all([
        database.query(
          `SELECT conversation.id, conversation.state,
                  conversation.automation_state, conversation.automation_epoch,
                  conversation.assigned_user_id, conversation.version,
                  conversation.opened_at, conversation.last_message_at,
                  conversation.terminal_at,
                  identity.current_contact_id contact_id, identity.channel,
                  identity.external_identity_lookup_hash,
                  identity.identity_envelope,
                  assigned_function.function_name,
                  deal.id deal_id, deal.stage deal_stage, deal.status deal_status,
                  handoff.id handoff_id, handoff.status handoff_status,
                  handoff.target_role, handoff.due_at handoff_due_at,
                  last_message.id last_message_id,
                  last_message.direction last_message_direction,
                  last_message.message_type last_message_type,
                  last_message.content_envelope last_message_content_envelope,
                  last_message.status last_message_status,
                  last_message.delivery_status last_message_delivery_status,
                  last_message.occurred_at last_message_occurred_at
           FROM crm.conversations conversation
           JOIN crm.contact_identities identity
             ON identity.id=conversation.contact_identity_id
           LEFT JOIN crm.user_functions assigned_function
             ON assigned_function.user_id=conversation.assigned_user_id
           LEFT JOIN LATERAL (
             SELECT candidate.id, candidate.stage, candidate.status
             FROM crm.deals candidate
             WHERE candidate.source_conversation_id=conversation.id
             ORDER BY candidate.updated_at DESC, candidate.id DESC LIMIT 1
           ) deal ON true
           LEFT JOIN LATERAL (
             SELECT candidate.id, candidate.status, candidate.target_role,
                    candidate.due_at
             FROM crm.handoffs candidate
             WHERE candidate.conversation_id=conversation.id
               AND candidate.status IN ('pending','accepted')
             ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
           ) handoff ON true
           LEFT JOIN LATERAL (
             SELECT message.id, message.direction, message.message_type,
                    message.content_envelope, message.status,
                    message.delivery_status, message.occurred_at
             FROM crm.messages message
             WHERE message.conversation_id=conversation.id
             ORDER BY message.occurred_at DESC, message.id DESC LIMIT 1
           ) last_message ON true
           WHERE ${where}
           ORDER BY conversation.last_message_at DESC, conversation.id DESC
           LIMIT $${values.length}`,
          values,
        ),
        database.query(
          `SELECT count(*)::integer count
           FROM crm.conversations conversation
           JOIN crm.contact_identities identity
             ON identity.id=conversation.contact_identity_id
           WHERE ${countWhere}`,
          countValues,
        ),
      ]);
      const hasMore = page.rows.length > input.limit;
      return {
        hasMore,
        items: page.rows
          .slice(0, input.limit)
          .map((/** @type {any} */ row) => mapConversationSummary(row, this)),
        totalCount: Number(count.rows[0]?.count ?? 0),
      };
    });
  }

  /** @param {string} conversationId */
  async get(conversationId) {
    return this.#snapshot(async (database) => {
      const [conversation, messages, suggestion] = await runSequential([
        () =>
          database.query(
            `SELECT conversation.id, conversation.state,
                    conversation.automation_state, conversation.automation_epoch,
                    conversation.assigned_user_id, conversation.version,
                    conversation.opened_at, conversation.last_message_at,
                    conversation.terminal_at,
                    identity.current_contact_id contact_id, identity.channel,
                    identity.external_identity_lookup_hash,
                    identity.identity_envelope,
                    assigned_function.function_name,
                    deal.id deal_id, deal.stage deal_stage, deal.status deal_status,
                    handoff.id handoff_id, handoff.status handoff_status,
                    handoff.target_role, handoff.due_at handoff_due_at
             FROM crm.conversations conversation
             JOIN crm.contact_identities identity
               ON identity.id=conversation.contact_identity_id
             LEFT JOIN crm.user_functions assigned_function
               ON assigned_function.user_id=conversation.assigned_user_id
             LEFT JOIN LATERAL (
               SELECT candidate.id, candidate.stage, candidate.status
               FROM crm.deals candidate
               WHERE candidate.source_conversation_id=conversation.id
               ORDER BY candidate.updated_at DESC, candidate.id DESC LIMIT 1
             ) deal ON true
             LEFT JOIN LATERAL (
               SELECT candidate.id, candidate.status, candidate.target_role,
                      candidate.due_at
               FROM crm.handoffs candidate
               WHERE candidate.conversation_id=conversation.id
                 AND candidate.status IN ('pending','accepted')
               ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
             ) handoff ON true
             WHERE conversation.id=$1`,
            [conversationId],
          ),
        () =>
          database.query(
            `SELECT id, conversation_id, direction, author_kind, author_id,
                    message_type, content_envelope, status, delivery_status,
                    occurred_at, created_at
             FROM crm.messages WHERE conversation_id=$1
             ORDER BY occurred_at, id`,
            [conversationId],
          ),
        () =>
          database.query(
            `SELECT id, conversation_id, source_message_id, automation_epoch,
                    proposed_stage, question_envelope, status, created_by,
                    created_at, resolved_at
             FROM crm.ai_suggestions
             WHERE conversation_id=$1 AND status='pending'
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [conversationId],
          ),
      ]);
      const row = conversation.rows[0];
      if (!row) throw notFound('CONVERSATION_NOT_FOUND');
      return {
        conversation: mapConversationSummary(row, this),
        messages: messages.rows.map((/** @type {any} */ message) =>
          mapMessage(message, this),
        ),
        suggestion: suggestion.rows[0]
          ? mapSuggestion(suggestion.rows[0], this)
          : null,
      };
    });
  }

  /** @template T @param {(database: any) => Promise<T>} work */
  async #snapshot(work) {
    if (typeof this.database.transaction !== 'function') {
      return work(this.database);
    }
    return this.database.transaction(async (/** @type {any} */ client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      return work(client);
    });
  }
}

/** @param {any} row @param {PostgresInboxReadRepository} repository */
function mapConversationSummary(row, repository) {
  const identity = decryptContactIdentityEnvelope(
    row.identity_envelope,
    row.external_identity_lookup_hash,
    repository.contactEnvelopeKey,
  );
  const lastMessage = row.last_message_id
    ? mapMessage(
        {
          id: row.last_message_id,
          direction: row.last_message_direction,
          message_type: row.last_message_type,
          content_envelope: row.last_message_content_envelope,
          status: row.last_message_status,
          delivery_status: row.last_message_delivery_status,
          occurred_at: row.last_message_occurred_at,
        },
        repository,
      )
    : null;
  return Object.freeze({
    assignedUser: row.assigned_user_id
      ? { functionName: row.function_name, id: row.assigned_user_id }
      : null,
    automationEpoch: Number(row.automation_epoch),
    automationState: row.automation_state,
    channel: row.channel,
    contact: {
      displayHandle: identity.displayHandle ?? null,
      externalId: identity.externalIdentityId,
      id: row.contact_id,
      label:
        identity.displayHandle ??
        identity.externalIdentityId ??
        `Contato ${row.contact_id}`,
    },
    deal: row.deal_id
      ? { id: row.deal_id, stage: row.deal_stage, status: row.deal_status }
      : null,
    handoff: row.handoff_id
      ? {
          dueAt: iso(row.handoff_due_at),
          id: row.handoff_id,
          status: row.handoff_status,
          targetRole: row.target_role,
        }
      : null,
    id: row.id,
    lastMessage,
    openedAt: iso(row.opened_at),
    requiresAttention:
      row.state === 'requer_atencao' ||
      row.handoff_status === 'pending' ||
      ['failed', 'outcome_unknown'].includes(
        String(row.last_message_delivery_status ?? row.last_message_status),
      ),
    state: row.state,
    terminalAt: row.terminal_at ? iso(row.terminal_at) : null,
    updatedAt: iso(row.last_message_at),
    version: Number(row.version),
  });
}

/** @param {any} row @param {PostgresInboxReadRepository} repository */
function mapMessage(row, repository) {
  const content = decryptInboxMessageEnvelope(
    row.content_envelope,
    row.id,
    repository.messageEnvelopeKey,
  );
  return Object.freeze({
    authorId: row.author_id,
    authorKind: row.author_kind,
    createdAt: row.created_at ? iso(row.created_at) : iso(row.occurred_at),
    deliveryStatus: row.delivery_status ?? null,
    direction: row.direction,
    id: row.id,
    occurredAt: iso(row.occurred_at),
    preview: messagePreview(content, row.message_type),
    status: row.status,
    type: row.message_type,
  });
}

/** @param {any} row @param {PostgresInboxReadRepository} repository */
function mapSuggestion(row, repository) {
  const question = decryptInboxMessageEnvelope(
    row.question_envelope,
    `suggestion:${row.id}`,
    repository.messageEnvelopeKey,
    true,
  );
  return Object.freeze({
    automationEpoch: Number(row.automation_epoch),
    createdAt: iso(row.created_at),
    id: row.id,
    proposedStage: row.proposed_stage,
    question: messagePreview(question, 'text'),
    sourceMessageId: row.source_message_id,
    status: row.status,
  });
}

/** @param {Record<string, any>} content @param {string} type */
function messagePreview(content, type) {
  const candidate = content.text ?? content.caption;
  if (typeof candidate === 'string' && candidate.trim())
    return candidate.trim();
  const labels = /** @type {Record<string, string>} */ ({
    audio: 'Áudio',
    document: 'Documento',
    image: 'Imagem',
    template: 'Mensagem de modelo',
    video: 'Vídeo',
  });
  return labels[type] ?? 'Mensagem';
}

/** @param {Array<() => Promise<any>>} operations */
async function runSequential(operations) {
  const results = [];
  for (const operation of operations) results.push(await operation());
  return results;
}

/** @param {any} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** @param {string} code */
function notFound(code) {
  return Object.assign(new Error(code), { code, statusCode: 404 });
}
