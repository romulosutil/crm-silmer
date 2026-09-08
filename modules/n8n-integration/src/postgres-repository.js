import {
  decryptJson,
  encryptJson,
  fingerprint,
  identityLookupHash,
  tokenHash,
} from './crypto.js';
import { N8nConflictError, N8nNotFoundError } from './errors.js';

/** @typedef {{query(sql: string, values?: unknown[]): Promise<{rows: any[]}>}} Queryable */

export class PostgresN8nIntegrationRepository {
  /**
   * @param {{
   *   database: {query: Queryable['query'], transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T>},
   *   envelopeKey: Buffer,
   *   contactEnvelopeKey?: Buffer,
   *   contactLookupKey?: Buffer,
   *   messageEnvelopeKey?: Buffer,
   * }} options
   */
  constructor({
    database,
    envelopeKey,
    contactEnvelopeKey = envelopeKey,
    contactLookupKey = envelopeKey,
    messageEnvelopeKey = envelopeKey,
  }) {
    if (
      !database ||
      typeof database.query !== 'function' ||
      typeof database.transaction !== 'function'
    ) {
      throw new TypeError('A transactional PostgreSQL database is required');
    }
    for (const [key, name] of [
      [envelopeKey, 'envelopeKey'],
      [contactEnvelopeKey, 'contactEnvelopeKey'],
      [contactLookupKey, 'contactLookupKey'],
      [messageEnvelopeKey, 'messageEnvelopeKey'],
    ]) {
      if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new TypeError(`${name} must be a 32-byte Buffer`);
      }
    }
    this.database = database;
    this.envelopeKey = Buffer.from(envelopeKey);
    this.contactEnvelopeKey = Buffer.from(contactEnvelopeKey);
    this.contactLookupKey = Buffer.from(contactLookupKey);
    this.messageEnvelopeKey = Buffer.from(messageEnvelopeKey);
  }

  /** @param {any} input @param {any} runtime */
  async receiveInbound(input, runtime) {
    return this.database.transaction(async (client) => {
      await transactionBounds(client);
      await advisoryLock(
        client,
        `n8n-inbound:${input.provider}:${input.providerAccountId}:${input.externalEventId}`,
      );
      const replay = await selectReceipt(
        client,
        'n8n.messages.inbound',
        input.technical.idempotencyKey,
      );
      if (replay) {
        assertFingerprint(replay, input.eventFingerprint);
        return this.#inboundResponse(client, replay.conversation_id, true);
      }

      const lookupHash = identityLookupHash(
        {
          channel: input.channel,
          externalIdentityId: input.externalIdentityId,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
        this.contactLookupKey,
      );
      let identity = (
        await client.query(
          `SELECT id, current_contact_id
           FROM crm.contact_identities
           WHERE provider = $1 AND provider_account_id = $2 AND channel = $3
             AND external_identity_lookup_hash = $4
           FOR UPDATE`,
          [input.provider, input.providerAccountId, input.channel, lookupHash],
        )
      ).rows[0];
      const now = validClock(runtime.clock);
      if (!identity) {
        const contactId = runtime.idFactory('contact');
        const identityId = runtime.idFactory('identity');
        await client.query(
          `INSERT INTO crm.contacts
             (id, provisional, version, created_at, updated_at)
           VALUES ($1, true, 1, $2, $2)`,
          [contactId, now],
        );
        const identityEnvelope = encryptJson(
          {
            displayHandle: input.displayHandle,
            externalIdentityId: input.externalIdentityId,
          },
          JSON.stringify(['crm.contact_identities', 1, lookupHash]),
          this.contactEnvelopeKey,
        );
        identity = (
          await client.query(
            `INSERT INTO crm.contact_identities
               (id, current_contact_id, provider, provider_account_id, channel,
                external_identity_lookup_hash, identity_kind, phone_status,
                identity_envelope, key_version, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1, 1, $10, $10)
             RETURNING id, current_contact_id`,
            [
              identityId,
              contactId,
              input.provider,
              input.providerAccountId,
              input.channel,
              lookupHash,
              input.identityKind,
              input.phoneStatus,
              JSON.stringify(identityEnvelope),
              now,
            ],
          )
        ).rows[0];
      }

      let conversation = (
        await client.query(
          `SELECT * FROM crm.conversations
           WHERE provider = $1 AND provider_account_id = $2
             AND external_conversation_id = $3 AND terminal_at IS NULL
           FOR UPDATE`,
          [
            input.provider,
            input.providerAccountId,
            input.externalConversationId,
          ],
        )
      ).rows[0];
      if (conversation && conversation.contact_identity_id !== identity.id) {
        throw new N8nConflictError(
          'Open conversation is anchored to another identity',
        );
      }
      if (!conversation) {
        const previous = (
          await client.query(
            `SELECT id, cycle_number FROM crm.conversations
             WHERE provider = $1 AND provider_account_id = $2
               AND external_conversation_id = $3
             ORDER BY cycle_number DESC LIMIT 1`,
            [
              input.provider,
              input.providerAccountId,
              input.externalConversationId,
            ],
          )
        ).rows[0];
        conversation = (
          await client.query(
            `INSERT INTO crm.conversations
               (id, contact_identity_id, provider, provider_account_id,
                external_conversation_id, cycle_number, previous_conversation_id,
                state, automation_state, automation_epoch, version, opened_at,
                last_message_at, terminal_at, inbound_revision,
                claimed_revision, briefing_version, last_inbound_event_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'nova', 'assistant', 0, 1,
                     $8, $8, NULL, 1, 0, 1, $9)
             RETURNING *`,
            [
              runtime.idFactory('conversation'),
              identity.id,
              input.provider,
              input.providerAccountId,
              input.externalConversationId,
              Number(previous?.cycle_number ?? 0) + 1,
              previous?.id ?? null,
              input.occurredAt,
              input.externalEventId,
            ],
          )
        ).rows[0];
      } else {
        conversation = (
          await client.query(
            `UPDATE crm.conversations
             SET inbound_revision = inbound_revision + 1,
                 briefing_version = briefing_version + 1,
                 last_inbound_event_id = $2,
                 last_message_at = GREATEST(last_message_at, $3),
                 version = version + 1
             WHERE id = $1
             RETURNING *`,
            [conversation.id, input.externalEventId, input.occurredAt],
          )
        ).rows[0];
      }

      const messageId = runtime.idFactory('message');
      await client.query(
        `INSERT INTO crm.messages
           (id, conversation_id, provider, provider_account_id,
            external_message_id, direction, author_kind, author_id,
            message_type, content_envelope, key_version, status, occurred_at,
            created_at, inbound_revision, automation_epoch, n8n_execution_id)
         VALUES ($1, $2, $3, $4, $5, 'inbound', 'contact', $6, $7, $8::jsonb,
                 1, 'received', $9, $10, $11, $12, $13)`,
        [
          messageId,
          conversation.id,
          input.provider,
          input.providerAccountId,
          input.externalMessageId,
          identity.id,
          input.message.type,
          JSON.stringify(
            encryptJson(
              input.message.content,
              `message:${messageId}`,
              this.messageEnvelopeKey,
            ),
          ),
          input.occurredAt,
          now,
          Number(conversation.inbound_revision),
          Number(conversation.automation_epoch),
          input.technical.executionId,
        ],
      );
      await this.#insertBriefing(client, {
        briefing: input.briefing,
        conversation,
        createdAt: now,
        technical: input.technical,
      });
      const runId = await upsertRun(client, {
        conversationId: conversation.id,
        id: runtime.idFactory('n8n-run'),
        messageId,
        occurredAt: now,
        technical: input.technical,
        automationEpoch: Number(conversation.automation_epoch),
      });
      await insertReceipt(client, runtime, {
        conversationId: conversation.id,
        correlationId: input.correlationId,
        eventId: input.externalEventId,
        eventType: 'message.inbound',
        fingerprint: input.eventFingerprint,
        idempotencyKey: input.technical.idempotencyKey,
        idempotencyScope: 'n8n.messages.inbound',
        messageId,
        occurredAt: input.occurredAt,
        outcome: { revision: Number(conversation.inbound_revision) },
        processedAt: now,
        runId,
      });
      await appendAudit(client, runtime, {
        action: 'integration.n8n.message.inbound',
        actor: input.technical.actor,
        correlationId: input.correlationId,
        occurredAt: now,
        reason: 'canonical inbound message accepted',
        targetId: conversation.id,
        targetType: 'conversation',
        version: conversation.version,
      });
      return this.#inboundResponse(client, conversation.id, false);
    });
  }

  /** @param {any} input @param {any} runtime */
  async storeAttachment(input, runtime) {
    return this.database.transaction(async (client) => {
      await transactionBounds(client);
      await advisoryLock(
        client,
        `n8n-attachment:${input.technical.idempotencyKey}`,
      );
      const replay = await selectReceipt(
        client,
        'n8n.attachments.store',
        input.technical.idempotencyKey,
      );
      if (replay) {
        assertFingerprint(replay, input.eventFingerprint);
        return attachmentResponse(replay.outcome, true);
      }
      const message = (
        await client.query(
          `SELECT id FROM crm.messages
           WHERE conversation_id = $1 AND external_message_id = $2
           FOR UPDATE`,
          [input.conversationId, input.externalId],
        )
      ).rows[0];
      if (!message) {
        const conversation = await client.query(
          'SELECT id FROM crm.conversations WHERE id = $1',
          [input.conversationId],
        );
        if (!conversation.rows[0])
          throw new N8nNotFoundError('Conversation was not found');
        throw new N8nNotFoundError('Message was not found in the conversation');
      }
      const media = (
        await client.query(
          `SELECT id, content_sha256, detected_mime_type, size_bytes,
                  first_received_at
           FROM crm.transient_media WHERE id = $1 FOR UPDATE`,
          [input.transientMediaId],
        )
      ).rows[0];
      if (!media) throw new N8nNotFoundError('Transient media was not found');
      if (
        media.content_sha256 !== input.contentSha256 ||
        Number(media.size_bytes) !== input.size ||
        media.detected_mime_type !== input.mimeType
      ) {
        throw new N8nConflictError(
          'Attachment metadata does not match stored media',
        );
      }
      const createdAt = validClock(runtime.clock);
      await client.query(
        `INSERT INTO crm.attachments
           (message_id, transient_media_id, filename_envelope, key_version,
            created_at)
         VALUES ($1, $2, $3::jsonb, 1, $4)
         ON CONFLICT (message_id, transient_media_id) DO NOTHING`,
        [
          message.id,
          media.id,
          JSON.stringify(
            encryptJson(
              { filename: input.filename },
              `attachment:${message.id}:${media.id}:filename`,
              this.envelopeKey,
            ),
          ),
          createdAt,
        ],
      );
      const outcome = {
        attachment_id: media.id,
        conversation_id: input.conversationId,
        created_at: createdAt,
        external_id: input.externalId,
        filename: input.filename,
        mime_type: input.mimeType,
        sha256: input.contentSha256,
        size: input.size,
      };
      await insertReceipt(client, runtime, {
        conversationId: input.conversationId,
        correlationId: input.correlationId,
        eventId: `${input.externalId}:attachment`,
        eventType: 'attachment.stored',
        fingerprint: input.eventFingerprint,
        idempotencyKey: input.technical.idempotencyKey,
        idempotencyScope: 'n8n.attachments.store',
        messageId: message.id,
        occurredAt: createdAt,
        outcome,
        processedAt: createdAt,
        runId: null,
      });
      await appendAudit(client, runtime, {
        action: 'integration.n8n.attachment.stored',
        actor: input.technical.actor,
        correlationId: input.correlationId,
        occurredAt: createdAt,
        reason: 'transient attachment linked to canonical message',
        targetId: media.id,
        targetType: 'transient_media',
        version: 1,
      });
      return attachmentResponse(outcome, false);
    });
  }

  /** @param {any} input @param {any} runtime */
  async claimAiTurn(input, runtime) {
    return this.database.transaction(async (client) => {
      await transactionBounds(client);
      const conversation = (
        await client.query(
          'SELECT * FROM crm.conversations WHERE id = $1 FOR UPDATE',
          [input.conversationId],
        )
      ).rows[0];
      if (!conversation)
        throw new N8nNotFoundError('Conversation was not found');
      const mode = conversationMode(conversation);
      const evaluatedAt = validClock(runtime.clock);
      /** @param {string} reason */
      const denied = (reason) => ({
        accepted: true,
        automation_epoch: Number(conversation.automation_epoch),
        claimed: false,
        conversation_id: conversation.id,
        conversation_version: Number(conversation.version),
        mode,
        reason,
        revision: Number(conversation.inbound_revision),
      });
      if (mode !== 'ai_active') return denied('MODE_NOT_AI_ACTIVE');
      if (Number(conversation.automation_epoch) !== input.automationEpoch) {
        return denied('STALE_AUTOMATION_EPOCH');
      }
      if (Number(conversation.inbound_revision) !== input.revision) {
        return denied('STALE_REVISION');
      }
      if (conversation.last_inbound_event_id !== input.lastEventId) {
        return denied('LAST_EVENT_MISMATCH');
      }
      const existing = (
        await client.query(
          `SELECT * FROM crm.ai_turns
           WHERE conversation_id = $1 AND revision = $2
           ORDER BY claimed_at DESC, id DESC
           FOR UPDATE`,
          [input.conversationId, input.revision],
        )
      ).rows;
      const active = existing.find(({ status }) => status === 'claimed');
      if (
        active &&
        new Date(active.lease_expires_at) <= new Date(evaluatedAt)
      ) {
        if (active.effect_state === 'reserved') {
          await client.query(
            `UPDATE crm.ai_turns
             SET status = 'failed', effect_state = 'outcome_unknown',
                 finished_at = $2
             WHERE id = $1 AND status = 'claimed'`,
            [active.id, evaluatedAt],
          );
          const uncertainMessage = (
            await client.query(
              `UPDATE crm.messages
               SET status = 'outcome_unknown',
                   delivery_status = 'outcome_unknown',
                   delivery_status_at = $2
               WHERE command_id = $1 AND status = 'queued'
               RETURNING id`,
              [active.effect_command_id, evaluatedAt],
            )
          ).rows[0];
          if (uncertainMessage) {
            await client.query(
              `UPDATE crm.message_delivery_attempts
               SET status = 'outcome_unknown', updated_at = $2,
                   error_code = 'AI_TURN_LEASE_EXPIRED'
               WHERE message_id = $1 AND status = 'pending'`,
              [uncertainMessage.id, evaluatedAt],
            );
          }
          return denied('EFFECT_OUTCOME_UNKNOWN');
        }
        await client.query(
          `UPDATE crm.ai_turns
           SET status = 'expired', finished_at = $2
           WHERE id = $1 AND status = 'claimed'`,
          [active.id, evaluatedAt],
        );
      } else if (active) {
        if (
          active.worker_id !== input.workerId ||
          active.execution_id !== input.technical.executionId ||
          active.last_event_id !== input.lastEventId ||
          Number(active.automation_epoch) !== input.automationEpoch
        ) {
          return denied('ALREADY_CLAIMED');
        }
        return this.#claimResponse(client, conversation, active, true);
      }
      const completed = existing.find(
        ({ id, status }) => id !== active?.id && status !== 'expired',
      );
      if (completed) {
        return denied(
          completed.effect_state === 'outcome_unknown'
            ? 'EFFECT_OUTCOME_UNKNOWN'
            : 'ALREADY_PROCESSED',
        );
      }
      if (
        existing.length === 0 &&
        Number(conversation.claimed_revision) >= input.revision
      ) {
        return denied('ALREADY_CLAIMED');
      }
      const claimedAt = evaluatedAt;
      const token = runtime.tokenFactory();
      const leaseExpiresAt = new Date(
        new Date(claimedAt).getTime() + runtime.claimLeaseMs,
      ).toISOString();
      const claim = (
        await client.query(
          `INSERT INTO crm.ai_turns
             (id, conversation_id, revision, automation_epoch, last_event_id,
              worker_id, execution_id, claim_token_hash, claim_token_envelope,
              key_version, status, claimed_at, lease_expires_at, workflow_key,
              workflow_version, effect_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1, 'claimed',
                   $10, $11, $12, $13, 'not_started')
           RETURNING *`,
          [
            input.claimId,
            input.conversationId,
            input.revision,
            input.automationEpoch,
            input.lastEventId,
            input.workerId,
            input.technical.executionId,
            tokenHash(token),
            JSON.stringify(
              encryptJson(
                { token },
                `n8n-ai-turn-claim:${input.claimId}`,
                this.envelopeKey,
              ),
            ),
            claimedAt,
            leaseExpiresAt,
            input.technical.workflowKey,
            input.technical.workflowVersion,
          ],
        )
      ).rows[0];
      await client.query(
        `UPDATE crm.conversations
         SET claimed_revision = $2
         WHERE id = $1 AND claimed_revision < $2`,
        [conversation.id, input.revision],
      );
      await appendAudit(client, runtime, {
        action: 'integration.n8n.ai_turn.claimed',
        actor: input.technical.actor,
        correlationId: input.technical.correlationId,
        occurredAt: claimedAt,
        reason: 'exclusive AI turn claimed',
        targetId: conversation.id,
        targetType: 'conversation',
        version: input.revision,
      });
      return this.#claimResponse(client, conversation, claim, false, token);
    });
  }

  /** @param {any} input @param {any} runtime */
  async recordEvent(input, runtime) {
    return this.database.transaction(async (client) => {
      await transactionBounds(client);
      await advisoryLock(client, `n8n-event:${input.technical.idempotencyKey}`);
      const replay = await selectReceipt(
        client,
        'n8n.events',
        input.technical.idempotencyKey,
      );
      if (replay) {
        assertFingerprint(replay, input.eventFingerprint);
        return {
          accepted: true,
          duplicate: true,
          event_id: replay.external_event_id,
          processed_at: iso(replay.processed_at),
          ...(replay.event_type === 'message.send.requested'
            ? { send_authorized: false }
            : {}),
        };
      }
      const processedAt = validClock(runtime.clock);
      const resolvedConversationId =
        input.conversationId ??
        (input.eventType === 'workflow.failed'
          ? null
          : await resolveEventConversation(client, input));
      const eventInput =
        resolvedConversationId === input.conversationId
          ? input
          : { ...input, conversationId: resolvedConversationId };
      let conversation = null;
      if (resolvedConversationId) {
        conversation = (
          await client.query(
            'SELECT * FROM crm.conversations WHERE id = $1 FOR UPDATE',
            [resolvedConversationId],
          )
        ).rows[0];
        if (!conversation)
          throw new N8nNotFoundError('Conversation was not found');
      }
      const panelCommand = eventInput.commandId
        ? await selectPanelCommand(client, eventInput.commandId)
        : null;
      const statusOnlySent =
        eventInput.eventType === 'message.sent' &&
        !eventInput.message &&
        Boolean(eventInput.externalMessageId);
      if (
        panelCommand &&
        panelCommand.conversation_id !== resolvedConversationId
      ) {
        throw new N8nConflictError('Command belongs to another conversation');
      }
      if (
        panelCommand &&
        [
          'message.send.requested',
          'message.send.unknown',
          'message.sent',
        ].includes(eventInput.eventType)
      ) {
        assertPanelSendFence(
          panelCommand,
          conversation,
          eventInput,
          this.envelopeKey,
        );
      }
      const needsAutomationClaim =
        eventInput.eventType === 'lead.updated' ||
        eventInput.eventType === 'handoff.requested' ||
        (!panelCommand &&
          !statusOnlySent &&
          [
            'message.send.requested',
            'message.sent',
            'message.send.unknown',
          ].includes(eventInput.eventType));
      const claimId = needsAutomationClaim
        ? await assertClaim(client, conversation, eventInput, processedAt)
        : null;
      const runId = await upsertRun(client, {
        aiModel: eventInput.aiModel,
        aiProvider: eventInput.aiProvider,
        automationEpoch: eventInput.automationEpoch,
        conversationId: resolvedConversationId,
        id: runtime.idFactory('n8n-run'),
        messageId: null,
        occurredAt: eventInput.occurredAt,
        promptVersion: eventInput.promptVersion,
        status: automationRunStatus(eventInput.eventType),
        resultCode: eventInput.failure?.code ?? null,
        technical: eventInput.technical,
      });
      let messageId = null;
      const outcome = {};
      if (statusOnlySent) {
        const delivery = await updateDeliveryStatus(client, eventInput);
        messageId = delivery.messageId;
        outcome.deliveryStatus = delivery.status;
        outcome.changed = delivery.changed;
      } else if (eventInput.eventType === 'message.sent') {
        messageId = await this.#recordSentMessage(
          client,
          eventInput,
          runtime,
          conversation,
        );
        outcome.deliveryStatus = 'sent';
      } else if (eventInput.eventType === 'message.send.requested') {
        const reservation = await this.#reserveAutomatedSend(
          client,
          eventInput,
          runtime,
          conversation,
          processedAt,
          panelCommand,
        );
        messageId = reservation.messageId;
        outcome.commandId = eventInput.commandId;
        outcome.deliveryStatus = 'pending';
        outcome.sendAuthorized = reservation.sendAuthorized;
        if (claimId && reservation.sendAuthorized) {
          await client.query(
            `UPDATE crm.ai_turns
             SET effect_state = 'reserved', effect_command_id = $2
             WHERE id = $1 AND status = 'claimed'
               AND effect_state = 'not_started'`,
            [claimId, eventInput.commandId],
          );
        }
      } else if (eventInput.eventType === 'message.send.unknown') {
        const uncertain = await markSendUnknown(
          client,
          eventInput,
          processedAt,
        );
        messageId = uncertain.messageId;
        outcome.commandId = eventInput.commandId;
        outcome.deliveryStatus = 'outcome_unknown';
      } else if (
        ['message.delivered', 'message.read', 'message.failed'].includes(
          eventInput.eventType,
        )
      ) {
        const delivery = await updateDeliveryStatus(client, eventInput);
        messageId = delivery.messageId;
        outcome.deliveryStatus = delivery.status;
        outcome.changed = delivery.changed;
      } else if (eventInput.eventType === 'lead.updated') {
        await this.#mergeBriefing(
          client,
          conversation,
          eventInput,
          processedAt,
        );
        outcome.briefingVersion = Number(conversation.briefing_version) + 1;
      } else if (eventInput.eventType === 'handoff.requested') {
        if (eventInput.message) {
          messageId = await this.#recordSentMessage(
            client,
            eventInput,
            runtime,
            conversation,
          );
        }
        const handoff = await createUnassignedHandoff(
          client,
          eventInput,
          runtime,
          this.envelopeKey,
          conversation,
          processedAt,
        );
        outcome.handoffId = handoff.id;
        outcome.targetRole = handoff.target_role;
      } else if (eventInput.eventType === 'workflow.failed') {
        outcome.failureCode = eventInput.failure?.code ?? 'WORKFLOW_FAILED';
      }
      if (
        eventInput.leadPatch &&
        eventInput.eventType !== 'lead.updated' &&
        conversation
      ) {
        await this.#mergeBriefing(
          client,
          conversation,
          eventInput,
          processedAt,
        );
        outcome.briefingVersion = Number(conversation.briefing_version) + 1;
      }
      if (
        claimId &&
        ['message.sent', 'handoff.requested'].includes(eventInput.eventType)
      ) {
        await client.query(
          `UPDATE crm.ai_turns
           SET status = 'completed', finished_at = $2,
               effect_state = $3
           WHERE id = $1 AND status = 'claimed'`,
          [
            claimId,
            processedAt,
            eventInput.eventType === 'message.sent'
              ? 'confirmed'
              : eventInput.message
                ? 'confirmed'
                : 'not_applicable',
          ],
        );
      }
      if (claimId && eventInput.eventType === 'message.send.unknown') {
        await client.query(
          `UPDATE crm.ai_turns
           SET status = 'failed', finished_at = $2,
               effect_state = 'outcome_unknown'
           WHERE id = $1 AND status = 'claimed'`,
          [claimId, processedAt],
        );
      }
      await insertReceipt(client, runtime, {
        conversationId: resolvedConversationId,
        correlationId: eventInput.correlationId,
        eventId: eventInput.eventId,
        eventType: eventInput.eventType,
        fingerprint: eventInput.eventFingerprint,
        idempotencyKey: eventInput.technical.idempotencyKey,
        idempotencyScope: 'n8n.events',
        messageId,
        occurredAt: eventInput.occurredAt,
        outcome,
        processedAt,
        runId,
      });
      await appendAudit(client, runtime, {
        action: `integration.n8n.${eventInput.eventType}`,
        actor: eventInput.technical.actor,
        correlationId: eventInput.correlationId,
        occurredAt: processedAt,
        reason: 'versioned n8n event accepted',
        targetId: resolvedConversationId ?? runId,
        targetType: resolvedConversationId ? 'conversation' : 'n8n_run',
        version: eventInput.automationEpoch ?? 1,
      });
      return {
        accepted: true,
        duplicate: false,
        event_id: eventInput.eventId,
        processed_at: processedAt,
        ...(eventInput.eventType === 'message.send.requested'
          ? { send_authorized: outcome.sendAuthorized === true }
          : {}),
      };
    });
  }

  /** @param {Queryable} client @param {string} conversationId @param {boolean} duplicate */
  async #inboundResponse(client, conversationId, duplicate) {
    const conversation = (
      await client.query('SELECT * FROM crm.conversations WHERE id = $1', [
        conversationId,
      ])
    ).rows[0];
    if (!conversation) throw new N8nNotFoundError('Conversation was not found');
    const briefing = await this.#readBriefing(client, conversation);
    return {
      accepted: true,
      automation_epoch: Number(conversation.automation_epoch),
      briefing_version: Number(conversation.briefing_version),
      conversation_id: conversation.id,
      duplicate,
      lead: briefing,
      mode: conversationMode(conversation),
      recent_messages: duplicate
        ? []
        : await this.#recentMessages(client, conversation.id),
      revision: Number(conversation.inbound_revision),
    };
  }

  /** @param {Queryable} client @param {any} conversation @param {any} claim @param {boolean} duplicate @param {string} [plainToken] */
  async #claimResponse(client, conversation, claim, duplicate, plainToken) {
    const token =
      plainToken ??
      decryptJson(
        claim.claim_token_envelope,
        `n8n-ai-turn-claim:${claim.id}`,
        this.envelopeKey,
      ).token;
    return {
      accepted: true,
      automation_epoch: Number(claim.automation_epoch),
      briefing_version: Number(conversation.briefing_version),
      claim_id: claim.id,
      claim_token: token,
      claimed: true,
      conversation_id: conversation.id,
      conversation_version: Number(conversation.version),
      duplicate,
      last_event_id: claim.last_event_id,
      lead: await this.#readBriefing(client, conversation),
      lease_expires_at: iso(claim.lease_expires_at),
      mode: conversationMode(conversation),
      recent_messages: await this.#recentMessages(client, conversation.id),
      revision: Number(conversation.inbound_revision),
    };
  }

  /** @param {Queryable} client @param {any} input */
  async #insertBriefing(client, input) {
    await client.query(
      `INSERT INTO crm.conversation_briefing_versions
         (conversation_id, version, source_revision, automation_epoch,
          context_envelope, key_version, workflow_key, workflow_version,
          execution_id, correlation_id, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 1, $6, $7, $8, $9, $10)`,
      [
        input.conversation.id,
        Number(input.conversation.briefing_version),
        Number(input.conversation.inbound_revision),
        Number(input.conversation.automation_epoch),
        JSON.stringify(
          encryptJson(
            input.briefing,
            `n8n-briefing:${input.conversation.id}:${input.conversation.briefing_version}`,
            this.envelopeKey,
          ),
        ),
        input.technical.workflowKey,
        input.technical.workflowVersion,
        input.technical.executionId,
        input.technical.correlationId,
        input.createdAt,
      ],
    );
  }

  /** @param {Queryable} client @param {any} conversation @param {any} input @param {string} createdAt */
  async #mergeBriefing(client, conversation, input, createdAt) {
    const current = await this.#readBriefing(client, conversation);
    const patch = Object.fromEntries(
      Object.entries(input.leadPatch ?? {}).filter(
        ([, value]) => value !== null,
      ),
    );
    const version = Number(conversation.briefing_version) + 1;
    await client.query(
      `UPDATE crm.conversations SET briefing_version = $2 WHERE id = $1`,
      [conversation.id, version],
    );
    await this.#insertBriefing(client, {
      briefing: { ...current, ...patch },
      conversation: { ...conversation, briefing_version: version },
      createdAt,
      technical: input.technical,
    });
  }

  /** @param {Queryable} client @param {any} conversation */
  async #readBriefing(client, conversation) {
    if (Number(conversation.briefing_version) === 0) return {};
    const row = (
      await client.query(
        `SELECT context_envelope FROM crm.conversation_briefing_versions
         WHERE conversation_id = $1 AND version = $2`,
        [conversation.id, conversation.briefing_version],
      )
    ).rows[0];
    if (!row) return {};
    return decryptJson(
      row.context_envelope,
      `n8n-briefing:${conversation.id}:${conversation.briefing_version}`,
      this.envelopeKey,
    );
  }

  /** @param {Queryable} client @param {string} conversationId */
  async #recentMessages(client, conversationId) {
    const rows = (
      await client.query(
        `SELECT id, external_message_id, direction, author_kind, message_type,
                content_envelope, occurred_at
         FROM crm.messages
         WHERE conversation_id = $1
           AND occurred_at >= now() - interval '24 hours'
         ORDER BY occurred_at DESC, id DESC LIMIT 20`,
        [conversationId],
      )
    ).rows.reverse();
    return rows.map((row) => {
      const content = decryptJson(
        row.content_envelope,
        `message:${row.id}`,
        this.messageEnvelopeKey,
      );
      return {
        attachment_id: content.attachmentId ?? null,
        external_id: row.external_message_id,
        occurred_at: iso(row.occurred_at),
        sender_type:
          row.direction === 'inbound'
            ? 'customer'
            : row.author_kind === 'assistant'
              ? 'ai'
              : row.author_kind,
        text: content.text ?? content.caption ?? '',
        type: row.message_type,
      };
    });
  }

  /** @param {Queryable} client @param {any} input @param {any} runtime @param {any} conversation */
  async #recordSentMessage(client, input, runtime, conversation) {
    if (!input.message)
      throw new N8nConflictError('message.sent requires message');
    const type = input.message.type;
    if (!['audio', 'document', 'image', 'text', 'video'].includes(type)) {
      throw new N8nConflictError('Unsupported outbound message type');
    }
    const content =
      type === 'text'
        ? { text: String(input.message.text ?? '') }
        : {
            attachmentId: input.message.attachment_id ?? input.message.media_id,
            caption: input.message.text ?? null,
          };
    if (input.commandId) {
      const updated = await client.query(
        `UPDATE crm.messages
         SET external_message_id = COALESCE(external_message_id, $2),
             status = 'sent', delivery_status = 'sent', delivery_status_at = $3,
             n8n_execution_id = $4
         WHERE conversation_id = $1 AND command_id = $5
           AND (external_message_id IS NULL OR external_message_id = $2)
         RETURNING id`,
        [
          input.conversationId,
          input.externalMessageId,
          input.occurredAt,
          input.technical.executionId,
          input.commandId,
        ],
      );
      if (!updated.rows[0])
        throw new N8nConflictError('Send command was not reserved');
      await client.query(
        `UPDATE crm.n8n_commands
         SET status = 'sent', external_message_id = $2, updated_at = $3,
             completed_at = $3, locked_by = NULL, locked_until = NULL
         WHERE command_id = $1 AND status IN ('pending', 'processing')`,
        [input.commandId, input.externalMessageId, input.occurredAt],
      );
      await client.query(
        `UPDATE crm.message_delivery_attempts
         SET external_message_id = COALESCE(external_message_id, $2),
             status = 'sent', updated_at = $3, error_code = NULL
         WHERE message_id = $1 AND attempt_no = 1`,
        [updated.rows[0].id, input.externalMessageId, input.occurredAt],
      );
      return updated.rows[0].id;
    }
    const id = runtime.idFactory('message');
    await client.query(
      `INSERT INTO crm.messages
         (id, conversation_id, provider, provider_account_id,
          external_message_id, command_id, direction, author_kind, author_id,
          message_type, content_envelope, key_version, status, occurred_at,
          created_at, inbound_revision, delivery_status, delivery_status_at,
          automation_epoch, n8n_execution_id)
       VALUES ($1, $2, $3, $4, $5, NULL, 'outbound', 'assistant',
               'AUTOMATION_EXECUTOR', $6, $7::jsonb, 1, 'sent', $8, $9,
               NULL, 'sent', $8, $10, $11)`,
      [
        id,
        conversation.id,
        conversation.provider,
        conversation.provider_account_id,
        input.externalMessageId,
        type,
        JSON.stringify(
          encryptJson(content, `message:${id}`, this.messageEnvelopeKey),
        ),
        input.occurredAt,
        validClock(runtime.clock),
        input.automationEpoch,
        input.technical.executionId,
      ],
    );
    return id;
  }

  /** @param {Queryable} client @param {any} input @param {any} runtime @param {any} conversation @param {string} now @param {any} panelCommand */
  async #reserveAutomatedSend(
    client,
    input,
    runtime,
    conversation,
    now,
    panelCommand,
  ) {
    if (!input.commandId || !input.message) {
      throw new N8nConflictError(
        'message.send.requested requires command_id and message',
      );
    }
    if (panelCommand) {
      const existingAttempt = await client.query(
        `SELECT id FROM crm.message_delivery_attempts
         WHERE message_id = $1 FOR UPDATE`,
        [panelCommand.message_id],
      );
      if (existingAttempt.rows.length > 0) {
        throw new N8nConflictError(
          'Send was already authorized',
          'SEND_ALREADY_AUTHORIZED',
        );
      }
      await client.query(
        `UPDATE crm.messages
         SET n8n_execution_id = $2, automation_epoch = $3
         WHERE id = $1`,
        [
          panelCommand.message_id,
          input.technical.executionId,
          input.automationEpoch,
        ],
      );
      await insertDeliveryAuthorization(client, runtime, {
        commandId: panelCommand.command_id,
        messageId: panelCommand.message_id,
        now,
        provider: conversation.provider,
      });
      return {
        messageId: panelCommand.message_id,
        sendAuthorized: true,
      };
    }
    const id = runtime.idFactory('message');
    const type = input.message.type;
    const content =
      type === 'text'
        ? { text: String(input.message.text ?? '') }
        : {
            attachmentId: input.message.attachment_id ?? input.message.media_id,
            caption: input.message.text ?? null,
          };
    const messageEnvelope = encryptJson(
      content,
      `message:${id}`,
      this.messageEnvelopeKey,
    );
    await client.query(
      `INSERT INTO crm.messages
         (id, conversation_id, provider, provider_account_id, command_id,
          direction, author_kind, author_id, message_type, content_envelope,
          key_version, status, occurred_at, created_at, automation_epoch,
          n8n_execution_id)
       VALUES ($1, $2, $3, $4, $5, 'outbound', 'assistant',
               'AUTOMATION_EXECUTOR', $6, $7::jsonb, 1, 'queued', $8, $8,
               $9, $10)`,
      [
        id,
        conversation.id,
        conversation.provider,
        conversation.provider_account_id,
        input.commandId,
        type,
        JSON.stringify(messageEnvelope),
        now,
        input.automationEpoch,
        input.technical.executionId,
      ],
    );
    await insertDeliveryAuthorization(client, runtime, {
      commandId: null,
      messageId: id,
      now,
      provider: conversation.provider,
    });
    return { messageId: id, sendAuthorized: true };
  }
}

