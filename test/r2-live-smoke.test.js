import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { Headers, Request, Response } = globalThis;

import {
  assertNoS3ObjectLockHeaders,
  assertSafeR2Evidence,
  createR2S3Client,
  reconcileUnknownPut,
  runR2LiveSmoke,
  validateR2BucketLifecycle,
  validateR2BucketLock,
  validateR2LiveEnvironment,
} from '../scripts/r2-live-smoke.mjs';
import {
  validateR2ControlPlane,
  validateR2EnvironmentTemplate,
} from '../scripts/validate-r2.mjs';

const rootUrl = new URL('../', import.meta.url);
const fixedDate = new Date('2026-08-31T12:00:00.000Z');

function environment(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    CLOUDFLARE_API_TOKEN: 'test-control-plane-token',
    R2_JURISDICTION: 'default',
    R2_S3_ENDPOINT: 'https://test-account-id.r2.cloudflarestorage.com',
    R2_DATA_BUCKET: 'crm-silmer-data',
    R2_DATA_ACCESS_KEY_ID: 'DATAKEY',
    R2_DATA_SECRET_ACCESS_KEY: 'data-secret',
    R2_BACKUP_BUCKET: 'crm-silmer-backups',
    R2_BACKUP_ACCESS_KEY_ID: 'BACKUPKEY',
    R2_BACKUP_SECRET_ACCESS_KEY: 'backup-secret',
    R2_TOMBSTONE_BUCKET: 'crm-silmer-tombstones',
    R2_TOMBSTONE_WRITE_ACCESS_KEY_ID: 'TOMBSTONEWRITEKEY',
    R2_TOMBSTONE_WRITE_SECRET_ACCESS_KEY: 'tombstone-write-secret',
    R2_TOMBSTONE_READ_ACCESS_KEY_ID: 'TOMBSTONEREADKEY',
    R2_TOMBSTONE_READ_SECRET_ACCESS_KEY: 'tombstone-read-secret',
    R2_TOMBSTONE_LOCK_MIN_SECONDS: '3110400',
    R2_SIGNED_URL_TTL_SECONDS: '300',
    R2_LIVE_EVIDENCE_PATH: 'var/test-r2-live-evidence.json',
    ...overrides,
  };
}

test('validates the fail-closed R2 control plane and empty environment template', async () => {
  const gate = JSON.parse(
    await readFile(
      new URL('docs/phase0/r2-control-plane.json', rootUrl),
      'utf8',
    ),
  );
  const template = await readFile(
    new URL('docs/phase0/r2-live.env.example', rootUrl),
    'utf8',
  );

  assert.doesNotThrow(() => validateR2ControlPlane(gate));
  assert.equal(validateR2EnvironmentTemplate(template).length, 18);
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.liveEvidence.executed, false);

  const approved = structuredClone(gate);
  approved.approval = {
    ...approved.approval,
    approved: true,
    status: 'approved',
    dpaAccepted: true,
    subprocessorsAccepted: true,
    dataLocationAccepted: true,
    techLeadReviewer: 'Tech Lead',
    decidedAt: '2026-09-01T12:00:00.000Z',
    evidenceRef: 'docs/phase0/r2-approved-evidence.json',
  };
  approved.dataLocation = {
    ...approved.dataLocation,
    status: 'approved',
    jurisdiction: 'eu',
  };
  approved.liveEvidence = {
    ...approved.liveEvidence,
    status: 'passed',
    executed: true,
    humanApproved: true,
    versioned: true,
    evidenceRef: 'docs/phase0/r2-approved-evidence.json',
  };
  assert.doesNotThrow(() => validateR2ControlPlane(approved));

  const partial = structuredClone(approved);
  partial.approval.subprocessorsAccepted = false;
  assert.throws(
    () => validateR2ControlPlane(partial),
    /wholly pending or wholly approved/iu,
  );

  const weakEvidence = structuredClone(approved);
  weakEvidence.approval.techLeadReviewer = ' ';
  weakEvidence.approval.evidenceRef = 'https://example.invalid/evidence';
  assert.throws(
    () => validateR2ControlPlane(weakEvidence),
    /wholly pending or wholly approved/iu,
  );

  for (const sensitiveField of ['secretAccessKey', 'accessKeyId', 'TOKEN']) {
    const leaked = structuredClone(gate);
    leaked.liveEvidence.details = { [sensitiveField]: 'must-not-pass' };
    assert.throws(() => validateR2ControlPlane(leaked), /sensitive field/iu);
  }
});

