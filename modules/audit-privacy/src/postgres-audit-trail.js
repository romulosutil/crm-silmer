import { randomUUID } from 'node:crypto';

import { createAuditEventEnvelope } from './audit-trail.js';

/**
 * @typedef {{
 *   query: (
 *     sql: string,
 *     values?: unknown[],
 *   ) => Promise<{ rows: unknown[] }>,
 * }} Queryable
 * @typedef {{ transaction?: Queryable }} AuditAppendContext
 */

const INSERT_AUDIT_EVENT_SQL = `
  INSERT INTO crm.audit_events
    (id, actor_id, action, target_type, target_id, version, reason,
     correlation_id, occurred_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

/** @param {unknown} candidate @param {string} field */
function requireQueryable(candidate, field) {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof /** @type {Record<string, unknown>} */ (candidate).query !==
      'function'
  ) {
    throw new TypeError(`${field} must implement query`);
  }
  return /** @type {Queryable} */ (candidate);
}

export class PostgresAuditTrail {
  /** @type {Queryable} */
  #queryable;

  /** @type {() => Date} */
  #clock;

  /** @type {() => string} */
  #idFactory;

  /**
   * @param {Queryable} queryable PostgreSQL Pool or PoolClient used when no
   * external transaction is supplied.
   * @param {{ clock?: () => Date, idFactory?: () => string }} [options]
   */
  constructor(queryable, options = {}) {
    this.#queryable = requireQueryable(queryable, 'queryable');
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  /**
   * Persists only the normalized business envelope. Passing a PoolClient in
   * context.transaction makes the insert part of the caller's transaction;
   * this adapter never starts or commits a transaction on its own.
   *
   * @param {{
   *   actor: string,
   *   action: string,
   *   target: {type: string, id: string},
   *   version: string | number,
   *   reason: string,
   *   correlationId: string,
   * } & Record<string, unknown>} input
   * @param {AuditAppendContext} [context]
   */
  async append(input, context = {}) {
    const event = createAuditEventEnvelope(input, {
      clock: this.#clock,
      idFactory: this.#idFactory,
    });
    const queryable = Object.hasOwn(context, 'transaction')
      ? requireQueryable(context.transaction, 'context.transaction')
      : this.#queryable;

    await queryable.query(INSERT_AUDIT_EVENT_SQL, [
      event.id,
      event.actor,
      event.action,
      event.target.type,
      event.target.id,
      String(event.version),
      event.reason,
      event.correlationId,
      new Date(event.occurredAt),
    ]);
    return event;
  }
}
