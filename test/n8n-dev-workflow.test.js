import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createDevTestWorkflow,
  DEV_WORKFLOW_ID,
  DEV_WORKFLOW_VERSION,
} from '../ops/n8n/workflows/create-dev-test-workflow.mjs';

const mainSnapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);

/**
 * @param {{deployment?: boolean, local?: boolean}} [options]
 * @returns {Promise<Record<string, any>>}
 */
async function workflow(options) {
  const source = JSON.parse(await readFile(mainSnapshot, 'utf8'));
  return createDevTestWorkflow(source, options);
}

test('keeps the canonical MVP path while replacing only WhatsApp transport', async () => {
  const dev = await workflow();
  const nodes = /** @type {Array<Record<string, any>>} */ (dev.nodes);
  const names = new Set(nodes.map((node) => node.name));
  const serialized = JSON.stringify(dev);

  assert.equal(dev.source.id, DEV_WORKFLOW_ID);
  assert.equal(dev.source.active, false);
  assert.ok(nodes.length < 51);
  assert.equal(
    nodes.some((node) => /whatsApp(?:Trigger)?$/u.test(node.type)),
    false,
  );
  assert.ok(names.has('DEV - Receber evento sintético (MVP)'));
  assert.ok(names.has('DEV - Conversa manual no chat (MVP)'));
  assert.ok(names.has('CRM - Registrar inbound (MVP)'));
  assert.ok(names.has('CRM - Reservar envio da IA (MVP)'));
  assert.ok(names.has('CRM - Registrar message.sent da IA (MVP)'));
  assert.ok(names.has('CRM - Registrar handoff (MVP)'));
  assert.ok(names.has('Painel - Receber comando (MVP)'));
  assert.match(serialized, /simulate_send_unknown/u);
  assert.match(serialized, /loadPreviousSession/u);
  assert.doesNotMatch(serialized, /credentials|webhookId|pinData/u);
});

test('isolates workflow identity, webhook paths and persistence settings', async () => {
  const dev = await workflow();
  const nodes = /** @type {Array<Record<string, any>>} */ (dev.nodes);
  const headers = /** @type {Array<Record<string, any>>} */ (
    nodes
      .filter((node) => node.type === 'n8n-nodes-base.httpRequest')
      .flatMap((node) => node.parameters.headerParameters.parameters)
  );
  const trigger = nodes.find(
    (node) => node.name === 'DEV - Receber evento sintético (MVP)',
  );
  const panel = nodes.find(
    (node) => node.name === 'Painel - Receber comando (MVP)',
  );

  assert.ok(trigger);
  assert.ok(panel);
  assert.equal(trigger.parameters.path, 'silmer/dev-mvp-flow');
  assert.equal(panel.parameters.path, 'silmer/dev-panel-command');
  assert.equal(dev.settings.saveDataSuccessExecution, 'none');
  assert.equal(dev.settings.saveManualExecutions, false);
  assert.ok(
    headers
      .filter((header) => header.name === 'X-Silmer-Workflow-Key')
      .every((header) => header.value === DEV_WORKFLOW_ID),
  );
  assert.ok(
    headers
      .filter((header) => header.name === 'X-Silmer-Workflow-Version')
      .every((header) => header.value === DEV_WORKFLOW_VERSION),
  );
});

test('keeps test scenarios at the synthetic boundary', async () => {
  const dev = await workflow();
  const nodes = /** @type {Array<Record<string, any>>} */ (dev.nodes);
  const trigger = nodes.find(
    (node) => node.name === 'DEV - Montar evento WhatsApp sintético (MVP)',
  );
  const send = nodes.find(
    (node) => node.name === 'DEV - Simular envio da IA (MVP)',
  );
  assert.ok(trigger);
  assert.ok(send);
  assert.match(
    trigger.parameters.jsCode,
    /'message', 'handoff', 'send_unknown', 'delivery_status'/u,
  );
  assert.match(trigger.parameters.jsCode, /DEV_SCENARIO_INVALID/u);
  assert.match(send.parameters.jsCode, /scenario === 'send_unknown'/u);
  assert.equal(DEV_WORKFLOW_VERSION, 'dev-mvp-simple-5');
  assert.match(trigger.parameters.jsCode, /Math\.imul\(hash, 31\)/u);
  assert.match(trigger.parameters.jsCode, /\) >>> 0;/u);
  const result = nodes.find(
    (node) => node.name === 'DEV - Resultado da resposta da IA',
  );
  assert.ok(result);
  assert.match(result.parameters.jsCode, /handoff_ready/u);
  assert.match(result.parameters.jsCode, /missing_briefing_fields/u);
});

