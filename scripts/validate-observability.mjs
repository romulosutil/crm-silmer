import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const requiredAlerts = new Set([
  'api-5xx',
  'api-latency',
  'api-live-unavailable',
  'worker-heartbeat-stale',
  'worker-job-failures',
  'worker-oldest-job',
]);
const evidenceReferencePattern =
  /^docs\/phase0\/observability-[a-z0-9-]+-evidence\.json#[a-z0-9-]+$/u;
const opaqueReferencePattern =
  /^(?:operator-contact|operator-monitor):\/\/[a-z0-9][a-z0-9/_-]*$/u;
const corporateIdPattern = /^silmer:[a-z0-9][a-z0-9._-]*$/u;
const safeSlugPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const sensitiveFieldPattern =
  /(?:authorization|cookie|email|password|phone|secret|token|webhook)/iu;

/** @param {unknown} value @param {string} message */
function invariant(value, message) {
  assert.ok(value, message);
}

/** @param {unknown} value @param {string} [path] */
function assertNoSensitiveFields(value, path = 'gate') {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitiveFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    invariant(
      !sensitiveFieldPattern.test(key),
      `Observability gate contains sensitive field ${path}.${key}`,
    );
    assertNoSensitiveFields(child, `${path}.${key}`);
  }
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** @param {unknown} value */
function isEvidenceReference(value) {
  return typeof value === 'string' && evidenceReferencePattern.test(value);
}

/** @param {unknown} value */
function isOpaqueReference(value) {
  return typeof value === 'string' && opaqueReferencePattern.test(value);
}

/** @param {any} document */
export function validateAlertPolicy(document) {
  invariant(document?.task === 'T00.7', 'Alert policy must trace to T00.7');
  invariant(
    document.activationGateRef === 'ops/observability/activation-gate.json',
    'Alert policy must reference the T00.7 activation gate',
  );
  invariant(
    ['pending-external', 'active'].includes(document.status) &&
      document.monitorLocation === 'outside-vps',
    'Alert policy must be wholly pending or wholly active outside the VPS',
  );
  invariant(document.syntheticOnly === true, 'Alert tests must be synthetic');
  invariant(
    document.operationalRetentionDays === 30 &&
      document.legalMaximumRetentionDays === 90,
    'Log retention must be operationally 30 days with a 90-day legal maximum',
  );
  invariant(
    document.status === 'pending-external'
      ? document.routing?.status === 'pending-external' &&
          document.routing.destination === null
      : document.routing?.status === 'configured' &&
          isOpaqueReference(document.routing.destination),
    'External routing must be wholly pending or configured with an opaque destination',
  );
  invariant(
    Array.isArray(document.alerts) &&
      document.alerts.length === requiredAlerts.size,
    'Every minimum API/worker alert must be declared',
  );
  /** @type {Array<any>} */
  const alerts = document.alerts;
  const ids = new Set(alerts.map((alert) => alert.id));
  invariant(
    ids.size === requiredAlerts.size &&
      [...requiredAlerts].every((id) => ids.has(id)),
    'Alert IDs must be complete and unique',
  );
  invariant(
    alerts.every(
      (alert) =>
        alert.status === document.status &&
        typeof alert.owner === 'string' &&
        typeof alert.test === 'string' &&
        Number.isFinite(alert.threshold),
    ),
    'Alerts require an owner, bounded threshold, test and policy state',
  );
  invariant(
    !/(?:token|password|secret|authorization)\s*"\s*:\s*"[^"\s]/iu.test(
      JSON.stringify(document),
    ),
    'Alert policy must not contain credentials',
  );
}

