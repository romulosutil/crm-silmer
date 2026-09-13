import { OrderInputError } from '../domain/errors.js';
import { ORDER_STATUSES } from '../domain/order.js';

/**
 * @typedef {import('../domain/order.js').Order} Order
 * @typedef {import('../domain/order.js').OrderStatus} OrderStatus
 * @typedef {import('../domain/ficha.js').Ficha} Ficha
 *
 * @typedef {{
 *   id: string, conversationId: string, fabCode: string, ficha: Ficha,
 *   totalPieces: number, missingFields: string[],
 *   createdByKind: 'automation'|'user', createdBy: string|null,
 *   correlationId: string, now: Date,
 * }} CreatePendingOrderInput
 *
 * @typedef {{expectedVersion: number, correlationId: string}} OrderWriteOptions
 *
 * A search matches orders by exact number OR by conversation; with neither,
 * every order matches. Customer and phone search resolve to conversations
 * outside this port, so no personal data is ever queried in the clear.
 * @typedef {{
 *   status?: OrderStatus, numberSequence?: number, conversationIds?: string[],
 *   cursor?: string|null, limit: number,
 * }} OrderListQuery
 *
 * @typedef {{
 *   items: Order[], nextCursor: string|null,
 *   counts: {pendente: number, confirmado: number},
 * }} OrderPage
 *
 * Every write bumps `version` by one, refuses a stale `expectedVersion` with
 * VERSION_CONFLICT and appends an identifier-only `order.*` domain event in
 * the same unit of work. Only one pending order may exist per conversation.
 *
 * - `saveSection`/`projectBriefing` write the ficha and its derived columns
 *   (`totalPieces`, `missingFields`, `updatedAt`) of a pending order only.
 * - `saveStatus` writes the confirmation/reopen columns of the order.
 *
 * @typedef {{
 *   createPending(input: CreatePendingOrderInput): Promise<Order>,
 *   findById(orderId: string): Promise<Order|null>,
 *   findPendingByConversation(conversationId: string): Promise<Order|null>,
 *   listByConversation(conversationId: string): Promise<Order[]>,
 *   list(query: OrderListQuery): Promise<OrderPage>,
 *   saveSection(order: Order, options: OrderWriteOptions): Promise<Order>,
 *   saveStatus(order: Order, options: OrderWriteOptions): Promise<Order>,
 *   projectBriefing(order: Order, options: OrderWriteOptions): Promise<Order>,
 * }} OrderRepository
 */

export const ORDER_REPOSITORY_METHODS = Object.freeze([
  'createPending',
  'findById',
  'findPendingByConversation',
  'listByConversation',
  'list',
  'saveSection',
  'saveStatus',
  'projectBriefing',
]);

export const MAX_ORDER_PAGE_SIZE = 100;

/** @param {unknown} repository @returns {asserts repository is OrderRepository} */
export function assertOrderRepositoryContract(repository) {
  if (repository === null || typeof repository !== 'object') {
    throw new TypeError('order repository is required');
  }
  const candidate = /** @type {Record<string, unknown>} */ (repository);
  for (const method of ORDER_REPOSITORY_METHODS) {
    if (typeof candidate[method] !== 'function') {
      throw new TypeError(`order repository must implement ${method}`);
    }
  }
}

/**
 * Validates the parts of a list query both adapters interpret identically.
 *
 * @param {OrderListQuery} query
 * @returns {{status: OrderStatus|undefined, numberSequence: number|undefined, conversationIds: string[]|undefined, after: {updatedAt: string, id: string}|null, limit: number}}
 */
export function readOrderListQuery(query) {
  const { conversationIds, cursor, limit, numberSequence, status } = query;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_ORDER_PAGE_SIZE
  ) {
    throw new OrderInputError('limit is invalid', ['limit']);
  }
  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    throw new OrderInputError('status is invalid', ['status']);
  }
  if (
    numberSequence !== undefined &&
    (!Number.isSafeInteger(numberSequence) || numberSequence <= 0)
  ) {
    throw new OrderInputError('number is invalid', ['q']);
  }
  if (
    conversationIds !== undefined &&
    (!Array.isArray(conversationIds) ||
      conversationIds.some((id) => typeof id !== 'string'))
  ) {
    throw new TypeError('conversationIds must be a list of ids');
  }
  return {
    after:
      cursor === undefined || cursor === null ? null : decodeCursor(cursor),
    conversationIds,
    limit,
    numberSequence,
    status,
  };
}

/** @param {{updatedAt: string, id: string}} order */
export function encodeOrderCursor(order) {
  return Buffer.from(
    JSON.stringify([order.updatedAt, order.id]),
    'utf8',
  ).toString('base64url');
}

/** @param {unknown} cursor */
function decodeCursor(cursor) {
  try {
    if (typeof cursor !== 'string') throw new Error('cursor');
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[1] !== 'string' ||
      typeof decoded[0] !== 'string' ||
      Number.isNaN(Date.parse(decoded[0]))
    ) {
      throw new Error('cursor');
    }
    return { id: decoded[1], updatedAt: new Date(decoded[0]).toISOString() };
  } catch {
    throw new OrderInputError('cursor is invalid', ['cursor']);
  }
}

/** @param {OrderStatus} status */
export function statusEventType(status) {
  return status === 'confirmado' ? 'order.confirmed' : 'order.reopened';
}
