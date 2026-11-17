// WAP-E02: real patched n8n + dedicated PostgreSQL; synthetic CRM/gateway only.
// Never publishes an operational workflow, pairs WhatsApp or prints raw data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWhatsAppControlWorkflows } from './whatsapp-control-workflows.mjs';
import {
  containsPrivateValue,
  privateRepresentations,
} from '../evolution/wap-spike-privacy.mjs';

const NODE = 'node:24.20.0-bookworm-slim';
const POSTGRES = 'postgres:17-alpine';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function command(args, input = '', timeout = 180000) {
  return new Promise((done, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const capture = (chunk) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024 * 1024) child.kill('SIGKILL');
      else chunks.push(chunk);
    };
    child.stdout.on('data', capture);
    if (args[0] === 'logs') child.stderr.on('data', capture);
    else child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('WAP_REHEARSAL_DOCKER_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('WAP_REHEARSAL_DOCKER_FAILED'));
      else done(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const fetchScript = `let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s);try{const r=await fetch(p.url,{method:p.method??'GET',headers:p.headers,body:p.body===undefined?undefined:JSON.stringify(p.body),redirect:'manual',signal:AbortSignal.timeout(65000)});process.stdout.write(JSON.stringify({status:r.status,cookie:r.headers.get('set-cookie'),cache:r.headers.get('cache-control'),body:await r.text()}))}catch{process.stdout.write('{"status":0,"body":""}')}`;
const manualFinished = String.raw`let s='';for await(const c of process.stdin)s+=c;const id=JSON.parse(s).id;const fs=await import('node:fs');const path=await import('node:path');let found=false;function inspect(v){if(!v||typeof v!=='object')return;if(v.eventName==='n8n.workflow.success'&&String(v.payload?.executionId)===String(id)&&v.payload?.isManual===true)found=true;for(const c of Object.values(v))inspect(c)}function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.log'))for(const l of fs.readFileSync(p,'utf8').split('\n'))try{inspect(JSON.parse(l))}catch{}}}walk('/home/node/.n8n');process.stdout.write(JSON.stringify(found));`;
// Compile authored container helpers before provisioning any resource.
for (const source of [fetchScript, manualFinished])
  new Function(`return (async()=>{${source}})`);

export async function runWhatsAppControlRehearsal() {
  if (process.argv[2] !== '--isolated-synthetic')
    throw new Error('WAP_REHEARSAL_EXPLICIT_ISOLATION_REQUIRED');
  const suffix = randomBytes(6).toString('hex');
  const prefix = `wap-e02-${suffix}`;
  const label = `silmer.wap-e02=${suffix}`;
  const network = `${prefix}-network`;
  const image = `${prefix}:n8n`;
  const db = `${prefix}-db`;
  const n8n = `${prefix}-n8n`;
  const fixture = `${prefix}-fixture`;
  const volumes = [];
  const containers = [];
  const auditToken = randomBytes(32).toString('hex');
  const gatewayKey = randomBytes(32).toString('hex');
  const crmSecret = randomBytes(32).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');
  const ownerPassword = `Wap-${randomBytes(16).toString('hex')}-9!`;
  const dbPassword = randomBytes(32).toString('hex');
  const crmBasic = `Basic ${Buffer.from(`synthetic-crm:${crmSecret}`).toString('base64')}`;
  const webhookBasic = `Basic ${Buffer.from(`synthetic-webhook:${webhookSecret}`).toString('base64')}`;
  const records = ['code', 'qr', 'failure', 'progress', 'manual'].map(
    (behavior) => {
      const operationId = randomUUID();
      const lineId = randomUUID();
      return {
        behavior,
        mode: behavior === 'qr' ? 'qr' : 'code',
        operationId,
        lineId,
        reference: randomUUID(),
        challengeId: randomUUID(),
        resultId: randomUUID(),
        generation: 1,
        instance: `synthetic-${behavior}`,
        source: {
          bindingId: randomUUID(),
          lineId,
          accountId: randomUUID(),
          generation: 1,
        },
        generationToken: randomBytes(32).toString('hex'),
      };
    },
  );
  const config = {
    synthetic: true,
    auditToken,
    gatewayKey,
    crmBasic,
    records,
    webhookUrl:
      'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events',
  };
  const secrets = [
    auditToken,
    gatewayKey,
    crmSecret,
    webhookSecret,
    crmBasic,
    webhookBasic,
    ownerPassword,
    dbPassword,
    ...records.map((r) => r.generationToken),
  ];
  const report = {
    scope: 'WAP-E02/WAP-T01-04; isolated synthetic, no real pairing/provider',
    technicalGate: 'pending',
    checks: {},
    privacyFailures: [],
    cleanup: 'pending',
  };
  let stage = 'initialization';
  let networkCreated = false;
  let imageCreated = false;
  const step = (value) => {
    stage = value;
    process.stderr.write(`WAP_E02_REHEARSAL_STAGE ${value}\n`);
  };
  const run = async (name, args) => {
    containers.push(name);
    await command([
      'run',
      '--detach',
      '--name',
      name,
      '--label',
      label,
      '--network',
      network,
      ...args,
    ]);
  };
  const volume = async (name) => {
    volumes.push(name);
    await command(['volume', 'create', '--label', label, name]);
    return name;
  };
  const wait = async (check) => {
    for (let i = 0; i < 120; i++) {
      if (await check()) return;
      await pause(500);
    }
    throw new Error('WAP_REHEARSAL_WAIT_FAILED');
  };
  const http = async (path, options = {}, container = n8n) =>
    JSON.parse(
      (
        await command(
          ['exec', '-i', container, 'node', '-e', fetchScript],
          JSON.stringify({
            url: path.startsWith('http:')
              ? path
              : `http://127.0.0.1:5678${path}`,
            ...options,
          }),
          75000,
        )
      ).toString(),
    );
  const sql = async (query) =>
    (
      await command([
        'exec',
        db,
        'psql',
        '-U',
        'postgres',
        '-d',
        'n8n_wap_e02',
        '-Atc',
        query,
      ])
    )
      .toString()
      .trim();
  let cookie = '';
  const rawApi = (path, method, body) =>
    http(`/rest${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        Origin: 'http://localhost:5678',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
    });
  const api = async (path, method = 'GET', body) => {
    const result = await rawApi(path, method, body);
    if (result.cookie) cookie = result.cookie.split(';')[0];
    assert.ok(result.status >= 200 && result.status < 300);
    const parsed = JSON.parse(result.body);
    return parsed.data ?? parsed;
  };
  const fixtureHttp = (path) =>
    http(`http://wap-control-fixture:8080${path}`, {
      headers: { 'x-wap-fixture-token': auditToken },
    });
  const audit = async () => JSON.parse((await fixtureHttp('/audit')).body);
  const envelope = (record, kind) => ({
    operationId: record.operationId,
    lineId: record.lineId,
    generation: record.generation,
    reference: record.reference,
    ...(kind === 'control'
      ? { action: 'connect' }
      : { challengeId: record.challengeId, mode: record.mode }),
  });
  const post = (record, path = 'challenge', authenticated = true) =>
    http(`/webhook/silmer/seller-whatsapp/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { authorization: webhookBasic } : {}),
      },
      body: envelope(record, path === 'control' ? 'control' : 'challenge'),
    });
  let representations = [];
  const refresh = async () => {
    const data = await audit();
    representations = [
      ...secrets,
      cookie,
      cookie.slice(cookie.indexOf('=') + 1),
    ]
      .filter((value) => value.length >= 32)
      .flatMap((value) => privateRepresentations({}, value));
    representations.push(
      ...data.records.flatMap((r) =>
        privateRepresentations({ value: r.value }, auditToken),
      ),
    );
  };
  const scan = (bytes) => containsPrivateValue(bytes, representations);
  const inspect = async (name) => {
    await refresh();
    const dump = await command([
      'exec',
      db,
      'pg_dump',
      '-U',
      'postgres',
      '--inserts',
      'n8n_wap_e02',
    ]);
    const logs = await command(['logs', n8n]);
    const fixtureLogs = await command(['logs', fixture]);
    const snapshot = await command([
      'exec',
      n8n,
      'tar',
      '-cf',
      '-',
      '-C',
      '/home/node/.n8n',
      '.',
    ]);
    const result = {
      databaseAndLogicalBackup: scan(dump),
      logs: scan(logs) || scan(fixtureLogs),
      stateAndSnapshot: scan(snapshot),
    };
    report.checks[name] = result;
    if (Object.values(result).some(Boolean)) report.privacyFailures.push(name);
  };
  try {
    step('dedicated-resources');
    await command(['network', 'create', '--label', label, network]);
    networkCreated = true;
    const dbVolume = await volume(`${prefix}-postgres-data`);
    const stateVolume = await volume(`${prefix}-n8n-state`);
    await run(db, [
      '--memory=512m',
      '-e',
      `POSTGRES_PASSWORD=${dbPassword}`,
      '-e',
      'POSTGRES_DB=n8n_wap_e02',
      '-v',
      `${dbVolume}:/var/lib/postgresql/data`,
      POSTGRES,
    ]);
    await wait(async () => {
      try {
        await command(['exec', db, 'pg_isready', '-U', 'postgres']);
        return true;
      } catch {
        return false;
      }
    });
    await run(fixture, [
      '--network-alias',
      'wap-control-fixture',
      '--memory=128m',
      '-e',
      `WAP_CONTROL_FIXTURE=${JSON.stringify(config)}`,
      '-v',
      `${resolve(root, 'ops/n8n/whatsapp-control-fixture.mjs')}:/ops/n8n/whatsapp-control-fixture.mjs:ro`,
      '-v',
      `${resolve(root, 'ops/evolution/wap-control-runtime.cjs')}:/ops/evolution/wap-control-runtime.cjs:ro`,
      '-v',
      `${resolve(root, 'ops/evolution/wap-generation-runtime.cjs')}:/ops/evolution/wap-generation-runtime.cjs:ro`,
      NODE,
      'node',
      '/ops/n8n/whatsapp-control-fixture.mjs',
    ]);
    step('patched-n8n-image');
    imageCreated = true;
    await command(
      [
        'build',
        '--quiet',
        '--label',
        label,
        '-t',
        image,
        '-f',
        resolve(root, 'ops/n8n/wap-ingress-Dockerfile'),
        resolve(root, 'ops/n8n'),
      ],
      '',
      600000,
    );
    report.n8nPatchedImage = (
      await command(['image', 'inspect', image, '--format', '{{.Id}}'])
    )
      .toString()
      .trim();
    const base = [
      '--memory=2g',
      '--cpus=1',
      '-v',
      `${stateVolume}:/home/node/.n8n`,
      '-e',
      'DB_TYPE=postgresdb',
      '-e',
      `DB_POSTGRESDB_HOST=${db}`,
      '-e',
      'DB_POSTGRESDB_USER=postgres',
      '-e',
      `DB_POSTGRESDB_PASSWORD=${dbPassword}`,
      '-e',
      'DB_POSTGRESDB_DATABASE=n8n_wap_e02',
      '-e',
      'N8N_DIAGNOSTICS_ENABLED=false',
      '-e',
      'N8N_VERSION_NOTIFICATIONS_ENABLED=false',
      '-e',
      'N8N_TEMPLATES_ENABLED=false',
      '-e',
      'N8N_SECURE_COOKIE=false',
      '-e',
      'N8N_ENCRYPTION_KEY=isolated-synthetic-key-never-real',
      '-e',
      'EXECUTIONS_DATA_SAVE_ON_SUCCESS=none',
      '-e',
      'EXECUTIONS_DATA_SAVE_ON_ERROR=none',
      '-e',
      'EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=false',
      '-e',
      'EXECUTIONS_DATA_SAVE_ON_PROGRESS=false',
      '-e',
      'N8N_LOG_LEVEL=warn',
    ];
    const paths = Object.fromEntries(
      ['control', 'challenge', 'failure', 'progress'].map((kind) => [
        `silmer/seller-whatsapp/${kind}`,
        kind === 'control' ? 'control' : 'challenge',
      ]),
    );
    await run(n8n, [
      ...base,
      '-e',
      'SILMER_WAP_INGRESS_ENABLED=true',
      '-e',
      'SILMER_WAP_INGRESS_SYNTHETIC=true',
      '-e',
      `SILMER_WAP_INGRESS_PATHS=${JSON.stringify(paths)}`,
      '-e',
      'SILMER_WAP_CONTROL_VERIFY_URL=http://wap-control-fixture:8080/api/v1/integrations/n8n/whatsapp-control/verify',
      '-e',
      `SILMER_WAP_INGRESS_VERIFY_BASIC=${crmBasic}`,
      image,
    ]);
    await wait(async () => (await http('/healthz/readiness')).status === 200);
    step('synthetic-workflows');
    await api('/owner/setup', 'POST', {
      email: 'wap-e02@example.invalid',
      firstName: 'Synthetic',
      lastName: 'Rehearsal',
      password: ownerPassword,
    });
    const native = await api('/credentials', 'POST', {
      name: 'WAP E02 synthetic webhook',
      type: 'httpBasicAuth',
      data: { user: 'synthetic-webhook', password: webhookSecret },
    });
    const crm = await api('/credentials', 'POST', {
      name: 'WAP E02 synthetic CRM',
      type: 'httpBasicAuth',
      data: { user: 'synthetic-crm', password: crmSecret },
    });
    const gateway = await api('/credentials', 'POST', {
      name: 'WAP E02 synthetic gateway',
      type: 'httpHeaderAuth',
      data: { name: 'apikey', value: gatewayKey },
    });
    const models = createWhatsAppControlWorkflows({
      enabled: true,
      allowlist: records.map((r) => r.lineId),
      crmBaseUrl: 'http://wap-control-fixture:8080',
      evolutionBaseUrl: 'http://wap-control-fixture:8080',
      webhookCredentialId: native.id,
      crmCredentialId: crm.id,
      evolutionCredentialId: gateway.id,
      allowSyntheticHttp: true,
    });
    const save = async (model, active = true) => {
      const saved = await api('/workflows', 'POST', model);
      if (active)
        await api(`/workflows/${saved.id}/activate`, 'POST', {
          versionId: saved.versionId,
        });
      return saved;
    };
    await save(models.control);
    await save(models.challenge);
    const addFinish = (model) => {
      const result = structuredClone(model);
      result.nodes.splice(-1, 0, {
        id: 'Finish',
        name: 'Finish',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [0, 0],
        retryOnFail: false,
        credentials: {
          httpHeaderAuth: { id: gateway.id, name: 'WAP E02 synthetic gateway' },
        },
        parameters: {
          method: 'POST',
          url: 'http://wap-control-fixture:8080/after-challenge',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            "={{ JSON.stringify({challengeId:$('Guard').first().json.challengeId}) }}",
          options: {
            timeout: 60000,
            redirect: { redirect: { followRedirects: false } },
          },
        },
      });
      result.connections.Gateway = {
        main: [[{ node: 'Finish', type: 'main', index: 0 }]],
      };
      result.connections.Finish = {
        main: [[{ node: 'Respond', type: 'main', index: 0 }]],
      };
      return result;
    };
    for (const behavior of ['failure', 'progress']) {
      const model = addFinish(models.challenge);
      model.name = `Silmer seller WhatsApp synthetic ${behavior}`;
      model.nodes[0].parameters.path = `silmer/seller-whatsapp/${behavior}`;
      model.nodes[0].webhookId = `silmer-synthetic-${behavior}`;
      await save(model);
    }
    const manualModel = addFinish(models.challenge);
    manualModel.name = 'Silmer seller WhatsApp synthetic manual';
    manualModel.nodes[0] = {
      id: 'Trigger',
      name: 'Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    };
    manualModel.nodes.find((node) => node.name === 'Guard').parameters.jsCode =
      `return {json:${JSON.stringify(envelope(records[4], 'challenge'))}};`;
    manualModel.nodes = manualModel.nodes.filter(
      (node) => node.name !== 'Respond',
    );
    delete manualModel.connections.Finish;
    const manual = await save(manualModel, false);
    step('control-and-challenges');
    for (const record of records) {
      const prepared = await post(record, 'control');
      assert.equal(prepared.status, 200);
      assert.equal(JSON.parse(prepared.body).accepted, true);
    }
    for (const record of records.slice(0, 2)) {
      const challenged = await post(record);
      assert.equal(challenged.status, 200);
      assert.equal(challenged.cache, 'no-store');
      const body = JSON.parse(challenged.body);
      const issued = (await audit()).records.find(
        (r) => r.challengeId === record.challengeId,
      );
      assert.equal(body.value === issued.value, true);
      assert.equal(body.challengeId, record.challengeId);
    }
    await inspect('success');
    const beforeReplay = Number(
      await sql('SELECT count(*) FROM execution_entity'),
    );
    const replay = await post(records[0]);
    assert.equal(replay.status, 403);
    assert.equal(
      Number(await sql('SELECT count(*) FROM execution_entity')),
      beforeReplay,
    );
    assert.equal((await audit()).records[0].issued, 1);
    report.checks.challengeReplayRejectedBeforePersistence = true;
    step('native-authentication-and-authoritative-metadata');
    const unauthenticated = await post(records[2], 'failure', false);
    report.checks.nativeUnauthenticatedStatus = unauthenticated.status;
    assert.ok([401, 403].includes(unauthenticated.status));
    assert.equal(
      Number(await sql('SELECT count(*) FROM execution_entity')),
      beforeReplay,
    );
    const forged = await post(
      { ...records[2], operationId: randomUUID() },
      'failure',
    );
    assert.equal(forged.status, 403);
    assert.equal((await audit()).records[2].issued, 0);
    report.checks.unauthorizedMetadataNeverReachesGateway = true;
    step('failure-after-challenge');
    const failed = await post(records[2], 'failure');
    report.checks.failedAfterChallengeStatus = failed.status;
    assert.ok(failed.status >= 400);
    assert.equal((await audit()).records[2].issued, 1);
    await inspect('failureAfterChallenge');
    step('in-progress-and-manual');
    const pending = post(records[3], 'progress').catch(() => ({ status: 0 }));
    await wait(async () => (await audit()).pending === 1);
    await inspect('inProgressWithChallenge');
    await fixtureHttp('/release');
    assert.equal((await pending).status, 200);
    step('manual-dispatch');
    const execution = await api(`/workflows/${manual.id}/run`, 'POST', {
      triggerToStartFrom: { name: 'Trigger' },
    });
    assert.ok(execution.executionId);
    report.checks.manualDispatched = true;
    step('manual-completion');
    await wait(
      async () =>
        JSON.parse(
          (
            await command(
              ['exec', '-i', n8n, 'node', '-e', manualFinished],
              JSON.stringify({ id: execution.executionId }),
            )
          ).toString(),
        ) === true,
    );
    assert.equal((await audit()).records[4].issued, 1);
    assert.equal(
      (await audit()).records.every((record) => record.sourceCaptured === true),
      true,
    );
    report.checks.providerSocketCapturedAuthoritativeSource = true;
    report.checks.manualRuntimeSucceeded = true;
    await inspect('manual');
    const deniedManual = await rawApi(`/workflows/${manual.id}/run`, 'POST', {
      triggerToStartFrom: { name: 'Trigger' },
      runData: {
        Trigger: [
          {
            data: {
              main: [[{ json: { value: (await audit()).records[4].value } }]],
            },
          },
        ],
      },
    });
    assert.equal(deniedManual.status, 400);
    const deniedPin = await rawApi(`/workflows/${manual.id}`, 'PATCH', {
      pinData: {
        Trigger: [{ json: { value: (await audit()).records[4].value } }],
      },
    });
    assert.equal(deniedPin.status, 400);
    report.checks.manualPartialAndPinRejected = true;
    await inspect('manualAndPinDenied');
    step('default-off-and-physical-backup');
    await command(['stop', n8n]);
    const off = `${prefix}-n8n-off`;
    await run(off, [...base, image]);
    await wait(
      async () => (await http('/healthz/readiness', {}, off)).status === 200,
    );
    const offResult = await http(
      '/webhook/silmer/seller-whatsapp/challenge',
      {
        method: 'POST',
        headers: {
          authorization: webhookBasic,
          'content-type': 'application/json',
        },
        body: envelope(records[0], 'challenge'),
      },
      off,
    );
    assert.equal(offResult.status, 403);
    report.checks.defaultOffOnFreshProcess = true;
    await command(['stop', off]);
    await sql('CHECKPOINT');
    await command(['stop', db]);
    const physical = await command([
      'run',
      '--rm',
      '--label',
      label,
      '--network',
      'none',
      '-v',
      `${dbVolume}:/scan:ro`,
      NODE,
      'tar',
      '-cf',
      '-',
      '-C',
      '/scan',
      '.',
    ]);
    const state = await command([
      'run',
      '--rm',
      '--label',
      label,
      '--network',
      'none',
      '-v',
      `${stateVolume}:/scan:ro`,
      NODE,
      'tar',
      '-cf',
      '-',
      '-C',
      '/scan',
      '.',
    ]);
    report.checks.stoppedPhysicalDatabaseAndWal = scan(physical);
    report.checks.stoppedStateSnapshot = scan(state);
    if (scan(physical) || scan(state))
      report.privacyFailures.push('stoppedPhysicalBackup');
    assert.deepEqual(report.privacyFailures, []);
    report.technicalGate = 'passed';
  } catch {
    report.technicalGate = 'failed';
    report.failure = { stage, code: 'WAP_E02_REHEARSAL_FAILED' };
  } finally {
    step('cleanup');
    const cleanupFailures = [];
    for (const name of containers.reverse()) {
      try {
        const owned = (
          await command([
            'container',
            'inspect',
            name,
            '--format',
            '{{index .Config.Labels "silmer.wap-e02"}}',
          ])
        )
          .toString()
          .trim();
        assert.equal(owned, suffix);
        await command(['rm', '--force', name]);
      } catch {
        cleanupFailures.push('container');
      }
    }
    for (const name of volumes.reverse()) {
      try {
        const owned = (
          await command([
            'volume',
            'inspect',
            name,
            '--format',
            '{{index .Labels "silmer.wap-e02"}}',
          ])
        )
          .toString()
          .trim();
        assert.equal(owned, suffix);
        await command(['volume', 'rm', name]);
      } catch {
        cleanupFailures.push('volume');
      }
    }
    if (networkCreated)
      try {
        const owned = (
          await command([
            'network',
            'inspect',
            network,
            '--format',
            '{{index .Labels "silmer.wap-e02"}}',
          ])
        )
          .toString()
          .trim();
        assert.equal(owned, suffix);
        await command(['network', 'rm', network]);
      } catch {
        cleanupFailures.push('network');
      }
    if (imageCreated)
      try {
        const owned = (
          await command([
            'image',
            'inspect',
            image,
            '--format',
            '{{index .Config.Labels "silmer.wap-e02"}}',
          ])
        )
          .toString()
          .trim();
        assert.equal(owned, suffix);
        await command(['image', 'rm', image]);
      } catch {
        cleanupFailures.push('image');
      }
    const remaining = (
      await command(['ps', '-aq', '--filter', `label=${label}`])
    )
      .toString()
      .trim();
    const remainingVolumes = (
      await command(['volume', 'ls', '-q', '--filter', `label=${label}`])
    )
      .toString()
      .trim();
    const remainingNetworks = (
      await command(['network', 'ls', '-q', '--filter', `label=${label}`])
    )
      .toString()
      .trim();
    report.cleanup =
      cleanupFailures.length ||
      remaining ||
      remainingVolumes ||
      remainingNetworks
        ? 'failed'
        : 'owned-resources-removed';
    if (report.cleanup === 'failed') report.technicalGate = 'failed';
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = await runWhatsAppControlRehearsal();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.technicalGate === 'passed' ? 0 : 1;
  } catch {
    process.stderr.write('WAP_E02_REHEARSAL_FAILED\n');
    process.exitCode = 1;
  }
}
