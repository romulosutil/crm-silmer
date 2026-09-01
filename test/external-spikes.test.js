import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateExternalEffects,
  validateFixtures,
  validateLoadEnvelope,
} from '../scripts/validate-external-spikes.mjs';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} path */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
}

/** @param {string} path */
async function text(path) {
  return readFile(new URL(path, rootUrl), 'utf8');
}

test('validates the versioned external-effect matrix and load envelope', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const envelope = await json('docs/phase0/load-envelope.json');

  assert.doesNotThrow(() => validateExternalEffects(effects));
  assert.doesNotThrow(() => validateLoadEnvelope(envelope));
  assert.equal(effects.task, 'T00.4');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const ficha = effectList.find(({ id }) => id === 'pdf.generate-ficha');
  assert.equal(ficha?.status, 'approved-human');
  assert.ok(
    ficha?.evidence.some(
      (/** @type {Record<string, any>} */ item) =>
        item.url === 'docs/phase0/ficha-pdf-approved-evidence-v2.json',
    ),
  );
  assert.equal(envelope.approval.status, 'approved');
  assert.equal(envelope.approval.approved, true);
  assert.deepEqual(
    /** @type {Array<{role: string}>} */ (envelope.approval.approvers).map(
      ({ role }) => role,
    ),
    ['Produto', 'Operacao', 'Tech Lead'],
  );
});

test('preserves the engineering baseline beside the approved pilot forecast', async () => {
  const envelope = await json('docs/phase0/load-envelope.json');

  assert.equal(
    envelope.baseline.dimensions.operators.authenticatedSessions,
    20,
  );
  assert.equal(envelope.baseline.dimensions.webhooks.burstEventsPerSecond, 20);
  assert.equal(envelope.baseline.dimensions.referenceMass.messages, 1_000_000);
  assert.equal(envelope.forecast.source.expectedPeople, 5);
  assert.equal(envelope.forecast.source.expectedContactsPerBusinessDay, 25);
  assert.equal(envelope.forecast.source.observedInboxContacts, 89);
  assert.equal(envelope.forecast.source.observedBusinessDays, 4);
  assert.equal(envelope.forecast.source.messagesPerContact, 8);
  assert.equal(envelope.forecast.derived.messagesPerBusinessDay, 200);
  assert.equal(envelope.forecast.derived.messagesPer22BusinessDays, 4_400);
  assert.equal(envelope.forecast.derived.messagesPer264BusinessDays, 52_800);
  assert.equal(envelope.forecast.dimensions.referenceMass.messages, 100_000);
  assert.equal(envelope.sizing.status, 'approved-no-adjustment');
  assert.equal(envelope.sizing.plan, 'Hostinger KVM 4');
  assert.equal(envelope.sizing.forecastWithinBaseline, true);
  assert.equal(envelope.liveEvidence.executed, false);
  assert.equal(envelope.liveEvidence.status, 'pending-T07.1-after-approval');
});

test('rejects incomplete or untraceable load-envelope approval', async () => {
  const envelope = await json('docs/phase0/load-envelope.json');
  const missingApprover = structuredClone(envelope);
  missingApprover.approval.approvers.pop();
  assert.throws(
    () => validateLoadEnvelope(missingApprover),
    /Produto, Operacao and Tech Lead|approvers/iu,
  );

  const untraceable = structuredClone(envelope);
  untraceable.approval.evidenceRef = 'approved-in-chat';
  assert.throws(
    () => validateLoadEnvelope(untraceable),
    /issue comment evidence/iu,
  );

  const wrongDate = structuredClone(envelope);
  wrongDate.approval.approvedAt = 'August 31, 2026';
  wrongDate.forecast.source.recordedAt = 'August 31, 2026';
  assert.throws(() => validateLoadEnvelope(wrongDate), /approved date/iu);

  const nonexistentEvidence = structuredClone(envelope);
  nonexistentEvidence.approval.evidenceRef =
    'https://github.com/romulosutil/crm-silmer/issues/8#issuecomment-9999999999';
  nonexistentEvidence.forecast.source.evidenceRef =
    nonexistentEvidence.approval.evidenceRef;
  assert.throws(
    () => validateLoadEnvelope(nonexistentEvidence),
    /approved evidence/iu,
  );

  const forgedApprovers = structuredClone(envelope);
  forgedApprovers.approval.approvers = forgedApprovers.approval.approvers.map(
    /** @param {{ role: string }} approver */
    (approver) => ({
      role: approver.role,
      name: 'Mallory',
      identity: 'github:mallory',
    }),
  );
  assert.throws(
    () => validateLoadEnvelope(forgedApprovers),
    /approved approvers/iu,
  );
});

