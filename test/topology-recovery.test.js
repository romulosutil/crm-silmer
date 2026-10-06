import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateEnvironmentTemplate,
  validateProvisioningGate,
  validateTopologyDocument,
} from '../scripts/validate-topology.mjs';
import {
  buildRecoveryPlan,
  validateRecoveryDrillGate,
  validateRecoveryKit,
} from '../scripts/recovery-mock.mjs';

const rootUrl = new URL('../', import.meta.url);

/**
 * @param {string} path
 * @returns {Promise<Record<string, any>>}
 */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return structuredClone(value);
}

/**
 * @param {Record<string, any>} gate
 * @returns {Record<string, any>}
 */
function completeRecoveryDrillGate(gate) {
  const completed = clone(gate);
  completed.status = 'passed';
  completed.checks = Object.fromEntries(
    Object.keys(completed.checks).map((name) => [name, 'passed']),
  );
  completed.checkEvidence = Object.fromEntries(
    Object.keys(completed.checks).map((name) => [
      name,
      [`recovery-evidence://issue-3/checks/${name}/2026-08-31`],
    ]),
  );
  completed.blockers = [];

  const monthly = completed.cadence.monthlyDatabaseRestore;
  monthly.status = 'passed';
  monthly.startedAt = '2026-08-30T20:00:00Z';
  monthly.completedAt = '2026-08-30T21:00:00Z';
  monthly.measuredRpoMinutes = 30;
  monthly.measuredRtoMinutes = 60;
  monthly.temporaryResourcesDestroyed = true;
  monthly.evidenceRefs = ['recovery-evidence://issue-3/monthly/2026-08-31'];

  const quarterly = completed.cadence.quarterlyFullHostDrill;
  quarterly.status = 'passed';
  quarterly.startedAt = '2026-08-30T22:00:00Z';
  quarterly.completedAt = '2026-08-31T00:00:00Z';
  quarterly.measuredRpoMinutes = 45;
  quarterly.measuredRtoMinutes = 120;
  quarterly.temporaryResourcesDestroyed = true;
  quarterly.evidenceRefs = ['recovery-evidence://issue-3/quarterly/2026-Q3'];
  return completed;
}

test('declares the approved shared EasyPanel project and prefixed services', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const projects = /** @type {Array<Record<string, any>>} */ (
    topology.projects
  );

  assert.doesNotThrow(() => validateTopologyDocument(topology));
  assert.deepEqual(
    projects.map(({ name }) => name),
    ['espectro-mvp'],
  );

  for (const project of projects) {
    const services = /** @type {Array<Record<string, any>>} */ (
      project.services
    );
    assert.deepEqual(
      services.map(({ name }) => name),
      ['silmer-edge-web', 'silmer-api', 'silmer-worker', 'silmer-postgres'],
    );
    assert.deepEqual(
      services
        .filter(({ public: isPublic }) => isPublic)
        .map(({ name }) => name),
      ['silmer-edge-web'],
    );
  }
});

/**
 * @param {Record<string, any>} topology
 * @returns {Record<string, any>}
 */
function sharedStorage(topology) {
  return topology.projects[0].sharedServices[0];
}

/**
 * The state ADR 023 requires before the gate can pass: no public S3 route,
 * console only behind a restriction, every gap closed by evidence.
 * @param {Record<string, any>} topology
 * @param {Record<string, any>} gate
 */
