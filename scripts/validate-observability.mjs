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

/** @param {unknown} value @param {string} message */
function invariant(value, message) {
  assert.ok(value, message);
}

/** @param {any} document */
export function validateAlertPolicy(document) {
  invariant(document?.task === 'T00.7', 'Alert policy must trace to T00.7');
  invariant(
    document.status === 'pending-external' &&
      document.monitorLocation === 'outside-vps',
    'Alert policy must remain pending and outside the VPS',
  );
  invariant(document.syntheticOnly === true, 'Alert tests must be synthetic');
  invariant(
    document.operationalRetentionDays === 30 &&
      document.legalMaximumRetentionDays === 90,
    'Log retention must be operationally 30 days with a 90-day legal maximum',
  );
  invariant(
    document.routing?.status === 'pending-external' &&
      document.routing.destination === null,
    'External routing must not be falsely configured',
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
        alert.status === 'pending-external' &&
        typeof alert.owner === 'string' &&
        typeof alert.test === 'string' &&
        Number.isFinite(alert.threshold),
    ),
    'Alerts require an owner, bounded threshold, test and pending state',
  );
  invariant(
    !/(?:token|password|secret|authorization)\s*"\s*:\s*"[^"\s]/iu.test(
      JSON.stringify(document),
    ),
    'Alert policy must not contain credentials',
  );
}

/** @param {string} dockerfile */
export function validateRuntimeHardening(dockerfile) {
  invariant(
    /FROM node:24\.14\.0-bookworm-slim@sha256:[a-f0-9]{64}/u.test(dockerfile),
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
  const dockerfile = await readFile(
    new URL('docker/runtime.Dockerfile', rootUrl),
    'utf8',
  );
  validateAlertPolicy(policy);
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
