import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  checkMaintenanceImages,
  createMaintenanceReader,
  dockerEnvironment,
  validateMaintenanceInventory,
  validateMaintenanceSocket,
} from '../scripts/check-maintenance-images.mjs';
import { assertDrillTarget } from '../scripts/docker-image-maintenance-drill.mjs';
import {
  assertPrivateProcess,
  assertPrivateRuntimeInfo,
  assertRuntimeAvailableForCleanup,
  privateRuntimeSettings,
} from '../scripts/isolated-docker-runtime.mjs';

const currentId = `sha256:${'a'.repeat(64)}`;
const rollbackId = `sha256:${'b'.repeat(64)}`;
const daemonId = '01234567-89ab-cdef-0123-456789abcdef';
const socket = 'unix:///tmp/synthetic-docker.sock';

const privateRuntime = privateRuntimeSettings(
  '/tmp/crm-image-drill-ABC123',
  '01234567-89ab-cdef-0123-456789abcdef',
);

test('a containerd that dies after starting cannot authorize resource removal without task proof', () => {
  assert.doesNotThrow(() => assertRuntimeAvailableForCleanup(false, undefined));
  assert.doesNotThrow(() =>
    assertRuntimeAvailableForCleanup(true, {
      pid: 123,
      exitCode: null,
      signalCode: null,
    }),
  );
  for (const child of [
    undefined,
    { pid: 123, exitCode: 0, signalCode: null },
    { pid: 123, exitCode: 1, signalCode: null },
    { pid: 123, exitCode: null, signalCode: 'SIGKILL' },
  ]) {
    assert.throws(
      () => assertRuntimeAvailableForCleanup(true, child),
      /PRIVATE_RUNTIME_CLEANUP_UNPROVEN/u,
    );
  }
});

test('P2 regression: Docker receives an explicit private containerd socket and two exclusive namespaces', () => {
  assert.deepEqual(privateRuntime.dockerArgs, [
    '--containerd',
    '/tmp/crm-image-drill-ABC123/containerd.sock',
    '--containerd-namespace',
    'crm-image-drill-01234567-89ab-cdef-0123-456789abcdef',
    '--containerd-plugins-namespace',
    'crm-image-drill-01234567-89ab-cdef-0123-456789abcdef-plugins',
  ]);
  assert.deepEqual(privateRuntime.containerdArgs, [
    '--config',
    '/tmp/crm-image-drill-ABC123/containerd.toml',
    '--root',
    '/tmp/crm-image-drill-ABC123/containerd-root',
    '--state',
    '/tmp/crm-image-drill-ABC123/containerd-state',
    '--address',
    privateRuntime.address,
  ]);
  assert.match(privateRuntime.config, /imports = \[\]/u);
  assert.match(privateRuntime.config, /io.containerd.nri.v1.nri/u);
  assert.match(privateRuntime.config, /io.containerd.grpc.v1.cri/u);
  assert.match(privateRuntime.config, /tcp_address = ""/u);
});

test('P2 regression: effective host containerd address or namespaces must fail ownership checks', () => {
  const info = {
    Containerd: {
      Address: privateRuntime.address,
      Namespaces: {
        Containers: privateRuntime.namespace,
        Plugins: privateRuntime.pluginsNamespace,
      },
    },
  };
  assert.doesNotThrow(() => assertPrivateRuntimeInfo(info, privateRuntime));
  assert.throws(
    () =>
      assertPrivateRuntimeInfo(
        {
          Containerd: {
            ...info.Containerd,
            Address: '/run/containerd/containerd.sock',
          },
        },
        privateRuntime,
      ),
    /CONTAINERD_ADDRESS_MISMATCH/u,
  );
  assert.throws(
    () =>
      assertPrivateRuntimeInfo(
        {
          Containerd: {
            ...info.Containerd,
            Namespaces: { ...info.Containerd.Namespaces, Containers: 'moby' },
          },
        },
        privateRuntime,
      ),
    /CONTAINERD_NAMESPACE_MISMATCH/u,
  );
  assert.throws(
    () =>
      assertPrivateRuntimeInfo(
        {
          Containerd: {
            ...info.Containerd,
            Namespaces: {
              ...info.Containerd.Namespaces,
              Plugins: 'plugins.moby',
            },
          },
        },
        privateRuntime,
      ),
    /CONTAINERD_PLUGINS_NAMESPACE_MISMATCH/u,
  );
  for (const invalid of [null, '', [], false])
    assert.throws(
      () => assertPrivateRuntimeInfo(invalid, privateRuntime),
      /DOCKER_INFO_INVALID/u,
    );
});

