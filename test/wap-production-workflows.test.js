import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  buildWapProductionWorkflows,
  nodeReferences,
  probeIngressEnvironment,
  reachableNodes,
} from '../ops/n8n/build-wap-production-workflows.mjs';

const { guardWorkflowMutation } = createRequire(import.meta.url)(
  '../ops/n8n/wap-ingress-runtime.cjs',
);
const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'ops/n8n/build-wap-production-workflows.mjs');
const exported = JSON.parse(
  readFileSync(
    path.join(
      root,
      'ops/n8n/workflows/k7tI6T4RhQPyJkn9-published.sanitized.json',
    ),
    'utf8',
  ),
);
// The sanitized capture drops the id, credentials and webhookIds a fresh
// private export carries; restore synthetic ones so preservation is provable.
const main = () => {
  const workflow = structuredClone(exported);
  workflow.id = 'k7tI6T4RhQPyJkn9';
  workflow.versionId = 'synthetic-version';
  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.webhook')
      node.webhookId = `synthetic-hook-${node.id}`;
    if (node.parameters?.genericAuthType)
      node.credentials = {
        [node.parameters.genericAuthType]: {
          id: `synthetic-${node.parameters.genericAuthType}`,
          name: 'Synthetic',
        },
      };
  }
  return workflow;
};
const lineA = '11111111-1111-4111-8111-111111111111';
const lineB = '22222222-2222-4222-8222-222222222222';
const instances = [`wap_${'a'.repeat(32)}`, `wap_${'b'.repeat(32)}`];
const events =
  'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/events';
const config = () => ({
  lineIds: [lineA, lineB],
  instances: [...instances],
  crmBaseUrl: 'https://crm.invalid',
  evolutionBaseUrl: 'http://schedule_silmer-evolution:8080',
  n8nBaseUrl: 'https://n8n.synthetic.invalid',
  sellerWhatsAppWebhookUrl: events,
  evolutionControlWebhookUrl: events,
  credentials: {
    controlWebhookBasic: { id: 'cred-control-hook', name: 'Control hook' },
    crmBasic: { id: 'cred-crm-basic', name: 'CRM AUTOMATION_EXECUTOR' },
    evolutionApiHeader: { id: 'cred-evolution-api', name: 'Evolution API' },
    evolutionEventsHeader: {
      id: 'cred-evolution-events',
      name: 'Evolution events',
    },
  },
  personalSendLineIds: [lineA],
});
const built = buildWapProductionWorkflows(main(), config());
const proposedN8n = built.summary.environment.n8n;
const expectedWapNodes = [
  'Despacho pessoal de text? (WAP)',
  'CRM - Autorizar despacho de text (WAP)',
  'Validar despacho de text (WAP)',
  'Despacho pessoal de media? (WAP)',
  'CRM - Autorizar despacho de media (WAP)',
  'Validar despacho de media (WAP)',
];

test('WAP-E12: every output is inactive, unpinned and the WAP set keeps no execution data', () => {
  for (const name of ['control', 'challenge', 'inbound', 'main-personal-send'])
    assert.equal(/** @type {any} */ (built)[name].active, false, name);
  for (const name of ['control', 'challenge', 'inbound']) {
    const workflow = /** @type {any} */ (built)[name];
    assert.deepEqual(workflow.pinData, {});
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.equal(workflow.settings.saveExecutionProgress, false);
    assert.equal(workflow.settings.errorWorkflow, undefined);
    assert.equal(workflow.id, undefined);
    // Proposed env admits the reserved hooks; absent env refuses the write.
    assert.doesNotThrow(() =>
      guardWorkflowMutation(null, workflow, proposedN8n),
    );
    assert.throws(
      () => guardWorkflowMutation(null, workflow, {}),
      /WAP_INGRESS_DENIED/u,
    );
  }
});