/** @param {Queryable} client @param {any} runtime @param {any} input */
async function insertDeliveryAuthorization(client, runtime, input) {
  await client.query(
    `INSERT INTO crm.message_delivery_attempts
       (id, message_id, command_id, attempt_no, provider, status,
        occurred_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, 'pending', $5, $5)`,
    [
      runtime.idFactory('delivery-attempt'),
      input.messageId,
      input.commandId,
      input.provider,
      input.now,
    ],
  );
}

/** @param {Queryable} client @param {any} runtime @param {any} input */
async function insertReceipt(client, runtime, input) {
  await client.query(
    `INSERT INTO crm.n8n_events
       (id, idempotency_scope, idempotency_key, external_event_id, event_type,
        fingerprint, conversation_id, message_id, run_id, correlation_id,
        outcome, occurred_at, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [
      runtime.idFactory('n8n-event'),
      input.idempotencyScope,
      input.idempotencyKey,
      input.eventId,
      input.eventType,
      input.fingerprint,
      input.conversationId,
      input.messageId,
      input.runId,
      input.correlationId,
      JSON.stringify(input.outcome),
      input.occurredAt,
      input.processedAt,
    ],
  );
}

/** @param {Queryable} client @param {string} scope @param {string} key */
async function selectReceipt(client, scope, key) {
  return (
    await client.query(
      `SELECT * FROM crm.n8n_events
       WHERE idempotency_scope = $1 AND idempotency_key = $2`,
      [scope, key],
    )
  ).rows[0];
}

/** @param {any} receipt @param {string} expected */
function assertFingerprint(receipt, expected) {
  if (receipt.fingerprint !== expected) {
    throw new N8nConflictError(
      'Idempotency key was reused with a different payload',
      'IDEMPOTENCY_CONFLICT',
    );
  }
}

/** @param {Queryable} client @param {any} input */
async function upsertRun(client, input) {
  const existing = await client.query(
    `SELECT id FROM crm.automation_runs
     WHERE workflow_key = $1 AND workflow_version = $2 AND execution_id = $3`,
    [
      input.technical.workflowKey,
      input.technical.workflowVersion,
      input.technical.executionId,
    ],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE crm.automation_runs
       SET ai_provider = COALESCE(ai_provider, $2),
           ai_model = COALESCE(ai_model, $3),
           prompt_version = COALESCE(prompt_version, $4),
           status = CASE WHEN status = 'running' THEN $5 ELSE status END,
           result_code = COALESCE($6, result_code),
           updated_at = GREATEST(updated_at, $7::timestamptz),
           completed_at = CASE
             WHEN status = 'running' AND $5::text <> 'running'
               THEN $7::timestamptz
             ELSE completed_at
           END
       WHERE id = $1`,
      [
        existing.rows[0].id,
        input.aiProvider,
        input.aiModel,
        input.promptVersion,
        input.status,
        input.resultCode,
        input.occurredAt,
      ],
    );
    return existing.rows[0].id;
  }
  await client.query(
    `INSERT INTO crm.automation_runs
       (id, workflow_key, workflow_version, execution_id, correlation_id,
        conversation_id, source_message_id, automation_epoch, status,
        ai_provider, ai_model, prompt_version, result_code, started_at,
        updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14::timestamptz, $14::timestamptz,
             CASE WHEN $9::text = 'running' THEN NULL
                  ELSE $14::timestamptz END)`,
    [
      input.id,
      input.technical.workflowKey,
      input.technical.workflowVersion,
      input.technical.executionId,
      input.technical.correlationId,
      input.conversationId,
      input.messageId,
      input.automationEpoch,
      input.status ?? 'running',
      input.aiProvider ?? null,
      input.aiModel ?? null,
      input.promptVersion ?? null,
      input.resultCode ?? null,
      input.occurredAt,
    ],
  );
  return input.id;
}