test('actual child argv must match private arguments, including when old Docker omits runtime metadata', () => {
  const cmdline = ['containerd', ...privateRuntime.containerdArgs, ''].join(
    '\0',
  );
  assert.doesNotThrow(() =>
    assertPrivateProcess(cmdline, privateRuntime.containerdArgs),
  );
  assert.doesNotThrow(() => assertPrivateRuntimeInfo({}, privateRuntime));
  for (const args of [
    privateRuntime.containerdArgs.slice(0, -2),
    [
      ...privateRuntime.containerdArgs.slice(0, -1),
      '/run/containerd/containerd.sock',
    ],
    [
      ...privateRuntime.containerdArgs,
      '--config',
      '/etc/containerd/config.toml',
    ],
  ]) {
    assert.throws(
      () =>
        assertPrivateProcess(
          ['containerd', ...args, ''].join('\0'),
          privateRuntime.containerdArgs,
        ),
      /PRIVATE_PROCESS_ARGUMENTS_MISMATCH/u,
    );
  }
  assert.throws(
    () =>
      assertPrivateProcess(
        ['dockerd', '--data-root', '/tmp/private', ''].join('\0'),
        privateRuntime.dockerArgs,
      ),
    /PRIVATE_PROCESS_ARGUMENTS_MISMATCH/u,
  );
});

test('runtime configuration cannot name a host directory or an arbitrary namespace token', () => {
  for (const directory of [
    '/var/run',
    '/tmp/crm-image-drill-ABC123/../host',
    '/tmp/other',
  ])
    assert.throws(() =>
      privateRuntimeSettings(directory, '01234567-89ab-cdef-0123-456789abcdef'),
    );
  assert.throws(() =>
    privateRuntimeSettings('/tmp/crm-image-drill-ABC123', 'moby'),
  );
});

function fixture() {
  /** @type {import('../scripts/check-maintenance-images.mjs').MaintenanceInventory} */
  const inventory = {
    schemaVersion: 1,
    daemonId,
    services: /** @type {const} */ (['api', 'worker', 'edge']).map((role) => ({
      name: `espectro-mvp_silmer-${role}`,
      role,
      kind: 'swarm',
      current: { reference: 'synthetic/api:current', imageId: currentId },
      rollback: { reference: 'synthetic/api:rollback', imageId: rollbackId },
    })),
  };
  const images = new Map([
    ['synthetic/api:current', currentId],
    ['synthetic/api:rollback', rollbackId],
    [currentId, currentId],
  ]);
  const identities = inventory.services.map((service, index) => ({
    id: String.fromCharCode(97 + index).repeat(25),
    name: service.name,
  }));
  const aliases = new Map(
    identities.flatMap((identity) => [
      [identity.name, identity],
      [identity.id, identity],
      [identity.id.slice(0, 12), identity],
    ]),
  );
  const state = {
    configured: 'synthetic/api:current',
    containers: 'abc123abc123',
    runningImage: currentId,
    daemonId,
  };
  /** @type {string[][]} */
  const calls = [];
  /** @type {import('../scripts/check-maintenance-images.mjs').DockerReader} */
  const read = (args) => {
    calls.push(args);
    if (args[0] === 'info') return state.daemonId;
    if (args[0] === 'image') {
      const id = images.get(args.at(-1) ?? '');
      if (!id) throw new Error('DOCKER_READ_FAILED');
      return id;
    }
    if (args[0] === 'service') {
      const identity = aliases.get(args.at(-1) ?? '');
      if (!identity) throw new Error('DOCKER_READ_FAILED');
      return JSON.stringify({ ...identity, image: state.configured });
    }
    if (args[0] === 'ps') {
      if (inventory.services.every((s) => s.kind === 'container'))
        return state.containers;
      return identities.some(
        (identity) =>
          args.includes(`label=com.docker.swarm.service.id=${identity.id}`) ||
          args.includes(`label=com.docker.swarm.service.name=${identity.name}`),
      )
        ? state.containers
        : '';
    }
    if (args[0] === 'container') return state.runningImage;
    throw new Error('UNEXPECTED_COMMAND');
  };
  return { inventory, images, state, calls, read, identities };
}

