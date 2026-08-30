import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateEnvironmentTemplate,
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

test('declares exactly the approved EasyPanel projects and services', async () => {
  const topology = await json('ops/easypanel/topology.json');
  const projects = /** @type {Array<Record<string, any>>} */ (
    topology.projects
  );

  assert.doesNotThrow(() => validateTopologyDocument(topology));
  assert.deepEqual(
    projects.map(({ name }) => name),
    ['crm-silmer-dev', 'crm-silmer-hml', 'crm-silmer-prod'],
  );

  for (const project of projects) {
    const services = /** @type {Array<Record<string, any>>} */ (
      project.services
    );
    assert.deepEqual(
      services.map(({ name }) => name),
      ['edge-web', 'api', 'worker', 'postgres'],
    );
    assert.deepEqual(
      services
        .filter(({ public: isPublic }) => isPublic)
        .map(({ name }) => name),
      ['edge-web'],
    );
  }
});

test('rejects public API or PostgreSQL services', async () => {
  const topology = await json('ops/easypanel/topology.json');

  for (const serviceName of ['api', 'postgres']) {
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
  assert.deepEqual(first.projects, [
    'crm-silmer-dev',
    'crm-silmer-hml',
    'crm-silmer-prod',
  ]);
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
