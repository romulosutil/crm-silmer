import { OrderConflictError, OrderNotFoundError } from '../domain/errors.js';
import { formatOrderNumber } from '../domain/order.js';
import {
  StoreOrderDuplicateError,
  StoreOrderError,
} from '../domain/store-order.js';
import {
  encodeOrderCursor,
  readOrderListQuery,
  statusEventType,
} from '../ports/contracts.js';

/**
 * @typedef {import('../ports/contracts.js').Order} Order
 * @typedef {import('../ports/contracts.js').OrderWriteOptions} OrderWriteOptions
 * @typedef {{eventType: string, aggregateVersion: number, correlationId: string, occurredAt: string, payload: {orderId: string, conversationId: string|null}}} RecordedOrderEvent
 * @typedef {import('../ports/contracts.js').CreateStoreOrderInput['receipt'] & {orderId: string, receivedAt: string}} StoreReceipt
 * @typedef {{actor: string, action: string, target: {type: string, id: string}, version: string, reason: string, correlationId: string, occurredAt: string}} RecordedAudit
 */

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return structuredClone(value);
}

/** @param {Order} left @param {Order} right */
function byMostRecentlyUpdated(left, right) {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt < right.updatedAt ? 1 : -1;
  }
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/**
 * Reference implementation of the OrderRepository port for unit tests. Every
 * command runs exclusively, so version checks behave like the row lock the
 * PostgreSQL adapter takes.
 */
export class InMemoryOrderRepository {
  /** @type {Map<string, Order>} */
  #orders = new Map();
  /** @type {RecordedOrderEvent[]} */
  #events = [];
  /** @type {StoreReceipt[]} */
  #receipts = [];
  /** @type {RecordedAudit[]} */
  #audits = [];
  #sequence = 0;
  #tail = Promise.resolve();

