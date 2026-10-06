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
const objectStorageDecision = 'docs/adr/023-arquivos-da-arte-no-rustfs.md';
const objectStorageGaps = [
  'public-s3-and-console-domains',
  'shared-project',
  'cross-project-endpoint-smoke-pending',
  'image-digest-not-confirmed',
  'private-bucket-pending',
  'dedicated-bucket-credential-pending',
  'off-host-backup-not-evidenced',
];
const objectStorageImagePattern =
  /^rustfs\/rustfs:[0-9][0-9A-Za-z.-]*@sha256:[0-9a-f]{64}$/u;
const decisionRecordPattern = /^docs\/adr\/\d{3}-[a-z0-9-]+\.md$/u;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
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

/**
 * Gaps that the observed RustFS state still implies. A gap only disappears
 * when the state that causes it is fixed or explicitly accepted.
 * @param {Record<string, any>} storage
 */
export function deriveObjectStorageGaps(storage) {
  const routes = /** @type {Array<Record<string, any>>} */ (
    storage.publicRoutes ?? []
  );
  const [bucket] = /** @type {Array<Record<string, any>>} */ (
    storage.buckets ?? []
  );
  const gaps = new Set();
  if (
    routes.some(
      ({ purpose, restriction }) =>
        purpose !== 'console' || restriction === null,
    )
  ) {
    gaps.add('public-s3-and-console-domains');
  }
  if (
    storage.project !== 'espectro-mvp' &&
    storage.sharedProjectRiskAcceptedRef === null
  ) {
    gaps.add('shared-project');
  }
  if (storage.crossProjectEndpointSmoked !== true) {
    gaps.add('cross-project-endpoint-smoke-pending');
  }
  if (storage.imageDigestConfirmed !== true) {
    gaps.add('image-digest-not-confirmed');
  }
  if (bucket?.created !== true) gaps.add('private-bucket-pending');
  if (storage.dedicatedCredential !== 'created') {
    gaps.add('dedicated-bucket-credential-pending');
  }
  if (storage.dataVolume?.offHostBackupEvidenced !== true) {
    gaps.add('off-host-backup-not-evidenced');
  }
  return objectStorageGaps.filter((gap) => gaps.has(gap));
}

/**
 * ADR 023: the order files live in the existing RustFS of the `schedule`
 * project. Only the API reaches it, by its internal host, and every deviation
 * from that contract stays an explicit gap.
 * @param {Record<string, any>} project
 */
