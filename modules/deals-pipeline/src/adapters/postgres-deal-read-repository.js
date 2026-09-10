import { DealReadError } from '../deal-read-service.js';
import {
  compareFieldPaths,
  isAssessmentApplicable,
  resolveFieldDefinition,
} from '@crm-silmer/qualification';

/**
 * SQL predicates that select which slice of crm.domain_events a live topic
 * publishes. Keep them narrow: a subscriber sees every event a predicate
 * matches, so a broad predicate leaks unrelated aggregates onto the stream.
 */
/** @type {Readonly<Record<string, string>>} */
const EVENT_TOPIC_SELECTORS = Object.freeze({
  inbox: `aggregate_type IN ('conversation', 'contact')`,
  kanban: `aggregate_type = 'deal'
    OR (aggregate_type = 'task' AND event_type IN ('task.started','task.completed','task.cancelled') AND payload ? 'dealId')
    OR (aggregate_type = 'handoff' AND event_type IN ('handoff.accepted','handoff.transferred','handoff.resolved') AND payload ? 'dealId')`,
});

export class PostgresDealReadRepository {
  /** @param {{query: Function, transaction?: Function}} database */
  constructor(database) {
    if (!database || typeof database.query !== 'function')
      throw new TypeError('database.query is required');
    this.database = database;
  }

  /** @param {any} input */
  async getBoard(input) {
    return this.#snapshot((database) => readBoard(database, input));
  }

  /** @param {string} dealId */
  async getVersion(dealId) {
    return this.#snapshot((database) =>
      readRepresentationVersion(database, dealId),
    );
  }

  /** @param {string} dealId */
  async getDetail(dealId) {
    return this.#snapshot((database) => readDetail(database, dealId));
  }

  /** @param {{after: number, limit: number, topic: string}} input */
  async readEvents(input) {
    const selector = EVENT_TOPIC_SELECTORS[input.topic];
    if (!selector) throw new DealReadError(400, 'INVALID_EVENT_TOPIC');
    const [events, bounds] = await Promise.all([
      this.database.query(
        `SELECT stream_cursor, aggregate_type, aggregate_id, aggregate_version,
                event_type, payload, occurred_at
         FROM crm.domain_events
         WHERE stream_cursor > $1 AND (${selector})
         ORDER BY stream_cursor LIMIT $2`,
        [input.after, input.limit + 1],
      ),
      this.database.query(
        'SELECT COALESCE(min(stream_cursor),0) minimum, COALESCE(max(stream_cursor),0) latest FROM crm.domain_events',
      ),
    ]);
    return {
      hasMore: events.rows.length > input.limit,
      latestCursor: Number(bounds.rows[0].latest),
      minimumCursor: Number(bounds.rows[0].minimum),
      rows: events.rows.slice(0, input.limit).map((/** @type {any} */ row) => ({
        aggregateType: row.aggregate_type,
        aggregateVersion: Number(row.aggregate_version),
        contactId:
          row.aggregate_type === 'contact'
            ? row.aggregate_id
            : (row.payload.contactId ?? null),
        conversationId:
          row.aggregate_type === 'conversation'
            ? row.aggregate_id
            : (row.payload.conversationId ?? null),
        cursor: Number(row.stream_cursor),
        dealId:
          row.aggregate_type === 'deal'
            ? row.aggregate_id
            : (row.payload.dealId ?? null),
        occurredAt: iso(row.occurred_at),
        type: row.event_type,
      })),
    };
  }

  /** @template T @param {(database: any) => Promise<T>} work */
  async #snapshot(work) {
    if (typeof this.database.transaction !== 'function')
      return work(this.database);
    return this.database.transaction(async (/** @type {any} */ client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      return work(client);
    });
  }
}