/** @param {Queryable} client @param {any} input */
async function resolveEventConversation(client, input) {
  let rows = [];
  if (input.commandId) {
    rows = (
      await client.query(
        `SELECT DISTINCT conversation_id
         FROM (
           SELECT conversation_id FROM crm.n8n_commands WHERE command_id = $1
           UNION ALL
           SELECT conversation_id FROM crm.messages WHERE command_id = $1
         ) AS candidates`,
        [input.commandId],
      )
    ).rows;
  } else if (input.externalMessageId) {
    rows = (
      await client.query(
        `SELECT DISTINCT conversation_id FROM crm.messages
         WHERE external_message_id = $1`,
        [input.externalMessageId],
      )
    ).rows;
  }
  if (rows.length === 0) {
    throw new N8nNotFoundError('Event target was not found');
  }
  if (rows.length !== 1) {
    throw new N8nConflictError(
      'Event target is ambiguous',
      'AMBIGUOUS_EVENT_TARGET',
    );
  }
  return rows[0].conversation_id;
}

/** @param {Queryable} client @param {string} commandId */
async function selectPanelCommand(client, commandId) {
  return (
    await client.query(
      `SELECT command.*,
              EXISTS (
                SELECT 1 FROM crm.message_delivery_attempts AS attempt
                WHERE attempt.message_id = command.message_id
              ) AS has_delivery_attempt
       FROM crm.n8n_commands AS command
       WHERE command.command_id = $1
       FOR UPDATE`,
      [commandId],
    )
  ).rows[0];
}

