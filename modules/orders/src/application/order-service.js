import { randomUUID } from 'node:crypto';

import { OrderForbiddenError, OrderNotFoundError } from '../domain/errors.js';
import {
  briefingToFicha,
  orderTotal,
  projectBriefingOntoFicha,
} from '../domain/ficha.js';
import { missingForConfirmation } from '../domain/order.js';
import { assertOrderRepositoryContract } from '../ports/contracts.js';

/**
 * @typedef {import('../domain/order.js').Order} Order
 * @typedef {import('../domain/ficha.js').Ficha} Ficha
 * @typedef {{id: string, kind: string, capabilities?: readonly string[]}} OrderActor
 * @typedef {{briefing: Record<string, unknown>|null, customerName: string|null}} OrderConversationContext
 * @typedef {{
 *   repository: import('../ports/contracts.js').OrderRepository,
 *   conversations: {readOrderContext(conversationId: string): Promise<OrderConversationContext|null>},
 *   authorizeOwnership(input: {actor: OrderActor, conversationId: string}): Promise<void>,
 *   fabCode: string,
 *   clock?: () => Date,
 *   idFactory?: () => string,
 * }} OrderServiceOptions
 */

/** @param {unknown} value @param {string} name */
function requireId(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

/**
 * Keeps the columns the list reads without decrypting in step with the ficha.
 *
 * @template {Pick<Order, 'ficha'|'status'|'finalAmountCents'|'paymentCondition'>} T
 * @param {T} order
 * @returns {T & {totalPieces: number, missingFields: string[]}}
 */
function withDerivedFields(order) {
  return {
    ...order,
    missingFields: missingForConfirmation(order),
    totalPieces: orderTotal(order.ficha.items),
  };
}

/**
 * Application service for the Pedido (ADR 006). The conversation context and
 * the ownership rule are injected: the service decides what happens to an
 * order, the API runtime decides who owns the conversation.
 *
 * @param {OrderServiceOptions} options
 */
export function createOrderService(options) {
  const { authorizeOwnership, conversations, fabCode, repository } = options;
  assertOrderRepositoryContract(repository);
  if (typeof conversations?.readOrderContext !== 'function') {
    throw new TypeError('a conversation context port is required');
  }
  if (typeof authorizeOwnership !== 'function') {
    throw new TypeError('an ownership check is required');
  }
  requireId(fabCode, 'fabCode');
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  /** @param {OrderActor} actor @param {string} conversationId */
  async function requireOwner(actor, conversationId) {
    if (
      actor?.kind !== 'human' ||
      typeof actor.id !== 'string' ||
      actor.id === ''
    ) {
      throw new OrderForbiddenError('A human actor is required');
    }
    await authorizeOwnership({ actor, conversationId });
  }

  /**
   * @param {{conversationId: string, correlationId: string, createdByKind: 'automation'|'user', createdBy: string|null}} input
   * @returns {Promise<{created: boolean, order: Order}>}
   */
  async function ensurePending(input) {
    const existing = await repository.findPendingByConversation(
      input.conversationId,
    );
    if (existing) return { created: false, order: existing };

    const context = await conversations.readOrderContext(input.conversationId);
    if (!context) {
      throw new OrderNotFoundError(
        'Conversation was not found',
        'CONVERSATION_NOT_FOUND',
      );
    }
    const ficha = briefingToFicha(context.briefing);
    if (context.customerName) ficha.summary.cliente = context.customerName;
    const derived = withDerivedFields({
      finalAmountCents: null,
      ficha,
      paymentCondition: null,
      status: /** @type {const} */ ('pendente'),
    });
    try {
      const order = await repository.createPending({
        conversationId: input.conversationId,
        correlationId: input.correlationId,
        createdBy: input.createdBy,
        createdByKind: input.createdByKind,
        fabCode,
        ficha,
        id: idFactory(),
        missingFields: derived.missingFields,
        now: clock(),
        totalPieces: derived.totalPieces,
      });
      return { created: true, order };
    } catch (error) {
      // Two intents raced; the one that lost reuses the winner's order.
      if (/** @type {any} */ (error)?.code !== 'ORDER_PENDING_EXISTS') {
        throw error;
      }
      const winner = await repository.findPendingByConversation(
        input.conversationId,
      );
      if (!winner) throw error;
      return { created: false, order: winner };
    }
  }

  return Object.freeze({
    /**
     * PCL-01..03: idempotent — a pending order is reused, a conversation with
     * only confirmed orders gets a new one.
     *
     * @param {{conversationId: string, correlationId: string}} input
     */
    async ensurePendingFromIntent(input) {
      return ensurePending({
        conversationId: requireId(input.conversationId, 'conversationId'),
        correlationId: requireId(input.correlationId, 'correlationId'),
        createdBy: null,
        createdByKind: 'automation',
      });
    },

    /**
     * PCL-10/PCL-11: the owner or an admin creates the order the agent never
     * detected; an existing pending order is returned instead.
     *
     * @param {{conversationId: string, correlationId: string, actor: OrderActor}} input
     */
    async createManual(input) {
      const conversationId = requireId(input.conversationId, 'conversationId');
      await requireOwner(input.actor, conversationId);
      return ensurePending({
        conversationId,
        correlationId: requireId(input.correlationId, 'correlationId'),
        createdBy: input.actor.id,
        createdByKind: 'user',
      });
    },

    /**
     * PAG-01/PAG-02: projects the merged pre-ficha into the pending order only
     * while the agent holds the conversation.
     *
     * @param {{conversationId: string, correlationId: string, briefing: Record<string, unknown>|null, automationState: string}} input
     * @returns {Promise<{applied: boolean, order: Order|null, reason: string|null}>}
     */
    async projectAgentBriefing(input) {
      const conversationId = requireId(input.conversationId, 'conversationId');
      const correlationId = requireId(input.correlationId, 'correlationId');
      if (input.automationState !== 'assistant') {
        return { applied: false, order: null, reason: 'human' };
      }
      const pending =
        await repository.findPendingByConversation(conversationId);
      if (!pending) {
        return { applied: false, order: null, reason: 'no_pending_order' };
      }
      const next = withDerivedFields({
        ...pending,
        ficha: projectBriefingOntoFicha(pending.ficha, input.briefing),
        updatedAt: clock().toISOString(),
      });
      const order = await repository.projectBriefing(next, {
        correlationId,
        expectedVersion: pending.version,
      });
      return { applied: true, order, reason: null };
    },
  });
}