/** @param {{query: Function}} database @param {any} input */
async function readBoard(database, input) {
  const filterValues = [input.stage];
  const filterPredicates = ['deal.stage = $1', "deal.status = 'active'"];
  if (input.assignedUserId !== undefined) {
    filterValues.push(input.assignedUserId);
    filterPredicates.push(`deal.assigned_user_id = $${filterValues.length}`);
  }
  if (input.hasOverdueTask !== undefined) {
    filterValues.push(input.hasOverdueTask);
    filterPredicates.push(
      `COALESCE(next_task.due_at < now(), false) = $${filterValues.length}`,
    );
  }
  const pageValues = [...filterValues];
  const pagePredicates = [...filterPredicates];
  if (input.cursor) {
    pageValues.push(input.cursor.updatedAt, input.cursor.id);
    pagePredicates.push(
      `(deal.updated_at, deal.id) < ($${pageValues.length - 1}, $${pageValues.length})`,
    );
  }
  pageValues.push(input.limit + 1);
  const joins = `
      LEFT JOIN crm.user_functions user_function ON user_function.user_id = deal.assigned_user_id
      LEFT JOIN LATERAL (
        SELECT task.id, task.task_type, task.status, task.due_at, task.version
        FROM crm.tasks task WHERE task.deal_id = deal.id
          AND task.status IN ('pending', 'in_progress')
        ORDER BY task.due_at, task.id LIMIT 1
      ) next_task ON true`;
  const cards = await database.query(
    `SELECT deal.id, deal.stage, deal.status, deal.version, deal.updated_at,
                deal.assigned_user_id, user_function.function_name,
                next_task.id task_id, next_task.task_type, next_task.status task_status,
                next_task.due_at task_due_at, next_task.version task_version,
                (SELECT history.occurred_at FROM crm.deal_stage_history history
                 WHERE history.deal_id=deal.id AND history.to_stage=deal.stage
                 ORDER BY history.resulting_version DESC LIMIT 1) stage_entered_at,
                (SELECT COALESCE(sum(item.estimated_quantity), 0)::integer
                 FROM crm.deal_items item WHERE item.deal_id=deal.id) total_quantity,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('field', assessment.field_key, 'status', assessment.status)), '[]') FROM (
                   SELECT DISTINCT ON (field_key) field_key, status
                   FROM crm.field_assessments WHERE deal_id=deal.id
                   ORDER BY field_key, id DESC
                 ) assessment WHERE assessment.status IN ('pendente','divergente')
                ) pending_fields,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', item.id, 'position', item.position) ORDER BY item.position), '[]')
                 FROM crm.deal_items item WHERE item.deal_id=deal.id) item_positions,
                (SELECT artwork.status FROM crm.artwork artwork WHERE artwork.deal_id=deal.id) artwork_status,
                (SELECT logistics.mode FROM crm.logistics logistics WHERE logistics.deal_id=deal.id) logistics_mode
         FROM crm.deals deal ${joins}
         WHERE ${pagePredicates.join(' AND ')}
         ORDER BY deal.updated_at DESC, deal.id DESC LIMIT $${pageValues.length}`,
    pageValues,
  );
  const count = await database.query(
    `SELECT count(*)::integer count FROM crm.deals deal ${joins}
         WHERE ${filterPredicates.join(' AND ')}`,
    filterValues,
  );
  const hasMore = cards.rows.length > input.limit;
  return {
    count: count.rows[0].count,
    hasMore,
    rows: cards.rows.slice(0, input.limit).map(mapCard),
  };
}

/** @param {{query: Function}} database @param {string} dealId */
async function readRepresentationVersion(database, dealId) {
  const result = await database.query(
    `SELECT concat(
       deal.version, ':',
       md5(COALESCE((SELECT string_agg(concat(task.id, ':', task.version, ':', task.updated_at), ',' ORDER BY task.id) FROM crm.tasks task WHERE task.deal_id=deal.id), '')), ':',
       md5(COALESCE((SELECT string_agg(concat(handoff.id, ':', handoff.version, ':', handoff.updated_at), ',' ORDER BY handoff.id) FROM crm.handoffs handoff WHERE handoff.deal_id=deal.id), ''))
     ) representation_version
     FROM crm.deals deal WHERE deal.id=$1`,
    [dealId],
  );
  return result.rows[0]?.representation_version ?? null;
}

