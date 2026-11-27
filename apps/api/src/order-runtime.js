import { createHash } from 'node:crypto';

import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import { authorize, CAPABILITIES } from '@crm-silmer/identity-access';
import {
  createIdempotentCommandExecutor,
  PostgresIdempotencyRecordStore,
} from '@crm-silmer/integration-reliability';
import {
  createOrderFileService,
  createOrderService,
  orderAmounts,
  isCutMapOrder,
  isOpenProductionOrder,
  projectOrderReceipt,
  parseFreightCents,
  readFreightCommand,
  sizePricingSummary,
  createStoreOrderCorrectionService,
  ORDER_FILE_LIMITS,
  ORDER_ITEM_OPTIONS,
  ORDER_ITEM_OPTION_ALIASES,
  parseOrderItemOption,
  OrderConflictError,
  OrderForbiddenError,
  OrderInputError,
  OrderNotFoundError,
  PostgresOrderConversationPort,
  PostgresOrderFileRepository,
  PostgresOrderRepository,
  StoreOrderError,
  STORE_ACTOR_ID,
  STORE_ACTOR_NAME,
} from '@crm-silmer/orders';

import { createFreightQuoteReader } from './shipping-runtime.js';
import { lockConversationAccess } from '@crm-silmer/inbox-channels';

