import { N8nRouteError } from './n8n-routes.js';
import { sendChatMediaProblem } from './chat-media-status-routes.js';

/** Read-only representations of the original reservation; neither authorizes another send.
 * @param {import('fastify').FastifyInstance} api @param {any} integration @param {any} media @param {Function} contextFor
 */
export function registerN8nCommandMediaRoutes(
  api,
  integration,
  media,
  contextFor,
) {
  api.get(
    '/api/v1/integrations/n8n/commands/:commandId/media',
    { exposeHeadRoute: false },
    async (request, reply) => {
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff');
      try {
        const context = contextFor(request);
        const auth = /** @type {any} */ (api).automationAuth;
        if (!auth) throw new N8nRouteError(503, 'AUTOMATION_AUTH_UNAVAILABLE');
        await auth.authorize({
          action: 'integration.n8n.command.media.read',
          authorization: request.headers.authorization,
          correlationId: context.correlationId,
        });
        const technical = {};
        for (const [key, header] of [
          ['workflowKey', 'x-silmer-workflow-key'],
          ['workflowVersion', 'x-silmer-workflow-version'],
          ['executionId', 'x-silmer-execution-id'],
        ]) {
          const value = request.headers[header];
          if (
            typeof value !== 'string' ||
            !value ||
            value.length > 128 ||
            /[^\x21-\x7e]/u.test(value)
          )
            throw new N8nRouteError(400, 'INVALID_TECHNICAL_IDENTITY');
          /** @type {any} */ (technical)[key] = value;
        }
        if (request.headers['x-correlation-id'] !== context.correlationId)
          throw new N8nRouteError(400, 'INVALID_CORRELATION_ID');
        const query = /** @type {any} */ (request.query);
        if (
          Object.keys(query).some((key) => key !== 'preflight') ||
          (query.preflight !== undefined && query.preflight !== 'true')
        )
          throw new N8nRouteError(400, 'INVALID_MEDIA_QUERY');
        const row = await integration.readReservedMedia({
          commandId: /** @type {any} */ (request.params).commandId,
          technical,
        });
        if (query.preflight === 'true')
          return reply.send({
            valid: true,
            media_id: row.id,
            type: row.kind,
            sha256: row.content_sha256,
            mime_type: row.detected_mime_type,
            size_bytes: Number(row.size_bytes),
          });
        const result = await media.reservedContent(row);
        for (const [key, value] of Object.entries(result.headers))
          reply.header(key, value);
        return reply.code(result.statusCode).send(result.stream);
      } catch (error) {
        if (/** @type {any} */ (error)?.statusCode === 401)
          reply.header('WWW-Authenticate', 'Basic realm="crm-silmer-n8n"');
        return sendChatMediaProblem(
          reply,
          error,
          contextFor(request).requestId,
        );
      }
    },
  );
}
