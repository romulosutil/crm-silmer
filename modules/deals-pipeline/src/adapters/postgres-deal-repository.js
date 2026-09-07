import { INITIAL_DEAL_STAGE, freezeDealRecord } from '../domain/deal.js';
import { DealConflictError } from '../domain/errors.js';

/** @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable */

/** @param {unknown} candidate @param {string} field @returns {Queryable} */
function requireQueryable(candidate, field) {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (candidate).query) !==
      'function'
  ) {
    throw new TypeError(`${field} must implement query`);
  }
  return /** @type {Queryable} */ (candidate);
}

export class PostgresDealRepository {
  /** @param {any} input @param {{transaction: any}} context */
  async createFromConversation(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    try {
      const result = await transaction.query(
        `INSERT INTO crm.deals
           (id, contact_id, source_conversation_id, stage, version,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)
         RETURNING id, contact_id, source_conversation_id, stage, version,
                   created_at, updated_at`,
        [
          input.id,
          input.contactId,
          input.sourceConversationId,
          INITIAL_DEAL_STAGE,
          input.createdAt,
        ],
      );
      await transaction.query(
        `INSERT INTO crm.deal_stage_history
           (deal_id, resulting_version, event_kind, from_stage, to_stage,
            actor_id, reason, occurred_at)
         VALUES ($1, 1, 'created', NULL, $2, NULL, NULL, $3)`,
        [input.id, INITIAL_DEAL_STAGE, input.createdAt],
      );
      return mapDeal(result.rows[0]);
    } catch (error) {
      const code = /** @type {{code?: unknown}} */ (error)?.code;
      if (code === '23505') {
        throw new DealConflictError('Conversation already has a deal');
      }
      throw error;
    }
  }

  /** @param {any} input @param {(deal: any) => Promise<any>} operation @param {any} context */
  async executeLocked(input, operation, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const result = await transaction.query(
      `SELECT id, contact_id, source_conversation_id, stage, status, version,
              created_at, updated_at, lost_at
       FROM crm.deals WHERE id = $1 FOR UPDATE`,
      [input.dealId],
    );
    const deal = mapCommandDeal(result.rows[0]);
    if (deal.version !== input.expectedVersion) {
      throw new DealConflictError('Deal version conflicts with current state');
    }
    return operation(deal);
  }

  /** @param {any} input @param {any} context */
  async applyTransition(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const version = input.deal.version + 1;
    if (input.gate) {
      await transaction.query(
        `INSERT INTO crm.deal_gates
           (deal_id, source_version, from_stage, blockers, evaluated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          input.deal.id,
          input.deal.version,
          input.deal.stage,
          JSON.stringify(input.gate.blockers),
          input.gate.evaluatedAt,
        ],
      );
    }
    const updated = await transaction.query(
      `UPDATE crm.deals
       SET stage = $3, version = version + 1, updated_at = $4
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING id, contact_id, source_conversation_id, stage, status, version,
                 created_at, updated_at, lost_at`,
      [input.deal.id, input.deal.version, input.toStage, input.occurredAt],
    );
    if (updated.rows.length !== 1) throw new DealConflictError();
    await transaction.query(
      `INSERT INTO crm.deal_stage_history
         (deal_id, resulting_version, event_kind, from_stage, to_stage,
          actor_id, reason, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.deal.id,
        version,
        input.direction === 'advance' ? 'advanced' : 'retreated',
        input.deal.stage,
        input.toStage,
        input.actorId,
        input.reason,
        input.occurredAt,
      ],
    );
    return mapCommandDeal(updated.rows[0]);
  }

  /** @param {any} input @param {any} context */
  async lose(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const version = input.deal.version + 1;
    const updated = await transaction.query(
      `UPDATE crm.deals
       SET status = 'lost', version = version + 1, updated_at = $3,
           lost_at = $3, loss_reason_envelope = $4::jsonb
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING id, contact_id, source_conversation_id, stage, status, version,
                 created_at, updated_at, lost_at`,
      [
        input.deal.id,
        input.deal.version,
        input.occurredAt,
        JSON.stringify(input.lossReasonEnvelope),
      ],
    );
    if (updated.rows.length !== 1) throw new DealConflictError();
    await transaction.query(
      `INSERT INTO crm.deal_stage_history
         (deal_id, resulting_version, event_kind, from_stage, to_stage,
          actor_id, reason, occurred_at)
       VALUES ($1, $2, 'lost', $3, NULL, $4, NULL, $5)`,
      [
        input.deal.id,
        version,
        input.deal.stage,
        input.actorId,
        input.occurredAt,
      ],
    );
    return mapCommandDeal(updated.rows[0]);
  }
}

/** @param {any} row */
function mapDeal(row) {
  if (!row) throw new DealConflictError('Stored deal was not found');
  return freezeDealRecord({
    contactId: row.contact_id,
    createdAt: iso(row.created_at),
    id: row.id,
    sourceConversationId: row.source_conversation_id,
    stage: row.stage,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  });
}

/** @param {any} row */
function mapCommandDeal(row) {
  if (!row) throw new DealConflictError('Stored deal was not found');
  return freezeDealRecord({
    contactId: row.contact_id,
    createdAt: iso(row.created_at),
    id: row.id,
    ...(row.lost_at ? { lostAt: iso(row.lost_at) } : {}),
    sourceConversationId: row.source_conversation_id,
    stage: row.stage,
    status: row.status,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  });
}

/** @param {string|Date} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
