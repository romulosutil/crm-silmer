import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { buildEvaluationWorkflow } from '../scripts/ux-longitudinal-workflow.mjs';

const snapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);
const runId = 'synthetic-longitudinal';
const turns = [
  {
    wa_id: '5500000000001',
    event_id: `${runId}-person-001-wave-1-turn-1`,
    customer_name: 'Pessoa sintética 001',
    message: 'Quero 12 camisetas azuis.',
  },
  {
    wa_id: '5500000000001',
    event_id: `${runId}-person-001-wave-2-turn-1`,
    customer_name: 'Pessoa sintética 001',
    message: 'Quero outro pedido de 7 polos vermelhas.',
  },
];

/** @returns {Promise<Record<string, any>>} */
async function fixture() {
  const source = JSON.parse(await readFile(snapshot, 'utf8'));
  for (const node of source.nodes) {
    if (node.type === 'n8n-nodes-base.httpRequest') {
      const path = String(node.parameters.url ?? '').match(
        /\/api\/v1\/integrations\/n8n\/[A-Za-z0-9/_-]+/u,
      )?.[0];
      if (path) {
        node.parameters.url = `https://crm.example.test${path}`;
        node.credentials = {
          httpBasicAuth: {
            id: 'synthetic-crm-reference',
            name: 'Synthetic CRM reference',
          },
        };
      }
    }
    if (node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi') {
      node.credentials = {
        openAiApi: {
          id: 'synthetic-model-reference',
          name: 'Synthetic model reference',
        },
      };
    }
  }
  source.pinData = { synthetic: 'must not be copied' };
  source.active = true;
  source.activeVersionId = 'synthetic-published-reference';
  return source;
}

/** @param {Record<string, any>} workflow @param {string} name */
function node(workflow, name) {
  const result = workflow.nodes.find(
    (/** @type {Record<string, any>} */ item) => item.name === name,
  );
  assert.ok(result, `Missing node: ${name}`);
  return result;
}

test('CP-T04: evaluator is unpublished and manual-only with recording disabled', async () => {
  const evaluated = buildEvaluationWorkflow(await fixture(), turns, { runId });
  assert.equal(evaluated.active, false);
  assert.equal(evaluated.id, undefined);
  assert.equal(evaluated.activeVersionId, undefined);
  assert.equal(evaluated.pinData, undefined);
  assert.equal(evaluated.source, undefined);
  assert.equal(evaluated.settings.saveDataErrorExecution, 'none');
  assert.equal(evaluated.settings.saveDataSuccessExecution, 'none');
  assert.equal(evaluated.settings.saveManualExecutions, false);
  assert.equal(evaluated.settings.saveExecutionProgress, false);
  assert.equal(
    evaluated.nodes.filter(
      (/** @type {Record<string, any>} */ item) =>
        item.type === 'n8n-nodes-base.manualTrigger',
    ).length,
    1,
  );
  for (const item of evaluated.nodes) {
    assert.doesNotMatch(
      item.type,
      /webhook|chatTrigger|errorTrigger|whatsApp/u,
    );
    assert.equal(item.webhookId, undefined);
  }
});

test('CP-T04: source and input turns remain untouched while opaque credentials are preserved', async () => {
  const source = await fixture();
  const before = structuredClone(source);
  const input = structuredClone(turns);
  const evaluated = buildEvaluationWorkflow(source, input, { runId });
  assert.deepEqual(source, before);
  assert.deepEqual(input, turns);
  assert.deepEqual(
    node(evaluated, 'CRM - Registrar inbound (MVP)').credentials,
    node(source, 'CRM - Registrar inbound (MVP)').credentials,
  );
  assert.deepEqual(
    node(evaluated, 'OpenAI - Modelo do MVP').credentials,
    node(source, 'OpenAI - Modelo do MVP').credentials,
  );
  assert.notEqual(
    node(evaluated, 'CRM - Registrar inbound (MVP)').credentials,
    node(source, 'CRM - Registrar inbound (MVP)').credentials,
  );
});

