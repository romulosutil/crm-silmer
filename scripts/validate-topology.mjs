import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const expectedProjects = [
  'crm-silmer-dev',
  'crm-silmer-hml',
  'crm-silmer-prod',
];
const expectedEnvironments = ['dev', 'hml', 'prod'];
const expectedServices = ['edge-web', 'api', 'worker', 'postgres'];

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
    document.mode === 'offline-plan-only',
    'Topology must remain an offline plan',
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
      const shouldBePublic = service.name === 'edge-web';
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
    }

    invariant(
      project.secrets?.scope === project.name,
      `${project.name} secrets must use project scope`,
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
      'Secret names must be consistent while values remain separated by environment',
    );
  }

  invariant(
    document.externalExecution &&
      Object.values(document.externalExecution).every(
        (value) => value === false,
      ),
    'Versioned topology must not claim external provisioning or drills',
  );

  return document;
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

  validateTopologyDocument(topology);
  validateEnvironmentTemplate(environmentTemplate, topology);
  console.log(
    'Topology valid: 3 isolated projects, edge-web only public, no values stored.',
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
