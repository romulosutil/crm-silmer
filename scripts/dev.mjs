import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { seedDevelopmentUsers } from './seed-dev-users.mjs';

/** @typedef {import('node:child_process').ChildProcess} ChildProcess */

const root = resolve(import.meta.dirname, '..');
const apiHost = process.env.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? '3000';
const devHost = process.env.DEV_HOST ?? '127.0.0.1';
const devPort = process.env.DEV_PORT ?? '4173';
const apiOrigin = process.env.API_ORIGIN ?? `http://${apiHost}:${apiPort}`;
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://crm_silmer:crm_silmer_dev@127.0.0.1:5432/crm_silmer';
const shouldSeedDevelopmentUsers =
  process.env.DATABASE_URL === undefined ||
  process.env.SEED_DEVELOPMENT_USERS === 'true';
const localIdentityEnvironment = {
  APP_ENV: process.env.APP_ENV ?? 'development',
  APP_ORIGIN: process.env.APP_ORIGIN ?? `http://${devHost}:${devPort}`,
  AUTH_THROTTLE_HMAC_KEY:
    process.env.AUTH_THROTTLE_HMAC_KEY ?? randomBytes(32).toString('base64url'),
  IDEMPOTENCY_ENVELOPE_KEY:
    process.env.IDEMPOTENCY_ENVELOPE_KEY ??
    randomBytes(32).toString('base64url'),
  DEAL_ENVELOPE_KEY:
    process.env.DEAL_ENVELOPE_KEY ?? randomBytes(32).toString('base64url'),
  QUALIFICATION_ENVELOPE_KEY:
    process.env.QUALIFICATION_ENVELOPE_KEY ??
    randomBytes(32).toString('base64url'),
  HANDOFF_ENVELOPE_KEY:
    process.env.HANDOFF_ENVELOPE_KEY ?? randomBytes(32).toString('base64url'),
  KANBAN_CURSOR_HMAC_KEY:
    process.env.KANBAN_CURSOR_HMAC_KEY ?? randomBytes(32).toString('base64url'),
  IDENTITY_BOOTSTRAP_TOKEN:
    process.env.IDENTITY_BOOTSTRAP_TOKEN ??
    'development-bootstrap-token-local-only',
};

if (process.env.DATABASE_URL === undefined) await startLocalDatabase();
await runMigrations();
await runInitialBuild();

/** @type {ChildProcess[]} */
const children = [];
try {
  children.push(
    start('api', ['--watch', 'apps/api/src/server.js'], {
      DATABASE_URL: databaseUrl,
      ...localIdentityEnvironment,
      HOST: apiHost,
      PORT: apiPort,
    }),
  );
  await waitForApi();
  if (shouldSeedDevelopmentUsers) {
    await seedDevelopmentUsers({
      apiOrigin,
      bootstrapToken: localIdentityEnvironment.IDENTITY_BOOTSTRAP_TOKEN,
      origin: localIdentityEnvironment.APP_ORIGIN,
    });
  }
  children.push(
    start('edge watcher', ['scripts/watch-edge.mjs']),
    start('development edge server', ['scripts/serve-dev.mjs'], {
      API_ORIGIN: apiOrigin,
      HOST: devHost,
      PORT: devPort,
    }),
  );
} catch (error) {
  for (const child of children) child.kill('SIGTERM');
  throw error;
}

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
  await run('initial build', process.execPath, ['scripts/build.mjs']);
}

async function startLocalDatabase() {
  await run('local PostgreSQL', 'docker', [
    'compose',
    '-f',
    'docker-compose.dev.yml',
    'up',
    '--detach',
    'postgres',
  ]);
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const code = await run(
      'PostgreSQL readiness check',
      'docker',
      [
        'compose',
        '-f',
        'docker-compose.dev.yml',
        'exec',
        '--no-TTY',
        'postgres',
        'pg_isready',
        '-U',
        'crm_silmer',
        '-d',
        'crm_silmer',
      ],
      false,
    );
    if (code === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error('Local PostgreSQL did not become ready in time');
}

async function runMigrations() {
  await run(
    'database migrations',
    process.execPath,
    ['modules/database/src/cli.js'],
    true,
    { DATABASE_URL: databaseUrl },
  );
}

async function waitForApi() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await globalThis.fetch(
        new URL('/api/health/live', apiOrigin),
      );
      if (response.ok) return;
    } catch {
      // The API process is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Local API did not become ready in time');
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

/**
 * @param {string} name
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} [required]
 * @param {Record<string, string>} [environment]
 */
async function run(name, command, args, required = true, environment = {}) {
  console.log(`Starting ${name}.`);
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: required ? 'inherit' : 'ignore',
  });
  const [code] = await once(child, 'exit');
  const result = code ?? 1;
  if (required && result !== 0) {
    throw new Error(`${name} exited with code ${result}`);
  }
  return result;
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
