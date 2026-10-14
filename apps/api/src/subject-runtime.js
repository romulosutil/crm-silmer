import { createSubjectService } from '@crm-silmer/inbox-channels';

/** @param {any} database @param {any} operations */
export function createSubjectApiRuntime(database, operations) {
  const service = createSubjectService(database);
  return Object.freeze({
    authorizeRead: operations.authorizeRead,
    authorizeWrite: operations.authorizeWrite,
    list: service.list,
    create: service.create,
    select: service.select,
    tagMessage: service.tagMessage,
  });
}
