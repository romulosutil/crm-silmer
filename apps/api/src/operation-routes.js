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
 */
export function registerOperationRoutes(api, operations) {
  api.get('/api/v1/inbox/conversations', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query, [
        'assignedUserId',
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

  api.get('/api/v1/contacts', async (request, reply) =>
    respond(reply, async () => {
      const input = parseListQuery(request.query, ['cursor', 'limit']);
      await authorizeRead(request, operations, 'contact.read');
      privateReadHeaders(reply);
      return reply.code(200).send(await operations.listContacts(input));
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
      'CONTACT_NOT_FOUND',
      'CONVERSATION_NOT_FOUND',
      'FORBIDDEN',
      'INVALID_CURSOR',
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
