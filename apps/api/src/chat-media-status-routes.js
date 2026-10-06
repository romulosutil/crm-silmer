import { mediaError } from './chat-media-runtime.js';

/** @param {any} reply @param {any} error @param {string} requestId */
export function sendChatMediaProblem(reply, error, requestId) {
  const raw = Number(error?.statusCode);
  const status = [400, 401, 403, 404, 409, 410, 413, 416, 422, 429].includes(
    raw,
  )
    ? raw
    : 503;
  const code = /** @type {Record<number,string>} */ ({
    400: 'INVALID_REQUEST',
    401: 'INVALID_CREDENTIALS',
    403: 'FORBIDDEN',
    404: 'MEDIA_NOT_FOUND',
    409: 'MEDIA_CONFLICT',
    410: 'MEDIA_LOST',
    413: 'MEDIA_TOO_LARGE',
    416: 'MEDIA_INVALID_RANGE',
    422: 'MEDIA_INVALID',
    429: 'MEDIA_RATE_LIMITED',
    503: 'SERVICE_UNAVAILABLE',
  })[status];
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .code(status)
    .type('application/problem+json')
    .send({
      accepted: false,
      error: { code },
      type: 'about:blank',
      title: 'Chat media request failed',
      status,
      request_id: requestId,
    });
}
/** @param {any} request @param {any} media */
export async function authorizeChatMediaRead(request, media) {
  if (request.headers.authorization !== undefined) throw mediaError(403);
  if (!/(?:^|;\s*)crm_session=[^;]+/u.test(request.headers.cookie ?? ''))
    throw mediaError(401);
  return media.authorizeRead({
    action: 'conversation.read',
    authenticationFailureStatus: 401,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
  });
}
/** @param {import('fastify').FastifyInstance} api @param {any} media @param {Function} contextFor */
export function registerChatMediaStatusRoutes(api, media, contextFor) {
  api.get(
    '/api/v1/conversations/:conversationId/media/:mediaId',
    async (request, reply) => {
      try {
        const principal = await authorizeChatMediaRead(request, media);
        const params = /** @type {any} */ (request.params);
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
            params.mediaId,
          )
        )
          throw mediaError(404);
        const result = await media.status({
          ...params,
          actor: principal.actor,
        });
        return reply
          .header('Cache-Control', 'private, no-store')
          .code(200)
          .send(result);
      } catch (error) {
        return sendChatMediaProblem(
          reply,
          error,
          contextFor(request).requestId,
        );
      }
    },
  );
}