test('P2 regression: full and short Swarm IDs resolve to canonical identities and cannot hide image drift', () => {
  const f = fixture();
  f.inventory.services[0].name = f.identities[0].id;
  f.inventory.services[1].name = f.identities[1].id.slice(0, 12);
  const result = checkMaintenanceImages(f.inventory, f.read);
  assert.deepEqual(
    result.services.map((service) => service.name),
    f.identities.map((service) => service.name),
  );
  assert.ok(
    result.services.every((service) => service.runningContainers === 1),
  );
  assert.ok(
    f.calls
      .filter((args) => args[0] === 'ps')
      .every((args) =>
        args[2].startsWith('label=com.docker.swarm.service.id='),
      ),
  );
  f.state.runningImage = rollbackId;
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /RUNNING_IMAGE_MISMATCH/u,
  );
});

test('P2 regression: different aliases of one physical Swarm service cannot fill the three roles', () => {
  const f = fixture();
  const identity = f.identities[0];
  const aliases = [identity.name, identity.id, identity.id.slice(0, 12)];
  f.inventory.services.forEach((service, index) => {
    service.name = aliases[index];
  });
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /DUPLICATE_SERVICE_ID/u,
  );
});

test('invalid or incomplete canonical service metadata blocks before container enumeration', () => {
  for (const response of [
    '',
    'null',
    '{}',
    '{',
    JSON.stringify({
      id: 'short',
      name: 'api',
      image: 'synthetic/api:current',
    }),
    JSON.stringify({
      id: 'a'.repeat(25),
      name: 'bad\nname',
      image: 'synthetic/api:current',
    }),
    JSON.stringify({ id: 'a'.repeat(25), name: 'api', image: [] }),
  ]) {
    const f = fixture();
    assert.throws(
      () =>
        checkMaintenanceImages(f.inventory, (args) =>
          args[0] === 'service' ? response : f.read(args),
        ),
      /SERVICE_METADATA_INVALID/u,
    );
    assert.equal(
      f.calls.some((args) => args[0] === 'ps'),
      false,
    );
  }
});

test('OPS-API-IMAGE-T02: approves matching current, rollback, Swarm reference and running image', () => {
  const f = fixture();
  const result = checkMaintenanceImages(f.inventory, f.read);
  assert.equal(result.status, 'ready');
  assert.equal(result.services[0].runningContainers, 1);
  assert.ok(f.calls.some((call) => call[0] === 'service'));
});

test('a stopped service still requires both approved images, with no implicit pull', () => {
  const f = fixture();
  f.state.containers = '';
  assert.equal(
    checkMaintenanceImages(f.inventory, f.read).services[0].runningContainers,
    0,
  );
  f.images.delete(f.inventory.services[0].rollback.reference);
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /DOCKER_READ_FAILED/u,
  );
  assert.ok(
    f.calls.every((args) =>
      ['info', 'image', 'service', 'ps', 'container'].includes(args[0]),
    ),
  );
});