function resolveObjectStorage(topology, gate) {
  const storage = sharedStorage(topology);
  storage.publicRoutes = [
    {
      purpose: 'console',
      via: 'easypanel-default-domain',
      targetPort: 9001,
      hostname: null,
      restriction: 'auth-and-ip-allowlist',
    },
  ];
  storage.sharedProjectRiskAcceptedRef =
    'docs/adr/023-arquivos-da-arte-no-rustfs.md';
  storage.crossProjectEndpointSmoked = true;
  storage.imageDigestConfirmed = true;
  storage.imageRef = `rustfs/rustfs:1.0.1@sha256:${'a'.repeat(64)}`;
  storage.buckets[0].created = true;
  storage.dedicatedCredential = 'created';
  storage.dataVolume.offHostBackupEvidenced = true;
  storage.gaps = [];
  storage.status = 'ready';
  Object.assign(gate.objectStorageGate, {
    status: 'passed',
    publicDomainsRemovedOrRestricted: true,
    sharedProjectRiskAccepted: true,
    crossProjectEndpointSmoked: true,
    imageDigestConfirmed: true,
    privateBucketCreated: true,
    apiCredentialsSeparated: true,
    offHostBackupConfigured: true,
    restoreDrilledWithPostgres: true,
  });
}

test('records the existing schedule/rustfs with its gaps explicit (ADR 023)', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');
  const kit = await json('ops/recovery/off-host-kit.json');
  const storage = sharedStorage(topology);

  assert.doesNotThrow(() => validateTopologyDocument(topology));
  assert.doesNotThrow(() => validateProvisioningGate(gate, topology));
  assert.doesNotThrow(() => validateRecoveryKit(kit, topology));
  assert.equal(storage.project, 'schedule');
  assert.equal(storage.internalHost, 'schedule_rustfs');
  assert.equal(storage.internalPort, 9000);
  assert.deepEqual(storage.clients, ['silmer-api']);
  assert.equal(storage.imageRef, null);
  assert.ok(
    storage.publicRoutes.every(
      (/** @type {{ hostname: unknown }} */ { hostname }) => hostname === null,
    ),
  );
  assert.equal(storage.status, 'existing-with-gaps');
  assert.deepEqual(storage.gaps, [
    'public-s3-and-console-domains',
    'shared-project',
    'cross-project-endpoint-smoke-pending',
    'image-digest-not-confirmed',
    'dedicated-bucket-credential-pending',
    'off-host-backup-not-evidenced',
  ]);
  assert.equal(gate.objectStorageGate.status, 'pending-external');
  assert.equal(gate.objectStorageGate.serviceCreated, true);
  assert.equal(kit.orderFiles.service, 'schedule/rustfs');
  assert.equal(kit.orderFiles.restoreScope, 'crm-bucket-only');
});

