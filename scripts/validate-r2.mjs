import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const expectedBuckets = Object.freeze([
  ['data', 'crm-silmer-data'],
  ['backups', 'crm-silmer-backups'],
  ['tombstones', 'crm-silmer-tombstones'],
]);

const expectedEnvironmentNames = Object.freeze([
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'R2_JURISDICTION',
  'R2_S3_ENDPOINT',
  'R2_DATA_BUCKET',
  'R2_DATA_ACCESS_KEY_ID',
  'R2_DATA_SECRET_ACCESS_KEY',
  'R2_BACKUP_BUCKET',
  'R2_BACKUP_ACCESS_KEY_ID',
  'R2_BACKUP_SECRET_ACCESS_KEY',
  'R2_TOMBSTONE_BUCKET',
  'R2_TOMBSTONE_WRITE_ACCESS_KEY_ID',
  'R2_TOMBSTONE_WRITE_SECRET_ACCESS_KEY',
  'R2_TOMBSTONE_READ_ACCESS_KEY_ID',
  'R2_TOMBSTONE_READ_SECRET_ACCESS_KEY',
  'R2_TOMBSTONE_LOCK_MIN_SECONDS',
  'R2_SIGNED_URL_TTL_SECONDS',
  'R2_LIVE_EVIDENCE_PATH',
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} value @param {string[]} [path] */
function assertNoSensitiveValues(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitiveValues(item, [...path, String(index)]),
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
      invariant(
        ![
          'accesskeyid',
          'accountid',
          'apitoken',
          'authorization',
          'credential',
          'secretaccesskey',
          'signedurl',
          'token',
          'value',
        ].includes(normalizedKey) ||
          nested === null ||
          nested === false ||
          nested === '',
        `R2 control-plane document contains sensitive field ${[
          ...path,
          key,
        ].join('.')}`,
      );
      assertNoSensitiveValues(nested, [...path, key]);
    }
    return;
  }
  if (typeof value === 'string' && !value.startsWith('secret://')) {
    invariant(
      !/[?&]X-Amz-Signature=|Authorization:\s*Bearer\s+|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|https:\/\/[a-f0-9]{32}(?:\.[a-z]+)?\.r2\.cloudflarestorage\.com/iu.test(
        value,
      ),
      `R2 control-plane document contains a credential, signed URL, or account endpoint at ${path.join('.')}`,
    );
  }
}

