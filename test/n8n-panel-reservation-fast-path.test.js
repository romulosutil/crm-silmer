import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { patchPanelReservationFastPath } from '../ops/n8n/patch-panel-reservation-fast-path.mjs';

const source = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-published.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const normalize = 'Normalizar comando do painel (MVP)';
const prepare = 'Preparar reserva de envio humano (MVP)';
const targets = [normalize, prepare];
const fixedTime = '2026-11-12T12:00:00.000Z';
class FixedDate extends Date {
  constructor() {
    super(fixedTime);
  }
}
/** @param {any} node @param {any} json */
function run(node, json) {
  const expression = node.parameters.jsonOutput;
  const code =
    node.type === 'n8n-nodes-base.set'
      ? `(${expression.slice(3, -2)})`
      : `(function(){${node.parameters.jsCode}})().json`;
  return JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        code,
        { $json: json, $execution: { id: '12345' }, Date: FixedDate },
        { timeout: 500 },
      ),
    ),
  );
}

test('pre-reservation transforms no longer dispatch Code tasks to an external runner', () => {
  const { workflow, changedNodeNames } = patchPanelReservationFastPath(source);
  assert.deepEqual(changedNodeNames, targets);
  for (const name of targets) {
    const node = workflow.nodes.find(
      (/** @type {any} */ node) => node.name === name,
    );
    assert.equal(node.type, 'n8n-nodes-base.set');
    assert.equal(node.typeVersion, 3.4);
    assert.equal(node.parameters.includeOtherFields, false);
    assert.equal(node.parameters.options.stripBinary, true);
  }
});

test('normalization preserves all routing outcomes, rejects wrong idempotency, and drops headers', () => {
  const before = source.nodes.find(
    (/** @type {any} */ node) => node.name === normalize,
  );
  const after = patchPanelReservationFastPath(source).workflow.nodes.find(
    (/** @type {any} */ node) => node.name === normalize,
  );
  const seen = new Set();
  for (const action of [
    'send_message',
    'take_over',
    'return_to_ai',
    'close',
    'invalid',
  ]) {
    for (const type of ['text', 'image', 'audio', 'video', 'document', null]) {
      for (const to of ['5511000000000', '99912345', '+99912345', null]) {
        for (const key of ['synthetic-command', 'wrong-key', null]) {
          const input = {
            body: {
              schema_version: '1.0',
              command_id: 'synthetic-command',
              action,
              message: { type, text: 'synthetic' },
              to,
            },
            headers: {
              'idempotency-key': key,
              authorization: 'private-header-canary',
            },
          };
          const original = structuredClone(input);
          const expected = run(before, input);
          const actual = run(after, input);
          assert.deepEqual(actual, expected);
          assert.equal(actual.headers, undefined);
          assert.doesNotMatch(JSON.stringify(actual), /private-header-canary/);
          assert.deepEqual(input, original);
          seen.add(actual.kind);
        }
      }
    }
  }
  for (const input of [
    {},
    { body: null },
    { body: 0 },
    { body: [] },
    { body: { schema_version: 'wrong' } },
  ])
    assert.deepEqual(run(after, input), run(before, input));
  assert.deepEqual([...seen].sort(), [
    'invalid',
    'send',
    'site_chat',
    'site_chat_media',
    'state',
  ]);
});

test('reservation request preserves command, fence, message, execution correlation and event identity', () => {
  const before = source.nodes.find(
    (/** @type {any} */ node) => node.name === prepare,
  );
  const after = patchPanelReservationFastPath(source).workflow.nodes.find(
    (/** @type {any} */ node) => node.name === prepare,
  );
  for (const type of ['text', 'image', 'audio', 'video']) {
    const input = {
      payload: {
        command_id: 'synthetic-command',
        conversation_id: 'synthetic-conversation',
        automation_epoch: 7,
        source_revision: 9,
        message: {
          type,
          text: 'synthetic',
          media_id: 'synthetic-media',
          sha256: 'a'.repeat(64),
        },
      },
      kind: 'send',
      ignored: 'private-input-canary',
    };
    const output = run(after, input);
    assert.deepEqual(output, run(before, input));
    assert.equal(output.payload.occurred_at, fixedTime);
    assert.equal(output.payload.source_revision, 9);
    assert.equal(output.idempotency_key, 'reserve:synthetic-command');
    assert.equal(output.correlation_id, '0000000000012345');
    assert.doesNotMatch(JSON.stringify(output), /private-input-canary/);
  }
});

