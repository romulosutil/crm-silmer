import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { Headers } = globalThis;
const CRM_BUCKETS = ['crm-silmer-chat-media', 'crm-silmer-chat-media-dev'];

/** @param {unknown} condition @param {string} message */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Record<string, string|undefined>} env @param {string} name */
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** @param {Record<string, string|undefined>} env */
export function validateRustfsSmokeEnvironment(env) {
  requireCondition(
    env.RUN_RUSTFS_LIVE_SMOKE === 'yes',
    'Explicit live smoke authorization is required',
  );
  const endpoint = new URL(required(env, 'MEDIA_S3_ENDPOINT'));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
    endpoint.hostname,
  );
  requireCondition(
    endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' && loopback),
    'Endpoint must use HTTPS, except local loopback tests',
  );
  requireCondition(
    endpoint.pathname === '/' &&
      !endpoint.search &&
      !endpoint.hash &&
      !endpoint.username &&
      !endpoint.password,
    'Endpoint must be an origin without credentials, path or query',
  );
  const bucket = required(env, 'MEDIA_S3_BUCKET');
  const deniedBucket = required(env, 'RUSTFS_SMOKE_DENIED_BUCKET');
  requireCondition(
    CRM_BUCKETS.includes(bucket) &&
      (CRM_BUCKETS.includes(deniedBucket) ||
        (loopback && deniedBucket === 'crm-silmer-smoke-denied-local')),
    'Smoke only accepts an isolated CRM bucket pair',
  );
  requireCondition(bucket !== deniedBucket, 'Smoke buckets must be distinct');
  const deniedObjectKey = required(env, 'RUSTFS_SMOKE_DENIED_OBJECT_KEY');
  requireCondition(
    /^compatibility-canary\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
      deniedObjectKey,
    ),
    'Denied object must be a known synthetic canary',
  );
  const digest = required(env, 'RUSTFS_RUNNING_IMAGE_DIGEST');
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(digest),
    'Runtime image digest must be sha256, not an image tag',
  );
  return {
    endpoint: endpoint.origin,
    bucket,
    deniedBucket,
    deniedObjectKey,
    digest,
    region: required(env, 'MEDIA_S3_REGION'),
    accessKeyId: required(env, 'MEDIA_S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'MEDIA_S3_SECRET_ACCESS_KEY'),
    localLoopback: loopback,
    evidencePath:
      env.RUSTFS_SMOKE_EVIDENCE_PATH?.trim() || 'var/rustfs-live-evidence.json',
  };
}

/** @param {string|Uint8Array} value */
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string|Buffer} key @param {string} value */
function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

/** @param {string} value */
function encode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canary-only SigV4 transport. The runtime adapter uses the pinned SDK in T3.
 * @param {ReturnType<typeof validateRustfsSmokeEnvironment>} config
 * @param {typeof fetch} fetchImpl
 * @param {() => Date} now
 */
