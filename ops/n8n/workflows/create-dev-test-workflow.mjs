import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';

export const DEV_WORKFLOW_ID = '0S5ZS1xeDCSoWovs';
export const DEV_WORKFLOW_NAME = 'DEV | Silmer | Fluxo completo sem WhatsApp';
export const DEV_WORKFLOW_VERSION = 'dev-mvp-simple-3';
export const LOCAL_WORKFLOW_NAME = 'LOCAL | Silmer | Fluxo completo sem WhatsApp';

const MAIN_WORKFLOW_ID = 'k7tI6T4RhQPyJkn9';
const MAIN_TRIGGER = 'WhatsApp - Receber eventos (MVP)';
const DEV_TRIGGER = 'DEV - Receber evento sintético (MVP)';
const NORMALIZE_EVENT = 'Normalizar evento WhatsApp (MVP)';
const AI_SEND = 'WhatsApp - Enviar resposta da IA (MVP)';
const DEV_AI_SEND = 'DEV - Simular envio da IA (MVP)';
const HUMAN_SEND = 'WhatsApp - Enviar texto humano (MVP)';
const DEV_HUMAN_SEND = 'DEV - Simular envio humano (MVP)';
const PANEL_TRIGGER = 'Painel - Receber comando (MVP)';
const CRM_TO_N8N_CREDENTIAL = 'Silmer CRM para n8n Basic DEV';
const N8N_TO_CRM_CREDENTIAL = 'Silmer n8n para CRM Basic DEV';

/**
 * Builds the non-WhatsApp validation workflow from the canonical workflow.
 * The domain path stays identical: CRM inbound, briefing, AI decision,
 * handoff, send fence, delivery callback and CRM-originated commands.
 *
 * @param {Record<string, any>} source
 * @param {{deployment?: boolean, local?: boolean}} [options]
 */
