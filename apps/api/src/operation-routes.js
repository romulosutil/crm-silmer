import { LiveEventDispatcher } from './live-event-dispatcher.js';

class OperationReadRequestError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'OperationReadRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @param {import('fastify').FastifyInstance} api
 * @param {Record<string, any>} operations
 * @param {(request: object) => {correlationId: string, requestId: string}} contextFor
 */
export function registerOperationRoutes(api, operations, contextFor) {
  const dispatcher = new LiveEventDispatcher(
    /** @type {{readLiveEvents: Function}} */ (operations),
  );
  let activeStreams = 0;

  api.get('/api/v1/events', async (request, reply) => {
    const query = requireObject(request.query ?? {});
    rejectUnknownKeys(query, ['after', 'topic']);
    if (query.topic !== undefined && query.topic !== 'inbox') {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
    }
    await authorizeRead(request, operations, 'deal.events.read');
    if (activeStreams >= 30) {
      reply.header('retry-after', '1');
      return reply.code(429).send({ error: { code: 'SSE_CAPACITY_EXCEEDED' } });
    }
    const headerCursor = request.headers['last-event-id'];
    const after = headerCursor ?? query.after ?? 0;
    reply.hijack();
    reply.raw.writeHead(200, {
      'cache-control': 'private, no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      vary: 'Origin, Cookie',
      'x-accel-buffering': 'no',
    });
    activeStreams += 1;
    let closed = false;
    /** @param {{cursor: number, payload: object, type: string}} event */
    const write = (event) => {
      if (closed || Number(event.cursor) <= Number(after)) return;
      reply.raw.write(
        `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
      );
    };
    const unsubscribe = dispatcher.subscribe(write);
    const heartbeat = globalThis.setInterval(() => {
      if (!closed) reply.raw.write(': heartbeat\n\n');
    }, 15_000);
    heartbeat.unref?.();
    const close = () => {
      if (closed) return;
      closed = true;
      activeStreams = Math.max(0, activeStreams - 1);
      globalThis.clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', close);
    reply.raw.on('close', close);
    reply.raw.write(': connected\n\n');
    return reply;
  });

  api.get('/api/v1/inbox/conversations', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query, [
        'assignedUserId',
        'archived',
        'automationState',
        'channel',
        'cursor',
        'limit',
        'state',
      ]);
      await authorizeRead(request, operations, 'conversation.read');
      privateReadHeaders(reply);
      return reply.code(200).send(await operations.listInbox(input));
    }),
  );

  api.get(
    '/api/v1/inbox/conversations/:conversationId',
    async (request, reply) =>
      respond(reply, async () => {
        const params = requireObject(request.params);
        await authorizeRead(request, operations, 'conversation.read');
        privateReadHeaders(reply);
        return reply.code(200).send(
          await operations.getConversation({
            conversationId: requireIdentifier(
              params.conversationId,
              'CONVERSATION_ID',
            ),
          }),
        );
      }),
  );

  api.get('/api/v1/inbox/handoffs', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query, ['cursor', 'limit']);
      await authorizeRead(request, operations, 'handoff.read');
      privateReadHeaders(reply);
      return reply.code(200).send(await operations.listOpenHandoffs(input));
    }),
  );

  api.get('/api/v1/contacts', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query, ['cursor', 'limit']);
      await authorizeRead(request, operations, 'contact.read');
      privateReadHeaders(reply);
      return reply.code(200).send(await operations.listContacts(input));
    }),
  );

  api.post('/api/v1/contacts/:contactId/name', async (request, reply) =>
    respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, ['displayName', 'expectedVersion', 'reason']);
      const principal = await operations.authorizeWrite({
        action: 'contact.rename',
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        csrfToken: request.headers['x-csrf-token'],
        origin: request.headers.origin,
      });
      const result = await operations.renameContact({
        actor: principal.actor,
        contactId: requireIdentifier(params.contactId, 'CONTACT_ID'),
        correlationId: contextFor(request).correlationId,
        displayName: body.displayName,
        expectedVersion: body.expectedVersion,
        reason: requireIdentifier(body.reason, 'REASON'),
      });
      privateReadHeaders(reply);
      return reply.code(200).send(result);
    }),
  );

  api.get('/api/v1/contacts/:contactId', async (request, reply) =>
    respond(reply, async () => {
      const params = requireObject(request.params);
      await authorizeRead(request, operations, 'contact.read');
      privateReadHeaders(reply);
      return reply.code(200).send(
        await operations.getContact({
          contactId: requireIdentifier(params.contactId, 'CONTACT_ID'),
        }),
      );
    }),
  );
}

/** @param {any} request @param {any} operations @param {string} action */
async function authorizeRead(request, operations, action) {
  return operations.authorizeRead({
    action,
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
  });
}

/** @param {unknown} value @param {string[]} allowed */
function parseListQuery(value, allowed) {
  const query = requireObject(value ?? {});
  rejectUnknownKeys(query, allowed);
  const parsed = /** @type {Record<string, any>} */ ({});
  for (const key of allowed) {
    if (query[key] === undefined) continue;
    if (key === 'limit') {
      if (
        typeof query[key] !== 'string' ||
        !/^[0-9]+$/u.test(query[key]) ||
        Number(query[key]) < 1 ||
        Number(query[key]) > 100
      ) {
        throw new OperationReadRequestError(400, 'INVALID_LIMIT');
      }
      parsed[key] = Number(query[key]);
      continue;
    }
    if (key === 'archived') {
      if (query[key] !== 'true' && query[key] !== 'false') {
        throw new OperationReadRequestError(400, 'INVALID_FILTER');
      }
      parsed[key] = query[key] === 'true';
      continue;
    }
    parsed[key] = requireIdentifier(
      query[key],
      key.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase(),
      key === 'cursor' ? 1024 : 512,
    );
  }
  return parsed;
}

/** @param {unknown} value */
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationReadRequestError(400, 'INVALID_REQUEST');
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
    throw new OperationReadRequestError(400, `INVALID_${field}`);
  }
  return value.trim();
}

/** @param {Record<string, unknown>} value @param {string[]} allowed */
function rejectUnknownKeys(value, allowed) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new OperationReadRequestError(400, 'INVALID_REQUEST');
  }
}

/** @param {import('fastify').FastifyReply} reply */
function privateReadHeaders(reply) {
  reply.header('cache-control', 'private, no-cache');
  reply.header('vary', 'Origin, Cookie');
}

/** @param {import('fastify').FastifyReply} reply @param {() => Promise<unknown>} operation */
async function respond(reply, operation) {
  try {
    return await operation();
  } catch (error) {
    const normalized = /** @type {{code?: unknown, statusCode?: unknown}} */ (
      error
    );
    const statusCode = Number(normalized?.statusCode);
    if (!Number.isSafeInteger(statusCode) || statusCode < 400) throw error;
    const publicStatus = statusCode >= 500 ? 503 : statusCode;
    const allowed = new Set([
      'CONTACT_CONFLICT',
      'CONTACT_NOT_FOUND',
      'CONVERSATION_NOT_FOUND',
      'FORBIDDEN',
      'INVALID_CURSOR',
      'INVALID_DISPLAY_NAME',
      'INVALID_FILTER',
      'INVALID_LIMIT',
      'INVALID_REQUEST',
    ]);
    const code =
      statusCode >= 500 || !allowed.has(String(normalized.code))
        ? statusCode >= 500
          ? 'SERVICE_UNAVAILABLE'
          : 'INVALID_REQUEST'
        : String(normalized.code);
    return reply.code(publicStatus).send({ error: { code } });
  }
}
