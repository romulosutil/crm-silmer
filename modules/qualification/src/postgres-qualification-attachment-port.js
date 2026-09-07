export class PostgresQualificationAttachmentPort {
  /** @param {{contactId: string, files: any[]}} input @param {{transaction: any}} context */
  async assertUsable(input, context) {
    const database = context?.transaction;
    if (!database || typeof database.query !== 'function') {
      throw new TypeError('context.transaction must implement query');
    }
    for (const file of input.files) {
      const result = await database.query(
        `SELECT 1
         FROM crm.attachments AS attachment
         JOIN crm.messages AS message ON message.id = attachment.message_id
         JOIN crm.conversations AS conversation ON conversation.id = message.conversation_id
         JOIN crm.contact_identities AS identity
           ON identity.id = conversation.contact_identity_id
         JOIN crm.transient_media AS media
           ON media.id = attachment.transient_media_id
         WHERE attachment.message_id = $1
           AND attachment.transient_media_id = $2
           AND identity.current_contact_id = $3
           AND message.status IN ('received', 'sent')
           AND media.availability_status = 'available'
           AND media.validation_status = 'clean'
           AND media.deleted_at IS NULL
         FOR SHARE OF attachment, message, conversation, identity, media`,
        [
          file.attachmentId.messageId,
          file.attachmentId.transientMediaId,
          input.contactId,
        ],
      );
      if (result.rows.length !== 1) throw invalidAttachment();
    }
  }
}

function invalidAttachment() {
  return Object.assign(new Error('Attachment is not available'), {
    code: 'DEAL_INVALID',
    statusCode: 422,
  });
}
