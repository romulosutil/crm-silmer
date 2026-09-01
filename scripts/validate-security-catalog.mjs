import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const reviewRecordPath = 'docs/phase0/security-review.json';
const approvedReview = Object.freeze({
  reviewerName: 'Romulo Sutil Correa',
  reviewerIdentifier: 'github:romulosutil',
  reviewedAt: '2026-09-01T11:32:24Z',
  evidenceReference:
    'https://github.com/romulosutil/crm-silmer/issues/9#issuecomment-5493274558',
  revision: 'git:a0d5d6e4fa1d4521c84cb69e66777461e6719e20',
});
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
  'local-media-volume-exposure',
  'transient-media-retention-drift',
]);
const requiredFindings = new Map([
  ['T005-F01', 'resolved'],
  ['T005-F02', 'resolved'],
  ['T005-F03', 'resolved'],
  ['T005-F04', 'accepted'],
  ['T005-F05', 'accepted'],
]);
const retention = new Map([
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

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** @param {string | Buffer} contents */
function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

/** @param {any} document @param {string} label */
function validateApprovalReference(document, label) {
  invariant(
    document.approval?.status === 'approved' &&
      document.approval?.reviewRecord === reviewRecordPath,
    `${label} must reference the approved T00.5 review record`,
  );
}

/** @param {any} document */
export function validateThreatModel(document) {
  invariant(document?.task === 'T00.5', 'Threat model must trace to T00.5');
  invariant(
    document.syntheticOnly === true,
    'Threat model must use synthetic data only',
  );
  validateApprovalReference(document, 'Threat model');
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
  validateApprovalReference(document, 'Catalog');
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
  for (const id of retention.keys())
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
  if (!backup) throw new Error('Backup class is missing');
  invariant(
    backup.deletionPropagation.some(
      /** @param {string} step */ (step) => /tombstone/iu.test(step),
    ),
    'Backup deletion propagation must reapply tombstones before restore readiness',
  );
  const transientMedia = dataClasses.find(
    ({ id }) => id === 'transient-journey-media',
  );
  invariant(
    transientMedia?.maximumRetentionDays === 7 &&
      /journey terminal state.*seven days.*whichever occurs first/iu.test(
        transientMedia.trigger,
      ) &&
      transientMedia.systemsAndCopies.includes('private VPS media volume') &&
      transientMedia.deletionPropagation.includes('private VPS media volume'),
    'Transient journey media must expire at journey end or seven days on the private VPS volume',
  );
  return document;
}

/**
 * @param {any} review
 * @param {any} threatModel
 * @param {any} dataCatalog
 * @param {Record<string, string | Buffer>} artifactContents
 */
export function validateSecurityReview(
  review,
  threatModel,
  dataCatalog,
  artifactContents,
) {
  invariant(
    review?.schemaVersion === 1 && review.task === 'T00.5',
    'Security review must use the T00.5 schema',
  );
  invariant(review.status === 'approved', 'Security review must be approved');
  invariant(
    isIsoTimestamp(review.approvedAt) &&
      review.approvedAt === approvedReview.reviewedAt,
    'Security review approval date differs from the approved evidence',
  );
  invariant(
    review.scope?.revision === approvedReview.revision,
    'Security review baseline revision differs from the approved evidence',
  );

  const scopedArtifacts = [
    {
      label: 'Threat model',
      scope: review.scope?.threatModel,
      expectedPath: 'docs/phase0/threat-model.json',
      countField: 'threatCount',
      actualCount: threatModel?.threats?.length,
    },
    {
      label: 'Data catalog',
      scope: review.scope?.dataCatalog,
      expectedPath: 'docs/phase0/data-catalog.json',
      countField: 'dataClassCount',
      actualCount: dataCatalog?.dataClasses?.length,
    },
  ];
  for (const artifact of scopedArtifacts) {
    invariant(
      artifact.scope?.path === artifact.expectedPath,
      `${artifact.label} review path is invalid`,
    );
    invariant(
      artifact.scope?.[artifact.countField] === artifact.actualCount,
      `${artifact.label} approved count drifted`,
    );
    invariant(
      /^[0-9a-f]{64}$/u.test(artifact.scope?.sha256 ?? ''),
      `${artifact.label} requires a SHA-256 digest`,
    );
    invariant(
      Object.hasOwn(artifactContents, artifact.expectedPath),
      `${artifact.label} contents are required for approval validation`,
    );
    invariant(
      sha256(artifactContents[artifact.expectedPath]) === artifact.scope.sha256,
      `${artifact.label} changed after human approval`,
    );
  }

  invariant(
    Array.isArray(review.reviews) && review.reviews.length === 2,
    'Security review requires exactly two role approvals',
  );
  const expectedAuthorities = new Map([
    ['Tech Lead', 'explicit-delegation-for-issue-9'],
    ['Responsavel de Privacidade', 'named-privacy-officer'],
  ]);
  const reviews = /** @type {Array<Record<string, any>>} */ (review.reviews);
  const roles = new Set(reviews.map((item) => item.role));
  invariant(
    roles.size === expectedAuthorities.size &&
      [...expectedAuthorities.keys()].every((role) => roles.has(role)),
    'Security review roles are incomplete or duplicated',
  );
  for (const item of reviews) {
    invariant(
      item.status === 'approved',
      `${item.role} approval is incomplete`,
    );
    invariant(
      item.reviewer?.name === approvedReview.reviewerName &&
        item.reviewer?.identifier === approvedReview.reviewerIdentifier,
      `${item.role} reviewer identity differs from the approved evidence`,
    );
    invariant(
      item.reviewer?.authority === expectedAuthorities.get(item.role),
      `${item.role} approval authority is invalid`,
    );
    invariant(
      isIsoTimestamp(item.reviewedAt) &&
        item.reviewedAt === approvedReview.reviewedAt,
      `${item.role} review date differs from the approved evidence`,
    );
    invariant(
      item.evidence?.reference === approvedReview.evidenceReference &&
        item.evidence?.revision === approvedReview.revision,
      `${item.role} approval evidence differs from the approved evidence`,
    );
  }

  invariant(
    Array.isArray(review.findings) &&
      review.findings.length === requiredFindings.size,
    'Security review must dispose every finding',
  );
  const findings = /** @type {Array<Record<string, any>>} */ (review.findings);
  const findingIds = new Set(findings.map((item) => item.id));
  invariant(
    findingIds.size === requiredFindings.size,
    'Security review finding IDs must be unique',
  );
  for (const [id, disposition] of requiredFindings) {
    const finding = findings.find((item) => item.id === id);
    if (!finding) throw new Error(`Security review is missing finding ${id}`);
    invariant(
      finding.disposition === disposition,
      `${id} has an invalid disposition`,
    );
    invariant(
      typeof finding.justification === 'string' &&
        finding.justification.length >= 40,
      `${id} requires a versioned justification`,
    );
    const references = finding.evidence ?? finding.tracking;
    invariant(
      Array.isArray(references) && references.length > 0,
      `${id} requires evidence or tracking`,
    );
  }

  invariant(
    review.conditions?.plannedControlsAreOperationalEvidence === false,
    'Planned controls cannot be represented as operational evidence',
  );
  invariant(
    review.conditions?.geminiPiiProductionAllowed === false &&
      review.conditions?.geminiPiiProductionBlockedByIssue === 5,
    'Gemini PII processing must remain blocked by issue 5',
  );
  return review;
}

async function main() {
  const root = new URL('../', import.meta.url);
  /** @param {string} path */
  const raw = async (path) => readFile(new URL(path, root), 'utf8');
  const threatPath = 'docs/phase0/threat-model.json';
  const catalogPath = 'docs/phase0/data-catalog.json';
  const [threatRaw, catalogRaw, reviewRaw] = await Promise.all([
    raw(threatPath),
    raw(catalogPath),
    raw(reviewRecordPath),
  ]);
  const threatModel = JSON.parse(threatRaw);
  const dataCatalog = JSON.parse(catalogRaw);
  const review = JSON.parse(reviewRaw);
  validateThreatModel(threatModel);
  validateDataCatalog(dataCatalog);
  validateSecurityReview(review, threatModel, dataCatalog, {
    [threatPath]: threatRaw,
    [catalogPath]: catalogRaw,
  });
  console.log(
    'Security catalog valid: T00.5 approved by Tech Lead and Privacy; planned controls and Gemini PII remain fail-closed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Security catalog invalid: ${error.message}`);
    process.exitCode = 1;
  });