export function createDevTestWorkflow(source, options = {}) {
  if (options.deployment && options.local) {
    throw new Error('A workflow cannot target deployment and local n8n together');
  }
  const workflow = structuredClone(source);
  const local = options.local === true;
  const workflowName = local ? LOCAL_WORKFLOW_NAME : DEV_WORKFLOW_NAME;
  workflow.name = workflowName;
  workflow.id = DEV_WORKFLOW_ID;
  workflow.active = false;
  delete workflow.versionId;
  delete workflow.activeVersionId;
  delete workflow.webhookId;
  delete workflow.pinData;

  if (workflow.source) {
    workflow.source = {
      ...workflow.source,
      id: DEV_WORKFLOW_ID,
      name: workflowName,
      active: false,
      activeVersionId: null,
    };
    delete workflow.source.versionId;
  }

  workflow.settings = {
    ...(workflow.settings ?? {}),
    availableInMCP: false,
    saveDataErrorExecution: 'none',
    saveDataSuccessExecution: 'none',
    saveExecutionProgress: false,
    saveManualExecutions: false,
  };

  const nodes = workflow.nodes ?? [];
  const trigger = requiredNode(nodes, MAIN_TRIGGER);
  trigger.name = DEV_TRIGGER;
  trigger.type = 'n8n-nodes-base.webhook';
  trigger.typeVersion = 2;
  trigger.parameters = {
    httpMethod: 'POST',
    path: local ? 'silmer/local-mvp-flow' : 'silmer/dev-mvp-flow',
    responseMode: 'lastNode',
    options: {},
  };
  delete trigger.credentials;
  delete trigger.webhookId;

  const buildSyntheticEvent = {
    id: 'f321065d-4c9e-41d1-a0fe-65a94ed99351',
    name: 'DEV - Montar evento WhatsApp sintético (MVP)',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [trigger.position[0] + 230, trigger.position[1]],
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: `const body = $json.body ?? $json;
const waId = String(body.wa_id ?? '').trim();
if (!/^[1-9][0-9]{7,14}$/.test(waId)) throw new Error('DEV_WA_ID_INVALID');
const occurredAt = String(Math.floor(Date.now() / 1000));
const eventId = String(body.event_id ?? ('dev-inbound-' + $execution.id));
const phoneNumberId = String(body.phone_number_id ?? 'dev-phone-number');
const scenario = String(body.scenario ?? 'message').trim() || 'message';
if (!['message', 'handoff', 'send_unknown', 'delivery_status'].includes(scenario)) {
  throw new Error('DEV_SCENARIO_INVALID');
}
const status = body.status == null
  ? scenario === 'delivery_status' ? 'delivered' : null
  : String(body.status);
if (status) {
  return { json: { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId },
    statuses: [{ id: String(body.external_message_id ?? eventId), status, timestamp: occurredAt, recipient_id: waId }]
  } }] }] } };
}
const defaultText = {
  handoff: 'Quero falar com uma pessoa da Silmer, por favor.',
  send_unknown: 'Preciso de 120 camisetas para um evento.',
  message: 'Preciso de 120 camisetas para um evento.'
}[scenario] ?? '';
const text = String(body.message ?? body.text ?? defaultText).trim();
if (!text) throw new Error('DEV_MESSAGE_REQUIRED');
return { json: { entry: [{ changes: [{ value: {
  metadata: { phone_number_id: phoneNumberId },
  contacts: [{ profile: { name: String(body.customer_name ?? 'Cliente de teste') }, wa_id: waId }],
  messages: [{ from: waId, id: eventId, timestamp: occurredAt, type: 'text', text: { body: text } }]
} }] }] } };`,
    },
  };
  nodes.push(buildSyntheticEvent);

  transformSendNode(
    requiredNode(nodes, AI_SEND),
    DEV_AI_SEND,
    `const input = $('${DEV_TRIGGER}').item.json.body ?? {};
if (input.simulate_send_unknown === true || input.scenario === 'send_unknown') throw new Error('DEV_SIMULATED_SEND_OUTCOME_UNKNOWN');
const command = $('Preparar reserva de envio da IA (MVP)').item.json.command_id;
return { json: { id: 'dev-ai-' + command, messages: [{ id: 'dev-ai-' + command }], simulated: true } };`,
  );
  transformSendNode(
    requiredNode(nodes, HUMAN_SEND),
    DEV_HUMAN_SEND,
    `const command = $('Preparar reserva de envio humano (MVP)').item.json.command;
return { json: { id: 'dev-human-' + command.command_id, messages: [{ id: 'dev-human-' + command.command_id }], simulated: true } };`,
  );

  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.httpRequest') {
      rewriteWorkflowHeaders(node);
      if (options.deployment) {
        node.credentials = {
          httpBasicAuth: { name: N8N_TO_CRM_CREDENTIAL },
        };
      } else if (local) {
        configureLocalCrmRequest(node);
      } else {
        delete node.credentials;
      }
    }
  }

  const panelTrigger = requiredNode(nodes, PANEL_TRIGGER);
  panelTrigger.parameters.path = local
    ? 'silmer/local-panel-command'
    : 'silmer/dev-panel-command';
  if (options.deployment) {
    panelTrigger.credentials = {
      httpBasicAuth: { name: CRM_TO_N8N_CREDENTIAL },
    };
  } else {
    delete panelTrigger.credentials;
    if (local) panelTrigger.parameters.authentication = 'none';
  }

  nodes.push(
    resultNode(
      'DEV - Resultado da resposta da IA',
      [1350, -700],
      `const decision = $('Normalizar decisão da IA (MVP)').item.json;
const input = $('${DEV_TRIGGER}').item.json.body ?? {};
return { json: { ok: true, scenario: input.scenario ?? 'message', route: 'ai_reply', whatsapp_simulated: true, conversation_id: decision.conversation_id, reply_text: decision.reply_text, briefing_patch: decision.briefing_patch, handoff_ready: decision.handoff_ready, missing_briefing_fields: decision.missing_briefing_fields } };`,
    ),
    resultNode(
      'DEV - Resultado do handoff',
      [620, -980],
      `const input = $('${DEV_TRIGGER}').item.json.body ?? {};
return { json: { ok: true, scenario: input.scenario ?? 'handoff', route: 'handoff', whatsapp_simulated: true, crm: $json } };`,
    ),
    resultNode(
      'DEV - Resultado do envio desconhecido',
      [1350, -420],
      `const input = $('${DEV_TRIGGER}').item.json.body ?? {};
return { json: { ok: true, scenario: input.scenario ?? 'send_unknown', route: 'send_unknown', whatsapp_simulated: true, crm: $json } };`,
    ),
    resultNode(
      'DEV - Resultado do status',
      [-990, -80],
      `const input = $('${DEV_TRIGGER}').item.json.body ?? {};
return { json: { ok: true, scenario: input.scenario ?? 'delivery_status', route: 'delivery_status', whatsapp_simulated: true, crm: $json } };`,
    ),
    resultNode(
      'DEV - Resultado sem novo envio',
      [620, -420],
      `return { json: { ok: true, route: 'send_not_authorized', whatsapp_simulated: true, crm: $json } };`,
    ),
    {
      id: '4c662d98-dfd8-4b62-b08a-2826435e36ed',
      name: 'DEV - Como testar o fluxo completo',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-2440, -1080],
      parameters: {
        width: 760,
        height: 470,
        color: 3,
        content:
          `# ${local ? 'LOCAL' : 'DEV'} | Fluxo completo sem WhatsApp\n\n` +
          'Mantém a lógica do workflow principal e substitui apenas o transporte WhatsApp.\n\n' +
          `- Entrada: webhook \`${local ? 'silmer/local-mvp-flow' : 'silmer/dev-mvp-flow'}\`.\n` +
          '- CRM real: inbound, briefing, handoff, reserva e callbacks.\n' +
          '- IA real: mesma decisão estruturada do MVP.\n' +
          '- Pré-ficha: cada mensagem atualiza os campos confirmados e a IA pergunta pelo próximo dado pendente.\n' +
          '- Saída WhatsApp: simulada, com `message.sent` persistido no CRM.\n' +
          '- `simulate_send_unknown: true` exercita reconciliação.\n\n' +
          'Cenários: `message`, `handoff`, `send_unknown` e `delivery_status`. ' +
          'Eles apenas montam a entrada sintética; a jornada do CRM, IA e fence ' +
          'continua igual à do workflow canônico.\n\n' +
          (local
            ? 'Local: a credencial n8n → CRM é efêmera por variável de ambiente e o webhook do painel fica exposto somente em localhost.'
            : 'Requer `SILMER_PANEL_BASE_URL` acessível pelo n8n e as credenciais Basic DEV nos dois sentidos.'),
      },
    },
  );

  workflow.connections = rewriteConnections(workflow.connections ?? {});
  workflow.nodeGroups = workflow.nodeGroups ?? [];
  return workflow;
}

