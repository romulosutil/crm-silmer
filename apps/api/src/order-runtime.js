import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { CAPABILITIES } from '@crm-silmer/identity-access';
import {
  createIdempotentCommandExecutor,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';
import {
  createOrderService,
  OrderConflictError,
  OrderForbiddenError,
  OrderInputError,
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
 *   readAssignment(conversationId: string): Promise<{assignedUserId: string|null, version: number}|null>,
 *   readAssignments(conversationIds: string[]): Promise<Map<string, string|null>>,
 *   readOrderContext(conversationId: string): Promise<any>,
 *   readUserNames(userIds: string[]): Promise<Map<string, string|null>>,
 *   searchConversationIds(query: string): Promise<string[]>,
 * }} OrderConversationPort
 * @typedef {{id: string, kind: string, capabilities?: readonly string[]}} OrderActor
 * @typedef {{actor: OrderActor, correlationId: string, idempotencyKey: string}} OrderCommand
 */

/**
 * Composes the order service with the ownership rule of ADR 006: only the
 * conversation owner or a COMMERCIAL_ADMIN changes an order. The owner is read
 * from the conversation on every command, so "Repassar atendimento" moves the
 * order with the conversation and there is no separate order ownership.
 *
 * Every human command runs under its Idempotency-Key: a retry with the same
 * key and body replays the first response, another body is refused. The
 * record and the audit event share one transaction, while the order write
 * commits in the repository's own transaction; if the process dies between
 * them the retry re-runs and the optimistic version turns it into a 409, so a
 * command never applies twice.
 *
 * @param {{
 *   access: OrderAccess,
 *   auditTrail: any,
 *   conversations: OrderConversationPort,
 *   fabCode: string,
 *   idempotencyStore: {execute: (identity: any, operation: (transaction?: unknown) => Promise<unknown>) => Promise<unknown>},
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
  const execute = createIdempotentCommandExecutor({
    auditTrail: options.auditTrail,
    idempotencyStore: options.idempotencyStore,
  });

  /** @param {OrderActor} actor @param {string} conversationId */
  async function ownConversation(actor, conversationId) {
    const assignment = await conversations.readAssignment(conversationId);
    if (!assignment) {
      throw new OrderNotFoundError(
        'Conversation was not found',
        'CONVERSATION_NOT_FOUND',
      );
    }
    if (
      !(actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN) &&
      assignment.assignedUserId !== actor.id
    ) {
      throw new OrderForbiddenError();
    }
    return assignment;
  }

  const service = createOrderService({
    /** @param {{actor: OrderActor, conversationId: string}} input */
    async authorizeOwnership({ actor, conversationId }) {
      await ownConversation(actor, conversationId);
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

  /**
   * @template T
   * @param {OrderCommand} input
   * @param {{action: string, target: {type: string, id: string}, expectedVersion: unknown, command: unknown}} request
   * @param {() => Promise<T>} effect
   * @returns {Promise<T>}
   */
  function run(input, request, effect) {
    return /** @type {Promise<T>} */ (
      execute(
        {
          action: request.action,
          actor: input.actor?.id,
          command: request.command,
          correlationId: input.correlationId,
          key: input.idempotencyKey,
          reason: request.action,
          target: request.target,
          version: String(request.expectedVersion),
        },
        effect,
      )
    );
  }

  return Object.freeze({
    authorizeRead: access.authorizeRead,
    authorizeWrite: access.authorizeWrite,
    ensurePendingFromIntent: service.ensurePendingFromIntent,
    projectAgentBriefing: service.projectAgentBriefing,

    /**
     * PCL-10/PCL-11 behind the conversation version the seller saw; an
     * existing pending order is answered with `created: false`.
     *
     * @param {OrderCommand & {conversationId: string, expectedVersion: number}} input
     */
    async createManual(input) {
      const expectedVersion = requireVersion(input.expectedVersion);
      return run(
        input,
        {
          action: 'order.create',
          command: { conversationId: input.conversationId, expectedVersion },
          expectedVersion,
          target: { id: input.conversationId, type: 'conversation' },
        },
        async () => {
          const assignment = await ownConversation(
            input.actor,
            input.conversationId,
          );
          if (Number(assignment.version) !== expectedVersion) {
            throw new OrderConflictError(
              `Expected conversation version ${expectedVersion}, current version is ${assignment.version}`,
            );
          }
          const result = await service.createManual(input);
          return {
            created: result.created,
            order: await presentOne(result.order),
          };
        },
      );
    },

    /** @param {OrderCommand & {orderId: string, section: string, value: unknown, expectedVersion: number}} input */
    async patchSection(input) {
      return run(
        input,
        {
          action: 'order.edit',
          command: { section: input.section, value: input.value },
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.patchSection(input)),
      );
    },

    /** @param {OrderCommand & {orderId: string, amountText: unknown, paymentCondition: unknown, expectedVersion: number}} input */
    async confirm(input) {
      return run(
        input,
        {
          action: 'order.confirm',
          // The fingerprint is canonical JSON, which has no undefined.
          command: {
            amountText: input.amountText ?? null,
            paymentCondition: input.paymentCondition ?? null,
          },
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.confirm(input)),
      );
    },

    /** @param {OrderCommand & {orderId: string, expectedVersion: number}} input */
    async reopen(input) {
      return run(
        input,
        {
          action: 'order.reopen',
          command: {},
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.reopen(input)),
      );
    },

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

/** @param {unknown} value */
function requireVersion(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new OrderInputError('expectedVersion is required', [
      'expectedVersion',
    ]);
  }
  return Number(value);
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
    auditTrail: new PostgresAuditTrail(database),
    conversations: new PostgresOrderConversationPort({
      contactEnvelopeKey: readEnvelopeKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      database,
      envelopeKey,
    }),
    fabCode: required(environment.FAB_CODE, 'FAB_CODE'),
    idempotencyStore: new PostgresIdempotencyRecordStore({
      database,
      envelopeKey: readEnvelopeKey(
        environment.IDEMPOTENCY_ENVELOPE_KEY,
        'IDEMPOTENCY_ENVELOPE_KEY',
      ),
    }),
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