function validateSharedObjectStorage(project) {
  const shared = /** @type {Array<Record<string, any>>} */ (
    project.sharedServices ?? []
  );
  invariant(
    Array.isArray(shared) &&
      sameArray(
        shared.map(({ name }) => name),
        ['rustfs'],
      ),
    `${project.name} shared services must be exactly rustfs`,
  );
  const [storage] = shared;
  invariant(
    storage.project === 'schedule' &&
      storage.kind === 'object-storage' &&
      storage.decisionRecord === objectStorageDecision &&
      isoDatePattern.test(storage.observedAt ?? ''),
    'schedule/rustfs must trace to ADR 023 with an observation date',
  );
  invariant(
    storage.internalHost === 'schedule_rustfs' &&
      storage.internalPort === 9000 &&
      sameArray(storage.clients ?? [], ['silmer-api']),
    'schedule/rustfs must be reached only by silmer-api on its internal host and port 9000',
  );
  const routes = /** @type {Array<Record<string, any>>} */ (
    storage.publicRoutes ?? []
  );
  invariant(
    Array.isArray(storage.publicRoutes) &&
      routes.every(
        ({ hostname, purpose, restriction }) =>
          hostname === null &&
          ['s3-api', 'console'].includes(purpose) &&
          (restriction === null || typeof restriction === 'string'),
      ) &&
      storage.public === routes.length > 0,
    'schedule/rustfs public routes must be declared without storing hostnames',
  );
  invariant(
    storage.imageDigestConfirmed === true
      ? objectStorageImagePattern.test(storage.imageRef ?? '')
      : storage.imageDigestConfirmed === false && storage.imageRef === null,
    'schedule/rustfs must not claim an unconfirmed image digest',
  );
  invariant(
    storage.sharedProjectRiskAcceptedRef === null ||
      decisionRecordPattern.test(storage.sharedProjectRiskAcceptedRef),
    'Shared-project risk can only be accepted by a decision record',
  );
  const buckets = /** @type {Array<Record<string, any>>} */ (
    storage.buckets ?? []
  );
  invariant(
    buckets.length === 1 &&
      buckets[0].name === 'crm-silmer-arquivos' &&
      typeof buckets[0].created === 'boolean' &&
      buckets[0].publicAccess === false &&
      buckets[0].offHostBackup === 'with-postgres' &&
      buckets[0].recoveryDrill === 'with-postgres' &&
      typeof storage.dataVolume?.offHostBackupEvidenced === 'boolean',
    'schedule/rustfs needs a private bucket in the off-host backup and drill with PostgreSQL',
  );
  const inventory = /** @type {string[]} */ (project.secrets?.inventory ?? []);
  const secretNames = /** @type {string[]} */ (storage.secretNames ?? []);
  invariant(
    sameArray(secretNames, [
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ]) &&
      secretNames.every((name) => inventory.includes(name)) &&
      ['pending', 'created'].includes(storage.dedicatedCredential),
    'schedule/rustfs must use a dedicated API credential, never the RustFS root keys',
  );
  const declared = /** @type {string[]} */ (storage.gaps ?? []);
  const derived = deriveObjectStorageGaps(storage);
  invariant(
    Array.isArray(storage.gaps) &&
      new Set(declared).size === declared.length &&
      declared.every((gap) => objectStorageGaps.includes(gap)) &&
      sameArray(
        objectStorageGaps.filter((gap) => declared.includes(gap)),
        derived,
      ),
    `schedule/rustfs gaps must match the observed state: ${derived.join(', ') || 'none'}`,
  );
  invariant(
    storage.status === (derived.length > 0 ? 'existing-with-gaps' : 'ready'),
    'schedule/rustfs cannot be ready while gaps remain',
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

    validateSharedObjectStorage(project);

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
 * @param {any} storageGate
 * @param {Record<string, any>} storage
 */
function validateObjectStorageGate(storageGate, storage) {
  const checks = [
    'serviceCreated',
    'publicDomainsRemovedOrRestricted',
    'sharedProjectRiskAccepted',
    'crossProjectEndpointSmoked',
    'imageDigestConfirmed',
    'privateBucketCreated',
    'apiCredentialsSeparated',
    'offHostBackupConfigured',
    'restoreDrilledWithPostgres',
  ];
  invariant(
    storageGate?.service === `${storage.project}/${storage.name}` &&
      storageGate.decisionRecord === objectStorageDecision &&
      isoDatePattern.test(storageGate.observedAt ?? '') &&
      checks.every((check) => typeof storageGate[check] === 'boolean'),
    'Object storage gate must trace schedule/rustfs to ADR 023',
  );
  const gaps = deriveObjectStorageGaps(storage);
  invariant(
    ['pending-external', 'passed'].includes(storageGate.status) &&
      (storageGate.status !== 'passed' ||
        (gaps.length === 0 &&
          checks.every((check) => storageGate[check] === true))),
    'Object storage gate cannot pass while public domains or gaps remain',
  );
  const [bucket] = storage.buckets;
  invariant(
    storageGate.serviceCreated === true &&
      storageGate.publicDomainsRemovedOrRestricted ===
        !gaps.includes('public-s3-and-console-domains') &&
      storageGate.sharedProjectRiskAccepted ===
        (storage.sharedProjectRiskAcceptedRef !== null) &&
      storageGate.crossProjectEndpointSmoked ===
        storage.crossProjectEndpointSmoked &&
      storageGate.imageDigestConfirmed === storage.imageDigestConfirmed &&
      storageGate.privateBucketCreated === bucket.created &&
      storageGate.apiCredentialsSeparated ===
        (storage.dedicatedCredential === 'created') &&
      storageGate.offHostBackupConfigured ===
        storage.dataVolume.offHostBackupEvidenced,
    'Object storage gate must match the observed schedule/rustfs state',
  );
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
  validateObjectStorageGate(
    gate.objectStorageGate,
    topology.projects[0].sharedServices[0],
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
    'Topology valid: shared project, prefixed services, immutable images, schedule/rustfs gaps explicit, no secret values.',
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