function transport(config, fetchImpl, now) {
  /** @param {string} method @param {string} bucket @param {string} key @param {{body?: Uint8Array, range?: string, anonymous?: boolean, lifecycle?: boolean}} [options] */
  return async (method, bucket, key, options = {}) => {
    const path = `/${encode(bucket)}/${key.split('/').map(encode).join('/')}`;
    const query = options.lifecycle ? 'lifecycle=' : '';
    const headers = new Headers();
    if (options.range) headers.set('range', options.range);
    if (!options.anonymous) {
      const timestamp = now()
        .toISOString()
        .replace(/[:-]|\.\d{3}/gu, '');
      const date = timestamp.slice(0, 8);
      const payloadHash = hash(options.body ?? '');
      headers.set('host', new URL(config.endpoint).host);
      headers.set('x-amz-content-sha256', payloadHash);
      headers.set('x-amz-date', timestamp);
      if (options.body) {
        headers.set('content-type', 'application/octet-stream');
        headers.set('x-amz-meta-sha256', payloadHash);
      }
      const names = [...headers.keys()].sort();
      const canonicalHeaders = names
        .map((name) => `${name}:${headers.get(name)?.trim()}\n`)
        .join('');
      const signedHeaders = names.join(';');
      const canonicalRequest = [
        method,
        path,
        query,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');
      const scope = `${date}/${config.region}/s3/aws4_request`;
      const toSign = [
        'AWS4-HMAC-SHA256',
        timestamp,
        scope,
        hash(canonicalRequest),
      ].join('\n');
      const key = hmac(
        hmac(
          hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region),
          's3',
        ),
        'aws4_request',
      );
      const signature = createHmac('sha256', key).update(toSign).digest('hex');
      headers.set(
        'authorization',
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      );
    }
    const response = await fetchImpl(
      `${config.endpoint}${path}${query ? `?${query}` : ''}`,
      {
        method,
        headers,
        body: options.body ? Uint8Array.from(options.body) : undefined,
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      },
    );
    return {
      status: response.status,
      headers: response.headers,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  };
}

/** @param {{env?: Record<string, string|undefined>, fetchImpl?: typeof fetch, now?: () => Date, randomUuid?: () => string, writeEvidence?: (value: Record<string, unknown>) => Promise<void>}} [options] */
export async function runRustfsLiveSmoke(options = {}) {
  const config = validateRustfsSmokeEnvironment(options.env ?? process.env);
  const now = options.now ?? (() => new Date());
  const request = transport(config, options.fetchImpl ?? globalThis.fetch, now);
  const key = `compatibility-canary/${(options.randomUuid ?? randomUUID)()}`;
  const body = Buffer.from(
    'CRM Silmer synthetic media canary. No customer data.',
  );
  let stage = 'lifecycle';
  let attemptedPut = false;
  let cleaned = false;
  try {
    const lifecycle = await request('GET', config.bucket, '', {
      lifecycle: true,
    });
    const xml = Buffer.from(lifecycle.body).toString('utf8');
    requireCondition(
      (lifecycle.status === 404 &&
        /<Code>NoSuchLifecycleConfiguration<\/Code>/u.test(xml)) ||
        (lifecycle.status === 200 &&
          !/<Expiration[\s>]|<NoncurrentVersionExpiration[\s>]/u.test(xml)),
      'Bucket lifecycle must not expire retained media',
    );
    stage = 'PUT';
    attemptedPut = true;
    const put = await request('PUT', config.bucket, key, { body });
    requireCondition(put.status === 200, 'PUT must return 200');
    stage = 'HEAD';
    const head = await request('HEAD', config.bucket, key);
    requireCondition(
      head.status === 200 &&
        Number(head.headers.get('content-length')) === body.length &&
        head.headers.get('x-amz-meta-sha256') === hash(body),
      'HEAD must preserve size and SHA-256 metadata',
    );
    stage = 'GET';
    const get = await request('GET', config.bucket, key);
    requireCondition(
      get.status === 200 &&
        get.body.length === body.length &&
        hash(get.body) === hash(body),
      'GET must preserve exact bytes',
    );
    stage = 'Range';
    const range = await request('GET', config.bucket, key, {
      range: 'bytes=0-7',
    });
    requireCondition(
      range.status === 206 &&
        range.headers.get('content-range') === `bytes 0-7/${body.length}` &&
        Buffer.from(range.body).equals(body.subarray(0, 8)),
      'Range must return exact 206 bytes and Content-Range',
    );
    stage = 'invalid Range';
    const invalid = await request('GET', config.bucket, key, {
      range: `bytes=${body.length + 1}-`,
    });
    requireCondition(invalid.status === 416, 'Invalid Range must return 416');
    stage = 'anonymous access';
    const anonymous = await request('GET', config.bucket, key, {
      anonymous: true,
    });
    requireCondition(
      anonymous.status === 403,
      'Anonymous access must return 403',
    );
    stage = 'cross-bucket access';
    const cross = await request('HEAD', config.deniedBucket, '');
    requireCondition(
      cross.status === 403,
      'Cross-bucket access must return 403',
    );
    stage = 'cross-bucket object HEAD';
    const deniedHead = await request(
      'HEAD',
      config.deniedBucket,
      config.deniedObjectKey,
    );
    requireCondition(
      deniedHead.status === 403,
      'Cross-bucket object HEAD must return 403',
    );
    stage = 'cross-bucket object GET';
    const deniedGet = await request(
      'GET',
      config.deniedBucket,
      config.deniedObjectKey,
    );
    requireCondition(
      deniedGet.status === 403,
      'Cross-bucket object GET must return 403',
    );
    stage = 'DELETE';
    const remove = await request('DELETE', config.bucket, key);
    requireCondition(remove.status === 204, 'DELETE must return 204');
    const missing = await request('HEAD', config.bucket, key);
    requireCondition(
      missing.status === 404,
      'Deleted canary HEAD must return 404',
    );
    cleaned = true;
  } catch {
    throw new Error(`RustFS smoke failed at ${stage}; no live PASS recorded`);
  } finally {
    if (attemptedPut && !cleaned) {
      try {
        const remove = await request('DELETE', config.bucket, key);
        requireCondition(remove.status === 204, 'Canary cleanup failed');
      } catch {
        throw new Error(
          'RustFS canary cleanup failed; operator reconciliation required; no live PASS recorded',
        );
      }
    }
  }
  const evidence = {
    schemaVersion: 1,
    task: 'T1',
    capturedAt: now().toISOString(),
    provider: 'RustFS',
    runtimeScope: config.localLoopback
      ? 'local-version-compatibility'
      : 'target-deployment',
    runningImageDigest: config.digest,
    syntheticOnly: true,
    bucket: config.bucket,
    checks: {
      put: true,
      headHashAndSize: true,
      getHashAndSize: true,
      range: true,
      invalidRange: true,
      anonymousDenied: true,
      crossBucketDenied: true,
      crossObjectHeadDenied: true,
      crossObjectGetDenied: true,
      noExpiryLifecycle: true,
      deleteAndMissing: true,
    },
    limitations: [
      'Image digest is operator-supplied; capture docker inspect evidence separately.',
      'Does not prove external backup, restore, host durability or production readiness.',
    ],
  };
  const writeEvidence =
    options.writeEvidence ??
    (async (value) => {
      const output = resolve(config.evidencePath);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {
        flag: 'wx',
      });
    });
  await writeEvidence(evidence);
  return evidence;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runRustfsLiveSmoke()
    .then(() => {
      console.log(
        'RustFS synthetic compatibility smoke passed; sanitized evidence saved.',
      );
    })
    .catch((error) => {
      // Never print provider bodies, URLs, object keys or transport exceptions.
      console.error(
        error instanceof Error ? error.message : 'RustFS smoke failed',
      );
      process.exitCode = 1;
    });
}
