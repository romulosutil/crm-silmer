import { randomUUID } from 'node:crypto';

import { OrderConflictError, OrderNotFoundError } from '../domain/errors.js';
import {
  encodeOrderCursor,
  readOrderListQuery,
  statusEventType,
} from '../ports/contracts.js';
import { decryptJson, encryptJson } from './envelope.js';

/**
 * @typedef {import('../ports/contracts.js').Order} Order
 * @typedef {import('../ports/contracts.js').OrderWriteOptions} OrderWriteOptions
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable
 * @typedef {{query: Queryable['query'], transaction: <T>(work: (transaction: Queryable) => Promise<T>) => Promise<T>}} TransactionalDatabase
 */

const ORDER_COLUMNS = `id, number_sequence, number, conversation_id, status,
  fab_code, ficha_envelope, total_pieces, missing_fields, final_amount_cents,
  payment_condition, order_date::text AS order_date, confirmed_at,
  confirmed_by, reopened_at, reopened_by, created_by_kind, created_by,
  version, created_at, updated_at`;

/** @param {string} orderId */
function fichaAad(orderId) {
  return `order-ficha:${orderId}`;
}

/** @param {Date|string|null} value */
function isoOrNull(value) {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * Publishes the change on the shared domain event stream inside the same
 * transaction, so no event exists for a write that rolled back. The payload
 * carries identifiers only; the Inbox and the order list re-read the order
 * through the authorized API.
 *
 * @param {Queryable} transaction
 * @param {Order} order
 * @param {string} eventType
 * @param {string} correlationId
 */
async function appendOrderEvent(transaction, order, eventType, correlationId) {
  await transaction.query(
    `INSERT INTO crm.domain_events
       (id, aggregate_type, aggregate_id, aggregate_version, event_type,
        payload, correlation_id, occurred_at)
     VALUES ($1, 'order', $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      `event-${randomUUID()}`,
      order.id,
      order.version,
      eventType,
      JSON.stringify({
        conversationId: order.conversationId,
        orderId: order.id,
      }),
      correlationId,
      order.updatedAt,
    ],
  );
}

/** @param {unknown} error @param {string} constraint */
function violates(error, constraint) {
  const candidate = /** @type {{code?: string, constraint?: string}} */ (error);
  return (
    (candidate?.code === '23505' || candidate?.code === '23503') &&
    candidate.constraint === constraint
  );
}

export class PostgresOrderRepository {
  /** @type {TransactionalDatabase} */
  #database;
  /** @type {Buffer} */
  #envelopeKey;

  /**
   * `envelopeKey` is the key the n8n integration uses for the pre-ficha
   * (`N8N_INTEGRATION_ENVELOPE_KEY`): the ficha is built from that briefing.
   *
   * @param {{database: TransactionalDatabase, envelopeKey: Buffer}} options
   */
  constructor({ database, envelopeKey }) {
    if (
      !database ||
      typeof database.query !== 'function' ||
      typeof database.transaction !== 'function'
    ) {
      throw new TypeError('A transactional PostgreSQL database is required');
    }
    if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32) {
      throw new TypeError('envelopeKey must be a 32-byte Buffer');
    }
    this.#database = database;
    this.#envelopeKey = Buffer.from(envelopeKey);
  }

  /** @param {any} row @returns {Order} */
  #map(row) {
    return {
      confirmedAt: isoOrNull(row.confirmed_at),
      confirmedBy: row.confirmed_by,
      conversationId: row.conversation_id,
      createdAt: /** @type {string} */ (isoOrNull(row.created_at)),
      createdBy: row.created_by,
      createdByKind: row.created_by_kind,
      fabCode: row.fab_code,
      ficha: decryptJson(
        row.ficha_envelope,
        fichaAad(row.id),
        this.#envelopeKey,
      ),
      finalAmountCents:
        row.final_amount_cents === null ? null : Number(row.final_amount_cents),
      id: row.id,
      missingFields: [...row.missing_fields],
      number: row.number,
      numberSequence: Number(row.number_sequence),
      orderDate: row.order_date,
      paymentCondition: row.payment_condition,
      reopenedAt: isoOrNull(row.reopened_at),
      reopenedBy: row.reopened_by,
      status: row.status,
      totalPieces: Number(row.total_pieces),
      updatedAt: /** @type {string} */ (isoOrNull(row.updated_at)),
      version: Number(row.version),
    };
  }

  /** @param {import('../ports/contracts.js').CreatePendingOrderInput} input */
  async createPending(input) {
    try {
      return await this.#database.transaction(async (transaction) => {
        const at = input.now.toISOString();
        const inserted = await transaction.query(
          `WITH reserved AS (SELECT nextval('crm.order_number_seq') AS sequence)
           INSERT INTO crm.orders
             (id, number_sequence, number, conversation_id, status, fab_code,
              ficha_version, ficha_envelope, total_pieces, missing_fields,
              created_by_kind, created_by, version, created_at, updated_at)
           SELECT $1, reserved.sequence,
                  lpad(reserved.sequence::text, 2, '0') || '-CRM',
                  $2, 'pendente', $3, 1, $4::jsonb, $5, $6::text[], $7, $8, 1,
                  $9, $9
           FROM reserved
           RETURNING ${ORDER_COLUMNS}`,
          [
            input.id,
            input.conversationId,
            input.fabCode,
            JSON.stringify(
              encryptJson(input.ficha, fichaAad(input.id), this.#envelopeKey),
            ),
            input.totalPieces,
            input.missingFields,
            input.createdByKind,
            input.createdBy,
            at,
          ],
        );
        const order = this.#map(inserted.rows[0]);
        await appendOrderEvent(
          transaction,
          order,
          'order.created',
          input.correlationId,
        );
        return order;
      });
    } catch (error) {
      if (violates(error, 'orders_one_pending_per_conversation')) {
        throw new OrderConflictError(
          'The conversation already has a pending order',
          'ORDER_PENDING_EXISTS',
        );
      }
      if (violates(error, 'orders_conversation_id_fkey')) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      throw error;
    }
  }

  /** @param {string} orderId */
  async findById(orderId) {
    const result = await this.#database.query(
      `SELECT ${ORDER_COLUMNS} FROM crm.orders WHERE id = $1`,
      [orderId],
    );
    return result.rows[0] ? this.#map(result.rows[0]) : null;
  }

  /** @param {string} conversationId */
  async findPendingByConversation(conversationId) {
    const result = await this.#database.query(
      `SELECT ${ORDER_COLUMNS} FROM crm.orders
       WHERE conversation_id = $1 AND status = 'pendente'`,
      [conversationId],
    );
    return result.rows[0] ? this.#map(result.rows[0]) : null;
  }

  /** @param {string} conversationId */
  async listByConversation(conversationId) {
    const result = await this.#database.query(
      `SELECT ${ORDER_COLUMNS} FROM crm.orders
       WHERE conversation_id = $1
       ORDER BY number_sequence DESC`,
      [conversationId],
    );
    return result.rows.map((row) => this.#map(row));
  }

  /** @param {import('../ports/contracts.js').OrderListQuery} query */
  async list(query) {
    const { after, conversationIds, limit, numberSequence, status } =
      readOrderListQuery(query);
    /** @type {unknown[]} */
    const values = [];
    /** @param {unknown} value */
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };

    let scope = 'TRUE';
    if (numberSequence !== undefined || conversationIds !== undefined) {
      const matches = [];
      if (numberSequence !== undefined) {
        matches.push(`number_sequence = ${bind(numberSequence)}`);
      }
      if (conversationIds !== undefined) {
        matches.push(`conversation_id = ANY(${bind(conversationIds)}::text[])`);
      }
      scope = `(${matches.join(' OR ')})`;
    }

    const counted = await this.#database.query(
      `SELECT status, count(*)::integer AS total FROM crm.orders
       WHERE ${scope} GROUP BY status`,
      values,
    );
    const counts = { confirmado: 0, pendente: 0 };
    for (const row of counted.rows) {
      counts[/** @type {'confirmado'|'pendente'} */ (row.status)] = row.total;
    }

    const filters = [scope];
    if (status !== undefined) filters.push(`status = ${bind(status)}`);
    if (after !== null) {
      filters.push(
        `(updated_at, id) < (${bind(after.updatedAt)}::timestamptz, ${bind(after.id)})`,
      );
    }
    const page = await this.#database.query(
      `SELECT ${ORDER_COLUMNS} FROM crm.orders
       WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT ${bind(limit + 1)}`,
      values,
    );
    const items = page.rows.slice(0, limit).map((row) => this.#map(row));
    return {
      counts,
      items,
      nextCursor:
        page.rows.length > limit
          ? encodeOrderCursor(/** @type {Order} */ (items.at(-1)))
          : null,
    };
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async saveSection(order, options) {
    return this.#writeFicha(order, options, 'order.section_saved');
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async projectBriefing(order, options) {
    return this.#writeFicha(order, options, 'order.briefing_projected');
  }

  /** @param {Order} order @param {OrderWriteOptions} options @param {string} eventType */
  async #writeFicha(order, options, eventType) {
    return this.#write(order.id, options, eventType, async (current, tx) => {
      if (current.status !== 'pendente') {
        throw new OrderConflictError(
          'Only pending orders accept ficha changes',
          'ORDER_STATUS_CONFLICT',
        );
      }
      return tx.query(
        `UPDATE crm.orders
         SET ficha_envelope = $2::jsonb, total_pieces = $3,
             missing_fields = $4::text[], updated_at = $5,
             version = version + 1
         WHERE id = $1
         RETURNING ${ORDER_COLUMNS}`,
        [
          order.id,
          JSON.stringify(
            encryptJson(order.ficha, fichaAad(order.id), this.#envelopeKey),
          ),
          order.totalPieces,
          order.missingFields,
          order.updatedAt,
        ],
      );
    });
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async saveStatus(order, options) {
    return this.#write(
      order.id,
      options,
      statusEventType(order.status),
      async (current, tx) => {
        if (current.status === order.status) {
          throw new OrderConflictError(
            `Order is already ${order.status}`,
            'ORDER_STATUS_CONFLICT',
          );
        }
        return tx.query(
          `UPDATE crm.orders
           SET status = $2, final_amount_cents = $3, payment_condition = $4,
               order_date = $5::date, confirmed_at = $6, confirmed_by = $7,
               reopened_at = $8, reopened_by = $9,
               missing_fields = $10::text[], updated_at = $11,
               version = version + 1
           WHERE id = $1
           RETURNING ${ORDER_COLUMNS}`,
          [
            order.id,
            order.status,
            order.finalAmountCents,
            order.paymentCondition,
            order.orderDate,
            order.confirmedAt,
            order.confirmedBy,
            order.reopenedAt,
            order.reopenedBy,
            order.missingFields,
            order.updatedAt,
          ],
        );
      },
    );
  }

  /**
   * Locks the row, checks the version the caller read, applies the change
   * and appends its event — all in one transaction. A concurrent writer waits
   * on the lock and then sees the bumped version.
   *
   * @param {string} orderId
   * @param {OrderWriteOptions} options
   * @param {string} eventType
   * @param {(current: {status: string}, transaction: Queryable) => Promise<{rows: any[]}>} change
   */
  async #write(orderId, options, eventType, change) {
    return this.#database.transaction(async (transaction) => {
      const locked = await transaction.query(
        `SELECT status, version FROM crm.orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const current = locked.rows[0];
      if (!current) throw new OrderNotFoundError();
      if (Number(current.version) !== options.expectedVersion) {
        throw new OrderConflictError(
          `Expected order version ${options.expectedVersion}, current version is ${current.version}`,
        );
      }
      const updated = await change(current, transaction);
      const order = this.#map(updated.rows[0]);
      await appendOrderEvent(
        transaction,
        order,
        eventType,
        options.correlationId,
      );
      return order;
    });
  }
}
