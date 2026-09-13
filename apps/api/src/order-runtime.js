import { CAPABILITIES } from '@crm-silmer/identity-access';
import {
  createOrderService,
  OrderForbiddenError,
  OrderNotFoundError,
  PostgresOrderConversationPort,
  PostgresOrderRepository,
} from '@crm-silmer/orders';

/**
 * @typedef {{
 *   authorizeRead(input: Record<string, unknown>): Promise<{actor: any}>,
 *   authorizeWrite(input: Record<string, unknown>): Promise<{actor: any}>,
 * }} OrderAccess
 * @typedef {{
 *   readAssignment(conversationId: string): Promise<{assignedUserId: string|null}|null>,
 *   readAssignments(conversationIds: string[]): Promise<Map<string, string|null>>,
 *   readOrderContext(conversationId: string): Promise<any>,
 *   readUserNames(userIds: string[]): Promise<Map<string, string|null>>,
 *   searchConversationIds(query: string): Promise<string[]>,
 * }} OrderConversationPort
 */

/**
 * Composes the order service with the ownership rule of ADR 006: only the
 * conversation owner or a COMMERCIAL_ADMIN changes an order. The owner is read
 * from the conversation on every command, so "Repassar atendimento" moves the
 * order with the conversation and there is no separate order ownership.
 *
 * @param {{
 *   access: OrderAccess,
 *   conversations: OrderConversationPort,
 *   fabCode: string,
 *   repository: any,
 *   clock?: () => Date,
 *   idFactory?: () => string,
 * }} options
 */
export function createOrderRuntime(options) {
  const { access, conversations } = options;
  if (
    typeof access?.authorizeRead !== 'function' ||
    typeof access.authorizeWrite !== 'function'
  ) {
    throw new TypeError('order access guards are required');
  }
  for (const method of ['readAssignment', 'readAssignments', 'readUserNames']) {
    if (typeof (/** @type {any} */ (conversations)?.[method]) !== 'function') {
      throw new TypeError(`the conversation port must implement ${method}`);
    }
  }

  const service = createOrderService({
    /** @param {{actor: {id: string, capabilities?: readonly string[]}, conversationId: string}} input */
    async authorizeOwnership({ actor, conversationId }) {
      const assignment = await conversations.readAssignment(conversationId);
      if (!assignment) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      if ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN)) {
        return;
      }
      if (assignment.assignedUserId !== actor.id) {
        throw new OrderForbiddenError();
      }
    },
    clock: options.clock,
    conversations,
    fabCode: options.fabCode,
    idFactory: options.idFactory,
    repository: options.repository,
  });

  /**
   * Shapes stored orders into the public Order contract: people are named,
   * the seller is the conversation's current owner and internal columns
   * (sequence, creator) stay out of the response.
   *
   * @param {any[]} orders
   */
  async function present(orders) {
    if (orders.length === 0) return [];
    const owners = await conversations.readAssignments([
      ...new Set(orders.map((order) => order.conversationId)),
    ]);
    const people = new Set();
    for (const order of orders) {
      for (const id of [
        order.confirmedBy,
        order.reopenedBy,
        owners.get(order.conversationId),
      ]) {
        if (id) people.add(id);
      }
    }
    const names = await conversations.readUserNames([...people]);
    /** @param {string|null|undefined} id */
    const person = (id) => (id ? { id, name: names.get(id) ?? '' } : null);
    return orders.map((order) => ({
      confirmedAt: order.confirmedAt,
      confirmedBy: person(order.confirmedBy),
      conversationId: order.conversationId,
      createdAt: order.createdAt,
      fabCode: order.fabCode,
      ficha: order.ficha,
      finalAmountCents: order.finalAmountCents,
      id: order.id,
      missingFields: order.missingFields,
      number: order.number,
      orderDate: order.orderDate,
      paymentCondition: order.paymentCondition,
      reopenedAt: order.reopenedAt,
      reopenedBy: person(order.reopenedBy),
      seller: person(owners.get(order.conversationId)),
      status: order.status,
      totalPieces: order.totalPieces,
      updatedAt: order.updatedAt,
      version: order.version,
    }));
  }

  /** @param {any} order */
  async function presentOne(order) {
    return (await present([order]))[0];
  }

  return Object.freeze({
    authorizeRead: access.authorizeRead,
    authorizeWrite: access.authorizeWrite,
    confirm: service.confirm,
    createManual: service.createManual,
    ensurePendingFromIntent: service.ensurePendingFromIntent,
    patchSection: service.patchSection,
    reopen: service.reopen,

    /** @param {string} orderId */
    async get(orderId) {
      return { order: await presentOne(await service.get(orderId)) };
    },

    /** @param {Parameters<typeof service.list>[0]} [filters] */
    async list(filters) {
      const page = await service.list(filters);
      return {
        counts: page.counts,
        items: await present(page.items),
        nextCursor: page.nextCursor,
      };
    },

    /**
     * The pending order, else the latest confirmed one, else null; a
     * conversation that does not exist is a 404 rather than "no order".
     *
     * @param {string} conversationId
     */
    async currentForConversation(conversationId) {
      const order = await service.currentForConversation(conversationId);
      if (order) return { order: await presentOne(order) };
      if (!(await conversations.readAssignment(conversationId))) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      return { order: null };
    },
  });
}

/**
 * PostgreSQL wiring. The session guards come from the operation runtime so
 * order routes share the Inbox read (session) and write (session + CSRF) rules.
 *
 * @param {any} database
 * @param {{access: OrderAccess, environment?: Record<string, string|undefined>}} options
 */
export function createOrderApiRuntime(database, options) {
  const environment = options.environment ?? process.env;
  const envelopeKey = readEnvelopeKey(
    environment.N8N_INTEGRATION_ENVELOPE_KEY,
    'N8N_INTEGRATION_ENVELOPE_KEY',
  );
  return createOrderRuntime({
    access: options.access,
    conversations: new PostgresOrderConversationPort({
      contactEnvelopeKey: readEnvelopeKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      database,
      envelopeKey,
    }),
    fabCode: required(environment.FAB_CODE, 'FAB_CODE'),
    repository: new PostgresOrderRepository({ database, envelopeKey }),
  });
}

/** @param {string|undefined} value @param {string} name */
function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for the orders runtime`);
  }
  return value.trim();
}

/** @param {string|undefined} value @param {string} name */
function readEnvelopeKey(value, name) {
  const encoded = required(value, name);
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(encoded)) {
    throw new Error(`${name} must use base64 or base64url`);
  }
  const key = Buffer.from(
    encoded,
    encoded.includes('-') || encoded.includes('_') ? 'base64url' : 'base64',
  );
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}