test('rejects hiding, misreporting or loosening the schedule/rustfs contract', async () => {
  const topology = await json('ops/easypanel/topology.json');

  /** @type {Array<[(storage: Record<string, any>) => void, RegExp]>} */
  const cases = [
    [
      (storage) => {
        storage.gaps = storage.gaps.filter(
          (/** @type {string} */ gap) =>
            gap !== 'off-host-backup-not-evidenced',
        );
      },
      /gaps must match.*off-host-backup-not-evidenced/iu,
    ],
    [
      (storage) => {
        storage.gaps = storage.gaps.filter(
          (/** @type {string} */ gap) =>
            gap !== 'public-s3-and-console-domains',
        );
      },
      /gaps must match/iu,
    ],
    [
      (storage) => {
        storage.status = 'ready';
      },
      /cannot be ready while gaps remain/iu,
    ],
    [
      (storage) => {
        storage.publicRoutes[0].hostname = 'files.example.com';
      },
      /without storing hostnames/iu,
    ],
    [
      (storage) => {
        storage.public = false;
      },
      /without storing hostnames/iu,
    ],
    [
      (storage) => {
        storage.imageRef = `rustfs/rustfs:1.0.1@sha256:${'b'.repeat(64)}`;
      },
      /unconfirmed image digest/iu,
    ],
    [
      (storage) => {
        storage.imageDigestConfirmed = true;
      },
      /unconfirmed image digest/iu,
    ],
    [
      (storage) => {
        storage.clients = ['silmer-api', 'silmer-edge-web'];
      },
      /only by silmer-api/iu,
    ],
    [
      (storage) => {
        storage.internalHost = 'rustfs';
      },
      /only by silmer-api/iu,
    ],
    [
      (storage) => {
        storage.secretNames = ['RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY'];
      },
      /dedicated API credential/iu,
    ],
    [
      (storage) => {
        storage.buckets[0].publicAccess = true;
      },
      /private bucket/iu,
    ],
    [
      (storage) => {
        storage.buckets[0].offHostBackup = 'none';
      },
      /off-host backup/iu,
    ],
    [
      (storage) => {
        storage.sharedProjectRiskAcceptedRef = 'accepted';
      },
      /decision record/iu,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const unsafe = clone(topology);
    mutate(sharedStorage(unsafe));
    assert.throws(() => validateTopologyDocument(unsafe), expected);
  }

  const restrictedS3 = clone(topology);
  sharedStorage(restrictedS3).publicRoutes[0].restriction =
    'auth-and-ip-allowlist';
  sharedStorage(restrictedS3).publicRoutes[1].restriction =
    'auth-and-ip-allowlist';
  assert.doesNotThrow(() => validateTopologyDocument(restrictedS3));
  assert.ok(
    sharedStorage(restrictedS3).gaps.includes('public-s3-and-console-domains'),
    'a public S3 route stays a gap even behind a restriction',
  );
});

test('keeps the object storage gate pending while public domains or gaps remain', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');

  const falsePass = clone(gate);
  falsePass.objectStorageGate.status = 'passed';
  assert.throws(
    () => validateProvisioningGate(falsePass, topology),
    /cannot pass while public domains or gaps remain/iu,
  );

  const allChecksButGaps = clone(gate);
  for (const key of Object.keys(allChecksButGaps.objectStorageGate)) {
    if (typeof allChecksButGaps.objectStorageGate[key] === 'boolean') {
      allChecksButGaps.objectStorageGate[key] = true;
    }
  }
  allChecksButGaps.objectStorageGate.status = 'passed';
  assert.throws(
    () => validateProvisioningGate(allChecksButGaps, topology),
    /cannot pass while public domains or gaps remain/iu,
  );

  const claimedCredential = clone(gate);
  claimedCredential.objectStorageGate.apiCredentialsSeparated = true;
  assert.throws(
    () => validateProvisioningGate(claimedCredential, topology),
    /match the observed/iu,
  );

  const resolvedTopology = clone(topology);
  const resolvedGate = clone(gate);
  resolveObjectStorage(resolvedTopology, resolvedGate);
  assert.doesNotThrow(() => validateTopologyDocument(resolvedTopology));
  assert.doesNotThrow(() =>
    validateProvisioningGate(resolvedGate, resolvedTopology),
  );

  const publicS3Again = clone(resolvedTopology);
  sharedStorage(publicS3Again).publicRoutes.push({
    purpose: 's3-api',
    via: 'easypanel-default-domain',
    targetPort: 9000,
    hostname: null,
    restriction: null,
  });
  assert.throws(
    () => validateTopologyDocument(publicS3Again),
    /gaps must match.*public-s3-and-console-domains/iu,
  );

  const notDrilled = clone(resolvedGate);
  notDrilled.objectStorageGate.restoreDrilledWithPostgres = false;
  assert.throws(
    () => validateProvisioningGate(notDrilled, resolvedTopology),
    /cannot pass/iu,
  );
});

test('restores only the CRM bucket from the shared RustFS volume', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const kit = await json('ops/recovery/off-host-kit.json');

  const wholeVolume = clone(kit);
  wholeVolume.orderFiles.restoreScope = 'full-volume';
  assert.throws(
    () => validateRecoveryKit(wholeVolume, topology),
    /only the CRM bucket/iu,
  );

  const withoutBucket = clone(kit);
  withoutBucket.orderFiles.offHostBackup = 'none';
  assert.throws(
    () => validateRecoveryKit(withoutBucket, topology),
    /RustFS order files/iu,
  );
});

