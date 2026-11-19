// WAP-E12. Builds the reviewable production set for personal WhatsApp lines
// from a fresh private export of the main workflow. Pure core plus a CLI that
// writes only outside the repository: outputs carry private line, instance and
// credential ids. Nothing here imports, activates or publishes a workflow.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sellerWhatsAppConfiguration } from '@crm-silmer/inbox-channels';
import { createWhatsAppControlClient } from '@crm-silmer/integration-reliability';
import { sellerWhatsAppSendConfiguration } from '@crm-silmer/n8n-integration';
import { createSellerWhatsAppRuntime } from '../../apps/api/src/seller-whatsapp-runtime.js';
import { sellerWhatsAppInboundSellers } from '../../apps/api/src/seller-whatsapp-first-send-runtime.js';
import {
  createWhatsAppControlWorkflows,
  INTERNAL_EVOLUTION_ORIGINS,
} from './whatsapp-control-workflows.mjs';
import {
  applyPersonalInbound,
  PERSONAL_EVENTS_PATH,
  PERSONAL_INBOUND_NAME,
} from './workflows/create-evolution-workflow.mjs';
import { applyObservedOutbound } from './workflows/create-seller-whatsapp-evolution-workflow.mjs';
import { configurePersonalSend } from './workflows/seller-whatsapp-send.mjs';

const load = createRequire(import.meta.url);
const ingress = load('./wap-ingress-runtime.cjs');
const evolutionControl = load('../evolution/wap-control-runtime.cjs');
const evolutionGeneration = load('../evolution/wap-generation-runtime.cjs');

export const MAIN_WORKFLOW_ID = 'k7tI6T4RhQPyJkn9';
const VALIDATE = 'Evolution - Validar origem (MVP)';
const EVENTS_WEBHOOK = 'WhatsApp - Receber eventos (MVP)';
const INBOUND = 'CRM - Registrar inbound (MVP)';
const ROUTER = 'Rotear conversa registrada (MVP)';
const CONTROL_PATH = 'silmer/seller-whatsapp/control';
const CHALLENGE_PATH = 'silmer/seller-whatsapp/challenge';
const INGRESS_VERIFY =
  '/api/v1/integrations/n8n/whatsapp-control/ingress/verify';
const CONTROL_VERIFY = '/api/v1/integrations/n8n/whatsapp-control/verify';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INSTANCE = /^wap_[a-f0-9]{32}$/u;
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const CREDENTIALS = /** @type {const} */ ([
  'controlWebhookBasic',
  'crmBasic',
  'evolutionApiHeader',
  'evolutionEventsHeader',
]);
const CONFIG_KEYS = [
  'lineIds',
  'instances',
  'crmBaseUrl',
  'evolutionBaseUrl',
  'n8nBaseUrl',
  'sellerWhatsAppWebhookUrl',
  'evolutionControlWebhookUrl',
  'credentials',
  'personalSendLineIds',
];
const PRIVACY = {
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};
// Placeholders the operator replaces; they pass the real ID validators as-is.
const SELLER_IDS_PLACEHOLDER = '["REPLACE_WITH_SELLER_ID"]';
const SECRETS = {
  api: [
    'N8N_COMMAND_CLIENT_ID',
    'N8N_COMMAND_CLIENT_SECRET',
    'CONTACT_IDENTITY_ENVELOPE_KEY',
    'CONTACT_IDENTITY_LOOKUP_KEY',
    'SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST',
  ],
  worker: [
    'N8N_COMMAND_CLIENT_ID',
    'N8N_COMMAND_CLIENT_SECRET',
    'CONTACT_IDENTITY_ENVELOPE_KEY',
    'CONTACT_IDENTITY_LOOKUP_KEY',
    'SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST',
  ],
  n8n: ['SILMER_WAP_INGRESS_VERIFY_BASIC'],
  evolution: ['AUTHENTICATION_API_KEY'],
};
// Synthetic stand-ins used only to run the real validators; never emitted.
const SYNTHETIC_SECRETS = {
  N8N_COMMAND_CLIENT_ID: 'synthetic-build-client',
  N8N_COMMAND_CLIENT_SECRET: 's'.repeat(40),
  CONTACT_IDENTITY_ENVELOPE_KEY: Buffer.alloc(32, 1).toString('base64'),
  CONTACT_IDENTITY_LOOKUP_KEY: Buffer.alloc(32, 2).toString('base64'),
  SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST: 'a'.repeat(64),
  SILMER_WAP_INGRESS_VERIFY_BASIC: 'Basic c3ludGhldGljOmJ1aWxk',
  AUTHENTICATION_API_KEY: 'k'.repeat(40),
};