test('rejects baseline drift and a forecast that no longer fits the approved sizing', async () => {
  const envelope = await json('docs/phase0/load-envelope.json');

  const missingBaselineWebhooks = structuredClone(envelope);
  delete missingBaselineWebhooks.baseline.dimensions.webhooks;
  assert.throws(
    () => validateLoadEnvelope(missingBaselineWebhooks),
    /Engineering baseline drifted from TDD section 13/u,
  );

  const baselineDrift = structuredClone(envelope);
  baselineDrift.baseline.dimensions.referenceMass.messages = 999_999;
  assert.throws(
    () => validateLoadEnvelope(baselineDrift),
    /baseline.*TDD|TDD.*baseline/iu,
  );

  const missingForecastAttachments = structuredClone(envelope);
  delete missingForecastAttachments.forecast.dimensions.attachmentsAndPdf;
  assert.throws(
    () => validateLoadEnvelope(missingForecastAttachments),
    /Pilot forecast drifted from the approved issue 8 decision or engineering baseline/u,
  );

  const oversizedForecast = structuredClone(envelope);
  oversizedForecast.forecast.dimensions.referenceMass.messages = 1_000_001;
  assert.throws(
    () => validateLoadEnvelope(oversizedForecast),
    /forecast.*baseline|baseline.*forecast/iu,
  );
});

test('keeps T07.1 and real-load evidence pending after envelope approval', async () => {
  const envelope = await json('docs/phase0/load-envelope.json');
  const forgedLoadResult = structuredClone(envelope);
  forgedLoadResult.liveEvidence.executed = true;
  forgedLoadResult.liveEvidence.status = 'passed';

  assert.throws(
    () => validateLoadEnvelope(forgedLoadResult),
    /T07\.1.*not executed|not executed.*T07\.1/iu,
  );
});

test('keeps uncertain Meta sends out of blind retry', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const send = effectList.find(({ id }) => id === 'meta.send-message');

  assert.ok(send);
  assert.equal(send.idempotency.support, 'not-proven');
  assert.equal(send.resultQuery.support, 'not-proven-by-wamid');
  assert.equal(send.outcomeUnknown.automaticRetry, false);
  assert.match(send.outcomeUnknown.strategy, /reconcil/iu);
});

test('keeps Meta media transient and Dropbox operational only', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const media = effectList.find(({ id }) => id === 'meta.media-transfer');
  assert.ok(media);
  assert.equal(media.retention.maximumAgeDays, 7);
  assert.equal(media.retention.backupRequired, false);
  assert.equal(media.retention.unavailableState, 'lost/unavailable');
  assert.equal(media.validFileHandoff.mode, 'manual-operational');
  assert.equal(media.validFileHandoff.apiIntegration, false);
  assert.equal(media.validFileHandoff.failureExtendsTransientExpiry, false);
});

test('rejects a matrix that enables blind retry for an uncertain Meta send', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const unsafe = structuredClone(effects);
  const effectList = /** @type {Array<Record<string, any>>} */ (unsafe.effects);
  const send = effectList.find(({ id }) => id === 'meta.send-message');
  assert.ok(send);
  send.outcomeUnknown.automaticRetry = true;

  assert.throws(
    () => validateExternalEffects(unsafe),
    /Meta.*retry|retry.*Meta/iu,
  );
});