test('rejects any public internal Silmer service', async () => {
  const topology = await json('ops/easypanel/topology.json');

  for (const serviceName of [
    'silmer-api',
    'silmer-worker',
    'silmer-postgres',
  ]) {
    const unsafe = clone(topology);
    const services = /** @type {Array<Record<string, any>>} */ (
      unsafe.projects[0].services
    );
    const service = services.find(({ name }) => name === serviceName);
    assert.ok(service);
    service.public = true;
    service.publicPorts = [5432];

    assert.throws(
      () => validateTopologyDocument(unsafe),
      new RegExp(`${serviceName}.*private`, 'iu'),
    );
  }
});

test('rejects concrete domain values and secret values', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const concreteDomain = clone(topology);
  concreteDomain.projects[0].domains.primary = 'dev.crm.example.com';

  assert.throws(
    () => validateTopologyDocument(concreteDomain),
    /domain.*placeholder|placeholder.*domain/iu,
  );

  const leakedSecret = clone(topology);
  leakedSecret.projects[0].secrets.inventory[0] = {
    name: 'APP_ENV',
    value: 'dev',
  };

  assert.throws(
    () => validateTopologyDocument(leakedSecret),
    /secret.*name|secret.*value/iu,
  );
});

test('keeps the environment template as names with empty values only', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const template = await readFile(new URL('.env.example', rootUrl), 'utf8');

  assert.doesNotThrow(() => validateEnvironmentTemplate(template, topology));
  assert.throws(
    () =>
      validateEnvironmentTemplate(
        `${template}\nGEMINI_API_KEY=real-key\n`,
        topology,
      ),
    /empty values/iu,
  );
});

test('builds a deterministic recovery plan from local files and mocks', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const kit = await json('ops/recovery/off-host-kit.json');
  const drillGate = await json('ops/recovery/drill-gate.json');

  assert.doesNotThrow(() => validateRecoveryKit(kit, topology));
  assert.doesNotThrow(() => validateRecoveryDrillGate(drillGate));
  const first = buildRecoveryPlan(topology, kit, drillGate);
  const second = buildRecoveryPlan(topology, kit, drillGate);

  assert.deepEqual(first, second);
  assert.equal(first.networkAccessRequired, false);
  assert.equal(first.drillTask, 'T07.3');
  assert.deepEqual(first.projects, ['espectro-mvp']);
  assert.ok(first.steps.some(({ action }) => action === 'apply-migrations'));
  assert.ok(
    first.steps.some(({ action }) => action === 'verify-mock-adapters'),
  );
  assert.ok(first.steps.some(({ action }) => action === 'prepare-dns-plan'));
  assert.deepEqual(first.readiness, {
    status: 'blocked',
    checks: { passed: 0, pending: 4, blocked: 5 },
    evidencePresent: { monthly: false, quarterly: false },
    blockerIds: [
      'easypanel-restorable-backup-missing',
      'external-backup-blocked',
      'tombstone-ledger-t06-3-not-implemented-or-evidenced',
      'two-custodian-escrow-not-evidenced',
      'clean-vps-drill-not-executed',
      'temporary-dns-drill-not-executed',
      'object-version-restore-not-executed',
      'order-files-bucket-backup-not-evidenced',
      'full-smoke-not-executed',
    ],
  });
  assert.doesNotMatch(JSON.stringify(first.readiness), /:\/\//u);
});

test('keeps issue 3 blocked with explicit opaque recovery evidence', async () => {
  const gate = await json('ops/recovery/drill-gate.json');

  assert.doesNotThrow(() => validateRecoveryDrillGate(gate));
  assert.equal(gate.issue, 3);
  assert.equal(gate.task, 'T07.3');
  assert.equal(gate.originTask, 'T00.3');
  assert.equal(gate.status, 'blocked');
  assert.deepEqual(Object.values(gate.checks), [
    'blocked',
    'blocked',
    'blocked',
    'blocked',
    'pending',
    'pending',
    'pending',
    'blocked',
    'pending',
  ]);
  const blockers = /** @type {Array<{ evidenceRefs: string[] }>} */ (
    gate.blockers
  );
  assert.ok(
    blockers.every(({ evidenceRefs }) =>
      evidenceRefs.every((reference) =>
        /^(easypanel-audit|github-issue|recovery-evidence|repository):\/\/[a-zA-Z0-9._/#-]+$/u.test(
          reference,
        ),
      ),
    ),
  );
});

