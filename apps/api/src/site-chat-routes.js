import rateLimit from '@fastify/rate-limit';

const ALLOWED_ORIGINS = new Set([
  'https://silmer.com.br',
  'https://www.silmer.com.br',
]);
const PATH = '/api/v1/site-chat/messages';

/**
 * The browser's random UUIDv4 is scoped to one synthetic site identity. The
 * route returns only messages for that session and never looks up a phone.
 * @param {import('fastify').FastifyInstance} api
 * @param {{readSiteMessages(input: {sessionId: string}): Promise<any>}} runtime
 */
export function registerSiteChatRoutes(api, runtime) {
  if (typeof runtime?.readSiteMessages !== 'function') {
    throw new TypeError('readSiteMessages is required');
  }
  api.register(async (scope) => {
    await scope.register(rateLimit, { global: false });
    /** @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
    const verifyOrigin = (request, reply) => {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !ALLOWED_ORIGINS.has(origin)) {
        reply.code(403).send({ error: { code: 'FORBIDDEN' } });
        return false;
      }
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-methods', 'POST, OPTIONS');
      reply.header('access-control-allow-headers', 'Content-Type');
      reply.header('vary', 'Origin');
      reply.header('cache-control', 'no-store');
      return true;
    };
    scope.options(PATH, async (request, reply) => {
      if (!verifyOrigin(request, reply)) return reply;
      return reply.code(204).send();
    });
    scope.post(
      PATH,
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (request, reply) => {
        if (!verifyOrigin(request, reply)) return reply;
        const body = /** @type {Record<string, unknown>|null} */ (
          request.body ?? null
        );
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          typeof body.session_id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            body.session_id,
          )
        ) {
          return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
        }
        return runtime.readSiteMessages({ sessionId: body.session_id });
      },
    );
  });
}
