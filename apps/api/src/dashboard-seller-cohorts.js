import { contactConversationVisible } from '@crm-silmer/contacts';
import { orderReadable } from '@crm-silmer/orders';
import { EFFECTIVE_HUMAN_SEND } from './lead-outcome-sql.js';

/** RFC 073. A conversation row is one cycle. Anchor it once, at its first
 * human assignment. Reassignments and multiple orders never multiply a cycle.
 * @param {any} client @param {{from:string,to:string,now:Date,actorId:string,manager:boolean,seller?:string}} input */
export async function readSellerCohorts(client, input) {
  const { rows } = await client.query(
    `WITH bounds AS (
    SELECT ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AS since,
      least($5::timestamptz,(($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) AS cutoff
  ), cycles AS MATERIALIZED (
    SELECT c.id, c.terminal_at, first_owner.owner_id, first_owner.claimed_at,
      (first_owner.claimed_at AT TIME ZONE 'America/Sao_Paulo')::date AS start_day
    FROM bounds b JOIN crm.conversations c ON c.opened_at <= b.cutoff
      AND (c.terminal_at IS NULL OR c.terminal_at >= b.since - interval '31 days')
    CROSS JOIN LATERAL (
      SELECT owner_id, claimed_at FROM (
        SELECT hist.assigned_user_id AS owner_id, hist.occurred_at AS claimed_at, 1 AS priority
        FROM crm.handoffs h JOIN crm.handoff_history hist ON hist.handoff_id=h.id
        WHERE h.conversation_id=c.id AND h.target_role='Vendedor'
          AND hist.from_status='pending' AND hist.to_status='accepted'
        UNION ALL
        SELECT e.actor_id, e.occurred_at, 2 FROM crm.audit_events e
        WHERE e.target_id=c.id AND e.target_type='conversation' AND e.action='conversation.takeover'
        UNION ALL
        -- Personal inbound records carry the binding used at receipt, independently
        -- of the current assignment. Administrative-pending receipts are not a claim.
        SELECT line.seller_id,m.occurred_at,0 FROM crm.messages m
        JOIN crm.personal_whatsapp_inbound receipt ON receipt.message_id=m.id
        JOIN crm.seller_whatsapp_bindings binding ON binding.id=receipt.binding_id
          AND binding.generation=receipt.generation
        JOIN crm.seller_whatsapp_lines line ON line.id=binding.line_id
        WHERE m.conversation_id=c.id AND NOT receipt.administrative_pending
      ) ownership WHERE owner_id IS NOT NULL AND claimed_at<=b.cutoff
      ORDER BY claimed_at,priority,owner_id LIMIT 1
    ) first_owner
    WHERE ($6::text IS NULL OR first_owner.owner_id=$6) AND ($4::boolean OR first_owner.owner_id=$3) AND ${contactConversationVisible('c', '$3', '$4::boolean')}
  ), conversion AS (
    SELECT c.id,c.owner_id,c.start_day,(c.start_day+30) AS expires,
      coalesce(eligible.orders,'[]'::jsonb) AS orders
    FROM cycles c
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id',o.id,'number',o.number) ORDER BY o.confirmed_at,o.id) AS orders
      FROM crm.orders o WHERE o.id IN (
        SELECT direct_order.id FROM crm.orders direct_order WHERE direct_order.conversation_id=c.id
        UNION SELECT s.order_id FROM crm.conversation_subjects s WHERE s.conversation_id=c.id AND s.order_id IS NOT NULL)
        AND o.status='confirmado' AND NOT o.is_test AND o.cancelled_at IS NULL
        AND o.origin='atendimento' AND o.sales_owner_id=c.owner_id AND ${orderReadable('o', '$3')}
        AND o.confirmed_at>=c.claimed_at AND o.confirmed_at < ((c.start_day+30)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND o.confirmed_at <= $5::timestamptz
    ) eligible ON true
    WHERE c.start_day+30 >= $1::date
  ), waits AS (
    SELECT c.*, CASE WHEN messages.last_customer IS NOT NULL
       AND (messages.last_reply IS NULL OR messages.last_reply<messages.last_customer)
       THEN c.claimed_at ELSE messages.next_customer END AS wait_at
    FROM cycles c CROSS JOIN bounds b CROSS JOIN LATERAL (
      SELECT
        (SELECT max(m.occurred_at) FROM crm.messages m WHERE m.conversation_id=c.id
          AND m.direction='inbound' AND m.author_kind='contact' AND m.occurred_at<=c.claimed_at) AS last_customer,
        (SELECT max(coalesce(m.sent_at,m.occurred_at)) FROM crm.messages m WHERE m.conversation_id=c.id
          AND ${EFFECTIVE_HUMAN_SEND('m')} AND coalesce(m.sent_at,m.occurred_at)<=c.claimed_at) AS last_reply,
        (SELECT min(m.occurred_at) FROM crm.messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
          AND m.author_kind='contact' AND m.occurred_at>c.claimed_at AND m.occurred_at<=b.cutoff) AS next_customer
    ) messages
  ), service AS (
    SELECT w.*,deadline.at AS deadline_at, reply.at AS reply_at,
      CASE WHEN reply.at IS NOT NULL THEN crm.business_minutes_v1(w.wait_at,reply.at) END AS reply_minutes
    FROM waits w CROSS JOIN bounds b CROSS JOIN LATERAL (
      SELECT crm.business_deadline_v1(w.wait_at,15) AS at
    ) deadline LEFT JOIN LATERAL (
      SELECT min(coalesce(m.sent_at,m.occurred_at)) AS at FROM crm.messages m
      WHERE m.conversation_id=w.id AND ${EFFECTIVE_HUMAN_SEND('m')}
        AND coalesce(m.sent_at,m.occurred_at) BETWEEN w.wait_at AND b.cutoff
    ) reply ON true
    WHERE w.wait_at IS NOT NULL AND deadline.at BETWEEN b.since AND b.cutoff
  ), population AS (
    SELECT owner_id FROM conversion UNION SELECT owner_id FROM service
  )
  SELECT u.id AS "userId", u.name, u.disabled_at IS NULL AS active,
    (SELECT count(*)::int FROM conversion c WHERE c.owner_id=u.id AND c.expires>$2::date) AS observing,
    (SELECT count(*)::int FROM conversion c WHERE c.owner_id=u.id AND c.expires<=$2::date) AS completed,
    (SELECT count(*)::int FROM conversion c WHERE c.owner_id=u.id AND c.expires<=$2::date AND jsonb_array_length(c.orders)>0) AS converted,
    (SELECT count(*)::int FROM service s WHERE s.owner_id=u.id) AS eligible,
    (SELECT count(*)::int FROM service s WHERE s.owner_id=u.id AND s.reply_minutes<=15) AS "onTime",
    (SELECT count(*)::int FROM service s WHERE s.owner_id=u.id AND s.reply_at IS NULL AND (s.terminal_at IS NULL OR s.terminal_at>$5::timestamptz)) AS "openLate",
    coalesce((SELECT jsonb_agg(jsonb_build_object('cycleId',c.id,'from',c.start_day,'to',c.expires-1,'orders',c.orders)
      ORDER BY c.expires DESC,c.id) FROM conversion c WHERE $6 IS NOT NULL AND c.owner_id=u.id AND c.expires<=$2::date),'[]') AS conversion,
    coalesce((SELECT jsonb_agg(jsonb_build_object('cycleId',s.id,'deadline',s.deadline_at,
      'replyMinutes',s.reply_minutes,'onTime',coalesce(s.reply_minutes<=15,false),'open',s.reply_at IS NULL AND
        (s.terminal_at IS NULL OR s.terminal_at>$5::timestamptz))
      ORDER BY s.deadline_at DESC,s.id) FROM service s WHERE $6 IS NOT NULL AND s.owner_id=u.id),'[]') AS service
  FROM population p JOIN crm.users u ON u.id=p.owner_id ORDER BY u.id`,
    [
      input.from,
      input.to,
      input.actorId,
      input.manager,
      input.now.toISOString(),
      input.seller ?? null,
    ],
  );
  return rows;
}
