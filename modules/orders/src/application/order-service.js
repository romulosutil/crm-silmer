import { randomUUID } from 'node:crypto';

import {
  OrderConflictError,
  OrderForbiddenError,
  OrderInputError,
  OrderNotFoundError,
} from '../domain/errors.js';
import {
  briefingToFicha,
  orderTotal,
  projectBriefingOntoFicha,
  validateItems,
  validateObservations,
  validateSummary,
} from '../domain/ficha.js';
import { parseBrlAmount } from '../domain/money.js';
import {
  confirmOrder,
  missingForConfirmation,
  reopenOrder,
} from '../domain/order.js';
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

export const ORDER_SECTIONS = Object.freeze(
  /** @type {const} */ (['summary', 'items', 'observations']),
);

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
   * Resolves and authorizes a human command on an existing order. Ownership
   * is checked before the version so a non-owner learns nothing about it; the
   * early version check keeps a stale screen from seeing a rule error that no
   * longer applies. The repository re-checks the version atomically.
   *
   * @param {{orderId: string, expectedVersion: number, actor: OrderActor, correlationId: string}} input
   */
  async function loadForCommand(input) {
    const orderId = requireId(input.orderId, 'orderId');
    requireId(input.correlationId, 'correlationId');
    if (!Number.isSafeInteger(input.expectedVersion)) {
      throw new OrderInputError('expectedVersion is required', [
        'expectedVersion',
      ]);
    }
    const order = await repository.findById(orderId);
    if (!order) throw new OrderNotFoundError();
    await requireOwner(input.actor, order.conversationId);
    if (order.version !== input.expectedVersion) {
      throw new OrderConflictError(
        `Expected order version ${input.expectedVersion}, current version is ${order.version}`,
      );
    }
    return order;
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

    /**
     * PFI-06: a section is saved whole; totals and what is missing follow.
     * A confirmed order must be reopened first (PFI-10).
     *
     * @param {{orderId: string, section: string, value: unknown, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async patchSection(input) {
      const section = /** @type {typeof ORDER_SECTIONS[number]} */ (
        input.section
      );
      if (!ORDER_SECTIONS.includes(section)) {
        throw new OrderInputError('section is invalid', ['section']);
      }
      const order = await loadForCommand(input);
      if (order.status !== 'pendente') {
        throw new OrderConflictError(
          'Reopen the order before editing it',
          'ORDER_STATUS_CONFLICT',
        );
      }
      const ficha = structuredClone(order.ficha);
      if (section === 'summary') {
        ficha.summary = {
          ...validateSummary(input.value),
          cliente: ficha.summary.cliente,
        };
      } else if (section === 'items') {
        ficha.items = validateItems(input.value);
      } else {
        ficha.observations = validateObservations(input.value);
      }
      return repository.saveSection(
        withDerivedFields({
          ...order,
          ficha,
          updatedAt: clock().toISOString(),
        }),
        {
          correlationId: input.correlationId,
          expectedVersion: order.version,
        },
      );
    },

    /**
     * PCL-04..06: a blank amount counts as missing (reported with the other
     * blockers); a malformed one is refused as INVALID_AMOUNT.
     *
     * @param {{orderId: string, amountText: unknown, paymentCondition: unknown, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async confirm(input) {
      const order = await loadForCommand(input);
      const amountCents =
        typeof input.amountText === 'string' && input.amountText.trim() !== ''
          ? parseBrlAmount(input.amountText)
          : 0;
      return repository.saveStatus(
        confirmOrder(order, {
          actorId: input.actor.id,
          amountCents,
          now: clock(),
          paymentCondition:
            /** @type {import('../domain/order.js').PaymentCondition} */ (
              input.paymentCondition
            ),
        }),
        {
          correlationId: input.correlationId,
          expectedVersion: order.version,
        },
      );
    },

    /**
     * PCL-07: back to pending, keeping number, amount and condition.
     *
     * @param {{orderId: string, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async reopen(input) {
      const order = await loadForCommand(input);
      return repository.saveStatus(
        reopenOrder(order, { actorId: input.actor.id, now: clock() }),
        {
          correlationId: input.correlationId,
          expectedVersion: order.version,
        },
      );
    },
  });
}
