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
        `${template}\nOPENAI_API_KEY=real-key\n`,
        topology,
      ),
    /empty values/iu,
  );
});

test('builds a deterministic recovery plan from local files and mocks', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const kit = await json('ops/recovery/off-host-kit.json');

  assert.doesNotThrow(() => validateRecoveryKit(kit, topology));
  const first = buildRecoveryPlan(topology, kit);
  const second = buildRecoveryPlan(topology, kit);

  assert.deepEqual(first, second);
  assert.equal(first.networkAccessRequired, false);
  assert.deepEqual(first.projects, ['espectro-mvp']);
  assert.ok(first.steps.some(({ action }) => action === 'apply-migrations'));
  assert.ok(
    first.steps.some(({ action }) => action === 'verify-mock-adapters'),
  );
  assert.ok(first.steps.some(({ action }) => action === 'prepare-dns-plan'));
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
