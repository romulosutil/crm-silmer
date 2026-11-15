import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const imageIdPattern = /^sha256:[a-f0-9]{64}$/u;
const referencePattern = /^[a-z0-9][a-z0-9._/:@-]{0,255}$/u;
const namePattern = /^[a-z0-9][a-z0-9_.-]{0,127}$/u;
export const fixtureServiceLabel = 'io.crm.image-preflight.service';

/** @typedef {{reference:string, imageId:string}} ReleaseImage */
/** @typedef {{name:string, role:'api'|'worker'|'edge', kind:'swarm'|'container', current:ReleaseImage, rollback:ReleaseImage}} MaintenanceService */
/** @typedef {{schemaVersion:1, daemonId:string, services:MaintenanceService[]}} MaintenanceInventory */
/** @typedef {(args:string[])=>string} DockerReader */
/** @typedef {(command:string, args:string[], options:import('node:child_process').SpawnSyncOptionsWithStringEncoding)=>{status:number|null, stdout:string, error?:Error}} DockerReadExecutor */

/** Bounded codes only: Docker diagnostics can contain private host details.
 * @param {string} code
 * @returns {never}
 */
function block(code) {
  throw new Error(code);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} image @returns {image is ReleaseImage} */
function releaseImage(image) {
  return (
    record(image) &&
    typeof image.reference === 'string' &&
    referencePattern.test(image.reference) &&
    typeof image.imageId === 'string' &&
    imageIdPattern.test(image.imageId)
  );
}

/** @param {unknown} value @returns {MaintenanceInventory} */
export function validateMaintenanceInventory(value) {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.daemonId !== 'string' ||
    !/^[a-zA-Z0-9:._-]{1,128}$/u.test(value.daemonId) ||
    !Array.isArray(value.services) ||
    value.services.length !== 3
  )
    block('INVENTORY_INVALID');
  const names = new Set();
  const roles = new Set();
  for (const service of value.services) {
    if (
      !record(service) ||
      typeof service.name !== 'string' ||
      !namePattern.test(service.name) ||
      names.has(service.name) ||
      typeof service.role !== 'string' ||
      !['api', 'worker', 'edge'].includes(service.role) ||
      roles.has(service.role) ||
      (service.kind !== 'swarm' && service.kind !== 'container')
    )
      block('INVENTORY_INVALID');
    names.add(service.name);
    roles.add(service.role);
    if (!releaseImage(service.current) || !releaseImage(service.rollback))
      block('INVENTORY_INVALID');
    if (service.current.reference === service.rollback.reference)
      block('INVENTORY_INVALID');
  }
  return /** @type {MaintenanceInventory} */ (value);
}

/** Require a local, explicit socket. Never follow inherited remote contexts.
 * @param {string} host
 */
export function validateMaintenanceSocket(host) {
  if (!/^unix:\/\/\/[a-zA-Z0-9_./-]+$/u.test(host))
    block('LOCAL_SOCKET_REQUIRED');
  const path = host.slice('unix://'.length);
  if (posix.normalize(path) !== path || path.includes('//'))
    block('LOCAL_SOCKET_REQUIRED');
  return host;
}

/** @param {NodeJS.ProcessEnv} env */
export function dockerEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !key.toUpperCase().startsWith('DOCKER_'),
    ),
  );
}

/** Every subprocess this adapter can execute is read-only.
 * @param {string} host
 * @param {DockerReadExecutor} [execute]
 * @returns {DockerReader}
 */
export function createMaintenanceReader(host, execute = spawnSync) {
  validateMaintenanceSocket(host);
  return (args) => {
    const signature = args.slice(0, 2).join(' ');
    if (
      ![
        'info --format',
        'image inspect',
        'service inspect',
        'container inspect',
        'ps --filter',
      ].includes(signature)
    )
      block('READ_ONLY_COMMAND_REQUIRED');
    const result = execute('docker', ['--host', host, ...args], {
      encoding: 'utf8',
      env: dockerEnvironment(process.env),
      timeout: 10_000,
      maxBuffer: 128 * 1024,
      shell: false,
    });
    if (result.error || result.status !== 0) block('DOCKER_READ_FAILED');
    return String(result.stdout).trim();
  };
}

/** @param {MaintenanceInventory} inventory @param {DockerReader} read */
export function checkMaintenanceImages(inventory, read) {
  validateMaintenanceInventory(inventory);
  if (read(['info', '--format', '{{.ID}}']) !== inventory.daemonId)
    block('DAEMON_MISMATCH');
  /** @param {string} reference @param {string} expected */
  function requireImage(reference, expected) {
    if (
      read(['image', 'inspect', '--format', '{{.Id}}', reference]) !== expected
    )
      block('IMAGE_ID_MISMATCH');
  }
  const services = inventory.services.map((service) => {
    requireImage(service.current.reference, service.current.imageId);
    requireImage(service.rollback.reference, service.rollback.imageId);
    if (service.kind === 'swarm') {
      const configured = read([
        'service',
        'inspect',
        '--format',
        '{{.Spec.TaskTemplate.ContainerSpec.Image}}',
        service.name,
      ]);
      if (
        configured !== service.current.reference &&
        !(
          configured.startsWith(`${service.current.reference}@`) &&
          imageIdPattern.test(
            configured.slice(service.current.reference.length + 1),
          )
        )
      )
        block('SERVICE_REFERENCE_MISMATCH');
      requireImage(configured, service.current.imageId);
    }
    const label =
      service.kind === 'swarm'
        ? 'com.docker.swarm.service.name'
        : fixtureServiceLabel;
    const output = read([
      'ps',
      '--filter',
      `label=${label}=${service.name}`,
      '--format',
      '{{.ID}}',
    ]);
    const containers = output ? output.split(/\r?\n/u) : [];
    if (
      containers.length > 64 ||
      containers.some((id) => !/^[a-f0-9]{12,64}$/u.test(id))
    )
      block('CONTAINER_LIST_INVALID');
    for (const id of containers) {
      if (
        read(['container', 'inspect', '--format', '{{.Image}}', id]) !==
        service.current.imageId
      )
        block('RUNNING_IMAGE_MISMATCH');
    }
    return {
      name: service.name,
      currentId: service.current.imageId,
      rollbackId: service.rollback.imageId,
      runningContainers: containers.length,
    };
  });
  // Detect daemon changes during collection too. This is not a maintenance lock.
  if (read(['info', '--format', '{{.ID}}']) !== inventory.daemonId)
    block('DAEMON_MISMATCH');
  return { status: 'ready', daemonId: inventory.daemonId, services };
}

/** @param {string[]} args */
export async function runMaintenancePreflight(args) {
  if (
    args.length !== 4 ||
    args[0] !== '--inventory' ||
    args[2] !== '--docker-host'
  )
    block('USAGE_INVENTORY_AND_LOCAL_SOCKET_REQUIRED');
  validateMaintenanceSocket(args[3]);
  let value;
  try {
    value = JSON.parse(await readFile(args[1], 'utf8'));
  } catch {
    block('INVENTORY_UNREADABLE');
  }
  return checkMaintenanceImages(
    validateMaintenanceInventory(value),
    createMaintenanceReader(args[3]),
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log(
      JSON.stringify(await runMaintenancePreflight(process.argv.slice(2))),
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'PREFLIGHT_FAILED';
    console.error(JSON.stringify({ status: 'blocked', code }));
    process.exitCode = 1;
  }
}