/** @param {any} document */
export function validateR2ControlPlane(document) {
  invariant(document?.schemaVersion === 1, 'R2 gate schema version must be 1');
  invariant(document?.task === 'T00.4', 'R2 gate must trace to T00.4');
  invariant(document?.issue === 29, 'R2 gate must trace to issue 29');
  const deferredActivation =
    document.activation?.status === 'deferred-zero-incremental-cost' &&
    document.activation.subscriptionAuthorized === false &&
    document.activation.provisioningAuthorized === false;
  const authorizedActivation =
    document.activation?.status === 'authorized-for-live-validation' &&
    document.activation.subscriptionAuthorized === true &&
    document.activation.provisioningAuthorized === true;
  invariant(
    document?.provider === 'Cloudflare R2',
    'R2 gate must name the selected provider',
  );
  const approval = document?.approval;
  const pendingApproval =
    approval?.approved === false &&
    approval.status === 'pending-human-approval' &&
    approval.dpaAccepted === false &&
    approval.subprocessorsAccepted === false &&
    approval.dataLocationAccepted === false &&
    approval.decidedAt === null &&
    approval.evidenceRef === null;
  const completedApproval =
    approval?.approved === true &&
    approval.status === 'approved' &&
    approval.dpaAccepted === true &&
    approval.subprocessorsAccepted === true &&
    approval.dataLocationAccepted === true &&
    typeof approval.privacyReviewer === 'string' &&
    approval.privacyReviewer.trim().length > 0 &&
    typeof approval.techLeadReviewer === 'string' &&
    approval.techLeadReviewer.trim().length > 0 &&
    Number.isFinite(Date.parse(approval.decidedAt)) &&
    /^docs\/phase0\/r2-[a-z0-9-]+-evidence\.json$/u.test(approval.evidenceRef);
  invariant(
    pendingApproval || completedApproval,
    'R2 human approval must be wholly pending or wholly approved',
  );
  const dataLocation = document?.dataLocation;
  const pendingLocation =
    dataLocation?.status === 'pending-privacy' &&
    dataLocation.jurisdiction === null &&
    dataLocation.locationHint === null;
  const approvedLocation =
    dataLocation?.status === 'approved' &&
    ['default', 'eu', 'us', 'fedramp'].includes(dataLocation.jurisdiction) &&
    (dataLocation.locationHint === null ||
      typeof dataLocation.locationHint === 'string');
  invariant(
    dataLocation?.locationHintIsResidencyGuarantee === false &&
      dataLocation.jurisdictionCannotChangeAfterCreation === true &&
      (completedApproval ? approvedLocation : pendingLocation),
    'R2 data location must match the human approval state',
  );

  const buckets = /** @type {Array<Record<string, any>>} */ (document.buckets);
  invariant(Array.isArray(buckets), 'R2 buckets must be an array');
  invariant(
    buckets.length === 3,
    'R2 gate requires exactly three data classes',
  );
  for (const [index, [bucketClass, name]] of expectedBuckets.entries()) {
    const bucket = buckets[index];
    invariant(
      bucket?.class === bucketClass && bucket?.name === name,
      `R2 ${bucketClass} bucket must use the canonical name`,
    );
    invariant(bucket.publicAccess === false, `${name} must remain private`);
    invariant(
      Array.isArray(bucket.credentialRefs) && bucket.credentialRefs.length >= 2,
      `${name} needs secret references`,
    );
    invariant(
      bucket.credentialRefs.every(
        (/** @type {unknown} */ ref) =>
          typeof ref === 'string' && ref.startsWith('secret://crm/r2/'),
      ),
      `${name} credentials must be opaque secret references`,
    );
  }
  invariant(
    new Set(buckets.map(({ name }) => name)).size === buckets.length,
    'R2 bucket names must be distinct',
  );
  const credentialRefs = buckets.flatMap(
    ({ credentialRefs }) => credentialRefs,
  );
  invariant(
    new Set(credentialRefs).size === credentialRefs.length,
    'R2 credentials must be segregated by class and role',
  );
  invariant(
    buckets[1].runtimeAccess === false && buckets[2].runtimeAccess === false,
    'Runtime must not receive backup or tombstone credentials',
  );
  invariant(
    buckets[1].lifecycle?.deleteAfterDaysMaximum === 35,
    'R2 backup lifecycle must expire within 35 days',
  );
  invariant(
    buckets[0].lifecycle?.applicationManaged === true &&
      buckets[0].lifecycle?.providerDeleteRulesExpected === 0 &&
      buckets[2].lifecycle?.applicationManaged === true &&
      buckets[2].lifecycle?.providerDeleteRulesExpected === 0,
    'Data and tombstone retention must not use provider delete lifecycle',
  );
  invariant(
    buckets[2].immutablePrefix === 'tombstones/' &&
      buckets[2].conditionalCreateRequired === true &&
      buckets[2].bucketLock?.providerControl === 'cloudflare-r2-bucket-lock' &&
      buckets[2].bucketLock?.required === true &&
      buckets[2].bucketLock?.minimumRetentionSeconds === 3_110_400 &&
      buckets[2].bucketLock?.configurationAdminOutsideRuntime === true &&
      buckets[2].bucketLock?.changeRequiresApprovalAndAudit === true,
    'Tombstones require scoped provider-native Bucket Lock governance',
  );

  invariant(
    document?.credentials?.separateByDataClass === true &&
      document.credentials.crossBucketAccessMustFail === true &&
      document.credentials.tombstoneRestoreReadOnly === true &&
      document.credentials.configurationAdminOutsideRuntime === true &&
      document.credentials.valuesAllowedInEvidence === false,
    'R2 credential segregation contract is incomplete',
  );
  invariant(
    document?.s3Compatibility?.region === 'auto' &&
      document.s3Compatibility.providerNativeBucketLockRequired === true &&
      document.s3Compatibility.s3ObjectLockSupported === false &&
      document.s3Compatibility.s3ObjectLockHeadersAllowed === false &&
      document.s3Compatibility.bucketVersioningSupported === false,
    'R2 compatibility must not claim S3 Object Lock or bucket versioning',
  );
  invariant(
    Number.isInteger(document?.signedUrls?.maximumTtlSeconds) &&
      document.signedUrls.maximumTtlSeconds > 0 &&
      document.signedUrls.maximumTtlSeconds <= 300 &&
      document.signedUrls.bearerToken === true &&
      document.signedUrls.rawUrlAllowedInLogsOrEvidence === false &&
      document.signedUrls.applicationCacheControl === 'no-store',
    'R2 signed URL policy must be short-lived and non-loggable',
  );
  invariant(
    document?.outcomeUnknown?.automaticRetry === false &&
      document.outcomeUnknown.reconcileOperation === 'HeadObject' &&
      document.outcomeUnknown.confirmationMetadata === 'sha256' &&
      document.outcomeUnknown.etagIsSufficient === false,
    'R2 outcome_unknown must reconcile by HEAD plus SHA-256',
  );
  const liveEvidence = document?.liveEvidence;
  const pendingLive =
    liveEvidence?.status === 'not-executed' &&
    liveEvidence.executed === false &&
    liveEvidence.humanApproved === false &&
    liveEvidence.versioned === false;
  const completedLive =
    liveEvidence?.status === 'passed' &&
    liveEvidence.executed === true &&
    liveEvidence.humanApproved === true &&
    liveEvidence.versioned === true &&
    /^docs\/phase0\/r2-[a-z0-9-]+-evidence\.json$/u.test(
      liveEvidence.evidenceRef,
    );
  const deferredState =
    deferredActivation && pendingApproval && pendingLocation && pendingLive;
  const authorizedState =
    authorizedActivation &&
    completedApproval &&
    approvedLocation &&
    (pendingLive || completedLive);
  invariant(
    deferredState || authorizedState,
    'R2 activation, human approval, location and live evidence must transition together',
  );
  assertNoSensitiveValues(document);
  return document;
}