/** @param {Record<string, any>} node */
function configureLocalCrmRequest(node) {
  node.parameters.authentication = 'none';
  delete node.parameters.genericAuthType;
  const headers = node.parameters.headerParameters?.parameters;
  if (!Array.isArray(headers)) return;
  headers.push({
    name: 'Authorization',
    value: '={{ $env.SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION }}',
  });
  delete node.credentials;
}

/**
 * @param {Record<string, any>} node
 * @param {string} name
 * @param {string} jsCode
 */
function transformSendNode(node, name, jsCode) {
  node.name = name;
  node.type = 'n8n-nodes-base.code';
  node.typeVersion = 2;
  node.parameters = { mode: 'runOnceForEachItem', jsCode };
  delete node.credentials;
}

/**
 * @param {string} name
 * @param {number[]} position
 * @param {string} jsCode
 */
function resultNode(name, position, jsCode) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForEachItem', jsCode },
  };
}

/** @param {Record<string, any>} node */
function rewriteWorkflowHeaders(node) {
  const headers = node.parameters?.headerParameters?.parameters ?? [];
  for (const header of headers) {
    if (header.name === 'X-Silmer-Workflow-Key') {
      header.value = DEV_WORKFLOW_ID;
    }
    if (header.name === 'X-Silmer-Workflow-Version') {
      header.value = DEV_WORKFLOW_VERSION;
    }
  }
}

