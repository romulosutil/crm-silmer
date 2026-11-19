import rateLimit from '@fastify/rate-limit';
import { authorizeRequest } from './n8n-routes.js';
import {
  controlObject,
  controlId,
  controlVersion,
  readHumanControl,
  readControlEnvelope,
  readControlResult,
  whatsappControlError as error,
} from './seller-whatsapp-contract.js';

/** WAP-E02. Registration is unconditional; absent configuration fails closed.
 * @param {import('fastify').FastifyInstance} api @param {any} service @param {Function} contextFor */
export function registerSellerWhatsAppRoutes(api, service, contextFor) {
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
      const known =
        /^(?:WHATSAPP_[A-Z_]+|INVALID_REQUEST|INVALID_SESSION|CSRF_INVALID|FORBIDDEN|IDEMPOTENCY_[A-Z_]+|VERSION_CONFLICT|RATE_LIMITED|INVALID_[A-Z_]+|AUTOMATION_[A-Z_]+)$/u.test(
          e.code ?? '',
        );
      const status =
        e.statusCode === 413
          ? 413
          : e.statusCode === 415
            ? 415
            : known && Number.isInteger(e.statusCode)
              ? e.statusCode
              : 503;
      const code =
        status === 413
          ? 'REQUEST_TOO_LARGE'
          : status === 415
            ? 'UNSUPPORTED_MEDIA_TYPE'
            : known
              ? e.code
              : 'WHATSAPP_CONTROL_UNAVAILABLE';
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
      if (request.headers.authorization !== undefined)
        throw error('FORBIDDEN', 403);
      if (!service) throw error('WHATSAPP_CONTROL_DISABLED', 503);
      if (Object.keys(request.query ?? {}).length) throw error();
      const auth = {
        action: write ? 'whatsapp.personal.manage' : 'whatsapp.personal.read',
        cookie: request.headers.cookie,
        origin: request.headers.origin,
        csrfToken: request.headers['x-csrf-token'],
        secFetchSite: request.headers['sec-fetch-site'],
      };
      const { actor } = await (write
        ? service.authorizeWrite(auth)
        : service.authorizeRead(auth));
      return { actor, auth };
    }
    scope.get('/api/v1/me/whatsapp', limits, async (request) => {
      const { actor } = await human(request, false);
      return service.get({ actorId: actor.id });
    });
    for (const action of /** @type {const} */ (['connect', 'disconnect'])) {
      scope.post(
        `/api/v1/me/whatsapp/${action}`,
        limits,
        async (request, reply) => {
          const { actor } = await human(request, true);
          const command = readHumanControl(request.body, action);
          const result = await service.submit({
            ...command,
            actorId: actor.id,
            action,
            idempotencyKey: controlId(request.headers['idempotency-key']),
            correlationId: contextFor(request).correlationId,
          });
          return reply.code(202).send(result);
        },
      );
    }
    scope.post(
      '/api/v1/me/whatsapp/pairing-challenge',
      limits,
      async (request, reply) => {
        const { actor, auth } = await human(request, true);
        const challenge = await service.challenge({
          ...readHumanControl(request.body, 'challenge'),
          actorId: actor.id,
          auth,
          idempotencyKey: controlId(request.headers['idempotency-key']),
          correlationId: contextFor(request).correlationId,
        });
        return reply.code(200).send(challenge);
      },
    );
    /** @param {any} request @param {string} action */
    async function technical(request, action) {
      if (!service) throw error('WHATSAPP_CONTROL_DISABLED', 503);
      if (Object.keys(request.query ?? {}).length) throw error();
      const auth = await authorizeRequest(request, contextFor, action);
      service.authorizeTechnical(auth);
      return auth;
    }
    for (const path of ['verify', 'operations']) {
      scope.post(
        `/api/v1/integrations/n8n/whatsapp-control/${path}`,
        limits,
        async (request) => {
          const auth = await technical(
            request,
            path === 'verify'
              ? 'whatsapp.control.read'
              : 'whatsapp.control.reserve',
          );
          const command = readControlEnvelope(request.body);
          return path === 'verify'
            ? service.verifyEnvelope(command, auth)
            : service.reserve(command, auth);
        },
      );
    }
    scope.post(
      '/api/v1/integrations/n8n/whatsapp-control/results',
      limits,
      async (request) => {
        const auth = await technical(request, 'whatsapp.control.result');
        return service.result(readControlResult(request.body), auth);
      },
    );
    // Every personal event of every line is verified here, all from the one
    // n8n egress IP. The per-line ingress ceiling is a 20 msg/s peak
    // (seller-whatsapp.md, limites do piloto), so 60/min would drop events.
    const ingressLimits = {
      bodyLimit: limits.bodyLimit,
      config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    };
    scope.post(
      '/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
      ingressLimits,
      async (request) => {
        const auth = await technical(request, 'whatsapp.control.read');
        const body = controlObject(request.body, [
          'source',
          'instance',
          'sender',
        ]);
        if (
          body.sender !== undefined &&
          (typeof body.sender !== 'string' ||
            !/^\d{8,15}@s\.whatsapp\.net$/u.test(body.sender))
        )
          throw error();
        const source = controlObject(body.source, [
          'bindingId',
          'lineId',
          'accountId',
          'generation',
        ]);
        for (const key of ['bindingId', 'lineId', 'accountId'])
          controlId(source[key]);
        if (
          auth.correlationId !== source.bindingId ||
          auth.idempotencyKey !== source.bindingId
        )
          throw error('FORBIDDEN', 403);
        controlVersion(source.generation, 1);
        if (
          typeof body.instance !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(body.instance)
        )
          throw error();
        return service.verifyIngress({
          ...body,
          token: request.headers['x-silmer-wap-generation-token'],
        });
      },
    );
  });
}
