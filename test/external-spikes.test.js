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
  assert.equal(envelope.approval.status, 'pending-human-approval');
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

test('does not convert sandbox evidence into external approval claims', async () => {
  const effects = await json('docs/phase0/external-effects.json');
  const envelope = await json('docs/phase0/load-envelope.json');
  const effectList = /** @type {Array<Record<string, any>>} */ (
    effects.effects
  );

  assert.equal(effects.externalApprovalGranted, false);
  assert.equal(envelope.approval.approved, false);
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