/** @param {string} code @returns {never} */
function refuse(code) {
  throw new Error(code);
}
/** @param {any} value */
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Same algorithm as production-reference.json. @param {any} value */
export function stableJson(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
/** @param {string|Buffer} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} raw @param {readonly string[]} [internal] */
function origin(raw, internal = []) {
  let url;
  try {
    url = new URL(/** @type {string} */ (raw));
  } catch {
    refuse('WAP_BUILD_CONFIG_INVALID');
  }
  if (
    typeof raw !== 'string' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && internal.includes(url.origin))) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    refuse('WAP_BUILD_CONFIG_INVALID');
  return url.origin;
}

/** @param {any} config */
function readConfig(config) {
  if (
    !plain(config) ||
    Object.keys(config).some((k) => !CONFIG_KEYS.includes(k))
  )
    refuse('WAP_BUILD_CONFIG_INVALID');
  const ids = (
    /** @type {unknown} */ list,
    /** @type {RegExp} */ pattern,
    empty = false,
  ) =>
    Array.isArray(list) &&
    (empty || list.length > 0) &&
    list.every((id) => typeof id === 'string' && pattern.test(id)) &&
    new Set(list).size === list.length;
  if (!ids(config.lineIds, UUID)) refuse('WAP_BUILD_LINE_INVALID');
  if (!ids(config.instances, INSTANCE)) refuse('WAP_BUILD_INSTANCE_INVALID');
  if (
    !ids(config.personalSendLineIds, UUID, true) ||
    config.personalSendLineIds.some(
      (/** @type {string} */ id) => !config.lineIds.includes(id),
    )
  )
    refuse('WAP_BUILD_LINE_INVALID');
  const crm = origin(config.crmBaseUrl);
  const n8n = origin(config.n8nBaseUrl);
  const evolution = origin(config.evolutionBaseUrl, INTERNAL_EVOLUTION_ORIGINS);
  if (!plain(config.credentials)) refuse('WAP_BUILD_CONFIG_INVALID');
  const credentials =
    /** @type {Record<typeof CREDENTIALS[number],{id:string,name:string}>} */ ({});
  for (const key of CREDENTIALS) {
    const value = config.credentials[key];
    if (
      !plain(value) ||
      Object.keys(value).sort().join(',') !== 'id,name' ||
      typeof value.id !== 'string' ||
      !CREDENTIAL_ID.test(value.id) ||
      typeof value.name !== 'string' ||
      !/^[^\r\n]{1,128}$/u.test(value.name)
    )
      refuse('WAP_BUILD_CONFIG_INVALID');
    credentials[key] = { id: value.id, name: value.name };
  }
  if (Object.keys(config.credentials).length !== CREDENTIALS.length)
    refuse('WAP_BUILD_CONFIG_INVALID');
  // API SELLER_WHATSAPP_WEBHOOK_URL and Evolution SILMER_WAP_CONTROL_WEBHOOK_URL
  // must name the one events webhook byte for byte; the CRM compares them.
  const webhookUrl = `${n8n}/webhook/${PERSONAL_EVENTS_PATH}`;
  if (
    config.sellerWhatsAppWebhookUrl !== webhookUrl ||
    config.evolutionControlWebhookUrl !== webhookUrl
  )
    refuse('WAP_BUILD_WEBHOOK_URL_MISMATCH');
  return {
    lineIds: [...config.lineIds],
    instances: [...config.instances],
    personalSendLineIds: [...config.personalSendLineIds],
    crm,
    n8n,
    evolution,
    credentials,
    webhookUrl,
  };
}

