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
 * @param {{deployment?: boolean}} [options]
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
  assert.ok(nodes.length < 50);
  assert.equal(
    nodes.some((node) => /whatsApp(?:Trigger)?$/u.test(node.type)),
    false,
  );
  assert.ok(names.has('DEV - Receber evento sintético (MVP)'));
  assert.ok(names.has('CRM - Registrar inbound (MVP)'));
  assert.ok(names.has('CRM - Reservar envio da IA (MVP)'));
  assert.ok(names.has('CRM - Registrar message.sent da IA (MVP)'));
  assert.ok(names.has('CRM - Registrar handoff (MVP)'));
  assert.ok(names.has('Painel - Receber comando (MVP)'));
  assert.match(serialized, /simulate_send_unknown/u);
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
