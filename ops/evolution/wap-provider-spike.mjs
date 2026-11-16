// WAP-E01 / WAP-T01-01. Run on a dedicated Docker development host.
// Never prints provider responses, HTTP errors, credentials, challenges or logs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createPairingPrivacyProbe,
  createGenerationIngressProbe,
} from '../n8n/wap-pairing-privacy-probe.mjs';
import {
  containsPrivateValue,
  privateRepresentations,
  classifyPrivateTar,
} from './wap-spike-privacy.mjs';

const N8N =
  'n8nio/n8n:2.38.7@sha256:a8c95f75c6fdf65f5f2b7a7b354744eaa1c62bb911b5c00af6499c3f38e4cd32';
const POSTGRES = 'postgres:17-alpine';
const NODE = 'node:24.20.0-bookworm-slim';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function command(args, input = '', timeout = 180000) {
  return await new Promise((done, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let length = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const capture = (chunk) => {
      length += chunk.length;
      if (length > 128 * 1024 * 1024) child.kill('SIGKILL');
      else out.push(chunk);
    };
    child.stdout.on('data', capture);
    // Docker stderr can include upstream/private errors; never forward it.
    // docker logs multiplexes container stderr onto the CLI stderr stream.
    if (args[0] === 'logs') child.stderr.on('data', capture);
    else child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('WAP_DOCKER_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('WAP_DOCKER_COMMAND_FAILED'));
      else done(Buffer.concat(out));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const fetchScript = `let input=''; for await (const c of process.stdin) input+=c;
const p=JSON.parse(input);
try { const r=await fetch(p.url,{method:p.method??'GET',headers:p.headers,body:p.rawBody!==undefined?p.rawBody:p.body===undefined?undefined:JSON.stringify(p.body),redirect:'manual',signal:AbortSignal.timeout(65000)});
process.stdout.write(JSON.stringify({status:r.status,cookie:r.headers.get('set-cookie'),cache:r.headers.get('cache-control'),body:await r.text()})); }
catch { process.stdout.write(JSON.stringify({status:0,body:''})); }`;

export async function runProviderSpike() {
  if (process.argv[2] !== '--isolated-synthetic')
    throw new Error('WAP_SPIKE_EXPLICIT_ISOLATION_REQUIRED');
  const suffix = randomBytes(6).toString('hex');
  const prefix = `wap-e01-${suffix}`;
  const net = `${prefix}-network`;
  const containers = [];
  const volumes = [];
  const token = randomBytes(32).toString('hex');
  const providerApiKey = randomBytes(32).toString('hex');
  const generationTransportToken = randomBytes(32).toString('hex');
  const verifierPassword = randomBytes(32).toString('hex');
  const verifierBasic =
    'Basic ' +
    Buffer.from(`synthetic-verifier:${verifierPassword}`).toString('base64');
  const ownerPassword = `Wap-${randomBytes(16).toString('hex')}-9!`;
  const generationBindings = [
    {
      instance: 'wap-synthetic-qr',
      source: {
        bindingId: 'synthetic-a-g1',
        lineId: 'synthetic-line-a',
        accountId: 'synthetic-account-a',
        generation: 1,
      },
      token: randomBytes(32).toString('hex'),
      active: true,
    },
    {
      instance: 'wap-synthetic-qr',
      source: {
        bindingId: 'synthetic-a-g2',
        lineId: 'synthetic-line-a',
        accountId: 'synthetic-account-a',
        generation: 2,
      },
      token: randomBytes(32).toString('hex'),
      active: false,
    },
    {
      instance: 'wap-synthetic-code',
      source: {
        bindingId: 'synthetic-b-g1',
        lineId: 'synthetic-line-b',
        accountId: 'synthetic-account-b',
        generation: 1,
      },
      token: randomBytes(32).toString('hex'),
      active: true,
    },
  ];
  generationBindings.push({
    instance: 'wap-synthetic-qr',
    source: {
      bindingId: 'synthetic-a-g3',
      lineId: 'synthetic-line-a',
      accountId: 'synthetic-account-a',
      generation: 3,
    },
    token: randomBytes(32).toString('hex'),
    active: false,
  });
  const secrets = [
    token,
    providerApiKey,
    generationTransportToken,
    verifierPassword,
    verifierBasic,
    ownerPassword,
    ...generationBindings.map((binding) => binding.token),
  ];
  const report = {
    scope: 'WAP-E01/WAP-T01-01; synthetic, no pairing, no messages',
    n8nImage: N8N,
    providerSource: 'cd800f2976e1e5b682fbf86a01ee4d85ae61f370',
    checks: {},
    privacyFailures: [],
    technicalGate: 'pending',
    gate: 'blocked',
    blockers: [
      'Same-phone pairing is not homologated; this experiment never pairs an account',
      'Multi-instance operational retention is not homologated by this proof',
    ],
  };
  let networkCreated = false;
  let imageCreated = false;
  const image = `${prefix}:probe`;
  let n8nImageCreated = false;
  const n8nImage = `${prefix}:n8n`;
  let stage = 'initialization';
  const step = (value) => {
    stage = value;
    process.stderr.write(`WAP_SPIKE_STAGE ${value}\n`);
  };
  const run = async (name, args) => {
    containers.push(name);
    await command([
      'run',
      '--detach',
      '--name',
      name,
      '--label',
      `silmer.wap-spike=${suffix}`,
      '--network',
      net,
      ...args,
    ]);
  };
  const volume = async (name) => {
    volumes.push(name);
    await command([
      'volume',
      'create',
      '--label',
      `silmer.wap-spike=${suffix}`,
      name,
    ]);
    return name;
  };
  const http = async (container, path, options = {}) => {
    const url = path.startsWith('http:')
      ? path
      : `http://127.0.0.1:5678${path}`;
    return JSON.parse(
      (
        await command(
          ['exec', '-i', container, 'node', '-e', fetchScript],
          JSON.stringify({ url, ...options }),
          75000,
        )
      ).toString(),
    );
  };
  const wait = async (check, code) => {
    for (let i = 0; i < 120; i++) {
      if (await check()) return;
      await pause(500);
    }
    throw new Error(code);
  };
  const db = `${prefix}-db`;
  const n8n = `${prefix}-n8n`;
  const fixture = `${prefix}-fixture`;
  const provider = `${prefix}-provider`;
  try {
    step('dedicated-network');
    networkCreated = true;
    await command([
      'network',
      'create',
      '--label',
      `silmer.wap-spike=${suffix}`,
      '--subnet',
      `10.254.${Number.parseInt(suffix.slice(0, 2), 16)}.0/24`,
      net,
    ]);
    const databaseVolume = await volume(`${prefix}-database`);
    await run(db, [
      '--memory=512m',
      '--cpus=0.5',
      '-e',
      'POSTGRES_USER=silmer_evolution',
      '-e',
      'POSTGRES_PASSWORD=synthetic-wap-only',
      '-e',
      'POSTGRES_DB=silmer_evolution',
      '-v',
      `${databaseVolume}:/var/lib/postgresql/data`,
      POSTGRES,
    ]);
    const manualFinished = `let input=''; for await (const c of process.stdin) input+=c;
const id=JSON.parse(input).id; const fs=await import('node:fs'); const path=await import('node:path');
let found=false; function inspect(value) { if (!value||typeof value!=='object') return;
if (value.eventName==='n8n.workflow.success' && String(value.payload?.executionId)===String(id) && value.payload?.isManual===true) found=true;
for (const child of Object.values(value)) inspect(child); }
function walk(dir) { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,entry.name);
if(entry.isDirectory()) walk(p); else if(entry.name.endsWith('.log')) { for(const line of fs.readFileSync(p,'utf8').split('\\n')) { try { inspect(JSON.parse(line)); } catch {} } } } }
walk('/home/node/.n8n'); process.stdout.write(JSON.stringify(found));`;
    await wait(async () => {
      try {
        await command(['exec', db, 'pg_isready', '-U', 'silmer_evolution']);
        return true;
      } catch {
        return false;
      }
    }, 'WAP_DATABASE_NOT_READY');
    await command([
      'exec',
      db,
      'createdb',
      '-U',
      'silmer_evolution',
      'n8n_wap_synthetic',
    ]);

    step('provider-build');
    // Legacy Docker on the development host cannot parse COPY heredocs.
    // Materialize exactly the embedded sources; all other recipe bytes stay intact.
    const buildDirectory = await mkdtemp(resolve(tmpdir(), `${prefix}-build-`));
    try {
      let recipe = await readFile(
        resolve(root, 'ops/evolution/Dockerfile.inline'),
        'utf8',
      );
      for (const [name, marker, target] of [
        ['privacy.cjs', 'PRIVACY', 'silmer-privacy.cjs'],
        ['retention.cjs', 'RETENTION', 'silmer-retention.cjs'],
        [
          'wap-generation-runtime.cjs',
          'WAP_GENERATION_RUNTIME',
          'silmer-wap-generation.cjs',
        ],
        [
          'wap-generation-patch.mjs',
          'WAP_GENERATION_PATCH',
          'silmer-wap-generation-patch.mjs',
        ],
      ]) {
        const source = await readFile(
          resolve(root, `ops/evolution/${name}`),
          'utf8',
        );
        const embedded = `COPY <<'SILMER_${marker}_EOF' /evolution/${target}\n${source}\nSILMER_${marker}_EOF`;
        assert.ok(recipe.includes(embedded));
        recipe = recipe.replace(embedded, `COPY ${name} /evolution/${target}`);
        await writeFile(resolve(buildDirectory, name), source);
      }
      await writeFile(resolve(buildDirectory, 'Dockerfile'), recipe);
      imageCreated = true;
      await command(
        [
          'build',
          '--quiet',
          '--label',
          `silmer.wap-spike=${suffix}`,
          '-t',
          image,
          buildDirectory,
        ],
        '',
        600000,
      );
    } finally {
      await rm(buildDirectory, { recursive: true, force: true });
    }
    report.buildRecipe =
      'unchanged pinned recipe, embedded COPY sources materialized byte-for-byte for legacy Docker';
    report.providerImage = (
      await command(['image', 'inspect', image, '--format', '{{.Id}}'])
    )
      .toString()
      .trim();
    const env = Object.fromEntries(
      (
        await readFile(
          resolve(root, 'ops/evolution/environment.env.example'),
          'utf8',
        )
      )
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    Object.assign(env, {
      AUTHENTICATION_API_KEY: providerApiKey,
      SILMER_EVOLUTION_WEBHOOK_TOKEN: generationTransportToken,
      DATABASE_CONNECTION_URI: `postgresql://silmer_evolution:synthetic-wap-only@${db}:5432/silmer_evolution?schema=public`,
      SILMER_EVOLUTION_WEBHOOK_URL:
        'https://wap-provider-fixture.invalid/webhook/disabled',
      SERVER_URL: `http://${provider}:8080`,
      SILMER_EVOLUTION_INSTANCE: 'wap-synthetic-qr',
    });
    await run(provider, [
      '--memory=1g',
      '--cpus=1',
      ...Object.entries(env).flatMap(([key, value]) => [
        '-e',
        `${key}=${value}`,
      ]),
      '-v',
      `${resolve(root, 'ops/evolution')}:/probe/ops/evolution:ro`,
      image,
    ]);
    const providerHttp = (path, method = 'GET', body, auth = true) =>
      http(provider, `http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { apikey: providerApiKey } : {}),
        },
        body,
      });
    await wait(
      async () =>
        (await providerHttp('/instance/fetchInstances')).status === 200,
      'WAP_PROVIDER_NOT_READY',
    );
    step('provider-control');
    assert.equal(
      (await providerHttp('/instance/fetchInstances', 'GET', undefined, false))
        .status,
      401,
    );
    report.checks.providerUnauthenticated = '401';
    report.checks.provider = {};
    // Create without QR. The one connect per instance will go through n8n.
    for (const name of ['wap-synthetic-qr', 'wap-synthetic-code']) {
      const create = await providerHttp('/instance/create', 'POST', {
        instanceName: name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
      });
      assert.equal(create.status, 201);
      const created = JSON.parse(create.body);
      assert.equal(created.instance.instanceName, name);
      const disabled = await providerHttp(`/webhook/set/${name}`, 'POST', {
        webhook: {
          enabled: false,
          url: env.SILMER_EVOLUTION_WEBHOOK_URL,
          byEvents: false,
          base64: false,
          events: [],
        },
      });
      assert.equal(disabled.status, 201);
      const webhook = JSON.parse(
        (await providerHttp(`/webhook/find/${name}`)).body,
      );
      assert.equal(webhook.enabled, false);
      const before = JSON.parse(
        (await providerHttp(`/instance/connectionState/${name}`)).body,
      );
      assert.equal(before.instance.state, 'close');
      report.checks.provider[name] = {
        create: create.status,
        initialState: before.instance.state,
      };
    }
    // No raw challenge is retained as an artifact. Provider logger was wrapped.
    const providerLogs = await command(['logs', provider]);
    assert.equal(providerLogs.includes(token), false);
    assert.equal(
      providerLogs.includes(Buffer.from('data:image/png;base64,')),
      false,
    );
    report.checks.providerLogs = 'no API token or QR data URL';

    step('n8n-start');
    await run(fixture, [
      '--network-alias',
      'wap-provider-fixture',
      '--memory=128m',
      '-e',
      `WAP_PROBE_TOKEN=${token}`,
      '-e',
      `WAP_PROVIDER_API_KEY=${providerApiKey}`,
      '-e',
      `WAP_VERIFY_BASIC=${verifierBasic}`,
      '-e',
      `WAP_GENERATION_BINDINGS=${JSON.stringify(generationBindings)}`,
      '-e',
      `WAP_PROVIDER_URL=http://${provider}:8080`,
      '-v',
      `${resolve(root, 'ops/evolution/wap-provider-fixture.mjs')}:/fixture.mjs:ro`,
      NODE,
      'node',
      '/fixture.mjs',
    ]);
    const n8nVolume = await volume(`${prefix}-n8n-state`);
    step('n8n-patch-build');
    n8nImageCreated = true;
    await command(
      [
        'build',
        '--quiet',
        '--label',
        `silmer.wap-spike=${suffix}`,
        '-t',
        n8nImage,
        '-f',
        resolve(root, 'ops/n8n/wap-ingress-Dockerfile'),
        resolve(root, 'ops/n8n'),
      ],
      '',
      600000,
    );
    report.n8nPatchedImage = (
      await command(['image', 'inspect', n8nImage, '--format', '{{.Id}}'])
    )
      .toString()
      .trim();
    const n8nBaseArgs = [
      '--memory=2g',
      '--cpus=1',
      '-v',
      `${n8nVolume}:/home/node/.n8n`,
      '-e',
      'DB_TYPE=postgresdb',
      '-e',
      `DB_POSTGRESDB_HOST=${db}`,
      '-e',
      'DB_POSTGRESDB_USER=silmer_evolution',
      '-e',
      'DB_POSTGRESDB_PASSWORD=synthetic-wap-only',
      '-e',
      'DB_POSTGRESDB_DATABASE=n8n_wap_synthetic',
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
    await run(n8n, [
      '--network-alias',
      'wap-n8n',
      ...n8nBaseArgs,
      '-e',
      'SILMER_WAP_INGRESS_ENABLED=true',
      '-e',
      'SILMER_WAP_INGRESS_PATHS={"wap-e01-privacy":"challenge","wap-e01-generation":"event","wap-e01-unsafe":"challenge"}',
      '-e',
      'SILMER_WAP_INGRESS_VERIFY_URL=http://wap-provider-fixture:8080/ingress/verify',
      '-e',
      `SILMER_WAP_INGRESS_VERIFY_BASIC=${verifierBasic}`,
      n8nImage,
    ]);
    await wait(
      async () => (await http(n8n, '/healthz/readiness')).status === 200,
      'WAP_N8N_NOT_READY',
    );
    let cookie = '';
    const api = async (path, method = 'GET', body) => {
      const result = await http(n8n, `/rest${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5678',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
      });
      if (result.cookie) cookie = result.cookie.split(';')[0];
      if (result.status >= 300 || result.status < 200) {
        report.lastApiFailure = { path, method, status: result.status };
        throw new Error('WAP_N8N_API_REJECTED');
      }
      const parsed = JSON.parse(result.body);
      return parsed.data ?? parsed;
    };
    step('n8n-owner');
    await api('/owner/setup', 'POST', {
      email: 'wap-probe@example.invalid',
      firstName: 'Synthetic',
      lastName: 'Probe',
      password: ownerPassword,
    });
    step('n8n-credential');
    const credential = await api('/credentials', 'POST', {
      name: 'WAP synthetic',
      type: 'httpHeaderAuth',
      data: { name: 'X-Wap-Probe-Token', value: token },
    });
    step('n8n-workflow');
    const model = createPairingPrivacyProbe({
      enabled: true,
      allowlist: ['synthetic-a', 'synthetic-b'],
      credentialId: credential.id,
    });
    const workflow = await api('/workflows', 'POST', model);
    await api(`/workflows/${workflow.id}/activate`, 'POST', {
      versionId: workflow.versionId,
    });
    const eventCredential = await api('/credentials', 'POST', {
      name: 'WAP synthetic generation transport',
      type: 'httpHeaderAuth',
      data: {
        name: 'X-Silmer-Evolution-Token',
        value: generationTransportToken,
      },
    });
    const generationWorkflow = await api(
      '/workflows',
      'POST',
      createGenerationIngressProbe({ credentialId: eventCredential.id }),
    );
    await api(`/workflows/${generationWorkflow.id}/activate`, 'POST', {
      versionId: generationWorkflow.versionId,
    });
    const fixtureHttp = (path) =>
      http(n8n, `http://wap-provider-fixture:8080${path}`, {
        headers: { 'X-Wap-Probe-Token': token },
      });
    const fixtureAudit = async () =>
      JSON.parse((await fixtureHttp('/audit')).body);
    step('fixture-audit');
    let representations = [];
    let challengeRepresentations = [];
    let privateGroups = [];
    const credentialRepresentations = () =>
      [...secrets, cookie, cookie.slice(cookie.indexOf('=') + 1)]
        .filter((value) => value.length >= 32)
        .flatMap((value) => privateRepresentations({}, value));
    const refreshCanaries = async () => {
      const canaries = (await fixtureAudit()).canaries;
      const leafGroups = (value, path = '') => {
        if (typeof value === 'string' && value.length >= 8)
          return [
            {
              label: `value:${path}`,
              values: privateRepresentations({ value }, token).slice(0, -3),
            },
          ];
        if (!value || typeof value !== 'object') return [];
        return Object.entries(value).flatMap(([key, child]) =>
          leafGroups(
            child,
            path +
              (path ? '.' : '') +
              (/^[A-Za-z0-9_\-]{1,40}$/.test(key) ? key : 'field'),
          ),
        );
      };
      challengeRepresentations = privateRepresentations(canaries, token).slice(
        0,
        -3,
      );
      representations = [
        ...challengeRepresentations,
        ...credentialRepresentations(),
      ];
      privateGroups = [
        ...leafGroups(canaries),
        ...Object.entries(canaries).map(([mode, value]) => ({
          label: `challenge:${mode}`,
          values: privateRepresentations(value, token).slice(0, -3),
        })),
        ...secrets.map((value, index) => ({
          label: [
            'probeTransport',
            'providerApiKey',
            'generationTransport',
            'verifierPassword',
            'verifierBasic',
            'ownerPassword',
            ...generationBindings.map(
              (binding) => `generation:${binding.source.bindingId}`,
            ),
          ][index],
          values: privateRepresentations({}, value),
        })),
        ...[cookie, cookie.slice(cookie.indexOf('=') + 1)]
          .filter((value) => value.length >= 32)
          .map((value) => ({
            label: 'ownerCookie',
            values: privateRepresentations({}, value),
          })),
      ];
    };
    const scan = (bytes) => containsPrivateValue(bytes, representations);
    await refreshCanaries();
    const executionCount = async () =>
      Number(
        (
          await command([
            'exec',
            db,
            'psql',
            '-U',
            'silmer_evolution',
            '-d',
            'n8n_wap_synthetic',
            '-Atc',
            'SELECT count(*) FROM execution_entity',
          ])
        )
          .toString()
          .trim(),
      );
    const workflowCount = async () =>
      Number(
        (
          await command([
            'exec',
            db,
            'psql',
            '-U',
            'silmer_evolution',
            '-d',
            'n8n_wap_synthetic',
            '-Atc',
            'SELECT count(*) FROM workflow_entity',
          ])
        )
          .toString()
          .trim(),
      );
    const rawApi = (path, method, body) =>
      http(n8n, `/rest${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'http://localhost:5678',
        },
        body,
      });
    const audit = async (label) => {
      await refreshCanaries();
      const dump = await command([
        'exec',
        db,
        'pg_dump',
        '-U',
        'silmer_evolution',
        '--inserts',
        'n8n_wap_synthetic',
      ]);
      const logs = await command(['logs', n8n]);
      // Snapshot state volume, including event logs and binary/temp files, while running.
      const state = await command([
        'exec',
        n8n,
        'tar',
        '-cf',
        '-',
        '-C',
        '/home/node/.n8n',
        '.',
      ]);
      const hit = {
        databaseAndLogicalBackup: scan(dump),
        stdout: scan(logs),
        stateAndSnapshotBackup: scan(state),
      };
      report.checks[label] = hit;
      if (hit.databaseAndLogicalBackup) {
        const tables = [
          ...new Set(
            dump
              .toString()
              .split('\n')
              .filter((line) => scan(Buffer.from(line)))
              .map(
                (line) =>
                  /^INSERT INTO public\."?([A-Za-z0-9_]+)"?/u.exec(line)?.[1] ??
                  'unclassified',
              ),
          ),
        ];
        const tokenRepresentations = credentialRepresentations();
        report.checks[`${label}DatabaseLeak`] = {
          tables,
          credentialToken: containsPrivateValue(dump, tokenRepresentations),
          challenge: containsPrivateValue(dump, challengeRepresentations),
        };
      }
      // Aggregate failing assertions to complete the matrix, then exit nonzero.
      // A detected leak is never converted to an approved privacy result.
      try {
        assert.deepEqual(hit, {
          databaseAndLogicalBackup: false,
          stdout: false,
          stateAndSnapshotBackup: false,
        });
      } catch {
        report.privacyFailures.push(label);
      }
    };
    const post = (mode, auth = true, actor = 'synthetic-a', generation = 1) =>
      http(n8n, '/webhook/wap-e01-privacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { 'X-Wap-Probe-Token': token } : {}),
        },
        body: { mode, actor, generation },
      });
    step('n8n-negative-guards');
    assert.equal((await post('qr', false)).status, 403);
    for (const [actor, generation] of [
      ['synthetic-other', 1],
      ['synthetic-a', 0],
    ]) {
      await post('qr', true, actor, generation);
      assert.equal((await fixtureAudit()).calls.qr, undefined);
    }
    report.checks.n8nGuard =
      'unauthenticated, non-allowlisted and stale synthetic generation denied before fixture';
    const numericCount = await executionCount();
    const numericCode = Number(
      (await fixtureAudit()).canaries.incoming.pairingCode,
    );
    const numericGeneration = await post(
      'qr',
      true,
      'synthetic-a',
      numericCode,
    );
    assert.equal(numericGeneration.status, 403);
    assert.equal(await executionCount(), numericCount);
    report.checks.numericChallengeCannotEnterGenerationMetadata = true;
    const malformedCount = await executionCount();
    const malformed = await http(n8n, '/webhook/wap-e01-privacy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wap-Probe-Token': token,
      },
      rawBody: '{"unexpected":"' + token + '"',
    });
    report.checks.malformedIngressStatus = malformed.status;
    report.checks.malformedIngressFixedDenial =
      malformed.body.includes('WAP_INGRESS_DENIED');
    // n8n 2.38.7 rejects malformed JSON with 422 before invoking the Webhook.
    assert.equal(malformed.status, 422);
    assert.equal(scan(Buffer.from(malformed.body)), false);
    assert.equal(await executionCount(), malformedCount);
    report.checks.malformedIngressRejectedBeforeWrite = true;
    step('unsafe-settings-guard');
    const unsafeModel = structuredClone(model);
    unsafeModel.name = 'WAP-E01 isolated unsafe settings';
    unsafeModel.nodes.find((node) => node.name === 'Trigger').parameters.path =
      'wap-e01-unsafe';
    unsafeModel.settings.saveDataSuccessExecution = 'all';
    const unsafeCountBefore = await executionCount();
    const workflowCountBefore = await workflowCount();
    const unsafeResponse = await rawApi('/workflows', 'POST', unsafeModel);
    assert.equal(unsafeResponse.status, 400);
    assert.ok(unsafeResponse.body.includes('WAP_WORKFLOW_WRITE_DENIED'));
    assert.equal(await executionCount(), unsafeCountBefore);
    assert.equal(await workflowCount(), workflowCountBefore);
    report.checks.unsafeSettingsRejectedBeforeWrite = true;
    const pinData = {
      Trigger: [{ json: { code: (await fixtureAudit()).canaries.qr.code } }],
    };
    const pinCreate = await rawApi('/workflows', 'POST', {
      ...model,
      name: 'WAP-E01 isolated pinned challenge',
      pinData,
    });
    assert.equal(pinCreate.status, 400);
    assert.ok(pinCreate.body.includes('WAP_WORKFLOW_WRITE_DENIED'));
    assert.equal(await workflowCount(), workflowCountBefore);
    const pinUpdate = await rawApi(`/workflows/${workflow.id}`, 'PATCH', {
      pinData,
    });
    assert.equal(pinUpdate.status, 400);
    assert.ok(pinUpdate.body.includes('WAP_WORKFLOW_WRITE_DENIED'));
    assert.deepEqual(
      (await api(`/workflows/${workflow.id}`)).pinData ?? {},
      {},
    );
    report.checks.pinDataWriteRejectedBeforePersistence = true;
    await audit('pinDataDenied');
    step('n8n-success-error');
    for (const mode of ['qr', 'code', 'provider-qr', 'provider-code']) {
      const response = await post(mode);
      report.checks.roundTrip ??= {};
      report.checks.roundTrip[mode] = {
        status: response.status,
        noStore: response.cache === 'no-store',
        fixtureCalls: (await fixtureAudit()).calls[mode] ?? 0,
      };
      assert.equal(response.status, 200);
      assert.equal(response.cache, 'no-store');
      assert.deepEqual(
        JSON.parse(response.body),
        (await fixtureAudit()).canaries[mode],
      );
      await audit(mode);
    }
    for (const [mode, name] of [
      ['provider-qr', 'wap-synthetic-qr'],
      ['provider-code', 'wap-synthetic-code'],
    ]) {
      const body = (await fixtureAudit()).canaries[mode];
      const observed = report.checks.provider[name];
      observed.connect = 200;
      observed.challengeQr =
        typeof body.base64 === 'string' &&
        body.base64.startsWith('data:image/png;base64,');
      observed.challengeCode =
        typeof body.pairingCode === 'string' && body.pairingCode.length > 0;
      observed.providerError = body.error === true;
      observed.state =
        JSON.parse(
          (await providerHttp(`/instance/connectionState/${name}`)).body,
        ).instance?.state ?? 'unknown';
      observed.logout = (
        await providerHttp(`/instance/logout/${name}`, 'DELETE')
      ).status;
      // Each instance requests one modality; code mode need not also return QR.
      if (
        mode === 'provider-code'
          ? !observed.challengeCode
          : !observed.challengeQr
      )
        report.blockers.push(
          `Provider challenge unavailable in ${name}; no connect retry`,
        );
    }
    const finalProviderLogs = await command(['logs', provider]);
    assert.equal(scan(finalProviderLogs), false);
    report.checks.providerLogs =
      'no actual QR/code or synthetic canary in stdout';
    const failure = await post('failure');
    assert.equal(failure.status, 500);
    assert.equal((await fixtureAudit()).calls.failure, 1);
    await audit('errorAfterChallenge');
    step('generation-source-ingress');
    const countBeforeGeneration = await executionCount();
    const driverBytes = await command(
      [
        'exec',
        '-i',
        provider,
        'node',
        '/probe/ops/evolution/wap-generation-rehearsal.mjs',
        '--isolated-synthetic',
      ],
      JSON.stringify({
        bindings: generationBindings.slice(0, 3),
        retryReplacementBinding: generationBindings[3],
        transportToken: generationTransportToken,
        fixtureToken: token,
        fixtureUrl: 'http://wap-provider-fixture:8080',
        n8nUrl: 'http://wap-n8n:5678/webhook/wap-e01-generation',
      }),
    );
    await refreshCanaries();
    assert.equal(scan(driverBytes), false);
    const generationProof = JSON.parse(driverBytes.toString());
    for (const check of [
      'oldQueuedGenerationRejected',
      'currentGenerationAccepted',
      'replayPreservesSource',
      'otherLineAccepted',
      'crossLineTokenRejected',
      'retryAfterRevocationRejected',
      'replacementGenerationAccepted',
      'lifecycleEventsRejectedWithoutUnhandledRejection',
      'pairingCodeExcludedBeforeCredentialSerialization',
    ])
      assert.equal(generationProof[check], true);
    assert.equal(await executionCount(), countBeforeGeneration + 4);
    report.checks.generationSource = generationProof;
    const a2 = generationBindings[3];
    const generationCount = await executionCount();
    for (const [source, instance, secret] of [
      [{ ...a2.source, generation: 999 }, a2.instance, a2.token],
      [a2.source, generationBindings[2].instance, a2.token],
      [a2.source, a2.instance, providerApiKey],
      [a2.source, a2.instance, null],
    ]) {
      const rejected = await http(n8n, '/webhook/wap-e01-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Silmer-Evolution-Token': generationTransportToken,
          ...(secret ? { 'X-Silmer-Wap-Generation-Token': secret } : {}),
        },
        body: {
          event: 'connection.update',
          instance,
          source,
          data: { state: 'connecting' },
        },
      });
      assert.equal(rejected.status, 403);
    }
    assert.equal(await executionCount(), generationCount);
    report.checks.generationAdversarialBeforeWrite = true;
    await audit('generationIngress');
    step('n8n-in-progress');
    // Attach rejection handling immediately so a Docker failure during cleanup
    // cannot terminate the process before the remaining owned resources are removed.
    const pending = post('progress').catch(() => ({ status: 0 }));
    await wait(
      async () => (await fixtureAudit()).pending === 1,
      'WAP_PROGRESS_NOT_OBSERVED',
    );
    await audit('inProgress');
    await fixtureHttp('/release');
    assert.equal((await pending).status, 200);

    step('n8n-manual');
    const manual = await api(
      '/workflows',
      'POST',
      createPairingPrivacyProbe({
        enabled: true,
        allowlist: ['synthetic-a'],
        credentialId: credential.id,
        manual: true,
      }),
    );
    const execution = await api(`/workflows/${manual.id}/run`, 'POST', {
      triggerToStartFrom: { name: 'Trigger' },
    });
    report.checks.manualDispatched = Boolean(execution?.executionId);
    assert.ok(execution.executionId);
    await wait(
      async () => (await fixtureAudit()).calls.manual === 1,
      'WAP_MANUAL_NOT_EXECUTED',
    );
    await wait(async () => {
      const modes = (
        await command([
          'exec',
          db,
          'psql',
          '-U',
          'silmer_evolution',
          '-d',
          'n8n_wap_synthetic',
          '-Atc',
          'SELECT mode || chr(58) || status FROM execution_entity ORDER BY id',
        ])
      ).toString();
      // With save*=false, rows can retain initial status=running after soft delete.
      // Require the runtime's success event, not that stale database status.
      report.checks.initialExecutionModes = modes.trim().split('\n');
      report.checks.manualRuntimeSuccess = JSON.parse(
        (
          await command(
            ['exec', '-i', n8n, 'node', '-e', manualFinished],
            JSON.stringify({ id: execution.executionId }),
          )
        ).toString(),
      );
      return report.checks.manualRuntimeSuccess === true;
    }, 'WAP_MANUAL_NOT_SUCCEEDED');
    await audit('manual');
    const partialCount = await executionCount();
    const manualCalls = (await fixtureAudit()).calls.manual;
    const partial = await http(n8n, `/rest/workflows/${manual.id}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'http://localhost:5678',
      },
      body: {
        triggerToStartFrom: { name: 'Trigger' },
        runData: {
          Trigger: [{ data: { main: [[{ json: { private: token } }]] } }],
        },
      },
    });
    assert.equal(partial.status, 400);
    assert.ok(partial.body.includes('WAP_MANUAL_REQUEST_DENIED'));
    assert.equal(await executionCount(), partialCount);
    assert.equal((await fixtureAudit()).calls.manual, manualCalls);
    report.checks.manualPartialRejectedBeforeEffect = true;
    await audit('manualPartialDenied');
    const exported = await api(`/workflows/${workflow.id}`);
    const exportedManual = await api(`/workflows/${manual.id}`);
    for (const saved of [exported, exportedManual]) {
      assert.deepEqual(saved.pinData ?? {}, {});
      assert.equal(saved.settings.saveManualExecutions, false);
      assert.equal(saved.settings.saveExecutionProgress, false);
      assert.equal(saved.settings.saveDataErrorExecution, 'none');
      assert.equal(saved.settings.saveDataSuccessExecution, 'none');
      assert.equal(saved.settings.errorWorkflow, undefined);
    }
    report.checks.pinDataAndErrorWorkflow = 'empty, no error workflow';
    step('n8n-stopped-snapshot');
    await command(['stop', n8n]);
    step('n8n-default-off');
    const n8nOff = `${prefix}-n8n-off`;
    await run(n8nOff, [...n8nBaseArgs, n8nImage]);
    await wait(
      async () => (await http(n8nOff, '/healthz/readiness')).status === 200,
      'WAP_N8N_OFF_NOT_READY',
    );
    await wait(async () => {
      const denied = await http(n8nOff, '/webhook/wap-e01-privacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wap-Probe-Token': token,
        },
        body: { actor: 'synthetic-other', generation: 1, mode: 'qr' },
      });
      return denied.status === 403 && denied.body === 'WAP_INGRESS_DENIED';
    }, 'WAP_N8N_OFF_ROUTE_NOT_READY');
    const offCount = await executionCount();
    const off = await http(n8nOff, '/webhook/wap-e01-privacy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wap-Probe-Token': token,
      },
      body: { actor: 'synthetic-a', generation: 1, mode: 'qr' },
    });
    assert.equal(off.status, 403);
    assert.equal(off.body, 'WAP_INGRESS_DENIED');
    assert.equal(await executionCount(), offCount);
    report.checks.defaultOffRejectsBeforePersistence = true;
    const offLogsLeak = scan(await command(['logs', n8nOff]));
    report.checks.defaultOffLogsLeak = offLogsLeak;
    assert.equal(offLogsLeak, false);
    await command(['stop', n8nOff]);
    const stateReader = `${prefix}-state-reader`;
    containers.push(stateReader);
    const snapshot = await command([
      'run',
      '--rm',
      '--name',
      stateReader,
      '--label',
      `silmer.wap-spike=${suffix}`,
      '--network',
      'none',
      '-v',
      `${n8nVolume}:/state:ro`,
      '--entrypoint',
      'tar',
      NODE,
      '-cf',
      '-',
      '-C',
      '/state',
      '.',
    ]);
    const stoppedStateLeak = scan(snapshot);
    await command(['stop', provider]);
    await command(['stop', db]);
    const databaseReader = `${prefix}-database-reader`;
    containers.push(databaseReader);
    const physical = await command([
      'run',
      '--rm',
      '--name',
      databaseReader,
      '--label',
      `silmer.wap-spike=${suffix}`,
      '--network',
      'none',
      '-v',
      `${databaseVolume}:/database:ro`,
      '--entrypoint',
      'tar',
      NODE,
      '-cf',
      '-',
      '-C',
      '/database',
      '.',
    ]);
    const physicalDatabaseLeak = scan(physical);
    report.checks.stoppedStateAndPhysicalDatabase = {
      stoppedStateLeak,
      physicalDatabaseLeak,
    };
    if (physicalDatabaseLeak)
      report.checks.physicalHitFiles = classifyPrivateTar(
        physical,
        privateGroups,
      );
    try {
      assert.equal(stoppedStateLeak, false);
      assert.equal(physicalDatabaseLeak, false);
    } catch {
      report.privacyFailures.push('stoppedStateAndPhysicalDatabase');
    }
    if (report.privacyFailures.length)
      throw new Error('WAP_PRIVACY_PERSISTENCE_DETECTED');
    report.technicalGate = 'passed';
  } catch (error) {
    // Assertions can contain a secret in their diagnostic message. Do not serialize them.
    report.failure = {
      stage,
      code:
        error?.code === 'ERR_ASSERTION'
          ? 'WAP_ASSERTION_FAILED'
          : /^WAP_[A-Z0-9_]+$/.test(error?.message ?? '')
            ? error.message
            : 'WAP_SPIKE_FAILED',
    };
    report.technicalGate = 'failed';
  } finally {
    step('cleanup');
    const cleanupErrors = [];
    // A CLI timeout can happen after resource creation. Inspect only our names,
    // and require the per-run label before any removal; never prune shared Docker.
    const owned = async (type, name) => {
      const template =
        type === 'container' || type === 'image'
          ? '{{index .Config.Labels "silmer.wap-spike"}}'
          : '{{index .Labels "silmer.wap-spike"}}';
      try {
        const label = (
          await command([type, 'inspect', name, '--format', template])
        )
          .toString()
          .trim();
        if (label !== suffix) throw new Error('WAP_CLEANUP_OWNER_MISMATCH');
        return true;
      } catch (error) {
        if (error.message === 'WAP_CLEANUP_OWNER_MISMATCH') throw error;
        // A failed inspect is not proof of absence. Verify the name explicitly.
        const list = (
          await command([
            type,
            'ls',
            ...(type === 'container' ? ['-a'] : []),
            '-q',
            '--filter',
            type === 'image' ? `reference=${name}` : `name=^${name}$`,
          ])
        )
          .toString()
          .trim();
        if (list) throw new Error('WAP_CLEANUP_UNVERIFIED');
        return false;
      }
    };
    for (const name of containers.reverse()) {
      try {
        if (await owned('container', name))
          await command(['rm', '--force', '--volumes', name]);
      } catch {
        cleanupErrors.push('container');
      }
    }
    for (const name of volumes.reverse()) {
      try {
        if (await owned('volume', name)) await command(['volume', 'rm', name]);
      } catch {
        cleanupErrors.push('volume');
      }
    }
    if (networkCreated) {
      try {
        if (await owned('network', net)) await command(['network', 'rm', net]);
      } catch {
        cleanupErrors.push('network');
      }
    }
    if (imageCreated) {
      try {
        if (await owned('image', image)) await command(['image', 'rm', image]);
      } catch {
        cleanupErrors.push('image');
      }
    }
    if (n8nImageCreated) {
      try {
        if (await owned('image', n8nImage))
          await command(['image', 'rm', n8nImage]);
      } catch {
        cleanupErrors.push('n8n-image');
      }
    }
    report.cleanup = cleanupErrors.length
      ? cleanupErrors
      : 'all dedicated resources removed';
    if (cleanupErrors.length)
      report.failure ??= { stage: 'cleanup', code: 'WAP_CLEANUP_FAILED' };
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  // Negative viability is a blocking result, never a successful production gate.
  return report.failure ? 1 : 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runProviderSpike()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write('WAP_SPIKE_REFUSED\n');
      process.exitCode = 1;
    });
}