test('WAP-E12: Guard admits only the configured lines and the Gateway stays internal', () => {
  for (const kind of /** @type {const} */ (['control', 'challenge'])) {
    const workflow = built[kind];
    const guard = workflow.nodes.find(
      (/** @type {any} */ n) => n.name === 'Guard',
    );
    const body = {
      operationId: randomUUID(),
      lineId: lineB,
      generation: 1,
      reference: randomUUID(),
      ...(kind === 'control'
        ? { action: 'connect' }
        : { challengeId: randomUUID(), mode: 'code' }),
    };
    const run = (/** @type {any} */ input) =>
      vm.runInNewContext(`(()=>{${guard.parameters.jsCode}})()`, {
        $json: { body: input },
      });
    assert.deepEqual(run(body).json, body);
    assert.throws(
      () => run({ ...body, lineId: randomUUID() }),
      /WAP_CONTROL_DENIED/u,
    );
    const gateway = workflow.nodes.find(
      (/** @type {any} */ n) => n.name === 'Gateway',
    );
    assert.equal(
      gateway.parameters.url,
      'http://schedule_silmer-evolution:8080/silmer/whatsapp-control/execute',
    );
    assert.deepEqual(gateway.credentials, {
      httpHeaderAuth: { id: 'cred-evolution-api', name: 'Evolution API' },
    });
    const trigger = workflow.nodes.find(
      (/** @type {any} */ n) => n.name === 'Trigger',
    );
    assert.equal(trigger.parameters.path, `silmer/seller-whatsapp/${kind}`);
    assert.deepEqual(trigger.credentials, {
      httpBasicAuth: { id: 'cred-control-hook', name: 'Control hook' },
    });
  }
});

test('WAP-E12: inbound is one authenticated hook with no bot, chat, error trigger or send path', () => {
  const inbound = built.inbound;
  const original = main();
  assert.equal(inbound.name, 'Silmer seller WhatsApp inbound');
  const hooks = inbound.nodes.filter(
    (/** @type {any} */ n) => n.type === 'n8n-nodes-base.webhook',
  );
  assert.equal(hooks.length, 1);
  assert.deepEqual(hooks[0].parameters, {
    httpMethod: 'POST',
    path: 'silmer/seller-whatsapp/events',
    authentication: 'headerAuth',
    responseMode: 'responseNode',
    options: {},
  });
  assert.deepEqual(hooks[0].credentials, {
    httpHeaderAuth: { id: 'cred-evolution-events', name: 'Evolution events' },
  });
  for (const node of inbound.nodes) {
    assert.equal(node.type.startsWith('@n8n/n8n-nodes-langchain.'), false);
    assert.equal(/Trigger$/u.test(node.type), false, node.type);
  }
  const reached = reachableNodes(inbound, hooks[0].name);
  assert.equal(reached.size, inbound.nodes.length);
  const reachedNodes = inbound.nodes.filter((/** @type {any} */ n) =>
    reached.has(n.name),
  );
  assert.ok(
    reachedNodes.some(
      (/** @type {any} */ n) => n.type === 'n8n-nodes-base.respondToWebhook',
    ),
  );
  const text = JSON.stringify(reachedNodes);
  assert.equal(text.includes('/message/send'), false);
  assert.equal(text.includes('$env'), false);
  for (const name of [
    'Rotear conversa registrada (MVP)',
    'Acompanhar intenção de compra? (OA)',
    'Atendente virtual Silmer (MVP)',
    'Painel - Receber comando (MVP)',
  ])
    assert.equal(reached.has(name), false, name);
  for (const name of [
    'CRM - Registrar inbound (MVP)',
    'CRM - Registrar status de entrega (MVP)',
    'CRM - Registrar saída observada (WAP)',
    'CRM - Anexar mídia observada (WAP)',
  ])
    assert.ok(reached.has(name), name);
  const names = new Set(inbound.nodes.map((/** @type {any} */ n) => n.name));
  const references = nodeReferences(inbound);
  assert.ok(references.size > 3);
  for (const name of references) assert.ok(names.has(name), name);
  for (const source of Object.keys(inbound.connections))
    assert.ok(names.has(source), source);
  const mainIds = new Set(original.nodes.map((/** @type {any} */ n) => n.id));
  const mainHooks = new Set(
    original.nodes.map((/** @type {any} */ n) => n.webhookId).filter(Boolean),
  );
  assert.equal(
    new Set(inbound.nodes.map((/** @type {any} */ n) => n.id)).size,
    inbound.nodes.length,
  );
  for (const node of inbound.nodes) {
    assert.equal(mainIds.has(node.id), false, node.name);
    if (node.webhookId) assert.equal(mainHooks.has(node.webhookId), false);
  }
  for (const node of inbound.nodes.filter(
    (/** @type {any} */ n) => n.type === 'n8n-nodes-base.httpRequest',
  ))
    assert.deepEqual(
      Object.values(node.credentials).map((c) => /** @type {any} */ (c).id),
      [
        node.parameters.genericAuthType === 'httpBasicAuth'
          ? 'cred-crm-basic'
          : 'cred-evolution-api',
      ],
      node.name,
    );
  assert.equal(built.summary.inbound.kept, inbound.nodes.length);
  assert.ok(built.summary.inbound.removed.unreachable > 0);
  assert.equal(built.summary.inbound.removed.triggersAndOtherWebhooks, 3);
});

