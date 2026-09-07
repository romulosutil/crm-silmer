import { DealConflictError } from '../domain/errors.js';

export class PostgresDealWorkPort {
  /** @param {{dealId: string, expectedVersion: number}} input @param {{transaction: any}} context */
  async lock(input, context) {
    const database = queryable(context);
    const result = await database.query(
      `SELECT id, contact_id, assigned_user_id, status, version, updated_at
       FROM crm.deals WHERE id = $1 FOR UPDATE`,
      [input.dealId],
    );
    const deal = mapDeal(result.rows[0]);
    if (deal.version !== input.expectedVersion) {
      throw new DealConflictError('Deal version conflicts with current state');
    }
    return deal;
  }

  /** @param {{deal: any, assignedUserId: string, actorId: string, reasonCode: string, correlationId: string, occurredAt: string}} input @param {{transaction: any}} context */
  async assign(input, context) {
    const database = queryable(context);
    const updated = await database.query(
      `UPDATE crm.deals
       SET assigned_user_id = $3, version = version + 1, updated_at = $4
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING id, contact_id, assigned_user_id, status, version, updated_at`,
      [
        input.deal.id,
        input.deal.version,
        input.assignedUserId,
        input.occurredAt,
      ],
    );
    if (updated.rows.length !== 1) throw new DealConflictError();
    const deal = mapDeal(updated.rows[0]);
    await database.query(
      `INSERT INTO crm.deal_assignment_history
         (deal_id, resulting_version, previous_user_id, assigned_user_id,
          actor_id, reason_code, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        deal.id,
        deal.version,
        input.deal.assignedUserId,
        input.assignedUserId,
        input.actorId,
        input.reasonCode,
        input.correlationId,
        input.occurredAt,
      ],
    );
    return deal;
  }

  /** @param {{deal: any, occurredAt: string}} input @param {{transaction: any}} context */
  async touch(input, context) {
    const database = queryable(context);
    const updated = await database.query(
      `UPDATE crm.deals SET version = version + 1, updated_at = $3
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING id, contact_id, assigned_user_id, status, version, updated_at`,
      [input.deal.id, input.deal.version, input.occurredAt],
    );
    if (updated.rows.length !== 1) throw new DealConflictError();
    return mapDeal(updated.rows[0]);
  }
}

/** @param {any} context */
function queryable(context) {
  if (
    !context?.transaction ||
    typeof context.transaction.query !== 'function'
  ) {
    throw new TypeError('context.transaction must implement query');
  }
  return context.transaction;
}

/** @param {any} row */
function mapDeal(row) {
  if (!row) throw new DealConflictError('Stored Deal was not found');
  return Object.freeze({
    assignedUserId: row.assigned_user_id,
    contactId: row.contact_id,
    id: row.id,
    status: row.status,
    updatedAt: new Date(row.updated_at).toISOString(),
    version: Number(row.version),
  });
}
