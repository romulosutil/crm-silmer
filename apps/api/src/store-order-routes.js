import rateLimit from '@fastify/rate-limit';

import { authorizeRequest, sendProblem } from './n8n-routes.js';
import { STORE_ORDER_ACTION } from './store-order-runtime.js';

export const STORE_ORDERS_PATH = '/api/v1/integrations/n8n/store-orders';
export const STORE_ORDER_BODY_LIMIT_BYTES = 16 * 1024;
// A paid checkout is a handful of calls a day; the cap stops a leaked
// credential or a looping workflow from hammering the authorization and the
// database, and n8n retries the 429 like any other retryable answer.
export const STORE_ORDER_REQUESTS_PER_MINUTE = 60;

/**
 * Fastify's own refusals before the handler, in the problem vocabulary.
 *
 * @param {any} error
 */
function asProblem(error) {
  const statusCode = Number(error?.statusCode);
  const code = typeof error?.code === 'string' ? error.code : '';
  if (statusCode === 413) {
    return { code: 'REQUEST_TOO_LARGE', statusCode };
  }
  if (statusCode === 415) {
    return { code: 'UNSUPPORTED_MEDIA_TYPE', statusCode };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return code.startsWith('FST_')
      ? { code: 'INVALID_REQUEST', statusCode: 400 }
      : error;
  }
  if (statusCode === 503) return error;
  // Anything unexpected is retryable and says nothing about the inside.
  return { code: 'SERVICE_UNAVAILABLE', statusCode: 503 };
}

/**
 * ADR 028: the n8n checkout workflow records the site shop's paid order.
 * Same contract as the other n8n routes — Basic of the AUTOMATION_EXECUTOR,
 * Idempotency-Key, correlation and workflow identity, problem+json — with
 * its own action, `store.order.record`, and its own scope, so its error
 * mapping never reaches another route.
 *
 * @param {import('fastify').FastifyInstance} api
 * @param {import('./store-order-runtime.js').StoreOrderRuntime} store
 * @param {(request: import('fastify').FastifyRequest) => {correlationId: string, requestId: string}} contextFor
 */
export function registerStoreOrderRoutes(api, store, contextFor) {
  api.register(async (scope) => {
    // Checked before the credential, so a flood never reaches the
    // automation authorization or the database.
    await scope.register(rateLimit, {
      errorResponseBuilder: () =>
        Object.assign(new Error('rate limited'), {
          code: 'RATE_LIMITED',
          statusCode: 429,
        }),
      global: false,
    });

    scope.setErrorHandler((error, request, reply) => {
      reply.header('cache-control', 'no-store');
      return sendProblem(reply, request, contextFor, asProblem(error));
    });

    scope.post(
      STORE_ORDERS_PATH,
      {
        bodyLimit: STORE_ORDER_BODY_LIMIT_BYTES,
        config: {
          rateLimit: {
            max: STORE_ORDER_REQUESTS_PER_MINUTE,
            timeWindow: '1 minute',
          },
        },
      },
      async (request, reply) => {
        const technical = await authorizeRequest(
          request,
          contextFor,
          STORE_ORDER_ACTION,
        );
        const result = await store.record({ body: request.body, technical });
        return reply
          .code(result.statusCode)
          .header('cache-control', 'no-store')
          .send(result.body);
      },
    );
  });
}