test('WAP-E12: the main keeps every untouched node and gains exactly the dispatch gates', () => {
  const input = main();
  const send = built['main-personal-send'];
  assert.doesNotThrow(() => guardWorkflowMutation(null, send, {}));
  assert.equal(send.id, input.id);
  assert.equal(send.versionId, undefined);
  assert.deepEqual(send.settings, input.settings);
  assert.deepEqual(built.summary.main.added, expectedWapNodes);
  assert.deepEqual(built.summary.main.removed, []);
  const modified = new Set(
    built.summary.main.modified.map((/** @type {any} */ m) => m.name),
  );
  assert.ok(modified.has('Normalizar comando do painel (MVP)'));
  const after = new Map(send.nodes.map((/** @type {any} */ n) => [n.name, n]));
  for (const node of input.nodes) {
    const next = after.get(node.name);
    assert.ok(next, node.name);
    assert.equal(next.id, node.id);
    assert.deepEqual(next.credentials, node.credentials);
    assert.equal(next.webhookId, node.webhookId);
    if (!modified.has(node.name)) assert.deepEqual(next, node, node.name);
  }
  // A drifted anchor or a second run fails instead of patching twice.
  const drifted = main();
  const normalize = drifted.nodes.find(
    (/** @type {any} */ n) => n.name === 'Normalizar comando do painel (MVP)',
  );
  normalize.parameters.jsCode = normalize.parameters.jsCode.replace(
    'const siteChat = ',
    'const siteChatX = ',
  );
  assert.throws(
    () => buildWapProductionWorkflows(drifted, config()),
    /EVOLUTION_SEND_ANCHOR_INVALID/u,
  );
  const doubled = main();
  const bytes = doubled.nodes.find(
    (/** @type {any} */ n) =>
      n.name === 'Evolution - Preparar bytes humanos (MVP)',
  );
  bytes.parameters.jsCode += "\n// video: 'mp4'";
  assert.throws(
    () => buildWapProductionWorkflows(doubled, config()),
    /EVOLUTION_SEND_ANCHOR_INVALID/u,
  );
  assert.throws(
    () => buildWapProductionWorkflows(send, config()),
    /WAP_BUILD_MAIN_ALREADY_WAP/u,
  );
  const quiet = buildWapProductionWorkflows(main(), {
    ...config(),
    personalSendLineIds: [],
  });
  assert.deepEqual(quiet.summary.main.added, []);
  assert.equal(
    quiet.summary.environment.api.SELLER_WHATSAPP_SEND_ENABLED,
    'false',
  );
  assert.throws(
    () =>
      buildWapProductionWorkflows(quiet['main-personal-send'], {
        ...config(),
        personalSendLineIds: [],
      }),
    /EVOLUTION_SEND_ALREADY_CONFIGURED/u,
  );
});

test('WAP-E12: summary fingerprints the input and proposes env the real loaders accept', async () => {
  const reference = JSON.parse(
    readFileSync(
      path.join(root, 'ops/n8n/workflows/production-reference.json'),
      'utf8',
    ),
  );
  // Same algorithm as the SIL-36 reference: the untouched capture matches it.
  const capture = buildWapProductionWorkflows(
    { ...structuredClone(exported), id: 'k7tI6T4RhQPyJkn9' },
    config(),
  ).summary.input;
  assert.equal(capture.nodeCount, reference.nodeCount);
  for (const key of /** @type {const} */ (['nodes', 'connections', 'settings']))
    assert.equal(
      capture.fingerprints[key],
      reference.sanitizedFingerprints[key],
    );
  assert.notEqual(
    built.summary.input.fingerprints.nodes,
    reference.sanitizedFingerprints.nodes,
  );
  const environment = built.summary.environment;
  assert.equal(environment.api.SELLER_WHATSAPP_WEBHOOK_URL, events);
  assert.equal(environment.evolution.SILMER_WAP_CONTROL_WEBHOOK_URL, events);
  assert.equal(
    environment.n8n.SILMER_WAP_INGRESS_INSTANCES,
    instances.join(','),
  );
  assert.deepEqual(JSON.parse(environment.n8n.SILMER_WAP_INGRESS_PATHS), {
    'silmer/seller-whatsapp/control': 'control',
    'silmer/seller-whatsapp/challenge': 'challenge',
    'silmer/seller-whatsapp/events': 'event',
  });
  const text = JSON.stringify(built.summary);
  for (const secret of [
    'SILMER_WAP_INGRESS_VERIFY_BASIC":"',
    'AUTHENTICATION_API_KEY":"',
    'c3ludGhldGljOmJ1aWxk',
    'k'.repeat(40),
  ])
    assert.equal(text.includes(secret), false, secret);
  const probe = await probeIngressEnvironment(environment.n8n, instances);
  assert.equal(probe.events, true);
  assert.equal(probe.control, true);
  assert.deepEqual(probe.verifyUrls.sort(), [
    'https://crm.invalid/api/v1/integrations/n8n/whatsapp-control/ingress/verify',
    'https://crm.invalid/api/v1/integrations/n8n/whatsapp-control/verify',
  ]);
});

