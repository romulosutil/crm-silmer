import { createReadStream } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';

import {
  ChatMediaValidator,
  ChatMediaValidationError,
} from './chat-media-validation.js';
import { RecordedAudioNormalizer } from './recorded-audio-normalizer.js';
import {
  MediaObjectMissingError,
  MediaStorageUnavailableError,
} from './rustfs-media-store.js';

export const CHAT_MEDIA_PROCESS_JOB_TYPE = 'chat_media.process';
export const CHAT_MEDIA_QUEUE = 'chat_media';
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const MAX_RECORDING_BYTES = 16 * 1024 * 1024;
/** @param {string} root @param {unknown} key */
function spoolPath(root, key) {
  if (typeof key !== 'string' || !UUID.test(key))
    throw new ChatMediaValidationError('processing_failed');
  return join(root, key);
}
/** @param {Record<string,any>} row @param {Record<string,any>} object */
function matches(row, object) {
  return (
    Number(row.size_bytes) === object.sizeBytes &&
    row.content_sha256 === object.sha256 &&
    row.detected_mime_type === object.mimeType
  );
}

/** @param {{repository: {acquire: Function,prepare: Function,ready: Function,fail: Function},store: {head: Function,putValidated: Function},spoolRoot: string,bucketAlias?: string,validator?: {validate: Function},normalizer?: {normalize: Function},heartbeatIntervalMs?: number,removeFile?: Function}} options */
export function createChatMediaProcessJobHandler({
  repository,
  store,
  spoolRoot,
  bucketAlias = 'chat-dev',
  validator = new ChatMediaValidator(),
  normalizer = new RecordedAudioNormalizer(),
  heartbeatIntervalMs = 5000,
  removeFile = (/** @type {string} */ path) => rm(path, { force: true }),
}) {
  const root = resolve(spoolRoot);
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1)
    throw new TypeError('Invalid media heartbeat interval');
  let tail = Promise.resolve();
  /** @param {Record<string,any>} job @param {{heartbeat: () => Promise<boolean>}} context */
  async function process(job, context) {
    let lost = false;
    /** @type {Promise<void>|undefined} */ let heartbeatInFlight;
    let row;
    const renew = async () => {
      try {
        if (!(await context.heartbeat())) lost = true;
      } catch {
        lost = true;
      }
    };
    const assertLease = async () => {
      await heartbeatInFlight;
      await renew();
      if (lost) throw new ChatMediaValidationError('processing_failed');
    };
    const timer = setInterval(() => {
      if (!heartbeatInFlight)
        heartbeatInFlight = renew().finally(() => {
          heartbeatInFlight = undefined;
        });
    }, heartbeatIntervalMs);
    timer.unref();
    try {
      await assertLease();
      row = await repository.acquire(job);
      if (!row || ['ready', 'attached', 'rejected', 'lost'].includes(row.state))
        return { outcome: /** @type {const} */ ('sent') };
      if (!row.declared_mime_type)
        throw new ChatMediaValidationError('invalid_format');
      if (row.storage_bucket_alias !== bucketAlias)
        throw new MediaStorageUnavailableError();
      const source = spoolPath(root, row.spool_key);
      const output =
        row.origin === 'recording' ? spoolPath(root, row.object_key) : source;
      const minimum =
        Number(row.input_size_bytes) +
        (row.origin === 'recording'
          ? 2 * MAX_RECORDING_BYTES
          : Number(row.input_size_bytes));
      if (Number(row.reservation_bytes) < minimum)
        throw new ChatMediaValidationError('quota_exceeded');

      if (!row.content_sha256) {
        if ((await lstat(source)).size !== Number(row.input_size_bytes))
          throw new ChatMediaValidationError('invalid_format');
        let result;
        if (row.origin === 'recording') {
          // Reuse an already published local variant after a crash before metadata
          // commit; encoding an OGG again could change its serial/hash.
          let existing = false;
          try {
            existing = (await lstat(output)).isFile();
          } catch (error) {
            if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
          }
          if (existing) {
            const original = await validator.validate({
              path: source,
              kind: row.kind,
              origin: row.origin,
              declaredMimeType: row.declared_mime_type,
            });
            result = {
              ...(await validator.validate({
                path: output,
                kind: 'audio',
                origin: 'recording',
                declaredMimeType: 'audio/ogg',
              })),
              originalSha256: original.sha256,
            };
          } else
            result = await normalizer.normalize({
              path: source,
              declaredMimeType: row.declared_mime_type,
              outputPath: output,
            });
        } else {
          result = await validator.validate({
            path: source,
            kind: row.kind,
            origin: row.origin,
            declaredMimeType: row.declared_mime_type,
          });
          result.originalSha256 = result.sha256;
        }
        await assertLease();
        if (
          row.original_sha256 &&
          row.original_sha256 !== result.originalSha256
        )
          throw new ChatMediaValidationError('invalid_format');
        if (row.origin === 'recording' && result.audioChannels !== 1)
          throw new ChatMediaValidationError('invalid_format');
        row = await repository.prepare(job, row, result);
        if (!row) throw new ChatMediaValidationError('processing_failed');
      }
      let object;
      try {
        object = await store.head(String(row.object_key));
      } catch (error) {
        if (!(error instanceof MediaObjectMissingError)) throw error;
      }
      if (!object) {
        const validation = await validator.validate({
          path: output,
          kind: row.kind,
          origin: row.origin,
          declaredMimeType: row.detected_mime_type,
        });
        if (!matches(row, validation)) throw new MediaStorageUnavailableError();
        await assertLease();
        // Internal immutable object effect: do not mark the generic Meta attempt
        // as sending/unknown. A retry performs HEAD/conditional PUT reconciliation.
        await store.putValidated({
          key: String(row.object_key),
          stream: createReadStream(output),
          sizeBytes: Number(row.size_bytes),
          sha256: row.content_sha256,
          mimeType: row.detected_mime_type,
        });
        object = await store.head(String(row.object_key));
      }
      if (!matches(row, object)) throw new MediaStorageUnavailableError();
      await assertLease();
      // Hold the full reservation until all local copies are confirmed removed.
      await removeFile(source);
      if (output !== source) await removeFile(output);
      await assertLease();
      if (!(await repository.ready(job, row)))
        throw new ChatMediaValidationError('processing_failed');
      return { outcome: /** @type {const} */ ('sent') };
    } catch (error) {
      const reason =
        error instanceof MediaStorageUnavailableError
          ? 'storage_unavailable'
          : error instanceof ChatMediaValidationError
            ? error.reason
            : 'processing_failed';
      const terminal = ['infected', 'invalid_format'].includes(reason);
      let persisted = false;
      if (row && !lost) {
        try {
          persisted = (await repository.fail(job, row, reason)) === true;
        } catch {
          /* Preserve prepared metadata/reservation on DB failure. */
        }
      }
      return terminal && persisted
        ? { outcome: /** @type {const} */ ('sent') }
        : {
            outcome: /** @type {const} */ ('failed'),
            errorCode: lost ? 'MEDIA_LEASE_LOST' : 'MEDIA_PROCESS_UNAVAILABLE',
            retryable: true,
            retrySafe: true,
          };
    } finally {
      clearInterval(timer);
      await heartbeatInFlight;
    }
  }
  /** @param {Record<string,any>} job @param {{heartbeat: () => Promise<boolean>}} context */
  return async (job, context) => {
    const previous = tail;
    /** @type {() => void} */ let release = () => {};
    tail = new Promise((done) => {
      release = done;
    });
    await previous;
    try {
      return await process(job, context);
    } finally {
      release();
    }
  };
}
