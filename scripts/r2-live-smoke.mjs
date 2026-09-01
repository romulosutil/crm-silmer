import {
  createHash,
  createHmac,
  randomUUID as nodeRandomUuid,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertR2LiveExecutionAuthorized } from './validate-r2.mjs';

const { Headers, TextDecoder, TextEncoder } = globalThis;

const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';
const AWS_REGION = 'auto';
const AWS_SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const MAX_SIGNED_URL_TTL_SECONDS = 300;
const BACKUP_MAX_AGE_SECONDS = 35 * 24 * 60 * 60;
const TOMBSTONE_MIN_AGE_SECONDS = 36 * 24 * 60 * 60;
const BUCKETS = Object.freeze({
  data: 'crm-silmer-data',
  backups: 'crm-silmer-backups',
  tombstones: 'crm-silmer-tombstones',
});
const FORBIDDEN_OBJECT_LOCK_HEADER = /^x-amz-(?:bucket-)?object-lock(?:-|$)/iu;

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Record<string, string|undefined>} env @param {string} name */
function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

/** @param {Record<string, string|undefined>} env @param {string} name */
function positiveInteger(env, name) {
  const value = Number.parseInt(required(env, name), 10);
  invariant(Number.isInteger(value) && value > 0, `${name} must be positive`);
  return value;
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

/** @param {Record<string, string>} query */
function canonicalQuery(query) {
  return Object.entries(query)
    .map(([name, value]) => [awsEncode(name), awsEncode(value)])
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue)
        : leftName.localeCompare(rightName),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** @param {string} key */
function canonicalObjectPath(key) {
  return key
    .split('/')
    .map((part) => awsEncode(part))
    .join('/');
}

/** @param {Date} date */
function awsTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

/** @param {Date} date */
function awsDate(date) {
  return awsTimestamp(date).slice(0, 8);
}

/** @param {string} value */
function canonicalHeaderValue(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

/** @param {Record<string, string>} headers */
export function assertNoS3ObjectLockHeaders(headers) {
  for (const name of Object.keys(headers)) {
    invariant(
      !FORBIDDEN_OBJECT_LOCK_HEADER.test(name),
      `R2 request must not use unsupported S3 Object Lock header ${name}`,
    );
  }
  return headers;
}

/**
 * @param {Record<string, string|undefined>} env
 */
export function validateR2LiveEnvironment(env) {
  const accountId = required(env, 'CLOUDFLARE_ACCOUNT_ID');
  const jurisdiction = required(env, 'R2_JURISDICTION');
  invariant(
    ['default', 'eu', 'us', 'fedramp'].includes(jurisdiction),
    'R2_JURISDICTION must be default, eu, us, or fedramp',
  );
  const endpoint = new URL(required(env, 'R2_S3_ENDPOINT'));
  invariant(endpoint.protocol === 'https:', 'R2 endpoint must use HTTPS');
  invariant(
    endpoint.pathname === '/' && !endpoint.search && !endpoint.hash,
    'R2 endpoint must be an origin without path or query',
  );
  const expectedHostname = `${accountId}${
    jurisdiction === 'default' ? '' : `.${jurisdiction}`
  }.r2.cloudflarestorage.com`;
  invariant(
    endpoint.hostname === expectedHostname,
    'R2 endpoint must match the Cloudflare account and jurisdiction exactly',
  );
  const bucketNames = {
    data: required(env, 'R2_DATA_BUCKET'),
    backups: required(env, 'R2_BACKUP_BUCKET'),
    tombstones: required(env, 'R2_TOMBSTONE_BUCKET'),
  };
  invariant(
    JSON.stringify(bucketNames) === JSON.stringify(BUCKETS),
    'R2 live smoke requires the canonical three buckets',
  );
  invariant(
    new Set(Object.values(bucketNames)).size === 3,
    'R2 bucket names must be distinct',
  );
  const credentials = {
    data: {
      accessKeyId: required(env, 'R2_DATA_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'R2_DATA_SECRET_ACCESS_KEY'),
    },
    backups: {
      accessKeyId: required(env, 'R2_BACKUP_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'R2_BACKUP_SECRET_ACCESS_KEY'),
    },
    tombstoneWrite: {
      accessKeyId: required(env, 'R2_TOMBSTONE_WRITE_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'R2_TOMBSTONE_WRITE_SECRET_ACCESS_KEY'),
    },
    tombstoneRead: {
      accessKeyId: required(env, 'R2_TOMBSTONE_READ_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'R2_TOMBSTONE_READ_SECRET_ACCESS_KEY'),
    },
  };
  invariant(
    new Set(Object.values(credentials).map(({ accessKeyId }) => accessKeyId))
      .size === 4,
    'R2 access keys must be distinct by class and role',
  );
  invariant(
    new Set(
      Object.values(credentials).map(({ secretAccessKey }) => secretAccessKey),
    ).size === 4,
    'R2 secret keys must be distinct by class and role',
  );
  const signedUrlTtlSeconds = positiveInteger(env, 'R2_SIGNED_URL_TTL_SECONDS');
  invariant(
    signedUrlTtlSeconds <= MAX_SIGNED_URL_TTL_SECONDS,
    `R2 signed URL TTL must be <= ${MAX_SIGNED_URL_TTL_SECONDS} seconds`,
  );
  const lockMinimumSeconds = positiveInteger(
    env,
    'R2_TOMBSTONE_LOCK_MIN_SECONDS',
  );
  invariant(
    lockMinimumSeconds >= TOMBSTONE_MIN_AGE_SECONDS,
    `R2 tombstone lock must retain objects for at least ${TOMBSTONE_MIN_AGE_SECONDS} seconds`,
  );
  return {
    accountId,
    apiToken: required(env, 'CLOUDFLARE_API_TOKEN'),
    bucketNames,
    credentials,
    endpoint: endpoint.origin,
    evidencePath:
      env.R2_LIVE_EVIDENCE_PATH?.trim() || 'var/r2-live-evidence.json',
    jurisdiction,
    lockMinimumSeconds,
    signedUrlTtlSeconds,
  };
}

/**
 * @param {{
 *   endpoint: string,
 *   credentials: {accessKeyId: string, secretAccessKey: string},
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 * }} options
 */
export function createR2S3Client({
  endpoint,
  credentials,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const origin = new URL(endpoint);

  /**
   * @param {{
   *   method: string,
   *   bucket: string,
   *   key?: string,
   *   query?: Record<string, string>,
   *   headers?: Record<string, string>,
   *   body?: string|Uint8Array,
   *   simulateResponseLoss?: boolean,
   * }} input
   */
  async function request({
    method,
    bucket,
    key = '',
    query = {},
    headers = {},
    body,
    simulateResponseLoss = false,
  }) {
    assertNoS3ObjectLockHeaders(headers);
    const date = now();
    const timestamp = awsTimestamp(date);
    const dateStamp = awsDate(date);
    const url = new URL(origin);
    url.pathname = `/${awsEncode(bucket)}${key ? `/${canonicalObjectPath(key)}` : ''}`;
    const queryString = canonicalQuery(query);
    url.search = queryString;
    const payloadHash = body === undefined ? EMPTY_SHA256 : sha256Hex(body);
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name.toLowerCase(),
        canonicalHeaderValue(value),
      ]),
    );
    normalizedHeaders.host = url.host;
    normalizedHeaders['x-amz-content-sha256'] = payloadHash;
    normalizedHeaders['x-amz-date'] = timestamp;
    const headerEntries = Object.entries(normalizedHeaders).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const canonicalHeaders = headerEntries
      .map(([name, value]) => `${name}:${value}\n`)
      .join('');
    const signedHeaders = headerEntries.map(([name]) => name).join(';');
    const canonicalRequest = [
      method.toUpperCase(),
      url.pathname,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
    const stringToSign = [
      AWS_ALGORITHM,
      timestamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, AWS_REGION);
    const serviceKey = hmac(regionKey, AWS_SERVICE);
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    const authorization = `${AWS_ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const requestHeaders = new Headers();
    for (const [name, value] of headerEntries) {
      if (name !== 'host') requestHeaders.set(name, value);
    }
    requestHeaders.set('authorization', authorization);
    const response = await fetchImpl(url, {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: /** @type {any} */ (body),
      signal: AbortSignal.timeout(30_000),
    });
    if (simulateResponseLoss) {
      const error = new Error(
        'Simulated response loss after PutObject dispatch',
      );
      error.name = 'SimulatedResponseLossError';
      throw error;
    }
    const responseBody =
      method.toUpperCase() === 'HEAD'
        ? new Uint8Array()
        : new Uint8Array(await response.arrayBuffer());
    const errorText = response.ok
      ? ''
      : new TextDecoder().decode(responseBody).slice(0, 2_000);
    const errorCode = /<Code>([^<]+)<\/Code>/u.exec(errorText)?.[1] ?? null;
    return {
      body: responseBody,
      errorCode,
      headers: response.headers,
      ok: response.ok,
      status: response.status,
    };
  }

  /**
   * @param {{bucket: string, key: string, expiresIn: number}}
   */
  function presignGet({ bucket, key, expiresIn }) {
    invariant(
      Number.isInteger(expiresIn) &&
        expiresIn > 0 &&
        expiresIn <= MAX_SIGNED_URL_TTL_SECONDS,
      `Presigned URL expiry must be 1-${MAX_SIGNED_URL_TTL_SECONDS} seconds`,
    );
    const date = now();
    const timestamp = awsTimestamp(date);
    const dateStamp = awsDate(date);
    const url = new URL(origin);
    url.pathname = `/${awsEncode(bucket)}/${canonicalObjectPath(key)}`;
    const scope = `${dateStamp}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
    /** @type {Record<string, string>} */
    const query = {
      'X-Amz-Algorithm': AWS_ALGORITHM,
      'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
      'X-Amz-Date': timestamp,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    };
    const queryString = canonicalQuery(query);
    const canonicalRequest = [
      'GET',
      url.pathname,
      queryString,
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      AWS_ALGORITHM,
      timestamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, AWS_REGION);
    const serviceKey = hmac(regionKey, AWS_SERVICE);
    const signingKey = hmac(serviceKey, 'aws4_request');
    query['X-Amz-Signature'] = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    url.search = canonicalQuery(query);
    return url;
  }

  return { presignGet, request };
}

/**
 * @param {{
 *   accountId: string,
 *   apiToken: string,
 *   jurisdiction: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function createR2ControlPlaneClient({
  accountId,
  apiToken,
  jurisdiction,
  fetchImpl = globalThis.fetch,
}) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets`;

  /** @param {string} path */
  async function get(path) {
    const headers = new Headers({ authorization: `Bearer ${apiToken}` });
    if (jurisdiction !== 'default') {
      headers.set('cf-r2-jurisdiction', jurisdiction);
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    invariant(
      response.ok && body?.success === true,
      `Cloudflare R2 control-plane read failed (${response.status})`,
    );
    return body.result;
  }

  /** @param {string} bucket */
  const encoded = (bucket) => `/${encodeURIComponent(bucket)}`;
  return {
    getBucket: /** @param {string} bucket */ (bucket) => get(encoded(bucket)),
    getLifecycle: /** @param {string} bucket */ (bucket) =>
      get(`${encoded(bucket)}/lifecycle`),
    getLock: /** @param {string} bucket */ (bucket) =>
      get(`${encoded(bucket)}/lock`),
    getManagedDomain: /** @param {string} bucket */ (bucket) =>
      get(`${encoded(bucket)}/domains/managed`),
    listCustomDomains: /** @param {string} bucket */ (bucket) =>
      get(`${encoded(bucket)}/domains/custom`),
  };
}

/**
 * @param {{status: number, headers?: Headers}} head
 * @param {string} expectedSha256
 */
export function reconcileUnknownPut(head, expectedSha256) {
  if (head.status === 200) {
    const actual = head.headers?.get('x-amz-meta-sha256') ?? null;
    return actual === expectedSha256
      ? { automaticRetry: false, outcome: 'sent', reason: 'sha256-match' }
      : {
          automaticRetry: false,
          outcome: 'human-reconciliation',
          reason: actual ? 'sha256-mismatch' : 'sha256-missing',
        };
  }
  if (head.status === 404) {
    return {
      automaticRetry: false,
      outcome: 'retry-same-immutable-key-with-if-none-match',
      reason: 'proven-absent',
    };
  }
  return {
    automaticRetry: false,
    outcome: 'human-reconciliation',
    reason: 'head-inconclusive',
  };
}

/** @param {unknown} evidence @param {string[]} secrets */
export function assertSafeR2Evidence(evidence, secrets = []) {
  const serialized = JSON.stringify(evidence);
  const forbiddenPatterns = [
    /authorization/iu,
    /secret(?:Access)?Key/iu,
    /accessKeyId/iu,
    /X-Amz-(?:Credential|Signature|Security-Token)=/iu,
    /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/iu,
    /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/u,
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/u,
  ];
  invariant(
    forbiddenPatterns.every((pattern) => !pattern.test(serialized)),
    'R2 evidence contains a secret, signed URL, or PII pattern',
  );
  invariant(
    secrets.filter(Boolean).every((secret) => !serialized.includes(secret)),
    'R2 evidence contains a live credential or account identifier',
  );
  return evidence;
}

/** @param {{ok: boolean, status: number}} response @param {string} label */
function expectOk(response, label) {
  invariant(response.ok, `${label} failed (${response.status})`);
}

/** @param {{ok: boolean, status: number}} response @param {string} label */
function expectDenied(response, label) {
  invariant(
    !response.ok && [401, 403].includes(response.status),
    `${label} must be denied`,
  );
}

/** @param {Record<string, any>} lock @param {number} minimumSeconds @param {Date} now */
export function validateR2BucketLock(lock, minimumSeconds, now) {
  const rules = Array.isArray(lock?.rules) ? lock.rules : [];
  const rule = rules.find(
    ({ id, enabled, prefix }) =>
      id === 'crm-silmer-tombstones-retention' &&
      enabled === true &&
      prefix === 'tombstones/',
  );
  invariant(rule, 'Required tombstone Bucket Lock rule is not active');
  const condition = rule.condition ?? {};
  const sufficient =
    condition.type === 'Indefinite' ||
    (condition.type === 'Age' && condition.maxAgeSeconds >= minimumSeconds) ||
    (condition.type === 'Date' &&
      Date.parse(condition.date) - now.getTime() >= minimumSeconds * 1_000);
  invariant(sufficient, 'Tombstone Bucket Lock retention is insufficient');
  return condition.type;
}

/** @param {Record<string, any>} lifecycle */
function validateBackupLifecycle(lifecycle) {
  const rules = Array.isArray(lifecycle?.rules) ? lifecycle.rules : [];
  const valid = rules.some(
    ({ enabled, deleteObjectsTransition }) =>
      enabled === true &&
      deleteObjectsTransition?.condition?.type === 'Age' &&
      deleteObjectsTransition.condition.maxAge > 0 &&
      deleteObjectsTransition.condition.maxAge <= BACKUP_MAX_AGE_SECONDS,
  );
  invariant(valid, 'Backup lifecycle must delete objects within 35 days');
}

/** @param {Record<string, any>} lifecycle @param {string} bucketClass */
function validateNoProviderLifecycle(lifecycle, bucketClass) {
  const rules = Array.isArray(lifecycle?.rules) ? lifecycle.rules : [];
  invariant(
    rules.every((rule) => !rule?.deleteObjectsTransition),
    `${bucketClass} must not use provider delete lifecycle; P0.6 is event and legal-hold aware`,
  );
}

/** @param {Record<string, any>} lifecycle @param {string} bucketClass */
export function validateR2BucketLifecycle(lifecycle, bucketClass) {
  invariant(
    ['data', 'backups', 'tombstones'].includes(bucketClass),
    'Unknown R2 bucket lifecycle class',
  );
  if (bucketClass === 'backups') validateBackupLifecycle(lifecycle);
  else validateNoProviderLifecycle(lifecycle, bucketClass);
}

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   randomUuid?: () => string,
 *   writeEvidence?: (evidence: Record<string, any>) => Promise<void>,
 * }} [options]
 */
export async function runR2LiveSmoke(options = {}) {
  const env = options.env ?? process.env;
  const config = validateR2LiveEnvironment(env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const randomUuid = options.randomUuid ?? nodeRandomUuid;
  const controlPlane = createR2ControlPlaneClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
    jurisdiction: config.jurisdiction,
    fetchImpl,
  });
  const clients = Object.fromEntries(
    Object.entries(config.credentials).map(([name, credentials]) => [
      name,
      createR2S3Client({
        endpoint: config.endpoint,
        credentials,
        fetchImpl,
        now,
      }),
    ]),
  );

  /** @type {Record<string, Record<string, any>>} */
  const bucketState = {};
  for (const [bucketClass, bucketName] of Object.entries(config.bucketNames)) {
    const [properties, managedDomain, customDomains, lifecycle] =
      await Promise.all([
        controlPlane.getBucket(bucketName),
        controlPlane.getManagedDomain(bucketName),
        controlPlane.listCustomDomains(bucketName),
        controlPlane.getLifecycle(bucketName),
      ]);
    invariant(
      properties?.name === bucketName,
      `${bucketClass} bucket is missing`,
    );
    invariant(
      (properties.jurisdiction ?? 'default') === config.jurisdiction,
      `${bucketClass} bucket jurisdiction does not match the approved endpoint`,
    );
    invariant(
      managedDomain?.enabled === false,
      `${bucketClass} r2.dev domain must be disabled`,
    );
    invariant(
      /** @type {Array<{enabled: boolean}>} */ (
        customDomains?.domains ?? []
      ).every(({ enabled }) => enabled === false),
      `${bucketClass} custom domains must be disabled`,
    );
    bucketState[bucketClass] = {
      jurisdiction: properties.jurisdiction ?? 'default',
      lifecycleRules: Array.isArray(lifecycle?.rules)
        ? lifecycle.rules.length
        : 0,
      location: properties.location ?? null,
      private: true,
    };
    validateR2BucketLifecycle(lifecycle, bucketClass);
  }
  const lock = await controlPlane.getLock(config.bucketNames.tombstones);
  const lockConditionType = validateR2BucketLock(
    lock,
    config.lockMinimumSeconds,
    now(),
  );

  /** @type {Record<string, string>} */
  const ownership = {
    data: 'data',
    backups: 'backups',
    tombstoneWrite: 'tombstones',
    tombstoneRead: 'tombstones',
  };
  let crossBucketDenied = 0;
  for (const [principal, client] of Object.entries(clients)) {
    for (const [bucketClass, bucketName] of Object.entries(
      config.bucketNames,
    )) {
      const result = await client.request({
        method: 'HEAD',
        bucket: bucketName,
      });
      if (ownership[principal] === bucketClass) {
        expectOk(result, `${principal} own-bucket access`);
      } else {
        expectDenied(
          result,
          `${principal} cross-bucket access to ${bucketClass}`,
        );
        crossBucketDenied += 1;
      }
    }
  }

  for (const [
    bucketClass,
    clientName,
  ] of /** @type {Array<[string, string]>} */ ([
    ['data', 'data'],
    ['backups', 'backups'],
    ['tombstones', 'tombstoneRead'],
  ])) {
    const bucketNames = /** @type {Record<string, string>} */ (
      config.bucketNames
    );
    const encryption = await clients[clientName].request({
      method: 'GET',
      bucket: bucketNames[bucketClass],
      query: { encryption: '' },
    });
    expectOk(encryption, `${bucketClass} encryption configuration`);
    invariant(
      /AES256/u.test(new TextDecoder().decode(encryption.body)),
      `${bucketClass} encryption configuration must report AES256`,
    );
  }

  const dataBody = new TextEncoder().encode(
    'CRM Silmer issue 29 synthetic object; no customer data.',
  );
  const dataSha256 = sha256Hex(dataBody);
  const dataKey = `issue-29-smoke/${randomUuid()}`;
  const backupKey = `issue-29-smoke/${randomUuid()}`;
  const tombstoneKey = `tombstones/issue-29-smoke/${randomUuid()}`;
  const restoreDeniedKey = `issue-29-smoke/restore-denied-${randomUuid()}`;
  let dataCreated = false;
  let backupCreated = false;
  /** @type {Record<string, any>|undefined} */
  let evidence;
  const cleanupFailures = [];

  try {
    await clients.data
      .request({
        method: 'PUT',
        bucket: config.bucketNames.data,
        key: dataKey,
        headers: {
          'content-type': 'application/octet-stream',
          'if-none-match': '*',
          'x-amz-meta-sha256': dataSha256,
        },
        body: dataBody,
        simulateResponseLoss: true,
      })
      .then(() => {
        throw new Error('PutObject response-loss simulation did not interrupt');
      })
      .catch((error) => {
        invariant(
          error instanceof Error && error.name === 'SimulatedResponseLossError',
          'PutObject failed before the response-loss simulation point',
        );
      });
    dataCreated = true;
    const head = await clients.data.request({
      method: 'HEAD',
      bucket: config.bucketNames.data,
      key: dataKey,
    });
    const reconciliation = reconcileUnknownPut(head, dataSha256);
    invariant(
      reconciliation.outcome === 'sent' &&
        reconciliation.automaticRetry === false,
      'Unknown PutObject was not reconciled by HEAD plus SHA-256',
    );

    const signedUrl = clients.data.presignGet({
      bucket: config.bucketNames.data,
      key: dataKey,
      expiresIn: config.signedUrlTtlSeconds,
    });
    const signedResponse = await fetchImpl(signedUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(30_000),
    });
    invariant(signedResponse.ok, 'Presigned GET failed');
    const signedBody = new Uint8Array(await signedResponse.arrayBuffer());
    invariant(
      sha256Hex(signedBody) === dataSha256,
      'Presigned GET body hash mismatch',
    );

    const backupPut = await clients.backups.request({
      method: 'PUT',
      bucket: config.bucketNames.backups,
      key: backupKey,
      headers: {
        'if-none-match': '*',
        'x-amz-meta-sha256': dataSha256,
      },
      body: dataBody,
    });
    expectOk(backupPut, 'Backup PutObject');
    backupCreated = true;

    const tombstonePut = await clients.tombstoneWrite.request({
      method: 'PUT',
      bucket: config.bucketNames.tombstones,
      key: tombstoneKey,
      headers: {
        'if-none-match': '*',
        'x-amz-meta-sha256': dataSha256,
      },
      body: dataBody,
    });
    expectOk(tombstonePut, 'Tombstone conditional PutObject');
    const tombstoneHead = await clients.tombstoneRead.request({
      method: 'HEAD',
      bucket: config.bucketNames.tombstones,
      key: tombstoneKey,
    });
    invariant(
      reconcileUnknownPut(tombstoneHead, dataSha256).outcome === 'sent',
      'Tombstone read-only reconciliation failed',
    );
    const overwrite = await clients.tombstoneWrite.request({
      method: 'PUT',
      bucket: config.bucketNames.tombstones,
      key: tombstoneKey,
      headers: { 'x-amz-meta-sha256': sha256Hex('different') },
      body: 'different',
    });
    invariant(
      !overwrite.ok && overwrite.status === 403,
      'Bucket Lock must reject tombstone overwrite',
    );
    const remove = await clients.tombstoneWrite.request({
      method: 'DELETE',
      bucket: config.bucketNames.tombstones,
      key: tombstoneKey,
    });
    invariant(
      !remove.ok && remove.status === 403,
      'Bucket Lock must reject tombstone delete',
    );
    const restoreWrite = await clients.tombstoneRead.request({
      method: 'PUT',
      bucket: config.bucketNames.tombstones,
      key: restoreDeniedKey,
      headers: { 'if-none-match': '*', 'x-amz-meta-sha256': dataSha256 },
      body: dataBody,
    });
    expectDenied(restoreWrite, 'Tombstone restore write');
    const restoreDelete = await clients.tombstoneRead.request({
      method: 'DELETE',
      bucket: config.bucketNames.tombstones,
      key: restoreDeniedKey,
    });
    expectDenied(restoreDelete, 'Tombstone restore delete');

    evidence = {
      schemaVersion: 1,
      task: 'T00.4',
      issue: 6,
      capturedAt: now().toISOString(),
      provider: 'Cloudflare R2',
      syntheticOnly: true,
      humanApproved: false,
      buckets: bucketState,
      transport: { endpointHttps: true, region: AWS_REGION },
      encryptionAtRest: {
        s3ConfigurationObserved: true,
        algorithm: 'AES256',
      },
      credentials: {
        distinctPrincipals: 4,
        crossBucketDenied,
        configurationAdminOutsideRuntime: true,
        tombstoneRestoreReadOnly: true,
      },
      signedUrl: {
        operation: 'GET',
        ttlSeconds: config.signedUrlTtlSeconds,
        bodySha256Verified: true,
        rawUrlRecorded: false,
      },
      outcomeUnknown: {
        initialOutcome: 'outcome_unknown',
        simulation: 'response-discarded-after-dispatch',
        putCalls: 1,
        headCalls: 1,
        finalOutcome: reconciliation.outcome,
        confirmation: reconciliation.reason,
        automaticRetry: false,
        etagUsedAsProof: false,
      },
      bucketLock: {
        providerControl: 'cloudflare-r2-bucket-lock',
        prefix: 'tombstones/',
        conditionType: lockConditionType,
        overwriteDenied: true,
        deleteDenied: true,
        configurationChangeRequiresHumanApproval: true,
      },
      compatibility: {
        s3ObjectLockHeadersUsed: false,
        bucketVersioningClaimed: false,
      },
      sensitiveData: {
        customerDataUsed: false,
        accountIdRecorded: false,
        objectKeysRecorded: false,
        signedUrlsRecorded: false,
        credentialsRecorded: false,
      },
      limitations: [
        'DPA, subprocessors, location and governance still require named human approval.',
        'The synthetic tombstone canary remains until its Bucket Lock retention expires.',
      ],
    };
  } finally {
    if (dataCreated) {
      const cleanup = await clients.data.request({
        method: 'DELETE',
        bucket: config.bucketNames.data,
        key: dataKey,
      });
      if (!cleanup.ok) cleanupFailures.push('data');
    }
    if (backupCreated) {
      const cleanup = await clients.backups.request({
        method: 'DELETE',
        bucket: config.bucketNames.backups,
        key: backupKey,
      });
      if (!cleanup.ok) cleanupFailures.push('backups');
    }
  }
  invariant(evidence, 'R2 smoke did not produce evidence');
  invariant(
    cleanupFailures.length === 0,
    `R2 smoke cleanup failed for ${cleanupFailures.join(', ')}`,
  );
  evidence.cleanup = { backupDeleted: true, dataDeleted: true };
  const secrets = [
    config.accountId,
    config.apiToken,
    ...Object.values(config.credentials).flatMap(
      ({ accessKeyId, secretAccessKey }) => [accessKeyId, secretAccessKey],
    ),
  ];
  assertSafeR2Evidence(evidence, secrets);
  const writeEvidence =
    options.writeEvidence ??
    (async (value) => {
      const outputPath = resolve(config.evidencePath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
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
  readFile(
    new URL('../docs/phase0/r2-control-plane.json', import.meta.url),
    'utf8',
  )
    .then((source) => JSON.parse(source))
    .then((controlPlane) => {
      assertR2LiveExecutionAuthorized(controlPlane);
      return runR2LiveSmoke();
    })
    .then(() => {
      console.log(
        'R2 live smoke completed with synthetic data; sanitized evidence saved locally.',
      );
    })
    .catch((error) => {
      console.error(`R2 live smoke failed: ${error.message}`);
      process.exitCode = 1;
    });
}
