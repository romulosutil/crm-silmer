import assert from 'node:assert/strict';

/** Configuration for child processes only, never for a discovered host daemon.
 * @param {string} directory @param {string} token
 */
export function privateRuntimeSettings(directory, token) {
  assert.match(directory, /^\/tmp\/crm-image-drill-[a-zA-Z0-9]+$/u);
  assert.match(token, /^[a-f0-9-]{36}$/u);
  const address = `${directory}/containerd.sock`;
  const namespace = `crm-image-drill-${token}`;
  const pluginsNamespace = `${namespace}-plugins`;
  const containerdArgs = [
    '--config',
    `${directory}/containerd.toml`,
    '--root',
    `${directory}/containerd-root`,
    '--state',
    `${directory}/containerd-state`,
    '--address',
    address,
  ];
  const dockerArgs = [
    '--containerd',
    address,
    '--containerd-namespace',
    namespace,
    '--containerd-plugins-namespace',
    pluginsNamespace,
  ];
  const config = `version = 2
imports = []
disabled_plugins = ["io.containerd.grpc.v1.cri", "io.containerd.cri.v1.images", "io.containerd.cri.v1.runtime", "io.containerd.nri.v1.nri"]
[grpc]
  tcp_address = ""
[ttrpc]
  address = "${directory}/containerd.ttrpc"
[debug]
  address = ""
[metrics]
  address = ""
`;
  return {
    address,
    namespace,
    pluginsNamespace,
    containerdArgs,
    dockerArgs,
    config,
  };
}

/** Check actual /proc argv, not just the requested spawn options.
 * @param {string} cmdline @param {string[]} args
 */
export function assertPrivateProcess(cmdline, args) {
  const actual = cmdline.split('\0');
  if (actual.at(-1) === '') actual.pop();
  assert.deepEqual(actual.slice(1), args, 'PRIVATE_PROCESS_ARGUMENTS_MISMATCH');
}

/** A dead containerd does not prove its shims/tasks have stopped.
 * @param {boolean} started
 * @param {{pid?:number,exitCode:number|null,signalCode:string|null}|undefined} child
 */
export function assertRuntimeAvailableForCleanup(started, child) {
  if (started)
    assert.ok(
      child?.pid && child.exitCode === null && child.signalCode === null,
      'PRIVATE_RUNTIME_CLEANUP_UNPROVEN',
    );
}

/** Old Docker clients may omit Containerd from their info model. In that case
 * the mandatory /proc checks and subsequent ctr membership proof still apply.
 * Never emit the full info object: it can contain proxy configuration.
 * @param {unknown} info @param {ReturnType<typeof privateRuntimeSettings>} expected
 */
export function assertPrivateRuntimeInfo(info, expected) {
  assert.ok(
    info && typeof info === 'object' && !Array.isArray(info),
    'DOCKER_INFO_INVALID',
  );
  const runtime =
    /** @type {{Containerd?:{Address?:unknown,Namespaces?:{Containers?:unknown,Plugins?:unknown}} | null}} */ (
      info
    ).Containerd;
  if (runtime === undefined || runtime === null) return;
  assert.equal(
    runtime.Address,
    expected.address,
    'CONTAINERD_ADDRESS_MISMATCH',
  );
  assert.equal(
    runtime.Namespaces?.Containers,
    expected.namespace,
    'CONTAINERD_NAMESPACE_MISMATCH',
  );
  assert.equal(
    runtime.Namespaces?.Plugins,
    expected.pluginsNamespace,
    'CONTAINERD_PLUGINS_NAMESPACE_MISMATCH',
  );
}