test('CP-T04: reachable sends are simulated and no channel command trigger survives', async () => {
  const evaluated = buildEvaluationWorkflow(await fixture(), turns, { runId });
  for (const name of [
    'DEV - Simular envio da IA (MVP)',
    'DEV - Simular aviso de transferência (MVP)',
  ]) {
    const send = node(evaluated, name);
    assert.equal(send.type, 'n8n-nodes-base.code');
    assert.equal(send.credentials, undefined);
    assert.match(send.parameters.jsCode, /simulated: true/u);
  }
  assert.equal(
    evaluated.nodes.some(
      (/** @type {Record<string, any>} */ item) =>
        item.name === 'Painel - Receber comando (MVP)',
    ),
    false,
  );
  const names = new Set(
    evaluated.nodes.map((/** @type {Record<string, any>} */ item) => item.name),
  );
  for (const connections of Object.values(evaluated.connections)) {
    for (const branches of Object.values(connections)) {
      for (const branch of branches) {
        for (const link of branch ?? []) assert.ok(names.has(link.node));
      }
    }
  }
});

test('CP-T04: HTTP nodes are confined to the reviewed CRM origin and integration path', async () => {
  const source = await fixture();
  const changed = node(source, 'CRM - Reler conversa (MVP)');
  changed.parameters.url =
    'https://outside.example.test/api/v1/integrations/n8n/messages/inbound';
  const evaluated = buildEvaluationWorkflow(source, turns, { runId });
  const blocked = node(evaluated, changed.name);
  assert.equal(blocked.type, 'n8n-nodes-base.code');
  assert.match(blocked.parameters.jsCode, /QA_EXTERNAL_TRANSPORT_DISABLED/u);
  assert.equal(blocked.credentials, undefined);
  for (const item of evaluated.nodes) {
    if (item.type !== 'n8n-nodes-base.httpRequest') continue;
    const url = new URL(item.parameters.url);
    assert.equal(url.origin, 'https://crm.example.test');
    assert.ok(url.pathname.startsWith('/api/v1/integrations/n8n/'));
  }
});

test('CP-T04: a misleading integration path in the query cannot enable an external call', async () => {
  const source = await fixture();
  const changed = node(source, 'CRM - Reler conversa (MVP)');
  changed.parameters.url =
    'https://crm.example.test/external?next=/api/v1/integrations/n8n/messages/inbound';
  const evaluated = buildEvaluationWorkflow(source, turns, { runId });
  const blocked = node(evaluated, changed.name);
  assert.equal(blocked.type, 'n8n-nodes-base.code');
  assert.match(blocked.parameters.jsCode, /QA_EXTERNAL_TRANSPORT_DISABLED/u);
});

test('CP-T04: two concatenated JSON URL literals are reviewed without changing the HTTP expression', async () => {
  const source = await fixture();
  const inbound = node(source, 'CRM - Registrar inbound (MVP)');
  const expression =
    '={{ "https://crm.example.test" + "/api/v1/integrations/n8n/messages/inbound" }}';
  inbound.parameters.url = expression;
  const evaluated = buildEvaluationWorkflow(source, turns, { runId });
  const retained = node(evaluated, inbound.name);
  assert.equal(retained.type, 'n8n-nodes-base.httpRequest');
  assert.equal(retained.parameters.url, expression);
  assert.equal(
    source.nodes.find((/** @type {any} */ item) => item.name === inbound.name)
      .parameters.url,
    expression,
  );
});

test('CP-T04: URL expressions containing executable code or environment lookups are disabled', async () => {
  for (const expression of [
    '={{ $env.SILMER_PANEL_BASE_URL + "/api/v1/integrations/n8n/messages/inbound" }}',
    '={{ "https://crm.example.test" + (() => "/api/v1/integrations/n8n/messages/inbound")() }}',
  ]) {
    const source = await fixture();
    const changed = node(source, 'CRM - Reler conversa (MVP)');
    changed.parameters.url = expression;
    const evaluated = buildEvaluationWorkflow(source, turns, { runId });
    const blocked = node(evaluated, changed.name);
    assert.equal(blocked.type, 'n8n-nodes-base.code');
    assert.match(blocked.parameters.jsCode, /QA_EXTERNAL_TRANSPORT_DISABLED/u);
  }
});

