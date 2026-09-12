import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const localN8nEnabled = process.env.N8N_LOCAL_ENABLED !== 'false';
const localSecrets = await readOrCreateLocalSecrets();
const localIdentityEnvironment = {
  APP_ENV: process.env.APP_ENV ?? 'development',
  APP_ORIGIN: process.env.APP_ORIGIN ?? `http://${devHost}:${devPort}`,
  AUTH_THROTTLE_HMAC_KEY:
    process.env.AUTH_THROTTLE_HMAC_KEY ?? localSecrets.AUTH_THROTTLE_HMAC_KEY,
  IDEMPOTENCY_ENVELOPE_KEY:
    process.env.IDEMPOTENCY_ENVELOPE_KEY ??
    localSecrets.IDEMPOTENCY_ENVELOPE_KEY,
  HANDOFF_ENVELOPE_KEY:
    process.env.HANDOFF_ENVELOPE_KEY ?? localSecrets.HANDOFF_ENVELOPE_KEY,
  OPERATION_CURSOR_HMAC_KEY:
    process.env.OPERATION_CURSOR_HMAC_KEY ??
    localSecrets.OPERATION_CURSOR_HMAC_KEY,
  CONTACT_IDENTITY_ENVELOPE_KEY:
    process.env.CONTACT_IDENTITY_ENVELOPE_KEY ??
    localSecrets.CONTACT_IDENTITY_ENVELOPE_KEY,
  INBOX_MESSAGE_ENVELOPE_KEY:
    process.env.INBOX_MESSAGE_ENVELOPE_KEY ??
    localSecrets.INBOX_MESSAGE_ENVELOPE_KEY,
  IDENTITY_BOOTSTRAP_TOKEN:
    process.env.IDENTITY_BOOTSTRAP_TOKEN ??
    'development-bootstrap-token-local-only',
};
const localN8nClientId = 'n8n-local-development';
const localN8nClientSecret = localSecrets.CRM_AUTOMATION_CLIENT_SECRET;
/** @type {Record<string, string>} */
const localN8nEnvironment = localN8nEnabled
  ? {
      CRM_AUTOMATION_CLIENT_ID: localN8nClientId,
      CRM_AUTOMATION_CLIENT_SECRET: localN8nClientSecret,
      CONTACT_IDENTITY_LOOKUP_KEY: localSecrets.CONTACT_IDENTITY_LOOKUP_KEY,
      MEDIA_RETENTION_SCAN_INTERVAL_MS: '60000',
      N8N_COMMAND_ALLOW_INSECURE_LOCAL: 'true',
      N8N_COMMAND_CLIENT_ID: 'crm-local-development',
      N8N_COMMAND_CLIENT_SECRET: localSecrets.N8N_COMMAND_CLIENT_SECRET,
      N8N_COMMAND_REPLAY_SAFE: 'false',
      N8N_COMMAND_TIMEOUT_MS: '10000',
      N8N_COMMAND_URL:
        'http://127.0.0.1:5678/webhook/silmer/local-panel-command',
      N8N_INTEGRATION_ENABLED: 'true',
      N8N_INTEGRATION_ENVELOPE_KEY: localSecrets.N8N_INTEGRATION_ENVELOPE_KEY,
      PRIVATE_MEDIA_MAX_BYTES: String(64 * 1024 * 1024),
      PRIVATE_MEDIA_MAX_FILE_BYTES: String(16 * 1024 * 1024),
      PRIVATE_MEDIA_ROOT: resolve(root, 'tmp', 'local-n8n-media'),
    }
  : {};
const localN8nComposeEnvironment = {
  SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION: `Basic ${Buffer.from(
    `${localN8nClientId}:${localN8nClientSecret}`,
    'utf8',
  ).toString('base64')}`,
  SILMER_LOCAL_PANEL_BASE_URL:
    process.env.SILMER_LOCAL_PANEL_BASE_URL ??
    `http://host.docker.internal:${apiPort}`,
};

if (process.env.DATABASE_URL === undefined) await startLocalDatabase();
if (localN8nEnabled) await startLocalN8n();
await runMigrations();
await runInitialBuild();

/** @type {ChildProcess[]} */
const children = [];
try {
  children.push(
    start('api', ['--watch', 'apps/api/src/server.js'], {
      DATABASE_URL: databaseUrl,
      ...localIdentityEnvironment,
      ...localN8nEnvironment,
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
    ...(localN8nEnabled
      ? [
          start('worker', ['apps/worker/src/worker.js'], {
            DATABASE_URL: databaseUrl,
            ...localIdentityEnvironment,
            ...localN8nEnvironment,
          }),
        ]
      : []),
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

async function startLocalN8n() {
  await run('local n8n workflow generation', process.execPath, [
    'ops/n8n/workflows/create-dev-test-workflow.mjs',
    '--local',
  ]);
  await run(
    'local n8n',
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.dev.yml',
      'up',
      '--detach',
      '--force-recreate',
      'n8n',
    ],
    true,
    localN8nComposeEnvironment,
  );
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

async function readOrCreateLocalSecrets() {
  const path = resolve(root, 'tmp', 'local-development-secrets.json');
  /** @type {Record<string, string>} */
  let values = {};
  try {
    values = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
  }
  const names = [
    'AUTH_THROTTLE_HMAC_KEY',
    'CONTACT_IDENTITY_ENVELOPE_KEY',
    'CONTACT_IDENTITY_LOOKUP_KEY',
    'CRM_AUTOMATION_CLIENT_SECRET',
    'HANDOFF_ENVELOPE_KEY',
    'IDEMPOTENCY_ENVELOPE_KEY',
    'INBOX_MESSAGE_ENVELOPE_KEY',
    'N8N_COMMAND_CLIENT_SECRET',
    'N8N_INTEGRATION_ENVELOPE_KEY',
    'OPERATION_CURSOR_HMAC_KEY',
  ];
  let changed = false;
  for (const name of names) {
    if (typeof values[name] === 'string' && values[name].length >= 32) continue;
    values[name] = randomBytes(32).toString('base64url');
    changed = true;
  }
  if (changed) {
    await mkdir(resolve(root, 'tmp'), { recursive: true });
    await writeFile(path, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
  }
  return values;
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
