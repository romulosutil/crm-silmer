import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { InboxConflictError } from '../domain/errors.js';
import { freezeInboxRecord, isTerminalInboxState } from '../domain/inbox.js';

const CIPHER = 'aes-256-gcm';
const ALGORITHM = 'AES-256-GCM';

/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable
 * @typedef {{query: Queryable['query'], transaction: <T>(work: (transaction: Queryable) => Promise<T>) => Promise<T>}} TransactionalDatabase
 */

export class PostgresInboxRepository {
  /** @type {TransactionalDatabase} */
  #database;
  /** @type {Buffer} */
  #envelopeKey;

  /** @param {{database: TransactionalDatabase, envelopeKey: Buffer}} options */
  constructor({ database, envelopeKey }) {
    if (
      !database ||
      typeof database.query !== 'function' ||
      typeof database.transaction !== 'function'
    ) {
      throw new TypeError('A transactional PostgreSQL database is required');
    }
    if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
      throw new TypeError('envelopeKey must be a 32-byte Buffer');
    }
    this.#database = database;
    this.#envelopeKey = Buffer.from(envelopeKey);
  }

  /** @param {any} input @param {any} runtime */
  async receiveInbound(input, runtime) {
    return this.#database.transaction(async (transaction) => {
      await advisoryLock(
        transaction,
        `inbound:${input.provider}:${input.providerAccountId}:${input.externalConversationId}`,
      );
      const replay = await transaction.query(
        `SELECT ${MESSAGE_SELECT}
         FROM crm.messages
         WHERE provider = $1 AND provider_account_id = $2
           AND external_message_id = $3`,
        [input.provider, input.providerAccountId, input.externalMessageId],
      );
      if (replay.rows[0]) {
        const replayConversation = await transaction.query(
          `SELECT ${CONVERSATION_SELECT} FROM crm.conversations WHERE id = $1`,
          [replay.rows[0].conversation_id],
        );
        return freezeInboxRecord({
          conversation: mapConversation(replayConversation.rows[0]),
          message: mapMessage(replay.rows[0], this.#envelopeKey),
        });
      }

      let selected = await transaction.query(
        `SELECT ${CONVERSATION_SELECT}
         FROM crm.conversations
         WHERE provider = $1 AND provider_account_id = $2
           AND external_conversation_id = $3 AND terminal_at IS NULL
         FOR UPDATE`,
        [input.provider, input.providerAccountId, input.externalConversationId],
      );
      const hadActiveConversation = Boolean(selected.rows[0]);
      if (!selected.rows[0]) {
        const last = await transaction.query(
          `SELECT id, cycle_number
           FROM crm.conversations
           WHERE provider = $1 AND provider_account_id = $2
             AND external_conversation_id = $3
           ORDER BY cycle_number DESC LIMIT 1`,
          [
            input.provider,
            input.providerAccountId,
            input.externalConversationId,
          ],
        );
        const previous = last.rows[0] ?? null;
        const conversationId = runtime.idFactory('conversation');
        selected = await transaction.query(
          `INSERT INTO crm.conversations
             (id, contact_identity_id, provider, provider_account_id,
              external_conversation_id, cycle_number, previous_conversation_id,
              state, automation_state, automation_epoch, version, opened_at,
              last_message_at, terminal_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'nova', 'assistant', 0, 1,
                   $8, $8, NULL)
           RETURNING ${CONVERSATION_SELECT}`,
          [
            conversationId,
            input.identityId,
            input.provider,
            input.providerAccountId,
            input.externalConversationId,
            Number(previous?.cycle_number ?? 0) + 1,
            previous?.id ?? null,
            input.occurredAt,
          ],
        );
      }
      let conversation = selected.rows[0];
      if (conversation.contact_identity_id !== input.identityId) {
        throw new InboxConflictError(
          'An active conversation cannot change its anchored identity',
        );
      }
      if (hadActiveConversation) {
        const updated = await transaction.query(
          `UPDATE crm.conversations
           SET last_message_at = GREATEST(last_message_at, $2),
               version = version + 1
           WHERE id = $1
           RETURNING ${CONVERSATION_SELECT}`,
          [conversation.id, input.occurredAt],
        );
        conversation = updated.rows[0];
      }
      const messageId = runtime.idFactory('message');
      const envelope = encryptJson(
        input.message.content,
        `message:${messageId}`,
        this.#envelopeKey,
      );
      const inserted = await transaction.query(
        `INSERT INTO crm.messages
           (id, conversation_id, channel_event_id, provider,
            provider_account_id, external_message_id, command_id, direction,
            author_kind, author_id, message_type, content_envelope, key_version,
            status, occurred_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, 'inbound', 'contact', $7, $8,
                 $9::jsonb, 1, 'received', $10, $10)
         RETURNING ${MESSAGE_SELECT}`,
        [
          messageId,
          conversation.id,
          input.channelEventId ?? null,
          input.provider,
          input.providerAccountId,
          input.externalMessageId,
          input.identityId,
          input.message.type,
          JSON.stringify(envelope),
          input.occurredAt,
        ],
      );
      return freezeInboxRecord({
        conversation: mapConversation(conversation),
        message: mapMessage(inserted.rows[0], this.#envelopeKey),
      });
    });
  }

  /** @param {string} kind @param {any} input @param {any} runtime */
  async mutateConversation(kind, input, runtime) {
    const fingerprint = hashJson(input);
    return this.#database.transaction(async (transaction) => {
      await advisoryLock(
        transaction,
        `command:${kind}:${input.idempotencyKey}`,
      );
      const replay = await transaction.query(
        `SELECT fingerprint, result FROM crm.inbox_commands
         WHERE operation = $1 AND idempotency_key = $2`,
        [kind, input.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].fingerprint !== fingerprint) {
          throw new InboxConflictError(
            'Idempotency key was reused with another command',
          );
        }
        return this.#hydrateCommand(transaction, replay.rows[0].result);
      }

      const selected = await transaction.query(
        `SELECT ${CONVERSATION_SELECT} FROM crm.conversations
         WHERE id = $1 FOR UPDATE`,
        [input.conversationId],
      );
      const current = selected.rows[0];
      if (!current) throw new InboxConflictError('Conversation was not found');
      if (Number(current.version) !== input.expectedVersion) {
        throw new InboxConflictError(
          `Expected conversation version ${input.expectedVersion}, current version is ${current.version}`,
        );
      }
      if (current.terminal_at !== null) {
        throw new InboxConflictError(
          'Terminal conversations cannot be mutated',
        );
      }
      const occurredAt = runtime.clock().toISOString();
      let result;
      let commandResult;

      if (kind === 'send') {
        const updated = await transaction.query(
          `UPDATE crm.conversations SET automation_state = 'human',
             automation_epoch = automation_epoch
               + CASE WHEN automation_state = 'assistant' THEN 1 ELSE 0 END,
             assigned_user_id = $3, state = 'em_atendimento',
             version = version + 1, last_message_at = GREATEST(last_message_at, $2)
           WHERE id = $1 RETURNING ${CONVERSATION_SELECT}`,
          [input.conversationId, occurredAt, input.actor.id],
        );
        const conversation = updated.rows[0];
        const messageId = runtime.idFactory('message');
        const envelope = encryptJson(
          input.content,
          `message:${messageId}`,
          this.#envelopeKey,
        );
        const message = await transaction.query(
          `INSERT INTO crm.messages
             (id, conversation_id, provider, provider_account_id, command_id,
              direction, author_kind, author_id, message_type, content_envelope,
              key_version, status, occurred_at, created_at)
           VALUES ($1, $2, $3, $4, $5, 'outbound', 'human', $6, $7, $8::jsonb,
                   1, 'queued', $9, $9)
           RETURNING ${MESSAGE_SELECT}`,
          [
            messageId,
            conversation.id,
            conversation.provider,
            conversation.provider_account_id,
            input.idempotencyKey,
            input.actor.id,
            input.messageType,
            JSON.stringify(envelope),
            occurredAt,
          ],
        );
        await transaction.query(
          `INSERT INTO crm.outbox_jobs
             (id, job_type, idempotency_key, channel_event_id, status, priority,
              available_at, created_at, transient_media_id, queue, attempt_count,
              max_attempts, updated_at, effect_policy, message_id)
           VALUES ($1, 'channel_message.send', $2, NULL, 'pending', 100, $3, $3,
                   NULL, 'channel-outbound', 0, 8, $3, 'manual', $4)`,
          [
            runtime.idFactory('job'),
            input.idempotencyKey,
            occurredAt,
            messageId,
          ],
        );
        result = mapMessage(
          message.rows[0],
          this.#envelopeKey,
          conversation.version,
        );
        commandResult = {
          conversationVersion: Number(conversation.version),
          entityId: messageId,
          entityType: 'message',
        };
      } else {
        const assignments = mutationAssignments(kind, input, occurredAt);
        const updated = await transaction.query(
          `UPDATE crm.conversations SET ${assignments.sql}, version = version + 1
           WHERE id = $1 RETURNING ${CONVERSATION_SELECT}`,
          [input.conversationId, ...assignments.values],
        );
        result = mapConversation(updated.rows[0]);
        commandResult = {
          entityId: result.id,
          entityType: 'conversation',
          version: result.version,
        };
      }
      await runtime.appendAudit(createAudit(kind, input, result, occurredAt), {
        transaction,
      });
      await transaction.query(
        `INSERT INTO crm.inbox_commands
           (operation, idempotency_key, fingerprint, result, created_at, completed_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
        [
          kind,
          input.idempotencyKey,
          fingerprint,
          JSON.stringify(commandResult),
          occurredAt,
        ],
      );
      return result;
    });
  }

  /** @param {any} input @param {any} runtime */
  async recordSuggestion(input, runtime) {
    return this.#database.transaction(async (transaction) => {
      await advisoryLock(
        transaction,
        `suggestion:${input.sourceMessageId}:${input.proposedStage}`,
      );
      const existing = await transaction.query(
        `SELECT s.*, c.state AS conversation_state
         FROM crm.ai_suggestions s JOIN crm.conversations c ON c.id = s.conversation_id
         WHERE source_message_id = $1 AND proposed_stage = $2`,
        [input.sourceMessageId, input.proposedStage],
      );
      if (existing.rows[0])
        return mapSuggestion(existing.rows[0], this.#envelopeKey);
      const source = await transaction.query(
        `SELECT c.id, c.automation_epoch
         FROM crm.conversations c JOIN crm.messages m ON m.conversation_id = c.id
         WHERE c.id = $1 AND m.id = $2 FOR UPDATE OF c`,
        [input.conversationId, input.sourceMessageId],
      );
      if (!source.rows[0]) {
        throw new InboxConflictError(
          'Suggestion source is not in the conversation',
        );
      }
      const id = runtime.idFactory('suggestion');
      const occurredAt = runtime.clock().toISOString();
      const envelope = encryptJson(
        input.question,
        `suggestion:${id}`,
        this.#envelopeKey,
      );
      const inserted = await transaction.query(
        `INSERT INTO crm.ai_suggestions
           (id, conversation_id, source_message_id, automation_epoch,
            proposed_stage, question_envelope, key_version, status, created_by,
            created_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1, 'pending', $7, $8, NULL)
         RETURNING *`,
        [
          id,
          input.conversationId,
          input.sourceMessageId,
          source.rows[0].automation_epoch,
          input.proposedStage,
          JSON.stringify(envelope),
          input.actor.id,
          occurredAt,
        ],
      );
      return mapSuggestion(inserted.rows[0], this.#envelopeKey);
    });
  }

  /** @param {Queryable} transaction @param {any} rawResult */
  async #hydrateCommand(transaction, rawResult) {
    const stored =
      typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
    if (stored.entityType === 'conversation') {
      const selected = await transaction.query(
        `SELECT ${CONVERSATION_SELECT} FROM crm.conversations WHERE id = $1`,
        [stored.entityId],
      );
      return mapConversation(selected.rows[0]);
    }
    const selected = await transaction.query(
      `SELECT ${MESSAGE_SELECT} FROM crm.messages WHERE id = $1`,
      [stored.entityId],
    );
    return mapMessage(
      selected.rows[0],
      this.#envelopeKey,
      stored.conversationVersion,
    );
  }
}

const CONVERSATION_SELECT = `id, contact_identity_id, provider,
  provider_account_id, external_conversation_id, cycle_number,
  previous_conversation_id, state, automation_state, automation_epoch,
  assigned_user_id, version, opened_at, last_message_at, terminal_at`;
const MESSAGE_SELECT = `id, conversation_id, provider, provider_account_id,
  external_message_id, command_id, direction, author_kind, author_id,
  message_type, content_envelope, status, occurred_at, created_at`;

/** @param {string} kind @param {any} input @param {string} occurredAt */
function mutationAssignments(kind, input, occurredAt) {
  if (kind === 'transition') {
    return {
      sql: 'state = $2, terminal_at = $3',
      values: [
        input.state,
        isTerminalInboxState(input.state) ? occurredAt : null,
      ],
    };
  }
  if (kind === 'takeover') {
    return {
      sql: `automation_state = 'human', automation_epoch = automation_epoch + 1,
            state = 'em_atendimento', assigned_user_id = $2`,
      values: [input.actor.id],
    };
  }
  return {
    sql: `automation_state = 'assistant', automation_epoch = automation_epoch + 1`,
    values: [],
  };
}

/** @param {any} row */
function mapConversation(row) {
  if (!row) throw new InboxConflictError('Stored conversation was not found');
  return freezeInboxRecord({
    assignedUserId: row.assigned_user_id,
    automationEpoch: Number(row.automation_epoch),
    automationState: row.automation_state,
    createdAt: iso(row.opened_at),
    cycleNumber: Number(row.cycle_number),
    externalConversationId: row.external_conversation_id,
    id: row.id,
    identityId: row.contact_identity_id,
    previousConversationId: row.previous_conversation_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    state: row.state,
    terminalAt: row.terminal_at === null ? null : iso(row.terminal_at),
    updatedAt: iso(row.last_message_at),
    version: Number(row.version),
  });
}

/** @param {any} row @param {Buffer} key @param {number} [conversationVersion] */
function mapMessage(row, key, conversationVersion) {
  if (!row) throw new InboxConflictError('Stored message was not found');
  return freezeInboxRecord({
    authorId: row.author_id,
    content: decryptJson(row.content_envelope, `message:${row.id}`, key),
    conversationId: row.conversation_id,
    ...(conversationVersion === undefined
      ? {}
      : { conversationVersion: Number(conversationVersion) }),
    createdAt: iso(row.created_at),
    direction: row.direction,
    externalMessageId: row.external_message_id,
    id: row.id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    status: row.status,
    type: row.message_type,
  });
}

/** @param {any} row @param {Buffer} key */
function mapSuggestion(row, key) {
  return freezeInboxRecord({
    automationEpoch: Number(row.automation_epoch),
    conversationId: row.conversation_id,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    proposedStage: row.proposed_stage,
    question: decryptJson(row.question_envelope, `suggestion:${row.id}`, key),
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
    sourceMessageId: row.source_message_id,
    status: row.status,
  });
}

/** @param {unknown} value @param {string} context @param {Buffer} key */
function encryptJson(value, context, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1,
  };
}

/** @param {any} raw @param {string} context @param {Buffer} key */
function decryptJson(raw, context, key) {
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    envelope?.algorithm !== ALGORITHM ||
    envelope?.version !== 1 ||
    envelope?.keyVersion !== 1
  ) {
    throw new Error('Unsupported inbox content envelope');
  }
  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch (error) {
    throw new Error('Unable to authenticate or decrypt inbox content', {
      cause: error,
    });
  }
}

/** @param {Queryable} transaction @param {string} identity */
async function advisoryLock(transaction, identity) {
  await transaction.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [identity],
  );
}

/** @param {unknown} value */
function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** @param {string|Date} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** @param {string} kind @param {any} input @param {any} result @param {string} occurredAt */
function createAudit(kind, input, result, occurredAt) {
  const actions = {
    reactivate: 'conversation.assistant_reactivated',
    send: 'conversation.human_message_queued',
    takeover: 'conversation.takeover',
    transition: 'conversation.state_transitioned',
  };
  return freezeInboxRecord({
    action: actions[/** @type {keyof typeof actions} */ (kind)],
    actor: input.actor.id,
    correlationId: input.correlationId,
    occurredAt,
    reason: input.reason,
    target: { id: input.conversationId, type: 'conversation' },
    version: result.conversationVersion ?? result.version,
  });
}
