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
      return mapDeal(result.rows[0]);
    } catch (error) {
      const code = /** @type {{code?: unknown}} */ (error)?.code;
      if (code === '23505') {
        throw new DealConflictError('Conversation already has a deal');
      }
      throw error;
    }
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

/** @param {string|Date} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