/** @param {any} gate @param {any} alertPolicy */
export function validateActivationGate(gate, alertPolicy) {
  validateAlertPolicy(alertPolicy);
  assertNoSensitiveFields(gate);
  invariant(
    gate?.schemaVersion === 1 && gate.task === 'T00.7' && gate.issue === 11,
    'Activation gate must trace to issue 11 and T00.7',
  );
  invariant(
    ['pending-external', 'proved'].includes(gate.status),
    'Activation gate must be pending or wholly proved',
  );
  invariant(
    gate.monitor?.location === 'outside-vps' &&
      gate.monitor.consecutiveFailures === 3,
    'Live monitor must stay outside the VPS and require three failures',
  );
  const liveUrl = new URL(gate.monitor.liveUrl);
  invariant(
    liveUrl.protocol === 'https:' &&
      liveUrl.pathname === '/api/health/live' &&
      liveUrl.search === '' &&
      liveUrl.hash === '',
    'Live monitor URL must be the canonical HTTPS endpoint without query data',
  );
  invariant(
    Array.isArray(gate.telemetry?.signals) &&
      new Set(gate.telemetry.signals).size === requiredAlerts.size &&
      [...requiredAlerts].every((id) => gate.telemetry.signals.includes(id)),
    'Telemetry signals must cover every minimum alert exactly once',
  );
  invariant(
    gate.telemetry.source === 'allowlisted-structured-logs',
    'Telemetry must use the allowlisted structured log boundary',
  );
  invariant(
    Array.isArray(gate.drills) && gate.drills.length === requiredAlerts.size,
    'Every minimum alert needs one live drill record',
  );
  const drillIds = new Set(
    gate.drills.map((/** @type {any} */ drill) => drill.alertId),
  );
  invariant(
    drillIds.size === requiredAlerts.size &&
      [...requiredAlerts].every((id) => drillIds.has(id)),
    'Live drill records must be complete and unique',
  );

  if (gate.status === 'pending-external') {
    invariant(
      alertPolicy.status === 'pending-external' &&
        gate.provider?.status === 'pending-human-approval' &&
        gate.provider.name === null &&
        gate.provider.dataRegion === null &&
        gate.provider.dpaAccepted === false &&
        gate.provider.subprocessorsAccepted === false &&
        gate.provider.retentionDays === null &&
        gate.provider.privacyReviewer === null &&
        gate.provider.reviewedAt === null &&
        gate.provider.evidenceRef === null &&
        gate.routing?.status === 'pending-human-approval' &&
        gate.routing.ownerIds.length === 0 &&
        gate.routing.destinations.length === 0 &&
        gate.routing.criticalEscalationMinutes === null &&
        gate.routing.highEscalationMinutes === null &&
        gate.routing.evidenceRef === null &&
        gate.monitor.status === 'pending-external' &&
        gate.monitor.monitorId === null &&
        gate.monitor.checkIntervalSeconds === null &&
        gate.monitor.evidenceRef === null &&
        gate.telemetry.status === 'pending-external' &&
        gate.telemetry.evidenceRef === null &&
        gate.hardening?.status === 'pending-external' &&
        gate.hardening.digest === null &&
        gate.hardening.nonRoot === null &&
        gate.hardening.capabilitiesRemoved === null &&
        gate.hardening.readOnly === null &&
        gate.hardening.temporaryStorageLimited === null &&
        gate.hardening.evidenceRef === null &&
        gate.drills.every(
          (/** @type {any} */ drill) =>
            drill.status === 'pending-external' &&
            drill.startedAt === null &&
            drill.detectedAt === null &&
            drill.deliveredAt === null &&
            drill.recoveredAt === null &&
            drill.evidenceRef === null,
        ) &&
        gate.completion?.humanApproved === false &&
        gate.completion.approvedBy.length === 0 &&
        gate.completion.approvedAt === null &&
        gate.completion.evidenceRef === null,
      'Activation gate must be pending or wholly proved',
    );
    return;
  }

  invariant(
    alertPolicy.status === 'active' &&
      gate.provider?.status === 'approved' &&
      safeSlugPattern.test(gate.provider.name) &&
      safeSlugPattern.test(gate.provider.dataRegion) &&
      gate.provider.dpaAccepted === true &&
      gate.provider.subprocessorsAccepted === true &&
      gate.provider.retentionDays === 30 &&
      corporateIdPattern.test(gate.provider.privacyReviewer) &&
      isIsoTimestamp(gate.provider.reviewedAt) &&
      isEvidenceReference(gate.provider.evidenceRef),
    'Provider approval must be complete and versioned',
  );
  invariant(
    gate.routing?.status === 'configured' &&
      gate.routing.ownerIds.length >= 2 &&
      gate.routing.ownerIds.every((/** @type {string} */ id) =>
        corporateIdPattern.test(id),
      ) &&
      gate.routing.destinations.length >= 2 &&
      gate.routing.destinations.every(isOpaqueReference) &&
      gate.routing.criticalEscalationMinutes === 10 &&
      gate.routing.highEscalationMinutes === 15 &&
      isEvidenceReference(gate.routing.evidenceRef),
    'Alert routing must use approved owners, opaque destinations and escalation',
  );
  invariant(
    gate.monitor.status === 'active' &&
      isOpaqueReference(gate.monitor.monitorId) &&
      Number.isInteger(gate.monitor.checkIntervalSeconds) &&
      gate.monitor.checkIntervalSeconds >= 30 &&
      gate.monitor.checkIntervalSeconds <= 60 &&
      isEvidenceReference(gate.monitor.evidenceRef),
    'Off-host monitor must be active with bounded interval and evidence',
  );
  invariant(
    gate.telemetry.status === 'active' &&
      isEvidenceReference(gate.telemetry.evidenceRef),
    'Every telemetry signal must be active with versioned evidence',
  );
  invariant(
    gate.hardening?.status === 'passed' &&
      /^sha256:[a-f0-9]{64}$/u.test(gate.hardening.digest) &&
      gate.hardening.nonRoot === true &&
      gate.hardening.capabilitiesRemoved === true &&
      gate.hardening.readOnly === true &&
      gate.hardening.temporaryStorageLimited === true &&
      isEvidenceReference(gate.hardening.evidenceRef),
    'Promoted digest hardening requires complete live evidence',
  );
  invariant(
    gate.drills.every((/** @type {any} */ drill) => {
      if (
        drill.status !== 'passed' ||
        !isIsoTimestamp(drill.startedAt) ||
        !isIsoTimestamp(drill.detectedAt) ||
        !isIsoTimestamp(drill.deliveredAt) ||
        !isIsoTimestamp(drill.recoveredAt) ||
        !isEvidenceReference(drill.evidenceRef)
      ) {
        return false;
      }
      return (
        Date.parse(drill.startedAt) < Date.parse(drill.detectedAt) &&
        Date.parse(drill.detectedAt) <= Date.parse(drill.deliveredAt) &&
        Date.parse(drill.deliveredAt) < Date.parse(drill.recoveredAt)
      );
    }),
    'Passed drills require versioned evidence and ordered timestamps',
  );
  invariant(
    gate.completion?.humanApproved === true &&
      gate.completion.approvedBy.length >= 2 &&
      gate.completion.approvedBy.every((/** @type {string} */ id) =>
        corporateIdPattern.test(id),
      ) &&
      isIsoTimestamp(gate.completion.approvedAt) &&
      isEvidenceReference(gate.completion.evidenceRef),
    'Completion requires human approval and versioned evidence',
  );
}

/** @param {string} dockerfile */
export function validateRuntimeHardening(dockerfile) {
  invariant(
    /FROM node:24\.20\.0-bookworm-slim@sha256:[a-f0-9]{64}/u.test(dockerfile),
    'Runtime base must remain pinned by digest',
  );
  invariant(/\nUSER node\n/u.test(dockerfile), 'Runtime must remain non-root');
  invariant(
    /HEALTHCHECK[\s\S]+\/api\/health\/live/u.test(dockerfile),
    'Runtime health check must use the canonical live endpoint',
  );
}

async function main() {
  const policy = JSON.parse(
    await readFile(new URL('ops/observability/alerts.json', rootUrl), 'utf8'),
  );
  const gate = JSON.parse(
    await readFile(
      new URL('ops/observability/activation-gate.json', rootUrl),
      'utf8',
    ),
  );
  const dockerfile = await readFile(
    new URL('docker/runtime.Dockerfile', rootUrl),
    'utf8',
  );
  validateAlertPolicy(policy);
  validateActivationGate(gate, policy);
  validateRuntimeHardening(dockerfile);
  console.log(
    'Observability valid: local T00.7 controls pass; off-host alert delivery remains pending.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error('Observability invalid:', error.message);
    process.exitCode = 1;
  });
}
