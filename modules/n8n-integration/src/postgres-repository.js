import {
  decryptJson,
  encryptJson,
  fingerprint,
  identityLookupHash,
} from './crypto.js';
import { N8nConflictError, N8nNotFoundError } from './errors.js';

/** @typedef {{query(sql: string, values?: unknown[]): Promise<{rows: any[]}>}} Queryable */

const CONTACT_DISPLAY_NAME_MAX_LENGTH = 120;

/**
 * Mirrors the conversation change onto the shared domain event stream so the
 * `inbox` SSE topic pushes it to open panels. The n8n integration owns its own
 * persistence path, so without this the Inbox would stay live for human
 * commands but go quiet for everything arriving from WhatsApp.
 *
 * `aggregate_version` counts occurrences of this event type for this
 * conversation: the unique constraint on
 * (aggregate_type, aggregate_id, aggregate_version, event_type) would otherwise
 * drop events that land while the conversation version is unchanged.
 *
 * @param {Queryable} client
 * @param {any} runtime
 * @param {{conversationId: string, correlationId: string, occurredAt: string, type: string}} event
 */
async function appendConversationStreamEvent(client, runtime, event) {
  await client.query(
    `INSERT INTO crm.domain_events
       (id, aggregate_type, aggregate_id, aggregate_version, event_type,
        payload, correlation_id, occurred_at)
     SELECT $1, 'conversation', $2,
            COALESCE((SELECT max(existing.aggregate_version)
                      FROM crm.domain_events existing
                      WHERE existing.aggregate_type = 'conversation'
                        AND existing.aggregate_id = $2
                        AND existing.event_type = $3), 0) + 1,
            $3, $4::jsonb, $5, $6`,
    [
      runtime.idFactory('event'),
      event.conversationId,
      event.type,
      JSON.stringify({ conversationId: event.conversationId }),
      event.correlationId,
      event.occurredAt,
    ],
  );
}

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
                     $8, $8, NULL, 1, 0, 0, $9)
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
      await insertReceipt(client, runtime, {
        automationEpoch: Number(conversation.automation_epoch),
        conversationId: conversation.id,
        correlationId: input.correlationId,
        eventId: input.externalEventId,
        eventType: 'message.inbound',
        fingerprint: input.eventFingerprint,
        idempotencyKey: input.technical.idempotencyKey,
        idempotencyScope: 'n8n.messages.inbound',
        messageId,
        occurredAt: input.occurredAt,
        outcome: { sourceRevision: Number(conversation.inbound_revision) },
        processedAt: now,
        sourceRevision: Number(conversation.inbound_revision),
        technical: input.technical,
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
      await appendConversationStreamEvent(client, runtime, {
        conversationId: conversation.id,
        correlationId: input.correlationId,
        occurredAt: now,
        type: 'conversation.message_received',
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
        if (!conversation.rows[0]) {
          throw new N8nNotFoundError('Conversation was not found');
        }
        throw new N8nNotFoundError('Message was not found in the conversation');
      }
      const media = (
        await client.query(
          `SELECT id, content_sha256, detected_mime_type, size_bytes
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
        automationEpoch: null,
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
        sourceRevision: null,
        technical: input.technical,
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
        const previous = jsonObject(replay.outcome);
        return {
          accepted: true,
          duplicate: true,
          event_id: replay.external_event_id,
          processed_at: iso(replay.processed_at),
          ...(replay.event_type === 'message.send.requested'
            ? { send_authorized: false }
            : {}),
          ...(previous.handoffId ? { handoff_id: previous.handoffId } : {}),
        };
      }

      const processedAt = validClock(runtime.clock);
      const resolvedConversationId =
        input.conversationId ??
        (input.eventType === 'workflow.failed'
          ? null
          : await resolveEventConversation(client, input));
      const eventInput = { ...input, conversationId: resolvedConversationId };
      let conversation = null;
      if (resolvedConversationId) {
        conversation = (
          await client.query(
            'SELECT * FROM crm.conversations WHERE id = $1 FOR UPDATE',
            [resolvedConversationId],
          )
        ).rows[0];
        if (!conversation) {
          throw new N8nNotFoundError('Conversation was not found');
        }
      }

      let messageId = null;
      const outcome = {};
      if (eventInput.eventType === 'message.send.requested') {
        const reservation = await this.#reserveSend(
          client,
          eventInput,
          runtime,
          conversation,
          processedAt,
        );
        messageId = reservation.messageId;
        outcome.sendAuthorized = true;
      } else if (eventInput.eventType === 'message.sent') {
        const sent = await confirmReservedSend(client, eventInput, processedAt);
        messageId = sent.messageId;
        outcome.deliveryStatus = sent.status;
      } else if (
        ['message.delivered', 'message.read', 'message.failed'].includes(
          eventInput.eventType,
        )
      ) {
        const delivery = await updateDeliveryStatus(client, eventInput);
        messageId = delivery.messageId;
        outcome.deliveryStatus = delivery.status;
        outcome.changed = delivery.changed;
      } else if (eventInput.eventType === 'message.send.unknown') {
        const uncertain = await markSendUnknown(
          client,
          eventInput,
          processedAt,
        );
        messageId = uncertain.messageId;
        outcome.deliveryStatus = 'outcome_unknown';
      } else if (eventInput.eventType === 'handoff.requested') {
        assertCurrentAutomatedTurn(conversation, eventInput);
        if (eventInput.briefingPatch) {
          await this.#mergeBriefing(
            client,
            conversation,
            eventInput.briefingPatch,
            runtime,
            processedAt,
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
        outcome.failureCode = safeFailureCode(eventInput.failure?.code);
      }

      await insertReceipt(client, runtime, {
        automationEpoch: eventInput.automationEpoch,
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
        sourceRevision: eventInput.sourceRevision,
        technical: eventInput.technical,
      });
      await appendAudit(client, runtime, {
        action: `integration.n8n.${eventInput.eventType}`,
        actor: eventInput.technical.actor,
        correlationId: eventInput.correlationId,
        occurredAt: processedAt,
        reason: 'n8n MVP event accepted',
        targetId: resolvedConversationId ?? eventInput.eventId,
        targetType: resolvedConversationId ? 'conversation' : 'n8n_workflow',
        version: eventInput.automationEpoch ?? 1,
      });
      if (resolvedConversationId) {
        await appendConversationStreamEvent(client, runtime, {
          conversationId: resolvedConversationId,
          correlationId: eventInput.correlationId,
          occurredAt: processedAt,
          type: `conversation.n8n.${eventInput.eventType}`,
        });
      }
      return {
        accepted: true,
        duplicate: false,
        event_id: eventInput.eventId,
        processed_at: processedAt,
        ...(eventInput.eventType === 'message.send.requested'
          ? { send_authorized: true }
          : {}),
        ...(outcome.handoffId ? { handoff_id: outcome.handoffId } : {}),
      };
    });
  }

  /** @param {Queryable} client @param {string} conversationId @param {boolean} duplicate */
  async #inboundResponse(client, conversationId, duplicate) {
    const conversation = (
      await client.query(
        `SELECT conversation.*, identity.current_contact_id
         FROM crm.conversations AS conversation
         JOIN crm.contact_identities AS identity
           ON identity.id = conversation.contact_identity_id
         WHERE conversation.id = $1`,
        [conversationId],
      )
    ).rows[0];
    if (!conversation) throw new N8nNotFoundError('Conversation was not found');
    return {
      accepted: true,
      automation_epoch: Number(conversation.automation_epoch),
      briefing: this.#readBriefing(conversation),
      briefing_version: Number(conversation.briefing_version),
      contact_id: conversation.current_contact_id,
      conversation_id: conversation.id,
      conversation_version: Number(conversation.version),
      duplicate,
      mode: conversationMode(conversation),
      recent_messages: await this.#recentMessages(client, conversation.id),
      source_revision: Number(conversation.inbound_revision),
    };
  }

  /** @param {any} conversation */
  #readBriefing(conversation) {
    if (!conversation.briefing_envelope) return {};
    return decryptJson(
      conversation.briefing_envelope,
      `n8n-briefing:${conversation.id}:${conversation.briefing_version}`,
      this.envelopeKey,
    );
  }

  /** @param {Queryable} client @param {any} conversation @param {Record<string, unknown>} patch @param {any} runtime @param {string} now */
  async #mergeBriefing(client, conversation, patch, runtime, now) {
    const current = this.#readBriefing(conversation);
    const values = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== null),
    );
    if (Object.keys(values).length === 0) return;
    const version = Number(conversation.briefing_version) + 1;
    const envelope = encryptJson(
      { ...current, ...values },
      `n8n-briefing:${conversation.id}:${version}`,
      this.envelopeKey,
    );
    await client.query(
      `UPDATE crm.conversations
       SET briefing_version = $2, briefing_envelope = $3::jsonb,
           briefing_updated_at = $4
       WHERE id = $1`,
      [conversation.id, version, JSON.stringify(envelope), now],
    );
    conversation.briefing_version = version;
    conversation.briefing_envelope = envelope;
    conversation.briefing_updated_at = now;
    await this.#promoteCustomerName(
      client,
      conversation,
      values.customer_name,
      runtime,
      now,
    );
  }

  /**
   * Exposes the name supplied by a customer on CRM readers. An operator rename
   * remains authoritative; the guided workflow can change only a blank or
   * automation-owned name.
   * @param {Queryable} client
   * @param {any} conversation
   * @param {unknown} customerName
   * @param {any} runtime
   * @param {string} now
   */
  async #promoteCustomerName(client, conversation, customerName, runtime, now) {
    const displayName = automationDisplayName(customerName);
    if (!displayName) return;
    const contact = (
      await client.query(
        `SELECT contact.id, contact.display_name, contact.display_name_source
         FROM crm.contacts AS contact
         JOIN crm.contact_identities AS identity
           ON identity.current_contact_id = contact.id
         WHERE identity.id = $1
         FOR UPDATE OF contact`,
        [conversation.contact_identity_id],
      )
    ).rows[0];
    if (
      !contact ||
      (contact.display_name !== null &&
        contact.display_name_source !== 'automation')
    ) {
      return;
    }
    const updated = (
      await client.query(
        `UPDATE crm.contacts
         SET display_name = $2, display_name_source = 'automation',
             version = version + 1, updated_at = $3
         WHERE id = $1
           AND (display_name IS NULL OR display_name_source = 'automation')
           AND (display_name IS DISTINCT FROM $2
                OR display_name_source IS DISTINCT FROM 'automation')
         RETURNING id, version`,
        [contact.id, displayName, now],
      )
    ).rows[0];
    if (!updated) return;
    const correlationId = `n8n-contact-name:${conversation.id}`;
    await appendAudit(client, runtime, {
      action: 'contact.name_collected',
      actor: 'AUTOMATION_EXECUTOR',
      correlationId,
      occurredAt: now,
      reason: 'customer name collected by guided workflow',
      targetId: updated.id,
      targetType: 'contact',
      version: Number(updated.version),
    });
    await client.query(
      `INSERT INTO crm.domain_events
         (id, aggregate_type, aggregate_id, aggregate_version, event_type,
          payload, correlation_id, occurred_at)
       VALUES ($1, 'contact', $2, $3, 'contact.name_collected', $4::jsonb,
               $5, $6)`,
      [
        runtime.idFactory('event'),
        updated.id,
        Number(updated.version),
        JSON.stringify({ contactId: updated.id }),
        correlationId,
        now,
      ],
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

  /** @param {Queryable} client @param {any} input @param {any} runtime @param {any} conversation @param {string} now */
  async #reserveSend(client, input, runtime, conversation, now) {
    if (!conversation || !input.commandId || !input.message) {
      throw new N8nConflictError('Send reservation is incomplete');
    }
    const panelCommand = await selectPanelCommand(client, input.commandId);
    if (panelCommand) {
      assertPanelSendFence(panelCommand, conversation, input, this.envelopeKey);
      const updated = await client.query(
        `UPDATE crm.messages
         SET status = 'sending', n8n_execution_id = $2,
             automation_epoch = $3
         WHERE id = $1 AND status = 'queued'
         RETURNING id`,
        [
          panelCommand.message_id,
          input.technical.executionId,
          input.automationEpoch,
        ],
      );
      if (!updated.rows[0]) {
        throw new N8nConflictError(
          'Send was already authorized',
          'SEND_ALREADY_AUTHORIZED',
        );
      }
      return { messageId: updated.rows[0].id };
    }

    assertCurrentAutomatedTurn(conversation, input);
    const type = outboundMessageType(input.message);
    const messageId = runtime.idFactory('message');
    const content = outboundMessageContent(input.message, type);
    await client.query(
      `INSERT INTO crm.messages
         (id, conversation_id, provider, provider_account_id, command_id,
          direction, author_kind, author_id, message_type, content_envelope,
          key_version, status, occurred_at, created_at, automation_epoch,
          n8n_execution_id)
       VALUES ($1, $2, $3, $4, $5, 'outbound', 'assistant',
               'AUTOMATION_EXECUTOR', $6, $7::jsonb, 1, 'sending', $8, $8,
               $9, $10)`,
      [
        messageId,
        conversation.id,
        conversation.provider,
        conversation.provider_account_id,
        input.commandId,
        type,
        JSON.stringify(
          encryptJson(content, `message:${messageId}`, this.messageEnvelopeKey),
        ),
        now,
        input.automationEpoch,
        input.technical.executionId,
      ],
    );
    if (input.briefingPatch) {
      await this.#mergeBriefing(
        client,
        conversation,
        input.briefingPatch,
        runtime,
        now,
      );
    }
    const updated = await client.query(
      `UPDATE crm.conversations
       SET claimed_revision = $2
       WHERE id = $1 AND automation_state = 'assistant'
         AND terminal_at IS NULL AND automation_epoch = $3
         AND inbound_revision = $2 AND claimed_revision < $2
       RETURNING id`,
      [conversation.id, input.sourceRevision, input.automationEpoch],
    );
    if (!updated.rows[0]) {
      throw new N8nConflictError(
        'Automated response is stale or already processed',
        'STALE_AUTOMATION_FENCE',
      );
    }
    return { messageId };
  }
}

/** @param {Queryable} client @param {any} runtime @param {any} input */
async function insertReceipt(client, runtime, input) {
  await client.query(
    `INSERT INTO crm.n8n_events
       (id, idempotency_scope, idempotency_key, external_event_id, event_type,
        fingerprint, conversation_id, message_id, run_id, correlation_id,
        outcome, occurred_at, processed_at, workflow_key, workflow_version,
        execution_id, automation_epoch, source_revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10::jsonb, $11,
             $12, $13, $14, $15, $16, $17)`,
    [
      runtime.idFactory('n8n-event'),
      input.idempotencyScope,
      input.idempotencyKey,
      input.eventId,
      input.eventType,
      input.fingerprint,
      input.conversationId,
      input.messageId,
      input.correlationId,
      JSON.stringify(input.outcome),
      input.occurredAt,
      input.processedAt,
      input.technical.workflowKey,
      input.technical.workflowVersion,
      input.technical.executionId,
      input.automationEpoch,
      input.sourceRevision,
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
      `SELECT command.*, message.status AS message_status
       FROM crm.n8n_commands AS command
       JOIN crm.messages AS message ON message.id = command.message_id
       WHERE command.command_id = $1
       FOR UPDATE OF command, message`,
      [commandId],
    )
  ).rows[0];
}

/** @param {any} command @param {any} conversation @param {any} input @param {Buffer} key */
function assertPanelSendFence(command, conversation, input, key) {
  if (
    command.action !== 'send_message' ||
    command.actor_kind !== 'human' ||
    !command.message_id ||
    command.message_status !== 'queued' ||
    command.status !== 'processing' ||
    Number(command.automation_epoch) !== Number(input.automationEpoch) ||
    Number(conversation.automation_epoch) !== Number(input.automationEpoch) ||
    Number(conversation.inbound_revision) !== Number(input.sourceRevision) ||
    conversation.automation_state !== 'human' ||
    conversation.terminal_at
  ) {
    throw new N8nConflictError('Panel send command fence is stale');
  }
  const payload = decryptJson(
    command.payload_envelope,
    `n8n-command:${command.command_id}`,
    key,
  );
  if (
    Number(payload.source_revision) !== Number(input.sourceRevision) ||
    fingerprint(comparableOutbound(payload.message)) !==
      fingerprint(comparableOutbound(input.message))
  ) {
    throw new N8nConflictError(
      'Command payload differs from the authorized message',
      'COMMAND_PAYLOAD_MISMATCH',
    );
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

/** @param {any} conversation @param {any} input */
function assertCurrentAutomatedTurn(conversation, input) {
  if (
    !conversation ||
    conversation.terminal_at ||
    conversation.automation_state !== 'assistant' ||
    Number(conversation.automation_epoch) !== Number(input.automationEpoch) ||
    Number(conversation.inbound_revision) !== Number(input.sourceRevision) ||
    Number(conversation.claimed_revision) >= Number(input.sourceRevision)
  ) {
    throw new N8nConflictError(
      'Automated response is stale or already processed',
      'STALE_AUTOMATION_FENCE',
    );
  }
}

/** @param {Queryable} client @param {any} input @param {string} now */
async function confirmReservedSend(client, input, now) {
  const message = (
    await client.query(
      `UPDATE crm.messages
       SET external_message_id = COALESCE(external_message_id, $2),
           status = 'sent',
           delivery_status = CASE
             WHEN delivery_status IN ('delivered', 'read') THEN delivery_status
             ELSE 'sent'
           END,
           delivery_status_at = CASE
             WHEN delivery_status IN ('delivered', 'read') THEN delivery_status_at
             ELSE $3
           END
       WHERE command_id = $1
         AND status IN ('sending', 'sent', 'failed', 'outcome_unknown')
         AND (external_message_id IS NULL OR external_message_id = $2)
       RETURNING id, delivery_status`,
      [input.commandId, input.externalMessageId, input.occurredAt],
    )
  ).rows[0];
  if (!message) throw new N8nNotFoundError('Send reservation was not found');
  await client.query(
    `UPDATE crm.n8n_commands
     SET status = 'sent', external_message_id = $2, updated_at = $3,
         completed_at = $3, locked_by = NULL, locked_until = NULL
     WHERE command_id = $1 AND status IN ('pending', 'processing')`,
    [input.commandId, input.externalMessageId, now],
  );
  return { messageId: message.id, status: message.delivery_status };
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
      ? current === null || current === 'sent' || current === 'outcome_unknown'
      : !current ||
        current === 'failed' ||
        current === 'outcome_unknown' ||
        (rank[requested] ?? 0) > (rank[current] ?? 0);
  if (changed) {
    await client.query(
      `UPDATE crm.messages
       SET delivery_status = $2, delivery_status_at = $3,
           status = CASE WHEN $2 = 'failed' THEN 'failed' ELSE status END
       WHERE id = $1`,
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
  const message = (
    await client.query(
      `UPDATE crm.messages
       SET status = 'outcome_unknown', delivery_status = 'outcome_unknown',
           delivery_status_at = $2
       WHERE command_id = $1 AND status = 'sending'
       RETURNING id`,
      [input.commandId, now],
    )
  ).rows[0];
  if (!message) throw new N8nNotFoundError('Send reservation was not found');
  await client.query(
    `UPDATE crm.n8n_commands
     SET status = 'outcome_unknown', locked_by = NULL, locked_until = NULL,
         retryable = false, retry_safe = false,
         last_error_code = 'OUTCOME_UNKNOWN', updated_at = $2,
         completed_at = $2
     WHERE command_id = $1 AND status IN ('pending', 'processing', 'failed')`,
    [input.commandId, now],
  );
  return { messageId: message.id };
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
  const targetRole = 'Vendedor';
  const existing = await client.query(
    `SELECT id FROM crm.handoffs
     WHERE conversation_id = $1 AND status IN ('pending', 'accepted')
     FOR UPDATE`,
    [conversation.id],
  );
  if (existing.rows[0]) {
    throw new N8nConflictError('Active handoff already exists');
  }
  const id = runtime.idFactory('handoff');
  const summary = String(
    input.handoff?.summary ?? input.handoff?.reasoning ?? reasonCode,
  ).slice(0, 8192);
  const slaMinutes = 240;
  const dueAt = new Date(
    new Date(now).getTime() + slaMinutes * 60_000,
  ).toISOString();
  const changed = (
    await client.query(
      `UPDATE crm.conversations
       SET automation_state = 'human', automation_epoch = automation_epoch + 1,
           claimed_revision = $3, state = 'requer_atencao',
           assigned_user_id = NULL, version = version + 1
       WHERE id = $1 AND automation_state = 'assistant'
         AND terminal_at IS NULL AND automation_epoch = $2
         AND inbound_revision = $3 AND claimed_revision < $3
       RETURNING id`,
      [conversation.id, input.automationEpoch, input.sourceRevision],
    )
  ).rows[0];
  if (!changed) {
    throw new N8nConflictError(
      'Automated handoff is stale or already processed',
      'STALE_AUTOMATION_FENCE',
    );
  }
  const handoff = (
    await client.query(
      `INSERT INTO crm.handoffs
         (id, deal_id, conversation_id, assigned_user_id, target_role, status,
          version, reason_code, summary_envelope, due_at, sla_minutes,
          sla_policy_version, automation_workflow_key,
          automation_workflow_version, automation_execution_id, created_at,
          updated_at)
       VALUES ($1, NULL, $2, NULL, $3, 'pending', 1, $4, $5::jsonb, $6, $7,
               'n8n-mvp-1', $8, $9, $10, $11, $11)
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
  await client.query(
    `INSERT INTO crm.handoff_history
       (handoff_id, resulting_version, from_status, to_status,
        assigned_user_id, target_role, actor_id, reason_code,
        correlation_id, occurred_at)
     VALUES ($1, 1, NULL, 'pending', NULL, $2, $3, $4, $5, $6)`,
    [
      handoff.id,
      handoff.target_role,
      input.technical.actor,
      handoff.reason_code,
      input.correlationId,
      now,
    ],
  );
  return handoff;
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

/** @param {any} message */
function outboundMessageType(message) {
  const type = message?.type;
  if (!['audio', 'document', 'image', 'text', 'video'].includes(type)) {
    throw new N8nConflictError('Unsupported outbound message type');
  }
  return type;
}

/** @param {any} message @param {string} type */
function outboundMessageContent(message, type) {
  return type === 'text'
    ? { text: String(message.text ?? '') }
    : {
        attachmentId: message.attachment_id ?? message.media_id,
        caption: message.text ?? null,
      };
}

/** @param {any} outcome @param {boolean} duplicate */
function attachmentResponse(outcome, duplicate) {
  const value = jsonObject(outcome);
  return { accepted: true, duplicate, ...value };
}

/** @param {unknown} value */
function jsonObject(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value && typeof value === 'object' ? value : {};
}

/** @param {unknown} value */
function safeFailureCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/u.test(value)
    ? value
    : 'WORKFLOW_FAILED';
}

/** @param {unknown} value */
function automationDisplayName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > CONTACT_DISPLAY_NAME_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
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
