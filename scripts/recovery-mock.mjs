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
 */
export function buildRecoveryPlan(topology, kit) {
  validateRecoveryKit(kit, topology);
  const projects = /** @type {Array<Record<string, any>>} */ (
    topology.projects
  );

  return {
    task: 'T00.3',
    mode: 'offline-mock-plan',
    networkAccessRequired: false,
    projects: projects.map(({ name }) => name),
    unresolvedPlaceholders: [
      'domains-and-dns-targets',
      'current-and-previous-image-digests',
      'migration-release',
      'secret-escrow-reference-and-values',
    ],
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
  await readFile(new URL(`ops/recovery/${kit.runbook}`, rootUrl), 'utf8');
  const plan = buildRecoveryPlan(topology, kit);

  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(
    'Recovery mocks valid: deterministic offline plan generated; no network used.',
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
