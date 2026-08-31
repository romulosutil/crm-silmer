import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const expectedProjects = ['espectro-mvp'];
const expectedEnvironments = ['pilot'];
const expectedServices = [
  'silmer-edge-web',
  'silmer-api',
  'silmer-worker',
  'silmer-postgres',
];
const imageReferencePattern =
  /^ghcr\.io\/romulosutil\/crm-silmer\/(edge-web|runtime)@sha256:[0-9a-f]{64}$/u;
const evidenceReferencePattern =
  /^(easypanel-audit|github-actions):\/\/[a-zA-Z0-9._/-]+$/u;

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

/** @param {any} document */
export function validateTopologyDocument(document) {
  invariant(
    document && typeof document === 'object',
    'Topology must be an object',
  );
  invariant(document.task === 'T00.3', 'Topology must be traced to T00.3');
  invariant(
    document.mode === 'shared-project-approved',
    'Topology must use the approved shared project',
  );
  invariant(
    Array.isArray(document.projects),
    'Topology projects must be an array',
  );
  const projects = /** @type {Array<Record<string, any>>} */ (
    document.projects
  );
  invariant(
    sameArray(
      projects.map(({ name }) => name),
      expectedProjects,
    ),
    `Projects must be exactly ${expectedProjects.join(', ')}`,
  );

  /** @type {string[] | undefined} */
  let canonicalSecretInventory;
  for (const [projectIndex, project] of projects.entries()) {
    invariant(
      project.environment === expectedEnvironments[projectIndex],
      `${project.name} has an invalid environment`,
    );
    invariant(
      project.domains && typeof project.domains === 'object',
      `${project.name} must declare domain placeholders`,
    );
    invariant(
      Object.values(project.domains).every((value) => value === null),
      `Domain placeholders for ${project.name} must not contain values`,
    );
    invariant(
      Array.isArray(project.services),
      `${project.name} services must be an array`,
    );
    const services = /** @type {Array<Record<string, any>>} */ (
      project.services
    );
    invariant(
      sameArray(
        services.map(({ name }) => name),
        expectedServices,
      ),
      `${project.name} services must be exactly ${expectedServices.join(', ')}`,
    );

    for (const service of services) {
      const shouldBePublic = service.name === 'silmer-edge-web';
      invariant(
        service.public === shouldBePublic,
        `${service.name} must ${shouldBePublic ? 'be public' : 'remain private'}`,
      );
      invariant(
        Array.isArray(service.publicPorts),
        `${service.name} publicPorts must be an array`,
      );
      invariant(
        shouldBePublic
          ? sameArray(service.publicPorts, [80, 443])
          : service.publicPorts.length === 0,
        `${service.name} has an unsafe public port contract`,
      );
      invariant(
        service.limits &&
          Number.isFinite(service.limits.cpu) &&
          Number.isInteger(service.limits.memoryMb) &&
          service.limits.cpu > 0 &&
          service.limits.memoryMb > 0,
        `${service.name} must declare positive CPU and memory limits`,
      );
      invariant(
        service.health &&
          service.health.intervalSeconds === 30 &&
          service.health.timeoutSeconds === 5 &&
          service.health.startPeriodSeconds === 20 &&
          service.health.failureThreshold === 3 &&
          Array.isArray(service.health.checks) &&
          service.health.checks.length > 0,
        `${service.name} must declare the approved health checks`,
      );
      if (service.kind === 'app') {
        invariant(
          imageReferencePattern.test(service.imageRef),
          `${service.name} must use an immutable GHCR digest`,
        );
        invariant(
          service.image === 'edge-web' || service.image === 'runtime',
          `${service.name} must use an approved image role`,
        );
        invariant(
          service.imageRef.includes(`/crm-silmer/${service.image}@sha256:`),
          `${service.name} image reference must match its image role`,
        );
      }
    }

    invariant(
      project.secrets?.scope === 'silmer',
      `${project.name} secrets must use the Silmer scope`,
    );
    invariant(
      project.secrets?.valuesAllowed === false,
      `${project.name} secret values must be forbidden`,
    );
    invariant(
      Array.isArray(project.secrets?.inventory),
      `${project.name} secret inventory must be an array`,
    );
    const secretInventory = /** @type {string[]} */ (project.secrets.inventory);
    invariant(
      secretInventory.every(
        (name) => typeof name === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(name),
      ),
      `${project.name} secret inventory must contain names only, never secret values`,
    );
    invariant(
      new Set(project.secrets.inventory).size ===
        project.secrets.inventory.length,
      `${project.name} secret inventory contains duplicates`,
    );
    canonicalSecretInventory ??= secretInventory;
    invariant(
      sameArray(secretInventory, canonicalSecretInventory),
      'Secret names must remain consistent without storing values',
    );
  }

  invariant(
    document.externalExecution?.easypanelProvisioningPerformed === true &&
      document.externalExecution?.sourceDigestsConfigured === true &&
      document.externalExecution?.dnsChangesPerformed === false &&
      document.externalExecution?.secretValuesManaged === false &&
      document.externalExecution?.recoveryDrillPerformed === false,
    'Topology must report provisioning truthfully without claiming pending external controls',
  );

  return document;
}

