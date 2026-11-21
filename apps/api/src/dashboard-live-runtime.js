import { contactConversationVisible } from '@crm-silmer/contacts';
import { lockDashboardReader } from './dashboard-access.js';
import {
  humanStartSql,
  UNANSWERED_NOW_CONVERSATION,
} from './dashboard-wait-sql.js';
import { DashboardError } from './dashboard-runtime.js';
import { EFFECTIVE_HUMAN_SEND } from './lead-outcome-sql.js';

const QUEUE_FILTERS = ['todas', 'sem-responsavel', 'resposta', 'atrasada'];
const PAGE_SIZE = 20;

// A fact has a persisted domain event. A generic order change or an audit
// entry alone can also describe a no-op and cannot substantiate delivery.
const FACTS_SQL = `SELECT e.stream_cursor::text AS cursor, e.occurred_at AS at,
  CASE WHEN e.event_type='order.milestones_saved' THEN 'delivery'
       WHEN e.event_type='order.confirmed' THEN 'confirmed'
       WHEN e.event_type='order.ficha_first_printed' THEN 'printed'
       ELSE 'claimed' END AS kind,
  coalesce(o.id, c.id) AS "recordId", coalesce(o.store_number, o.number) AS reference
  FROM crm.domain_events e
  LEFT JOIN crm.orders o ON e.aggregate_type='order' AND o.id=e.aggregate_id AND NOT o.is_test
  LEFT JOIN crm.handoffs h ON e.aggregate_type='handoff' AND h.id=e.aggregate_id
  LEFT JOIN crm.conversations c ON c.id=CASE WHEN e.aggregate_type='conversation'
    THEN e.aggregate_id ELSE h.conversation_id END
  WHERE ($2::bigint IS NULL OR e.stream_cursor < $2::bigint)
  AND ((o.id IS NOT NULL AND (e.event_type IN ('order.confirmed','order.ficha_first_printed')
    OR (e.event_type='order.milestones_saved' AND EXISTS (
      SELECT 1 FROM crm.audit_events a WHERE a.target_type='order' AND a.target_id=o.id
        AND a.action='order.delivery.confirm' AND a.correlation_id=e.correlation_id
        AND a.version=(e.aggregate_version-1)::text))))
    OR (c.id IS NOT NULL AND ((e.aggregate_type='conversation' AND e.event_type='conversation.taken_over')
      OR (e.aggregate_type='handoff' AND e.event_type='handoff.claimed'))
      AND ${contactConversationVisible('c', '$1', 'true')}))
  ORDER BY e.stream_cursor DESC LIMIT 21`;

