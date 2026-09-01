import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateDataCatalog,
  validateSecurityReview,
  validateThreatModel,
} from '../scripts/validate-security-catalog.mjs';

const rootUrl = new URL('../', import.meta.url);
/** @param {string} path */
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
/** @param {string} path */
const readRaw = async (path) => readFile(new URL(path, rootUrl), 'utf8');

test('validates the approved T00.5 threat model and P0.6 data catalog', async () => {
  const threatPath = 'docs/phase0/threat-model.json';
  const catalogPath = 'docs/phase0/data-catalog.json';
  const threats = await readJson('docs/phase0/threat-model.json');
  const catalog = await readJson('docs/phase0/data-catalog.json');
  const review = await readJson('docs/phase0/security-review.json');
  const artifactContents = {
    [threatPath]: await readRaw(threatPath),
    [catalogPath]: await readRaw(catalogPath),
  };

  assert.doesNotThrow(() => validateThreatModel(threats));
  assert.doesNotThrow(() => validateDataCatalog(catalog));
  assert.doesNotThrow(() =>
    validateSecurityReview(review, threats, catalog, artifactContents),
  );
  assert.equal(threats.approval.status, 'approved');
  assert.equal(review.reviews.length, 2);
  const reviews = /** @type {Array<Record<string, any>>} */ (review.reviews);
  assert.deepEqual(reviews.map((item) => item.role).sort(), [
    'Responsavel de Privacidade',
    'Tech Lead',
  ]);
  assert.equal(catalog.syntheticOnly, true);
});

test('covers every required abuse family and gives each threat an executable owner', async () => {
  const model = await readJson('docs/phase0/threat-model.json');
  const threats = /** @type {Array<Record<string, any>>} */ (model.threats);
  const families = new Set(threats.map(({ family }) => family));
  for (const family of [
    'idor-acl',
    'csrf-session',
    'webhook-spoof-replay',
    'ssrf-media',
    'malicious-upload',
    'prompt-injection-exfiltration',
    'supply-chain',
    'secret-log-leak',
    'insider-privilege',
    'external-outcome-unknown',
    'restore-resurrection',
    'backup-storage-exposure',
    'denial-of-service',
    'local-media-volume-exposure',
    'transient-media-retention-drift',
  ])
    assert.ok(families.has(family), `missing ${family}`);

  assert.equal(threats.length, 15);
  for (const threat of threats) {
    for (const field of [
      'asset',
      'boundary',
      'mitigation',
      'owner',
      'test',
      'requirements',
      'status',
    ])
      assert.ok(threat[field], `${threat.id} missing ${field}`);
  }
});

test('keeps P0.6 maximum retention exact and logs operationally at 30 days', async () => {
  const catalog = await readJson('docs/phase0/data-catalog.json');
  const expected = new Map([
    ['transient-journey-media', 7],
    ['conversation-no-lead', 90],
    ['lost-deal', 365],
    ['closed-sale-nondocumentary-content', 730],
    ['commercial-documents', 1825],
    ['processed-webhook-payload', 30],
    ['reconciliation-payload', 90],
    ['technical-log', 90],
    ['ai-technical-request-response', 30],
    ['backup', 35],
  ]);
  assert.equal(catalog.dataClasses.length, expected.size);
  const dataClasses = /** @type {Array<Record<string, any>>} */ (
    catalog.dataClasses
  );
  for (const item of dataClasses) {
    assert.equal(item.maximumRetentionDays, expected.get(item.id));
    assert.ok(item.deletionPropagation.length > 0);
  }
  const logs = dataClasses.find(({ id }) => id === 'technical-log');
  assert.ok(logs);
  assert.equal(logs.operationalRetentionDays, 30);
  assert.equal(logs.maximumRetentionDays, 90);
  const transientMedia = dataClasses.find(
    ({ id }) => id === 'transient-journey-media',
  );
  assert.ok(transientMedia);
  assert.match(transientMedia.trigger, /whichever occurs first/iu);
  assert.ok(
    transientMedia.systemsAndCopies.includes('private VPS media volume'),
  );
});