test('a missing tag blocks even when the image ID and healthy old container still exist', () => {
  const f = fixture();
  f.images.delete(f.inventory.services[0].current.reference);
  assert.equal(f.images.get(currentId), currentId);
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /DOCKER_READ_FAILED/u,
  );
});

test('retargeted tags and running image drift block independently', () => {
  const f = fixture();
  f.images.set(f.inventory.services[0].current.reference, rollbackId);
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /IMAGE_ID_MISMATCH/u,
  );
  f.images.set(f.inventory.services[0].current.reference, currentId);
  f.state.runningImage = rollbackId;
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /RUNNING_IMAGE_MISMATCH/u,
  );
});

test('checks the configured Swarm reference, including a locally available resolved digest', () => {
  const f = fixture();
  f.state.configured = 'another/api:latest';
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /SERVICE_REFERENCE_MISMATCH/u,
  );
  f.state.configured = `synthetic/api:current@sha256:${'c'.repeat(64)}`;
  f.images.set(f.state.configured, currentId);
  assert.equal(checkMaintenanceImages(f.inventory, f.read).status, 'ready');
  f.images.set(f.state.configured, rollbackId);
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /IMAGE_ID_MISMATCH/u,
  );
});

test('refuses the wrong daemon before image inspection and a daemon switch during collection', () => {
  const f = fixture();
  f.state.daemonId = 'different-daemon';
  assert.throws(
    () => checkMaintenanceImages(f.inventory, f.read),
    /DAEMON_MISMATCH/u,
  );
  assert.equal(f.calls.length, 1);
  f.state.daemonId = daemonId;
  let infoCalls = 0;
  assert.throws(
    () =>
      checkMaintenanceImages(f.inventory, (args) => {
        if (args[0] === 'info' && ++infoCalls === 2) return 'different-daemon';
        return f.read(args);
      }),
    /DAEMON_MISMATCH/u,
  );
});

test('malformed or oversized container enumeration denies maintenance', () => {
  const f = fixture();
  for (const output of [
    'invalid output',
    'abc123abc123\ninvalid',
    Array(65).fill('abc123abc123').join('\n'),
  ]) {
    f.state.containers = output;
    assert.throws(
      () => checkMaintenanceImages(f.inventory, f.read),
      /CONTAINER_LIST_INVALID/u,
    );
  }
});

test('rejects incomplete, duplicated and malformed approval inventories before any Docker read', () => {
  const f = fixture();
  const entry = f.inventory.services[0];
  /** @param {Record<string, unknown>} changes */
  const changed = (changes) => ({
    ...f.inventory,
    services: [{ ...entry, ...changes }, ...f.inventory.services.slice(1)],
  });
  const invalid = [
    null,
    [],
    {},
    { ...f.inventory, schemaVersion: 2 },
    { ...f.inventory, services: [] },
    { ...f.inventory, services: [entry] },
    { ...f.inventory, services: Array(33).fill(entry) },
    { ...f.inventory, services: [entry, entry, f.inventory.services[2]] },
    {
      ...f.inventory,
      services: f.inventory.services.map((service) => ({
        ...service,
        role: 'api',
      })),
    },
    { ...f.inventory, daemonId: '' },
    ...[undefined, ['swarm'], ['container'], {}, 'other'].map((kind) =>
      changed({ kind }),
    ),
    changed({ role: undefined }),
    changed({ role: 'other' }),
    changed({ rollback: undefined }),
    changed({ current: { reference: '--help', imageId: currentId } }),
    changed({
      rollback: { reference: 'synthetic/api:rollback', imageId: 'latest' },
    }),
    changed({ rollback: entry.current }),
    changed({ name: 'bad\nname' }),
  ];
  for (const value of invalid)
    assert.throws(
      () => validateMaintenanceInventory(value),
      /INVENTORY_INVALID/u,
    );
  assert.deepEqual(f.calls, []);
});