test('patch is atomic, idempotent and preserves every unrelated node, connection, setting and credential', () => {
  const input = structuredClone(source);
  input.settings = {
    errorWorkflow: 'synthetic-error-workflow',
    saveDataSuccessExecution: 'none',
  };
  input.nodes[0].credentials = {
    httpBasicAuth: {
      id: 'synthetic-credential',
      name: 'private-credential-canary',
    },
  };
  const before = structuredClone(input);
  const { workflow } = patchPanelReservationFastPath(input);
  assert.deepEqual(input, before);
  assert.deepEqual(workflow.connections, input.connections);
  assert.deepEqual(workflow.settings, input.settings);
  assert.deepEqual(
    workflow.nodes.filter((/** @type {any} */ n) => !targets.includes(n.name)),
    input.nodes.filter((/** @type {any} */ n) => !targets.includes(n.name)),
  );
  for (const name of targets) {
    const old = input.nodes.find((/** @type {any} */ n) => n.name === name);
    const current = workflow.nodes.find(
      (/** @type {any} */ n) => n.name === name,
    );
    assert.deepEqual(
      {
        ...current,
        type: old.type,
        typeVersion: old.typeVersion,
        parameters: old.parameters,
      },
      old,
    );
  }
  assert.deepEqual(patchPanelReservationFastPath(workflow), {
    workflow,
    changedNodeNames: [],
  });
});

test('patch refuses code drift, unexpected options, partial patches, duplicates and changed wiring', () => {
  /** @type {Array<(workflow:any)=>void>} */
  const changes = [
    (w) =>
      (w.nodes.find(
        (/** @type {any} */ n) => n.name === normalize,
      ).parameters.jsCode += '\n// drift'),
    (w) =>
      (w.nodes.find(
        (/** @type {any} */ n) => n.name === prepare,
      ).parameters.language = 'python'),
    (w) =>
      (w.nodes.find(
        (/** @type {any} */ n) => n.name === normalize,
      ).retryOnFail = true),
    (w) =>
      (w.nodes.find((/** @type {any} */ n) => n.name === normalize).disabled =
        true),
    (w) =>
      (w.nodes.find((/** @type {any} */ n) => n.name === prepare).onError =
        'continueRegularOutput'),
    (w) => w.nodes.push(structuredClone(w.nodes[0])),
    (w) =>
      w.nodes.push({
        ...structuredClone(
          w.nodes.find((/** @type {any} */ n) => n.name === normalize),
        ),
        id: 'unique-duplicate',
      }),
    (w) =>
      w.connections[normalize].main[0].push({
        node: 'unexpected-target',
        type: 'main',
        index: 0,
      }),
    (w) =>
      (w.nodes[
        w.nodes.findIndex((/** @type {any} */ n) => n.name === prepare)
      ] = patchPanelReservationFastPath(w).workflow.nodes.find(
        (/** @type {any} */ n) => n.name === prepare,
      )),
  ];
  for (const change of changes) {
    const input = structuredClone(source);
    change(input);
    const before = structuredClone(input);
    assert.throws(
      () => patchPanelReservationFastPath(input),
      /PANEL_FAST_PATH_/,
    );
    assert.deepEqual(input, before);
  }
  for (const field of ['includeOtherFields', 'jsonOutput', 'options']) {
    const { workflow } = patchPanelReservationFastPath(source);
    const node = workflow.nodes.find(
      (/** @type {any} */ n) => n.name === normalize,
    );
    node.parameters[field] =
      field === 'includeOtherFields'
        ? true
        : field === 'jsonOutput'
          ? '={{ $json }}'
          : { stripBinary: false };
    assert.throws(
      () => patchPanelReservationFastPath(workflow),
      /PANEL_FAST_PATH_/,
    );
  }
});