test('rejects unsafe endpoints, shared credentials, and long signed URLs', () => {
  assert.throws(
    () =>
      validateR2LiveEnvironment(environment({ R2_S3_ENDPOINT: 'http://r2' })),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      validateR2LiveEnvironment(
        environment({
          R2_S3_ENDPOINT: 'https://other-account.r2.cloudflarestorage.com',
        }),
      ),
    /account and jurisdiction exactly/iu,
  );
  assert.throws(
    () =>
      validateR2LiveEnvironment(
        environment({ R2_TOMBSTONE_LOCK_MIN_SECONDS: '3024000' }),
      ),
    /at least 3110400/iu,
  );
  assert.throws(
    () =>
      validateR2LiveEnvironment(
        environment({ R2_BACKUP_ACCESS_KEY_ID: 'DATAKEY' }),
      ),
    /access keys must be distinct/iu,
  );
  assert.throws(
    () =>
      validateR2LiveEnvironment(
        environment({ R2_SIGNED_URL_TTL_SECONDS: '301' }),
      ),
    /TTL must be <= 300/iu,
  );
});

test('forbids unsupported S3 Object Lock headers', () => {
  assert.throws(
    () =>
      assertNoS3ObjectLockHeaders({
        'x-amz-object-lock-mode': 'COMPLIANCE',
      }),
    /must not use.*Object Lock/iu,
  );
  assert.doesNotThrow(() =>
    assertNoS3ObjectLockHeaders({ 'if-none-match': '*' }),
  );
});

test('rejects unsafe lifecycle and Bucket Lock retention', () => {
  assert.doesNotThrow(() => validateR2BucketLifecycle({ rules: [] }, 'data'));
  assert.throws(
    () =>
      validateR2BucketLifecycle(
        {
          rules: [
            {
              enabled: true,
              deleteObjectsTransition: {
                condition: { type: 'Age', maxAge: 90 },
              },
            },
          ],
        },
        'data',
      ),
    /must not use provider delete lifecycle/iu,
  );
  assert.doesNotThrow(() =>
    validateR2BucketLifecycle(
      {
        rules: [
          {
            enabled: true,
            abortMultipartUploadsTransition: {
              condition: { type: 'Age', maxAge: 604800 },
            },
          },
        ],
      },
      'data',
    ),
  );
  assert.throws(
    () => validateR2BucketLifecycle({ rules: [] }, 'backups'),
    /within 35 days/iu,
  );
  assert.throws(
    () =>
      validateR2BucketLock(
        {
          rules: [
            {
              id: 'crm-silmer-tombstones-retention',
              enabled: true,
              prefix: 'tombstones/',
              condition: { type: 'Age', maxAgeSeconds: 3024000 },
            },
          ],
        },
        3110400,
        fixedDate,
      ),
    /retention is insufficient/iu,
  );
});

test('reconciles an unknown put only from HEAD plus metadata SHA-256', () => {
  const expected = 'abc123';
  const matchingHeaders = new Headers({ 'x-amz-meta-sha256': expected });
  const missingHeaders = new Headers();

  assert.deepEqual(
    reconcileUnknownPut({ status: 200, headers: matchingHeaders }, expected),
    {
      automaticRetry: false,
      outcome: 'sent',
      reason: 'sha256-match',
    },
  );
  assert.equal(
    reconcileUnknownPut({ status: 200, headers: missingHeaders }, expected)
      .outcome,
    'human-reconciliation',
  );
  assert.equal(
    reconcileUnknownPut({ status: 200, headers: matchingHeaders }, 'different')
      .outcome,
    'human-reconciliation',
  );
  assert.deepEqual(reconcileUnknownPut({ status: 404 }, expected), {
    automaticRetry: false,
    outcome: 'retry-same-immutable-key-with-if-none-match',
    reason: 'proven-absent',
  });
  assert.equal(
    reconcileUnknownPut({ status: 503 }, expected).outcome,
    'human-reconciliation',
  );
});

test('creates a scoped presigned URL without unsupported headers', () => {
  const client = createR2S3Client({
    endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: 'DATAKEY',
      secretAccessKey: 'data-secret',
    },
    now: () => fixedDate,
  });
  const url = client.presignGet({
    bucket: 'crm-silmer-data',
    key: 'issue-6-smoke/canary',
    expiresIn: 300,
  });

  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  assert.throws(
    () =>
      client.presignGet({
        bucket: 'crm-silmer-data',
        key: 'issue-6-smoke/canary',
        expiresIn: 301,
      }),
    /1-300 seconds/u,
  );
});

test('rejects signed URLs, credentials, account identifiers, and PII in evidence', () => {
  assert.throws(
    () =>
      assertSafeR2Evidence({
        signedUrl: 'https://example.test/?X-Amz-Signature=secret',
      }),
    /secret.*signed URL.*PII/iu,
  );
  assert.throws(
    () =>
      assertSafeR2Evidence({ marker: 'test-account-id' }, ['test-account-id']),
    /credential or account identifier/iu,
  );
  assert.throws(
    () => assertSafeR2Evidence({ contact: 'teste@example.com' }),
    /secret.*signed URL.*PII/iu,
  );
});