test('verifies synthetic Meta signature and representative local fixtures', async () => {
  const fixtures = await json('schemas/fixtures/external/manifest.json');
  assert.doesNotThrow(() => validateFixtures(fixtures));

  const vector = fixtures.meta.signature;
  const actual = `sha256=${createHmac('sha256', vector.appSecret).update(vector.rawBody).digest('hex')}`;
  assert.equal(actual, vector.expectedHeader);
  assert.equal(vector.synthetic, true);
});

test('requires Gemini minimization controls and private R2 posture', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );
  const ai = effectList.find(({ id }) => id === 'gemini.structured-response');
  const storage = effectList.find(({ id }) => id === 'r2.put-object');
  assert.ok(ai);
  assert.ok(storage);

  assert.deepEqual(ai.requestControls, {
    operation: 'models.generateContent',
    serverManagedConversationState: false,
    authKeyServerSideOnly: true,
    structuredOutput: 'strict-json-schema',
    grounding: false,
    fileApi: false,
    explicitCaching: false,
    developerLogging: false,
  });
  assert.equal(ai.model, 'gemini-2.5-flash-lite');
  assert.equal(ai.retention.paidServiceRequired, true);
  assert.equal(ai.retention.providerAbuseMonitoringDaysWithoutZdr, 55);
  assert.equal(ai.retention.providerZdrApproval, 'pending-live');
  assert.equal(ai.retention.productionWithPiiAllowed, false);
  assert.equal(storage.security.publicAccess, false);
  assert.equal(storage.security.bucketLockRequired, true);
  assert.equal(
    storage.security.bucketLockProviderControl,
    'cloudflare-r2-bucket-lock',
  );
  assert.equal(storage.security.bucketLockPrefix, 'tombstones/');
  assert.equal(storage.security.s3ObjectLockSupported, false);
  assert.equal(storage.security.s3ObjectLockHeadersAllowed, false);
  assert.equal(storage.security.bucketVersioningSupported, false);
  assert.equal(storage.security.dataLocationApproval, 'pending-privacy');
  assert.equal(storage.security.locationHintIsResidencyGuarantee, false);
  assert.equal(storage.security.separateCredentialsByDataClass, true);
  assert.equal(storage.security.crossBucketAccessMustFail, true);
  assert.equal(storage.security.signedUrlMaximumTtlSeconds, 300);
  assert.equal(storage.security.rawSignedUrlAllowedInEvidence, false);
  assert.equal(storage.status, 'deferred');
  assert.equal(storage.activation.issue, 29);
  assert.equal(storage.activation.subscriptionAuthorized, false);
  assert.equal(storage.activation.provisioningAuthorized, false);
  assert.equal(storage.activation.transientMediaExcluded, true);
  assert.deepEqual(storage.buckets, [
    'crm-silmer-data',
    'crm-silmer-backups',
    'crm-silmer-tombstones',
  ]);
});

