import { activeLeadLossSql } from './lead-outcome-sql.js';

/** "Sem resposta agora" is a snapshot of open conversations with an owner
 * and no active declared loss (MET-08). Only this snapshot reads the current
 * automation state; episodes follow the conversation's human history. */
export const UNANSWERED_NOW_CONVERSATION = `open_conversation.automation_state = 'human'
  AND open_conversation.terminal_at IS NULL AND open_conversation.archived_at IS NULL
  AND open_conversation.assigned_user_id IS NOT NULL
  AND NOT ${activeLeadLossSql('open_conversation.id')}`;

/** Ownership events of a conversation: claim/transfer of a handoff, takeover,
 * panel transfer and any human send (sending assigns the conversation to its
 * author). Limitation: a panel transfer stores its target only in the
 * free-text audit reason ("... (repasse para <id>)"), parsed here; if that
 * format changes or the id is unknown, the episode falls back to the current
 * owner. Each branch is one indexed probe bounded by `until`.
 * @param {string} conversation trusted SQL column @param {string} until trusted SQL expression
 * @param {'ASC'|'DESC'} order
 */
export const ownershipProbes = (conversation, until, order) => `
  (SELECT history.assigned_user_id AS user_id, history.occurred_at
   FROM crm.handoffs h JOIN crm.handoff_history history ON history.handoff_id = h.id
   WHERE h.conversation_id = ${conversation} AND history.to_status = 'accepted'
     AND history.assigned_user_id IS NOT NULL AND history.occurred_at <= ${until}
   ORDER BY history.occurred_at ${order} LIMIT 1)
  UNION ALL
  (SELECT CASE WHEN event.action = 'conversation.takeover' THEN event.actor_id
            ELSE substring(event.reason FROM '[(]repasse para ([^()]+)[)]$') END,
          event.occurred_at
   FROM crm.audit_events event
   WHERE event.target_type = 'conversation' AND event.target_id = ${conversation}
     AND event.action IN ('conversation.takeover','conversation.transferred')
     AND event.occurred_at <= ${until}
   ORDER BY event.occurred_at ${order} LIMIT 1)
  UNION ALL
  (SELECT m.author_id, m.occurred_at FROM crm.messages m
   WHERE m.conversation_id = ${conversation} AND m.direction = 'outbound'
     AND m.author_kind = 'human' AND m.occurred_at <= ${until}
   ORDER BY m.occurred_at ${order} LIMIT 1)`;

/** First instant of human mode (the earliest ownership event).
 * @param {string} conversation @param {string} until */
export const humanStartSql = (conversation, until) =>
  `(SELECT min(owned.occurred_at) FROM (${ownershipProbes(conversation, until, 'ASC')}) owned)`;
