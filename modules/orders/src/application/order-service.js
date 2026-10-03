import { randomUUID } from 'node:crypto';

import {
  OrderConflictError,
  OrderForbiddenError,
  OrderInputError,
  OrderNotFoundError,
} from '../domain/errors.js';
import {
  briefingToFicha,
  normalizeFicha,
  orderClient,
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
  recordMilestones,
  reopenOrder,
} from '../domain/order.js';
import { assertOrderRepositoryContract } from '../ports/contracts.js';

/**
 * `openedAt` is when the first inbound message opened the conversation.
 *
 * @typedef {import('../domain/order.js').Order} Order
 * @typedef {import('../domain/ficha.js').Ficha} Ficha
 * @typedef {{id: string, kind: string, capabilities?: readonly string[]}} OrderActor
 * @typedef {{briefing: Record<string, unknown>|null, customerName: string|null, openedAt?: string|null}} OrderConversationContext
 * @typedef {{
 *   repository: import('../ports/contracts.js').OrderRepository,
 *   conversations: {
 *     readOrderContexts(conversationIds: string[]): Promise<Map<string, OrderConversationContext>>,
 *     searchConversationIds(query: string): Promise<string[]>,
 *   },
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
export const DEFAULT_ORDER_PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 120;
const LIST_KEYS = new Set(['status', 'q', 'cursor', 'limit']);
// "12", "012" or "12-CRM" name order 12; anything else is a customer search.
const ORDER_NUMBER_QUERY = /^0*(\d{1,15})(?:-crm)?$/iu;

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
 * ADR 016: an order as the current rules read it. A ficha stored before the
 * seven-point item gets its new fields blank, and what is missing is worked
 * out again, so an order saved under the old rule never shows the old list.
 *
 * @param {Order} order
 * @returns {Order}
 */