/** @param {unknown} value */
function rejectSensitiveMaterial(value) {
  if (Array.isArray(value)) {
    value.forEach(rejectSensitiveMaterial);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    invariant(
      !/^(credential|password|privateKey|secret|token)$/iu.test(key),
      `Operational evidence contains sensitive field ${key}`,
    );
    rejectSensitiveMaterial(child);
  }
}

/**
 * @param {any} gate
 * @param {any} topology
 */
export function validateProvisioningGate(gate, topology) {
  validateTopologyDocument(topology);
  invariant(
    gate && typeof gate === 'object',
    'Provisioning gate must be an object',
  );
  rejectSensitiveMaterial(gate);
  invariant(gate.task === 'T00.3', 'Provisioning gate must be traced to T00.3');
  invariant(gate.issue === 2, 'Provisioning gate must reference issue 2');
  invariant(
    gate.mode === 'operational-evidence',
    'Provisioning gate must contain operational evidence only',
  );
  invariant(
    ['accepted-with-follow-ups', 'passed'].includes(gate.status),
    'Provisioning gate has an invalid status',
  );
  invariant(
    gate.decision === 'shared-project-long-lived',
    'Provisioning gate must record the approved long-lived shared project',
  );
  invariant(
    /^[0-9a-f]{40}$/u.test(gate.approvedRelease?.sourceSha),
    'Approved release must contain a full source SHA',
  );
  invariant(
    Number.isSafeInteger(gate.approvedRelease?.workflowRunId),
    'Approved release must reference a workflow run',
  );
  for (const [image, reference] of Object.entries(
    gate.approvedRelease?.images ?? {},
  )) {
    invariant(
      imageReferencePattern.test(/** @type {string} */ (reference)),
      `${image} must use an immutable digest`,
    );
    invariant(
      reference.includes(`/crm-silmer/${image}@sha256:`),
      `${image} reference must match its image role`,
    );
  }
  invariant(
    sameArray(Object.keys(gate.approvedRelease.images), [
      'edge-web',
      'runtime',
    ]),
    'Approved release must contain edge-web and runtime images only',
  );
  invariant(
    gate.evidencePolicy?.referencesOnly === true &&
      gate.evidencePolicy?.piiAllowed === false &&
      gate.evidencePolicy?.secretValuesAllowed === false,
    'Evidence policy must forbid PII and secret values',
  );
  invariant(
    Array.isArray(gate.projects) && gate.projects.length === 1,
    'Provisioning gate must contain the shared project only',
  );

  const gateProject = gate.projects[0];
  const topologyProject = topology.projects[0];
  invariant(
    gateProject.name === topologyProject.name,
    'Provisioning gate project must match topology',
  );
  invariant(
    gateProject.status === gate.status,
    'Provisioning gate project status must match the gate status',
  );
  const gateServices = /** @type {Array<Record<string, any>>} */ (
    gateProject.services
  );
  invariant(
    sameArray(
      gateServices.map(({ name }) => name),
      expectedServices,
    ),
    'Provisioning gate services must match the approved topology',
  );
  const expectedServiceStatuses = [
    'source-pinned',
    'source-pinned',
    'source-pinned',
    'created',
  ];
  for (const [index, service] of gateServices.entries()) {
    invariant(
      service.status === expectedServiceStatuses[index],
      `${service.name} must have the expected operational status`,
    );
    invariant(
      sameArray(
        service.publicPorts,
        topologyProject.services[index].publicPorts,
      ),
      `${service.name} has invalid public port exposure`,
    );
  }

  const topologyServices = /** @type {Array<Record<string, any>>} */ (
    topologyProject.services
  );
  for (const service of topologyServices.filter(({ kind }) => kind === 'app')) {
    invariant(
      service.imageRef === gate.approvedRelease.images[service.image],
      `${service.name} digest must match the approved release`,
    );
  }

  const expectedCheckNames = [
    'projectAndServices',
    'networkExposure',
    'secretsSeparated',
    'healthAndLimits',
    'dnsSslFirewall',
    'externalBackup',
    'offHostUptime',
    'panelMfa',
  ];
  invariant(
    sameArray(Object.keys(gateProject.checks ?? {}), expectedCheckNames),
    'Provisioning gate must contain every operational check exactly once',
  );
  const checkValues = Object.values(gateProject.checks);
  invariant(
    checkValues.length > 0 &&
      checkValues.every((status) =>
        ['passed', 'pending', 'blocked'].includes(status),
      ),
    'Operational checks must use passed, pending, or blocked',
  );
  invariant(
    gateProject.checks.projectAndServices === 'passed' &&
      gateProject.checks.networkExposure === 'passed',
    'Provisioning and network exposure must pass before issue 2 closes',
  );
  const allEvidenceReferences = [
    ...(gate.evidenceRefs ?? []),
    ...(gateProject.evidenceRefs ?? []),
  ];
  invariant(
    allEvidenceReferences.length > 0 &&
      allEvidenceReferences.every((reference) =>
        evidenceReferencePattern.test(reference),
      ),
    'Operational evidence must use opaque references without hosts or PII',
  );
  invariant(
    Array.isArray(gate.acceptedRisks),
    'Provisioning gate must declare accepted risks',
  );
  if (gate.status === 'passed') {
    invariant(
      gate.acceptedRisks.length === 0 &&
        checkValues.every((status) => status === 'passed'),
      'Provisioning gate cannot be passed while blockers or accepted risks remain',
    );
  } else {
    invariant(
      gate.acceptedRisks.length > 0,
      'Accepted follow-ups require explicit accepted risks',
    );
  }
  return gate;
}

