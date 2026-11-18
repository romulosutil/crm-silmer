import rateLimit from '@fastify/rate-limit';

/** WAP-E10 public problem codes; anything else becomes a generic 503. */
const CODES = new Map([
  ['INVALID_REQUEST', 400],
  ['IDEMPOTENCY_KEY', 400],
  ['INVALID_SESSION', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['CONTACT_VERSION_CONFLICT', 409],
  ['WHATSAPP_GENERATION_STALE', 409],
  ['WHATSAPP_IDENTITY_CONFLICT', 409],
  ['CONVERSATION_UNAVAILABLE', 409],
  ['CONVERSATION_VERSION_CONFLICT', 409],
  ['IDEMPOTENCY_CONFLICT', 409],
  ['WHATSAPP_DESTINATION_INVALID', 422],
  ['RATE_LIMITED', 429],
  ['WHATSAPP_SEND_UNAVAILABLE', 503],
  ['SELLER_WHATSAPP_FIRST_SEND_DISABLED', 503],
]);
/** Internal codes from reused modules mapped to the public contract. */
const ALIASES = new Map([
  ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_CONFLICT'],
  ['IDEMPOTENCY_RECORD_PENDING', 'IDEMPOTENCY_CONFLICT'],
  ['CONTACT_NOT_FOUND', 'NOT_FOUND'],
  ['CSRF_INVALID', 'FORBIDDEN'],
]);
const BODY = [
  'text',
  'expectedContactVersion',
  'expectedLinkVersion',
  'expectedLineVersion',
  'expectedGeneration',
  'expectedConversation',
];

/** @param {string} [code] @param {number} [statusCode] */
const invalid = (code = 'INVALID_REQUEST', statusCode = 400) =>
  Object.assign(new Error(code), { code, statusCode });

/** @param {unknown} value */
function contactId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/u.test(value))
    throw invalid();
  return value;
}

/** @param {unknown} value */
function version(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid();
  return Number(value);
}

/** Required: null (no active conversation) or the previewed id/version.
 * @param {unknown} value */
function conversation(value) {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['id', 'version'].includes(key))
  )
    throw invalid();
  const { id, version: current } = /** @type {Record<string, unknown>} */ (
    value
  );
  if (typeof id !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/u.test(id))
    throw invalid();
  return { id, version: version(current) };
}

/** Strict body: destination, account, user or URL fields are refused.
 * @param {unknown} body */
export function readFirstSendBody(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !BODY.includes(key))
  )
    throw invalid();
  const value = /** @type {Record<string, unknown>} */ (body);
  if (typeof value.text !== 'string') throw invalid();
  const text = value.text.trim();
  if (!text.length || text.length > 2000 || text.includes('\u0000'))
    throw invalid();
  return {
    text,
    expectedContactVersion: version(value.expectedContactVersion),
    expectedLinkVersion: version(value.expectedLinkVersion),
    expectedLineVersion: version(value.expectedLineVersion),
    expectedGeneration: version(value.expectedGeneration),
    expectedConversation: conversation(value.expectedConversation),
  };
}

/** @param {unknown} value */
function idempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value))
    throw invalid('IDEMPOTENCY_KEY');
  return value;
}

/** WAP-E10. Registration is unconditional; absent runtime fails closed.
 * @param {import('fastify').FastifyInstance} api @param {any} service @param {Function} contextFor */
export function registerSellerWhatsAppFirstSendRoutes(
  api,
  service,
  contextFor,
) {
  api.register(async (scope) => {
    await scope.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => ({ statusCode: 429, code: 'RATE_LIMITED' }),
    });
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('vary', 'Cookie, Origin');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-content-type-options', 'nosniff');
    });
    scope.setErrorHandler((failure, _request, reply) => {
      const e = /** @type {any} */ (failure);
      const raw = typeof e.code === 'string' ? e.code : '';
      const aliased = ALIASES.get(raw) ?? raw;
      let code = CODES.has(aliased) ? aliased : 'SERVICE_UNAVAILABLE';
      if (e.statusCode === 413) code = 'INVALID_REQUEST';
      if (e.statusCode === 415 || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
        code = 'INVALID_REQUEST';
      if (
        e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
        e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
        e instanceof SyntaxError
      )
        code = 'INVALID_REQUEST';
      const status = CODES.get(code) ?? 503;
      return reply
        .code(status)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: code, status, code });
    });
    const limits = {
      bodyLimit: 8192,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    };
    /** @param {any} request @param {boolean} write */
    async function human(request, write) {
      if (!service) throw invalid('SELLER_WHATSAPP_FIRST_SEND_DISABLED', 503);
      if (request.headers.authorization !== undefined)
        throw invalid('FORBIDDEN', 403);
      if (Object.keys(request.query ?? {}).length) throw invalid();
      return service.authorize(
        {
          cookie: request.headers.cookie,
          origin: request.headers.origin,
          csrfToken: request.headers['x-csrf-token'],
          secFetchSite: request.headers['sec-fetch-site'],
        },
        write,
      );
    }
    scope.get(
      '/api/v1/contacts/:contactId/whatsapp/first-message-preview',
      limits,
      async (request) => {
        const actor = await human(request, false);
        const params = /** @type {any} */ (request.params);
        return service.preview({
          actor,
          contactId: contactId(params.contactId),
        });
      },
    );
    scope.post(
      '/api/v1/contacts/:contactId/whatsapp/conversations',
      limits,
      async (request, reply) => {
        const actor = await human(request, true);
        const params = /** @type {any} */ (request.params);
        const id = contactId(params.contactId);
        const body = readFirstSendBody(request.body);
        const key = idempotencyKey(request.headers['idempotency-key']);
        const result = await service.send({
          ...body,
          actor,
          contactId: id,
          idempotencyKey: key,
          correlationId: contextFor(request).correlationId,
        });
        return reply.code(result.created ? 201 : 200).send(result.body);
      },
    );
  });
}
