import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const statuses = new Set([
  'documentation-verified',
  'sandbox-verified',
  'pending-live',
  'pending-human',
  'approved-human',
  'deferred',
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {any} document */
export function validateExternalEffects(document) {
  invariant(document?.task === 'T00.4', 'Matrix must trace to T00.4');
  invariant(
    document.externalApprovalGranted === false,
    'Local evidence cannot claim external approval',
  );
  invariant(Array.isArray(document.effects), 'Effects must be an array');
  const effects = /** @type {Array<Record<string, any>>} */ (document.effects);
  invariant(effects.length >= 7, 'Expected all external effect classes');
  invariant(
    new Set(effects.map(({ id }) => id)).size === effects.length,
    'Effect IDs must be unique',
  );

  for (const effect of effects) {
    invariant(typeof effect.id === 'string', 'Each effect needs an id');
    invariant(effect.idempotency?.support, `${effect.id} needs idempotency`);
    invariant(effect.resultQuery?.support, `${effect.id} needs result query`);
    invariant(effect.pointOfNoReturn, `${effect.id} needs point of no return`);
    invariant(
      effect.outcomeUnknown?.automaticRetry === false,
      `${effect.id} must forbid blind automatic retry`,
    );
    invariant(
      effect.outcomeUnknown?.strategy,
      `${effect.id} needs outcome_unknown strategy`,
    );
    invariant(statuses.has(effect.status), `${effect.id} has invalid status`);
    invariant(effect.owner, `${effect.id} needs an owner`);
    invariant(
      Array.isArray(effect.evidence) && effect.evidence.length > 0,
      `${effect.id} needs evidence`,
    );
    for (const evidence of effect.evidence) {
      invariant(evidence.url, `${effect.id} evidence needs URL/path`);
      invariant(evidence.checkedAt, `${effect.id} evidence needs date`);
      invariant(evidence.status, `${effect.id} evidence needs status`);
    }
  }

  const metaSend = effects.find(({ id }) => id === 'meta.send-message');
  if (!metaSend) throw new Error('Meta send-message effect is required');
  invariant(
    metaSend.idempotency.support === 'not-proven' &&
      metaSend.resultQuery.support === 'not-proven-by-wamid' &&
      metaSend.outcomeUnknown.automaticRetry === false,
    'Meta send must remain outcome_unknown without blind retry',
  );

  const ai = effects.find(({ id }) => id === 'gemini.structured-response');
  invariant(
    ai?.provider === 'Google Gemini Developer API',
    'Gemini Developer API must be the direct provider',
  );
  invariant(
    ai?.model === 'gemini-2.5-flash-lite',
    'Gemini model must remain pinned to the approved cost-benefit baseline',
  );
  invariant(
    ai?.requestControls?.operation === 'models.generateContent' &&
      ai.requestControls.serverManagedConversationState === false &&
      ai.requestControls.authKeyServerSideOnly === true,
    'Gemini must use stateless generateContent',
  );
  invariant(
    ai?.requestControls?.structuredOutput === 'strict-json-schema',
    'Gemini must use strict structured output',
  );
  invariant(
    ai?.requestControls?.grounding === false &&
      ai.requestControls.fileApi === false &&
      ai.requestControls.explicitCaching === false &&
      ai.requestControls.developerLogging === false,
    'Gemini persistence and optional data-sharing surfaces must remain disabled',
  );
  invariant(
    ai?.retention?.paidServiceRequired === true &&
      ai.retention.providerAbuseMonitoringDaysWithoutZdr === 55 &&
      ai.retention.providerZdrApproval === 'pending-live' &&
      ai.retention.productionWithPiiAllowed === false,
    'Gemini must fail closed for PII until provider ZDR approval',
  );
  invariant(ai?.retention?.applicationTtlDays <= 30, 'AI TTL exceeds 30 days');

  const media = effects.find(({ id }) => id === 'meta.media-transfer');
  invariant(
    media?.retention?.storageMode === 'private-vps-volume' &&
      media.retention.expiryRule === 'earliest-of-journey-end-or-7-days' &&
      media.retention.maximumAgeDays === 7 &&
      media.retention.backupRequired === false &&
      media.retention.unavailableState === 'lost/unavailable',
    'Meta media must use the approved transient VPS retention contract',
  );
  invariant(
    media?.validFileHandoff?.destination ===
      'existing-dropbox-operational-repository' &&
      media.validFileHandoff.mode === 'manual-operational' &&
      media.validFileHandoff.apiIntegration === false &&
      media.validFileHandoff.failureExtendsTransientExpiry === false,
    'Valid media handoff must remain manual and never extend transient expiry',
  );

  const storage = effects.find(({ id }) => id === 'r2.put-object');
  if (!storage) throw new Error('R2 external effect is required');
  invariant(storage?.security?.publicAccess === false, 'R2 must be private');
  invariant(
    storage.status === 'deferred' &&
      storage.activation?.status === 'deferred-zero-incremental-cost' &&
      storage.activation.issue === 29 &&
      storage.activation.subscriptionAuthorized === false &&
      storage.activation.provisioningAuthorized === false &&
      storage.activation.transientMediaExcluded === true,
    'R2 must remain deferred to issue 29 and exclude transient media',
  );
  invariant(
    JSON.stringify(storage?.buckets) ===
      JSON.stringify([
        'crm-silmer-data',
        'crm-silmer-backups',
        'crm-silmer-tombstones',
      ]),
    'R2 requires three canonical, separate buckets',
  );
  invariant(
    storage?.security?.bucketLockRequired === true &&
      storage.security.bucketLockProviderControl ===
        'cloudflare-r2-bucket-lock' &&
      storage.security.bucketLockPrefix === 'tombstones/' &&
      storage.security.configurationAdminOutsideRuntime === true,
    'R2 immutable tombstones require governed provider-native Bucket Lock',
  );
  invariant(
    storage?.security?.s3ObjectLockSupported === false &&
      storage.security.s3ObjectLockHeadersAllowed === false &&
      storage.security.bucketVersioningSupported === false,
    'R2 must not claim S3 Object Lock or bucket versioning support',
  );
  invariant(
    storage?.security?.dataLocationApproval === 'pending-privacy' &&
      storage.security.locationHintIsResidencyGuarantee === false,
    'R2 location must remain pending Privacy approval',
  );
  invariant(
    storage?.security?.separateCredentialsByDataClass === true &&
      storage.security.crossBucketAccessMustFail === true,
    'R2 credentials must be segregated and cross-bucket access denied',
  );
  invariant(
    storage?.security?.signedUrlMaximumTtlSeconds <= 300 &&
      storage.security.rawSignedUrlAllowedInEvidence === false,
    'R2 signed URLs must be short-lived and absent from evidence',
  );
  invariant(
    storage?.resultQuery?.support === 'head-object' &&
      storage.outcomeUnknown?.automaticRetry === false &&
      /HEAD.*metadata\/hash/iu.test(storage.outcomeUnknown.strategy),
    'R2 outcome_unknown must reconcile by HEAD plus metadata hash',
  );
  return document;
}

/** @param {any} document */
export function validateLoadEnvelope(document) {
  invariant(document?.task === 'T00.4', 'Envelope must trace to T00.4');
  invariant(
    document.approval?.approved === false &&
      document.approval?.status === 'pending-human-approval',
    'Load envelope must not claim approval',
  );
  const dimensions = document.dimensions;
  invariant(
    dimensions?.operators?.authenticatedSessions === 20 &&
      dimensions.operators.concurrentSseConnections === 30,
    'Operator envelope drifted from TDD section 13',
  );
  invariant(
    dimensions?.webhooks?.sustainedEventsPerSecond === 5 &&
      dimensions.webhooks.burstEventsPerSecond === 20,
    'Webhook envelope drifted from TDD section 13',
  );
  invariant(
    dimensions?.workerRecovery?.backlogJobs === 1000 &&
      dimensions.workerRecovery.blindRetryOutcomeUnknown === false,
    'Worker envelope must preserve outcome_unknown safety',
  );
  invariant(
    dimensions?.attachmentsAndPdf?.concurrentUploadsAtConfiguredLimit === 4 &&
      dimensions.attachmentsAndPdf.queuedPdfs === 20 &&
      dimensions.attachmentsAndPdf.chromiumConcurrency === 1,
    'Attachment/PDF envelope drifted from TDD section 13',
  );
  invariant(
    dimensions?.referenceMass?.messages === 1_000_000,
    'Reference mass drifted from TDD section 13',
  );
  return document;
}

/** @param {any} document */
export function validateFixtures(document) {
  invariant(document?.syntheticOnly === true, 'Fixtures must be synthetic');
  invariant(
    document.meta?.signature?.synthetic === true,
    'Signature vector must be synthetic',
  );
  invariant(
    document.meta.signature.expectedHeader.startsWith('sha256='),
    'Signature header must use sha256=',
  );
  invariant(document.meta.messageFixture, 'Meta message fixture is required');
  invariant(document.meta.statusFixture, 'Meta status fixture is required');
  invariant(
    document.gemini?.schemaFixture,
    'Gemini schema fixture is required',
  );
  return document;
}

async function main() {
  const rootUrl = new URL('../', import.meta.url);
  /** @param {string} path */
  const readJson = async (path) =>
    JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
  validateExternalEffects(await readJson('docs/phase0/external-effects.json'));
  validateLoadEnvelope(await readJson('docs/phase0/load-envelope.json'));
  validateFixtures(await readJson('schemas/fixtures/external/manifest.json'));
  console.log(
    'External spikes valid: local evidence complete; live and human approvals remain explicit.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`External spikes invalid: ${error.message}`);
    process.exitCode = 1;
  });
}