/**
 * @param {string} template
 * @param {any} topology
 */
export function validateEnvironmentTemplate(template, topology) {
  const assignments = template
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      invariant(separator > 0, 'Environment template lines must be NAME=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    });

  invariant(
    assignments.every(([, value]) => value === ''),
    'Environment template must contain empty values only',
  );
  const names = assignments.map(([name]) => name);
  invariant(
    new Set(names).size === names.length,
    'Environment template contains duplicate names',
  );
  invariant(
    sameArray(names, topology.projects[0].secrets.inventory),
    'Environment template must match the topology secret-name inventory',
  );
  return names;
}

async function main() {
  const rootUrl = new URL('../', import.meta.url);
  const topology = JSON.parse(
    await readFile(new URL('ops/easypanel/topology.json', rootUrl), 'utf8'),
  );
  const environmentTemplate = await readFile(
    new URL('.env.example', rootUrl),
    'utf8',
  );
  const provisioningGate = JSON.parse(
    await readFile(
      new URL('ops/easypanel/provisioning-gate.json', rootUrl),
      'utf8',
    ),
  );

  validateTopologyDocument(topology);
  validateEnvironmentTemplate(environmentTemplate, topology);
  validateProvisioningGate(provisioningGate, topology);
  console.log(
    'Topology valid: shared project, prefixed services, immutable images, no secret values.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Topology invalid: ${error.message}`);
    process.exitCode = 1;
  });
}