test('offers an authenticated manual chat that starts a fresh synthetic CRM conversation on reload', async () => {
  const dev = await workflow();
  const nodes = /** @type {Array<Record<string, any>>} */ (dev.nodes);
  const chat = nodes.find(
    (node) => node.name === 'DEV - Conversa manual no chat (MVP)',
  );
  const syntheticInput = nodes.find(
    (node) => node.name === 'DEV - Montar evento WhatsApp sintético (MVP)',
  );

  assert.ok(chat);
  assert.ok(syntheticInput);
  assert.equal(chat.type, '@n8n/n8n-nodes-langchain.chatTrigger');
  assert.equal(chat.parameters.mode, 'hostedChat');
  assert.equal(chat.parameters.authentication, 'n8nUserAuth');
  assert.equal(chat.parameters.requireExecuteAccess, true);
  assert.equal(chat.parameters.options.loadPreviousSession, 'notSupported');
  assert.equal(chat.parameters.options.responseMode, 'lastNode');
  assert.deepEqual(dev.connections[chat.name].main[0][0], {
    node: 'DEV - Montar evento WhatsApp sintético (MVP)',
    type: 'main',
    index: 0,
  });
  assert.match(syntheticInput.parameters.jsCode, /chatInput/u);
  assert.match(syntheticInput.parameters.jsCode, /syntheticWaId/u);
  assert.match(syntheticInput.parameters.jsCode, /'55419'/u);
  assert.match(syntheticInput.parameters.jsCode, /padStart\(8, '0'\)/u);
});

test('adds only named Basic credential references for deployment output', async () => {
  const dev = await workflow({ deployment: true });
  const nodes = /** @type {Array<Record<string, any>>} */ (dev.nodes);
  const requests = nodes.filter(
    (node) => node.type === 'n8n-nodes-base.httpRequest',
  );
  const panel = nodes.find(
    (node) => node.name === 'Painel - Receber comando (MVP)',
  );

  assert.ok(panel);
  assert.ok(
    requests.every(
      (node) =>
        node.credentials.httpBasicAuth.name === 'Silmer n8n para CRM Basic DEV',
    ),
  );
  assert.equal(
    panel.credentials.httpBasicAuth.name,
    'Silmer CRM para n8n Basic DEV',
  );
});

test('makes a localhost-only workflow self-contained without exporting credentials', async () => {
  const local = await workflow({ local: true });
  const nodes = /** @type {Array<Record<string, any>>} */ (local.nodes);
  const requests = nodes.filter(
    (node) => node.type === 'n8n-nodes-base.httpRequest',
  );
  const panel = nodes.find(
    (node) => node.name === 'Painel - Receber comando (MVP)',
  );
  const trigger = nodes.find(
    (node) => node.name === 'DEV - Receber evento sintético (MVP)',
  );

  assert.ok(panel);
  assert.ok(trigger);
  assert.equal(local.name, 'LOCAL | Silmer | Fluxo completo sem WhatsApp');
  assert.equal(trigger.parameters.path, 'silmer/local-mvp-flow');
  assert.equal(panel.parameters.path, 'silmer/local-panel-command');
  assert.equal(panel.parameters.authentication, 'none');
  assert.ok(
    requests.every(
      (node) =>
        node.parameters.authentication === 'none' &&
        /** @type {Array<Record<string, any>>} */ (
          node.parameters.headerParameters.parameters
        ).some(
          (header) =>
            header.name === 'Authorization' &&
            header.value ===
              '={{ $env.SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION }}',
        ) &&
        node.credentials === undefined,
    ),
  );
});
