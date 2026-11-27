import { createHmac, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { renderCutMapHtml } from '@crm-silmer/orders';

const root = '/api/v1/orders';
const identifier = /^[A-Za-z0-9_-]{1,128}$/u;

/** @param {unknown} value */
function validSelection(value) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 50 &&
    value.every((id) => typeof id === 'string' && identifier.test(id))
  );
}

/** @param {import('fastify').FastifyInstance} api @param {any} orders @param {Function} contextFor @param {(html:string)=>Promise<Buffer>} pdfRenderer */
export function registerOrderCutMapRoutes(
  api,
  orders,
  contextFor,
  pdfRenderer,
) {
  const key = randomBytes(32);
  /** @param {any} map @param {string} actorId */
  const fingerprint = (map, actorId) =>
    createHmac('sha256', key)
      .update(JSON.stringify([actorId, map]))
      .digest('hex');

  /** @param {import('fastify').FastifyRequest} request @param {boolean} [write] */
  const authorize = (request, write = false) => {
    const input = {
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
    };
    return write
      ? orders.authorizeWrite({
          ...input,
          action: 'order.print',
          csrfToken: request.headers['x-csrf-token'],
        })
      : orders.authorizeRead({
          ...input,
          action: 'order.read',
          secFetchSite: request.headers['sec-fetch-site'],
        });
  };

  /** @param {import('fastify').FastifyReply} reply @param {number} status @param {string} code */
  const reject = (reply, status, code) =>
    reply.code(status).send({ error: { code } });

  /** @param {(request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply)=>Promise<any>} handler */
  const respond =
    (handler) =>
    /** @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
    async (request, reply) => {
      try {
        return await handler(request, reply);
      } catch (error) {
        const failure = /** @type {any} */ (error);
        const status = [400, 401, 403, 404, 409, 422, 429].includes(
          failure?.statusCode,
        )
          ? failure.statusCode
          : 503;
        const codes = [
          'INVALID_CREDENTIALS',
          'FORBIDDEN',
          'ORDER_NOT_FOUND',
          'CUT_MAP_NOT_ELIGIBLE',
          'CUT_MAP_INCOMPLETE',
          'CUT_MAP_STALE',
        ];
        const code = codes.includes(failure?.code)
          ? failure.code
          : status === 503
            ? 'SERVICE_UNAVAILABLE'
            : 'INVALID_REQUEST';
        return reply.code(status).send({
          error: {
            code,
            ...(code === 'CUT_MAP_INCOMPLETE' && failure.orderId
              ? {
                  orderId: failure.orderId,
                  orderNumber: failure.orderNumber,
                  itemIndex: failure.itemIndex,
                  fields: failure.fields,
                }
              : {}),
          },
        });
      }
    };

  api.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('vary', 'Origin, Cookie');
      reply.header('x-content-type-options', 'nosniff');
    });
    await scope.register(rateLimit, { global: false });
    const readLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

    scope.get(
      `${root}/cut-map`,
      { config: readLimit },
      respond(async (request, reply) => {
        const query = /** @type {Record<string, unknown>} */ (request.query);
        const ids =
          typeof query.orders === 'string' ? query.orders.split(',') : [];
        if (!validSelection(ids) || Object.keys(query).length !== 1)
          return reject(reply, 400, 'INVALID_REQUEST');
        const { actor } = await authorize(request);
        const map = await orders.getCutMap(ids, actor);
        return reply.send({ map, fingerprint: fingerprint(map, actor.id) });
      }),
    );

    scope.get(
      `${root}/:orderId/cut-map-history`,
      { config: readLimit },
      respond(async (request, reply) => {
        const { orderId } = /** @type {{orderId: string}} */ (request.params);
        const { before, ...extra } = /** @type {Record<string, unknown>} */ (
          request.query
        );
        if (
          !identifier.test(orderId) ||
          Object.keys(extra).length ||
          (before !== undefined &&
            (typeof before !== 'string' || !identifier.test(before)))
        )
          return reject(reply, 400, 'INVALID_REQUEST');
        const { actor } = await authorize(request);
        return reply.send(
          await orders.getCutMapHistory(orderId, actor, before ?? null),
        );
      }),
    );

    scope.post(
      `${root}/cut-map/pdf`,
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      respond(async (request, reply) => {
        const body = /** @type {Record<string, unknown>} */ (
          request.body ?? {}
        );
        const { orders: ids, fingerprint: proof, regenerate, ...extra } = body;
        if (
          !validSelection(ids) ||
          typeof proof !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(proof) ||
          (regenerate !== undefined && typeof regenerate !== 'boolean') ||
          Object.keys(extra).length
        )
          return reject(reply, 400, 'INVALID_REQUEST');

        const { actor } = await authorize(request, true);
        const map = await orders.getCutMap(ids, actor);
        if (fingerprint(map, actor.id) !== proof)
          return reject(reply, 409, 'CUT_MAP_STALE');
        if (
          regenerate !== true &&
          map.orders.some((/** @type {any} */ order) => order.cutMapGeneratedAt)
        )
          return reject(reply, 409, 'CUT_MAP_ALREADY_GENERATED');

        const bytes = await pdfRenderer(renderCutMapHtml(map));
        const fresh = await authorize(request, true);
        const current = await orders.getCutMap(ids, fresh.actor);
        if (fingerprint(current, fresh.actor.id) !== proof)
          return reject(reply, 409, 'CUT_MAP_STALE');
        await orders.recordCutMapDownload(
          current,
          fresh.actor,
          contextFor(request).correlationId,
        );

        return reply
          .header(
            'content-disposition',
            'attachment; filename="mapa-de-corte.pdf"',
          )
          .header('content-security-policy', "default-src 'none'; sandbox")
          .type('application/pdf')
          .send(bytes);
      }),
    );
  });
}