test('documents an executable, fail-closed R2 gate without secret values', async () => {
  const guide = await text('docs/phase0/R2-VALIDATION.md');
  const gate = await json('docs/phase0/r2-control-plane.json');
  const environment = await text('docs/phase0/r2-live.env.example');
  const topology = await text('EASYPANEL-TOPOLOGY.md');
  const packageJson = await json('package.json');

  assert.equal(gate.task, 'T00.4');
  assert.equal(gate.issue, 29);
  assert.equal(gate.activation.status, 'deferred-zero-incremental-cost');
  assert.equal(gate.activation.subscriptionAuthorized, false);
  assert.equal(gate.activation.provisioningAuthorized, false);
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  assert.equal(gate.liveEvidence.executed, false);
  assert.equal(gate.s3Compatibility.s3ObjectLockSupported, false);
  assert.equal(gate.s3Compatibility.bucketVersioningSupported, false);
  assert.equal(gate.signedUrls.maximumTtlSeconds, 300);
  assert.match(guide, /HEAD.*SHA-256/iu);
  assert.match(guide, /não[\s\S]*S3\s+Object Lock/iu);
  assert.match(guide, /não há[\s\S]*controles live/iu);
  assert.match(topology, /Cloudflare R2 Bucket Lock/u);
  assert.match(topology, /R2 não implementa S3[\s\S]*Object Lock/iu);
  assert.equal(
    packageJson.scripts['smoke:r2:live'],
    'node scripts/r2-live-smoke.mjs',
  );
  assert.equal(
    packageJson.scripts['validate:r2'],
    'node scripts/validate-r2.mjs',
  );
  assert.equal(
    packageJson.scripts['test:r2'],
    'node --test test/r2-live-smoke.test.js',
  );
  for (const name of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'R2_BACKUP_ACCESS_KEY_ID',
    'R2_TOMBSTONE_READ_ACCESS_KEY_ID',
  ]) {
    assert.match(environment, new RegExp(`^${name}=$`, 'mu'));
  }
  assert.doesNotMatch(
    `${JSON.stringify(gate)}\n${environment}`,
    /AKIA[A-Z0-9]{16}|X-Amz-Signature=|Bearer\s+[A-Za-z0-9._-]+/u,
  );
});

test('does not convert load-envelope approval into external provider approval', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const envelope = await json('docs/phase0/load-envelope.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );

  assert.equal(effects.externalApprovalGranted, false);
  assert.equal(envelope.approval.approved, true);
  assert.ok(effectList.some(({ status }) => status === 'sandbox-verified'));
  assert.ok(effectList.some(({ status }) => status === 'pending-live'));
  assert.ok(effectList.some(({ status }) => status === 'deferred'));
});

test('documents a secret-free, non-production Meta sandbox procedure', async () => {
  const guide = await text('docs/phase0/META-SANDBOX.md');
  const evidence = await json('docs/phase0/meta-sandbox-live-evidence.json');
  const effects = await json('docs/phase0/external-effects.json');
  const packageJson = await json('package.json');
  const environment = await text('docs/phase0/meta-sandbox.env.example');

  assert.match(guide, /T00\.4/u);
  assert.match(guide, /\/api\/v1\/webhooks\/meta\/whatsapp/u);
  assert.match(guide, /npm run smoke:meta:sandbox/u);
  assert.match(guide, /PostgreSQL inbox|T02\.2/u);
  assert.match(guide, /não.*produção|non-production/iu);
  assert.doesNotMatch(guide, /\+55\s?\d{10,11}/u);
  assert.equal(evidence.task, 'T00.4');
  assert.equal(evidence.adapterSmoke.acceptedRequests, 4);
  assert.equal(evidence.tokenLifecycle.invalidatedAfterSmoke, true);
  const statusCoverage = /** @type {Array<{status: string}>} */ (
    evidence.statusCoverage
  );
  assert.deepEqual(
    statusCoverage.map(({ status }) => status),
    ['sent', 'delivered', 'read', 'failed'],
  );
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /EAA[A-Za-z0-9_.-]+|wamid\.|\+55\s?\d{10,11}|5527998447589/u,
  );
  const metaEffects = /** @type {Array<{id: string, status: string}>} */ (
    effects.effects
  ).filter(({ id }) => id.startsWith('meta.'));
  assert.equal(metaEffects.length, 4);
  assert.ok(metaEffects.every(({ status }) => status === 'sandbox-verified'));
  assert.equal(
    packageJson.scripts['smoke:meta:sandbox'],
    'node scripts/meta-sandbox-smoke.mjs',
  );
  for (const name of [
    'META_GRAPH_API_VERSION',
    'META_TEST_RECIPIENT_E164',
    'META_TEST_DOCUMENT_URL',
    'META_TEST_IMAGE_URL',
  ]) {
    assert.match(environment, new RegExp(`^${name}=$`, 'mu'));
  }
});
