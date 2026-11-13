import { createHmac, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { OrderConflictError, renderOrderReceiptHtml } from '@crm-silmer/orders';

/**
 * RCP-06–10: a commercial read, deliberately separate from order.print and
 * its first-print effect. The HMAC is a consistency fence, never authority.
 * @param {import('fastify').FastifyInstance} api
 * @param {any} orders
 * @param {(request:object)=>{correlationId:string,requestId:string}} contextFor
 * @param {(html:string)=>Promise<Buffer>} pdfRenderer
 */
export function registerOrderReceiptRoutes(
  api,
  orders,
  contextFor,
  pdfRenderer,
) {
  const key = randomBytes(32);
  /** @param {any} receipt */
  const fingerprint = (receipt) =>
    createHmac('sha256', key)
      .update(JSON.stringify({ ...receipt, issuedAt: null }))
      .digest('hex');

  /** @param {any} request */
  const authorize = (request) =>
    orders.authorizeRead({
      action: 'order.read',
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      secFetchSite: request.headers['sec-fetch-site'],
    });
  /** @param {any} request */
  async function read(request) {
    const principal = await authorize(request);
    const receipt = await orders.getReceipt(
      request.params.orderId,
      principal.actor,
    );
    return { principal, receipt };
  }
  /** @param {any} receipt @param {any} query */
  function assertFresh(receipt, query) {
    if (
      receipt.version !== Number(query.expectedVersion) ||
      fingerprint(receipt) !== query.fingerprint
    )
      throw new OrderConflictError(
        'Atualize a prévia do recibo.',
        'RECEIPT_STALE',
      );
  }
  api.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('vary', 'Origin, Cookie');
      reply.header('x-content-type-options', 'nosniff');
    });
    await scope.register(rateLimit, { global: false });
    scope.get(
      '/api/v1/orders/:orderId/receipt',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (request, reply) =>
        respond(reply, async () => {
          validate(request, false);
          const { receipt } = await read(request);
          return reply.send({ receipt, fingerprint: fingerprint(receipt) });
        }),
    );
    scope.get(
      '/api/v1/orders/:orderId/receipt/pdf',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) =>
        respond(reply, async () => {
          const query = validate(request, true);
          const { receipt } = await read(request);
          assertFresh(receipt, query);
          let pdf;
          if (request.method !== 'HEAD') {
            pdf = await pdfRenderer(renderOrderReceiptHtml(receipt));
            // Rendering takes time. Never release prepared bytes after a transfer,
            // revocation, reopen or an unversioned customer/seller name change.
            const fresh = await read(request);
            assertFresh(fresh.receipt, query);
            await orders.recordReceiptDownload({
              actor: fresh.principal.actor,
              orderId: receipt.orderId,
              version: receipt.version,
              correlationId: contextFor(request).correlationId,
            });
          }
          const suffix =
            receipt.status === 'pendente'
              ? '-provisorio'
              : receipt.status === 'cancelado'
                ? '-cancelado'
                : '';
          const name = `recibo-${receipt.number}${suffix}.pdf`.replace(
            /[^A-Za-z0-9.-]/gu,
            '_',
          );
          reply.header('content-disposition', `attachment; filename="${name}"`);
          reply.header(
            'content-security-policy',
            "default-src 'none'; sandbox",
          );
          return reply.type('application/pdf').send(pdf);
        }),
    );
  });
}

/** @param {any} request @param {boolean} pdf */
function validate(request, pdf) {
  const id = request.params?.orderId;
  const query = request.query ?? {};
  const allowed = pdf ? ['expectedVersion', 'fingerprint'] : [];
  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(id) ||
    Object.keys(query).some((k) => !allowed.includes(k)) ||
    (pdf &&
      (typeof query.expectedVersion !== 'string' ||
        !/^[1-9][0-9]{0,15}$/u.test(query.expectedVersion) ||
        !Number.isSafeInteger(Number(query.expectedVersion)) ||
        typeof query.fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(query.fingerprint)))
  )
    throw Object.assign(new Error('Invalid receipt request'), {
      statusCode: 400,
      code: 'INVALID_REQUEST',
    });
  return query;
}

/** @param {import('fastify').FastifyReply} reply @param {()=>Promise<unknown>} work */
async function respond(reply, work) {
  try {
    return await work();
  } catch (error) {
    const failure = /** @type {any} */ (error);
    const status = [400, 401, 403, 404, 409, 422, 429].includes(
      failure?.statusCode,
    )
      ? failure.statusCode
      : 503;
    const code = [
      'INVALID_REQUEST',
      'INVALID_CREDENTIALS',
      'FORBIDDEN',
      'ORDER_NOT_FOUND',
      'RECEIPT_STALE',
    ].includes(failure?.code)
      ? failure.code
      : status === 503
        ? 'SERVICE_UNAVAILABLE'
        : 'INVALID_REQUEST';
    return reply.code(status).send({ error: { code } });
  }
}