  /** @template T @param {() => T} work @returns {Promise<T>} */
  async #exclusive(work) {
    const previous = this.#tail;
    /** @type {(() => void)|undefined} */
    let release;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return work();
    } finally {
      release?.();
    }
  }

  /** @param {Order} order @param {string} eventType @param {string} correlationId */
  #record(order, eventType, correlationId) {
    this.#events.push({
      aggregateVersion: order.version,
      correlationId,
      eventType,
      occurredAt: order.updatedAt,
      payload: { conversationId: order.conversationId, orderId: order.id },
    });
  }

  /** @param {import('../ports/contracts.js').CreatePendingOrderInput} input */
  async createPending(input) {
    return this.#exclusive(() => {
      if (this.#pendingFor(input.conversationId)) {
        throw new OrderConflictError(
          'The conversation already has a pending order',
          'ORDER_PENDING_EXISTS',
        );
      }
      this.#sequence += 1;
      const at = input.now.toISOString();
      /** @type {Order} */
      const order = {
        confirmedAt: null,
        confirmedBy: null,
        conversationId: input.conversationId,
        createdAt: at,
        createdBy: input.createdBy,
        createdByKind: input.createdByKind,
        deliveredOn: null,
        fabCode: input.fabCode,
        ficha: clone(input.ficha),
        finalAmountCents: null,
        firstContactAt: input.firstContactAt,
        gatewayPayment: null,
        id: input.id,
        isTest: false,
        leadTimeBusinessDays: null,
        missingFields: [...input.missingFields],
        number: formatOrderNumber(this.#sequence),
        numberSequence: this.#sequence,
        orderDate: null,
        origin: 'atendimento',
        paidOn: null,
        paymentCondition: null,
        reopenedAt: null,
        reopenedBy: null,
        status: 'pendente',
        storeNumber: null,
        totalPieces: input.totalPieces,
        updatedAt: at,
        version: 1,
      };
      this.#orders.set(order.id, order);
      this.#record(order, 'order.created', input.correlationId);
      return clone(order);
    });
  }

  /**
   * @param {Order} order @param {string} action @param {string} reason
   * @param {import('../ports/contracts.js').StoreAuditContext} audit
   */
  #audit(order, action, reason, audit) {
    this.#audits.push({
      action,
      actor: audit.actor,
      correlationId: audit.correlationId,
      occurredAt: order.updatedAt,
      reason,
      target: { id: order.id, type: 'order' },
      version: String(order.version),
    });
  }

  /**
   * ADR 028: the order recorded for a `pedido_id`, with the hash a retry is
   * compared to.
   *
   * @param {string} requestId
   * @returns {Promise<import('../ports/contracts.js').StoredStoreOrder|null>}
   */
  async findStoreOrder(requestId) {
    const receipt = this.#receipts.find(
      (stored) => stored.requestId === requestId,
    );
    const order = receipt ? this.#orders.get(receipt.orderId) : undefined;
    return order && receipt
      ? { order: clone(order), recordSha256: receipt.recordSha256 }
      : null;
  }

  /**
   * ADR 028: the store order, its receipt, its event and its audit, as one
   * unit of work. The PostgreSQL adapter enforces the same uniqueness of the
   * `pedido_id` and of the gateway's `transaction_nsu`.
   *
   * @param {import('../ports/contracts.js').CreateStoreOrderInput} input
   */
  async createStoreOrder(input) {
    return this.#exclusive(() => {
      const { audit, now, order, receipt } = input;
      if (
        this.#receipts.some((stored) => stored.requestId === receipt.requestId)
      ) {
        throw new StoreOrderDuplicateError();
      }
      const nsu = order.gatewayPayment.transactionNsu;
      if (
        [...this.#orders.values()].some(
          (stored) => stored.gatewayPayment?.transactionNsu === nsu,
        )
      ) {
        throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
      }
      this.#sequence += 1;
      const iso = now.toISOString();
      /** @type {Order} */
      const saved = {
        ...clone(order),
        createdAt: iso,
        deliveredOn: null,
        number: formatOrderNumber(this.#sequence),
        numberSequence: this.#sequence,
        reopenedAt: null,
        reopenedBy: null,
        updatedAt: iso,
        version: 1,
      };
      this.#orders.set(saved.id, saved);
      this.#receipts.push({ ...receipt, orderId: saved.id, receivedAt: iso });
      this.#record(saved, 'order.created', audit.correlationId);
      this.#audit(
        saved,
        'store.order.create',
        'INFINITEPAY_PAYMENT_CONFIRMED',
        audit,
      );
      return clone(saved);
    });
  }

  /**
   * ADR 028: the receipt link a store order did not have yet.
   *
   * @param {import('../ports/contracts.js').AttachStoreReceiptInput} input
   */
  async attachStoreReceipt(input) {
    return this.#exclusive(() => {
      const current = this.#orders.get(input.orderId);
      if (!current?.ficha.loja) throw new OrderNotFoundError();
      const stored = current.ficha.loja.comprovanteUrl ?? null;
      if (stored === input.receiptUrl) {
        return { attached: false, order: clone(current) };
      }
      if (stored !== null) {
        throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
      }
      const ficha = clone(current.ficha);
      /** @type {NonNullable<typeof ficha.loja>} */ (
        ficha.loja
      ).comprovanteUrl = input.receiptUrl;
      const next = {
        ...clone(current),
        ficha,
        updatedAt: input.now.toISOString(),
        version: current.version + 1,
      };
      this.#orders.set(next.id, next);
      this.#record(next, 'order.receipt_attached', input.audit.correlationId);
      this.#audit(
        next,
        'store.order.receipt_attached',
        'INFINITEPAY_RECEIPT_ATTACHED',
        input.audit,
      );
      return { attached: true, order: clone(next) };
    });
  }

  /**
   * The receipt of a store order, as the PostgreSQL adapter would store it.
   *
   * @param {string} orderId
   */
  receiptFor(orderId) {
    const receipt = this.#receipts.find((stored) => stored.orderId === orderId);
    return receipt ? clone(receipt) : null;
  }

  /**
   * The audit events of store orders, oldest first, as the PostgreSQL
   * adapter writes them to `crm.audit_events`.
   *
   * @returns {RecordedAudit[]}
   */
  audits() {
    return this.#audits.map(clone);
  }

  /** @param {string} orderId */
  async findById(orderId) {
    const order = this.#orders.get(orderId);
    return order ? clone(order) : null;
  }

  /** @param {string} conversationId */
  async findPendingByConversation(conversationId) {
    const order = this.#pendingFor(conversationId);
    return order ? clone(order) : null;
  }

  /** @param {string} conversationId */
  #pendingFor(conversationId) {
    return [...this.#orders.values()].find(
      (order) =>
        order.conversationId === conversationId && order.status === 'pendente',
    );
  }

  /** @param {string} conversationId */
  async listByConversation(conversationId) {
    return [...this.#orders.values()]
      .filter((order) => order.conversationId === conversationId)
      .sort((left, right) => right.numberSequence - left.numberSequence)
      .map(clone);
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
    const phoneOrders = new Set(
      this.#receipts
        .filter((receipt) => (phoneDigests ?? []).includes(receipt.phoneDigest))
        .map((receipt) => receipt.orderId),
    );
    const scoped = [...this.#orders.values()].filter(
      (order) =>
        (origin === undefined || order.origin === origin) &&
        ((numberSequence === undefined &&
          conversationIds === undefined &&
          phoneDigests === undefined &&
          storeNumber === undefined) ||
          order.numberSequence === numberSequence ||
          (conversationIds ?? []).includes(
            /** @type {string} */ (order.conversationId),
          ) ||
          phoneOrders.has(order.id) ||
          (storeNumber !== undefined && order.storeNumber === storeNumber)),
    );
    const counts = { confirmado: 0, pendente: 0 };
    for (const order of scoped) counts[order.status] += 1;
    const page = scoped
      .filter((order) => status === undefined || order.status === status)
      .sort(byMostRecentlyUpdated)
      .filter(
        (order) =>
          after === null ||
          byMostRecentlyUpdated(order, /** @type {Order} */ (after)) > 0,
      )
      .slice(0, limit + 1);
    const items = page.slice(0, limit);
    return {
      counts,
      items: items.map(clone),
      nextCursor:
        page.length > limit
          ? encodeOrderCursor(/** @type {Order} */ (items.at(-1)))
          : null,
    };
  }

  async summary() {
    // ADR 027: a test order from the site shop is never a sale.
    const orders = [...this.#orders.values()].filter((order) => !order.isTest);
    const confirmed = orders.filter((order) => order.status === 'confirmado');
    const soldAmountCents = confirmed.reduce(
      (total, order) => total + (order.finalAmountCents ?? 0),
      0,
    );
    return {
      confirmedCount: confirmed.length,
      soldAmountCents,
      averageTicketCents: confirmed.length
        ? Math.round(soldAmountCents / confirmed.length)
        : 0,
      pendingCount: orders.length - confirmed.length,
      totalPiecesSold: confirmed.reduce(
        (total, order) => total + order.totalPieces,
        0,
      ),
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
  #writeFicha(order, options, eventType) {
    return this.#write(order.id, options, eventType, (current) => {
      if (current.status !== 'pendente') {
        throw new OrderConflictError(
          'Only pending orders accept ficha changes',
          'ORDER_STATUS_CONFLICT',
        );
      }
      return {
        ...current,
        ficha: clone(order.ficha),
        missingFields: [...order.missingFields],
        totalPieces: order.totalPieces,
        updatedAt: order.updatedAt,
      };
    });
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async saveStatus(order, options) {
    return this.#write(
      order.id,
      options,
      statusEventType(order.status),
      (current) => {
        if (current.status === order.status) {
          throw new OrderConflictError(
            `Order is already ${order.status}`,
            'ORDER_STATUS_CONFLICT',
          );
        }
        return {
          ...current,
          confirmedAt: order.confirmedAt,
          confirmedBy: order.confirmedBy,
          ficha: clone(order.ficha),
          finalAmountCents: order.finalAmountCents,
          missingFields: [...order.missingFields],
          orderDate: order.orderDate,
          paymentCondition: order.paymentCondition,
          reopenedAt: order.reopenedAt,
          reopenedBy: order.reopenedBy,
          status: order.status,
          updatedAt: order.updatedAt,
        };
      },
    );
  }

  /** @param {Order} order @param {OrderWriteOptions} options */
  async saveMilestones(order, options) {
    return this.#write(
      order.id,
      options,
      'order.milestones_saved',
      (current) => ({
        ...current,
        deliveredOn: order.deliveredOn,
        paidOn: order.paidOn,
        updatedAt: order.updatedAt,
      }),
    );
  }

  /**
   * @param {string} orderId
   * @param {OrderWriteOptions} options
   * @param {string} eventType
   * @param {(current: Order) => Order} change
   */
  #write(orderId, options, eventType, change) {
    return this.#exclusive(() => {
      const current = this.#orders.get(orderId);
      if (!current) throw new OrderNotFoundError();
      if (current.origin === 'loja') {
        throw new OrderConflictError('Store orders are locked', 'ORDER_LOCKED');
      }
      if (current.version !== options.expectedVersion) {
        throw new OrderConflictError(
          `Expected order version ${options.expectedVersion}, current version is ${current.version}`,
        );
      }
      const next = { ...change(clone(current)), version: current.version + 1 };
      this.#orders.set(orderId, next);
      this.#record(next, eventType, options.correlationId);
      return clone(next);
    });
  }

  /**
   * The events this repository would have published, oldest first. The
   * PostgreSQL adapter writes the same stream to `crm.domain_events`.
   *
   * @param {string} orderId
   * @returns {RecordedOrderEvent[]}
   */
  eventsFor(orderId) {
    return this.#events
      .filter((event) => event.payload.orderId === orderId)
      .map(clone);
  }
}