test('rejects false passed recovery gates and missing cadence evidence', async () => {
  const gate = await json('ops/recovery/drill-gate.json');
  const falseCompletion = completeRecoveryDrillGate(gate);
  falseCompletion.blockers = clone(gate.blockers);

  assert.throws(
    () => validateRecoveryDrillGate(falseCompletion),
    /passed.*blocker|blocker.*passed/iu,
  );

  falseCompletion.blockers = [];
  falseCompletion.cadence.monthlyDatabaseRestore.evidenceRefs = [];
  assert.throws(
    () => validateRecoveryDrillGate(falseCompletion),
    /monthly.*evidence|evidence.*monthly/iu,
  );

  falseCompletion.cadence.monthlyDatabaseRestore.evidenceRefs = [
    'recovery-evidence://issue-3/monthly/attempt-1',
  ];
  falseCompletion.cadence.monthlyDatabaseRestore.measuredRpoMinutes = null;
  assert.throws(
    () => validateRecoveryDrillGate(falseCompletion),
    /timestamp|RPO|RTO|destroyed/iu,
  );
});

test('accepts only complete, distinct, and measurable passed evidence', async () => {
  const gate = await json('ops/recovery/drill-gate.json');
  const completed = completeRecoveryDrillGate(gate);

  assert.doesNotThrow(() => validateRecoveryDrillGate(completed));

  const duplicateCadenceEvidence = clone(completed);
  duplicateCadenceEvidence.cadence.quarterlyFullHostDrill.evidenceRefs = [
    completed.cadence.monthlyDatabaseRestore.evidenceRefs[0],
  ];
  assert.throws(
    () => validateRecoveryDrillGate(duplicateCadenceEvidence),
    /distinct|monthly|quarterly/iu,
  );

  const missingCheckEvidence = clone(completed);
  missingCheckEvidence.checkEvidence.fullSmoke = [];
  assert.throws(
    () => validateRecoveryDrillGate(missingCheckEvidence),
    /check.*evidence|evidence.*check/iu,
  );

  const invalidAdjustment = clone(completed);
  invalidAdjustment.cadence.quarterlyFullHostDrill.measuredRtoMinutes = 999;
  invalidAdjustment.slo.approvedAdjustmentRef = 'repository://README.md';
  assert.throws(
    () => validateRecoveryDrillGate(invalidAdjustment),
    /approved adjustment|recovery-approval/iu,
  );

  const futureEvidence = clone(completed);
  futureEvidence.observedAt = '9999-12-31';
  assert.throws(
    () => validateRecoveryDrillGate(futureEvidence),
    /future|observation date/iu,
  );
});

test('rejects sensitive material in the recovery drill gate', async () => {
  const gate = await json('ops/recovery/drill-gate.json');
  const leakedHost = clone(gate);
  leakedHost.host = '203.0.113.8';

  assert.throws(
    () => validateRecoveryDrillGate(leakedHost),
    /sensitive.*host|host.*sensitive/iu,
  );

  const concreteEvidence = clone(gate);
  concreteEvidence.evidenceRefs = ['https://ops.example.com/drill/3'];
  assert.throws(
    () => validateRecoveryDrillGate(concreteEvidence),
    /opaque.*reference|reference.*opaque|sensitive|concrete/iu,
  );

  for (const [field, value] of [
    ['customerCpf', '123.456.789-00'],
    ['apiKey', 'AKIAIOSFODNN7EXAMPLE'],
    ['internalEndpoint', 'db.internal.example.com'],
  ]) {
    const extraSensitiveField = clone(gate);
    extraSensitiveField.blockers[0][field] = value;
    assert.throws(
      () => validateRecoveryDrillGate(extraSensitiveField),
      /field|schema|sensitive|concrete/iu,
    );
  }
});