test('WAP-E12: the build refuses unsafe inputs before producing anything', () => {
  /** @param {any} workflow @param {any} options @param {RegExp} code */
  const refused = (workflow, options, code) =>
    assert.throws(() => buildWapProductionWorkflows(workflow, options), code);
  refused({ ...main(), id: 'other' }, config(), /WAP_BUILD_MAIN_ID_MISMATCH/u);
  const plain = main();
  plain.nodes = plain.nodes.filter(
    (/** @type {any} */ n) => n.name !== 'Evolution - Validar origem (MVP)',
  );
  refused(plain, config(), /WAP_BUILD_MAIN_NOT_ADAPTED/u);
  const wap = main();
  wap.nodes.push({ ...wap.nodes[0], name: 'Synthetic (WAP)' });
  refused(wap, config(), /WAP_BUILD_MAIN_ALREADY_WAP/u);
  for (const [patch, code] of /** @type {any[]} */ ([
    [{ lineIds: ['line-one'] }, /WAP_BUILD_LINE_INVALID/u],
    [{ lineIds: [] }, /WAP_BUILD_LINE_INVALID/u],
    [{ lineIds: [lineA, lineA] }, /WAP_BUILD_LINE_INVALID/u],
    [{ personalSendLineIds: [randomUUID()] }, /WAP_BUILD_LINE_INVALID/u],
    [{ instances: ['wap_synthetic'] }, /WAP_BUILD_INSTANCE_INVALID/u],
    [{ instances: [`wap_${'A'.repeat(32)}`] }, /WAP_BUILD_INSTANCE_INVALID/u],
    [{ crmBaseUrl: 'http://crm.invalid' }, /WAP_BUILD_CONFIG_INVALID/u],
    [{ crmBaseUrl: 'https://crm.invalid/x' }, /WAP_BUILD_CONFIG_INVALID/u],
    [
      { crmBaseUrl: 'http://schedule_silmer-evolution:8080' },
      /WAP_BUILD_CONFIG_INVALID/u,
    ],
    [
      { n8nBaseUrl: 'http://n8n.synthetic.invalid' },
      /WAP_BUILD_CONFIG_INVALID/u,
    ],
    [
      { evolutionBaseUrl: 'http://schedule_silmer-evolution:8081' },
      /WAP_BUILD_CONFIG_INVALID/u,
    ],
    [{ extra: true }, /WAP_BUILD_CONFIG_INVALID/u],
    [
      {
        credentials: {
          ...config().credentials,
          crmBasic: { id: 'bad id', name: 'x' },
        },
      },
      /WAP_BUILD_CONFIG_INVALID/u,
    ],
    [
      {
        sellerWhatsAppWebhookUrl:
          'https://n8n.synthetic.invalid/webhook/silmer/seller-whatsapp/messages',
      },
      /WAP_BUILD_WEBHOOK_URL_MISMATCH/u,
    ],
    [
      { evolutionControlWebhookUrl: `${events}/` },
      /WAP_BUILD_WEBHOOK_URL_MISMATCH/u,
    ],
    [
      {
        n8nBaseUrl: 'https://other.synthetic.invalid',
      },
      /WAP_BUILD_WEBHOOK_URL_MISMATCH/u,
    ],
  ]))
    refused(main(), { ...config(), ...patch }, code);
  const foreign = main();
  for (const node of foreign.nodes)
    if (node.name === 'CRM - Registrar inbound (MVP)')
      node.parameters.url = node.parameters.url.replace(
        'https://crm.invalid',
        'https://crm-other.invalid',
      );
  refused(foreign, config(), /WAP_BUILD_CRM_ORIGIN_MISMATCH/u);
});

