import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import {
  createInboxService,
  PostgresInboxRepository,
} from '../modules/inbox-channels/src/index.js';
import { PostgresChatMediaUploadRepository } from '../modules/integration-reliability/src/postgres-chat-media-upload-repository.js';
import { RustfsMediaStore } from '../modules/integration-reliability/src/rustfs-media-store.js';
import {
  PostgresN8nCommandOutbox,
  PostgresN8nIntegrationRepository,
  createN8nIntegrationService,
} from '../modules/n8n-integration/src/index.js';
import {
  encryptJson,
  decryptJson,
} from '../modules/n8n-integration/src/crypto.js';
import { createChatMediaApiRuntime } from '../apps/api/src/chat-media-runtime.js';
import { registerN8nCommandMediaRoutes } from '../apps/api/src/n8n-command-media-routes.js';
import { registerN8nRoutes } from '../apps/api/src/n8n-routes.js';

const execute = promisify(execFile);
const connectionString = process.env.TEST_DATABASE_URL;
if (
  process.env.RUN_N8N_MEDIA_LOCAL_SMOKE !== 'yes' ||
  !connectionString ||
  new URL(connectionString).pathname !== '/crm_silmer_test'
)
  throw new Error('Explicit isolated local smoke required');
const KEY = Buffer.alloc(32, 8);
const actor = {
  id: 'media-smoke-seller',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
};
const container = 'crm-silmer-media-test-n8n';
const pool = new Pool({ connectionString, max: 4 });
const database = {
  query: pool.query.bind(pool),
  transaction: (/** @type {any} */ work) => withTransaction(pool, work),
};
const upload = new PostgresChatMediaUploadRepository({ database });
const store = new RustfsMediaStore({
  bucket: 'crm-silmer-chat-media-dev',
  endpoint: 'http://127.0.0.1:21900',
  region: 'us-east-1',
  accessKeyId: 'crm-local-synthetic-media',
  secretAccessKey: 'crm-local-synthetic-media-secret-only',
});
const integration = createN8nIntegrationService({
  repository: new PostgresN8nIntegrationRepository({
    database,
    envelopeKey: KEY,
  }),
});
const inbox = createInboxService({
  repository: new PostgresInboxRepository({
    database,
    envelopeKey: KEY,
    outboundMessageOutbox: new PostgresN8nCommandOutbox({ envelopeKey: KEY }),
  }),
  auditPort: { async append() {} },
});
const directory = await mkdtemp(resolve('var/n8n-media-smoke-'));
const stateDirectory = join(directory, 'state');
await mkdir(stateDirectory);
const source = JSON.parse(
  await readFile(
    'ops/n8n/workflows/0S5ZS1xeDCSoWovs-local-test.sanitized.json',
    'utf8',
  ),
);
// Exercise the unmodified panel branch of the generated workflow. The inbound
// AI branch is a separate feature and needs credentials absent from this test.
const localModel = structuredClone(
  source.nodes.find(
    (/** @type {any} */ node) =>
      node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  ),
);
localModel.credentials = {
  openAiApi: {
    id: 'synthetic-local-openai-reference',
    name: 'Synthetic local OpenAI',
  },
};
await writeFile(
  join(directory, 'credentials.json'),
  JSON.stringify([
    {
      id: 'synthetic-local-openai-reference',
      name: 'Synthetic local OpenAI',
      type: 'openAiApi',
      data: { apiKey: 'synthetic-only-not-live' },
    },
  ]),
);
const reachable = new Set();
/** @param {string} name */
function visit(name) {
  if (reachable.has(name)) return;
  reachable.add(name);
  for (const groups of Object.values(source.connections[name] ?? {}))
    for (const edges of groups) for (const edge of edges) visit(edge.node);
}
visit('Painel - Receber comando (MVP)');
source.nodes = source.nodes.filter((/** @type {any} */ node) =>
  reachable.has(node.name),
);
source.nodes.push(localModel);
source.connections = Object.fromEntries(
  Object.entries(source.connections).filter(([name]) => reachable.has(name)),
);
source.nodes.forEach((/** @type {any} */ node) => {
  if (
    node.name === 'DEV - Simular upload Meta de midia (MVP)' ||
    node.name === 'DEV - Simular envio Meta de midia (MVP)'
  ) {
    // Count only the simulated Meta effects; all CRM nodes and byte validation
    // are the generated production path, with their original failure outputs.
    const boundary = node.name.includes('upload') ? 'upload' : 'messages';
    node.parameters.jsCode =
      `await this.helpers.httpRequest({method:'POST',url:$env.SILMER_DEV_META_STUB_URL+'/${boundary}',body:{command_id:$('Preparar reserva de envio humano (MVP)').item.json.command.command_id},json:true});\n` +
      node.parameters.jsCode;
  }
});
await writeFile(join(directory, 'workflow.json'), JSON.stringify(source));
const counts = new Map();
const faults = new Map();
const api = Fastify({ logger: false });
api.decorate('automationAuth', {
  async authorize(/** @type {any} */ input) {
    assert.equal(input.authorization, 'Basic synthetic-local-n8n-media');
    return { actor: 'AUTOMATION_EXECUTOR', credentialVersion: 'current' };
  },
});
const contextFor = (
  /** @type {import('fastify').FastifyRequest} */ request,
) => ({
  correlationId: String(request.headers['x-correlation-id']),
  requestId: randomUUID(),
});
const runtime = createChatMediaApiRuntime({
  repository: upload,
  access: {},
  spoolRoot: join(directory, 'spool'),
  envelopeKey: KEY,
  store,
  bucketAlias: 'chat-dev',
});
const reader = new PostgresN8nIntegrationRepository({
  database,
  envelopeKey: KEY,
});
registerN8nCommandMediaRoutes(
  api,
  {
    readReservedMedia: (/** @type {any} */ input) =>
      reader.readReservedMedia(input),
  },
  {
    async reservedContent(/** @type {any} */ row) {
      const result = await runtime.reservedContent(row);
      const commandId = (
        await pool.query(
          'SELECT command_id FROM crm.n8n_commands WHERE message_id=$1',
          [row.message_id],
        )
      ).rows[0].command_id;
      const fault = faults.get(commandId);
      if (['hash', 'size'].includes(fault)) {
        const chunks = [];
        for await (const chunk of result.stream) chunks.push(chunk);
        const original = Buffer.concat(chunks);
        const corrupt =
          fault === 'size'
            ? original.subarray(0, original.length - 1)
            : Buffer.from(original);
        if (fault === 'hash') corrupt[corrupt.length - 1] ^= 1;
        return {
          ...result,
          stream: Readable.from(corrupt),
          headers: {
            ...result.headers,
            'Content-Length': String(corrupt.length),
          },
        };
      }
      return result;
    },
  },
  contextFor,
);
api.addHook('onRequest', async (request) => {
  if (request.url.includes('/commands/')) {
    const id = decodeURIComponent(
      request.url.split('/commands/')[1].split('/media')[0],
    );
    if (request.url.endsWith('?preflight=true') && faults.get(id) === 'epoch')
      await pool.query(
        'UPDATE crm.conversations SET automation_epoch=automation_epoch+1 WHERE id=(SELECT conversation_id FROM crm.n8n_commands WHERE command_id=$1)',
        [id],
      );
  }
});
registerN8nRoutes(
  api,
  {
    ...integration,
    receiveInbound: async () => {
      throw new Error('Unused');
    },
    storeAttachment: async () => {
      throw new Error('Unused');
    },
    recordOrderIntent: async () => {
      throw new Error('Unused');
    },
  },
  contextFor,
);
for (const boundary of ['upload', 'messages'])
  api.post('/meta-stub/' + boundary, async (request) => {
    const id = /** @type {{command_id:string}} */ (request.body).command_id;
    const count = counts.get(id) ?? { upload: 0, messages: 0 };
    count[boundary]++;
    counts.set(id, count);
    return { ok: true };
  });
