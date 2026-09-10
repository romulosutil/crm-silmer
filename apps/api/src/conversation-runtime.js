import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  createInboxService,
  PostgresInboxRepository,
} from '@crm-silmer/inbox-channels';

/** @param {any} database @param {Record<string, any>} deals @param {Record<string, any>} n8n @param {Buffer} messageEnvelopeKey */
export function createConversationApiRuntime(
  database,
  deals,
  n8n,
  messageEnvelopeKey,
) {
  const service = createInboxService({
    auditPort: new PostgresAuditTrail(database),
    repository: new PostgresInboxRepository({
      database,
      envelopeKey: messageEnvelopeKey,
      outboundMessageOutbox: n8n.commandOutbox,
    }),
  });
  return Object.freeze({
    authorize: deals.authorize,
    claimHandoff: deals.claimHandoff,
    close: service.transitionConversation,
    returnToAi: service.reactivateAgent,
    sendMessage: service.sendHumanMessage,
    takeover: service.takeover,
    transfer: service.transferConversation,
  });
}
