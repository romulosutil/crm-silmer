import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = [
  {
    name: 'Normalizar comando do painel (MVP)',
    next: 'Rotear comando do painel (MVP)',
    codeHash:
      '172a857fcfa50526991fd706af0123b4a34619c6766e58b45824c0e8879f70bb',
    expressionHash:
      'a332ad78e96830a8429ffcbc7c371109698ae316bfc9e8ed2526a35746e57e73',
  },
  {
    name: 'Preparar reserva de envio humano (MVP)',
    next: 'CRM - Reservar envio humano (MVP)',
    codeHash:
      '9ce487368fa61a829714eaeeac6acdb4521a1206e2f560fba76d96160ca908f4',
    expressionHash:
      'ca2aacc563ab25fd150432c297cc13cdc963ff9d961a2d52a787341ad804150e',
  },
];

/** OPS-INBOX-SEND-11: remove runner scheduling from two pure transformations.
 * Prepare only this delta on the current private export, never an old template.
 * @param {any} source
 * @returns {{workflow:any,changedNodeNames:string[]}}
 */
export function patchPanelReservationFastPath(source) {
  if (!Array.isArray(source?.nodes) || !source.connections)
    throw new Error('PANEL_FAST_PATH_WORKFLOW_INVALID');
  const ids = source.nodes.map((/** @type {any} */ n) => n.id);
  if (
    ids.some((/** @type {any} */ id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('PANEL_FAST_PATH_IDS_INVALID');
  const workflow = structuredClone(source);
  const changedNodeNames = [];
  for (const target of targets) {
    const candidates = workflow.nodes.filter(
      (/** @type {any} */ n) => n.name === target.name,
    );
    if (candidates.length !== 1)
      throw new Error('PANEL_FAST_PATH_NODE_AMBIGUOUS');
    const n = candidates[0];
    if (
      n.disabled ||
      n.continueOnFail ||
      n.retryOnFail ||
      n.alwaysOutputData ||
      n.credentials ||
      (n.onError && n.onError !== 'stopWorkflow')
    )
      throw new Error('PANEL_FAST_PATH_NODE_SETTINGS_CHANGED');
    if (
      JSON.stringify(workflow.connections[target.name]) !==
      JSON.stringify({
        main: [[{ node: target.next, type: 'main', index: 0 }]],
      })
    )
      throw new Error('PANEL_FAST_PATH_CONNECTIONS_CHANGED');
    const p = n.parameters;
    if (n.type === 'n8n-nodes-base.set') {
      if (
        n.typeVersion !== 3.4 ||
        keys(p) !== 'includeOtherFields,jsonOutput,mode,options' ||
        p.mode !== 'raw' ||
        p.includeOtherFields !== false ||
        keys(p.options) !== 'stripBinary' ||
        p.options.stripBinary !== true ||
        typeof p.jsonOutput !== 'string' ||
        sha(p.jsonOutput) !== target.expressionHash
      )
        throw new Error('PANEL_FAST_PATH_NATIVE_CONTEXT_CHANGED');
      continue;
    }
    if (
      n.type !== 'n8n-nodes-base.code' ||
      n.typeVersion !== 2 ||
      keys(p) !== 'jsCode,mode' ||
      p.mode !== 'runOnceForEachItem' ||
      typeof p.jsCode !== 'string'
    )
      throw new Error('PANEL_FAST_PATH_CODE_CONTEXT_CHANGED');
    const code = p.jsCode.replaceAll('\r\n', '\n');
    if (sha(code) !== target.codeHash)
      throw new Error('PANEL_FAST_PATH_CODE_CHANGED');
    const marker = 'return { json: ';
    const at = code.indexOf(marker);
    if (at < 0 || at !== code.lastIndexOf(marker) || !code.endsWith(' };'))
      throw new Error('PANEL_FAST_PATH_RETURN_CHANGED');
    const jsonOutput =
      '={{ (() => {\n' +
      code.slice(0, at) +
      'return ' +
      code.slice(at + marker.length, -3) +
      ';\n})() }}';
    if (sha(jsonOutput) !== target.expressionHash)
      throw new Error('PANEL_FAST_PATH_EXPRESSION_CHANGED');
    n.type = 'n8n-nodes-base.set';
    n.typeVersion = 3.4;
    n.parameters = {
      mode: 'raw',
      jsonOutput,
      includeOtherFields: false,
      options: { stripBinary: true },
    };
    changedNodeNames.push(target.name);
  }
  if (
    changedNodeNames.length !== 0 &&
    changedNodeNames.length !== targets.length
  )
    throw new Error('PANEL_FAST_PATH_PARTIAL_PATCH');
  return { workflow, changedNodeNames };
}

/** @param {string} value */
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
/** @param {any} value */
function keys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().join(',')
    : '';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-panel-reservation-fast-path.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow } = patchPanelReservationFastPath(list[0]);
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    'Prepared native panel transformations offline; nothing was published.\n',
  );
}
