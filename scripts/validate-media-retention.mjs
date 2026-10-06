import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {any} document */
export function validateMediaRetentionPolicy(document) {
  invariant(document?.task === 'T00.4', 'Media policy must trace to T00.4');
  invariant(document?.issue === 6, 'Media policy must trace to issue 6');
  invariant(
    document.decision?.status === 'approved-for-internal-pilot' &&
      document.decision.internalProductOnly === true &&
      document.decision.incrementalStorageCostAllowed === false,
    'Media policy must remain internal-only and forbid incremental storage cost',
  );
  invariant(
    document.transientMedia?.expiryRule === 'earliest-of' &&
      document.transientMedia.maximumAgeDays === 7 &&
      JSON.stringify(document.transientMedia.deadlines) ===
        JSON.stringify(['journey-terminal-at', 'media-at-plus-7-days']),
    'Transient media must expire at journey end or seven days, whichever comes first',
  );
  invariant(
    document.transientMedia.deleteBytes === true &&
      document.transientMedia.backupRequired === false,
    'Transient media bytes must be deleted and must not enter backups',
  );
  invariant(
    document.storage?.mode === 'private-vps-volume' &&
      document.storage.publicAccess === false &&
      document.storage.servedOnlyByAuthorizedApplicationRoute === true &&
      document.storage.opaquePathsWithoutPii === true &&
      document.storage.malwareAndContentValidationBeforeUse === true,
    'Local media storage must remain private, opaque and application-authorized',
  );
  invariant(
    document.storage?.quotaRequired === true &&
      document.storage.quotaFailureMode ===
        'reject-new-media-keep-text-journey-operational',
    'Local media storage needs a fail-closed quota without stopping text journeys',
  );
  invariant(
    document.storage?.hostLossAcceptedForTransientMedia === true &&
      document.storage.unavailableState === 'lost/unavailable',
    'The accepted single-host media-loss risk must remain explicit',
  );
  invariant(
    document.validFileArchive?.destination === 'crm-order-files-rustfs' &&
      document.validFileArchive.decisionRecord ===
        'docs/adr/021-arquivos-da-arte-no-rustfs.md' &&
      document.validFileArchive.handoffMode ===
        'operator-attaches-file-to-order' &&
      document.validFileArchive.automaticPromotion === false &&
      document.validFileArchive.promotionRequiresValidation === true &&
      JSON.stringify(document.validFileArchive.promotionRequires) ===
        JSON.stringify([
          'technical-validation-passed',
          'operator-classified-operational-purpose',
        ]) &&
      document.validFileArchive.retentionFollowsDataClass === true &&
      document.validFileArchive.recordHashAndHandoffMetadataInCrm === true &&
      document.validFileArchive.deleteTransientBytesAfterRecordedHandoff ===
        true &&
      document.validFileArchive.archiveFailureNeverExtendsTransientExpiry ===
        true &&
      document.validFileArchive.missedArchiveOutcome === 'archive_missed',
    'Valid files require a recorded operator handoff to the order files in RustFS without automatic promotion',
  );
  invariant(
    document.validFileArchive.storedOnlyThroughCrmApi === true &&
      document.validFileArchive.publicAccess === false &&
      document.validFileArchive.includedInOffHostBackup === true,
    'Order files in RustFS must stay private, reachable only through the CRM API and inside the off-host backup',
  );
  const allowedArchiveFields = [
    'archiveFailureNeverExtendsTransientExpiry',
    'automaticPromotion',
    'decisionRecord',
    'deleteTransientBytesAfterRecordedHandoff',
    'destination',
    'handoffMode',
    'includedInOffHostBackup',
    'missedArchiveOutcome',
    'operatorDeletionIsReconciledAsOperationalLimitation',
    'promotionRequires',
    'promotionRequiresValidation',
    'publicAccess',
    'recordHashAndHandoffMetadataInCrm',
    'retentionFollowsDataClass',
    'storedOnlyThroughCrmApi',
  ];
  invariant(
    JSON.stringify(Object.keys(document.validFileArchive).sort()) ===
      JSON.stringify(allowedArchiveFields),
    'Valid-file policy must use a closed schema without endpoint, credential, token, SDK or webhook fields',
  );
  const durable = new Set(document.durableDataExcludedFromTransientPolicy);
  for (const required of [
    'Pedido',
    'Ficha versionada',
    'orçamento aprovado',
    'comprovante PIX válido',
    'eventos comerciais',
    'auditoria',
    'tombstones',
    'backups de banco',
  ]) {
    invariant(
      durable.has(required),
      `${required} cannot use transient retention`,
    );
  }
  invariant(
    document.legalHold?.transientVolumeMayIgnoreExpiry === false &&
      document.legalHold.requiredEvidenceMustBePromotedBeforeExpiry === true,
    'Legal-hold evidence must leave the transient volume before its deadline',
  );
  invariant(
    document.futureObjectStorage?.cloudflareR2Activation === 'deferred' &&
      document.futureObjectStorage.followUpIssue === 29 &&
      document.futureObjectStorage.subscriptionOrProvisioningAuthorized ===
        false,
    'R2 must remain deferred and unauthorized while zero incremental cost is required',
  );
  return document;
}

async function main() {
  const rootUrl = new URL('../', import.meta.url);
  const policy = JSON.parse(
    await readFile(
      new URL('docs/phase0/media-retention-policy.json', rootUrl),
      'utf8',
    ),
  );
  validateMediaRetentionPolicy(policy);
  console.log(
    'Media retention valid: private zero-cost staging, earliest-of seven days or journey end, valid files in RustFS, R2 deferred.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Media retention invalid: ${error.message}`);
    process.exitCode = 1;
  });
}