test('executes the complete R2 smoke against synthetic provider fixtures', async () => {
  const objects = new Map();
  let dataPutCalls = 0;
  /** @type {Record<string, string>} */
  const access = {
    DATAKEY: 'crm-silmer-data',
    BACKUPKEY: 'crm-silmer-backups',
    TOMBSTONEWRITEKEY: 'crm-silmer-tombstones',
    TOMBSTONEREADKEY: 'crm-silmer-tombstones',
  };

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (url.hostname === 'api.cloudflare.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      const bucketIndex = parts.indexOf('buckets') + 1;
      const bucket = decodeURIComponent(parts[bucketIndex]);
      const suffix = parts.slice(bucketIndex + 1).join('/');
      let result;
      if (!suffix) {
        result = {
          name: bucket,
          jurisdiction: 'default',
          location: 'enam',
        };
      } else if (suffix === 'domains/managed') {
        result = { enabled: false };
      } else if (suffix === 'domains/custom') {
        result = { domains: [] };
      } else if (suffix === 'lifecycle') {
        result = {
          rules:
            bucket === 'crm-silmer-backups'
              ? [
                  {
                    enabled: true,
                    deleteObjectsTransition: {
                      condition: { type: 'Age', maxAge: 3024000 },
                    },
                  },
                ]
              : [],
        };
      } else if (suffix === 'lock') {
        result = {
          rules: [
            {
              id: 'crm-silmer-tombstones-retention',
              enabled: true,
              prefix: 'tombstones/',
              condition: { type: 'Age', maxAgeSeconds: 3110400 },
            },
          ],
        };
      }
      return Response.json({ success: true, result });
    }

    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const bucket = parts[0];
    const key = parts.slice(1).join('/');
    const authorization = headers.get('authorization') ?? '';
    const accessKey = /Credential=([^/]+)/u.exec(authorization)?.[1] ?? null;
    const signed = url.searchParams.has('X-Amz-Signature');
    const allowedBucket = accessKey ? access[accessKey] : null;
    const objectId = `${bucket}/${key}`;

    if (!key && method === 'HEAD') {
      return allowedBucket === bucket
        ? new Response(null, { status: 200 })
        : new Response('<Error><Code>AccessDenied</Code></Error>', {
            status: 403,
          });
    }
    if (url.searchParams.has('encryption') && method === 'GET') {
      return allowedBucket === bucket
        ? new Response(
            '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>',
            { status: 200 },
          )
        : new Response('<Error><Code>AccessDenied</Code></Error>', {
            status: 403,
          });
    }
    if (signed && method === 'GET') {
      const object = objects.get(objectId);
      return object
        ? new Response(object.body, { status: 200 })
        : new Response('<Error><Code>NoSuchKey</Code></Error>', {
            status: 404,
          });
    }
    if (allowedBucket !== bucket) {
      return new Response('<Error><Code>AccessDenied</Code></Error>', {
        status: 403,
      });
    }
    if (method === 'PUT') {
      if (accessKey === 'TOMBSTONEREADKEY') {
        return new Response('<Error><Code>AccessDenied</Code></Error>', {
          status: 403,
        });
      }
      if (bucket === 'crm-silmer-tombstones' && objects.has(objectId)) {
        return new Response(
          '<Error><Code>ObjectLockedByBucketPolicy</Code></Error>',
          { status: 403 },
        );
      }
      objects.set(objectId, {
        body: init.body,
        sha256: headers.get('x-amz-meta-sha256'),
      });
      if (bucket === 'crm-silmer-data') dataPutCalls += 1;
      return new Response(null, { status: 200 });
    }
    if (method === 'HEAD') {
      const object = objects.get(objectId);
      return object
        ? new Response(null, {
            status: 200,
            headers: { 'x-amz-meta-sha256': object.sha256 },
          })
        : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      if (accessKey === 'TOMBSTONEREADKEY') {
        return new Response('<Error><Code>AccessDenied</Code></Error>', {
          status: 403,
        });
      }
      if (bucket === 'crm-silmer-tombstones' && objects.has(objectId)) {
        return new Response(
          '<Error><Code>ObjectLockedByBucketPolicy</Code></Error>',
          { status: 403 },
        );
      }
      objects.delete(objectId);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };

  let writtenEvidence;
  const evidence = await runR2LiveSmoke({
    env: environment(),
    fetchImpl,
    now: () => fixedDate,
    randomUuid: (() => {
      let value = 0;
      return () => `synthetic-${++value}`;
    })(),
    writeEvidence: async (value) => {
      writtenEvidence = value;
    },
  });

  assert.equal(evidence.outcomeUnknown.putCalls, 1);
  assert.equal(dataPutCalls, 1);
  assert.equal(
    evidence.outcomeUnknown.simulation,
    'response-discarded-after-dispatch',
  );
  assert.equal(evidence.outcomeUnknown.headCalls, 1);
  assert.equal(evidence.outcomeUnknown.finalOutcome, 'sent');
  assert.equal(evidence.credentials.crossBucketDenied, 8);
  assert.equal(evidence.bucketLock.overwriteDenied, true);
  assert.equal(evidence.bucketLock.deleteDenied, true);
  assert.equal(evidence.signedUrl.rawUrlRecorded, false);
  assert.deepEqual(writtenEvidence, evidence);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /test-account-id|DATAKEY|BACKUPKEY|TOMBSTONEWRITEKEY|X-Amz-Signature/iu,
  );
});