test('rejects real recovery adapters and populated digest or DNS placeholders', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const kit = await json('ops/recovery/off-host-kit.json');
  const realAdapter = clone(kit);
  realAdapter.adapters.meta = 'real';

  assert.throws(
    () => validateRecoveryKit(realAdapter, topology),
    /adapter.*mock/iu,
  );

  const concreteDigest = clone(kit);
  concreteDigest.digests['edge-web'].current =
    'ghcr.io/silmer/edge-web@sha256:deadbeef';
  assert.throws(
    () => validateRecoveryKit(concreteDigest, topology),
    /digest.*placeholder/iu,
  );

  const concreteDns = clone(kit);
  concreteDns.dns.records[0].hostname = 'crm.example.com';
  assert.throws(
    () => validateRecoveryKit(concreteDns, topology),
    /dns.*placeholder/iu,
  );
});

test('accepts the long-lived shared-project gate with immutable approved images', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');

  assert.doesNotThrow(() => validateProvisioningGate(gate, topology));
  assert.equal(gate.status, 'accepted-with-follow-ups');
  assert.equal(gate.projects[0].name, 'espectro-mvp');
  assert.match(gate.approvedRelease.sourceSha, /^[0-9a-f]{40}$/u);
  assert.match(
    gate.approvedRelease.images['edge-web'],
    /^ghcr\.io\/romulosutil\/crm-silmer\/edge-web@sha256:[0-9a-f]{64}$/u,
  );
  assert.match(
    gate.approvedRelease.images.runtime,
    /^ghcr\.io\/romulosutil\/crm-silmer\/runtime@sha256:[0-9a-f]{64}$/u,
  );
});

test('rejects mutable images and noncanonical service exposure in the operational gate', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');
  const mutableImage = clone(gate);
  mutableImage.approvedRelease.images.runtime =
    'ghcr.io/romulosutil/crm-silmer/runtime:latest';

  assert.throws(
    () => validateProvisioningGate(mutableImage, topology),
    /immutable.*digest|digest.*immutable/iu,
  );

  const swappedImages = clone(gate);
  [
    swappedImages.approvedRelease.images['edge-web'],
    swappedImages.approvedRelease.images.runtime,
  ] = [
    swappedImages.approvedRelease.images.runtime,
    swappedImages.approvedRelease.images['edge-web'],
  ];
  assert.throws(
    () => validateProvisioningGate(swappedImages, topology),
    /image role|approved release/iu,
  );

  const publicApi = clone(gate);
  const services = /** @type {Array<Record<string, any>>} */ (
    publicApi.projects[0].services
  );
  const publicApiService = services.find(({ name }) => name === 'silmer-api');
  assert.ok(publicApiService);
  publicApiService.publicPorts = [8000];

  assert.throws(
    () => validateProvisioningGate(publicApi, topology),
    /public port|exposure/iu,
  );
});

test('rejects sensitive material in operational evidence', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');
  const leakedCredential = clone(gate);
  leakedCredential.projects[0].password = 'synthetic-placeholder';

  assert.throws(
    () => validateProvisioningGate(leakedCredential, topology),
    /sensitive|credential|secret/iu,
  );
});

test('rejects a fully passed operational gate while accepted risks remain', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const gate = await json('ops/easypanel/provisioning-gate.json');
  const falseCompletion = clone(gate);
  falseCompletion.status = 'passed';
  falseCompletion.projects[0].status = 'passed';

  assert.throws(
    () => validateProvisioningGate(falseCompletion, topology),
    /completed|passed|blocker/iu,
  );
});
