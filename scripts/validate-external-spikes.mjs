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
  invariant(document?.schemaVersion === 2, 'Envelope schema must be version 2');

  const approval = document.approval;
  invariant(
    approval?.approved === true && approval.status === 'approved',
    'Load envelope approval must be complete',
  );
  invariant(
    Number.isFinite(Date.parse(approval.approvedAt)),
    'Load envelope approval needs an ISO date',
  );
  invariant(
    approval.approvedAt === '2026-08-31',
    'Load envelope approved date must match the recorded decision',
  );
  invariant(
    /^https:\/\/github\.com\/romulosutil\/crm-silmer\/issues\/8#issuecomment-\d+$/u.test(
      approval.evidenceRef,
    ),
    'Load envelope approval needs GitHub issue comment evidence',
  );
  invariant(
    approval.evidenceRef ===
      'https://github.com/romulosutil/crm-silmer/issues/8#issuecomment-5488137562',
    'Load envelope approved evidence must match the recorded decision',
  );
  const approvers = /** @type {Array<Record<string, any>>} */ (
    approval.approvers
  );
  invariant(
    Array.isArray(approvers) &&
      JSON.stringify(approvers.map(({ role }) => role)) ===
        JSON.stringify(['Produto', 'Operacao', 'Tech Lead']) &&
      approvers.every(
        ({ name, identity }) =>
          typeof name === 'string' &&
          name.trim().length > 0 &&
          /^github:[a-z0-9-]+$/u.test(identity),
      ),
    'Load envelope needs Produto, Operacao and Tech Lead approvers',
  );
  invariant(
    JSON.stringify(approvers) ===
      JSON.stringify([
        {
          role: 'Produto',
          name: 'Rômulo Sutil',
          identity: 'github:romulosutil',
        },
        {
          role: 'Operacao',
          name: 'Rômulo Sutil',
          identity: 'github:romulosutil',
        },
        {
          role: 'Tech Lead',
          name: 'Rômulo Sutil',
          identity: 'github:romulosutil',
        },
      ]),
    'Load envelope approved approvers must match the recorded decision',
  );

  const baseline = document.baseline;
  invariant(
    baseline?.status === 'engineering-homologation-baseline' &&
      baseline.source === 'TECHNICAL-DESIGN.md section 13' &&
      baseline.preserveOnRecalibration === true,
    'Engineering baseline must retain its TDD source',
  );
  const baselineDimensions = baseline.dimensions;
  invariant(
    baselineDimensions?.operators?.authenticatedSessions === 20 &&
      baselineDimensions.operators.concurrentSseConnections === 30 &&
      baselineDimensions.webhooks.sustainedEventsPerSecond === 5 &&
      baselineDimensions.webhooks.sustainedMinutes === 15 &&
      baselineDimensions.webhooks.burstEventsPerSecond === 20 &&
      baselineDimensions.webhooks.burstSeconds === 60 &&
      baselineDimensions.workerRecovery.backlogJobs === 1000 &&
      baselineDimensions.workerRecovery.blindRetryOutcomeUnknown === false &&
      baselineDimensions.attachmentsAndPdf
        .concurrentUploadsAtConfiguredLimit === 4 &&
      baselineDimensions.attachmentsAndPdf.queuedPdfs === 20 &&
      baselineDimensions.attachmentsAndPdf.chromiumConcurrency === 1 &&
      baselineDimensions.referenceMass.contacts === 50_000 &&
      baselineDimensions.referenceMass.conversations === 100_000 &&
      baselineDimensions.referenceMass.messages === 1_000_000 &&
      baselineDimensions.referenceMass.deals === 25_000,
    'Engineering baseline drifted from TDD section 13',
  );

  const forecast = document.forecast;
  invariant(
    forecast?.status === 'approved-pilot-forecast' &&
      forecast.horizon === 'first-12-months' &&
      forecast.source?.kind === 'approved-operational-estimate' &&
      forecast.source.recordedAt === approval.approvedAt &&
      forecast.source.evidenceRef === approval.evidenceRef &&
      forecast.source.expectedPeople === 5 &&
      forecast.source.expectedContactsPerBusinessDay === 25 &&
      forecast.source.observedInboxContacts === 89 &&
      forecast.source.observedBusinessDays === 4 &&
      forecast.source.messagesPerContact === 8 &&
      forecast.source.maximumTextCharacters === 140 &&
      forecast.source.attachmentsProfile ===
        'photos-and-design-files-heavy-files-rare',
    'Pilot forecast must retain its approved operational source',
  );
  invariant(
    forecast.derived?.messagesPerBusinessDay === 200 &&
      forecast.derived.contactsPer22BusinessDays === 550 &&
      forecast.derived.messagesPer22BusinessDays === 4_400 &&
      forecast.derived.contactsPer264BusinessDays === 6_600 &&
      forecast.derived.messagesPer264BusinessDays === 52_800,
    'Pilot forecast derived volume is inconsistent with the approved source',
  );

  const forecastDimensions = forecast.dimensions;
  invariant(
    forecastDimensions?.operators?.authenticatedSessions === 8 &&
      forecastDimensions.operators.concurrentSseConnections === 10 &&
      forecastDimensions.webhooks.sustainedEventsPerSecond === 1 &&
      forecastDimensions.webhooks.sustainedMinutes === 15 &&
      forecastDimensions.webhooks.burstEventsPerSecond === 5 &&
      forecastDimensions.webhooks.burstSeconds === 60 &&
      forecastDimensions.workerRecovery.backlogJobs === 300 &&
      forecastDimensions.workerRecovery.blindRetryOutcomeUnknown === false &&
      forecastDimensions.attachmentsAndPdf.estimatedAttachmentsPerDay === 100 &&
      forecastDimensions.attachmentsAndPdf.concurrentUploads === 2 &&
      forecastDimensions.attachmentsAndPdf.estimatedPdfsPerDay === 25 &&
      forecastDimensions.attachmentsAndPdf.queuedPdfs === 10 &&
      forecastDimensions.attachmentsAndPdf.chromiumConcurrency === 1 &&
      forecastDimensions.referenceMass.contacts === 10_000 &&
      forecastDimensions.referenceMass.conversations === 12_000 &&
      forecastDimensions.referenceMass.messages === 100_000 &&
      forecastDimensions.referenceMass.deals === 10_000,
    'Pilot forecast drifted from the approved issue 8 decision or engineering baseline',
  );
  invariant(
    forecastDimensions.operators.authenticatedSessions <=
      baselineDimensions.operators.authenticatedSessions &&
      forecastDimensions.operators.concurrentSseConnections <=
        baselineDimensions.operators.concurrentSseConnections &&
      forecastDimensions.webhooks.sustainedEventsPerSecond <=
        baselineDimensions.webhooks.sustainedEventsPerSecond &&
      forecastDimensions.webhooks.burstEventsPerSecond <=
        baselineDimensions.webhooks.burstEventsPerSecond &&
      forecastDimensions.workerRecovery.backlogJobs <=
        baselineDimensions.workerRecovery.backlogJobs &&
      forecastDimensions.attachmentsAndPdf.concurrentUploads <=
        baselineDimensions.attachmentsAndPdf
          .concurrentUploadsAtConfiguredLimit &&
      forecastDimensions.attachmentsAndPdf.queuedPdfs <=
        baselineDimensions.attachmentsAndPdf.queuedPdfs &&
      forecastDimensions.referenceMass.contacts <=
        baselineDimensions.referenceMass.contacts &&
      forecastDimensions.referenceMass.conversations <=
        baselineDimensions.referenceMass.conversations &&
      forecastDimensions.referenceMass.messages <=
        baselineDimensions.referenceMass.messages &&
      forecastDimensions.referenceMass.deals <=
        baselineDimensions.referenceMass.deals,
    'Pilot forecast must remain within the approved engineering baseline',
  );

  const sizing = document.sizing;
  invariant(
    sizing?.status === 'approved-no-adjustment' &&
      sizing.plan === 'Hostinger KVM 4' &&
      sizing.vcpu === 4 &&
      sizing.memoryGb === 16 &&
      sizing.storageGb === 200 &&
      sizing.forecastWithinBaseline === true &&
      Array.isArray(sizing.reviewTriggers) &&
      JSON.stringify(sizing.reviewTriggers) ===
        JSON.stringify([
          'forecast-exceeds-baseline',
          'T07.1-results',
          'two-weeks-real-usage',
        ]),
    'Sizing decision must keep KVM 4 and explicit review triggers',
  );
  invariant(
    document.liveEvidence?.executed === false &&
      document.liveEvidence.status === 'pending-T07.1-after-approval',
    'T07.1 real-load evidence must remain not executed after approval',
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
    'External spikes valid: load envelope approved; remaining live and human gates stay explicit.',
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
