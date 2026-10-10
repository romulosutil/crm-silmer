import { randomUUID } from 'node:crypto';

import {
  OrderConflictError,
  OrderForbiddenError,
  OrderNotFoundError,
} from '../domain/errors.js';
import {
  StoreOrderDuplicateError,
  StoreOrderError,
} from '../domain/store-order.js';
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
  first_contact_at, paid_on::text AS paid_on,
  delivered_on::text AS delivered_on, origin, is_test, store_number,
  lead_time_business_days, payment_source, payment_confirmed_at,
  paid_amount_cents, payment_transaction_nsu, payment_invoice_slug,
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

/**
 * ADR 028: the audit of a store order write, in its transaction. Only the
 * technical actor, the order id, its version and the correlation: no name,
 * phone, receipt link or gateway identifier.
 *
 * @param {Queryable} transaction
 * @param {Order} order
 * @param {{action: string, reason: string, audit: import('../ports/contracts.js').StoreAuditContext}} input
 */
async function appendStoreAudit(transaction, order, { action, audit, reason }) {
  await transaction.query(
    `INSERT INTO crm.audit_events
       (id, actor_id, action, target_type, target_id, version, reason,
        correlation_id, occurred_at)
     VALUES ($1, $2, $3, 'order', $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      audit.actor,
      action,
      order.id,
      String(order.version),
      reason,
      audit.correlationId,
      order.updatedAt,
    ],
  );
}

/**
 * Conversation transfers lock this row first. Keeping the same lock until
 * commit orders ownership changes and order writes against each other.
 *
 * @param {Queryable} transaction @param {string} conversationId
 */
export async function lockConversation(transaction, conversationId) {
  const result = await transaction.query(
    `SELECT assigned_user_id FROM crm.conversations
     WHERE id = $1 FOR UPDATE`,
    [conversationId],
  );
  return result.rows[0] ?? null;
}

/**
 * The service checks before validation to avoid leaking details. This second
 * check runs against the locked assignment, before any order write. An admin
 * grant is checked in the same transaction and held against revocation.
 *
 * @param {Queryable} transaction
 * @param {{id: string, kind: string, capabilities?: readonly string[]}|undefined} actor
 * @param {{assigned_user_id: string|null}} conversation
 * @param {boolean} allowTechnical
 */
export async function assertWriteOwner(
  transaction,
  actor,
  conversation,
  allowTechnical,
) {
  // Only automation creation and briefing projection may omit a human actor.
  if (!actor) {
    if (allowTechnical) return;
    throw new OrderForbiddenError();
  }
  if (actor.kind !== 'human' || !actor.id) throw new OrderForbiddenError();
  if (conversation.assigned_user_id === actor.id) return;
  if (!(actor.capabilities ?? []).includes('COMMERCIAL_ADMIN')) {
    throw new OrderForbiddenError();
  }
  const grant = await transaction.query(
    `SELECT 1 FROM crm.user_capabilities
     WHERE user_id = $1 AND capability = 'COMMERCIAL_ADMIN'
     FOR SHARE`,
    [actor.id],
  );
  if (!grant.rows[0]) throw new OrderForbiddenError();
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
      deliveredOn: row.delivered_on,
      fabCode: row.fab_code,
      ficha: decryptJson(
        row.ficha_envelope,
        fichaAad(row.id),
        this.#envelopeKey,
      ),
      finalAmountCents:
        row.final_amount_cents === null ? null : Number(row.final_amount_cents),
      firstContactAt: isoOrNull(row.first_contact_at),
      // ADR 028: the payment InfinitePay confirmed, on a store order only.
      gatewayPayment:
        row.payment_source === 'infinitepay'
          ? {
              confirmedAt: /** @type {string} */ (
                isoOrNull(row.payment_confirmed_at)
              ),
              invoiceSlug: row.payment_invoice_slug,
              paidAmountCents: Number(row.paid_amount_cents),
              source: 'infinitepay',
              transactionNsu: row.payment_transaction_nsu,
            }
          : null,
      id: row.id,
      isTest: row.is_test === true,
      leadTimeBusinessDays:
        row.lead_time_business_days === null ||
        row.lead_time_business_days === undefined
          ? null
          : Number(row.lead_time_business_days),
      missingFields: [...row.missing_fields],
      number: row.number,
      numberSequence: Number(row.number_sequence),
      orderDate: row.order_date,
      origin: row.origin ?? 'atendimento',
      paidOn: row.paid_on,
      paymentCondition: row.payment_condition,
      reopenedAt: isoOrNull(row.reopened_at),
      reopenedBy: row.reopened_by,
      status: row.status,
      storeNumber: row.store_number ?? null,
      totalPieces: Number(row.total_pieces),
      updatedAt: /** @type {string} */ (isoOrNull(row.updated_at)),
      version: Number(row.version),
    };
  }

  /** @param {import('../ports/contracts.js').CreatePendingOrderInput} input */
  async createPending(input) {
    try {
      return await this.#database.transaction(async (transaction) => {
        const conversation = await lockConversation(
          transaction,
          input.conversationId,
        );
        if (!conversation) {
          throw new OrderNotFoundError(
            'Conversation was not found',
            'CONVERSATION_NOT_FOUND',
          );
        }
        await assertWriteOwner(
          transaction,
          input.actor,
          conversation,
          input.createdByKind === 'automation',
        );
        const at = input.now.toISOString();
        const inserted = await transaction.query(
          `WITH reserved AS (SELECT nextval('crm.order_number_seq') AS sequence)
           INSERT INTO crm.orders
             (id, number_sequence, number, conversation_id, status, fab_code,
              ficha_version, ficha_envelope, total_pieces, missing_fields,
              created_by_kind, created_by, first_contact_at, version,
              created_at, updated_at)
           SELECT $1, reserved.sequence,
                  lpad(reserved.sequence::text, 2, '0') || '-CRM',
                  $2, 'pendente', $3, 1, $4::jsonb, $5, $6::text[], $7, $8,
                  $10, 1, $9, $9
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
            input.firstContactAt,
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

  /**
   * ADR 028: the order recorded for a `pedido_id`, with the hash of the data
   * a retry must repeat.
   *
   * @param {string} requestId
   * @returns {Promise<import('../ports/contracts.js').StoredStoreOrder|null>}
   */
  async findStoreOrder(requestId) {
    const result = await this.#database.query(
      `SELECT ${ORDER_COLUMNS}, record_sha256
       FROM crm.orders
       JOIN crm.store_order_receipts ON order_id = id
       WHERE request_id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    return row
      ? { order: this.#map(row), recordSha256: row.record_sha256 }
      : null;
  }

  /**
   * ADR 028: the store order, its receipt, its `order.created` event and its
   * `store.order.create` audit in one transaction. Two calls for the same
   * `pedido_id` wait for each other on an advisory lock, so the loser finds
   * the winner's receipt before it reserves an order number.
   *
   * @param {import('../ports/contracts.js').CreateStoreOrderInput} input
   */
  async createStoreOrder(input) {
    const { audit, now, order, receipt } = input;
    const payment = order.gatewayPayment;
    const at = now.toISOString();
    try {
      return await this.#database.transaction(async (transaction) => {
        await transaction.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`store-order:${receipt.requestId}`],
        );
        const known = await transaction.query(
          'SELECT 1 FROM crm.store_order_receipts WHERE request_id = $1',
          [receipt.requestId],
        );
        if (known.rows[0]) throw new StoreOrderDuplicateError();
        const taken = await transaction.query(
          `SELECT 1 FROM crm.orders
           WHERE payment_source = $1 AND payment_transaction_nsu = $2`,
          [payment.source, payment.transactionNsu],
        );
        if (taken.rows[0]) {
          throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
        }
        const inserted = await transaction.query(
          `WITH reserved AS (SELECT nextval('crm.order_number_seq') AS sequence)
           INSERT INTO crm.orders
             (id, number_sequence, number, conversation_id, status, fab_code,
              ficha_version, ficha_envelope, total_pieces, missing_fields,
              final_amount_cents, payment_condition, order_date, confirmed_at,
              confirmed_by, created_by_kind, created_by, first_contact_at,
              paid_on, origin, is_test, store_number, lead_time_business_days,
              payment_source, payment_confirmed_at, paid_amount_cents,
              payment_transaction_nsu, payment_invoice_slug, version,
              created_at, updated_at)
           SELECT $1, reserved.sequence,
                  lpad(reserved.sequence::text, 2, '0') || '-CRM',
                  NULL, 'confirmado', $2, 1, $3::jsonb, $4, '{}'::text[],
                  $5, $6, $7::date, $8, $9, $10, $11, $12, $13::date, 'loja',
                  $14, $15, $16, $17, $18, $19, $20, $21, 1, $8, $8
           FROM reserved
           RETURNING ${ORDER_COLUMNS}`,
          [
            order.id,
            order.fabCode,
            JSON.stringify(
              encryptJson(order.ficha, fichaAad(order.id), this.#envelopeKey),
            ),
            order.totalPieces,
            order.finalAmountCents,
            order.paymentCondition,
            order.orderDate,
            at,
            order.confirmedBy,
            order.createdByKind,
            order.createdBy,
            order.firstContactAt,
            order.paidOn,
            order.isTest,
            order.storeNumber,
            order.leadTimeBusinessDays,
            payment.source,
            payment.confirmedAt,
            payment.paidAmountCents,
            payment.transactionNsu,
            payment.invoiceSlug,
          ],
        );
        const saved = this.#map(inserted.rows[0]);
        await transaction.query(
          `INSERT INTO crm.store_order_receipts
             (order_id, request_id, phone_digest, record_sha256, received_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            saved.id,
            receipt.requestId,
            receipt.phoneDigest,
            receipt.recordSha256,
            at,
          ],
        );
        await appendOrderEvent(
          transaction,
          saved,
          'order.created',
          audit.correlationId,
        );
        await appendStoreAudit(transaction, saved, {
          action: 'store.order.create',
          audit,
          reason: 'INFINITEPAY_PAYMENT_CONFIRMED',
        });
        return saved;
      });
    } catch (error) {
      if (violates(error, 'store_order_receipts_request_id_key')) {
        throw new StoreOrderDuplicateError();
      }
      if (violates(error, 'orders_payment_transaction_nsu')) {
        throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
      }
      throw error;
    }
  }

  /**
   * ADR 028: the receipt link a store order did not have yet. It lives in
   * the encrypted ficha, so the row is locked, the ficha read, changed and
   * written back with a new version, an `order.receipt_attached` event and
   * the `store.order.receipt_attached` audit.
   *
   * @param {import('../ports/contracts.js').AttachStoreReceiptInput} input
   */
  async attachStoreReceipt(input) {
    return this.#database.transaction(async (transaction) => {
      const locked = await transaction.query(
        `SELECT ${ORDER_COLUMNS} FROM crm.orders
         WHERE id = $1 AND origin = 'loja'
         FOR UPDATE`,
        [input.orderId],
      );
      if (!locked.rows[0]) throw new OrderNotFoundError();
      const current = this.#map(locked.rows[0]);
      const loja = current.ficha.loja;
      if (!loja) throw new OrderNotFoundError();
      const stored = loja.comprovanteUrl ?? null;
      if (stored === input.receiptUrl)
        return { attached: false, order: current };
      if (stored !== null) {
        throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
      }
      const ficha = {
        ...current.ficha,
        loja: { ...loja, comprovanteUrl: input.receiptUrl },
      };
      const updated = await transaction.query(
        `UPDATE crm.orders
         SET ficha_envelope = $2::jsonb, version = version + 1,
             updated_at = $3
         WHERE id = $1
         RETURNING ${ORDER_COLUMNS}`,
        [
          current.id,
          JSON.stringify(
            encryptJson(ficha, fichaAad(current.id), this.#envelopeKey),
          ),
          input.now.toISOString(),
        ],
      );
      const saved = this.#map(updated.rows[0]);
      await appendOrderEvent(
        transaction,
        saved,
        'order.receipt_attached',
        input.audit.correlationId,
      );
      await appendStoreAudit(transaction, saved, {
        action: 'store.order.receipt_attached',
        audit: input.audit,
        reason: 'INFINITEPAY_RECEIPT_ATTACHED',
      });
      return { attached: true, order: saved };
    });
  }

  /** @param {string} orderId */
  async findById(orderId) {
    const result = await this.#database.query(
      `SELECT ${ORDER_COLUMNS} FROM crm.orders WHERE id = $1`,
      [orderId],
    );
    return result.rows[0] ? this.#map(result.rows[0]) : null;
  }

  async summary() {
    const result = await this.#database.query(
      `SELECT
         count(*) FILTER (WHERE status = 'confirmado')::integer AS confirmed_count,
         coalesce(sum(final_amount_cents) FILTER (WHERE status = 'confirmado'), 0)::bigint AS sold_amount_cents,
         count(*) FILTER (WHERE status = 'pendente')::integer AS pending_count,
         coalesce(sum(total_pieces) FILTER (WHERE status = 'confirmado'), 0)::bigint AS total_pieces_sold
       FROM crm.orders
       WHERE NOT is_test`,
    );
    const row = result.rows[0];
    const confirmedCount = Number(row.confirmed_count);
    const soldAmountCents = Number(row.sold_amount_cents);
    return {
      confirmedCount,
      soldAmountCents,
      averageTicketCents: confirmedCount
        ? Math.round(soldAmountCents / confirmedCount)
        : 0,
      pendingCount: Number(row.pending_count),
      totalPiecesSold: Number(row.total_pieces_sold),
    };
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
    const {
      after,
      conversationIds,
      limit,
      numberSequence,
      origin,
      phoneDigests,
      status,
      storeNumber,
    } = readOrderListQuery(query);
    /** @type {unknown[]} */
    const values = [];
    /** @param {unknown} value */
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };

    let scope = 'TRUE';
    if (
      numberSequence !== undefined ||
      conversationIds !== undefined ||
      phoneDigests !== undefined ||
      storeNumber !== undefined
    ) {
      const matches = [];
      if (numberSequence !== undefined) {
        matches.push(`number_sequence = ${bind(numberSequence)}`);
      }
      if (conversationIds !== undefined) {
        matches.push(`conversation_id = ANY(${bind(conversationIds)}::text[])`);
      }
      if (phoneDigests !== undefined) {
        // ADR 027: a store order has no conversation; its phone is found by
        // the HMAC kept on its receipt, never by the number in the clear.
        matches.push(
          `id IN (SELECT order_id FROM crm.store_order_receipts
                  WHERE phone_digest = ANY(${bind(phoneDigests)}::text[]))`,
        );
      }
      if (storeNumber !== undefined) {
        // ADR 028: the shop's number, LJ- and eight hex digits.
        matches.push(`store_number = ${bind(storeNumber)}`);
      }
      scope = `(${matches.join(' OR ')})`;
    }
    if (origin !== undefined) scope = `${scope} AND origin = ${bind(origin)}`;

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
    return this.#write(order, options, eventType, async (current, tx) => {
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

  /**
   * The ficha travels with the status: generating writes down the client
   * the order showed then (ADR 018); reopening writes it back unchanged.
   *
   * @param {Order} order @param {OrderWriteOptions} options
   */
  async saveStatus(order, options) {
    return this.#write(
      order,
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
               ficha_envelope = $12::jsonb, version = version + 1
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
            JSON.stringify(
              encryptJson(order.ficha, fichaAad(order.id), this.#envelopeKey),
            ),
          ],
        );
      },
    );
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async saveMilestones(order, options) {
    return this.#write(
      order,
      options,
      'order.milestones_saved',
      async (_current, tx) =>
        tx.query(
          `UPDATE crm.orders
           SET paid_on = $2::date, delivered_on = $3::date, updated_at = $4,
               version = version + 1
           WHERE id = $1
           RETURNING ${ORDER_COLUMNS}`,
          [order.id, order.paidOn, order.deliveredOn, order.updatedAt],
        ),
    );
  }

  /**
   * Locks the conversation before the order, checks current ownership and
   * version, applies the change and appends its event in one transaction.
   * A transfer or another writer waits and sees the resulting state.
   *
   * @param {Order} order
   * @param {OrderWriteOptions} options
   * @param {string} eventType
   * @param {(current: {status: string}, transaction: Queryable) => Promise<{rows: any[]}>} change
   */
  async #write(order, options, eventType, change) {
    // ADR 027: a store order has no conversation to lock and takes no write.
    const conversationId = order.conversationId;
    if (order.origin === 'loja' || conversationId === null) {
      throw new OrderConflictError('Store orders are locked', 'ORDER_LOCKED');
    }
    return this.#database.transaction(async (transaction) => {
      const conversation = await lockConversation(transaction, conversationId);
      if (!conversation) throw new OrderNotFoundError();
      await assertWriteOwner(
        transaction,
        options.actor,
        conversation,
        eventType === 'order.briefing_projected',
      );
      const locked = await transaction.query(
        `SELECT conversation_id, status, version FROM crm.orders
         WHERE id = $1 FOR UPDATE`,
        [order.id],
      );
      const current = locked.rows[0];
      if (!current || current.conversation_id !== order.conversationId) {
        throw new OrderNotFoundError();
      }
      if (Number(current.version) !== options.expectedVersion) {
        throw new OrderConflictError(
          `Expected order version ${options.expectedVersion}, current version is ${current.version}`,
        );
      }
      const updated = await change(current, transaction);
      const saved = this.#map(updated.rows[0]);
      await appendOrderEvent(
        transaction,
        saved,
        eventType,
        options.correlationId,
      );
      return saved;
    });
  }
}