/**
 * @typedef {{
 *   authorizeRead(input: Record<string, unknown>): Promise<{actor: any}>,
 *   authorizeWrite(input: Record<string, unknown>): Promise<{actor: any}>,
 * }} OrderAccess
 * @typedef {{
 *   readAssignment(conversationId: string): Promise<{assignedUserId: string|null, version: number}|null>,
 *   readAssignments(conversationIds: string[]): Promise<Map<string, string|null>>,
 *   readVisibleConversationIds(conversationIds: string[], actor: any): Promise<Set<string>>,
 *   readLatestMessageStates(conversationIds: string[]): Promise<Map<string, {direction: string, occurredAt: string, sentAt: string|null, deliveryStatus: string|null, status: string}>>,
 *   readOrderContexts(conversationIds: string[]): Promise<Map<string, any>>,
 *   readContactNames?(contactIds: string[]): Promise<Map<string, string|null>>,
 *   readCurrentContactIds?(contactIds: string[]): Promise<Map<string, string>>,
 *   readUserNames(userIds: string[]): Promise<Map<string, string|null>>,
 *   searchConversationIds(query: string): Promise<string[]>,
 *   searchContactIds?(query: string): Promise<string[]>,
 *   listAssignedOrderConversationIds?(userId: string): Promise<string[]>,
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
 *   idempotencyStore: {execute: (identity: any, operation: (transaction?: unknown) => Promise<unknown>, beforeExecute?: (transaction?: unknown) => Promise<unknown>) => Promise<unknown>},
 *   repository: any,
 *   files?: {repository: any, storage: any},
 *   freightQuotes?: {resolve: Function, selected: Function, notice?: Function},
 *   freightNoticeDatabase?: {query: Function},
 *   phoneDigestsFor?: (query: string) => string[],
 *   clock?: () => Date,
 *   idFactory?: () => string,
 *   withMilestoneTransaction?: (method:'confirmPayment'|'confirmDelivery'|'setProductionStage',input:any)=>Promise<any>,
 *   withCutMapTransaction?: (write:(transaction:any)=>Promise<void>)=>Promise<void>,
 *   withCreationTransaction?: (input:any)=>Promise<any>,
 *   subjectCreationAvailable?: (conversationId: string) => Promise<boolean>,
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
  for (const method of [
    'readAssignment',
    'readAssignments',
    'readVisibleConversationIds',
    'readLatestMessageStates',
    'readUserNames',
  ]) {
    if (typeof (/** @type {any} */ (conversations)?.[method]) !== 'function') {
      throw new TypeError(`the conversation port must implement ${method}`);
    }
  }
  const execute = createIdempotentCommandExecutor({
    auditTrail: options.auditTrail,
    idempotencyStore: options.idempotencyStore,
  });
  let pendingCutMap = Promise.resolve();
  let nextCutMapNumber = 0;
  /** @type {Map<string, {number: string, generatedAt: string, orderVersion: number}>} */
  const memoryCutMaps = new Map();
  /** @type {Map<string, {generatedAt: string, orders: {id:string, number:string}[], pdf: Buffer}>} */
  const memoryIssuedCutMaps = new Map();

  /** @param {string[]} ids @param {any} [transaction] */
  async function readCutMapMemberships(ids, transaction) {
    return options.repository.readCutMapMemberships
      ? options.repository.readCutMapMemberships(ids, transaction)
      : new Map(
          ids
            .filter((id) => memoryCutMaps.has(id))
            .map((id) => [id, memoryCutMaps.get(id)]),
        );
  }

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

  /** @param {OrderActor} actor @param {string} ownerId */
  async function ownManualOrder(actor, ownerId) {
    if (
      actor.kind !== 'human' ||
      !actor.id ||
      (actor.id !== ownerId &&
        !(actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN))
    ) {
      throw new OrderForbiddenError();
    }
  }

  /**
   * ADR 080 item 3: the responsible seller alone informs the freight. This is
   * deliberately not `ownConversation`/`ownManualOrder`: COMMERCIAL_ADMIN
   * opens nothing here, so an admin passes only as the conversation's current
   * owner or the manual order's owner. The repository repeats the check on
   * the locked rows and re-reads that the user is still an active Vendedor.
   *
   * @param {{actor: OrderActor, conversationId: string|null, ownerId: string|null}} input
   */
  async function responsibleSeller({ actor, conversationId, ownerId }) {
    if (actor.kind !== 'human' || !actor.id) throw new OrderForbiddenError();
    let responsibleId = ownerId;
    if (conversationId) {
      const assignment = await conversations.readAssignment(conversationId);
      if (!assignment) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      responsibleId = assignment.assignedUserId;
    }
    if (!responsibleId || responsibleId !== actor.id) {
      throw new OrderForbiddenError();
    }
  }

  const service = createOrderService({
    /** @param {{actor: OrderActor, conversationId: string}} input */
    async authorizeOwnership({ actor, conversationId }) {
      await ownConversation(actor, conversationId);
    },
    authorizeResponsibility: responsibleSeller,
    freightQuotes: /** @type {any} */ (options.freightQuotes),
    authorizeManualOwnership: async ({ actor, ownerId }) =>
      ownManualOrder(actor, ownerId),
    clock: options.clock,
    conversations,
    fabCode: options.fabCode,
    idFactory: options.idFactory,
    phoneDigestsFor: options.phoneDigestsFor,
    repository: options.repository,
  });

  const storeCorrection = createStoreOrderCorrectionService({
    repository: options.repository,
    clock: options.clock,
  });

  // ADR 023: without object storage the art files stay off and their routes
  // answer 503, while the rest of the order keeps working.
  const fileService = options.files
    ? createOrderFileService({
        async authorizeOwnership({ actor, order }) {
          if (order.conversationId) {
            await ownConversation(actor, order.conversationId);
          } else {
            if (!order.manualOwnerId) throw new OrderForbiddenError();
            await ownManualOrder(actor, order.manualOwnerId);
          }
        },
        clock: options.clock,
        files: options.files.repository,
        orders: options.repository,
        storage: options.files.storage,
      })
    : undefined;

  /**
   * Shapes stored orders into the public Order contract: people are named,
   * the seller is the conversation's current owner and internal columns
   * (sequence, creator) stay out of the response. ADR 027: a store order
   * has no conversation, so no seller or last message; "Loja do site"
   * confirmed it and it is `locked`. ADR 028: it carries the shop's number,
   * the lead time of its colour and the payment InfinitePay confirmed, with
   * the receipt link kept in its ficha.
   *
   * @param {any[]} orders @param {any} [actor]
   */
  async function present(orders, actor) {
    if (orders.length === 0) return [];
    // T12: commercial readers need the same cross-account freeze as writers.
    // Only booleans cross this boundary; no ERP identity or grant is exposed.
    const olistMetadata = options.repository.readOlistCommercialMetadata
      ? await options.repository.readOlistCommercialMetadata(orders)
      : new Map(
          [
            ...((await options.repository.readFrozenOrderIds?.(orders)) ?? []),
          ].map((id) => [id, { locked: true, confirmationAllowed: false }]),
        );
    const conversationIds = [
      ...new Set(
        orders
          .map((order) => order.conversationId)
          .filter((id) => typeof id === 'string'),
      ),
    ];
    const cutMemberships =
      actor?.kind === 'human'
        ? await readCutMapMemberships(orders.map((order) => order.id))
        : new Map();
    const visibleConversations =
      actor && conversationIds.length
        ? await conversations.readVisibleConversationIds(conversationIds, actor)
        : new Set(conversationIds);
    const [owners, latestMessageStates] =
      conversationIds.length === 0
        ? [new Map(), new Map()]
        : await Promise.all([
            conversations.readAssignments(conversationIds),
            conversations.readLatestMessageStates([...visibleConversations]),
          ]);
    const people = new Set();
    for (const order of orders) {
      for (const id of [
        order.confirmedBy,
        order.cancelledBy,
        order.reopenedBy,
        order.fichaFirstPrintedBy,
        owners.get(order.conversationId),
        order.manualOwnerId,
        order.freightSetBy,
      ]) {
        if (id && id !== STORE_ACTOR_ID) people.add(id);
      }
    }
    const names = await conversations.readUserNames([...people]);
    // PED-RD-09: a merged contact's orders keep the stored contact_id; only the
    // payload shows the surviving contact so "Ver cadastro" opens the full
    // record. Display only: commands and ACL read the stored column.
    const storedContactIds = [
      ...new Set(
        orders
          .map((order) => order.contactId)
          .filter((id) => typeof id === 'string'),
      ),
    ];
    const currentContactIds =
      storedContactIds.length && conversations.readCurrentContactIds
        ? await conversations.readCurrentContactIds(storedContactIds)
        : new Map();
    /** @param {string|null|undefined} id */
    const person = (id) => {
      if (!id) return null;
      if (id === STORE_ACTOR_ID) return { id, name: STORE_ACTOR_NAME };
      return { id, name: names.get(id) ?? '' };
    };
    return orders.map((order) => ({
      cancelledAt: order.cancelledAt ?? null,
      cancelledBy: person(order.cancelledBy),
      cancellationReason: order.cancellationReason ?? null,
      // ADR 080: pieces, freight and the single total the order is charged,
      // settled and counted by. `finalAmountCents` stays that same total.
      amounts: orderAmounts(order),
      effectiveStatus: order.cancelledAt ? 'cancelado' : order.status,
      receiptAvailable: Boolean(
        actor?.kind === 'human' &&
        actor.functionName === 'Vendedor' &&
        ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN) ||
          (order.origin !== 'loja' &&
            (order.manualOwnerId ?? owners.get(order.conversationId)) ===
              actor.id)),
      ),
      confirmedAt: order.confirmedAt,
      confirmedBy: person(order.confirmedBy),
      conversationId:
        !actor ||
        !order.conversationId ||
        visibleConversations.has(order.conversationId)
          ? order.conversationId
          : null,
      contactId:
        currentContactIds.get(order.contactId) ?? order.contactId ?? null,
      ...(order.originSubjectId
        ? {
            originSubjectId:
              !actor || visibleConversations.has(order.conversationId)
                ? order.originSubjectId
                : null,
          }
        : {}),
      createdAt: order.createdAt,
      deliveredOn: order.deliveredOn,
      fabCode: order.fabCode,
      ficha: order.ficha,
      ...(order.ficha.sizePricing === undefined && !order.legacySizePricing
        ? {}
        : {
            pricing: sizePricingSummary(
              order.legacySizePricing
                ? { ...order.ficha, sizePricing: order.legacySizePricing }
                : order.ficha,
            ),
          }),
      // ADR 031: who printed a store order's ficha first, and when.
      fichaFirstPrintedAt: order.fichaFirstPrintedAt ?? null,
      fichaFirstPrintedBy: person(order.fichaFirstPrintedBy),
      finalAmountCents: order.finalAmountCents,
      // ADR 080: the stored freight is the only source of the total; the
      // origin names who informed it and, when applied, which estimate.
      freight: {
        cents: orderAmounts(order).freightCents,
        pricingRule: order.pricingRule ?? 'pieces-v1',
        quoteId: order.freightQuoteId ?? null,
        quoteNotice: null,
        quotedCents: order.freightQuotedCents ?? null,
        serviceId: order.freightQuoteServiceId ?? null,
        setAt: order.freightSetAt ?? null,
        setBy: person(order.freightSetBy),
        source: order.freightSource ?? null,
      },
      firstContactAt: order.firstContactAt,
      gatewayPayment: order.gatewayPayment
        ? {
            ...order.gatewayPayment,
            receiptUrl: order.ficha?.loja?.comprovanteUrl ?? null,
          }
        : null,
      id: order.id,
      isTest: order.isTest === true,
      lastMessage:
        !actor || visibleConversations.has(order.conversationId)
          ? (latestMessageStates.get(order.conversationId) ?? null)
          : null,
      leadTimeBusinessDays: order.leadTimeBusinessDays ?? null,
      locked: order.origin === 'loja' || Boolean(order.cancelledAt),
      olistLocked: olistMetadata.get(order.id)?.locked === true,
      olistConfirmationAllowed:
        order.status === 'pendente' &&
        !order.cancelledAt &&
        olistMetadata.get(order.id)?.locked === true &&
        olistMetadata.get(order.id)?.confirmationAllowed === true,
      missingFields: order.missingFields,
      number: order.number,
      orderDate: order.orderDate,
      origin: order.origin ?? 'atendimento',
      paidOn: order.paidOn,
      paymentReviewRequired: order.paymentReviewRequired ?? false,
      paymentCondition: order.paymentCondition,
      productionStage: order.productionStage ?? null,
      productionEditable:
        isOpenProductionOrder(order) &&
        actor?.kind === 'human' &&
        ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN) ||
          (order.manualOwnerId ?? owners.get(order.conversationId)) ===
            actor.id),
      cutMapAvailable:
        isCutMapOrder(order) &&
        !cutMemberships.has(order.id) &&
        actor?.kind === 'human' &&
        ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN) ||
          (order.manualOwnerId ?? owners.get(order.conversationId)) ===
            actor.id),
      cutMap:
        actor?.kind === 'human' &&
        ((actor.capabilities ?? []).includes(CAPABILITIES.COMMERCIAL_ADMIN) ||
          (order.manualOwnerId ?? owners.get(order.conversationId)) ===
            actor.id)
          ? (cutMemberships.get(order.id) ?? null)
          : null,
      reopenedAt: order.reopenedAt,
      reopenedBy: person(order.reopenedBy),
      seller: person(order.manualOwnerId ?? owners.get(order.conversationId)),
      status: order.status,
      storeNumber: order.storeNumber ?? null,
      totalPieces: order.totalPieces,
      updatedAt: order.updatedAt,
      version: order.version,
    }));
  }

  /**
   * A single order also carries the estimate warning of ADR 080 item 6. It
   * is best effort and never a block: without the shipping configuration, on
   * a list or when it cannot be read, it stays null.
   *
   * @param {any} order @param {any} [actor]
   */
  async function presentOne(order, actor) {
    const [shown] = await present([order], actor);
    const quotes = options.freightQuotes;
    if (
      typeof quotes?.notice === 'function' &&
      options.freightNoticeDatabase &&
      order.status === 'pendente' &&
      !order.cancelledAt &&
      order.origin !== 'loja' &&
      order.ficha.sizePricing !== undefined
    ) {
      try {
        shown.freight.quoteNotice = await quotes.notice(
          options.freightNoticeDatabase,
          {
            freightCents: shown.freight.cents,
            orderId: order.id,
            orderVersion: order.version,
            quoteId: shown.freight.quoteId,
            source: shown.freight.source,
          },
        );
      } catch {
        shown.freight.quoteNotice = null;
      }
    }
    return shown;
  }

  /**
   * The public OrderFiles contract: names of who uploaded, storage keys and
   * hashes kept inside the API.
   *
   * @param {{final: any, references: any[]}} files
   */
  async function presentFiles(files) {
    const all = [files.final, ...files.references].filter(Boolean);
    const names = await conversations.readUserNames([
      ...new Set(all.map((file) => file.uploadedBy)),
    ]);
    /** @param {any} file */
    const one = (file) =>
      file && {
        contentType: file.contentType,
        extension: file.extension,
        id: file.id,
        name: file.name,
        sizeBytes: file.sizeBytes,
        slot: file.slot,
        thumbnail: file.thumbnailKey !== null,
        uploadedAt: file.uploadedAt,
        uploadedBy: {
          id: file.uploadedBy,
          name: names.get(file.uploadedBy) ?? '',
        },
      };
    return {
      final: one(files.final),
      limits: ORDER_FILE_LIMITS,
      references: files.references.map(one),
    };
  }

  function requireFiles() {
    if (!fileService) {
      throw Object.assign(new Error('Order files are not configured'), {
        code: 'FILE_STORAGE_UNAVAILABLE',
        statusCode: 503,
      });
    }
    return fileService;
  }

  /**
   * @template T
   * @param {OrderCommand} input
   * @param {{action: string, target: {type: string, id: string}, expectedVersion: unknown, command: unknown}} request
   * @param {(transaction?: unknown) => Promise<T>} effect
   * @param {(transaction?: unknown) => Promise<unknown>} [beforeExecute]
   * @returns {Promise<T>}
   */
  function run(input, request, effect, beforeExecute) {
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
        beforeExecute,
      )
    );
  }

  /** @param {string[]} ids @param {OrderActor} actor @param {any} [transaction] */
  async function getCutMap(ids, actor, transaction) {
    const map = await service.cutMap(ids, actor, transaction);
    const memberships = await readCutMapMemberships(ids, transaction);
    if (memberships.size) {
      throw Object.assign(
        new OrderConflictError(
          'Order already belongs to a cut map',
          'CUT_MAP_ALREADY_GENERATED',
        ),
        { orderIds: [...memberships.keys()] },
      );
    }
    return map;
  }

  return Object.freeze({
    async listItemOptions() {
      const catalog = structuredClone(ORDER_ITEM_OPTIONS);
      const rows = /** @type {{kind: unknown, label: string}[]} */ (
        await options.repository.listItemOptions()
      );
      for (const { kind, label } of rows) {
        if (kind === 'color' || kind === 'fabric' || kind === 'size')
          catalog[kind].push(label);
      }
      return { catalog, aliases: ORDER_ITEM_OPTION_ALIASES };
    },

    /** @param {OrderCommand & {orderId:string, kind:unknown, label:unknown}} input */
    async addItemOption(input) {
      const option = parseOrderItemOption(input.kind, input.label);
      return run(
        input,
        {
          action: 'order.item_option.add',
          command: { kind: option.kind, label: option.label },
          expectedVersion: 1,
          target: { type: 'order', id: input.orderId },
        },
        async (transaction) => ({
          kind: option.kind,
          label: await options.repository.addItemOption(option, transaction),
        }),
        (transaction) =>
          options.repository.authorizeItemOption(input, transaction),
      );
    },

    /** @param {OrderCommand & {orderId:string, expectedVersion:number, reason:unknown}} input */
    async cancel(input) {
      await service.assertCancellationAccess(input);
      if (
        typeof input.reason !== 'string' ||
        !input.reason.trim() ||
        input.reason.trim().length > 1000 ||
        /[\u0000-\u001f\u007f]/u.test(input.reason)
      )
        throw new OrderInputError('A cancellation reason is required', [
          'reason',
        ]);
      const command = {
        ...input,
        expectedVersion: requireVersion(input.expectedVersion),
        reason: input.reason.trim(),
      };
      return run(
        command,
        {
          action: 'order.cancel',
          command: { reason: command.reason },
          expectedVersion: command.expectedVersion,
          target: { type: 'order', id: command.orderId },
        },
        async (transaction) =>
          presentOne(await service.cancel(command, transaction)),
        async (transaction) =>
          options.repository.assertCancellationAccess(command, transaction),
      );
    },
    /** @param {OrderCommand & {orderId: string, expectedVersion: number, expectedQuantity: number, expectedAmountCents: number, quantity: number, reason: string}} input */
    async correctStoreOrder(input) {
      if (
        input.actor?.kind !== 'human' ||
        !(input.actor.capabilities ?? []).includes(
          CAPABILITIES.COMMERCIAL_ADMIN,
        )
      )
        throw new OrderForbiddenError();
      if (input.reason !== 'USER_CONFIRMED_QUANTITY')
        throw new StoreOrderError(400, 'INVALID_CORRECTION_REASON');
      for (const value of [
        input.expectedQuantity,
        input.expectedAmountCents,
        input.quantity,
      ]) {
        if (!Number.isSafeInteger(value) || value < 1)
          throw new StoreOrderError(400, 'INVALID_REQUEST');
      }
      const expectedVersion = requireVersion(input.expectedVersion);
      return run(
        input,
        {
          action: 'order.store.correct',
          command: {
            expectedQuantity: input.expectedQuantity,
            expectedAmountCents: input.expectedAmountCents,
            quantity: input.quantity,
            reason: input.reason,
          },
          expectedVersion,
          target: { type: 'order', id: input.orderId },
        },
        async () => presentOne(await storeCorrection.correct(input)),
      );
    },
    authorizeRead: access.authorizeRead,
    authorizeWrite: access.authorizeWrite,
    getCutMap,
    portfolioOverview: service.portfolioOverview,
    async reserveCutMapNumber() {
      if (options.repository.reserveCutMapNumber)
        return options.repository.reserveCutMapNumber();
      nextCutMapNumber += 1;
      return String(nextCutMapNumber);
    },
    /** @param {string} number @param {OrderActor} actor @param {boolean} includePdf */
    async getIssuedCutMap(number, actor, includePdf) {
      if (actor?.kind !== 'human' || !actor.id) throw new OrderForbiddenError();
      if (options.repository.readIssuedCutMap)
        return options.repository.readIssuedCutMap(number, actor, includePdf);
      const saved = memoryIssuedCutMaps.get(number);
      if (!saved) return null;
      try {
        for (const { id } of saved.orders)
          await service.getForReceipt(id, actor);
      } catch (error) {
        if (
          error instanceof OrderForbiddenError ||
          error instanceof OrderNotFoundError
        )
          return null;
        throw error;
      }
      return {
        number,
        generatedAt: saved.generatedAt,
        orders: saved.orders.map((order) => order.number),
        pdfAvailable: true,
        pdf: includePdf ? saved.pdf : null,
      };
    },
    /** @param {Awaited<ReturnType<typeof getCutMap>>} map @param {OrderActor} actor @param {string} correlationId @param {string} number @param {Buffer} pdf */
    async recordCutMapDownload(map, actor, correlationId, number, pdf) {
      /** @param {any} [transaction] */
      const append = async (transaction) => {
        const ids = map.orders.map(({ id }) => id);
        if (transaction)
          await options.repository.lockCutMapOrders(ids, transaction);
        const current = await getCutMap(ids, actor, transaction);
        if (JSON.stringify(current) !== JSON.stringify(map))
          throw new OrderConflictError('Cut map changed', 'CUT_MAP_STALE');
        if (transaction)
          await options.repository.insertCutMap(
            map.orders,
            number,
            pdf,
            transaction,
          );
        for (const order of map.orders) {
          await options.auditTrail.append(
            {
              action: 'order.cut_map.download',
              actor: actor.id,
              correlationId,
              reason: 'order.cut_map.download',
              target: { type: 'order', id: order.id },
              version: order.version,
            },
            transaction ? { transaction } : undefined,
          );
        }
        if (!transaction) {
          const generatedAt = (options.clock?.() ?? new Date()).toISOString();
          memoryIssuedCutMaps.set(number, {
            generatedAt,
            orders: map.orders,
            pdf,
          });
          for (const { id, version } of map.orders)
            memoryCutMaps.set(id, {
              number,
              generatedAt,
              orderVersion: version,
            });
        }
      };
      if (options.withCutMapTransaction) {
        await options.withCutMapTransaction(append);
      } else {
        const write = pendingCutMap.then(() => append());
        pendingCutMap = write.catch(() => {});
        await write;
      }
    },
    /** RCP-04/08: authorize before projecting any commercial document data.
     * @param {string} orderId @param {OrderActor} actor */
    async getReceipt(orderId, actor) {
      const raw = await service.getForReceipt(orderId, actor);
      const [order] = await present([raw], actor);
      return projectOrderReceipt(
        {
          ...order,
          ficha: raw.legacySizePricing
            ? { ...raw.ficha, sizePricing: raw.legacySizePricing }
            : raw.ficha,
        },
        { issuedAt: options.clock?.() ?? new Date() },
      );
    },
    /** RCP-10: called only after a successful render and final access check.
     * @param {{actor:OrderActor,orderId:string,version:number,correlationId:string}} input */
    async recordReceiptDownload(input) {
      await options.auditTrail.append({
        action: 'order.receipt.download',
        actor: input.actor.id,
        correlationId: input.correlationId,
        reason: 'order.receipt.download',
        target: { id: input.orderId, type: 'order' },
        version: input.version,
      });
    },
    ensurePendingFromIntent: service.ensurePendingFromIntent,
    projectAgentBriefing: service.projectAgentBriefing,
    commercialResult: service.commercialResult,
    /** @param {{period?: unknown}} [input] @param {any} [actor] */
    summary: (input, actor) => service.summary(input, actor),

    /**
     * PCL-10/PCL-11 behind the conversation version the seller saw; an
     * existing pending order is answered with `created: false`.
     *
     * @param {OrderCommand & {conversationId: string, expectedVersion: number, subjectId?: string, expectedSubjectVersion?: number, implicitSubjectTarget?: boolean}} input
     */
    async createManual(input) {
      const expectedVersion = requireVersion(input.expectedVersion);
      if (
        (input.subjectId !== undefined) !==
        (input.expectedSubjectVersion !== undefined)
      )
        throw new OrderInputError(
          'subjectId and expectedSubjectVersion are required together',
        );
      if (input.subjectId !== undefined) {
        if (typeof input.subjectId !== 'string' || !input.subjectId.trim())
          throw new OrderInputError('subjectId is required');
        requireVersion(input.expectedSubjectVersion);
      }
      if (options.withCreationTransaction)
        return options.withCreationTransaction(input);
      return run(
        input,
        {
          action: 'order.create',
          command: {
            conversationId: input.conversationId,
            expectedVersion,
            ...(input.subjectId === undefined
              ? {}
              : {
                  subjectId: input.subjectId,
                  expectedSubjectVersion: input.expectedSubjectVersion,
                }),
          },
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

    /** CP-03: an attendance order whose contact is known but chat is absent. */
    /** @param {OrderCommand & {contactId: string}} input */
    async createForContact(input) {
      return run(
        input,
        {
          action: 'order.create',
          command: { contactId: input.contactId },
          expectedVersion: 'new',
          target: { id: input.contactId, type: 'contact' },
        },
        async () => presentOne(await service.createForContact(input)),
      );
    },

    /** @param {string} orderId @param {any} [actor] */
    priceBreakdown: (orderId, actor) => service.priceBreakdown(orderId, actor),
    /** @param {OrderCommand & {orderId: string, value: unknown, expectedVersion: number}} input */
    async savePriceBreakdown(input) {
      await service.assertPriceBreakdownAccess(input);
      return run(
        input,
        {
          action: 'order.price_breakdown.edit',
          command: input.value,
          expectedVersion: requireVersion(input.expectedVersion),
          target: { type: 'order', id: input.orderId },
        },
        (transaction) => service.savePriceBreakdown(input, transaction),
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

    /** @param {OrderCommand & {orderId: string, amountText?: unknown, paymentCondition: unknown, expectedVersion: number}} input */
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

    /**
     * ADR 080 (OLC-05h/i): the responsible seller informs the freight or
     * applies the selected estimate. The fingerprint carries the value or the
     * estimate's identities, so a retry replays and another body is refused;
     * the audit keeps ids, action and version only. Responsibility is checked
     * before a replay too.
     *
     * @param {OrderCommand & {orderId: string, expectedVersion: number, freightCents?: unknown, quote?: unknown}} input
     */
    async setFreight(input) {
      await service.assertFreightAccess(input);
      const form = readFreightCommand(input);
      // A value that is not exact integer cents is refused (422) before any
      // idempotency record or audit exists; the service judges it again.
      if ('freightCents' in form) parseFreightCents(form.freightCents);
      return run(
        input,
        {
          action: 'order.freight',
          command: form,
          expectedVersion: requireVersion(input.expectedVersion),
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.setFreight(input)),
        async () => service.assertFreightAccess(input),
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

    /** @param {OrderCommand & {orderId: string, paidOn: unknown, deliveredOn?: unknown, paymentReviewed?:boolean, expectedVersion: number}} input */
    async recordMilestones(input) {
      return run(
        input,
        {
          action: 'order.milestones',
          command: {
            ...(Object.hasOwn(input, 'deliveredOn')
              ? { deliveredOn: input.deliveredOn }
              : {}),
            paidOn: input.paidOn,
            paymentReviewed: input.paymentReviewed === true,
          },
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.recordMilestones(input)),
      );
    },

    /** @param {{actor: OrderActor}} input */
    async deliveryTasks(input) {
      return { items: await present(await service.deliveryTasks(input)) };
    },

    /** @param {OrderCommand & {orderId:string,paidOn:unknown,receivedInFull:unknown,expectedVersion:number}} input */
    async confirmPayment(input) {
      if (options.withMilestoneTransaction)
        return options.withMilestoneTransaction('confirmPayment', input);
      return run(
        input,
        {
          action: 'order.payment.confirm',
          command: {
            paidOn: input.paidOn,
            receivedInFull: input.receivedInFull,
          },
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.confirmPayment(input)),
      );
    },

    /** @param {OrderCommand & {orderId: string, deliveredOn?: string, expectedVersion: number}} input */
    async confirmDelivery(input) {
      if (options.withMilestoneTransaction)
        return options.withMilestoneTransaction('confirmDelivery', input);
      return run(
        input,
        {
          action: 'order.delivery.confirm',
          command: Object.hasOwn(input, 'deliveredOn')
            ? { deliveredOn: input.deliveredOn }
            : {},
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentOne(await service.confirmDelivery(input)),
      );
    },
    /** @param {OrderCommand & Parameters<typeof service.setProductionStage>[0]} input */
    async setProductionStage(input) {
      if (options.withMilestoneTransaction)
        return options.withMilestoneTransaction('setProductionStage', input);
      return run(
        input,
        {
          action: 'order.production_stage.set',
          command: { stage: input.stage },
          expectedVersion: input.expectedVersion,
          target: { id: input.orderId, type: 'order' },
        },
        async () =>
          presentOne(await service.setProductionStage(input), input.actor),
      );
    },

    /** @param {string} orderId @param {any} [actor] */
    async listFiles(orderId, actor) {
      return presentFiles(await requireFiles().list(orderId, actor));
    },

    /** @param {string} orderId @param {OrderActor} actor */
    async findFinalArtwork(orderId, actor) {
      return (await requireFiles().list(orderId, actor)).final;
    },

    /**
     * ADR 023: the command fingerprint carries the content hashes, so a
     * retry with the same key and bytes replays the first answer and other
     * bytes under that key are refused.
     *
     * @param {OrderCommand & {orderId: string, slot: unknown, name: unknown, content: Buffer, thumbnail: Buffer|null}} input
     */
    async uploadFile(input) {
      const files = requireFiles();
      const contentSha256 = sha256Hex(input.content);
      return run(
        input,
        {
          action: 'order.file.upload',
          command: {
            contentSha256,
            name: typeof input.name === 'string' ? input.name : null,
            slot: typeof input.slot === 'string' ? input.slot : null,
            thumbnailSha256: input.thumbnail
              ? sha256Hex(input.thumbnail)
              : null,
          },
          expectedVersion: contentSha256,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentFiles((await files.upload(input)).files),
      );
    },

    /** @param {OrderCommand & {orderId: string, fileId: string}} input */
    async removeFile(input) {
      const files = requireFiles();
      return run(
        input,
        {
          action: 'order.file.remove',
          command: { fileId: input.fileId, orderId: input.orderId },
          expectedVersion: input.fileId,
          target: { id: input.orderId, type: 'order' },
        },
        async () => presentFiles((await files.remove(input)).files),
      );
    },

    /**
     * A download is audited like a command (who read which file), without
     * an idempotency record: reading twice is harmless.
     *
     * @param {{actor: OrderActor, correlationId: string, orderId: string, fileId: string}} input
     */
    async openFileContent(input) {
      const opened = await requireFiles().openContent(
        input.orderId,
        input.fileId,
        input.actor,
      );
      try {
        await options.auditTrail.append({
          action: 'order.file.download',
          actor: input.actor.id,
          correlationId: input.correlationId,
          reason: 'order.file.download',
          target: { id: input.orderId, type: 'order' },
          version: input.fileId,
        });
      } catch (error) {
        opened.stream.destroy();
        throw error;
      }
      return opened;
    },

    /** @param {string} orderId @param {string} fileId @param {any} [actor] */
    async openFileThumbnail(orderId, fileId, actor) {
      return requireFiles().openThumbnail(orderId, fileId, actor);
    },

    /**
     * ADR 031: the print route calls this before it sends a store order's
     * ficha. Reading twice is harmless, so there is no idempotency record;
     * the repository writes the first print, its event and its audit in one
     * transaction and ignores every later one.
     *
     * @param {{actor: OrderActor, correlationId: string, orderId: string}} input
     */
    async recordFirstPrint(input) {
      const { recorded } = await service.recordFirstPrint(input);
      return { recorded };
    },

    /** @param {string} orderId @param {any} [actor] */
    async get(orderId, actor) {
      return {
        order: await presentOne(await service.get(orderId, actor), actor),
      };
    },

    /** @param {Parameters<typeof service.list>[0]} [filters] @param {any} [actor] */
    async list(filters, actor) {
      const page = await service.list(filters, {
        actorId: actor?.id,
        readAll: actor?.capabilities?.includes('COMMERCIAL_ADMIN'),
      });
      return {
        counts: page.counts,
        items: await present(page.items, actor),
        nextCursor: page.nextCursor,
      };
    },

    /**
     * The pending order, else the latest confirmed one, else null; a
     * conversation that does not exist is a 404 rather than "no order".
     *
     * @param {string} conversationId @param {any} [actor]
     */
    async currentForConversation(conversationId, actor) {
      const assignment = await conversations.readAssignment(conversationId);
      if (
        !assignment ||
        !actor ||
        !(
          await conversations.readVisibleConversationIds(
            [conversationId],
            actor,
          )
        ).has(conversationId)
      ) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      const order = await service.currentForConversation(conversationId);
      // WAP-E11: tells the Inbox whether this conversation's responsible
      // seller may create by Subject now; only then does it ask for one.
      const targeting = options.subjectCreationAvailable
        ? {
            subjectCreationAvailable:
              await options.subjectCreationAvailable(conversationId),
          }
        : {};
      if (order) return { order: await presentOne(order, actor), ...targeting };
      if (!(await conversations.readAssignment(conversationId))) {
        throw new OrderNotFoundError(
          'Conversation was not found',
          'CONVERSATION_NOT_FOUND',
        );
      }
      return { order: null, ...targeting };
    },
  });
}

/** @param {Buffer} content */
function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
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
 * @param {{access: OrderAccess, environment?: Record<string, string|undefined>, storage?: any, phoneDigestsFor?: (query: string) => string[], milestoneTransactions?:boolean, creationTransactions?:boolean}} options
 */
export function createOrderApiRuntime(database, options) {
  const environment = options.environment ?? process.env;
  const envelopeKey = readEnvelopeKey(
    environment.N8N_INTEGRATION_ENVELOPE_KEY,
    'N8N_INTEGRATION_ENVELOPE_KEY',
  );
  /**
   * WAP-T02a: creation by Subject needs every gate (both literal flags, the
   * responsible seller in the private allowlist) and the 0081 indexes. Any
   * miss means "not available", never an error by itself.
   *
   * @param {{query: Function}} queryable @param {string|null|undefined} responsibleId
   */
  async function subjectCreationAvailable(queryable, responsibleId) {
    const allowed = (environment.ORDER_SUBJECT_SELLER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      environment.ORDER_SUBJECT_CREATION_ENABLED !== 'true' ||
      environment.ORDER_SUBJECT_READERS_READY !== 'true' ||
      !responsibleId ||
      !allowed.includes(responsibleId)
    )
      return false;
    const schema = (
      await queryable.query(
        "SELECT to_regclass('crm.orders_one_pending_per_subject') IS NOT NULL AND to_regclass('crm.orders_one_pending_per_legacy_conversation') IS NOT NULL AND to_regclass('crm.orders_one_pending_per_conversation') IS NULL AS ready",
      )
    ).rows[0];
    return schema?.ready === true;
  }
  return createOrderRuntime({
    // Advisory for the Inbox; the creation transaction decides again.
    subjectCreationAvailable: async (/** @type {string} */ conversationId) => {
      const row = (
        await database.query(
          `SELECT conversation.assigned_user_id,line.seller_id FROM crm.conversations conversation
           LEFT JOIN crm.seller_whatsapp_lines line ON line.account_id::text=conversation.provider_account_id
           WHERE conversation.id=$1`,
          [conversationId],
        )
      ).rows[0];
      return Boolean(
        row &&
        (await subjectCreationAvailable(
          database,
          row.seller_id ?? row.assigned_user_id,
        )),
      );
    },
    withCreationTransaction:
      options.creationTransactions === false
        ? undefined
        : (input) =>
            database.transaction(async (/** @type {any} */ tx) => {
              if (input.actor?.kind !== 'human' || !input.actor.id)
                throw new OrderForbiddenError();
              const personal = (
                await tx.query(
                  `SELECT line.seller_id FROM crm.conversations conversation
                 JOIN crm.seller_whatsapp_lines line ON line.account_id::text=conversation.provider_account_id
                 WHERE conversation.id=$1`,
                  [input.conversationId],
                )
              ).rows[0];
              // An Admin may execute for the responsible seller, whose active
              // status and portfolio still matter. Sort both locks first.
              const principals = await tx.query(
                'SELECT id,disabled_at FROM crm.users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
                [
                  [
                    ...new Set([
                      input.actor.id,
                      ...(personal ? [personal.seller_id] : []),
                    ]),
                  ],
                ],
              );
              // Same lock order as portfolio revocation/subject commands. This runs
              // before looking at the encrypted receipt, including on every replay.
              const access = await lockConversationAccess(
                tx,
                input.conversationId,
                input.actor.id,
              ).catch((error) => {
                if (error?.statusCode === 403) throw new OrderForbiddenError();
                throw error;
              });
              if ((personal?.seller_id ?? null) !== access.personalSellerId)
                throw new OrderConflictError('Line ownership changed');
              const role = (
                await tx.query(
                  'SELECT function_name FROM crm.user_functions WHERE user_id=$1 FOR SHARE',
                  [input.actor.id],
                )
              ).rows[0];
              const grants = await tx.query(
                'SELECT capability FROM crm.user_capabilities WHERE user_id=$1 FOR SHARE',
                [input.actor.id],
              );
              const actor = {
                id: input.actor.id,
                kind: /** @type {const} */ ('human'),
                functionName: role?.function_name,
                capabilities: grants.rows.map(
                  (/** @type {any} */ row) => row.capability,
                ),
              };
              authorize(actor, 'order.create');
              const conversation = (
                await tx.query(
                  'SELECT assigned_user_id,automation_state,terminal_at FROM crm.conversations WHERE id=$1 FOR UPDATE',
                  [input.conversationId],
                )
              ).rows[0];
              if (
                !conversation ||
                (conversation.assigned_user_id !== actor.id &&
                  !access.actor.isAdmin)
              )
                throw new OrderForbiddenError();
              if (personal) {
                const owner = principals.rows.find(
                  (/** @type {any} */ row) => row.id === personal.seller_id,
                );
                const eligible = (
                  await tx.query(
                    `SELECT 1 FROM crm.user_functions role
                   JOIN crm.seller_client_links link ON link.seller_id=role.user_id AND link.status='active'
                   JOIN crm.contact_identities identity ON identity.current_contact_id=link.contact_id
                   JOIN crm.conversations conversation ON conversation.contact_identity_id=identity.id
                   WHERE role.user_id=$1 AND role.function_name='Vendedor' AND conversation.id=$2
                   FOR SHARE OF role,link`,
                    [personal.seller_id, input.conversationId],
                  )
                ).rows[0];
                if (
                  !owner ||
                  owner.disabled_at ||
                  !eligible ||
                  conversation.assigned_user_id !== personal.seller_id
                )
                  throw new OrderForbiddenError();
              }
              if (conversation.terminal_at)
                throw new OrderConflictError(
                  'Conversation is closed',
                  'CONVERSATION_CLOSED',
                );
              if (conversation.automation_state !== 'human')
                throw new OrderConflictError(
                  'Human attendance is required',
                  'ORDER_HUMAN_REQUIRED',
                );
              const subjects = (
                await tx.query(
                  'SELECT id,order_id FROM crm.conversation_subjects WHERE conversation_id=$1 ORDER BY id FOR UPDATE',
                  [input.conversationId],
                )
              ).rows;
              if (
                input.subjectId !== undefined &&
                !subjects.some(
                  (/** @type {any} */ row) => row.id === input.subjectId,
                )
              )
                throw new OrderNotFoundError(
                  'Subject was not found',
                  'SUBJECT_NOT_FOUND',
                );
              // WAP-E11: targeted creation is a rollout, not a precondition
              // of the general line. With it off, a body without target keeps
              // master's legacy draft (origin NULL) whatever Subjects exist;
              // an explicit target or a personal line still fails closed.
              const targeted = await subjectCreationAvailable(
                tx,
                access.personalSellerId ?? conversation.assigned_user_id,
              );
              if (
                (input.subjectId !== undefined || access.personalSellerId) &&
                !targeted
              )
                throw new OrderConflictError(
                  'Subject creation is unavailable',
                  'ORDER_SUBJECT_UNAVAILABLE',
                );
              const bound = {
                query: tx.query.bind(tx),
                transaction: async (/** @type {any} */ work) => work(tx),
              };
              return createOrderApiRuntime(bound, {
                ...options,
                creationTransactions: false,
              }).createManual({
                ...input,
                actor,
                implicitSubjectTarget: targeted,
              });
            }),
    // ADR 080: the shipping estimates the freight command may apply. Without
    // the Melhor Envio configuration the reader refuses to apply an estimate
    // and informing a value keeps working.
    freightNoticeDatabase: database,
    freightQuotes: createFreightQuoteReader(environment),
    // ACT-12: these declarations and their encrypted receipts share one
    // transaction. Replays revalidate live access before opening the receipt.
    withMilestoneTransaction:
      options.milestoneTransactions === false
        ? undefined
        : (method, input) =>
            database.transaction(async (/** @type {any} */ client) => {
              if (input.actor?.kind !== 'human' || !input.actor.id)
                throw new OrderForbiddenError();
              const principal = (
                await client.query(
                  `SELECT u.id,f.function_name FROM crm.users u JOIN crm.user_functions f ON f.user_id=u.id WHERE u.id=$1 AND u.disabled_at IS NULL FOR SHARE OF u,f`,
                  [input.actor.id],
                )
              ).rows[0];
              if (!principal) throw new OrderForbiddenError();
              const grants = await client.query(
                'SELECT capability FROM crm.user_capabilities WHERE user_id=$1 FOR SHARE',
                [input.actor.id],
              );
              const actor = {
                id: input.actor.id,
                kind: /** @type {const} */ ('human'),
                functionName: principal.function_name,
                capabilities: grants.rows.map(
                  (/** @type {any} */ row) => row.capability,
                ),
              };
              authorize(actor, 'order.milestones');
              const reference = (
                await client.query(
                  'SELECT conversation_id FROM crm.orders WHERE id=$1',
                  [input.orderId],
                )
              ).rows[0];
              if (!reference) throw new OrderNotFoundError();
              let conversation;
              if (reference.conversation_id)
                conversation = (
                  await client.query(
                    'SELECT assigned_user_id FROM crm.conversations WHERE id=$1 FOR UPDATE',
                    [reference.conversation_id],
                  )
                ).rows[0];
              const current = (
                await client.query(
                  'SELECT conversation_id,manual_owner_id,origin,is_test,status FROM crm.orders WHERE id=$1 FOR UPDATE',
                  [input.orderId],
                )
              ).rows[0];
              if (
                !current ||
                current.conversation_id !== reference.conversation_id
              )
                throw new OrderNotFoundError();
              const owner = current.conversation_id
                ? conversation?.assigned_user_id
                : current.manual_owner_id;
              if (
                owner !== actor.id &&
                !actor.capabilities.includes(CAPABILITIES.COMMERCIAL_ADMIN)
              )
                throw new OrderForbiddenError();
              if (
                current.origin !== 'atendimento' ||
                current.is_test ||
                current.status !== 'confirmado'
              )
                throw new OrderConflictError(
                  'Only confirmed attendance orders support declarations',
                  'ORDER_STATUS_CONFLICT',
                );
              const bound = {
                query: client.query.bind(client),
                transaction: async (/** @type {any} */ work) => work(client),
              };
              return createOrderApiRuntime(bound, {
                ...options,
                milestoneTransactions: false,
              })[method]({ ...input, actor });
            }),
    withCutMapTransaction: (write) => database.transaction(write),
    access: options.access,
    auditTrail: new PostgresAuditTrail(database),
    conversations: new PostgresOrderConversationPort({
      contactEnvelopeKey: readEnvelopeKey(
        environment.CONTACT_IDENTITY_ENVELOPE_KEY,
        'CONTACT_IDENTITY_ENVELOPE_KEY',
      ),
      contactLookupKey: readEnvelopeKey(
        environment.CONTACT_IDENTITY_LOOKUP_KEY,
        'CONTACT_IDENTITY_LOOKUP_KEY',
      ),
      database,
      envelopeKey,
    }),
    fabCode: required(environment.FAB_CODE, 'FAB_CODE'),
    phoneDigestsFor: options.phoneDigestsFor,
    idempotencyStore: new PostgresIdempotencyRecordStore({
      database,
      envelopeKey: readEnvelopeKey(
        environment.IDEMPOTENCY_ENVELOPE_KEY,
        'IDEMPOTENCY_ENVELOPE_KEY',
      ),
    }),
    files: options.storage
      ? {
          repository: new PostgresOrderFileRepository({
            database,
            envelopeKey,
          }),
          storage: options.storage,
        }
      : undefined,
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
