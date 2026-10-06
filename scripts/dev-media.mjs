import { createHash, createHmac, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { seedDevelopmentUsers } from './seed-dev-users.mjs';

const execute = promisify(execFile);
const secretNames = [
  'AUTH_THROTTLE_HMAC_KEY',
  'IDEMPOTENCY_ENVELOPE_KEY',
  'HANDOFF_ENVELOPE_KEY',
  'OPERATION_CURSOR_HMAC_KEY',
  'CONTACT_IDENTITY_ENVELOPE_KEY',
  'CONTACT_IDENTITY_LOOKUP_KEY',
  'INBOX_MESSAGE_ENVELOPE_KEY',
  'N8N_INTEGRATION_ENVELOPE_KEY',
  'CRM_AUTOMATION_CLIENT_SECRET',
  'N8N_COMMAND_CLIENT_SECRET',
  'N8N_ENCRYPTION_KEY',
  'RUSTFS_SECRET_KEY',
  'MEDIA_API_SECRET',
  'MEDIA_WORKER_SECRET',
];
/** @param {string} stateRoot @param {() => Promise<string[]>} listVolumes */
export async function loadMediaDevelopmentSecrets(stateRoot, listVolumes) {
  try {
    return JSON.parse(
      await readFile(resolve(stateRoot, 'secrets.json'), 'utf8'),
    );
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
    if ((await listVolumes()).length > 0)
      throw new Error(
        'Local media secrets missing with persistent volumes; restore the original secrets before startup',
      );
    return undefined;
  }
}
/** @param {{enabled?:boolean,secrets?:Record<string,string>}} options */
export function createMediaDevelopmentConfig({
  enabled = false,
  secrets,
} = {}) {
  const values =
    secrets ??
    Object.fromEntries(
      secretNames.map((name) => [name, randomBytes(32).toString('base64url')]),
    );
  if (secretNames.some((name) => !values[name] || values[name].length < 32))
    throw new Error('Local media secrets incomplete');
  const shared = {
    APP_ENV: 'development',
    APP_ORIGIN: 'http://127.0.0.1:4193',
    DATABASE_URL:
      'postgresql://crm_silmer_media:synthetic-media-development-only@postgres:5432/crm_silmer_media',
    FAB_CODE: '01',
    HOST: '0.0.0.0',
    PORT: '3000',
    IDENTITY_BOOTSTRAP_TOKEN: 'synthetic-media-development-bootstrap-only',
    ...Object.fromEntries(
      secretNames
        .filter(
          (name) =>
            !name.startsWith('MEDIA_') &&
            !name.startsWith('RUSTFS_') &&
            name !== 'N8N_ENCRYPTION_KEY',
        )
        .map((name) => [name, values[name]]),
    ),
    CRM_AUTOMATION_CLIENT_ID: 'n8n-media-local-development',
    N8N_COMMAND_CLIENT_ID: 'crm-media-local-development',
    N8N_COMMAND_ALLOW_INSECURE_LOCAL: 'true',
    N8N_COMMAND_REPLAY_SAFE: 'false',
    N8N_COMMAND_URL: 'http://127.0.0.1:5678/webhook/silmer/local-panel-command',
    N8N_COMMAND_TIMEOUT_MS: '10000',
    N8N_INTEGRATION_ENABLED: 'true',
    PRIVATE_MEDIA_ROOT: '/var/lib/crm-legacy-media',
    PRIVATE_MEDIA_MAX_BYTES: String(64 * 1024 * 1024),
    PRIVATE_MEDIA_MAX_FILE_BYTES: String(16 * 1024 * 1024),
    MEDIA_RETENTION_SCAN_INTERVAL_MS: '60000',
    CHAT_MEDIA_ENABLED: String(enabled),
    CHAT_MEDIA_READ_ENABLED: 'true',
    CHAT_MEDIA_BUCKET_ALIAS: 'chat-dev',
    CHAT_MEDIA_QUOTA_BYTES: String(1024 * 1024 * 1024),
    CHAT_MEDIA_SPOOL_ROOT: '/var/lib/crm-chat-media',
    MEDIA_S3_ENDPOINT: 'http://127.0.0.1:9000',
    MEDIA_S3_REGION: 'us-east-1',
    MEDIA_S3_BUCKET: 'crm-silmer-chat-media-dev',
    MEDIA_S3_FORCE_PATH_STYLE: 'true',
  };
  return {
    secrets: values,
    api: {
      ...shared,
      MEDIA_S3_ACCESS_KEY_ID: 'crm-media-local-api',
      MEDIA_S3_SECRET_ACCESS_KEY: values.MEDIA_API_SECRET,
    },
    worker: {
      ...shared,
      MEDIA_S3_ACCESS_KEY_ID: 'crm-media-local-worker',
      MEDIA_S3_SECRET_ACCESS_KEY: values.MEDIA_WORKER_SECRET,
    },
    n8n: {
      SILMER_PANEL_BASE_URL: 'http://127.0.0.1:3000',
      SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION: `Basic ${Buffer.from(`n8n-media-local-development:${values.CRM_AUTOMATION_CLIENT_SECRET}`).toString('base64')}`,
      N8N_ENCRYPTION_KEY: values.N8N_ENCRYPTION_KEY,
      N8N_DEFAULT_BINARY_DATA_MODE: 'default',
      N8N_CONCURRENCY_PRODUCTION_LIMIT: '1',
    },
  };
}

/** Bootstrap only the dedicated loopback profile. Never accept remote targets.
 * @param {Record<string,string>} secrets */
async function bootstrapStorage(secrets) {
  const endpoint = 'http://127.0.0.1:21920';
  const rootCredentials = {
    accessKeyId: 'crm-media-local-bootstrap',
    secretAccessKey: secrets.RUSTFS_SECRET_KEY,
  };
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: rootCredentials,
    maxAttempts: 1,
  });
  const bucket = 'crm-silmer-chat-media-dev';
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (/** @type {any} */ (error).$metadata?.httpStatusCode !== 404)
      throw new Error('Local media bucket bootstrap failed');
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  /** @param {string} method @param {string} path @param {string} query @param {unknown} data */
  async function admin(method, path, query, data) {
    const body = JSON.stringify(data);
    const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/gu, '');
    const date = stamp.slice(0, 8);
    const hash = (/** @type {string} */ value) =>
      createHash('sha256').update(value).digest('hex');
    const payloadHash = hash(body);
    const scope = `${date}/us-east-1/s3/aws4_request`;
    const headers = `host:127.0.0.1:21920\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
    const names = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [method, path, query, headers, names, payloadHash].join(
      '\n',
    );
    let key = createHmac('sha256', `AWS4${secrets.RUSTFS_SECRET_KEY}`)
      .update(date)
      .digest();
    for (const part of ['us-east-1', 's3', 'aws4_request'])
      key = createHmac('sha256', key).update(part).digest();
    const signature = createHmac('sha256', key)
      .update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${hash(canonical)}`)
      .digest('hex');
    const response = await globalThis.fetch(`${endpoint}${path}?${query}`, {
      method,
      body,
      headers: {
        'content-type': 'application/json',
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': stamp,
        authorization: `AWS4-HMAC-SHA256 Credential=${rootCredentials.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    await response.arrayBuffer();
    if (!response.ok)
      throw new Error(`Local media IAM bootstrap failed (${response.status})`);
  }
  for (const role of ['api', 'worker']) {
    const policyName = `crm-media-local-${role}`;
    const actions =
      role === 'api'
        ? ['s3:GetObject']
        : ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'];
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: actions,
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    };
    await admin(
      'PUT',
      '/rustfs/admin/v3/add-canned-policy',
      `name=${policyName}`,
      policy,
    );
    await admin('PUT', '/rustfs/admin/v3/add-user', `accessKey=${policyName}`, {
      secretKey:
        secrets[role === 'api' ? 'MEDIA_API_SECRET' : 'MEDIA_WORKER_SECRET'],
      status: 'enabled',
    });
    await admin(
      'PUT',
      '/rustfs/admin/v3/set-user-or-group-policy',
      `isGroup=false&policyName=${policyName}&userOrGroup=${policyName}`,
      {},
    );
  }
  client.destroy();
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const stateRoot = resolve(root, 'var', 'media-local');
  await mkdir(stateRoot, { recursive: true });
  const secrets = await loadMediaDevelopmentSecrets(stateRoot, async () => {
    const result = await execute(
      'docker',
      [
        'volume',
        'ls',
        '--filter',
        'label=com.docker.compose.project=crm-silmer-media-local',
        '--format',
        '{{.Name}}',
      ],
      { cwd: root, timeout: 10000 },
    );
    return result.stdout.trim().split('\n').filter(Boolean);
  });
  const config = createMediaDevelopmentConfig({
    enabled: !process.argv.includes('--read-only'),
    secrets,
  });
  if (!secrets)
    await writeFile(
      resolve(stateRoot, 'secrets.json'),
      JSON.stringify(config.secrets),
      { mode: 0o600 },
    );
  for (const role of ['api', 'worker', 'n8n'])
    await writeFile(
      resolve(stateRoot, `${role}.env`),
      Object.entries(config[/** @type {'api'|'worker'|'n8n'} */ (role)])
        .map(([name, value]) => `${name}=${value}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
  const environment = {
    ...process.env,
    MEDIA_LOCAL_STATE_ROOT: stateRoot,
    MEDIA_LOCAL_ROOT_SECRET: config.secrets.RUSTFS_SECRET_KEY,
  };
  const composeArgs = ['compose', '-f', 'docker-compose.media.yml'];
  /** @param {string[]} args */
  async function compose(args) {
    try {
      await execute('docker', [...composeArgs, ...args], {
        cwd: root,
        env: environment,
        timeout: 600000,
        maxBuffer: 1024 * 1024,
      });
    } catch {
      throw new Error(
        'Local media Docker operation failed; inspect dedicated profile logs without printing environment',
      );
    }
  }
  await compose(['build', 'api', 'worker']);
  await compose([
    'up',
    '--detach',
    '--wait',
    'postgres',
    'n8n-postgres',
    'rustfs',
  ]);
  await bootstrapStorage(config.secrets);
  await compose([
    'run',
    '--rm',
    '--no-deps',
    '--user',
    '0:0',
    'api',
    'chmod',
    '0700',
    '/var/lib/crm-chat-media',
    '/var/lib/crm-legacy-media',
  ]);
  await compose([
    'run',
    '--rm',
    '--no-deps',
    'api',
    'node',
    'modules/database/src/cli.js',
  ]);
  await compose(['up', '--detach', '--wait', 'api', 'n8n', 'worker']);
  await seedDevelopmentUsers({
    apiOrigin: 'http://127.0.0.1:3013',
    bootstrapToken: config.api.IDENTITY_BOOTSTRAP_TOKEN,
    origin: config.api.APP_ORIGIN,
  });
  await execute(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  console.log(
    'Local media profile ready. CRM http://127.0.0.1:4193; n8n http://127.0.0.1:5688. Workflow credentials/publication remain explicit. Containers and files persist after exit.',
  );
  if (process.argv.includes('--prepare-only')) return;
  const edge = spawn(process.execPath, ['scripts/serve-dev.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      API_ORIGIN: 'http://127.0.0.1:3013',
      HOST: '127.0.0.1',
      PORT: '4193',
    },
  });
  for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM']))
    process.once(signal, () => edge.kill(signal));
  edge.once('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(
      error instanceof Error &&
        error.message.startsWith('Local media secrets missing')
        ? error.message
        : 'Local media startup failed. Dedicated state is preserved; inspect profile readiness and logs.',
    );
    process.exitCode = 1;
  });
}
