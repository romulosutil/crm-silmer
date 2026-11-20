import {
  contactConversationVisible,
  requireSellerClientActor,
} from '@crm-silmer/contacts';
import {
  InboxConflictError,
  InboxError,
  InboxForbiddenError,
} from '../domain/errors.js';

/** WAP-E04: locks precede conversation/subject/command locks. Link revocation
 * takes the same Contact lock, so replay cannot hydrate a revoked projection.
 * Connection state is deliberately absent: disconnected history stays private.
 * @param {any} transaction @param {string} conversationId @param {string} actorId
 * @param {{allowGeneralReminder?:boolean}} [options]
 */
export async function lockConversationAccess(
  transaction,
  conversationId,
  actorId,
  { allowGeneralReminder = false } = {},
) {
  const actor = await requireSellerClientActor(transaction, actorId);
  const source = (
    await transaction.query(
      `SELECT conversation.provider_account_id, identity.current_contact_id
       FROM crm.conversations conversation
       JOIN crm.contact_identities identity ON identity.id=conversation.contact_identity_id
       WHERE conversation.id=$1`,
      [conversationId],
    )
  ).rows[0];
  if (!source)
    throw new InboxError(
      'Conversation was not found',
      'CONVERSATION_NOT_FOUND',
      404,
    );
  const line = (
    await transaction.query(
      'SELECT seller_id FROM crm.seller_whatsapp_lines WHERE account_id::text=$1 FOR SHARE',
      [source.provider_account_id],
    )
  ).rows[0];
  await transaction.query(
    'SELECT id FROM crm.contacts WHERE id=$1 FOR UPDATE',
    [source.current_contact_id],
  );
  const anchored = (
    await transaction.query(
      `SELECT identity.current_contact_id FROM crm.contact_identities identity
     JOIN crm.conversations conversation ON conversation.contact_identity_id=identity.id
     WHERE conversation.id=$1`,
      [conversationId],
    )
  ).rows[0];
  if (anchored?.current_contact_id !== source.current_contact_id)
    throw new InboxConflictError('Conversation identity changed');
  const allowed = await transaction.query(
    `SELECT conversation.id FROM crm.conversations conversation WHERE conversation.id=$1
       AND ${contactConversationVisible('conversation', '$2', '$3::boolean')}`,
    [conversationId, actor.id, actor.isAdmin || allowGeneralReminder],
  );
  if (!allowed.rows[0]) throw new InboxForbiddenError();
  return { actor, personalSellerId: line?.seller_id ?? null };
}
