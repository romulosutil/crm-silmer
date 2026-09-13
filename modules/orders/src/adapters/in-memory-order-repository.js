import { OrderConflictError, OrderNotFoundError } from '../domain/errors.js';
import { formatOrderNumber } from '../domain/order.js';
import {
  encodeOrderCursor,
  readOrderListQuery,
  statusEventType,
} from '../ports/contracts.js';

/**
 * @typedef {import('../ports/contracts.js').Order} Order
 * @typedef {import('../ports/contracts.js').OrderWriteOptions} OrderWriteOptions
 * @typedef {{eventType: string, aggregateVersion: number, correlationId: string, occurredAt: string, payload: {orderId: string, conversationId: string}}} RecordedOrderEvent
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
        fabCode: input.fabCode,
        ficha: clone(input.ficha),
        finalAmountCents: null,
        id: input.id,
        missingFields: [...input.missingFields],
        number: formatOrderNumber(this.#sequence),
        numberSequence: this.#sequence,
        orderDate: null,
        paymentCondition: null,
        reopenedAt: null,
        reopenedBy: null,
        status: 'pendente',
        totalPieces: input.totalPieces,
        updatedAt: at,
        version: 1,
      };
      this.#orders.set(order.id, order);
      this.#record(order, 'order.created', input.correlationId);
      return clone(order);
    });
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
    const { after, conversationIds, limit, numberSequence, status } =
      readOrderListQuery(query);
    const scoped = [...this.#orders.values()].filter(
      (order) =>
        (numberSequence === undefined && conversationIds === undefined) ||
        order.numberSequence === numberSequence ||
        (conversationIds ?? []).includes(order.conversationId),
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