/** @param {any} command @param {any} conversation @param {any} input @param {Buffer} key */
function assertPanelSendFence(command, conversation, input, key) {
  const allowedStatus =
    input.eventType === 'message.sent'
      ? ['processing', 'sent'].includes(command.status)
      : command.status === 'processing';
  if (
    command.action !== 'send_message' ||
    command.actor_kind !== 'human' ||
    !command.message_id ||
    !allowedStatus ||
    Number(command.automation_epoch) !== Number(input.automationEpoch) ||
    Number(conversation?.automation_epoch) !== Number(input.automationEpoch) ||
    conversation?.automation_state !== 'human' ||
    conversation?.terminal_at
  ) {
    throw new N8nConflictError('Panel send command fence is stale');
  }
  if (input.eventType === 'message.sent' && !command.has_delivery_attempt) {
    throw new N8nConflictError('Send was not authorized');
  }
  if (input.eventType !== 'message.send.unknown') {
    const payload = decryptJson(
      command.payload_envelope,
      `n8n-command:${command.command_id}`,
      key,
    );
    if (
      fingerprint(comparableOutbound(payload.message)) !==
      fingerprint(comparableOutbound(input.message))
    ) {
      throw new N8nConflictError(
        'Command payload differs from the authorized message',
        'COMMAND_PAYLOAD_MISMATCH',
      );
    }
  }
}

