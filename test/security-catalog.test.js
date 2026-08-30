import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateDataCatalog,
  validateThreatModel,
} from '../scripts/validate-security-catalog.mjs';

const rootUrl = new URL('../', import.meta.url);
/** @param {string} path */
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));

test('validates the T00.5 threat model and P0.6 data catalog', async () => {
  const threats = await readJson('docs/phase0/threat-model.json');
  const catalog = await readJson('docs/phase0/data-catalog.json');

  assert.doesNotThrow(() => validateThreatModel(threats));
  assert.doesNotThrow(() => validateDataCatalog(catalog));
  assert.deepEqual(threats.approval, {
    techLead: 'pending',
    privacyOfficer: 'pending',
  });
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
  ])
    assert.ok(families.has(family), `missing ${family}`);

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
  assert.equal(logs.operationalRetentionDays, 30);
  assert.equal(logs.maximumRetentionDays, 90);
});

test('rejects approval forgery and restore without tombstone propagation', async () => {
  const model = await readJson('docs/phase0/threat-model.json');
  const approved = structuredClone(model);
  approved.approval.techLead = 'approved';
  assert.throws(() => validateThreatModel(approved), /pending/iu);

  const catalog = await readJson('docs/phase0/data-catalog.json');
  const unsafe = structuredClone(catalog);
  const unsafeClasses = /** @type {Array<Record<string, any>>} */ (
    unsafe.dataClasses
  );
  const backup = unsafeClasses.find(({ id }) => id === 'backup');
  backup.deletionPropagation = [];
  assert.throws(() => validateDataCatalog(unsafe), /propagation/iu);
});
