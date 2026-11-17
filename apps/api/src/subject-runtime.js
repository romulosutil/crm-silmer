import { createSubjectService } from '@crm-silmer/inbox-channels';

/** @param {any} database @param {any} operations */
export function createSubjectApiRuntime(database, operations) {
  const service = createSubjectService(database);
  return Object.freeze({
    authorizeRead: operations.authorizeRead,
    authorizeWrite: operations.authorizeWrite,
    /** WAP-E04: the shared service locks user/line/Contact before conversation.
     * @param {string} conversationId @param {string} orderQuery @param {any} actor */
    async list(conversationId, orderQuery, actor) {
      return service.list(conversationId, orderQuery, actor);
    },
    create: service.create,
    select: service.select,
    tagMessage: service.tagMessage,
  });
}