/** @param {any} message */
function comparableOutbound(message) {
  return {
    attachmentId:
      message?.attachment_id ??
      message?.media_id ??
      message?.attachmentId ??
      null,
    text: message?.text ?? null,
    type: message?.type ?? null,
  };
}

/** @param {Queryable} client @param {any} conversation @param {any} input @param {string} now */
async function assertClaim(client, conversation, input, now) {
  if (
    !conversation ||
    input.automationEpoch === null ||
    !input.claimId ||
    !input.claimToken ||
    input.revision === null ||
    input.expectedVersion === null
  ) {
    throw new N8nConflictError('Automation event requires a current claim');
  }
  if (
    conversation.automation_state !== 'assistant' ||
    Number(conversation.automation_epoch) !== input.automationEpoch ||
    Number(conversation.inbound_revision) !== input.revision ||
    Number(conversation.version) !== input.expectedVersion
  ) {
    throw new N8nConflictError('Automation claim fence is stale');
  }
  const claim = (
    await client.query(
      `SELECT id FROM crm.ai_turns
       WHERE id = $1 AND conversation_id = $2 AND automation_epoch = $3
         AND revision = $4 AND claim_token_hash = $5
         AND workflow_key = $6 AND workflow_version = $7
         AND status = 'claimed' AND lease_expires_at > $8
       FOR UPDATE`,
      [
        input.claimId,
        conversation.id,
        input.automationEpoch,
        input.revision,
        tokenHash(input.claimToken),
        input.technical.workflowKey,
        input.technical.workflowVersion,
        now,
      ],
    )
  ).rows[0];
  if (!claim) throw new N8nConflictError('AI turn claim is stale or expired');
  return claim.id;
}

