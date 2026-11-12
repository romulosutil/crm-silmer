import { canReadConversation } from '@crm-silmer/identity-access';
import { createSubjectService } from '@crm-silmer/inbox-channels';

/** @param {any} database @param {any} operations */
export function createSubjectApiRuntime(database, operations) {
  const service = createSubjectService(database);
  return Object.freeze({
    authorizeRead: operations.authorizeRead,
    authorizeWrite: operations.authorizeWrite,
    /** CONV-ACL-01: hold ownership stable while reading subject evidence.
     * @param {string} conversationId @param {string} orderQuery @param {any} actor */
    async list(conversationId, orderQuery, actor) {
      return database.transaction(async (/** @type {any} */ transaction) => {
        const row = (
          await transaction.query(
            'SELECT assigned_user_id FROM crm.conversations WHERE id=$1 FOR SHARE',
            [conversationId],
          )
        ).rows[0];
        if (!row)
          throw Object.assign(new Error('CONVERSATION_NOT_FOUND'), {
            statusCode: 404,
            code: 'CONVERSATION_NOT_FOUND',
          });
        if (!canReadConversation(actor, row.assigned_user_id))
          throw Object.assign(new Error('FORBIDDEN'), {
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        return createSubjectService({
          query: transaction.query.bind(transaction),
          transaction: async (/** @type {any} */ work) => work(transaction),
        }).list(conversationId, orderQuery);
      });
    },
    create: service.create,
    select: service.select,
    tagMessage: service.tagMessage,
  });
}