test('CP-T04: readback replays the same inbound payload and idempotency header', async () => {
  const evaluated = buildEvaluationWorkflow(await fixture(), turns, { runId });
  const original = node(evaluated, 'CRM - Registrar inbound (MVP)');
  const replay = node(evaluated, 'QA - Ler estado persistido');
  assert.deepEqual(replay.parameters, original.parameters);
  assert.deepEqual(replay.credentials, original.credentials);
  assert.notEqual(replay.id, original.id);
  const inbound = {
    idempotency_key: `${runId}-inbound-001`,
    correlation_id: `${runId}-correlation-001`,
    payload: {
      event_id: turns[0].event_id,
      contact: { wa_id: turns[0].wa_id },
      message: { text: turns[0].message, type: 'text' },
    },
  };
  const read = node(evaluated, 'QA - Preparar leitura persistida');
  const result = vm.runInNewContext(
    `(() => { ${read.parameters.jsCode} })()`,
    {
      $json: { route: 'ai_reply' },
      $: (/** @type {string} */ name) => {
        assert.equal(name, 'Preparar inbound CRM (MVP)');
        return { item: { json: inbound } };
      },
    },
    { timeout: 1000 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.json.payload)),
    inbound.payload,
  );
  assert.equal(result.json.idempotency_key, inbound.idempotency_key);
  assert.equal(result.json.result.route, 'ai_reply');
  const header = replay.parameters.headerParameters.parameters.find(
    (/** @type {Record<string, any>} */ value) =>
      value.name === 'Idempotency-Key',
  );
  assert.equal(header.value, '={{ $json.idempotency_key }}');
});

test('CP-T04: synthetic input keeps the same person across waves and rejects other identities', async () => {
  const evaluated = buildEvaluationWorkflow(await fixture(), turns, { runId });
  const build = node(evaluated, 'DEV - Montar evento WhatsApp sintético (MVP)');
  const execute = (/** @type {Record<string, any>} */ turn) =>
    vm.runInNewContext(`(() => { ${build.parameters.jsCode} })()`, {
      $json: turn,
    });
  const first = execute(turns[0]).json.entry[0].changes[0].value;
  const second = execute(turns[1]).json.entry[0].changes[0].value;
  assert.equal(first.contacts[0].wa_id, second.contacts[0].wa_id);
  assert.notEqual(first.messages[0].id, second.messages[0].id);
  assert.throws(
    () => execute({ ...turns[0], wa_id: '5511999999999' }),
    /SYNTHETIC_INPUT_REQUIRED/u,
  );
  assert.throws(
    () => execute({ ...turns[0], event_id: 'other-run-event' }),
    /SYNTHETIC_INPUT_REQUIRED/u,
  );
  assert.throws(
    () => buildEvaluationWorkflow({}, [], { runId: '../unsafe' }),
    /INVALID_RUN_ID/u,
  );
});

test('CP-T04: binary report retains evidence without model prompts, sellers or source media', async () => {
  const evaluated = buildEvaluationWorkflow(await fixture(), turns, {
    runId,
    wave: 2,
  });
  const evidence = node(evaluated, 'QA - Evidência do turno');
  const before = {
    contact_id: 'synthetic-contact-001',
    conversation_id: 'synthetic-conversation-001',
    source_revision: 2,
    briefing: { product_type: 'camisetas', quantity: 12 },
    subjects: [],
    sellers: [{ id: 'excluded-seller-sentinel' }],
    prompt: 'excluded-crm-prompt-sentinel',
  };
  const upstream = {
    'QA - Um turno por vez': {
      ...turns[1],
      media_base64: 'excluded-media-sentinel',
    },
    'CRM - Registrar inbound (MVP)': before,
    'QA - Preparar leitura persistida': {
      result: {
        route: 'ai_reply',
        reply_text: 'Qual pedido você quer alterar?',
      },
    },
    'Normalizar decisão da IA (MVP)': {
      reply_text: 'Qual pedido você quer alterar?',
      target_subject_id: null,
      prompt: 'excluded-model-prompt-sentinel',
    },
  };
  const recorded = vm.runInNewContext(
    `(() => { ${evidence.parameters.jsCode} })()`,
    {
      $json: { ...before, duplicate: true },
      $: (/** @type {keyof typeof upstream} */ name) => ({
        item: { json: upstream[name] },
      }),
    },
  );
  const report = node(evaluated, 'QA - Relatório da onda');
  const emitted = vm.runInNewContext(
    `(() => { ${report.parameters.jsCode} })()`,
    {
      Buffer,
      $input: { all: () => [recorded] },
    },
  );
  assert.equal(emitted[0].json.turn_count, 1);
  assert.equal(emitted[0].binary.data.mimeType, 'application/json');
  const serialized = Buffer.from(
    emitted[0].binary.data.data,
    'base64',
  ).toString('utf8');
  const decoded = JSON.parse(serialized);
  assert.equal(decoded.wave, 2);
  assert.equal(decoded.run_id, runId);
  assert.equal(decoded.turns[0].turn.event_id, turns[1].event_id);
  assert.equal(decoded.turns[0].before.briefing.quantity, 12);
  assert.equal(decoded.turns[0].after.duplicate, true);
  assert.doesNotMatch(serialized, /excluded-|"sellers"|"prompt"|media_base64/u);
});
