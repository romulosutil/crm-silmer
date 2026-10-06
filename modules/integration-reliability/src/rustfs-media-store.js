import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { finished } from 'node:stream/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export class MediaStorageUnavailableError extends Error {
  /** @param {string} [message] */
  constructor(message = 'Private media storage is unavailable') {
    super(message);
    this.name = 'MediaStorageUnavailableError';
    this.code = 'MEDIA_STORAGE_UNAVAILABLE';
  }
}
export class MediaObjectMissingError extends Error {
  constructor() {
    super('Private media object is missing');
    this.name = 'MediaObjectMissingError';
    this.code = 'MEDIA_OBJECT_MISSING';
  }
}
export class MediaInvalidRangeError extends Error {
  constructor() {
    super('Private media range is invalid');
    this.name = 'MediaInvalidRangeError';
    this.code = 'MEDIA_INVALID_RANGE';
  }
}

/** @param {unknown} error */
function sanitized(error) {
  const status = /** @type {any} */ (error)?.$metadata?.httpStatusCode;
  if (status === 404) return new MediaObjectMissingError();
  if (status === 416) return new MediaInvalidRangeError();
  return new MediaStorageUnavailableError();
}
/** @param {string} key */
function validateKey(key) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(key)
  )
    throw new TypeError('Invalid private media key');
}
/** @param {any} output */
function metadata(output) {
  const sha256 = output.Metadata?.sha256;
  if (
    !Number.isSafeInteger(output.ContentLength) ||
    output.ContentLength < 1 ||
    !/^[a-f0-9]{64}$/u.test(sha256 ?? '') ||
    typeof output.ContentType !== 'string'
  )
    throw new MediaStorageUnavailableError();
  return {
    sizeBytes: Number(output.ContentLength),
    sha256: String(sha256),
    mimeType: output.ContentType,
  };
}

export class RustfsMediaStore {
  #client;
  #bucket;
  #timeoutMs;

  /** @param {{bucket: string, client?: {send: (command: any, options?: any) => Promise<any>}, endpoint?: string, region?: string, accessKeyId?: string, secretAccessKey?: string, timeoutMs?: number}} options */
  constructor({
    bucket,
    client,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    timeoutMs = 30_000,
  }) {
    if (
      !['crm-silmer-chat-media', 'crm-silmer-chat-media-dev'].includes(bucket)
    )
      throw new TypeError('An isolated CRM bucket is required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new TypeError('timeoutMs must be positive');
    if (!client) {
      if (!endpoint || !region || !accessKeyId || !secretAccessKey)
        throw new TypeError('Private media S3 configuration is incomplete');
      const url = new URL(endpoint);
      if (
        (url.protocol !== 'https:' &&
          !(
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
          )) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new TypeError('Private media endpoint must be a secure origin');
      client = new S3Client({
        endpoint: url.origin,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        maxAttempts: 1,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
    this.#client = client;
    this.#bucket = bucket;
    this.#timeoutMs = timeoutMs;
  }

  /** @param {{key: string, stream: AsyncIterable<Uint8Array>, sizeBytes: number, sha256: string, mimeType: string,signal?:AbortSignal}} input */
  async putValidated({ key, stream, sizeBytes, sha256, mimeType, signal }) {
    validateKey(key);
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > 16 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      ![
        'image/jpeg',
        'image/png',
        'audio/mpeg',
        'audio/ogg',
        'audio/mp4',
        'video/mp4',
      ].includes(mimeType)
    )
      throw new TypeError('Invalid validated media metadata');
    const digest = createHash('sha256');
    let count = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        count += chunk.length;
        if (count > sizeBytes)
          return callback(new Error('Unable to store private media'));
        digest.update(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        callback(
          count !== sizeBytes || digest.digest('hex') !== sha256
            ? new Error('Unable to store private media')
            : null,
        );
      },
    });
    const source = Readable.from(stream);
    source.on('error', () =>
      verifier.destroy(new Error('Unable to store private media')),
    );
    source.pipe(verifier);
    try {
      await Promise.all([
        finished(verifier),
        this.#client.send(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: key,
            Body: verifier,
            ContentLength: sizeBytes,
            ContentType: mimeType,
            Metadata: { sha256 },
            IfNoneMatch: '*',
            ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
          }),
          {
            abortSignal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
              : AbortSignal.timeout(this.#timeoutMs),
          },
        ),
      ]);
      return { sizeBytes, sha256 };
    } catch (error) {
      if (/** @type {any} */ (error)?.$metadata?.httpStatusCode === 412) {
        const existing = await this.head(key, signal);
        if (
          existing.sizeBytes === sizeBytes &&
          existing.sha256 === sha256 &&
          existing.mimeType === mimeType
        )
          return { sizeBytes, sha256 };
      }
      throw new MediaStorageUnavailableError('Unable to store private media');
    } finally {
      source.destroy();
      verifier.destroy();
      await Promise.allSettled([finished(source), finished(verifier)]);
    }
  }

  /** @param {string} key @param {AbortSignal} [signal] */
  async head(key, signal) {
    validateKey(key);
    try {
      return metadata(
        await this.#client.send(
          new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
          {
            abortSignal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
              : AbortSignal.timeout(this.#timeoutMs),
          },
        ),
      );
    } catch (error) {
      throw sanitized(error);
    }
  }

  /** @param {string} key @param {string} [range] */
  async read(key, range) {
    validateKey(key);
    if (range !== undefined && !/^bytes=(?:\d+-\d*|-\d+)$/u.test(range))
      throw new MediaInvalidRangeError();
    try {
      const output = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          ...(range === undefined ? {} : { Range: range }),
        }),
        { abortSignal: AbortSignal.timeout(this.#timeoutMs) },
      );
      const details = metadata(output);
      if (
        !output.Body ||
        typeof output.Body[Symbol.asyncIterator] !== 'function'
      )
        throw new MediaStorageUnavailableError();
      async function* safeBytes() {
        try {
          for await (const chunk of output.Body) yield Buffer.from(chunk);
        } catch {
          throw new MediaStorageUnavailableError();
        }
      }
      return {
        ...details,
        contentRange:
          typeof output.ContentRange === 'string' ? output.ContentRange : null,
        stream: Readable.from(safeBytes()),
      };
    } catch (error) {
      throw sanitized(error);
    }
  }

  /** Caller must lock/recheck message_id IS NULL before invoking. @param {string} key */
  async deleteDraft(key) {
    validateKey(key);
    try {
      await this.#client.send(
        new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(this.#timeoutMs) },
      );
    } catch (error) {
      throw sanitized(error);
    }
  }
}