await api.listen({ host: '0.0.0.0', port: 23001 });
/** @type {string[]} */ const objectKeys = [];
/** @type {Buffer[]} */ const byteCanaries = [];
try {
  await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
  await migrate(pool, { migrations: await loadMigrations() });
  await pool.query(
    "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,'media-smoke@example.test','$argon2id$synthetic','Synthetic')",
    [actor.id],
  );
  await pool.query(
    "INSERT INTO crm.contacts(id,created_at,updated_at) VALUES('media-smoke-contact',now(),now())",
  );
  await pool.query(
    "INSERT INTO crm.contact_identities(id,current_contact_id,provider,provider_account_id,channel,external_identity_lookup_hash,identity_kind,phone_status,identity_envelope,created_at,updated_at) VALUES('media-smoke-identity','media-smoke-contact','meta','synthetic','whatsapp',$1,'phone','confirmed',$2,now(),now())",
    [
      'a'.repeat(64),
      encryptJson(
        { externalIdentityId: '5511999999999' },
        JSON.stringify(['crm.contact_identities', 1, 'a'.repeat(64)]),
        KEY,
      ),
    ],
  );
  await execute('docker', [
    'run',
    '--detach',
    '--name',
    container,
    '--memory=2g',
    '--cpus=1',
    '--publish',
    '127.0.0.1:25678:5678',
    '--env',
    'N8N_DEFAULT_BINARY_DATA_MODE=default',
    '--env',
    'N8N_CONCURRENCY_PRODUCTION_LIMIT=1',
    '--env',
    'N8N_BLOCK_ENV_ACCESS_IN_NODE=false',
    '--env',
    'N8N_DIAGNOSTICS_ENABLED=false',
    '--env',
    'N8N_SECURE_COOKIE=false',
    '--env',
    'N8N_PERSONALIZATION_ENABLED=false',
    '--env',
    'N8N_LOG_LEVEL=info',
    '--env',
    'SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION=Basic synthetic-local-n8n-media',
    '--env',
    'SILMER_PANEL_BASE_URL=http://host.docker.internal:23001',
    '--env',
    'SILMER_DEV_META_STUB_URL=http://host.docker.internal:23001/meta-stub',
    '--mount',
    `type=bind,source=${stateDirectory},target=/home/node/.n8n`,
    '--mount',
    `type=bind,source=${directory},target=/smoke,readonly`,
    '--mount',
    `type=bind,source=${resolve('ops/n8n/import-local-workflow.mjs')},target=/import-local-workflow.mjs,readonly`,
    '--entrypoint',
    '/bin/sh',
    'n8nio/n8n:2.38.7',
    '-ec',
    'if [ ! -f /home/node/.n8n/synthetic-credentials-imported ]; then n8n import:credentials --input=/smoke/credentials.json >/tmp/credentials.log 2>&1; touch /home/node/.n8n/synthetic-credentials-imported; fi; node /import-local-workflow.mjs /smoke/workflow.json /home/node/.n8n/silmer-local-workflow-imported >/tmp/import.log 2>&1; n8n publish:workflow --id=0S5ZS1xeDCSoWovs >/tmp/publish.log 2>&1; exec n8n start',
  ]);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await globalThis.fetch('http://127.0.0.1:25678/healthz')).ok) break;
    } catch {}
    if (i === 119) throw new Error('N8N_STARTUP_TIMEOUT');
    await new Promise((r) => setTimeout(r, 500));
  }
  for (let i = 0; i < 120; i++) {
    // HTTP health starts before workflow activation. Wait for the positive
    // runtime activation event; Windows bind mounts are not a SQLite watch API.
    const ready = await execute('docker', ['logs', container]);
    if (
      (ready.stdout + ready.stderr).includes(
        'Activated workflow "LOCAL | Silmer | Fluxo completo sem WhatsApp"',
      )
    )
      break;
    if (i === 119) throw new Error('N8N_PUBLICATION_NOT_ACTIVATED');
    await new Promise((r) => setTimeout(r, 500));
  }
  /** @type {Record<string,{ext:string,mime:string,args:string[]}>} */
  const fixtures = {
    image: {
      ext: 'media.png',
      mime: 'image/png',
      args: ['-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1'],
    },
    audio: {
      ext: 'media.ogg',
      mime: 'audio/ogg',
      args: [
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'libopus',
      ],
    },
    video: {
      ext: 'media.mp4',
      mime: 'video/mp4',
      args: [
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=32x32:d=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
      ],
    },
  };
  for (const fixture of Object.values(fixtures))
    await execute('docker', [
      'exec',
      'crm-silmer-media-test-runtime-pipeline',
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...fixture.args,
      '/workspace/' +
        relative(process.cwd(), join(directory, fixture.ext)).replaceAll(
          '\\',
          '/',
        ),
    ]);
  /** @param {string} type @param {string} [mode] */
  async function scenario(type, mode = 'success') {
    // Each scenario uses a separate conversation; reset only the synthetic schema
    // above, never delete retained messages to make a replay pass.
    const conversationId = 'media-smoke-' + randomUUID();
    await pool.query(
      "INSERT INTO crm.conversations(id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,opened_at,last_message_at,inbound_revision) VALUES($1,'media-smoke-identity','meta','synthetic',$1,1,now(),now(),1)",
      [conversationId],
    );
    let bytes = await readFile(join(directory, fixtures[type].ext));
    if (mode === 'near-limit') {
      // A valid MP4 free box pads the synthetic video to the admitted byte limit.
      const padding = Buffer.alloc(16 * 1024 * 1024 - bytes.length);
      padding.writeUInt32BE(padding.length);
      padding.write('free', 4);
      bytes = Buffer.concat([bytes, padding]);
    }
    byteCanaries.push(
      bytes.subarray(0, 128),
      Buffer.from(bytes.toString('base64').slice(0, 192)),
    );
    const id = randomUUID();
    const key = randomUUID();
    objectKeys.push(key);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const admission = {
      id,
      actor,
      conversationId,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      sessionHash: randomUUID(),
      reservationBytes: bytes.length * 2,
    };
    await upload.admit(admission);
    await upload.complete({
      ...admission,
      kind: type,
      origin: 'attachment',
      declaredMimeType: fixtures[type].mime,
      sizeBytes: bytes.length,
      reservationBytes: bytes.length * 2,
      sha256: sha,
      fingerprint: 'c'.repeat(64),
      filenameEnvelope: encryptJson(
        { filename: 'synthetic-private-name-' + id },
        `chat-media-filename:${id}`,
        KEY,
      ),
    });
    await store.putValidated({
      key,
      stream: Readable.from(bytes),
      sizeBytes: bytes.length,
      sha256: sha,
      mimeType: fixtures[type].mime,
    });
    await pool.query(
      "UPDATE crm.chat_media SET state='ready',validation_status='clean',content_sha256=$2,detected_mime_type=$3,object_key=$4,processed_at=now(),size_bytes=$5,reservation_bytes=$5 WHERE id=$1",
      [id, sha, fixtures[type].mime, key, bytes.length],
    );
    await pool.query(
      "UPDATE crm.chat_media_quotas SET reserved_bytes=(SELECT sum(reservation_bytes) FROM crm.chat_media) WHERE bucket_alias='chat-dev'",
    );
    const commandId = 'media/send?' + randomUUID() + '#%';
    const sent = await inbox.sendHumanMessage({
      actor,
      conversationId,
      expectedVersion: 1,
      idempotencyKey: commandId,
      correlationId: randomUUID(),
      reason: 'Synthetic smoke',
      messageType: type,
      content:
        type === 'audio'
          ? { mediaId: id }
          : { mediaId: id, caption: 'Synthetic caption' },
    });
    const row = (
      await pool.query('SELECT * FROM crm.n8n_commands WHERE message_id=$1', [
        sent.id,
      ])
    ).rows[0];
    await pool.query(
      "UPDATE crm.n8n_commands SET status='processing',locked_by='synthetic-smoke',locked_until=now()+interval '1 hour' WHERE command_id=$1",
      [row.command_id],
    );
    const payload = decryptJson(
      row.payload_envelope,
      `n8n-command:${row.command_id}`,
      KEY,
    );
    if (mode === 'missing') await store.deleteDraft(key);
    if (['epoch', 'hash', 'size'].includes(mode))
      faults.set(row.command_id, mode);
    const body = {
      ...payload,
      simulate_media_upload_failed: mode === 'upload-failed',
      simulate_send_unknown: mode === 'unknown',
    };
    const response = await globalThis.fetch(
      'http://127.0.0.1:25678/webhook/silmer/local-panel-command',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': row.command_id,
          'x-correlation-id': randomUUID(),
        },
        body: JSON.stringify(body),
      },
    );
    const responseText = await response.text();
    assert.equal(response.status, 202, responseText.slice(0, 200));
    assert.equal(JSON.parse(responseText).command_id, row.command_id);
    let result;
    for (let i = 0; i < 100; i++) {
      result = (
        await pool.query(
          'SELECT status,retryable,retry_safe,external_message_id FROM crm.n8n_commands WHERE command_id=$1',
          [row.command_id],
        )
      ).rows[0];
      if (result.status !== 'processing') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(
      result.status,
      ['success', 'near-limit', 'updated', 'idempotent'].includes(mode)
        ? 'sent'
        : mode === 'unknown'
          ? 'outcome_unknown'
          : 'failed',
    );
    assert.deepEqual(
      counts.get(row.command_id) ?? { upload: 0, messages: 0 },
      ['missing', 'hash', 'size'].includes(mode)
        ? { upload: 0, messages: 0 }
        : ['upload-failed', 'epoch'].includes(mode)
          ? { upload: 1, messages: 0 }
          : { upload: 1, messages: 1 },
    );
    if (['updated', 'idempotent'].includes(mode))
      assert.equal(
        result.external_message_id,
        'dev-human-media-updated-' + row.command_id,
      );
    if (mode === 'unknown')
      assert.deepEqual([result.retryable, result.retry_safe], [false, false]);
    if (mode === 'success') {
      await globalThis.fetch(
        'http://127.0.0.1:25678/webhook/silmer/local-panel-command',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': row.command_id,
            'x-correlation-id': randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      assert.deepEqual(counts.get(row.command_id), { upload: 1, messages: 1 });
    }
    process.stdout.write(`PASS ${type} ${mode}\n`);
  }
  for (const type of ['image', 'audio', 'video']) await scenario(type);
  await scenario('image', 'upload-failed');
  await scenario('audio', 'unknown');
  await scenario('video', 'missing');
  await scenario('image', 'epoch');
  await scenario('image', 'hash');
  await scenario('audio', 'size');
  await scenario('video', 'near-limit');
  const transferPeak = Number(
    (
      await execute('docker', [
        'exec',
        container,
        'cat',
        '/sys/fs/cgroup/memory.peak',
      ])
    ).stdout.trim(),
  );
  /** Read only a stopped profile; never use SQL to repair or prune this proof. */
  async function publication() {
    return JSON.parse(
      (
        await execute('python', [
          'scripts/inspect-n8n-local-publication.py',
          join(stateDirectory, 'database.sqlite'),
        ])
      ).stdout,
    );
  }
  /** @param {number} previousActivations */
  async function restart(previousActivations) {
    await execute('docker', ['start', container]);
    for (let i = 0; i < 240; i++) {
      const output = await execute('docker', ['logs', container]);
      const activations =
        (output.stdout + output.stderr).split(
          'Activated workflow "LOCAL | Silmer | Fluxo completo sem WhatsApp"',
        ).length - 1;
      if (
        activations > previousActivations &&
        (await globalThis.fetch('http://127.0.0.1:25678/healthz')).ok
      )
        return;
      if (i === 239) throw new Error('N8N_REPUBLICATION_NOT_ACTIVATED');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await execute('docker', ['stop', container]);
  const initialPublication = await publication();
  assert.equal(initialPublication.active, true);
  assert.equal(
    initialPublication.version,
    initialPublication.published_version,
  );
  assert.equal(initialPublication.openai_reference_preserved, true);
  assert.equal(initialPublication.credentials, 1);
  const updatedSource = structuredClone(source);
  delete updatedSource.nodes.find(
    (/** @type {any} */ node) =>
      node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  ).credentials;
  const messageNode = updatedSource.nodes.find(
    (/** @type {any} */ node) =>
      node.name === 'DEV - Simular envio Meta de midia (MVP)',
  );
  assert.ok(messageNode.parameters.jsCode.includes('dev-human-media-'));
  messageNode.parameters.jsCode = messageNode.parameters.jsCode.replace(
    'dev-human-media-',
    'dev-human-media-updated-',
  );
  await writeFile(
    join(directory, 'workflow.json'),
    JSON.stringify(updatedSource),
  );
  await restart(1);
  await scenario('image', 'updated');
  await execute('docker', ['stop', container]);
  const updatedPublication = await publication();
  assert.notEqual(updatedPublication.version, initialPublication.version);
  assert.equal(
    updatedPublication.version,
    updatedPublication.published_version,
  );
  assert.equal(updatedPublication.openai_reference_preserved, true);
  assert.equal(updatedPublication.credentials, initialPublication.credentials);
  assert.equal(updatedPublication.users, initialPublication.users);
  await restart(2);
  await scenario('image', 'idempotent');
  // Capture memory before stopping; subsequent inspection verifies the same
  // native version and retained local references after an unchanged reimport.
  const peak = Math.max(
    transferPeak,
    Number(
      (
        await execute('docker', [
          'exec',
          container,
          'cat',
          '/sys/fs/cgroup/memory.peak',
        ])
      ).stdout.trim(),
    ),
  );
  assert.ok(peak > 16 * 1024 * 1024 && peak < 2 * 1024 * 1024 * 1024);
  process.stdout.write(
    `PASS native default 16MiB peak_bytes=${peak} concurrency=1 memory_limit=2GiB\n`,
  );
  // Stop gracefully before scanning SQLite/WAL so Docker Desktop flushes
  // filesystem state. Origin fixtures live outside this n8n state directory.
  await execute('docker', ['stop', container]);
  assert.deepEqual(await publication(), updatedPublication);
  process.stdout.write(
    'PASS real digest update published and executed; unchanged reimport preserves version/users/OpenAI reference/state volume\n',
  );
  const logOutput = await execute('docker', ['logs', container]);
  const logs = logOutput.stdout + logOutput.stderr;
  assert.equal(logs.includes('synthetic-private-name'), false);
  for (const canary of byteCanaries)
    assert.equal(
      Buffer.from(logs).includes(canary),
      false,
      'raw/base64 bytes in stdout/stderr',
    );
  const residual = await execute('python', [
    'scripts/inspect-n8n-execution-privacy.py',
    join(stateDirectory, 'database.sqlite'),
  ]);
  const decoded = JSON.parse(residual.stdout);
  assert.equal(decoded.rows, 15);
  assert.equal(decoded.soft_deleted, 15);
  assert.equal(decoded.binary_properties, 0);
  assert.equal(decoded.binary_references, 0);
  assert.equal(decoded.saved_run_nodes, 0);
  assert.equal(decoded.initial_webhook_only, true);
  process.stdout.write(
    'Initial execution categories: ' + JSON.stringify(decoded) + '\n',
  );
  /** @param {string} directory */
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(path);
        continue;
      }
      const bytes = await readFile(path);
      for (const canary of byteCanaries)
        assert.equal(
          bytes.includes(canary),
          false,
          'raw/base64 bytes in n8n DB/WAL/files',
        );
    }
  }
  await scan(stateDirectory);
  process.stdout.write(
    'PASS actual n8n2.38.7 initial records only, soft-deleted; no binary references or raw/base64 byte canary in DB/WAL/files/stdout/stderr. Production PII privacy gate remains pending.\n',
  );
} finally {
  const finalLogs = await execute('docker', ['logs', container]).catch(() => ({
    stdout: '',
    stderr: '',
  }));
  await writeFile(
    join(directory, 'n8n-logs.txt'),
    finalLogs.stdout + finalLogs.stderr,
  );
  const diagnostic = await execute('docker', [
    'exec',
    container,
    'sh',
    '-c',
    'tail -n 10 /tmp/import.log; tail -n 12 /tmp/publish.log',
  ]).catch((error) => ({
    stdout: error.stdout ?? '',
    stderr: error.stderr ?? '',
  }));
  await writeFile(
    join(directory, 'n8n-startup.txt'),
    diagnostic.stdout + diagnostic.stderr,
  );
  await execute('docker', ['stop', container]).catch(() => {});
  await execute('docker', ['rm', container]).catch(() => {});
  // Remove only keys created in this isolated smoke; production retention is
  // checked elsewhere and no pre-existing objects/volumes are enumerated.
  for (const key of objectKeys) await store.deleteDraft(key).catch(() => {});
  await api.close();
  await pool.end();
}