/** @param {string} eventType */
function automationRunStatus(eventType) {
  if (eventType === 'workflow.failed') return 'failed';
  if (eventType === 'message.send.unknown') return 'outcome_unknown';
  if (['message.sent', 'handoff.requested'].includes(eventType)) {
    return 'completed';
  }
  return 'running';
}

/** @param {Queryable} client @param {any} input */
async function updateDeliveryStatus(client, input) {
  const message = (
    await client.query(
      `SELECT id, delivery_status FROM crm.messages
       WHERE external_message_id = $1 AND conversation_id = $2
       FOR UPDATE`,
      [input.externalMessageId, input.conversationId],
    )
  ).rows[0];
  if (!message) throw new N8nNotFoundError('Outbound message was not found');
  const requested = /** @type {Record<string, string>} */ ({
    'message.sent': 'sent',
    'message.delivered': 'delivered',
    'message.failed': 'failed',
    'message.read': 'read',
  })[input.eventType];
  const rank = /** @type {Record<string, number>} */ ({
    sent: 1,
    delivered: 2,
    read: 3,
  });
  const current = message.delivery_status;
  const changed =
    requested === 'failed'
      ? current === null || current === 'sent'
      : !current ||
        current === 'failed' ||
        (rank[requested] ?? 0) > (rank[current] ?? 0);
  if (changed) {
    await client.query(
      `UPDATE crm.messages
       SET delivery_status = $2, delivery_status_at = $3,
           status = CASE WHEN $2 = 'failed' THEN 'failed' ELSE status END
       WHERE id = $1`,
      [message.id, requested, input.occurredAt],
    );
    await client.query(
      `UPDATE crm.message_delivery_attempts
       SET status = $2, updated_at = $3,
           error_code = CASE WHEN $2 = 'failed' THEN 'CHANNEL_FAILED' ELSE NULL END
       WHERE message_id = $1 AND attempt_no = 1`,
      [message.id, requested, input.occurredAt],
    );
  }
  return {
    changed,
    messageId: message.id,
    status: changed ? requested : current,
  };
}