// The three cards and the selected destination share this set of open waits.
// A reply closes the uninterrupted wait; subsequent customer messages never
// restart the clock. Use the same human-mode floor and policy as MET-05.
const QUEUE_SQL = `WITH visible AS MATERIALIZED (
  SELECT c.* FROM crm.conversations c
  WHERE c.terminal_at IS NULL AND c.archived_at IS NULL AND ${contactConversationVisible('c', '$1', 'true')}
), unclaimed AS (
  SELECT c.id, 'sem-responsavel' AS kind, min(h.created_at) AS since
  FROM visible c JOIN crm.handoffs h ON h.conversation_id=c.id
  WHERE h.status='pending' AND h.target_role='Vendedor' AND h.created_at <= $2
  GROUP BY c.id
), human_waits AS (
  SELECT open_conversation.id, 'resposta' AS kind, greatest(inbound.at, owned.at) AS since
  FROM visible open_conversation
  -- Personal lines receive their active owner when the inbound cycle opens.
  -- They can be waiting before any takeover, handoff or first human send.
  CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS (
    SELECT 1 FROM crm.seller_whatsapp_lines line
    WHERE line.account_id::text=open_conversation.provider_account_id AND line.seller_id=open_conversation.assigned_user_id
  ) THEN open_conversation.opened_at ELSE ${humanStartSql('open_conversation.id', '$2')} END AS at) owned
  CROSS JOIN LATERAL (SELECT max(coalesce(r.sent_at,r.occurred_at)) AS at FROM crm.messages r
    WHERE r.conversation_id=open_conversation.id AND ${EFFECTIVE_HUMAN_SEND('r')}
    AND coalesce(r.sent_at,r.occurred_at) <= $2) reply
  CROSS JOIN LATERAL (SELECT min(i.occurred_at) AS at FROM crm.messages i WHERE i.conversation_id=open_conversation.id
    AND i.direction='inbound' AND i.author_kind='contact' AND i.occurred_at <= $2
    AND i.occurred_at > coalesce(reply.at,'-infinity'::timestamptz)) inbound
  WHERE ${UNANSWERED_NOW_CONVERSATION} AND owned.at IS NOT NULL AND inbound.at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM unclaimed u WHERE u.id=open_conversation.id)
), waits AS MATERIALIZED (
  SELECT q.*, crm.business_minutes_v1(q.since,$2::timestamptz) AS minutes
  FROM (SELECT * FROM unclaimed UNION ALL SELECT * FROM human_waits) q
), filtered AS (
  SELECT * FROM waits WHERE $3='todas' OR kind=$3 OR ($3='atrasada' AND kind='resposta' AND minutes>15)
)
SELECT (SELECT count(*)::integer FROM waits WHERE kind='sem-responsavel') AS unclaimed,
  (SELECT count(*)::integer FROM waits WHERE kind='resposta') AS waiting,
  (SELECT count(*)::integer FROM waits WHERE kind='resposta' AND minutes>15) AS late,
  (SELECT count(*)::integer FROM visible WHERE automation_state='assistant') AS "withAgent",
  (SELECT jsonb_build_object('todas',max(minutes), 'atrasada',max(minutes) FILTER (WHERE kind='resposta' AND minutes>15),
    'sem-responsavel',max(minutes) FILTER (WHERE kind='sem-responsavel'), 'resposta',max(minutes) FILTER (WHERE kind='resposta'))
    FROM waits) AS "oldestMinutesByFilter",
  (SELECT max(minutes)::float8 FROM filtered) AS "oldestMinutes",
  (SELECT count(*)::integer FROM filtered) AS total,
  coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.since,x.id) FROM (
    SELECT id,kind,since,minutes::float8 FROM filtered ORDER BY since,id LIMIT 20 OFFSET $4
  ) x),'[]'::jsonb) AS rows`;

/** @param {any} database @param {any} actor @param {Record<string,unknown>} query @param {Date} now */
export async function readDashboardLive(database, actor, query, now) {
  return database.transaction(async (/** @type {any} */ client) => {
    const reader = await lockDashboardReader(client, actor);
    if (reader.scope !== 'team') throw new DashboardError(403, 'FORBIDDEN');
    const generatedAt = now.toISOString();
    if (query.region === 'facts') {
      if (
        Object.keys(query).some((key) => !['region', 'before'].includes(key)) ||
        (query.before !== undefined &&
          (typeof query.before !== 'string' ||
            !/^[1-9]\d{0,17}$/u.test(query.before)))
      )
        throw new DashboardError(400, 'INVALID_FILTER');
      const { rows } = await client.query(FACTS_SQL, [
        reader.id,
        query.before ?? null,
      ]);
      const facts = rows.slice(0, PAGE_SIZE);
      return {
        generatedAt,
        facts,
        nextCursor: rows.length > PAGE_SIZE ? facts.at(-1).cursor : null,
      };
    }
    const filter = query.filter ?? 'todas';
    const page = Number(query.page ?? 1);
    if (
      query.region !== 'queue' ||
      typeof filter !== 'string' ||
      !QUEUE_FILTERS.includes(filter) ||
      Object.keys(query).some(
        (key) => !['region', 'filter', 'page'].includes(key),
      ) ||
      (query.page !== undefined &&
        (typeof query.page !== 'string' || !/^[1-9]\d{0,5}$/u.test(query.page)))
    )
      throw new DashboardError(400, 'INVALID_FILTER');
    const { rows } = await client.query(QUEUE_SQL, [
      reader.id,
      generatedAt,
      filter,
      (page - 1) * PAGE_SIZE,
    ]);
    return { generatedAt, filter, page, pageSize: PAGE_SIZE, ...rows[0] };
  });
}