/** @param {{query: Function}} database @param {string} dealId */
async function readDetail(database, dealId) {
  const [
    deal,
    qualification,
    items,
    artwork,
    logistics,
    tasks,
    gates,
    history,
    handoffs,
    assessments,
    representationVersion,
  ] = await runSequential([
    () =>
      database.query(
        `SELECT deal.*, user_function.function_name FROM crm.deals deal
         LEFT JOIN crm.user_functions user_function ON user_function.user_id=deal.assigned_user_id
         WHERE deal.id=$1`,
        [dealId],
      ),
    () =>
      database.query('SELECT * FROM crm.deal_qualification WHERE deal_id=$1', [
        dealId,
      ]),
    () =>
      database.query(
        `SELECT item.*,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('code', fabric.material_code, 'snapshot', fabric.material_snapshot) ORDER BY fabric.position) FROM crm.item_fabrics fabric WHERE fabric.item_id=item.id), '[]') fabrics,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('sizeLookup', line.size_lookup, 'quantity', line.quantity) ORDER BY line.position) FROM crm.grade_lines line WHERE line.item_id=item.id), '[]') grade
         FROM crm.deal_items item WHERE item.deal_id=$1 ORDER BY item.position`,
        [dealId],
      ),
    () =>
      database.query(
        `SELECT artwork.*,
           (SELECT count(*)::integer FROM crm.artwork_locations location WHERE location.deal_id=artwork.deal_id) locations_count,
           (SELECT count(*)::integer FROM crm.artwork_files file WHERE file.deal_id=artwork.deal_id) files_count,
           (SELECT count(*)::integer FROM crm.artwork_colors color WHERE color.deal_id=artwork.deal_id) colors_count
         FROM crm.artwork artwork WHERE deal_id=$1`,
        [dealId],
      ),
    () =>
      database.query('SELECT * FROM crm.logistics WHERE deal_id=$1', [dealId]),
    () =>
      database.query(
        `SELECT id, task_type, status, assigned_user_id, due_at, version
         FROM crm.tasks WHERE deal_id=$1 AND status IN ('pending','in_progress')
         ORDER BY due_at, id`,
        [dealId],
      ),
    () =>
      database.query(
        `SELECT source_version, from_stage, blockers, evaluated_at FROM crm.deal_gates
         WHERE deal_id=$1 ORDER BY source_version`,
        [dealId],
      ),
    () =>
      database.query(
        `SELECT resulting_version, event_kind, from_stage, to_stage, actor_id, occurred_at
         FROM crm.deal_stage_history WHERE deal_id=$1 ORDER BY resulting_version`,
        [dealId],
      ),
    () =>
      database.query(
        `SELECT handoff.id, handoff.conversation_id, handoff.assigned_user_id,
                handoff.status, handoff.version, handoff.reason_code, handoff.due_at,
                handoff.sla_minutes, handoff.sla_policy_version, handoff.created_at,
                handoff.updated_at, handoff.resolved_at,
                conversation.version conversation_version,
                task.id task_id, task.version task_version
         FROM crm.handoffs handoff
         JOIN crm.conversations conversation ON conversation.id=handoff.conversation_id
         JOIN crm.tasks task ON task.handoff_id=handoff.id
         WHERE handoff.deal_id=$1 ORDER BY handoff.created_at, handoff.id`,
        [dealId],
      ),
    () =>
      database.query(
        `SELECT DISTINCT ON (field_key) field_key, status, source,
                resulting_version, occurred_at
         FROM crm.field_assessments WHERE deal_id=$1
         ORDER BY field_key, id DESC`,
        [dealId],
      ),
    () => readRepresentationVersion(database, dealId),
  ]);
  const row = deal.rows[0];
  if (!row) return null;
  const order = qualification.rows[0];
  const itemViews = items.rows.map((/** @type {any} */ item) => ({
    catalogVersionId: item.catalog_version_id,
    catalogVersionNumber: nullableNumber(item.catalog_version_number),
    estimatedQuantity: nullableNumber(item.estimated_quantity),
    fabrics: item.fabrics,
    grade: item.grade,
    id: item.id,
    modelCode: item.model_code,
    modelSnapshot: item.model_snapshot,
    position: item.position,
    productCode: item.product_code,
    productSnapshot: item.product_snapshot,
  }));
  return {
    deal: mapDeal(row),
    gates: gates.rows.map((/** @type {any} */ value) => ({
      blockers: value.blockers,
      evaluatedAt: iso(value.evaluated_at),
      fromStage: value.from_stage,
      sourceVersion: Number(value.source_version),
    })),
    handoffs: handoffs.rows.map((/** @type {any} */ value) =>
      mapHandoff(value, Number(row.version)),
    ),
    history: history.rows.map((/** @type {any} */ value) => ({
      actorId: value.actor_id,
      eventKind: value.event_kind,
      fromStage: value.from_stage,
      occurredAt: iso(value.occurred_at),
      resultingVersion: Number(value.resulting_version),
      toStage: value.to_stage,
    })),
    nextTask: tasks.rows[0] ? mapTask(tasks.rows[0]) : null,
    qualification: {
      assessments: effectiveAssessments(
        assessments.rows.map((/** @type {any} */ value) => ({
          field: value.field_key,
          occurredAt: iso(value.occurred_at),
          resultingVersion: Number(value.resulting_version),
          source: value.source,
          status: value.status,
        })),
        {
          artwork: artwork.rows[0] ? { status: artwork.rows[0].status } : null,
          items: itemViews,
          logistics: logistics.rows[0]
            ? { mode: logistics.rows[0].mode }
            : null,
        },
      ),
      artwork: artwork.rows[0]
        ? {
            catalogVersionId: artwork.rows[0].catalog_version_id,
            catalogVersionNumber: nullableNumber(
              artwork.rows[0].catalog_version_number,
            ),
            colorsCount: Number(artwork.rows[0].colors_count),
            filesCount: Number(artwork.rows[0].files_count),
            locationsCount: Number(artwork.rows[0].locations_count),
            responsibilityPresent: Boolean(
              artwork.rows[0].responsibility_envelope,
            ),
            status: artwork.rows[0].status,
            techniqueCode: artwork.rows[0].technique_code,
            techniqueSnapshot: artwork.rows[0].technique_snapshot,
          }
        : null,
      items: itemViews,
      logistics: logistics.rows[0]
        ? {
            addressPresent: Boolean(logistics.rows[0].address_envelope),
            cityPresent: Boolean(logistics.rows[0].city_envelope),
            desiredDate: dateOnly(logistics.rows[0].desired_date),
            mode: logistics.rows[0].mode,
            pickupLocationPresent: Boolean(
              logistics.rows[0].pickup_location_envelope,
            ),
            purchaseProfilePresent: Boolean(
              logistics.rows[0].purchase_profile_envelope,
            ),
            purposePresent: Boolean(logistics.rows[0].purpose_envelope),
          }
        : null,
      order: order
        ? {
            commercialIntent: order.commercial_intent,
            customerPresent: Boolean(order.customer_envelope),
            namePresent: Boolean(order.order_name_envelope),
          }
        : null,
      totalQuantity: itemViews.reduce(
        (/** @type {number} */ total, /** @type {any} */ item) =>
          total + (item.estimatedQuantity ?? 0),
        0,
      ),
    },
    representationVersion,
    tasks: tasks.rows.map(mapTask),
  };
}