/**
 * @param {Record<string, any>} connections
 * @returns {Record<string, any>}
 */
function rewriteConnections(connections) {
  /** @type {Record<string, string>} */
  const renamed = {
    [MAIN_TRIGGER]: DEV_TRIGGER,
    [AI_SEND]: DEV_AI_SEND,
    [HUMAN_SEND]: DEV_HUMAN_SEND,
  };
  /** @type {Record<string, any>} */
  const result = {};
  for (const [source, groups] of Object.entries(connections)) {
    result[renamed[source] ?? source] = structuredClone(groups);
  }
  for (const groups of Object.values(result)) {
    for (const outputs of Object.values(groups)) {
      for (const output of outputs) {
        for (const edge of output ?? [])
          edge.node = renamed[edge.node] ?? edge.node;
      }
    }
  }

  result[DEV_TRIGGER] = {
    main: [
      [
        {
          node: 'DEV - Montar evento WhatsApp sintético (MVP)',
          type: 'main',
          index: 0,
        },
      ],
    ],
  };
  result['DEV - Montar evento WhatsApp sintético (MVP)'] = {
    main: [[{ node: NORMALIZE_EVENT, type: 'main', index: 0 }]],
  };
  appendMain(
    result,
    'CRM - Registrar message.sent da IA (MVP)',
    0,
    'DEV - Resultado da resposta da IA',
  );
  appendMain(
    result,
    'CRM - Registrar handoff (MVP)',
    0,
    'DEV - Resultado do handoff',
  );
  appendMain(
    result,
    'CRM - Marcar envio desconhecido da IA (MVP)',
    0,
    'DEV - Resultado do envio desconhecido',
  );
  appendMain(
    result,
    'CRM - Registrar status de entrega (MVP)',
    0,
    'DEV - Resultado do status',
  );
  appendMain(
    result,
    'Envio da IA autorizado? (MVP)',
    1,
    'DEV - Resultado sem novo envio',
  );
  return result;
}

/**
 * @param {Record<string, any>} connections
 * @param {string} source
 * @param {number} index
 * @param {string} target
 */
function appendMain(connections, source, index, target) {
  connections[source] ??= {};
  connections[source].main ??= [];
  connections[source].main[index] ??= [];
  connections[source].main[index].push({
    node: target,
    type: 'main',
    index: 0,
  });
}

/**
 * @param {Array<Record<string, any>>} nodes
 * @param {string} name
 */
function requiredNode(nodes, name) {
  const node = nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Canonical workflow node not found: ${name}`);
  return node;
}

async function runCli() {
  const args = process.argv.slice(2);
  const deployment = args.includes('--deployment');
  const local = args.includes('--local');
  const values = args.filter(
    (argument) => argument !== '--deployment' && argument !== '--local',
  );
  const sourcePath =
    values[0] ??
    new URL('./k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json', import.meta.url);
  const outputPath =
    values[1] ??
    new URL(
      local
        ? './0S5ZS1xeDCSoWovs-local-test.sanitized.json'
        : './0S5ZS1xeDCSoWovs-dev-test.sanitized.json',
      import.meta.url,
  );
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const workflow = createDevTestWorkflow(source, { deployment, local });
  await writeFile(
    outputPath,
    await format(JSON.stringify(workflow), { parser: 'json' }),
    'utf8',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runCli();
}
