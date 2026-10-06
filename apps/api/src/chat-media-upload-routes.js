import multipart from '@fastify/multipart';
import { mediaError } from './chat-media-runtime.js';
import { authorizeChatMediaRead } from './chat-media-status-routes.js';

/** @param {import('fastify').FastifyInstance} api @param {any} media @param {Function} contextFor */
export function registerChatMediaUploadRoutes(api, media, contextFor) {
  api.register(async (scope) => {
    await scope.register(multipart, {
      limits: {
        files: 1,
        fields: 3,
        parts: 4,
        fieldSize: 128,
        fileSize: 16 * 1024 * 1024,
        fieldNameSize: 32,
      },
    });
    scope.setErrorHandler((error, request, reply) => {
      const raw = Number(/** @type {any} */ (error).statusCode);
      const code = String(/** @type {any} */ (error).code ?? '');
      const status = code.includes('FILE_TOO_LARGE')
        ? 413
        : code.startsWith('FST_')
          ? 422
          : [401, 403, 409, 413, 429].includes(raw)
            ? raw
            : raw >= 500 || !Number.isSafeInteger(raw)
              ? 503
              : 422;
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .code(status)
        .type('application/problem+json')
        .send({
          accepted: false,
          error: {
            code: /** @type {Record<number,string>} */ ({
              401: 'INVALID_CREDENTIALS',
              403: 'FORBIDDEN',
              409: 'MEDIA_CONFLICT',
              413: 'MEDIA_TOO_LARGE',
              422: 'MEDIA_INVALID',
              429: 'MEDIA_RATE_LIMITED',
              503: 'SERVICE_UNAVAILABLE',
            })[status],
          },
          type: 'about:blank',
          title: 'Chat media request failed',
          status,
          request_id: contextFor(request).requestId,
        });
    });
    scope.post(
      '/api/v1/conversations/:conversationId/media',
      async (request, reply) => {
        if (request.headers.authorization !== undefined) throw mediaError(403);
        if (!/(?:^|;\s*)crm_session=[^;]+/u.test(request.headers.cookie ?? ''))
          throw mediaError(401);
        const key = request.headers['idempotency-key'];
        if (
          typeof key !== 'string' ||
          key.length < 1 ||
          key.length > 512 ||
          /[\u0000-\u001f\u007f]/u.test(key)
        )
          throw mediaError(422);
        const context = contextFor(request);
        await authorizeChatMediaRead(request, media);
        const principal = await media.authorize({
          action: 'conversation.message.send',
          cookie: request.headers.cookie,
          csrfToken: request.headers['x-csrf-token'],
          origin: request.headers.origin,
          correlationId: context.correlationId,
        });
        if (principal.actor.kind !== 'human') throw mediaError(403);
        const parts = request.parts();
        const fields = /** @type {Record<string,string>} */ ({});
        let file;
        while (true) {
          const next = await parts.next().catch(() => {
            throw mediaError(422);
          });
          if (next.done) break;
          const part = next.value;
          if (part.type === 'file') {
            file = part;
            break;
          }
          if (
            !['kind', 'origin', 'expectedVersion'].includes(part.fieldname) ||
            Object.hasOwn(fields, part.fieldname) ||
            typeof part.value !== 'string'
          )
            throw mediaError(422);
          fields[part.fieldname] = part.value;
        }
        const expectedVersion = Number(fields.expectedVersion);
        if (
          !file ||
          file.fieldname !== 'file' ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1 ||
          !/^\d+$/u.test(fields.expectedVersion ?? '')
        )
          throw mediaError(422);
        const params = /** @type {any} */ (request.params);
        const result = await media.upload({
          actor: principal.actor,
          conversationId: params.conversationId,
          idempotencyKey: key,
          expectedVersion,
          kind: fields.kind,
          origin: fields.origin,
          declaredMimeType: file.mimetype,
          filename: file.filename,
          sessionHash: /(?:^|;\s*)crm_session=([^;]+)/u
            .exec(request.headers.cookie ?? '')?.[1]
            .trim(),
          stream: file.file,
          finishMultipart: async () => {
            if (!(await parts.next()).done) throw mediaError(422);
          },
        });
        return reply.code(202).send(result);
      },
    );
  });
}
