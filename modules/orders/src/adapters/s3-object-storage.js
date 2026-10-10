import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

// ADR 023: the art files live in RustFS, reached only by the API on the
// internal network. RustFS speaks S3, so this adapter signs the four calls the
// orders module needs with AWS Signature V4 and path-style URLs, without an
// SDK dependency.

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 30_000;

/** Storage could not answer (503); the page offers a new attempt. */
export class ObjectStorageUnavailableError extends Error {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, options) {
    super(message, options);
    this.name = 'ObjectStorageUnavailableError';
    this.code = 'FILE_STORAGE_UNAVAILABLE';
    this.statusCode = 503;
  }
}

/** @param {string|Uint8Array} value */
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string|Buffer} key @param {string} value */
function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

/** @param {string} value */
function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** @param {Date} date */
function awsTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

/**
 * @typedef {{
 *   endpoint: string,
 *   region: string,
 *   bucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   fetch?: typeof globalThis.fetch,
 *   clock?: () => Date,
 * }} S3ObjectStorageOptions
 */

export class S3ObjectStorage {
  /** @type {URL} */
  #endpoint;
  /** The endpoint path without trailing slashes. */
  #basePath;
  #region;
  #bucket;
  #accessKeyId;
  #secretAccessKey;
  #fetch;
  #clock;
  /** @type {Promise<void>|null} */
  #bucketReady = null;

  /** @param {S3ObjectStorageOptions} options */
  constructor(options) {
    const endpoint = new URL(options.endpoint);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username
    ) {
      throw new TypeError('object storage endpoint must be a plain origin');
    }
    for (const name of /** @type {const} */ ([
      'region',
      'bucket',
      'accessKeyId',
      'secretAccessKey',
    ])) {
      if (typeof options[name] !== 'string' || options[name].trim() === '') {
        throw new TypeError(`object storage ${name} is required`);
      }
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(options.bucket)) {
      throw new TypeError('object storage bucket name is invalid');
    }
    this.#endpoint = endpoint;
    let basePath = endpoint.pathname;
    while (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
    this.#basePath = basePath;
    this.#region = options.region.trim();
    this.#bucket = options.bucket;
    this.#accessKeyId = options.accessKeyId.trim();
    this.#secretAccessKey = options.secretAccessKey.trim();
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * Creates the private bucket on first start; an existing one is kept.
   */
  async ensureBucket() {
    const head = await this.#send('HEAD', '');
    if (head.ok) return;
    if (head.status !== 404) throw this.#failure('HEAD bucket', head.status);
    const created = await this.#send('PUT', '');
    if (created.ok || created.status === 409) return;
    throw this.#failure('PUT bucket', created.status);
  }

  /**
   * The first write creates the bucket when needed, so a fresh RustFS needs
   * no manual step; a failed attempt is retried on the next write.
   *
   * @param {string} key @param {Buffer} body @param {string} contentType
   */
  async putObject(key, body, contentType) {
    this.#bucketReady ??= this.ensureBucket().catch((error) => {
      this.#bucketReady = null;
      throw error;
    });
    await this.#bucketReady;
    const response = await this.#send('PUT', key, {
      body,
      headers: { 'content-type': contentType },
    });
    if (!response.ok) throw this.#failure('PUT object', response.status);
  }

  /**
   * The object as a Node stream, or null when it does not exist.
   *
   * @param {string} key
   * @returns {Promise<{stream: Readable, contentLength: number|null}|null>}
   */
  async getObject(key) {
    const response = await this.#send('GET', key);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.body) {
      throw this.#failure('GET object', response.status);
    }
    const length = Number(response.headers.get('content-length'));
    return {
      contentLength: Number.isSafeInteger(length) ? length : null,
      stream: Readable.fromWeb(/** @type {any} */ (response.body)),
    };
  }

  /** Deleting a missing object is not an error. @param {string} key */
  async deleteObject(key) {
    const response = await this.#send('DELETE', key);
    if (!response.ok && response.status !== 404) {
      throw this.#failure('DELETE object', response.status);
    }
  }

  /** @param {string} operation @param {number} status */
  #failure(operation, status) {
    return new ObjectStorageUnavailableError(
      `Object storage ${operation} answered ${status}`,
    );
  }

  /**
   * @param {string} method
   * @param {string} key
   * @param {{body?: Buffer, headers?: Record<string, string>}} [options]
   */
  async #send(method, key, options = {}) {
    const path = [
      this.#basePath,
      awsEncode(this.#bucket),
      ...(key ? key.split('/').map(awsEncode) : []),
    ].join('/');
    const url = new URL(path, this.#endpoint);
    const now = this.#clock();
    const amzDate = awsTimestamp(now);
    const day = amzDate.slice(0, 8);
    const payloadHash = options.body ? sha256Hex(options.body) : EMPTY_SHA256;
    /** @type {Record<string, string>} */
    const headers = {
      ...options.headers,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const names = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      ...names.map((name) => `${name}:${String(headers[name]).trim()}`),
      '',
      names.join(';'),
      payloadHash,
    ].join('\n');
    const scope = `${day}/${this.#region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      ALGORITHM,
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = hmac(
      hmac(
        hmac(hmac(`AWS4${this.#secretAccessKey}`, day), this.#region),
        SERVICE,
      ),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    // fetch sets Host itself; it is signed but not sent by hand.
    const sent = Object.fromEntries(
      Object.entries(headers).filter(([name]) => name !== 'host'),
    );
    try {
      return await this.#fetch(url, {
        body: options.body ? new Uint8Array(options.body) : undefined,
        headers: {
          ...sent,
          authorization: `${ALGORITHM} Credential=${this.#accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
        },
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ObjectStorageUnavailableError(
        `Object storage ${method} failed`,
        { cause: error },
      );
    }
  }
}

/**
 * Reads the OBJECT_STORAGE_* variables. All absent disables the art files;
 * a partial configuration is a startup error.
 *
 * @param {Record<string, string|undefined>} environment
 * @param {{fetch?: typeof globalThis.fetch}} [options]
 */
export function objectStorageFromEnvironment(environment, options = {}) {
  const names = /** @type {const} */ ([
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_REGION',
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  ]);
  const present = names.filter((name) => Boolean(environment[name]?.trim()));
  if (present.length === 0) return undefined;
  if (present.length !== names.length) {
    throw new Error(
      `Object storage needs ${names.filter((name) => !present.includes(name)).join(', ')}`,
    );
  }
  return new S3ObjectStorage({
    accessKeyId: /** @type {string} */ (
      environment.OBJECT_STORAGE_ACCESS_KEY_ID
    ),
    bucket: /** @type {string} */ (environment.OBJECT_STORAGE_BUCKET).trim(),
    endpoint: /** @type {string} */ (environment.OBJECT_STORAGE_ENDPOINT),
    fetch: options.fetch,
    region: /** @type {string} */ (environment.OBJECT_STORAGE_REGION),
    secretAccessKey: /** @type {string} */ (
      environment.OBJECT_STORAGE_SECRET_ACCESS_KEY
    ),
  });
}
