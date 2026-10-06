import {
  authorizeChatMediaRead,
  sendChatMediaProblem,
} from './chat-media-status-routes.js';

/** @param {import('fastify').FastifyInstance} api @param {any} media @param {Function} contextFor */
export function registerChatMediaContentRoutes(api, media, contextFor) {
  api.get(
    '/api/v1/conversations/:conversationId/media/:mediaId/content',
    async (request, reply) => {
      try {
        const principal = await authorizeChatMediaRead(request, media);
        const result = await media.content({
          .../** @type {any} */ (request.params),
          actor: principal.actor,
          range: request.headers.range,
        });
        for (const [key, value] of Object.entries(result.headers))
          reply.header(key, value);
        return reply.code(result.statusCode).send(result.stream);
      } catch (error) {
        if (/** @type {any} */ (error)?.contentRange)
          reply.header(
            'Content-Range',
            /** @type {any} */ (error).contentRange,
          );
        return sendChatMediaProblem(
          reply,
          error,
          contextFor(request).requestId,
        );
      }
    },
  );
}
