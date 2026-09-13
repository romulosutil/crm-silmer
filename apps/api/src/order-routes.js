const ORDER_STATUSES = new Set(['pendente', 'confirmado']);
const ORDER_SECTIONS = new Set(['summary', 'items', 'observations']);

/**
 * Codes an order route may return as they are. Anything else collapses to
 * INVALID_REQUEST (4xx) or SERVICE_UNAVAILABLE (5xx), so internal messages
 * and identifiers never reach the client.
 */
const PUBLIC_CODES = new Set([
  'CONVERSATION_NOT_FOUND',
  'FORBIDDEN',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_AMOUNT',
  'INVALID_GRADE',
  'ORDER_INVALID',
  'ORDER_NOT_CONFIRMABLE',
  'ORDER_NOT_FOUND',
  'ORDER_STATUS_CONFLICT',
  'VERSION_CONFLICT',
]);

class OrderRequestError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'OrderRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Order endpoints (ADR 006). Reads need an operational session; ownership is
 * enforced by the orders runtime on each command.
 *
 * @param {import('fastify').FastifyInstance} api
 * @param {Record<string, any>} orders
 * @param {(request: object) => {correlationId: string, requestId: string}} contextFor
 */
export function registerOrderRoutes(api, orders, contextFor) {
  api.get('/api/v1/orders', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query);
      await authorizeRead(request, orders);
      privateReadHeaders(reply);
      return reply.code(200).send(await orders.list(input));
    }),
  );

  api.get('/api/v1/orders/:orderId', async (request, reply) =>
    respond(reply, async () => {
      const params = requireObject(request.params);
      const orderId = requireIdentifier(params.orderId, 'ORDER_ID');
      await authorizeRead(request, orders);
      privateReadHeaders(reply);
      return reply.code(200).send(await orders.get(orderId));
    }),
  );

  api.get(
    '/api/v1/conversations/:conversationId/order',
    async (request, reply) =>
      respond(reply, async () => {
        const params = requireObject(request.params);
        const conversationId = requireIdentifier(
          params.conversationId,
          'CONVERSATION_ID',
        );
        await authorizeRead(request, orders);
        privateReadHeaders(reply);
        return reply
          .code(200)
          .send(await orders.currentForConversation(conversationId));
      }),
  );

  api.post(
    '/api/v1/conversations/:conversationId/orders',
    async (request, reply) =>
      respond(reply, async () => {
        const params = requireObject(request.params);
        const conversationId = requireIdentifier(
          params.conversationId,
          'CONVERSATION_ID',
        );
        const body = requireObject(request.body);
        rejectUnknownKeys(body, ['expectedVersion']);
        const expectedVersion = requireVersion(body.expectedVersion);
        const command = await authorizeCommand(
          request,
          orders,
          contextFor,
          'order.create',
        );
        const result = await orders.createManual({
          ...command,
          conversationId,
          expectedVersion,
        });
        return reply
          .code(result.created ? 201 : 200)
          .send({ order: result.order });
      }),
  );

  api.patch(
    '/api/v1/orders/:orderId/sections/:section',
    async (request, reply) =>
      respond(reply, async () => {
        const params = requireObject(request.params);
        const orderId = requireIdentifier(params.orderId, 'ORDER_ID');
        if (!ORDER_SECTIONS.has(params.section)) {
          throw new OrderRequestError(400, 'INVALID_SECTION');
        }
        const body = requireObject(request.body);
        rejectUnknownKeys(body, ['expectedVersion', 'value']);
        const expectedVersion = requireVersion(body.expectedVersion);
        if (!Object.hasOwn(body, 'value')) {
          throw new OrderRequestError(400, 'INVALID_REQUEST');
        }
        const command = await authorizeCommand(
          request,
          orders,
          contextFor,
          'order.edit',
        );
        const order = await orders.patchSection({
          ...command,
          expectedVersion,
          orderId,
          section: params.section,
          value: body.value,
        });
        return reply.code(200).send({ order });
      }),
  );

  api.post('/api/v1/orders/:orderId/confirm', async (request, reply) =>
    respond(reply, async () => {
      const params = requireObject(request.params);
      const orderId = requireIdentifier(params.orderId, 'ORDER_ID');
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'amountText',
        'expectedVersion',
        'paymentCondition',
      ]);
      const expectedVersion = requireVersion(body.expectedVersion);
      // A missing amount or condition is not malformed: the service answers
      // 422 ORDER_NOT_CONFIRMABLE naming it, next to the other blockers.
      for (const field of ['amountText', 'paymentCondition']) {
        if (body[field] !== undefined && typeof body[field] !== 'string') {
          throw new OrderRequestError(400, 'INVALID_REQUEST');
        }
      }
      const command = await authorizeCommand(
        request,
        orders,
        contextFor,
        'order.confirm',
      );
      const order = await orders.confirm({
        ...command,
        amountText: body.amountText,
        expectedVersion,
        orderId,
        paymentCondition: body.paymentCondition,
      });
      return reply.code(200).send({ order });
    }),
  );

  api.post('/api/v1/orders/:orderId/reopen', async (request, reply) =>
    respond(reply, async () => {
      const params = requireObject(request.params);
      const orderId = requireIdentifier(params.orderId, 'ORDER_ID');
      const body = requireObject(request.body);
      rejectUnknownKeys(body, ['expectedVersion']);
      const expectedVersion = requireVersion(body.expectedVersion);
      const command = await authorizeCommand(
        request,
        orders,
        contextFor,
        'order.reopen',
      );
      const order = await orders.reopen({
        ...command,
        expectedVersion,
        orderId,
      });
      return reply.code(200).send({ order });
    }),
  );
}

