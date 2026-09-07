import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const apiHost = process.env.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? '3000';
const devHost = process.env.DEV_HOST ?? '127.0.0.1';
const devPort = process.env.DEV_PORT ?? '4173';
const apiOrigin = process.env.API_ORIGIN ?? `http://${apiHost}:${apiPort}`;

await runInitialBuild();

const children = [
  start('api', ['--watch', 'apps/api/src/server.js'], {
    HOST: apiHost,
    PORT: apiPort,
  }),
  start('edge watcher', ['scripts/watch-edge.mjs']),
  start('development edge server', ['scripts/serve-dev.mjs'], {
    API_ORIGIN: apiOrigin,
    HOST: devHost,
    PORT: devPort,
  }),
];

console.log(`Development environment ready at http://${devHost}:${devPort}`);

let stopping = false;
/** @type {NodeJS.Signals[]} */
const shutdownSignals = ['SIGINT', 'SIGTERM'];
for (const signal of shutdownSignals) {
  process.once(signal, () => void stop(signal));
}
for (const child of children) {
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(
        `Development process exited (${signal ?? code ?? 'unknown'}).`,
      );
      void stop('SIGTERM', 1);
    }
  });
}

async function runInitialBuild() {
  const build = start('initial build', ['scripts/build.mjs']);
  const [code] = await once(build, 'exit');
  if (code !== 0) process.exitCode = 1;
  if (code !== 0) process.exit();
}

/** @param {string} name @param {string[]} args @param {Record<string, string>} [environment] */
function start(name, args, environment = {}) {
  console.log(`Starting ${name}.`);
  return spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
}

/** @param {NodeJS.Signals} signal @param {number} [code] */
async function stop(signal, code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  await Promise.all(
    children.map((child) => once(child, 'exit').catch(() => undefined)),
  );
  process.exitCode = code;
}
