import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { validateMediaDeclaration } from '@crm-silmer/integration-reliability';
import { readChatMediaContent } from './chat-media-content-runtime.js';

/** @param {number} statusCode */
export function mediaError(statusCode) {
  return Object.assign(new Error('Chat media request failed'), {
    statusCode,
    code: 'CHAT_MEDIA_REQUEST_FAILED',
  });
}
/** @param {{repository:any,access:any,spoolRoot:string,envelopeKey:Buffer,removeFile?:Function,store?:any,bucketAlias?:string,admissionEnabled?:boolean,uploadTimeoutMs?:number}} options */
export function createChatMediaApiRuntime({
  repository,
  access,
  spoolRoot,
  envelopeKey,
  store,
  bucketAlias = 'chat-dev',
  admissionEnabled = true,
  uploadTimeoutMs = 120_000,
  removeFile = (/** @type {string} */ path) => rm(path, { force: true }),
}) {
  if (!Buffer.isBuffer(envelopeKey) || envelopeKey.length !== 32)
    throw new TypeError('Media envelope key must contain 32 bytes');
  const root = resolve(spoolRoot);
  if (
    !Number.isSafeInteger(uploadTimeoutMs) ||
    uploadTimeoutMs < 1 ||
    uploadTimeoutMs > 120_000
  )
    throw new TypeError('Invalid upload deadline');
  return {
    admissionEnabled,
    authorize: access.authorize,
    authorizeRead: access.authorizeRead,
    /** @param {any} input */
    content: (input) =>
      readChatMediaContent({ repository, store, bucketAlias }, input),
    /** Technical reader has already checked original reservation and current fence. @param {any} row */
    reservedContent: (row) =>
      readChatMediaContent(
        {
          repository: {
            readForActor: async () => row,
            markLost: (/** @type {any} */ lost) => repository.markLost(lost),
          },
          store,
          bucketAlias,
        },
        { mediaId: row.id },
      ),
    /** @param {any} input */
    async status(input) {
      const row = await repository.readForActor(input);
      return {
        mediaId: row.id,
        kind: row.kind,
        origin: row.origin,
        state: row.state,
        validationStatus: row.validation_status,
        mimeType: row.detected_mime_type ?? null,
        sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
        durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
        ...(row.sanitized_reason ? { reason: row.sanitized_reason } : {}),
      };
    },
    /** @param {any} input */
    async upload(input) {
      const { maxBytes } = validateMediaDeclaration(input);
      const id = randomUUID();
      let admitted = false;
      let committed = false;
      let completionAttempted = false;
      const path = join(root, id);
      try {
        const reservationBytes =
          input.origin === 'recording' ? 3 * 16 * 1024 * 1024 : maxBytes * 2;
        const admission = await repository.admit({
          ...input,
          id,
          reservationBytes,
        });
        const replay = admission?.replay;
        admitted = !replay;
        if (!replay) await mkdir(root, { recursive: true, mode: 0o700 });
        let sizeBytes = 0;
        const hash = createHash('sha256');
        const bounded = new Transform({
          transform(chunk, _encoding, callback) {
            sizeBytes += chunk.length;
            if (sizeBytes > maxBytes) return callback(mediaError(413));
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        const receive = async (
          /** @type {AbortSignal|undefined} */ leaseSignal,
        ) => {
          const destination = replay
            ? new Writable({
                write(_chunk, _encoding, callback) {
                  callback();
                },
              })
            : createWriteStream(path, { flags: 'wx', mode: 0o600 });
          const controller = new AbortController();
          /** @type {(error: Error) => void} */ let rejectAborted = () => {};
          const aborted = new Promise((_resolve, reject) => {
            rejectAborted = reject;
          });
          const abort = () => {
            controller.abort();
            rejectAborted(mediaError(503));
          };
          leaseSignal?.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(abort, uploadTimeoutMs);
          if (leaseSignal?.aborted) abort();
          const operations = [
            pipeline(input.stream, bounded, destination, {
              signal: controller.signal,
            }),
            input.finishMultipart(),
          ];
          try {
            await Promise.race([Promise.all(operations), aborted]);
          } catch (error) {
            controller.abort();
            input.stream.destroy();
            // A malformed parser can leave next() pending after destroying its
            // file. Wait for the file writer to close before removing the spool.
            destination.destroy();
            await finished(destination).catch(() => undefined);
            if (/** @type {any} */ (error)?.statusCode) throw error;
            if (
              /** @type {any} */ (error)?.code &&
              /** @type {any} */ (error).code !== 'ERR_STREAM_PREMATURE_CLOSE'
            )
              throw mediaError(503);
            throw mediaError(422);
          } finally {
            clearTimeout(timer);
            leaseSignal?.removeEventListener('abort', abort);
          }
        };
        // The lease ends after FD close, before SQL completion/release needs a
        // pool connection. No BEGIN or second client is held during the stream.
        if (!replay && repository.withUploadLease)
          await repository.withUploadLease(id, receive);
        else await receive(undefined);
        if (input.stream.truncated) throw mediaError(413);
        if (sizeBytes === 0) throw mediaError(422);
        const sha256 = hash.digest('hex');
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify([
              input.conversationId,
              input.actor.id,
              input.expectedVersion,
              input.kind,
              input.origin,
              input.declaredMimeType,
              input.filename,
              sizeBytes,
              sha256,
            ]),
          )
          .digest('hex');
        if (replay) {
          if (replay.request_fingerprint !== fingerprint) throw mediaError(409);
          return {
            mediaId: replay.id,
            state: 'processing',
            statusUrl: `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/media/${replay.id}`,
          };
        }
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', envelopeKey, iv);
        cipher.setAAD(Buffer.from(`chat-media-filename:${id}`));
        const ciphertext = Buffer.concat([
          cipher.update(JSON.stringify({ filename: input.filename })),
          cipher.final(),
        ]);
        completionAttempted = true;
        const result = await repository.complete({
          ...input,
          id,
          sizeBytes,
          sha256,
          fingerprint,
          reservationBytes:
            input.origin === 'recording'
              ? sizeBytes + 32 * 1024 * 1024
              : sizeBytes * 2,
          filenameEnvelope: {
            algorithm: 'AES-256-GCM',
            keyVersion: 1,
            version: 1,
            iv: iv.toString('base64url'),
            tag: cipher.getAuthTag().toString('base64url'),
            ciphertext: ciphertext.toString('base64url'),
          },
        });
        if (!result.duplicate) committed = true;
        else {
          await removeFile(path);
          await repository.release(id);
          admitted = false;
        }
        return {
          mediaId: result.mediaId,
          state: 'processing',
          statusUrl: `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/media/${result.mediaId}`,
        };
      } catch (error) {
        if (admitted && !committed) {
          if (completionAttempted) {
            let disposition;
            try {
              disposition = await repository.cleanupDisposition(id);
            } catch {
              throw mediaError(503);
            }
            if (disposition !== 'receiving') throw mediaError(503);
          }
          // Failed cleanup intentionally preserves the durable reservation.
          try {
            await removeFile(path);
            await repository.release(id);
          } catch {
            throw mediaError(503);
          }
        }
        const status = Number(/** @type {any} */ (error)?.statusCode);
        throw mediaError(
          [403, 409, 413, 422, 429].includes(status) ? status : 503,
        );
      }
    },
  };
}
