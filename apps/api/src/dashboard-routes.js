import { DashboardError } from './dashboard-runtime.js';

/** @param {unknown} value */
export function dashboardWindowQuery(value) {
  const query = /** @type {Record<string,unknown>} */ (value ?? {});
  if (
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !['days', 'period'].includes(key)) ||
    (query.period !== undefined && query.days !== undefined)
  )
    throw new DashboardError(400, 'INVALID_REQUEST');
  if (query.period !== undefined) {
    if (
      typeof query.period !== 'string' ||
      !['hoje', '7dias', 'mes'].includes(query.period)
    )
      throw new DashboardError(400, 'INVALID_FILTER');
    return { period: query.period };
  }
  if (query.days !== undefined && query.days !== '7' && query.days !== '30')
    throw new DashboardError(400, 'INVALID_FILTER');
  return { days: Number(query.days ?? 7) };
}

const PUBLIC_CODES = new Set([
  'INVALID_REQUEST',
  'INVALID_FILTER',
  'INVALID_EXPECTED_VERSION',
  'INVALID_REMINDER_DATE',
  'ACTION_NOT_FOUND',
  'ACTION_NOT_AVAILABLE',
  'VERSION_CONFLICT',
  'FORBIDDEN',
  'CSRF_INVALID',
  'INVALID_CREDENTIALS',
  'INVALID_IDEMPOTENCY_KEY',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_CONFLICT',
]);

/** @param {unknown} value @param {string[]} allowed */
function object(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new DashboardError(400, 'INVALID_REQUEST');
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {any} request @param {any} dashboard @param {boolean} write */
async function principal(request, dashboard, write) {
  const input = {
    action: write ? 'conversation.takeover' : 'conversation.read',
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
    csrfToken: request.headers['x-csrf-token'],
  };
  return write
    ? dashboard.authorizeWrite(input)
    : dashboard.authorizeRead(input);
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

/** @param {import('fastify').FastifyInstance} api @param {any} dashboard @param {(request:object)=>{correlationId:string}} contextFor */
export function registerDashboardRoutes(api, dashboard, contextFor) {
  api.get('/api/v1/dashboard/live', (request, reply) =>
    respond(reply, async () => {
      const query = object(request.query ?? {}, [
        'region',
        'filter',
        'page',
        'before',
      ]);
      const { actor } = await principal(request, dashboard, false);
      return dashboard.live({ actor, query });
    }),
  );
  api.get('/api/v1/dashboard/actions', (request, reply) =>
    respond(reply, async () => {
      object(request.query ?? {}, []);
      const { actor } = await principal(request, dashboard, false);
      return dashboard.actions({ actor });
    }),
  );
  api.get('/api/v1/dashboard/performance', (request, reply) =>
    respond(reply, async () => {
      const filter = dashboardWindowQuery(request.query);
      const { actor } = await principal(request, dashboard, false);
      return dashboard.performance({ actor, ...filter });
    }),
  );
  api.post(
    '/api/v1/dashboard/actions/:actionId/decision',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    (request, reply) =>
      respond(reply, async () => {
        const { actor } = await principal(request, dashboard, true);
        const body = object(request.body, [
          'decision',
          'expectedVersion',
          'sourceRevision',
          'expectedDecisionVersion',
          'remindAt',
        ]);
        const actionId = /** @type {any} */ (request.params).actionId;
        const idempotencyKey = request.headers['idempotency-key'];
        if (
          typeof actionId !== 'string' ||
          typeof idempotencyKey !== 'string' ||
          !idempotencyKey.trim() ||
          idempotencyKey.length > 200
        )
          throw new DashboardError(400, 'INVALID_IDEMPOTENCY_KEY');
        return dashboard.decide({
          actor,
          actionId,
          idempotencyKey,
          correlationId: contextFor(request).correlationId,
          decision: body.decision,
          expectedVersion: body.expectedVersion,
          sourceRevision: body.sourceRevision,
          expectedDecisionVersion: body.expectedDecisionVersion,
          ...(Object.hasOwn(body, 'remindAt')
            ? { remindAt: body.remindAt }
            : {}),
        });
      }),
  );
}
