import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALIDATOR = 'Evolution - Validar origem (MVP)';
const CONVERT = 'Evolution - Montar evento WhatsApp (MVP)';
const MARKER = 'INBOX-UNSUPPORTED-DIAG';

// Only provider field names (letters/digits, at most six) leave the validator;
// no message value, text, key, media or contact data is ever read into the label.
const SHAPE =
  `shape: [...new Set([payload.messageType, ...Object.keys(message && typeof message === 'object' ? message : {})])]` +
  `.filter((name) => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)).slice(0, 6).join('+'),`;
const CONVERT_TYPE =
  "type: payload.type === 'unsupported' && payload.shape ? 'unsupported:' + payload.shape : payload.type,";

/** @param {any} source @param {string} name @returns {any} */
function codeNode(source, name) {
  const nodes = source.nodes.filter((/** @type {any} */ n) => n.name === name);
  if (
    nodes.length !== 1 ||
    nodes[0].type !== 'n8n-nodes-base.code' ||
    typeof nodes[0].parameters?.jsCode !== 'string'
  )
    throw new Error('EVOLUTION_SHAPE_NODE_INVALID');
  return nodes[0];
}

/** @param {string} code @param {string} anchor @param {string} insert */
function addOnce(code, anchor, insert) {
  if (code.includes(MARKER)) return code;
  const parts = code.split(anchor);
  if (parts.length !== 2) throw new Error('EVOLUTION_SHAPE_CONTEXT_MISMATCH');
  return parts.join(insert);
}

/** INBOX-UNSUPPORTED-DIAG: temporary diagnostic on a current private export.
 * An unsupported inbound message says which provider fields it carried
 * ("unsupported:protocolMessage+messageContextInfo") in the existing
 * placeholder, so the real event shape of a false unsupported is visible in the
 * Inbox. Roll back by publishing the previous version id; never regenerate a
 * deployed workflow from a journey template.
 * @param {any} source
 * @returns {{workflow:any,changedNodeNames:string[]}}
 */
export function patchEvolutionUnsupportedShape(source) {
  if (!Array.isArray(source?.nodes) || !source.connections)
    throw new Error('EVOLUTION_SHAPE_WORKFLOW_INVALID');
  const workflow = structuredClone(source);
  const changedNodeNames = [];
  const validator = codeNode(workflow, VALIDATOR);
  const convert = codeNode(workflow, CONVERT);
  const validatorCode = addOnce(
    validator.parameters.jsCode,
    "      kind: 'message',\n",
    `      kind: 'message',\n      // ${MARKER}\n      ${SHAPE}\n`,
  );
  const convertCode = addOnce(
    convert.parameters.jsCode,
    '    type: payload.type,\n  });',
    `    // ${MARKER}\n    ${CONVERT_TYPE}\n  });`,
  );
  if (validatorCode !== validator.parameters.jsCode) {
    validator.parameters.jsCode = validatorCode;
    changedNodeNames.push(VALIDATOR);
  }
  if (convertCode !== convert.parameters.jsCode) {
    convert.parameters.jsCode = convertCode;
    changedNodeNames.push(CONVERT);
  }
  return { workflow, changedNodeNames };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-evolution-unsupported-shape.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow, changedNodeNames } = patchEvolutionUnsupportedShape(
    list[0],
  );
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `Prepared unsupported-shape diagnostic offline (${changedNodeNames.length} node(s)); nothing was published.\n`,
  );
}
