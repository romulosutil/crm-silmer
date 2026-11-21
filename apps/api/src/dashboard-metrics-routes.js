import { DashboardError } from './dashboard-runtime.js';

import { dashboardWindowQuery } from './dashboard-routes.js';

const PUBLIC_CODES = new Set([
  'INVALID_REQUEST',
  'INVALID_FILTER',
  'FORBIDDEN',
  'INVALID_CREDENTIALS',
]);

/** Metric reads are heavier than the action queue; bound them per client. */
const READ_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/** @param {any} request @param {any} metrics */
async function reader(request, metrics) {
  return metrics.authorizeRead({
    action: 'conversation.read',
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
  });
}

/** @param {any} reply @param {()=>Promise<unknown>} work */
async function respond(reply, work) {
  reply.header('cache-control', 'private, no-store');
  reply.header('vary', 'Origin, Cookie');
  try {
    return reply.send(await work());
  } catch (error) {
    const candidate = /** @type {{statusCode?:number,code?:string}} */ (error);
    const status =
      candidate.statusCode &&
      candidate.statusCode >= 400 &&
      candidate.statusCode < 500
        ? candidate.statusCode
        : 503;
    const code =
      status === 503
        ? 'SERVICE_UNAVAILABLE'
        : PUBLIC_CODES.has(candidate.code ?? '')
          ? candidate.code
          : 'INVALID_REQUEST';
    return reply.code(status).type('application/problem+json').send({
      type: 'about:blank',
      title: code,
      status,
      code,
    });
  }
}

/** RFC 048 metric reads, sharing the period, scope and error contract.
 * @param {import('fastify').FastifyInstance} api @param {any} metrics
 */
export function registerDashboardMetricsRoutes(api, metrics) {
  api.get(
    '/api/v1/dashboard/metrics/cohorts',
    { config: READ_LIMIT },
    (request, reply) =>
      respond(reply, async () => {
        const { seller, ...rest } = /** @type {Record<string,unknown>} */ (
          request.query ?? {}
        );
        if (
          seller !== undefined &&
          (typeof seller !== 'string' || !seller.trim() || seller.length > 255)
        )
          throw new DashboardError(400, 'INVALID_FILTER');
        const filter = dashboardWindowQuery(rest);
        const { actor } = await reader(request, metrics);
        return metrics.cohorts({ actor, ...filter, seller });
      }),
  );
  api.get(
    '/api/v1/dashboard/metrics/service',
    { config: READ_LIMIT },
    (request, reply) =>
      respond(reply, async () => {
        const filter = dashboardWindowQuery(request.query);
        const { actor } = await reader(request, metrics);
        return metrics.service({ actor, ...filter });
      }),
  );
  api.get(
    '/api/v1/dashboard/metrics/losses',
    { config: READ_LIMIT },
    (request, reply) =>
      respond(reply, async () => {
        const filter = dashboardWindowQuery(request.query);
        const { actor } = await reader(request, metrics);
        return metrics.losses({ actor, ...filter });
      }),
  );
}