test('the standalone fixture uses its own label and still checks running IDs', () => {
  const f = fixture();
  for (const service of f.inventory.services) service.kind = 'container';
  checkMaintenanceImages(f.inventory, f.read);
  assert.equal(
    f.calls.some((args) => args[0] === 'service'),
    false,
  );
  assert.ok(
    f.calls.some((args) =>
      args.includes(
        'label=io.crm.image-preflight.service=espectro-mvp_silmer-api',
      ),
    ),
  );
});

test('requires an explicit canonical local socket, rejecting remote and inherited targets', () => {
  assert.equal(validateMaintenanceSocket(socket), socket);
  for (const endpoint of [
    '',
    'tcp://127.0.0.1:2375',
    'ssh://operator@example.test',
    'unix:///tmp/../docker.sock',
    'unix:////var/run/docker.sock',
    'unix:///tmp/a\nsock',
  ]) {
    assert.throws(
      () => createMaintenanceReader(endpoint),
      /LOCAL_SOCKET_REQUIRED/u,
    );
  }
  assert.deepEqual(
    dockerEnvironment({
      PATH: 'synthetic-path',
      DOCKER_HOST: 'private',
      DOCKER_CONTEXT: 'private',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_CERT_PATH: 'private',
      DOCKER_CONFIG: 'private',
      docker_host: 'private',
    }),
    { PATH: 'synthetic-path' },
  );
});

test('the concrete adapter only performs read commands and hides Docker errors/timeouts', () => {
  /** @type {Array<{command:string,args:string[],options:import('node:child_process').SpawnSyncOptionsWithStringEncoding}>} */
  const calls = [];
  const read = createMaintenanceReader(socket, (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: `${currentId}\n` };
  });
  assert.equal(
    read(['image', 'inspect', '--format', '{{.Id}}', 'synthetic/api:current']),
    currentId,
  );
  assert.deepEqual(calls[0].args.slice(0, 2), ['--host', socket]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 10_000);
  for (const args of [
    ['pull', 'synthetic/api'],
    ['image', 'rm', 'synthetic/api'],
    ['image', 'prune'],
    ['system', 'prune'],
    ['restart', 'synthetic'],
  ]) {
    assert.throws(() => read(args), /READ_ONLY_COMMAND_REQUIRED/u);
  }
  assert.equal(calls.length, 1);
  for (const result of [
    { status: 1, stdout: 'synthetic-private-detail' },
    {
      status: null,
      stdout: '',
      error: new Error('synthetic-sensitive-timeout'),
    },
  ]) {
    assert.throws(
      () =>
        createMaintenanceReader(
          socket,
          () => result,
        )(['info', '--format', '{{.ID}}']),
      /^Error: DOCKER_READ_FAILED$/u,
    );
  }
});

test('drill refuses nonlocal contexts, missing opt-in, non-Linux and non-root before daemon creation', () => {
  const target = {
    platform: 'linux',
    uid: 0,
    env: {},
    args: ['--isolated-local'],
  };
  assert.doesNotThrow(() => assertDrillTarget(target));
  for (const invalid of [
    { ...target, platform: 'win32' },
    { ...target, uid: 1000 },
    { ...target, args: [] },
    { ...target, args: ['--isolated-local', '--host'] },
    ...[
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
    ].map((key) => ({ ...target, env: { [key]: 'synthetic-remote-context' } })),
  ])
    assert.throws(
      () => assertDrillTarget(invalid),
      /ISOLATED_LOCAL_LINUX_ROOT_REQUIRED/u,
    );
});

test('preflight CLI exits nonzero with a bounded code before connecting for invalid arguments', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/check-maintenance-images.mjs',
      '--docker-host',
      'ssh://example.test',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'blocked',
    code: 'USAGE_INVENTORY_AND_LOCAL_SOCKET_REQUIRED',
  });
});
