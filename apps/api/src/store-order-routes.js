import rateLimit from '@fastify/rate-limit';

export const STORE_ORDERS_PATH = '/api/v1/public/loja/pedidos';
export const STORE_ORDER_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * Fastify's own refusals before the handler (body that is not JSON, too
 * big, another media type) are all malformed notices to the site.
 */
const MALFORMED_FASTIFY_CODES = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
]);

/**
 * ADR 027: the only public write of the CRM — the site shop's "Já pagou?"
 * notice. It lives in its own scope so its JSON errors, its CORS headers and
 * its per-IP limit never reach another route. Answers follow the site's
 * contract v1: `{"numero"}` on 2xx, `{"erro": "<codigo>"}` otherwise.
 *
 * @param {import('fastify').FastifyInstance} api
 * @param {import('./store-order-runtime.js').StoreOrderRuntime} store
 * @param {(request: object) => {correlationId: string, requestId: string}} contextFor
 */
export function registerStoreOrderRoutes(api, store, contextFor) {
  api.register(async (scope) => {
    await scope.register(rateLimit, {
      errorResponseBuilder: () =>
        Object.assign(new Error('rate_limited'), {
          code: 'rate_limited',
          statusCode: 429,
        }),
      global: false,
    });

    // LOJ-11: an allowed Origin gets its CORS headers on every answer,
    // errors and limits included, so the site can read the status.
    scope.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      reply.header('vary', 'Origin');
      const origin = request.headers.origin;
      if (store.allowsOrigin(origin)) {
        reply.header('access-control-allow-origin', origin);
        reply.header('access-control-expose-headers', 'Retry-After');
      }
    });

    scope.setErrorHandler(async (error, _request, reply) => {
      const failure =
        /** @type {{code?: unknown, statusCode?: unknown, retryAfterSeconds?: unknown}} */ (
          error
        );
      const statusCode = Number(failure.statusCode);
      if (failure.code === 'rate_limited' || statusCode === 429) {
        if (Number.isSafeInteger(failure.retryAfterSeconds)) {
          reply.header('retry-after', String(failure.retryAfterSeconds));
        }
        return reply.code(429).send({ erro: 'rate_limited' });
      }
      if (
        [400, 403, 409, 422].includes(statusCode) &&
        typeof failure.code === 'string' &&
        /^[a-z_]+$/u.test(failure.code)
      ) {
        return reply.code(statusCode).send({ erro: failure.code });
      }
      // Fastify's own refusals (not JSON, too big, a poisoned prototype,
      // another media type) and any other client error are a malformed
      // notice to the site; internal names never leave the API.
      if (
        MALFORMED_FASTIFY_CODES.has(String(failure.code)) ||
        (statusCode >= 400 && statusCode < 500)
      ) {
        return reply.code(400).send({ erro: 'corpo_invalido' });
      }
      return reply.code(503).send({ erro: 'indisponivel' });
    });

    const limit = {
      rateLimit: {
        max: store.requestsPerMinute,
        timeWindow: '1 minute',
      },
    };

    scope.options(
      STORE_ORDERS_PATH,
      { config: limit },
      async (request, reply) => {
        if (store.allowsOrigin(request.headers.origin)) {
          reply.header('access-control-allow-methods', 'POST, OPTIONS');
          reply.header(
            'access-control-allow-headers',
            'Content-Type, Idempotency-Key',
          );
          reply.header('access-control-max-age', '600');
        }
        return reply.code(204).send();
      },
    );

    scope.post(
      STORE_ORDERS_PATH,
      { bodyLimit: STORE_ORDER_BODY_LIMIT_BYTES, config: limit },
      async (request, reply) => {
        const origin = request.headers.origin;
        if (!store.allowsOrigin(origin)) {
          return reply.code(403).send({ erro: 'origem_nao_permitida' });
        }
        const result = await store.receive({
          body: request.body,
          clientIp: request.ip,
          correlationId: contextFor(request).correlationId,
          idempotencyKey: request.headers['idempotency-key'],
          origin: /** @type {string} */ (origin),
        });
        return reply
          .code(result.created ? 201 : 200)
          .send({ numero: result.numero });
      },
    );
  });
}
