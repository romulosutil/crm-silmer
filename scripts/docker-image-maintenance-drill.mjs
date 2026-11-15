import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  open,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import {
  checkMaintenanceImages,
  createMaintenanceReader,
  dockerEnvironment,
  fixtureServiceLabel,
} from './check-maintenance-images.mjs';
import { pullPinnedImage } from './edge-media-image-pull.mjs';
import {
  assertPrivateProcess,
  assertPrivateRuntimeInfo,
  assertRuntimeAvailableForCleanup,
  privateRuntimeSettings,
} from './isolated-docker-runtime.mjs';

/** @param {{platform:string, uid:number|undefined, env:NodeJS.ProcessEnv, args:string[]}} target */
export function assertDrillTarget(target) {
  if (
    target.platform !== 'linux' ||
    target.uid !== 0 ||
    target.args.length !== 1 ||
    target.args[0] !== '--isolated-local' ||
    Object.entries(target.env).some(
      ([key, value]) =>
        /^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH)$/iu.test(key) &&
        Boolean(value),
    )
  )
    throw new Error('ISOLATED_LOCAL_LINUX_ROOT_REQUIRED');
}

/** Starts its own dockerd; never queries, prunes or restarts the host daemon. */
export async function runImageMaintenanceDrill() {
  assertDrillTarget({
    platform: process.platform,
    uid: process.getuid?.(),
    env: process.env,
    args: process.argv.slice(2),
  });
  const directory = await mkdtemp('/tmp/crm-image-drill-');
  const token = randomUUID();
  const runtimeSettings = privateRuntimeSettings(directory, token);
  const host = `unix://${directory}/docker.sock`;
  const env = dockerEnvironment(process.env);
  const read = createMaintenanceReader(host);
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let daemon;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let runtime;
  let runtimeStarted = false;
  /** @type {string[]} */
  let daemonArgs = [];
  let daemonId = '';
  let phase = 'SETUP';
  let lastFailure = '';
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const log = await open(`${directory}/daemon.log`, 'a');

  /** @param {string[]} args @param {boolean} [allowFailure] */
  function docker(args, allowFailure = false) {
    if (interrupted) throw new Error('DRILL_INTERRUPTED');
    const result = spawnSync(
      'docker',
      ['--config', `${directory}/client`, '--host', host, ...args],
      {
        env,
        encoding: 'utf8',
        shell: false,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0) {
      lastFailure = /No such image/iu.test(result.stderr ?? '')
        ? 'NO_SUCH_IMAGE'
        : 'DOCKER_FAILED';
      if (allowFailure) return null;
      throw new Error('ISOLATED_DOCKER_COMMAND_FAILED');
    }
    return result.stdout.trim();
  }

  /** ctr always targets our child socket and namespace, including on failure.
   * @param {string[]} args @param {boolean} [allowFailure]
   */
  function ctr(args, allowFailure = false) {
    const result = spawnSync(
      'ctr',
      [
        '--address',
        runtimeSettings.address,
        '--namespace',
        runtimeSettings.namespace,
        '--timeout',
        '3s',
        ...args,
      ],
      {
        env,
        encoding: 'utf8',
        shell: false,
        timeout: 5_000,
        maxBuffer: 128 * 1024,
      },
    );
    if (result.error || result.status !== 0) {
      if (allowFailure) return null;
      throw new Error('PRIVATE_CONTAINERD_QUERY_FAILED');
    }
    return result.stdout.trim();
  }

  /** @param {import('node:child_process').ChildProcess | undefined} child @param {string[]} args */
  async function requirePrivateProcess(child, args) {
    assert.ok(
      child?.pid && child.exitCode === null && child.signalCode === null,
      'PRIVATE_PROCESS_NOT_RUNNING',
    );
    assertPrivateProcess(
      await readFile(`/proc/${child.pid}/cmdline`, 'utf8'),
      args,
    );
  }

  async function requireOwnedDaemon() {
    await requirePrivateProcess(runtime, runtimeSettings.containerdArgs);
    await requirePrivateProcess(daemon, daemonArgs);
    assert.equal(
      await realpath(directory),
      directory,
      'DRILL_DIRECTORY_CHANGED',
    );
    assert.equal(
      docker(['info', '--format', '{{.DockerRootDir}}']),
      `${directory}/data`,
      'DRILL_ROOT_CHANGED',
    );
    assert.equal(
      docker(['info', '--format', '{{.ID}}']),
      daemonId,
      'DRILL_DAEMON_CHANGED',
    );
    assert.equal(
      docker(['info', '--format', '{{json .Labels}}'])?.includes(
        `io.crm.image-drill=${token}`,
      ),
      true,
      'DRILL_LABEL_CHANGED',
    );
    assertPrivateRuntimeInfo(
      JSON.parse(docker(['info', '--format', '{{json .}}']) ?? ''),
      runtimeSettings,
    );
  }

  async function startRuntime() {
    runtime = spawn('containerd', runtimeSettings.containerdArgs, {
      env,
      stdio: ['ignore', log.fd, log.fd],
    });
    let failed = false;
    runtime.on('error', () => {
      failed = true;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (failed || runtime.exitCode !== null || interrupted)
        throw new Error('PRIVATE_CONTAINERD_START_FAILED');
      if (ctr(['version'], true) !== null) {
        await requirePrivateProcess(runtime, runtimeSettings.containerdArgs);
        runtimeStarted = true;
        return;
      }
      await pause(250);
    }
    throw new Error('PRIVATE_CONTAINERD_START_TIMEOUT');
  }

  async function startDaemon() {
    daemonArgs = [
      '--config-file',
      `${directory}/daemon.json`,
      '--host',
      host,
      '--data-root',
      `${directory}/data`,
      '--exec-root',
      `${directory}/exec`,
      '--pidfile',
      `${directory}/daemon.pid`,
      '--bridge=none',
      '--iptables=false',
      '--ip6tables=false',
      '--ip-forward=false',
      '--ip-masq=false',
      '--storage-driver=vfs',
      '--label',
      `io.crm.image-drill=${token}`,
      ...runtimeSettings.dockerArgs,
    ];
    daemon = spawn('dockerd', daemonArgs, {
      env: { ...env, DOCKER_TMPDIR: `${directory}/tmp` },
      stdio: ['ignore', log.fd, log.fd],
    });
    let failedToSpawn = false;
    daemon.on('error', () => {
      failedToSpawn = true;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (failedToSpawn || daemon.exitCode !== null || interrupted)
        throw new Error('ISOLATED_DAEMON_START_FAILED');
      const id = docker(['info', '--format', '{{.ID}}'], true);
      if (id) {
        if (!daemonId) daemonId = id;
        await requireOwnedDaemon();
        return;
      }
      await pause(250);
    }
    throw new Error('ISOLATED_DAEMON_START_TIMEOUT');
  }

  /** @param {import('node:child_process').ChildProcess | undefined} child */
  async function stopChild(child) {
    if (
      !child ||
      !child.pid ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    child.kill('SIGTERM');
    const deadline = Date.now() + 20_000;
    while (
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    )
      await pause(100);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((done) => child.once('exit', done));
      throw new Error('PRIVATE_PROCESS_FORCED_STOP');
    }
  }

  /** @param {string} name @param {string} reference @param {string} [service] */
  function create(name, reference, service) {
    docker([
      'run',
      '--detach',
      '--pull=never',
      '--network=none',
      '--name',
      name,
      ...(service ? ['--label', `${fixtureServiceLabel}=${service}`] : []),
      reference,
    ]);
  }

  /** @param {string} name @param {string} revision */
  async function health(name, revision) {
    const deadline = Date.now() + 15_000;
    const probe = `fetch('http://127.0.0.1:3000/health').then(async r=>{if(!r.ok||(await r.text())!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))`;
    while (Date.now() < deadline) {
      if (
        docker(['exec', name, 'node', '-e', probe, revision], true) !== null
      ) {
        const id = docker([
          'container',
          'inspect',
          '--format',
          '{{.Id}}',
          name,
        ]);
        assert.ok(
          ctr(['containers', 'list', '--quiet'])
            ?.split(/\r?\n/u)
            .includes(id ?? ''),
          'FIXTURE_OUTSIDE_PRIVATE_CONTAINERD',
        );
        return;
      }
      await pause(150);
    }
    throw new Error('SYNTHETIC_HTTP_HEALTH_FAILED');
  }

  try {
    for (const path of ['tmp', 'client', 'fixture'])
      await mkdir(`${directory}/${path}`);
    await writeFile(
      `${directory}/daemon.json`,
      JSON.stringify({ features: { 'containerd-snapshotter': false } }),
    );
    await writeFile(`${directory}/containerd.toml`, runtimeSettings.config);
    phase = 'START_PRIVATE_CONTAINERD';
    await startRuntime();
    phase = 'START_DAEMON';
    await startDaemon();
    const runtimeDockerfile = await readFile(
      new URL('../docker/runtime.Dockerfile', import.meta.url),
      'utf8',
    );
    const pinnedBase = runtimeDockerfile.match(/^FROM (node:[^ ]+)/mu)?.[1];
    assert.ok(pinnedBase, 'PINNED_NODE_BASE_REQUIRED');
    phase = 'PULL_PINNED_BASE';
    const base = pullPinnedImage(pinnedBase, (image) => {
      docker(['pull', image]);
    });
    await writeFile(
      `${directory}/fixture/server.js`,
      "require('node:http').createServer((q,r)=>{r.end(process.env.REVISION)}).listen(3000,'127.0.0.1');\n",
    );
    phase = 'BUILD_SYNTHETIC_IMAGES';
    // No builder/context selection: every fixture is committed inside this daemon.
    docker([
      'create',
      '--pull=never',
      '--network=none',
      '--name',
      'fixture-seed',
      base,
    ]);
    docker([
      'cp',
      `${directory}/fixture/server.js`,
      'fixture-seed:/server.cjs',
    ]);
    for (const revision of ['current', 'rollback', 'disposable'])
      docker([
        'commit',
        '--change',
        `ENV REVISION=${revision}`,
        '--change',
        'USER node',
        '--change',
        'CMD ["node","/server.cjs"]',
        '--change',
        `LABEL io.crm.image-drill.cleanup=${revision === 'disposable' ? token : 'keep'}`,
        'fixture-seed',
        `crm-image-drill/seed:${revision}`,
      ]);
    const currentId = read([
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      'crm-image-drill/seed:current',
    ]);
    const rollbackId = read([
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      'crm-image-drill/seed:rollback',
    ]);
    /** @type {import('./check-maintenance-images.mjs').MaintenanceInventory} */
    const inventory = {
      schemaVersion: 1,
      daemonId,
      services: /** @type {const} */ (['api', 'worker', 'edge']).map(
        (role) => ({
          name: `synthetic-${role}`,
          role,
          kind: 'container',
          current: {
            reference: `crm-image-drill/${role}:current`,
            imageId: currentId,
          },
          rollback: {
            reference: `crm-image-drill/${role}:rollback`,
            imageId: rollbackId,
          },
        }),
      ),
    };
    for (const service of inventory.services) {
      docker(['image', 'tag', currentId, service.current.reference]);
      docker(['image', 'tag', rollbackId, service.rollback.reference]);
      create(service.name, service.current.reference, service.name);
      await health(service.name, 'current');
    }
    const inventoryPath = `${directory}/inventory.json`;
    await writeFile(inventoryPath, JSON.stringify(inventory));
    const cli = () =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('./check-maintenance-images.mjs', import.meta.url),
          ),
          '--inventory',
          inventoryPath,
          '--docker-host',
          host,
        ],
        { env, encoding: 'utf8', timeout: 30_000 },
      );
    phase = 'PREFLIGHT_POSITIVE';
    assert.equal(cli().status, 0, 'CLI_PREFLIGHT_MUST_PASS');
    for (const service of inventory.services) {
      docker(['stop', service.name]);
      docker(['rm', service.name]);
    }
    phase = 'ALLOWLIST_CLEANUP';
    await requireOwnedDaemon();
    docker([
      'image',
      'prune',
      '--all',
      '--force',
      '--filter',
      `label=io.crm.image-drill.cleanup=${token}`,
    ]);
    assert.equal(
      docker(['image', 'inspect', 'crm-image-drill/seed:disposable'], true),
      null,
      'DISPOSABLE_MUST_BE_REMOVED',
    );
    assert.ok(
      docker(['image', 'inspect', base]),
      'UNRELATED_BASE_MUST_SURVIVE',
    );
    assert.equal(
      checkMaintenanceImages(inventory, read).services.every(
        (s) => s.runningContainers === 0,
      ),
      true,
      'STOPPED_IMAGES_MUST_SURVIVE',
    );
    phase = 'RESTART_PRIVATE_DAEMON';
    await stopChild(daemon);
    assert.equal(ctr(['tasks', 'list', '--quiet']), '', 'PRIVATE_TASKS_REMAIN');
    await stopChild(runtime);
    await startRuntime();
    await startDaemon();
    checkMaintenanceImages(inventory, read);
    phase = 'RECREATE_WITHOUT_PULL';
    for (const service of inventory.services) {
      create(service.name, service.current.reference, service.name);
      await health(service.name, 'current');
      docker(['restart', service.name]);
      await health(service.name, 'current');
      create(`rollback-${service.name}`, service.rollback.reference);
      await health(`rollback-${service.name}`, 'rollback');
    }
    checkMaintenanceImages(inventory, read);
    phase = 'NEGATIVE_MISSING_TAG';
    const api = inventory.services[0];
    docker(['image', 'rm', api.current.reference]);
    await health(api.name, 'current');
    const blocked = cli();
    assert.equal(blocked.status, 1, 'CLI_MUST_BLOCK_MISSING_TAG');
    assert.equal(JSON.parse(blocked.stderr).code, 'DOCKER_READ_FAILED');
    assert.equal(
      docker(
        [
          'create',
          '--pull=never',
          '--network=none',
          '--name',
          'missing-tag-proof',
          api.current.reference,
        ],
        true,
      ),
      null,
      'RECREATE_MUST_FAIL_WITHOUT_TAG',
    );
    assert.equal(
      lastFailure,
      'NO_SUCH_IMAGE',
      'MISSING_TAG_MUST_CAUSE_RECREATE_FAILURE',
    );
    docker(['image', 'tag', currentId, api.current.reference]);
    phase = 'NEGATIVE_RETARGETED_TAG';
    docker(['image', 'tag', rollbackId, api.current.reference]);
    assert.throws(
      () => checkMaintenanceImages(inventory, read),
      /IMAGE_ID_MISMATCH/u,
    );
    docker(['image', 'tag', currentId, api.current.reference]);
    phase = 'NEGATIVE_MISSING_ROLLBACK';
    docker(['image', 'rm', api.rollback.reference]);
    assert.throws(
      () => checkMaintenanceImages(inventory, read),
      /DOCKER_READ_FAILED/u,
    );
    docker(['image', 'tag', rollbackId, api.rollback.reference]);
    checkMaintenanceImages(inventory, read);
    phase = 'NEGATIVE_MISSING_ROLLBACK_IMAGE';
    for (const service of inventory.services) {
      docker(['rm', '--force', `rollback-${service.name}`]);
      docker(['image', 'rm', service.rollback.reference]);
    }
    docker(['image', 'rm', 'crm-image-drill/seed:rollback']);
    assert.equal(
      docker(['image', 'inspect', rollbackId], true),
      null,
      'ROLLBACK_IMAGE_MUST_BE_ABSENT',
    );
    assert.throws(
      () => checkMaintenanceImages(inventory, read),
      /DOCKER_READ_FAILED/u,
    );
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', phase }));
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    let cleanupFailed = false;
    try {
      await stopChild(daemon);
      assertRuntimeAvailableForCleanup(runtimeStarted, runtime);
      if (runtimeStarted) {
        await requirePrivateProcess(runtime, runtimeSettings.containerdArgs);
        assert.equal(
          ctr(['tasks', 'list', '--quiet']),
          '',
          'PRIVATE_TASKS_REMAIN',
        );
      }
    } catch {
      cleanupFailed = true;
    }
    try {
      await stopChild(runtime);
    } catch {
      cleanupFailed = true;
    }
    await log.close();
    if (cleanupFailed) throw new Error('PRIVATE_RUNTIME_CLEANUP_FAILED');
    assert.equal(
      await realpath(directory),
      directory,
      'DRILL_DIRECTORY_CHANGED',
    );
    assert.match(directory, /^\/tmp\/crm-image-drill-[a-zA-Z0-9]+$/u);
    await rm(directory, { recursive: true, force: false });
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      isolation: 'ephemeral-local-dockerd',
      services: 3,
      zeroContainerImagesPreserved: true,
      daemonRestarted: true,
      privateContainerdVerified: true,
      containerdRestarted: true,
      recreatedWithoutPull: true,
      rollbackHttpVerified: true,
      resourcesRemoved: true,
      negatives: [
        'missing-current-tag',
        'retargeted-tag',
        'missing-rollback-reference',
        'missing-rollback-image',
      ],
    }),
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await runImageMaintenanceDrill();
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'ISOLATED_DRILL_FAILED';
    console.error(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  }
}