/**
 * Checks the Idempotency-Key before the session so a malformed retry is
 * refused without touching the identity store, then authorizes the action
 * with session and CSRF.
 *
 * @param {any} request @param {any} orders @param {Function} contextFor @param {string} action
 */
async function authorizeCommand(request, orders, contextFor, action) {
  const idempotencyKey = requireIdentifier(
    request.headers['idempotency-key'],
    'IDEMPOTENCY_KEY',
    255,
  );
  const principal = await orders.authorizeWrite({
    action,
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    csrfToken: request.headers['x-csrf-token'],
    origin: request.headers.origin,
  });
  return {
    actor: principal.actor,
    correlationId: contextFor(request).correlationId,
    idempotencyKey,
  };
}

/** @param {unknown} value */
function requireVersion(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new OrderRequestError(400, 'INVALID_EXPECTED_VERSION');
  }
  return Number(value);
}

/** @param {any} request @param {any} orders */
async function authorizeRead(request, orders) {
  return orders.authorizeRead({
    action: 'order.read',
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
  });
}

/** @param {unknown} value */
function parseListQuery(value) {
  const query = requireObject(value ?? {});
  rejectUnknownKeys(query, ['cursor', 'limit', 'q', 'status']);
  /** @type {{status?: string, q?: string, cursor?: string, limit?: number}} */
  const input = {};
  if (query.status !== undefined) {
    if (!ORDER_STATUSES.has(query.status)) {
      throw new OrderRequestError(400, 'INVALID_FILTER');
    }
    input.status = query.status;
  }
  if (query.q !== undefined) {
    input.q = requireIdentifier(query.q, 'QUERY', 128);
  }
  if (query.cursor !== undefined) {
    input.cursor = requireIdentifier(query.cursor, 'CURSOR', 1024);
  }
  if (query.limit !== undefined) {
    if (
      typeof query.limit !== 'string' ||
      !/^[0-9]{1,3}$/u.test(query.limit) ||
      Number(query.limit) < 1 ||
      Number(query.limit) > 100
    ) {
      throw new OrderRequestError(400, 'INVALID_LIMIT');
    }
    input.limit = Number(query.limit);
  }
  return input;
}

/** @param {unknown} value */
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrderRequestError(400, 'INVALID_REQUEST');
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} field @param {number} [limit] */
function requireIdentifier(value, field, limit = 512) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > limit ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new OrderRequestError(400, `INVALID_${field}`);
  }
  return value.trim();
}

/** @param {Record<string, unknown>} value @param {string[]} allowed */
function rejectUnknownKeys(value, allowed) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new OrderRequestError(400, 'INVALID_REQUEST');
  }
}

/** @param {import('fastify').FastifyReply} reply */
function privateReadHeaders(reply) {
  reply.header('cache-control', 'private, no-cache');
  reply.header('vary', 'Origin, Cookie');
}

/**
 * Maps domain and guard errors to the OrderError contract: `fields` and
 * `index` travel only with 422, where the page shows them next to the field.
 *
 * @param {import('fastify').FastifyReply} reply
 * @param {() => Promise<unknown>} operation
 */
async function respond(reply, operation) {
  try {
    return await operation();
  } catch (error) {
    const normalized =
      /** @type {{code?: unknown, statusCode?: unknown, fields?: unknown, index?: unknown}} */ (
        error
      );
    const statusCode = Number(normalized?.statusCode);
    if (!Number.isSafeInteger(statusCode) || statusCode < 400) throw error;
    if (statusCode >= 500) {
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE' } });
    }
    const code = String(normalized.code);
    /** @type {{code: string, fields?: string[], index?: number}} */
    const body = {
      code:
        PUBLIC_CODES.has(code) || /^INVALID_[A-Z_]+$/u.test(code)
          ? code
          : 'INVALID_REQUEST',
    };
    if (statusCode === 422 && Array.isArray(normalized.fields)) {
      body.fields = normalized.fields.map(String);
    }
    if (statusCode === 422 && Number.isSafeInteger(normalized.index)) {
      body.index = Number(normalized.index);
    }
    return reply.code(statusCode).send({ error: body });
  }
}