/** @param {any} row */
function mapCard(row) {
  const state = {
    artwork: row.artwork_status ? { status: row.artwork_status } : null,
    items: row.item_positions ?? [],
    logistics: row.logistics_mode ? { mode: row.logistics_mode } : null,
  };
  const pending = effectiveAssessments(
    (row.pending_fields ?? []).map((/** @type {any} */ value) => ({
      field: value.field,
      status: value.status,
    })),
    state,
  );
  return {
    assignedUser: row.assigned_user_id
      ? { functionName: row.function_name, id: row.assigned_user_id }
      : null,
    id: row.id,
    nextPendingField: pending[0]?.field ?? null,
    nextTask: row.task_id ? mapTask(row) : null,
    stage: row.stage,
    stageEnteredAt: row.stage_entered_at
      ? iso(row.stage_entered_at)
      : iso(row.updated_at),
    status: row.status,
    totalQuantity: Number(row.total_quantity),
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
/** @param {any} row */
function mapDeal(row) {
  return {
    assignedUser: row.assigned_user_id
      ? { functionName: row.function_name, id: row.assigned_user_id }
      : null,
    contactRef: row.contact_id,
    id: row.id,
    stage: row.stage,
    status: row.status,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
/** @param {any} row */
function mapTask(row) {
  return {
    assignedUserId: row.assigned_user_id,
    dueAt: iso(row.task_due_at ?? row.due_at),
    id: row.task_id ?? row.id,
    status: row.task_status ?? row.status,
    type: row.task_type,
    version: Number(row.task_version ?? row.version),
  };
}
/** @param {any} row @param {number} dealVersion */
function mapHandoff(row, dealVersion) {
  return {
    assignedUserId: row.assigned_user_id,
    conversationId: row.conversation_id,
    conversationVersion: Number(row.conversation_version),
    createdAt: iso(row.created_at),
    dealVersion,
    dueAt: iso(row.due_at),
    id: row.id,
    reasonCode: row.reason_code,
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    slaMinutes: row.sla_minutes,
    slaPolicyVersion: row.sla_policy_version,
    status: row.status,
    taskId: row.task_id,
    taskVersion: Number(row.task_version),
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
/** @param {any} value */
function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}
/** @param {Array<() => Promise<any>>} operations */
async function runSequential(operations) {
  const results = [];
  for (const operation of operations) results.push(await operation());
  return results;
}
/** @param {any} value */
function dateOnly(value) {
  return value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
}
/** @param {any[]} assessments @param {any} state */
function effectiveAssessments(assessments, state) {
  return assessments
    .filter((assessment) => {
      const definition = resolveFieldDefinition(assessment.field);
      return definition && isAssessmentApplicable(definition, state);
    })
    .sort((left, right) => compareFieldPaths(left.field, right.field, state));
}
/** @param {any} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