/** @param {Queryable} client @param {any} input @param {string} now */
async function markSendUnknown(client, input, now) {
  if (!input.commandId) {
    throw new N8nConflictError('message.send.unknown requires command_id');
  }
  const command = (
    await client.query(
      `UPDATE crm.n8n_commands
       SET status = 'outcome_unknown', locked_by = NULL, locked_until = NULL,
           retryable = false, retry_safe = false,
           last_error_code = 'OUTCOME_UNKNOWN', updated_at = $2,
           completed_at = $2
       WHERE command_id = $1 AND status IN ('pending', 'processing', 'failed')
       RETURNING message_id`,
      [input.commandId, now],
    )
  ).rows[0];
  const messageId =
    command?.message_id ??
    (
      await client.query(
        `SELECT id FROM crm.messages
         WHERE command_id = $1 AND conversation_id = $2
         FOR UPDATE`,
        [input.commandId, input.conversationId],
      )
    ).rows[0]?.id;
  if (!messageId) throw new N8nNotFoundError('Send reservation was not found');
  if (messageId) {
    await client.query(
      `UPDATE crm.messages
       SET status = 'outcome_unknown', delivery_status = 'outcome_unknown',
           delivery_status_at = $2
       WHERE id = $1`,
      [messageId, now],
    );
    await client.query(
      `UPDATE crm.message_delivery_attempts
       SET status = 'outcome_unknown', updated_at = $2,
           error_code = 'OUTCOME_UNKNOWN'
       WHERE message_id = $1 AND attempt_no = 1`,
      [messageId, now],
    );
  }
  if (command) {
    await client.query(
      `INSERT INTO crm.reconciliation_items
         (id, job_id, status, reason, created_at)
       SELECT gen_random_uuid()::text, id, 'open', 'external_outcome_unknown', $2
       FROM crm.outbox_jobs WHERE n8n_command_id = $1
       ON CONFLICT (job_id) DO NOTHING`,
      [input.commandId, now],
    );
  }
  return { messageId };
}

