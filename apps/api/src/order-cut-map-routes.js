import { createHmac, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { renderCutMapHtml } from '@crm-silmer/orders';

/** @param {import('fastify').FastifyInstance} api @param {any} orders @param {Function} contextFor @param {(html:string)=>Promise<Buffer>} pdfRenderer */
export function registerOrderCutMapRoutes(
  api,
  orders,
  contextFor,
  pdfRenderer,
) {
  const key = randomBytes(32);
  /** @param {any} map */
  const fingerprint = (map) =>
    createHmac('sha256', key).update(JSON.stringify(map)).digest('hex');
  /** @param {any} request */
  const authorize = (request) =>
    orders.authorizeRead({
      action: 'order.read',
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      secFetchSite: request.headers['sec-fetch-site'],
    });

  api.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('vary', 'Origin, Cookie');
      reply.header('x-content-type-options', 'nosniff');
    });
    await scope.register(rateLimit, { global: false });

    for (const pdf of [false, true]) {
      scope.get(
        `/api/v1/orders/cut-map${pdf ? '/pdf' : ''}`,
        {
          config: { rateLimit: { max: pdf ? 10 : 30, timeWindow: '1 minute' } },
        },
        async (request, reply) => {
          const query = /** @type {any} */ (request.query);
          const ids =
            typeof query?.orders === 'string' ? query.orders.split(',') : [];
          if (
            !ids.length ||
            ids.length > 50 ||
            ids.some(
              (/** @type {string} */ id) => !/^[A-Za-z0-9_-]{1,128}$/u.test(id),
            ) ||
            Object.keys(query).some(
              (name) => name !== 'orders' && !(pdf && name === 'fingerprint'),
            ) ||
            (pdf &&
              (typeof query.fingerprint !== 'string' ||
                !/^[a-f0-9]{64}$/u.test(query.fingerprint)))
          ) {
            return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
          }
          try {
            const { actor } = await authorize(request);
            const map = await orders.getCutMap(ids, actor);
            if (!pdf) return reply.send({ map, fingerprint: fingerprint(map) });
            if (fingerprint(map) !== query.fingerprint)
              return reply.code(409).send({ error: { code: 'CUT_MAP_STALE' } });
            const bytes =
              request.method === 'HEAD'
                ? undefined
                : await pdfRenderer(renderCutMapHtml(map));
            if (bytes) {
              const fresh = await authorize(request);
              const current = await orders.getCutMap(ids, fresh.actor);
              if (fingerprint(current) !== query.fingerprint)
                return reply
                  .code(409)
                  .send({ error: { code: 'CUT_MAP_STALE' } });
              await orders.recordCutMapDownload(
                current,
                fresh.actor,
                contextFor(request).correlationId,
              );
            }
            reply.header(
              'content-disposition',
              'attachment; filename="mapa-de-corte.pdf"',
            );
            reply.header(
              'content-security-policy',
              "default-src 'none'; sandbox",
            );
            return reply.type('application/pdf').send(bytes);
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
        },
      );
    }
  });
}