function current(order) {
  return withDerivedFields({ ...order, ficha: normalizeFicha(order.ficha) });
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
  if (
    typeof conversations?.readOrderContexts !== 'function' ||
    typeof conversations.searchConversationIds !== 'function'
  ) {
    throw new TypeError('a conversation context port is required');
  }
  if (typeof authorizeOwnership !== 'function') {
    throw new TypeError('an ownership check is required');
  }
  requireId(fabCode, 'fabCode');
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  /**
   * PCT-01 (ADR 018): a pending order reads its client from its conversation
   * again (PIT-11: the contact's confirmed name, else the bot's
   * `customer_name`, else blank), so renaming the contact reaches it without
   * writing the order: its version and the time it last changed stay as they
   * were. A confirmed order keeps the client written when it was generated
   * (PCT-02). One query covers every pending order handed in.
   *
   * @param {Order[]} orders
   * @returns {Promise<Order[]>}
   */
  async function withCurrentClient(orders) {
    const pendingConversations = [
      ...new Set(
        orders
          .filter((order) => order.status === 'pendente')
          .map((order) => order.conversationId),
      ),
    ];
    if (pendingConversations.length === 0) return orders;
    const contexts =
      await conversations.readOrderContexts(pendingConversations);
    return orders.map((order) => {
      const context = contexts.get(order.conversationId);
      if (order.status !== 'pendente' || !context) return order;
      return {
        ...order,
        ficha: {
          ...order.ficha,
          summary: { ...order.ficha.summary, cliente: orderClient(context) },
        },
      };
    });
  }

  /**
   * Orders as people see them: under the current rules, with the current
   * client.
   *
   * @param {Order[]} orders
   */
  async function readAll(orders) {
    return (await withCurrentClient(orders)).map(current);
  }

  /** @param {Order} order */
  async function readOne(order) {
    const [read] = await readAll([order]);
    return read;
  }

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
    // A command works on the client the order shows now, so saving a
    // section writes it and generating keeps it (ADR 018).
    return readOne(order);
  }

  /**
   * @param {{conversationId: string, correlationId: string, createdByKind: 'automation'|'user', createdBy: string|null}} input
   * @returns {Promise<{created: boolean, order: Order}>}
   */
  async function ensurePending(input) {
    const existing = await repository.findPendingByConversation(
      input.conversationId,
    );
    if (existing) return { created: false, order: await readOne(existing) };

    const context = (
      await conversations.readOrderContexts([input.conversationId])
    ).get(input.conversationId);
    if (!context) {
      throw new OrderNotFoundError(
        'Conversation was not found',
        'CONVERSATION_NOT_FOUND',
      );
    }
    const ficha = briefingToFicha(context.briefing);
    ficha.summary.cliente = orderClient(context);
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
        // ADR 008: the order keeps when its conversation began.
        firstContactAt: context.openedAt ?? null,
        id: idFactory(),
        missingFields: derived.missingFields,
        now: clock(),
        totalPieces: derived.totalPieces,
      });
      return { created: true, order: current(order) };
    } catch (error) {
      // Two intents raced; the one that lost reuses the winner's order.
      if (/** @type {any} */ (error)?.code !== 'ORDER_PENDING_EXISTS') {
        throw error;
      }
      const winner = await repository.findPendingByConversation(
        input.conversationId,
      );
      if (!winner) throw error;
      return { created: false, order: await readOne(winner) };
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
      // The projection writes the client the order shows now (ADR 018).
      const [shown] = await withCurrentClient([pending]);
      const next = withDerivedFields({
        ...shown,
        ficha: projectBriefingOntoFicha(shown.ficha, input.briefing),
        updatedAt: clock().toISOString(),
      });
      const order = await repository.projectBriefing(next, {
        correlationId,
        expectedVersion: pending.version,
      });
      return { applied: true, order: current(order), reason: null };
    },

    /** @param {string} orderId */
    async get(orderId) {
      const order = await repository.findById(requireId(orderId, 'orderId'));
      if (!order) throw new OrderNotFoundError();
      return readOne(order);
    },

    /**
     * PLI-02..07: status filter, number/customer/phone search and "Ver mais"
     * pages. Counts cover the search regardless of the status filter, so both
     * groups keep their totals while one is selected.
     *
     * @param {{status?: string, q?: string, cursor?: string|null, limit?: number}} [input]
     */
    async list(input = {}) {
      for (const key of Object.keys(input)) {
        if (!LIST_KEYS.has(key)) {
          throw new OrderInputError(`${key} is not allowed`, [key]);
        }
      }
      if (input.q !== undefined && typeof input.q !== 'string') {
        throw new OrderInputError('q must be text', ['q']);
      }
      const q = (input.q ?? '').trim();
      if (q.length > MAX_QUERY_LENGTH) {
        throw new OrderInputError('q is too long', ['q']);
      }
      /** @type {import('../ports/contracts.js').OrderListQuery} */
      const query = {
        cursor: input.cursor ?? null,
        limit: input.limit ?? DEFAULT_ORDER_PAGE_SIZE,
        status: /** @type {any} */ (input.status),
      };
      if (q !== '') {
        const number = ORDER_NUMBER_QUERY.exec(q);
        if (number && Number(number[1]) > 0) {
          query.numberSequence = Number(number[1]);
        }
        query.conversationIds = await conversations.searchConversationIds(q);
      }
      const page = await repository.list(query);
      return { ...page, items: await readAll(page.items) };
    },

    /**
     * PCX-06/PCX-07: what the conversation drawer shows — the pending order,
     * otherwise the most recently confirmed one.
     *
     * @param {string} conversationId
     * @returns {Promise<Order|null>}
     */
    async currentForConversation(conversationId) {
      const orders = await repository.listByConversation(
        requireId(conversationId, 'conversationId'),
      );
      const pending = orders.find((order) => order.status === 'pendente');
      if (pending) return readOne(pending);
      const confirmed = orders
        .filter((order) => order.status === 'confirmado')
        .sort((left, right) =>
          String(right.confirmedAt).localeCompare(String(left.confirmedAt)),
        )[0];
      return confirmed ? readOne(confirmed) : null;
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
      return current(
        await repository.saveSection(
          withDerivedFields({
            ...order,
            ficha,
            updatedAt: clock().toISOString(),
          }),
          {
            correlationId: input.correlationId,
            expectedVersion: order.version,
          },
        ),
      );
    },

    /**
     * PCL-04..06: a blank amount counts as missing (reported with the other
     * blockers); a malformed one is refused as INVALID_AMOUNT. The ficha is
     * written with the status, so the order keeps the client it showed when
     * it was generated, on screen and on paper (PCT-02, ADR 018).
     *
     * @param {{orderId: string, amountText: unknown, paymentCondition: unknown, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async confirm(input) {
      const order = await loadForCommand(input);
      const amountCents =
        typeof input.amountText === 'string' && input.amountText.trim() !== ''
          ? parseBrlAmount(input.amountText)
          : 0;
      return current(
        await repository.saveStatus(
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
        ),
      );
    },

    /**
     * PCL-07: back to pending, keeping number, amount and condition. Pending
     * again, the order follows the contact's name again (PCT-03).
     *
     * @param {{orderId: string, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async reopen(input) {
      const order = await loadForCommand(input);
      return readOne(
        await repository.saveStatus(
          reopenOrder(order, { actorId: input.actor.id, now: clock() }),
          {
            correlationId: input.correlationId,
            expectedVersion: order.version,
          },
        ),
      );
    },

    /**
     * PLA-04/PLA-05: the owner or an admin records when the customer paid and
     * when the order was delivered, in either status; both days travel in one
     * write and null clears one.
     *
     * @param {{orderId: string, paidOn: unknown, deliveredOn: unknown, expectedVersion: number, actor: OrderActor, correlationId: string}} input
     */
    async recordMilestones(input) {
      const order = await loadForCommand(input);
      return readOne(
        await repository.saveMilestones(
          recordMilestones(order, {
            deliveredOn: input.deliveredOn,
            now: clock(),
            paidOn: input.paidOn,
          }),
          {
            correlationId: input.correlationId,
            expectedVersion: order.version,
          },
        ),
      );
    },
  });
}