test('rejects incomplete review evidence and unapproved artifact drift', async () => {
  const threatPath = 'docs/phase0/threat-model.json';
  const catalogPath = 'docs/phase0/data-catalog.json';
  const model = await readJson('docs/phase0/threat-model.json');
  const catalog = await readJson('docs/phase0/data-catalog.json');
  const review = await readJson('docs/phase0/security-review.json');
  const artifactContents = {
    [threatPath]: await readRaw(threatPath),
    [catalogPath]: await readRaw(catalogPath),
  };

  const forged = structuredClone(review);
  forged.reviews[0].reviewer.authority = 'self-appointed';
  assert.throws(
    () => validateSecurityReview(forged, model, catalog, artifactContents),
    /authority/iu,
  );

  const forgedIdentity = structuredClone(review);
  forgedIdentity.reviews[0].reviewer.name = 'Mallory';
  forgedIdentity.reviews[0].reviewer.identifier = 'github:mallory';
  assert.throws(
    () =>
      validateSecurityReview(forgedIdentity, model, catalog, artifactContents),
    /reviewer identity differs/iu,
  );

  const forgedComment = structuredClone(review);
  forgedComment.reviews[0].evidence.reference =
    'https://github.com/romulosutil/crm-silmer/issues/9#issuecomment-5488683394';
  assert.throws(
    () =>
      validateSecurityReview(forgedComment, model, catalog, artifactContents),
    /approval evidence differs/iu,
  );

  const invalidDate = structuredClone(review);
  invalidDate.reviews[1].reviewedAt = '2026-09-01T11:32:25Z';
  assert.throws(
    () => validateSecurityReview(invalidDate, model, catalog, artifactContents),
    /review date differs/iu,
  );

  const unversioned = structuredClone(review);
  unversioned.scope.revision = `git:${'0'.repeat(40)}`;
  assert.throws(
    () => validateSecurityReview(unversioned, model, catalog, artifactContents),
    /baseline revision differs/iu,
  );

  const forgedEvidenceRevision = structuredClone(review);
  forgedEvidenceRevision.reviews[1].evidence.revision = `git:${'0'.repeat(40)}`;
  assert.throws(
    () =>
      validateSecurityReview(
        forgedEvidenceRevision,
        model,
        catalog,
        artifactContents,
      ),
    /approval evidence differs/iu,
  );

  const incomplete = structuredClone(review);
  const incompleteFindings = /** @type {Array<Record<string, any>>} */ (
    incomplete.findings
  );
  incomplete.findings = incompleteFindings.filter(
    (item) => item.id !== 'T005-F05',
  );
  assert.throws(
    () => validateSecurityReview(incomplete, model, catalog, artifactContents),
    /every finding/iu,
  );

  const driftedContents = {
    ...artifactContents,
    [threatPath]: `${artifactContents[threatPath]} `,
  };
  assert.throws(
    () => validateSecurityReview(review, model, catalog, driftedContents),
    /changed after human approval/iu,
  );

  const missingThreat = structuredClone(model);
  const missingThreats = /** @type {Array<Record<string, any>>} */ (
    missingThreat.threats
  );
  missingThreat.threats = missingThreats.filter(
    (item) => item.family !== 'transient-media-retention-drift',
  );
  assert.throws(
    () => validateThreatModel(missingThreat),
    /transient-media-retention-drift/iu,
  );

  const unsafe = structuredClone(catalog);
  const unsafeClasses = /** @type {Array<Record<string, any>>} */ (
    unsafe.dataClasses
  );
  const backup = unsafeClasses.find(({ id }) => id === 'backup');
  assert.ok(backup);
  backup.deletionPropagation = [];
  assert.throws(() => validateDataCatalog(unsafe), /propagation/iu);
});