test('WAP-E12: CLI writes only a fresh directory outside the repo and prints no ids', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'wap-build-'));
  try {
    const mainPath = path.join(base, 'main.json');
    const configPath = path.join(base, 'config.json');
    writeFileSync(mainPath, JSON.stringify(main()));
    writeFileSync(configPath, JSON.stringify(config()));
    /** @param {string[]} args */
    const cli = (args) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        cwd: root,
      });
    const out = path.join(base, 'out');
    const ok = cli([mainPath, configPath, out]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(readdirSync(out).sort(), [
      'challenge.json',
      'control.json',
      'inbound.json',
      'main-personal-send.json',
      'summary.json',
    ]);
    for (const secret of [
      lineA,
      lineB,
      ...instances,
      'cred-',
      'k7tI6T4RhQPyJkn9',
      'crm.invalid',
    ])
      assert.equal(ok.stdout.includes(secret), false, secret);
    assert.match(ok.stdout, /inbound\.json sha256=[a-f0-9]{64}/u);
    const inbound = JSON.parse(
      readFileSync(path.join(out, 'inbound.json'), 'utf8'),
    );
    assert.equal(inbound.name, 'Silmer seller WhatsApp inbound');

    const before = readFileSync(path.join(out, 'summary.json'), 'utf8');
    /** @param {string[]} args @param {string} code */
    const refused = (args, code) => {
      const result = cli(args);
      assert.equal(result.status, 1, code);
      assert.equal(result.stderr.trim(), code);
      assert.equal(result.stdout, '');
    };
    refused([mainPath, configPath, out], 'WAP_BUILD_OUTPUT_EXISTS');
    assert.equal(readFileSync(path.join(out, 'summary.json'), 'utf8'), before);
    const inside = path.join(root, `wap-build-refused-${process.pid}`);
    refused([mainPath, configPath, inside], 'WAP_BUILD_OUTPUT_IN_REPO');
    assert.equal(existsSync(inside), false);
    refused(
      [mainPath, configPath, path.join(root, 'ops', `x-${process.pid}`)],
      'WAP_BUILD_OUTPUT_IN_REPO',
    );
    refused([mainPath, configPath], 'WAP_BUILD_USAGE');
    const other = path.join(base, 'other.json');
    writeFileSync(other, JSON.stringify({ ...main(), id: 'other' }));
    refused(
      [other, configPath, path.join(base, 'o1')],
      'WAP_BUILD_MAIN_ID_MISMATCH',
    );
    const mismatch = path.join(base, 'mismatch.json');
    writeFileSync(
      mismatch,
      JSON.stringify({ ...config(), evolutionControlWebhookUrl: `${events}x` }),
    );
    refused(
      [mainPath, mismatch, path.join(base, 'o2')],
      'WAP_BUILD_WEBHOOK_URL_MISMATCH',
    );
    const badLine = path.join(base, 'bad-line.json');
    writeFileSync(badLine, JSON.stringify({ ...config(), lineIds: ['x'] }));
    refused(
      [mainPath, badLine, path.join(base, 'o3')],
      'WAP_BUILD_LINE_INVALID',
    );
    const badInstance = path.join(base, 'bad-instance.json');
    writeFileSync(
      badInstance,
      JSON.stringify({ ...config(), instances: ['silmer'] }),
    );
    refused(
      [mainPath, badInstance, path.join(base, 'o4')],
      'WAP_BUILD_INSTANCE_INVALID',
    );
    const insecure = path.join(base, 'insecure.json');
    writeFileSync(
      insecure,
      JSON.stringify({ ...config(), crmBaseUrl: 'http://crm.invalid' }),
    );
    refused(
      [mainPath, insecure, path.join(base, 'o5')],
      'WAP_BUILD_CONFIG_INVALID',
    );
    const twice = path.join(base, 'twice.json');
    writeFileSync(
      twice,
      readFileSync(path.join(out, 'main-personal-send.json')),
    );
    refused(
      [twice, configPath, path.join(base, 'o6')],
      'WAP_BUILD_MAIN_ALREADY_WAP',
    );
    for (const name of ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'])
      assert.equal(existsSync(path.join(base, name)), false, name);
    mkdirSync(path.join(base, 'empty'));
    refused(
      [mainPath, configPath, path.join(base, 'empty')],
      'WAP_BUILD_OUTPUT_EXISTS',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