/** @param {any} document */
export function assertR2LiveExecutionAuthorized(document) {
  validateR2ControlPlane(document);
  invariant(
    document.activation.status === 'authorized-for-live-validation' &&
      document.activation.subscriptionAuthorized === true &&
      document.activation.provisioningAuthorized === true &&
      document.approval.approved === true &&
      document.approval.dpaAccepted === true &&
      document.approval.subprocessorsAccepted === true &&
      document.approval.dataLocationAccepted === true &&
      document.dataLocation.status === 'approved' &&
      document.liveEvidence.status === 'not-executed' &&
      document.liveEvidence.executed === false,
    'R2 live execution requires complete approval, approved location and an unexecuted evidence slot',
  );
  return document;
}

/** @param {string} contents */
export function validateR2EnvironmentTemplate(contents) {
  const assignments = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      invariant(separator > 0, `Invalid R2 environment line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    });
  invariant(
    assignments.every(([, value]) => value === ''),
    'R2 environment template must contain empty values only',
  );
  const names = assignments.map(([name]) => name);
  invariant(
    JSON.stringify(names) === JSON.stringify(expectedEnvironmentNames),
    'R2 environment template must contain the canonical names in order',
  );
  return names;
}

async function main() {
  const rootUrl = new URL('../', import.meta.url);
  const controlPlane = JSON.parse(
    await readFile(
      new URL('docs/phase0/r2-control-plane.json', rootUrl),
      'utf8',
    ),
  );
  const environment = await readFile(
    new URL('docs/phase0/r2-live.env.example', rootUrl),
    'utf8',
  );
  validateR2ControlPlane(controlPlane);
  validateR2EnvironmentTemplate(environment);
  console.log(
    'R2 gate valid: activation is deferred; live execution remains unauthorized.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`R2 gate invalid: ${error.message}`);
    process.exitCode = 1;
  });
}