/** @param {Queryable} client @param {any} input @param {any} runtime @param {Buffer} key @param {any} conversation @param {string} now */
async function createUnassignedHandoff(
  client,
  input,
  runtime,
  key,
  conversation,
  now,
) {
  const reason = input.handoff?.reason;
  const reasonMap = /** @type {Record<string, string>} */ ({
    human_requested: 'customer_requested_human',
    negotiation: 'price_before_quote',
  });
  const reasonCode = reasonMap[reason] ?? reason ?? 'unresolved_blocker';
  const targetRole = [
    'briefing_complete',
    'negotiation',
    'price_before_quote',
  ].includes(reason)
    ? 'Vendedor'
    : 'Atendimento';
  const existing = await client.query(
    `SELECT id FROM crm.handoffs
     WHERE conversation_id = $1 AND status IN ('pending', 'accepted')
     FOR UPDATE`,
    [conversation.id],
  );
  if (existing.rows[0])
    throw new N8nConflictError('Active handoff already exists');
  const id = runtime.idFactory('handoff');
  const summary = String(
    input.handoff?.summary ?? input.handoff?.reasoning ?? reasonCode,
  ).slice(0, 8192);
  const slaMinutes = 240;
  const dueAt = new Date(
    new Date(now).getTime() + slaMinutes * 60_000,
  ).toISOString();
  const changedConversation = (
    await client.query(
      `UPDATE crm.conversations
       SET automation_state = 'human', automation_epoch = automation_epoch + 1,
           state = 'requer_atencao', assigned_user_id = NULL,
           version = version + 1
       WHERE id = $1 AND automation_state = 'assistant'
         AND automation_epoch = $2
       RETURNING *`,
      [conversation.id, input.automationEpoch],
    )
  ).rows[0];
  if (!changedConversation)
    throw new N8nConflictError('Automation epoch is stale');
  return (
    await client.query(
      `INSERT INTO crm.handoffs
         (id, deal_id, conversation_id, assigned_user_id, target_role, status,
          version, reason_code, summary_envelope, due_at, sla_minutes,
          sla_policy_version, automation_workflow_key,
          automation_workflow_version, automation_execution_id, created_at,
          updated_at)
       VALUES ($1, NULL, $2, NULL, $3, 'pending', 1, $4, $5::jsonb, $6, $7,
               'n8n-v1', $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        id,
        conversation.id,
        targetRole,
        reasonCode,
        JSON.stringify(
          encryptJson(summary, `${conversation.id}:handoff:summary`, key),
        ),
        dueAt,
        slaMinutes,
        input.technical.workflowKey,
        input.technical.workflowVersion,
        input.technical.executionId,
        now,
      ],
    )
  ).rows[0];
}

/** @param {Queryable} client @param {any} runtime @param {any} input */
async function appendAudit(client, runtime, input) {
  await client.query(
    `INSERT INTO crm.audit_events
       (id, actor_id, action, target_type, target_id, version, reason,
        correlation_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      runtime.idFactory('audit'),
      input.actor,
      input.action,
      input.targetType,
      input.targetId,
      String(input.version),
      input.reason,
      input.correlationId,
      input.occurredAt,
    ],
  );
}

/** @param {any} row */
function conversationMode(row) {
  if (row.terminal_at !== null) return 'closed';
  if (row.automation_state === 'assistant') return 'ai_active';
  return row.state === 'requer_atencao' ? 'handoff_pending' : 'human_active';
}

/** @param {any} outcome @param {boolean} duplicate */
function attachmentResponse(outcome, duplicate) {
  const value = typeof outcome === 'string' ? JSON.parse(outcome) : outcome;
  return { accepted: true, duplicate, ...value };
}

/** @param {Queryable} client */
async function transactionBounds(client) {
  await client.query("SET LOCAL lock_timeout = '1500ms'");
  await client.query("SET LOCAL statement_timeout = '5s'");
  await client.query("SET LOCAL transaction_timeout = '10s'");
}

/** @param {Queryable} client @param {string} key */
async function advisoryLock(client, key) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    key,
  ]);
}

/** @param {() => Date} clock */
function validClock(clock) {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('clock must return a valid Date');
  }
  return now.toISOString();
}

/** @param {unknown} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