/** @param {any} main */
function readMain(main) {
  if (
    !plain(main) ||
    !Array.isArray(main.nodes) ||
    !plain(main.connections) ||
    main.nodes.some(
      (/** @type {any} */ n) => !plain(n) || typeof n.name !== 'string',
    )
  )
    refuse('WAP_BUILD_MAIN_INVALID');
  if (main.id !== MAIN_WORKFLOW_ID) refuse('WAP_BUILD_MAIN_ID_MISMATCH');
  const count = (/** @type {(n:any)=>boolean} */ match) =>
    main.nodes.filter(match).length;
  if (
    count((n) => n.name === VALIDATE) !== 1 ||
    count(
      (n) => n.name === EVENTS_WEBHOOK && n.type === 'n8n-nodes-base.webhook',
    ) !== 1 ||
    count((n) => /^(?:WAHA|WPPConnect) - /u.test(n.name)) !== 0
  )
    refuse('WAP_BUILD_MAIN_NOT_ADAPTED');
  if (count((n) => n.name.includes('(WAP)')) !== 0)
    refuse('WAP_BUILD_MAIN_ALREADY_WAP');
}

/** Every node a workflow can execute from `start`, over all connection kinds,
 * plus sub-nodes (models, parsers) attached to a reached node.
 * @param {any} workflow @param {string} start */
export function reachableNodes(workflow, start) {
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const name = /** @type {string} */ (queue.shift());
    for (const outputs of Object.values(workflow.connections[name] ?? {}))
      for (const edges of /** @type {any[]} */ (outputs))
        for (const edge of edges ?? [])
          if (!reached.has(edge.node)) {
            reached.add(edge.node);
            queue.push(edge.node);
          }
  }
  for (const [name, kinds] of Object.entries(workflow.connections))
    for (const [kind, outputs] of Object.entries(/** @type {any} */ (kinds)))
      if (
        kind !== 'main' &&
        /** @type {any[]} */ (outputs).some((edges) =>
          (edges ?? []).some((/** @type {any} */ e) => reached.has(e.node)),
        )
      )
        reached.add(name);
  return reached;
}

/** Names referenced through `$('Name')` in code and expressions.
 * @param {any} workflow */
