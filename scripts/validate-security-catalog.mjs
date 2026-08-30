import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const requiredFamilies = new Set([
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
]);
const retention = new Map([
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

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {any} document */
export function validateThreatModel(document) {
  invariant(document?.task === 'T00.5', 'Threat model must trace to T00.5');
  invariant(
    document.syntheticOnly === true,
    'Threat model must use synthetic data only',
  );
  invariant(
    document.approval?.techLead === 'pending' &&
      document.approval?.privacyOfficer === 'pending',
    'Human approvals must remain pending',
  );
  for (const key of ['assets', 'actors', 'trustBoundaries', 'threats'])
    invariant(
      Array.isArray(document[key]) && document[key].length > 0,
      `${key} is required`,
    );
  const threats = /** @type {Array<Record<string, any>>} */ (document.threats);
  const ids = new Set(threats.map(({ id }) => id));
  invariant(ids.size === threats.length, 'Threat IDs must be unique');
  const families = new Set(threats.map(({ family }) => family));
  for (const family of requiredFamilies)
    invariant(families.has(family), `Missing threat family ${family}`);
  for (const threat of threats) {
    for (const field of [
      'id',
      'family',
      'asset',
      'boundary',
      'mitigation',
      'owner',
      'test',
      'status',
    ])
      invariant(
        typeof threat[field] === 'string' && threat[field].length > 0,
        `${threat.id ?? 'Threat'} missing ${field}`,
      );
    invariant(
      Array.isArray(threat.requirements) && threat.requirements.length > 0,
      `${threat.id} missing requirements`,
    );
    invariant(
      ['planned', 'partially-mitigated'].includes(threat.status),
      `${threat.id} has invalid status`,
    );
  }
  return document;
}

/** @param {any} document */
export function validateDataCatalog(document) {
  invariant(document?.task === 'T00.5', 'Catalog must trace to T00.5');
  invariant(
    document.syntheticOnly === true,
    'Catalog must use synthetic data only',
  );
  invariant(
    document.approval?.techLead === 'pending' &&
      document.approval?.privacyOfficer === 'pending',
    'Human approvals must remain pending',
  );
  invariant(
    Array.isArray(document.dataClasses) &&
      document.dataClasses.length === retention.size,
    'Catalog must contain every P0.6 class',
  );
  const dataClasses = /** @type {Array<Record<string, any>>} */ (
    document.dataClasses
  );
  const ids = new Set(dataClasses.map(({ id }) => id));
  invariant(ids.size === retention.size, 'Catalog IDs must be unique');
  for (const [id, days] of retention)
    invariant(ids.has(id), `Missing P0.6 class ${id}`);
  for (const item of dataClasses) {
    invariant(
      item.maximumRetentionDays === retention.get(item.id),
      `${item.id} maximum retention drifted from P0.6`,
    );
    for (const field of [
      'pii',
      'purpose',
      'systemsAndCopies',
      'actorsAndOperators',
      'trigger',
      'destination',
      'legalHold',
      'deletionPropagation',
    ])
      invariant(
        Array.isArray(item[field])
          ? item[field].length > 0
          : typeof item[field] === 'string' && item[field].length > 0,
        `${item.id} missing ${field}`,
      );
  }
  const logs = dataClasses.find(({ id }) => id === 'technical-log');
  invariant(
    logs?.operationalRetentionDays === 30 && logs.maximumRetentionDays === 90,
    'Technical logs require 30-day operational retention and 90-day legal maximum',
  );
  const backup = dataClasses.find(({ id }) => id === 'backup');
  invariant(
    backup.deletionPropagation.some(
      /** @param {string} step */ (step) => /tombstone/iu.test(step),
    ),
    'Backup deletion propagation must reapply tombstones before restore readiness',
  );
  return document;
}

async function main() {
  const root = new URL('../', import.meta.url);
  /** @param {string} path */
  const json = async (path) =>
    JSON.parse(await readFile(new URL(path, root), 'utf8'));
  validateThreatModel(await json('docs/phase0/threat-model.json'));
  validateDataCatalog(await json('docs/phase0/data-catalog.json'));
  console.log(
    'Security catalog valid: T00.5 local evidence complete; Tech Lead and Privacy approvals remain pending.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Security catalog invalid: ${error.message}`);
    process.exitCode = 1;
  });
