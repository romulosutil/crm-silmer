import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { patchEvolutionUnsupportedShape } from '../ops/n8n/patch-evolution-unsupported-shape.mjs';

const OWN = '5511000000000';
const VALIDATOR = 'Evolution - Validar origem (MVP)';
const CONVERT = 'Evolution - Montar evento WhatsApp (MVP)';
const NORMALIZE = 'Normalizar evento WhatsApp (MVP)';
const published = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-published.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

/** @param {any} workflow @param {string} name @returns {string} */
const code = (workflow, name) =>
  workflow.nodes
    .find((/** @type {any} */ n) => n.name === name)
    .parameters.jsCode.replaceAll('__SILMER_OWN_NUMBER__', OWN);

/** @param {any} message @param {string} [messageType] */
function inbound(message, messageType) {
  return {
    event: 'messages.upsert',
    instance: 'silmer',
    sender: OWN + '@s.whatsapp.net',
    date_time: '2026-11-13T17:08:05.000Z',
    data: {
      key: {
        id: 'SYNTHETIC_EDIT',
        fromMe: false,
        remoteJid: '5511000000001@s.whatsapp.net',
      },
      messageTimestamp: 1794589683,
      ...(messageType ? { messageType } : {}),
      message,
    },
  };
}

/** Run the three deployed Code nodes without I/O on one synthetic event. */
function pipeline(/** @type {any} */ workflow, /** @type {any} */ event) {
  const [validated] = vm.runInNewContext(
    `(function(){${code(workflow, VALIDATOR)}})()`,
    { $input: { all: () => [{ json: event }] } },
  );
  const converted = vm.runInNewContext(
    `(function(){${code(workflow, CONVERT)}})()`,
    { $: () => ({ item: { json: validated.json } }), $json: null },
  );
  const normalized = vm.runInNewContext(
    `(function(){${code(workflow, NORMALIZE)}})()`,
    {
      $json: converted.json,
      $input: { item: { binary: undefined } },
      $execution: { id: 'synthetic' },
    },
  );
  return { validated: validated.json, converted: converted.json, normalized };
}

const base = published;

test('before the patch an unsupported edit-like event says nothing about its shape', () => {
  const { normalized } = pipeline(
    base,
    inbound({ editedMessage: { message: { protocolMessage: {} } } }),
  );
  assert.equal(
    normalized.json.text,
    '[Mensagem do tipo unsupported que o atendimento automático não lê]',
  );
});

test('patched unsupported event names provider fields and never copies values', () => {
  const { workflow, changedNodeNames } = patchEvolutionUnsupportedShape(base);
  assert.deepEqual(changedNodeNames, [VALIDATOR, CONVERT]);
  const secret = 'SEGREDO-DO-CLIENTE-12345';
  const { validated, converted, normalized } = pipeline(
    workflow,
    inbound(
      {
        editedMessage: { message: { protocolMessage: { note: secret } } },
        messageContextInfo: { note: secret },
        'bad key with spaces': secret,
      },
      'editedMessage',
    ),
  );
  assert.equal(validated.event.type, 'unsupported');
  assert.equal(validated.event.shape, 'editedMessage+messageContextInfo');
  assert.equal(
    converted.messages[0].type,
    'unsupported:editedMessage+messageContextInfo',
  );
  assert.equal(
    normalized.json.text,
    '[Mensagem do tipo unsupported:editedMessage+messageContextInfo que o atendimento automático não lê]',
  );
  assert.equal(normalized.json.message_type, 'text');
  assert.equal(normalized.json.ai_readable, false);
  assert.doesNotMatch(JSON.stringify(normalized.json), new RegExp(secret));
});

test('patched real content keeps its exact behavior', () => {
  const { workflow } = patchEvolutionUnsupportedShape(base);
  /** @type {[any, string][]} */
  const cases = [
    [{ conversation: 'Bom dia' }, 'text'],
    [{ imageMessage: { mimetype: 'image/jpeg' } }, 'image'],
    [{ protocolMessage: {} }, 'system'],
  ];
  for (const [message, label] of cases) {
    const { normalized } = pipeline(workflow, inbound(message));
    const before = pipeline(base, inbound(message)).normalized;
    assert.equal(
      JSON.stringify(normalized.json),
      JSON.stringify(before.json),
      label,
    );
  }
});

test('patch changes only the two nodes, is idempotent and rejects a changed validator', () => {
  const snapshot = JSON.stringify(base);
  const { workflow } = patchEvolutionUnsupportedShape(base);
  assert.equal(JSON.stringify(base), snapshot);
  assert.deepEqual(
    patchEvolutionUnsupportedShape(workflow).changedNodeNames,
    [],
  );
  const restored = structuredClone(workflow);
  for (const name of [VALIDATOR, CONVERT])
    restored.nodes.find(
      (/** @type {any} */ n) => n.name === name,
    ).parameters.jsCode = base.nodes.find(
      (/** @type {any} */ n) => n.name === name,
    ).parameters.jsCode;
  assert.deepEqual(restored, base);
  const drift = structuredClone(base);
  drift.nodes.find(
    (/** @type {any} */ n) => n.name === VALIDATOR,
  ).parameters.jsCode = drift.nodes
    .find((/** @type {any} */ n) => n.name === VALIDATOR)
    .parameters.jsCode.replace("kind: 'message',", "kind: 'message2',");
  assert.throws(
    () => patchEvolutionUnsupportedShape(drift),
    /CONTEXT_MISMATCH/,
  );
});
