import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  decryptJson,
  encryptJson,
  lockSellerWhatsAppLines,
  personalSendAllowed,
  sellerWhatsAppTarget,
  snapshotWhatsAppTarget,
} from '@crm-silmer/n8n-integration';
import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { orderReadable } from '@crm-silmer/orders';

/** @param {number} statusCode @param {string} code */
const refusal = (statusCode, code) =>
  Object.assign(new Error(code), { statusCode, code });

/** @param {any} database @param {{envelopeKey:Buffer,contactKey:Buffer,messageKey:Buffer,allowed:Set<string>,media:any,outbox:any,clock?:()=>Date}} options */
export function createOrderWhatsAppPdfRuntime(
  database,
  {
    envelopeKey,
    contactKey,
    messageKey,
    allowed,
    media,
    outbox,
    clock = () => new Date(),
  },
) {
  const audit = new PostgresAuditTrail(database);
  /** @param {any} client @param {any} input */
  async function current(client, input) {
    if (input.actor?.kind !== 'human' || !allowed.has(input.actor.id))
      throw refusal(403, 'FORBIDDEN');
    // WAP-07/08: an order whose Contact this seller may not read is not found.
    const found = (
      await client.query(
        `SELECT conversation_id FROM crm.orders WHERE id=$1
           AND ${orderReadable('orders', '$2')}`,
        [input.orderId, input.actor.id],
      )
    ).rows[0];
    if (!found) throw refusal(404, 'ORDER_NOT_FOUND');
    const conversationId = found.conversation_id;
    if (!conversationId) throw refusal(409, 'WHATSAPP_SEND_UNAVAILABLE');
    await lockSellerWhatsAppLines(client, [conversationId]);
    const conversation = (
      await client.query(
        'SELECT * FROM crm.conversations WHERE id=$1 FOR UPDATE',
        [conversationId],
      )
    ).rows[0];
    const target = await sellerWhatsAppTarget(client, conversationId);
    if (!target) throw refusal(409, 'WHATSAPP_SEND_UNAVAILABLE');
    if (
      target.sellerId !== input.actor.id ||
      conversation?.assigned_user_id !== input.actor.id
    )
      throw refusal(403, 'FORBIDDEN');
    if (!personalSendAllowed(target, input.actor.id, allowed))
      throw refusal(409, 'WHATSAPP_SEND_UNAVAILABLE');
    const order = (
      await client.query('SELECT * FROM crm.orders WHERE id=$1 FOR SHARE', [
        input.orderId,
      ])
    ).rows[0];
    if (
      !order ||
      order.origin !== 'atendimento' ||
      order.conversation_id !== conversationId ||
      order.contact_id !== target.contactId
    )
      throw refusal(409, 'VERSION_CONFLICT');
    if (order.status !== 'confirmado' || order.cancelled_at)
      throw refusal(409, 'ORDER_NOT_CONFIRMED');
    if (Number(order.version) !== input.expectedVersion)
      throw refusal(409, 'VERSION_CONFLICT');
    const destination = (
      await client.query(
        `SELECT i.identity_envelope,i.external_identity_lookup_hash,l.confirmed_number_envelope
      FROM crm.contact_identities i CROSS JOIN crm.seller_whatsapp_lines l
      WHERE i.id=$1 AND l.id=$2 AND i.current_contact_id=$3 AND i.provider='evolution'
        AND i.provider_account_id=$4 AND i.channel='whatsapp' AND i.phone_status='confirmed' FOR SHARE OF i`,
        [
          target.identityId,
          target.source.lineId,
          target.contactId,
          target.source.accountId,
        ],
      )
    ).rows[0];
    if (!destination?.confirmed_number_envelope)
      throw refusal(409, 'WHATSAPP_SEND_UNAVAILABLE');
    const { externalIdentityId: to } = decryptJson(
      destination.identity_envelope,
      JSON.stringify([
        'crm.contact_identities',
        1,
        destination.external_identity_lookup_hash,
      ]),
      contactKey,
    );
    const { number: from } = decryptJson(
      destination.confirmed_number_envelope,
      `seller-whatsapp-confirmed:${target.source.lineId}`,
      contactKey,
    );
    if (
      typeof to !== 'string' ||
      !/^\+[1-9][0-9]{7,14}$/u.test(to) ||
      typeof from !== 'string' ||
      !/^[1-9][0-9]{7,14}$/u.test(from)
    )
      throw refusal(409, 'WHATSAPP_SEND_UNAVAILABLE');
    const preparation = createHmac('sha256', envelopeKey)
      .update(
        JSON.stringify([
          order.id,
          order.version,
          conversation.id,
          conversation.version,
          snapshotWhatsAppTarget(target, { commercial: true }),
          from,
          to,
        ]),
      )
      .digest('hex');
    return {
      order,
      conversation,
      preparation,
      to,
      sender: `••••${from.slice(-4)}`,
      recipient: `••••${to.slice(-4)}`,
    };
  }

  /** @param {any} client @param {any} input @param {any} state */
  async function replay(client, input, state) {
    const row = (
      await client.query(
        `SELECT command_id,payload_envelope,message_id,actor_id,conversation_id,status
      FROM crm.n8n_commands WHERE command_id=$1`,
        [input.commandId],
      )
    ).rows[0];
    if (!row) return null;
    const { order_pdf: pdf } = decryptJson(
      row.payload_envelope,
      `n8n-command:${row.command_id}`,
      envelopeKey,
    );
    if (
      row.actor_id !== input.actor.id ||
      row.conversation_id !== state.conversation.id ||
      pdf?.id !== input.orderId ||
      pdf.version !== input.expectedVersion ||
      pdf.preparation !== input.preparation
    )
      throw refusal(409, 'IDEMPOTENCY_KEY_REUSED');
    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      status: row.status,
    };
  }

  return {
    /** @param {any} order @param {any} actor */
    async canOffer(order, actor) {
      if (
        actor?.kind !== 'human' ||
        !allowed.has(actor.id) ||
        order.status !== 'confirmado' ||
        order.cancelledAt ||
        order.origin !== 'atendimento' ||
        !order.conversationId
      )
        return false;
      const target = await sellerWhatsAppTarget(database, order.conversationId);
      return Boolean(target && personalSendAllowed(target, actor.id, allowed));
    },
    /** @param {any} input */
    preview(input) {
      return database.transaction(async (/** @type {any} */ client) => {
        const state = await current(client, input);
        return {
          preparation: state.preparation,
          sender: state.sender,
          recipient: state.recipient,
        };
      });
    },
    /** @param {any} input @param {(filename:string)=>Promise<Buffer>} render */
    async send(input, render) {
      input = {
        ...input,
        commandId: `order-pdf:${createHash('sha256')
          .update(JSON.stringify([input.actor?.id, input.idempotencyKey]))
          .digest('hex')}`,
      };
      const proposal = await database.transaction(
        async (/** @type {any} */ client) => {
          const state = await current(client, input);
          const previous = await replay(client, input, state);
          if (!previous && state.preparation !== input.preparation)
            throw refusal(409, 'VERSION_CONFLICT');
          return { state, previous };
        },
      );
      if (proposal.previous) return proposal.previous;
      const filename = `pedido-${proposal.state.order.number.replace(/[^A-Za-z0-9_-]/gu, '-')}.pdf`;
      const pdf = await render(filename);
      const rechecked = await database.transaction(
        async (/** @type {any} */ client) => {
          const state = await current(client, input);
          const previous = await replay(client, input, state);
          if (!previous && state.preparation !== input.preparation)
            throw refusal(409, 'VERSION_CONFLICT');
          return previous;
        },
      );
      if (rechecked) return rechecked;
      const mediaId = await media.storeOrderPdf({
        pdf,
        filename,
        actorId: input.actor.id,
        conversationId: proposal.state.conversation.id,
      });
      return database.transaction(async (/** @type {any} */ client) => {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [input.commandId],
        );
        const { order, conversation, preparation, to } = await current(
          client,
          input,
        );
        const previous = await replay(client, input, { conversation });
        if (previous) return previous;
        if (preparation !== input.preparation)
          throw refusal(409, 'VERSION_CONFLICT');
        const id = `message-${randomUUID()}`;
        const now = clock();
        const content = encryptJson(
          { mediaId, caption: `Ficha do pedido ${order.number}` },
          `message:${id}`,
          messageKey,
        );
        await client.query(
          `INSERT INTO crm.messages(id,conversation_id,provider,provider_account_id,command_id,direction,
          author_kind,author_id,message_type,content_envelope,status,occurred_at,created_at,automation_epoch)
          VALUES($1,$2,$3,$4,$5,'outbound','human',$6,'document',$7,'queued',$8,$8,$9)`,
          [
            id,
            conversation.id,
            conversation.provider,
            conversation.provider_account_id,
            input.commandId,
            input.actor.id,
            content,
            now,
            conversation.automation_epoch,
          ],
        );
        const draft = (
          await client.query(
            `SELECT storage_bucket_alias,reservation_bytes,size_bytes FROM crm.chat_media
          WHERE id=$1 AND conversation_id=$2 AND uploaded_by=$3 AND origin='order_pdf' AND state='ready'
            AND validation_status='clean' AND cleanup_started_at IS NULL AND message_id IS NULL FOR UPDATE`,
            [mediaId, conversation.id, input.actor.id],
          )
        ).rows[0];
        if (
          !draft ||
          Number(draft.reservation_bytes) !== Number(draft.size_bytes)
        )
          throw refusal(409, 'VERSION_CONFLICT');
        await client.query(
          `UPDATE crm.chat_media SET state='attached',attached_at=$2,message_id=$3,
          reservation_bytes=0,version=version+1 WHERE id=$1`,
          [mediaId, now, id],
        );
        await client.query(
          `UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2,used_bytes=used_bytes+$2,
          updated_at=$3,version=version+1 WHERE bucket_alias=$1`,
          [draft.storage_bucket_alias, draft.reservation_bytes, now],
        );
        await outbox.enqueueChannelMessage(
          {
            id: `job-${randomUUID()}`,
            idempotencyKey: input.commandId,
            messageId: id,
            availableAt: now,
            orderPdf: {
              id: order.id,
              version: input.expectedVersion,
              preparation,
              to,
            },
          },
          { transaction: client },
        );
        const {
          rows: [updated],
        } = await client.query(
          `UPDATE crm.conversations SET version=version+1,
          last_message_at=GREATEST(last_message_at,$2) WHERE id=$1 RETURNING version`,
          [conversation.id, now],
        );
        await client.query(
          `INSERT INTO crm.domain_events(id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,correlation_id,occurred_at)
          VALUES($1,'conversation',$2,$3,'conversation.message_queued',$4,$5,$6)`,
          [
            `event-${randomUUID()}`,
            conversation.id,
            updated.version,
            { conversationId: conversation.id },
            input.correlationId,
            now,
          ],
        );
        await audit.append(
          {
            action: 'order.ficha.whatsapp.queued',
            actor: input.actor.id,
            correlationId: input.correlationId,
            reason: 'order_ficha_whatsapp',
            target: { id: order.id, type: 'order' },
            version: input.expectedVersion,
          },
          { transaction: client },
        );
        return {
          messageId: id,
          conversationId: conversation.id,
          status: 'pending',
        };
      });
    },
  };
}