export function nodeReferences(workflow) {
  const names = new Set();
  const text = JSON.stringify(workflow.nodes);
  for (const match of text.matchAll(/\$\(\\?(['"])(.+?)\\?\1\)/gu))
    names.add(match[2]);
  return names;
}

/** @param {any} workflow @param {(name:string)=>boolean} keep */
function prune(workflow, keep) {
  workflow.nodes = workflow.nodes.filter((/** @type {any} */ n) =>
    keep(n.name),
  );
  workflow.connections = Object.fromEntries(
    Object.entries(workflow.connections)
      .filter(([name]) => keep(name))
      .map(([name, kinds]) => [
        name,
        Object.fromEntries(
          Object.entries(/** @type {any} */ (kinds)).map(([kind, outputs]) => [
            kind,
            /** @type {any[]} */ (outputs).map((edges) =>
              (edges ?? []).filter((/** @type {any} */ e) => keep(e.node)),
            ),
          ]),
        ),
      ]),
  );
}

/** @param {any} main @param {ReturnType<typeof readConfig>} config */
function buildInbound(main, config) {
  const workflow = structuredClone(main);
  const original = new Set(
    workflow.nodes.map((/** @type {any} */ n) => n.name),
  );
  applyPersonalInbound(workflow, {
    config: {
      baseUrl: config.evolution,
      personalInbound: true,
      personalLineIds: config.lineIds,
    },
    webhookPath: PERSONAL_EVENTS_PATH,
  });
  const afterTriggers = new Set(
    workflow.nodes.map((/** @type {any} */ n) => n.name),
  );
  applyObservedOutbound(workflow, {
    personalLineIds: config.lineIds,
    baseUrl: config.evolution,
    crmBaseUrl: config.crm,
  });
  // Registered conversations never reach the bot, handoff or reply branches.
  for (const edges of workflow.connections[INBOUND]?.main ?? [])
    for (let index = edges.length - 1; index >= 0; index--)
      if (edges[index].node === ROUTER) edges.splice(index, 1);
  const reached = reachableNodes(workflow, EVENTS_WEBHOOK);
  const beforePrune = workflow.nodes.length;
  prune(workflow, (name) => reached.has(name));
  const removedTriggers = [...original].filter((n) => !afterTriggers.has(n));
  const added = workflow.nodes.filter(
    (/** @type {any} */ n) => !original.has(n.name),
  ).length;

  for (const node of workflow.nodes) {
    node.id = randomUUID();
    delete node.credentials;
    if (node.type === 'n8n-nodes-base.webhook') {
      node.webhookId = randomUUID();
      node.parameters = {
        httpMethod: 'POST',
        path: PERSONAL_EVENTS_PATH,
        authentication: 'headerAuth',
        responseMode: 'responseNode',
        options: {},
      };
      node.credentials = {
        httpHeaderAuth: config.credentials.evolutionEventsHeader,
      };
    } else delete node.webhookId;
    if (node.type !== 'n8n-nodes-base.httpRequest') continue;
    const url = String(node.parameters?.url ?? '');
    if (
      node.parameters?.authentication !== 'genericCredentialType' ||
      url.includes('/message/')
    )
      refuse('WAP_BUILD_INBOUND_UNSAFE');
    if (node.parameters.genericAuthType === 'httpBasicAuth') {
      if (
        !url.includes(config.crm + '/') &&
        !url.includes(JSON.stringify(config.crm))
      )
        refuse('WAP_BUILD_CRM_ORIGIN_MISMATCH');
      node.credentials = { httpBasicAuth: config.credentials.crmBasic };
    } else if (node.parameters.genericAuthType === 'httpHeaderAuth') {
      if (!url.startsWith(`={{ "${config.evolution}/chat/`))
        refuse('WAP_BUILD_EVOLUTION_ORIGIN_MISMATCH');
      node.credentials = {
        httpHeaderAuth: config.credentials.evolutionApiHeader,
      };
    } else refuse('WAP_BUILD_INBOUND_UNSAFE');
  }
  const names = new Set(workflow.nodes.map((/** @type {any} */ n) => n.name));
  const serialized = JSON.stringify(workflow.nodes);
  if (
    workflow.nodes.filter(
      (/** @type {any} */ n) => n.type === 'n8n-nodes-base.webhook',
    ).length !== 1 ||
    workflow.nodes.some(
      (/** @type {any} */ n) =>
        n.type.startsWith('@n8n/n8n-nodes-langchain.') ||
        /Trigger$/u.test(n.type),
    ) ||
    !workflow.nodes.some(
      (/** @type {any} */ n) => n.type === 'n8n-nodes-base.respondToWebhook',
    ) ||
    serialized.includes('$env') ||
    [...nodeReferences(workflow)].some((name) => !names.has(name))
  )
    refuse('WAP_BUILD_INBOUND_UNSAFE');
  const {
    executionOrder = 'v1',
    timezone,
    binaryMode,
    executionTimeout,
  } = main.settings ?? {};
  return {
    workflow: {
      name: PERSONAL_INBOUND_NAME,
      active: false,
      nodes: workflow.nodes,
      connections: workflow.connections,
      pinData: {},
      settings: {
        executionOrder,
        ...(timezone === undefined ? {} : { timezone }),
        ...(binaryMode === undefined ? {} : { binaryMode }),
        ...(executionTimeout === undefined ? {} : { executionTimeout }),
        ...PRIVACY,
      },
    },
    counts: {
      kept: workflow.nodes.length,
      added,
      removed: {
        triggersAndOtherWebhooks: removedTriggers.length,
        unreachable: beforePrune - workflow.nodes.length,
      },
    },
  };
}

/** @param {any} main @param {any} candidate */
function nodeDiff(main, candidate) {
  const before = new Map(main.nodes.map((/** @type {any} */ n) => [n.name, n]));
  const after = new Map(
    candidate.nodes.map((/** @type {any} */ n) => [n.name, n]),
  );
  const modified = [];
  for (const [name, node] of before) {
    const next = after.get(name);
    if (!next || stableJson(node) === stableJson(next)) continue;
    const keys = new Set([
      ...Object.keys(node.parameters ?? {}),
      ...Object.keys(next.parameters ?? {}),
    ]);
    modified.push({
      name,
      parameters: [...keys]
        .filter(
          (key) =>
            stableJson(node.parameters?.[key]) !==
            stableJson(next.parameters?.[key]),
        )
        .sort(),
    });
  }
  return {
    added: [...after.keys()].filter((name) => !before.has(name)),
    removed: [...before.keys()].filter((name) => !after.has(name)),
    modified,
    unchanged: [...before.keys()].filter(
      (name) =>
        after.has(name) &&
        stableJson(before.get(name)) === stableJson(after.get(name)),
    ).length,
    connectionsChanged:
      stableJson(main.connections) !== stableJson(candidate.connections),
  };
}

/** Proposed variables, checked by the real loaders of each service.
 * @param {ReturnType<typeof readConfig>} config @param {Record<string,any>} workflows */
function environment(config, workflows) {
  const send = config.personalSendLineIds.length > 0;
  const api = {
    SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
    SELLER_WHATSAPP_SELLER_IDS: SELLER_IDS_PLACEHOLDER,
    SELLER_WHATSAPP_WEBHOOK_URL: config.webhookUrl,
    N8N_WAP_CONTROL_URL: `${config.n8n}/webhook/${CONTROL_PATH}`,
    N8N_WAP_CHALLENGE_URL: `${config.n8n}/webhook/${CHALLENGE_PATH}`,
    SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
    SELLER_WHATSAPP_INBOUND_SELLER_IDS: SELLER_IDS_PLACEHOLDER,
    SELLER_WHATSAPP_SEND_ENABLED: send ? 'true' : 'false',
    SELLER_WHATSAPP_SEND_SELLER_IDS: send ? SELLER_IDS_PLACEHOLDER : '[]',
  };
  const worker = {
    SELLER_WHATSAPP_CONTROL_ENABLED: 'true',
    SELLER_WHATSAPP_SELLER_IDS: SELLER_IDS_PLACEHOLDER,
    N8N_WAP_CONTROL_URL: api.N8N_WAP_CONTROL_URL,
    N8N_WAP_CHALLENGE_URL: api.N8N_WAP_CHALLENGE_URL,
  };
  const n8n = {
    SILMER_WAP_INGRESS_ENABLED: 'true',
    SILMER_WAP_INGRESS_PATHS: JSON.stringify({
      [CONTROL_PATH]: 'control',
      [CHALLENGE_PATH]: 'challenge',
      [PERSONAL_EVENTS_PATH]: 'event',
    }),
    SILMER_WAP_INGRESS_INSTANCES: config.instances.join(','),
    SILMER_WAP_INGRESS_VERIFY_URL: config.crm + INGRESS_VERIFY,
    SILMER_WAP_CONTROL_VERIFY_URL: config.crm + CONTROL_VERIFY,
  };
  const evolution = {
    SILMER_WAP_CONTROL_ENABLED: 'true',
    SILMER_WAP_GENERATION_ENABLED: 'true',
    SILMER_WAP_GENERATION_INSTANCES: config.instances.join(','),
    SILMER_WAP_CONTROL_WEBHOOK_URL: config.webhookUrl,
  };
  try {
    const apiEnv = { ...api, ...SYNTHETIC_SECRETS };
    createSellerWhatsAppRuntime(null, {
      environment: apiEnv,
      access: {},
      repository: {},
    });
    if (!sellerWhatsAppInboundSellers(apiEnv).size) refuse('');
    if (sellerWhatsAppSendConfiguration(apiEnv).size !== (send ? 1 : 0))
      refuse('');
    const workerEnv = { ...worker, ...SYNTHETIC_SECRETS };
    if (!sellerWhatsAppConfiguration(workerEnv).enabled) refuse('');
    createWhatsAppControlClient({
      enabled: true,
      allowlist: [],
      controlEndpoint: workerEnv.N8N_WAP_CONTROL_URL,
      challengeEndpoint: workerEnv.N8N_WAP_CHALLENGE_URL,
      clientId: workerEnv.N8N_COMMAND_CLIENT_ID,
      clientSecret: workerEnv.N8N_COMMAND_CLIENT_SECRET,
    });
    const evolutionEnv = { ...evolution, ...SYNTHETIC_SECRETS };
    const control = evolutionControl.configuration(evolutionEnv);
    if (
      control.enabled !== true ||
      control.webhook !== config.webhookUrl ||
      control.instances.join(',') !== config.instances.join(',')
    )
      refuse('');
    evolutionGeneration.fromEnvironment(evolutionEnv);
    const n8nEnv = { ...n8n, ...SYNTHETIC_SECRETS };
    for (const workflow of Object.values(workflows))
      ingress.guardWorkflowMutation(null, workflow, n8nEnv);
  } catch {
    refuse('WAP_BUILD_ENVIRONMENT_INVALID');
  }
  return {
    api,
    worker,
    n8n,
    evolution,
    secretsUnchanged: SECRETS,
    placeholders: { SELLER_IDS: SELLER_IDS_PLACEHOLDER },
  };
}

/** Runs the n8n verifier probes for the proposed ingress env. Async because
 * protectIngress is; it never leaves the process (fetch is a stub).
 * @param {Record<string,string>} n8nEnv @param {string[]} instances */
export async function probeIngressEnvironment(n8nEnv, instances) {
  const env = { ...n8nEnv, ...SYNTHETIC_SECRETS };
  const source = {
    bindingId: randomUUID(),
    lineId: randomUUID(),
    accountId: randomUUID(),
    generation: 1,
  };
  const calls = /** @type {string[]} */ ([]);
  /** @param {string} path @param {any} body @param {any} answer */
  const run = async (path, body, answer) => {
    const parameters = {
      path,
      authentication:
        path === PERSONAL_EVENTS_PATH ? 'headerAuth' : 'basicAuth',
      responseMode: 'responseNode',
      options: {},
    };
    const response = {
      status: 0,
      writeHead(/** @type {number} */ s) {
        this.status = s;
      },
      end() {},
    };
    const blocked = await ingress.protectIngress(
      {
        workflow: { settings: { ...PRIVACY }, pinData: {} },
        getNodeParameter: (/** @type {string} */ k, /** @type {any} */ d) =>
          /** @type {any} */ (parameters)[k] ?? d,
        getNode: () => ({ parameters }),
        getRequestObject: () => ({
          method: 'POST',
          contentType: 'application/json',
          headers: { 'x-silmer-wap-generation-token': 't'.repeat(40) },
          params: {},
          query: {},
          body,
        }),
        getResponseObject: () => response,
      },
      env,
      async (/** @type {string} */ url) => {
        calls.push(url);
        return {
          status: 200,
          body: (async function* () {
            yield Buffer.from(JSON.stringify(answer));
          })(),
        };
      },
    );
    return blocked === false;
  };
  const events = [];
  for (const instance of instances)
    events.push(
      await run(
        PERSONAL_EVENTS_PATH,
        {
          event: 'connection.update',
          instance,
          source,
          data: { state: 'open' },
        },
        { source, instance },
      ),
    );
  const envelope = {
    operationId: randomUUID(),
    lineId: randomUUID(),
    generation: 1,
    reference: randomUUID(),
    action: 'reconcile',
  };
  const control = await run(CONTROL_PATH, envelope, {
    kind: 'control',
    envelope,
  });
  return {
    events: events.every(Boolean) && events.length === instances.length,
    control,
    verifyUrls: [...new Set(calls)],
  };
}

/** Pure build. `main` is a fresh private export of the live main workflow.
 * @param {any} main @param {any} rawConfig */
export function buildWapProductionWorkflows(main, rawConfig) {
  readMain(main);
  const config = readConfig(rawConfig);
  const { control, challenge } = createWhatsAppControlWorkflows({
    enabled: true,
    allowlist: config.lineIds,
    crmBaseUrl: config.crm,
    evolutionBaseUrl: config.evolution,
    webhookCredentialId: config.credentials.controlWebhookBasic.id,
    crmCredentialId: config.credentials.crmBasic.id,
    evolutionCredentialId: config.credentials.evolutionApiHeader.id,
  });
  for (const workflow of [control, challenge])
    for (const node of workflow.nodes) {
      if (node.credentials?.httpBasicAuth)
        node.credentials.httpBasicAuth.name =
          node.type === 'n8n-nodes-base.webhook'
            ? config.credentials.controlWebhookBasic.name
            : config.credentials.crmBasic.name;
      if (node.credentials?.httpHeaderAuth)
        node.credentials.httpHeaderAuth.name =
          config.credentials.evolutionApiHeader.name;
    }
  const inbound = buildInbound(main, config);
  const send = configurePersonalSend(
    structuredClone(main),
    config.personalSendLineIds,
  );
  delete send.versionId;
  delete send.activeVersionId;
  delete send.activeVersion;
  send.active = false;
  send.pinData = {};
  const workflows = {
    control,
    challenge,
    inbound: inbound.workflow,
    'main-personal-send': send,
  };
  const scoped = { control, challenge, inbound: inbound.workflow };
  const summary = {
    schemaVersion: 1,
    task: 'WAP-E12',
    requirements: ['WAP-02', 'WAP-04', 'WAP-06', 'WAP-09', 'WAP-12'],
    fingerprintAlgorithm:
      'SHA-256 of JSON.stringify with object keys recursively sorted by String.localeCompare; arrays retain order',
    input: {
      nodeCount: main.nodes.length,
      fingerprints: {
        nodes: sha256(stableJson(main.nodes)),
        connections: sha256(stableJson(main.connections)),
        settings: sha256(stableJson(main.settings ?? {})),
      },
    },
    main: nodeDiff(main, send),
    inbound: inbound.counts,
    lines: config.lineIds.length,
    instances: config.instances.length,
    personalSendLines: config.personalSendLineIds.length,
    environment: environment(config, scoped),
    outputs: Object.fromEntries(
      Object.entries(workflows).map(([name, workflow]) => [
        name,
        {
          nodes: workflow.nodes.length,
          fingerprint: sha256(stableJson(workflow)),
        },
      ]),
    ),
  };
  return { ...workflows, summary };
}

/** @param {string} target @param {string} repository */
function insideRepository(target, repository) {
  const fold = (/** @type {string} */ p) =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const relative = path.relative(fold(repository), fold(target));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/** CLI core, exported for tests. Writes nothing unless every check passes.
 * @param {string[]} argv @param {{stdout?:(line:string)=>void}} [io] */
export async function runCli(argv, io = {}) {
  const [mainPath, configPath, outDir] = argv;
  if (!mainPath || !configPath || !outDir || argv.length !== 3)
    refuse('WAP_BUILD_USAGE');
  const repository = realpathSync(
    fileURLToPath(new URL('../../', import.meta.url)),
  );
  const target = path.resolve(outDir);
  const parent = realpathSync(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  if (insideRepository(resolved, repository))
    refuse('WAP_BUILD_OUTPUT_IN_REPO');
  const main = JSON.parse(readFileSync(mainPath, 'utf8'));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const built = buildWapProductionWorkflows(main, config);
  const probe = await probeIngressEnvironment(
    built.summary.environment.n8n,
    config.instances,
  );
  if (
    !probe.events ||
    !probe.control ||
    probe.verifyUrls.length !== 2 ||
    !probe.verifyUrls.includes(
      built.summary.environment.n8n.SILMER_WAP_INGRESS_VERIFY_URL,
    ) ||
    !probe.verifyUrls.includes(
      built.summary.environment.n8n.SILMER_WAP_CONTROL_VERIFY_URL,
    )
  )
    refuse('WAP_BUILD_ENVIRONMENT_INVALID');
  try {
    mkdirSync(resolved);
  } catch {
    refuse('WAP_BUILD_OUTPUT_EXISTS');
  }
  const files = /** @type {Record<string,string>} */ ({});
  for (const name of [
    'control',
    'challenge',
    'inbound',
    'main-personal-send',
    'summary',
  ]) {
    const content =
      JSON.stringify(/** @type {any} */ (built)[name], null, 2) + '\n';
    writeFileSync(path.join(resolved, `${name}.json`), content, { flag: 'wx' });
    files[name] = sha256(content);
  }
  const lines = [
    `main nodes=${main.nodes.length} sha256=${built.summary.input.fingerprints.nodes}`,
    `inbound kept=${built.summary.inbound.kept} added=${built.summary.inbound.added} removedTriggers=${built.summary.inbound.removed.triggersAndOtherWebhooks} removedUnreachable=${built.summary.inbound.removed.unreachable}`,
    `main-personal-send added=${built.summary.main.added.length} modified=${built.summary.main.modified.length} removed=${built.summary.main.removed.length}`,
    `lines=${built.summary.lines} instances=${built.summary.instances} personalSendLines=${built.summary.personalSendLines}`,
    ...Object.entries(files).map(
      ([name, hash]) => `${name}.json sha256=${hash}`,
    ),
  ];
  for (const line of lines) (io.stdout ?? console.log)(line);
  return files;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    // Fixed codes only: never echo inputs, paths, ids or causes.
    const code = /** @type {any} */ (error)?.message;
    console.error(
      /^(?:WAP_BUILD|EVOLUTION_SEND)_[A-Z_]+$/u.test(code)
        ? code
        : 'WAP_BUILD_FAILED',
    );
    process.exitCode = 1;
  }
}
