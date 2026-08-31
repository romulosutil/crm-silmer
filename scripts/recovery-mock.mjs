import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateTopologyDocument } from './validate-topology.mjs';

const expectedDigestKeys = ['edge-web', 'runtime'];
const expectedAdapterKeys = [
  'meta',
  'ai',
  'objectStorage',
  'telemetry',
  'tombstones',
];
const expectedRecoveryCheckKeys = [
  'easypanelRestorableBackup',
  'externalBackup',
  'tombstoneLedgerT063',
  'twoCustodianEscrow',
  'cleanVpsDrill',
  'temporaryDnsDrill',
  'objectVersionRestore',
  'fullSmoke',
];
const expectedCadenceKeys = [
  'monthlyDatabaseRestore',
  'quarterlyFullHostDrill',
];
const evidenceReferencePattern =
  /^(easypanel-audit|github-issue|recovery-approval|recovery-evidence|repository):\/\/[a-zA-Z0-9._/#-]+$/u;
const approvedAdjustmentPattern =
  /^recovery-approval:\/\/issue-3\/[a-zA-Z0-9._/-]+$/u;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const expectedGateKeys = [
  'schemaVersion',
  'task',
  'originTask',
  'issue',
  'mode',
  'status',
  'observedAt',
  'evidencePolicy',
  'evidenceRefs',
  'slo',
  'cadence',
  'checks',
  'checkEvidence',
  'blockers',
];
const expectedCadenceEntryKeys = [
  'status',
  'startedAt',
  'completedAt',
  'measuredRpoMinutes',
  'measuredRtoMinutes',
  'temporaryResourcesDestroyed',
  'evidenceRefs',
];
const expectedBlockerKeys = [
  'id',
  'summary',
  'ownerRole',
  'dueGate',
  'evidenceRefs',
];

/**
 * @param {unknown} condition
 * @param {string} message
 */
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * @param {unknown[]} actual
 * @param {unknown[]} expected
 */
function sameArray(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/** @param {unknown} value */
function rejectSensitiveRecoveryMaterial(value) {
  if (Array.isArray(value)) {
    value.forEach(rejectSensitiveRecoveryMaterial);
    return;
  }
  if (typeof value === 'string') {
    if (evidenceReferencePattern.test(value)) {
      return;
    }
    invariant(
      !/https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\bAKIA[0-9A-Z]{16}\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|-----BEGIN|\b(?:sk|ghp)_[a-z0-9_-]+/iu.test(
        value,
      ),
      'Recovery drill gate contains sensitive or concrete material',
    );
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    invariant(
      !/^(credential|password|privateKey|secret|token|host|hostname|ip|ipAddress|email|phone|address|domain|dnsTarget)$/iu.test(
        key,
      ),
      `Recovery drill gate contains sensitive field ${key}`,
    );
    rejectSensitiveRecoveryMaterial(child);
  }
}

/** @param {unknown} references */
function validateEvidenceReferences(references) {
  invariant(
    Array.isArray(references) &&
      references.every(
        (reference) =>
          typeof reference === 'string' &&
          evidenceReferencePattern.test(reference),
      ),
    'Recovery evidence must use opaque references only',
  );
}

/** @param {any} gate */
export function validateRecoveryDrillGate(gate) {
  invariant(
    gate && typeof gate === 'object',
    'Recovery drill gate must be an object',
  );
  rejectSensitiveRecoveryMaterial(gate);
  invariant(
    sameArray(Object.keys(gate), expectedGateKeys),
    'Recovery drill gate contains an unexpected field or incomplete schema',
  );
  invariant(
    gate.schemaVersion === 1,
    'Recovery drill gate must use schema version 1',
  );
  invariant(gate.task === 'T07.3', 'Recovery drill gate must trace to T07.3');
  invariant(
    gate.originTask === 'T00.3',
    'Recovery drill gate must retain T00.3 as its origin task',
  );
  invariant(gate.issue === 3, 'Recovery drill gate must reference issue 3');
  invariant(
    gate.mode === 'recovery-drill-evidence-gate',
    'Recovery drill gate must use the evidence gate mode',
  );
  invariant(
    ['blocked', 'passed'].includes(gate.status),
    'Recovery drill gate has an invalid status',
  );
  const observedAt = Date.parse(`${gate.observedAt}T00:00:00Z`);
  invariant(
    typeof gate.observedAt === 'string' &&
      isoDatePattern.test(gate.observedAt) &&
      Number.isFinite(observedAt) &&
      new Date(observedAt).toISOString().slice(0, 10) === gate.observedAt &&
      observedAt <= Date.now(),
    'Recovery drill gate must declare a valid, non-future ISO observation date',
  );
  invariant(
    sameArray(Object.keys(gate.evidencePolicy ?? {}), [
      'referencesOnly',
      'hostValuesAllowed',
      'piiAllowed',
      'secretValuesAllowed',
    ]) &&
      gate.evidencePolicy?.referencesOnly === true &&
      gate.evidencePolicy?.hostValuesAllowed === false &&
      gate.evidencePolicy?.piiAllowed === false &&
      gate.evidencePolicy?.secretValuesAllowed === false,
    'Recovery evidence policy must forbid hosts, PII, and secret values',
  );
  validateEvidenceReferences(gate.evidenceRefs);
  invariant(
    sameArray(Object.keys(gate.slo ?? {}), [
      'rpoMinutes',
      'rtoMinutes',
      'approvedAdjustmentRef',
    ]) &&
      gate.slo?.rpoMinutes === 60 &&
      gate.slo?.rtoMinutes === 240,
    'Recovery drill gate must preserve the approved RPO and RTO targets',
  );
  if (gate.slo.approvedAdjustmentRef !== null) {
    invariant(
      typeof gate.slo.approvedAdjustmentRef === 'string' &&
        approvedAdjustmentPattern.test(gate.slo.approvedAdjustmentRef),
      'SLO changes require a recovery-approval reference for issue 3',
    );
  }

  invariant(
    sameArray(Object.keys(gate.checks ?? {}), expectedRecoveryCheckKeys),
    'Recovery drill gate must contain every check exactly once',
  );
  const checkValues = Object.values(gate.checks);
  invariant(
    checkValues.every((status) =>
      ['passed', 'pending', 'blocked'].includes(status),
    ),
    'Recovery checks must use passed, pending, or blocked',
  );

  invariant(
    sameArray(Object.keys(gate.cadence ?? {}), expectedCadenceKeys),
    'Recovery drill gate must contain monthly and quarterly cadence',
  );
  for (const [cadenceName, cadence] of Object.entries(gate.cadence)) {
    invariant(
      sameArray(Object.keys(cadence), expectedCadenceEntryKeys),
      `${cadenceName} contains an unexpected field or incomplete schema`,
    );
    invariant(
      ['passed', 'pending', 'blocked'].includes(cadence.status),
      `${cadenceName} has an invalid status`,
    );
    validateEvidenceReferences(cadence.evidenceRefs);
    if (cadence.status === 'passed') {
      invariant(
        typeof cadence.startedAt === 'string' &&
          isoTimestampPattern.test(cadence.startedAt) &&
          typeof cadence.completedAt === 'string' &&
          isoTimestampPattern.test(cadence.completedAt) &&
          Number.isFinite(Date.parse(cadence.startedAt)) &&
          Number.isFinite(Date.parse(cadence.completedAt)) &&
          Date.parse(cadence.completedAt) >= Date.parse(cadence.startedAt) &&
          Date.parse(cadence.completedAt) <= Date.now(),
        `${cadenceName} passed without valid, non-future timestamps`,
      );
      invariant(
        typeof cadence.measuredRpoMinutes === 'number' &&
          cadence.measuredRpoMinutes >= 0,
        `${cadenceName} passed without a measured RPO`,
      );
      invariant(
        typeof cadence.measuredRtoMinutes === 'number' &&
          cadence.measuredRtoMinutes >= 0,
        `${cadenceName} passed without a measured RTO`,
      );
      invariant(
        cadence.temporaryResourcesDestroyed === true,
        `${cadenceName} passed before temporary resources were destroyed`,
      );
    }
  }

  invariant(
    sameArray(Object.keys(gate.checkEvidence ?? {}), expectedRecoveryCheckKeys),
    'Recovery drill gate must contain evidence for every check exactly once',
  );
  for (const checkName of expectedRecoveryCheckKeys) {
    validateEvidenceReferences(gate.checkEvidence[checkName]);
  }

  invariant(Array.isArray(gate.blockers), 'Recovery blockers must be an array');
  const blockerIds = new Set();
  for (const blocker of gate.blockers) {
    invariant(
      blocker && sameArray(Object.keys(blocker), expectedBlockerKeys),
      'Recovery blocker contains an unexpected field or incomplete schema',
    );
    invariant(
      blocker &&
        typeof blocker.id === 'string' &&
        typeof blocker.summary === 'string' &&
        typeof blocker.ownerRole === 'string' &&
        typeof blocker.dueGate === 'string',
      'Recovery blockers must declare id, summary, owner role, and due gate',
    );
    invariant(
      !blockerIds.has(blocker.id),
      `Recovery blocker ${blocker.id} is duplicated`,
    );
    blockerIds.add(blocker.id);
    validateEvidenceReferences(blocker.evidenceRefs);
  }

  if (gate.status === 'passed') {
    const monthlyEvidenceRefs = /** @type {string[]} */ (
      gate.cadence.monthlyDatabaseRestore.evidenceRefs
    );
    const quarterlyEvidenceRefs = /** @type {string[]} */ (
      gate.cadence.quarterlyFullHostDrill.evidenceRefs
    );
    invariant(
      gate.blockers.length === 0,
      'Recovery drill gate cannot be passed while blockers remain',
    );
    invariant(
      checkValues.every((status) => status === 'passed'),
      'Recovery drill gate cannot be passed while a check is not passed',
    );
    invariant(
      gate.cadence.monthlyDatabaseRestore.status === 'passed' &&
        monthlyEvidenceRefs.length > 0 &&
        monthlyEvidenceRefs.every((reference) =>
          /^recovery-evidence:\/\/issue-3\/monthly\//u.test(reference),
        ),
      'Passed recovery gate requires monthly evidence',
    );
    invariant(
      gate.cadence.quarterlyFullHostDrill.status === 'passed' &&
        quarterlyEvidenceRefs.length > 0 &&
        quarterlyEvidenceRefs.every((reference) =>
          /^recovery-evidence:\/\/issue-3\/quarterly\//u.test(reference),
        ),
      'Passed recovery gate requires quarterly evidence',
    );
    const monthlyEvidence = new Set(monthlyEvidenceRefs);
    invariant(
      quarterlyEvidenceRefs.every(
        (reference) => !monthlyEvidence.has(reference),
      ),
      'Monthly and quarterly recovery evidence must be distinct',
    );
    for (const checkName of expectedRecoveryCheckKeys) {
      const checkEvidenceRefs = /** @type {string[]} */ (
        gate.checkEvidence[checkName]
      );
      invariant(
        checkEvidenceRefs.length > 0 &&
          checkEvidenceRefs.every((reference) =>
            reference.startsWith(
              `recovery-evidence://issue-3/checks/${checkName}/`,
            ),
          ),
        `Passed recovery gate requires check evidence for ${checkName}`,
      );
    }
    const measuredCadences = Object.values(gate.cadence);
    const withinApprovedSlo = measuredCadences.every(
      (cadence) =>
        cadence.measuredRpoMinutes <= gate.slo.rpoMinutes &&
        cadence.measuredRtoMinutes <= gate.slo.rtoMinutes,
    );
    invariant(
      withinApprovedSlo || gate.slo.approvedAdjustmentRef !== null,
      'Recovery measurements exceed RPO or RTO without an approved adjustment',
    );
  } else {
    invariant(
      gate.blockers.length > 0 &&
        checkValues.some((status) => status !== 'passed'),
      'Blocked recovery gate must declare blockers and incomplete checks',
    );
  }
  return gate;
}

/**
 * @param {any} kit
 * @param {any} topology
 */
export function validateRecoveryKit(kit, topology) {
  validateTopologyDocument(topology);
  invariant(kit && typeof kit === 'object', 'Recovery kit must be an object');
  invariant(kit.task === 'T00.3', 'Recovery kit must be traced to T00.3');
  invariant(
    kit.mode === 'offline-mock-plan',
    'Recovery kit must remain offline and mocked',
  );
  invariant(
    kit.topology === '../easypanel/topology.json',
    'Recovery kit must reference local topology',
  );

  invariant(
    JSON.stringify(Object.keys(kit.digests ?? {})) ===
      JSON.stringify(expectedDigestKeys),
    'Recovery digest inventory must contain edge-web and runtime',
  );
  for (const [image, slots] of Object.entries(kit.digests)) {
    invariant(
      slots?.current === null && slots?.previous === null,
      `Digest placeholders for ${image} must not contain values`,
    );
  }

  invariant(
    Array.isArray(kit.dns?.records) && kit.dns.records.length > 0,
    'DNS plan must contain records',
  );
  invariant(kit.dns.ttlSeconds === null, 'DNS TTL must remain a placeholder');
  const dnsRecords = /** @type {Array<Record<string, any>>} */ (
    kit.dns.records
  );
  invariant(
    dnsRecords.every(
      ({ hostname, target }) => hostname === null && target === null,
    ),
    'DNS placeholders must not contain hostname or target values',
  );
  invariant(
    kit.migrations?.strategy === 'expand-contract' &&
      kit.migrations.release === null &&
      Array.isArray(kit.migrations.orderedSteps) &&
      kit.migrations.orderedSteps.length > 0,
    'Migration plan must be ordered, expand-contract, and release-neutral',
  );
  invariant(
    kit.runbook === 'RUNBOOK.md',
    'Recovery kit must reference the local runbook',
  );
  invariant(
    JSON.stringify(Object.keys(kit.adapters ?? {})) ===
      JSON.stringify(expectedAdapterKeys) &&
      Object.values(kit.adapters).every((mode) => mode === 'mock'),
    'Every recovery adapter must use mock mode',
  );
  invariant(
    kit.networkEgressAllowed === false,
    'Recovery plan must forbid network egress',
  );
  invariant(
    kit.secretEscrow?.reference === null &&
      kit.secretEscrow.valuesInRepository === false &&
      kit.secretEscrow.minimumCustodians === 2,
    'Secret escrow must remain external, empty, and require two custodians',
  );
  invariant(
    kit.externalExecution?.performedByThisKit === false,
    'Recovery kit must not claim live provisioning or a completed drill',
  );
  return kit;
}

/**
 * @param {any} topology
 * @param {any} kit
 * @param {any} drillGate
 */
export function buildRecoveryPlan(topology, kit, drillGate) {
  validateRecoveryKit(kit, topology);
  validateRecoveryDrillGate(drillGate);
  const projects = /** @type {Array<Record<string, any>>} */ (
    topology.projects
  );
  const checkStatuses = Object.values(drillGate.checks);
  const drillBlockers = /** @type {Array<Record<string, any>>} */ (
    drillGate.blockers
  );

  return {
    task: 'T00.3',
    drillTask: drillGate.task,
    mode: 'offline-mock-plan',
    networkAccessRequired: false,
    projects: projects.map(({ name }) => name),
    unresolvedPlaceholders: [
      'domains-and-dns-targets',
      'current-and-previous-image-digests',
      'migration-release',
      'secret-escrow-reference-and-values',
    ],
    readiness: {
      status: drillGate.status,
      checks: {
        passed: checkStatuses.filter((status) => status === 'passed').length,
        pending: checkStatuses.filter((status) => status === 'pending').length,
        blocked: checkStatuses.filter((status) => status === 'blocked').length,
      },
      evidencePresent: {
        monthly:
          drillGate.cadence.monthlyDatabaseRestore.status === 'passed' &&
          drillGate.cadence.monthlyDatabaseRestore.evidenceRefs.length > 0,
        quarterly:
          drillGate.cadence.quarterlyFullHostDrill.status === 'passed' &&
          drillGate.cadence.quarterlyFullHostDrill.evidenceRefs.length > 0,
      },
      blockerIds: drillBlockers.map(({ id }) => id),
    },
    steps: [
      { order: 1, action: 'verify-local-topology', source: kit.topology },
      { order: 2, action: 'record-current-and-previous-digests', values: null },
      { order: 3, action: 'prepare-dns-plan', values: null },
      { order: 4, action: 'recover-secrets-with-two-custodians', values: null },
      {
        order: 5,
        action: 'apply-migrations',
        strategy: kit.migrations.strategy,
      },
      {
        order: 6,
        action: 'verify-mock-adapters',
        adapters: { ...kit.adapters },
      },
      { order: 7, action: 'execute-runbook-on-clean-host', external: true },
      { order: 8, action: 'record-rpo-rto-and-evidence', external: true },
    ],
  };
}

async function main() {
  const rootUrl = new URL('../', import.meta.url);
  const topology = JSON.parse(
    await readFile(new URL('ops/easypanel/topology.json', rootUrl), 'utf8'),
  );
  const kit = JSON.parse(
    await readFile(new URL('ops/recovery/off-host-kit.json', rootUrl), 'utf8'),
  );
  const drillGate = JSON.parse(
    await readFile(new URL('ops/recovery/drill-gate.json', rootUrl), 'utf8'),
  );
  await readFile(new URL(`ops/recovery/${kit.runbook}`, rootUrl), 'utf8');
  const plan = buildRecoveryPlan(topology, kit, drillGate);

  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(
    `Recovery mocks valid: deterministic offline plan generated; no network used; readiness=${plan.readiness.status}; blockers=${plan.readiness.blockerIds.length}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Recovery mock invalid: ${error.message}`);
    process.exitCode = 1;
  });
}
