class DealRequestError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'DealRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @param {import('fastify').FastifyInstance} api
 * @param {Record<string, any>} deals
 * @param {(request: object) => {correlationId: string}} contextFor
 */
export function registerDealRoutes(api, deals, contextFor) {
  api.post(
    '/api/v1/conversations/:conversationId/convert',
    async (request, reply) => {
      return respond(reply, async () => {
        const params = requireObject(request.params);
        const body = requireObject(request.body);
        rejectUnknownKeys(body, [
          'automationEpoch',
          'expectedVersion',
          'reason',
        ]);
        const conversationId = requireString(
          params.conversationId,
          'CONVERSATION_ID',
        );
        const correlationId = contextFor(request).correlationId;
        const idempotencyKey = requireString(
          request.headers['idempotency-key'],
          'IDEMPOTENCY_KEY',
        );
        const principal = await deals.authorize({
          action: 'conversation.convert',
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          correlationId,
          csrfToken: request.headers['x-csrf-token'],
          origin: request.headers.origin,
        });
        const result = await deals.convertConversation({
          actor: principal.actor,
          ...(body.automationEpoch === undefined
            ? {}
            : {
                automationEpoch: requireAutomationEpoch(body.automationEpoch),
              }),
          conversationId,
          correlationId,
          expectedVersion: requireVersion(body.expectedVersion),
          idempotencyKey,
          reason: requireString(body.reason, 'REASON'),
        });
        reply.header('location', `/api/v1/deals/${result.deal.id}`);
        return reply.code(201).send(result);
      });
    },
  );
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
    if (statusCode >= 500 && statusCode < 600) {
      return reply
        .code(statusCode)
        .send({ error: { code: 'SERVICE_UNAVAILABLE' } });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: publicCode(error) },
      });
    }
    throw error;
  }
}

/** @param {any} error */
function publicCode(error) {
  const normalized = /** @type {{code?: unknown}} */ (error);
  const allowed = new Set([
    'DEAL_CONFLICT',
    'DEAL_FORBIDDEN',
    'DEAL_INVALID',
    'FORBIDDEN',
    'FORBIDDEN_AUTOMATION_ACTION',
    'IDEMPOTENCY_KEY_REUSED',
    'INVALID_AUTOMATION_CREDENTIALS',
    'INVALID_AUTOMATION_EPOCH',
    'INVALID_CONVERSATION_ID',
    'INVALID_EXPECTED_VERSION',
    'INVALID_IDEMPOTENCY_KEY',
    'INVALID_REASON',
    'INVALID_REQUEST',
  ]);
  return allowed.has(String(normalized?.code))
    ? String(normalized.code)
    : 'INVALID_REQUEST';
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DealRequestError(400, 'INVALID_REQUEST');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} field */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DealRequestError(400, `INVALID_${field}`);
  }
  return value.trim();
}

/** @param {unknown} value */
function requireVersion(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new DealRequestError(400, 'INVALID_EXPECTED_VERSION');
  }
  return value;
}

/** @param {unknown} value */
function requireAutomationEpoch(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new DealRequestError(400, 'INVALID_AUTOMATION_EPOCH');
  }
  return value;
}

/** @param {Record<string, unknown>} value @param {string[]} allowed */
function rejectUnknownKeys(value, allowed) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new DealRequestError(400, 'INVALID_REQUEST');
  }
}
