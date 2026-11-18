import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateEvolutionEvent } from './workflows/create-evolution-workflow.mjs';

const TARGET = 'Evolution - Validar origem (MVP)';
const MESSAGE_KIND = "      kind: 'message',\n";
const PUBLISHED_DIAGNOSTIC = `      // INBOX-UNSUPPORTED-DIAG
      shape: [...new Set([payload.messageType, ...Object.keys(message && typeof message === 'object' ? message : {})])].filter((name) => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)).slice(0, 6).join('+'),
`;

/** INBOX-ALBUM-01 / INBOX-PROTOCOL-01: patch only the inbound validator.
 * Never regenerate a deployed workflow from a historical journey template.
 * @param {any} source
 * @returns {{workflow:any,changedNodeNames:string[]}}
 */
export function patchEvolutionAlbums(source) {
  if (!Array.isArray(source?.nodes) || !source.connections)
    throw new Error('EVOLUTION_ALBUM_WORKFLOW_INVALID');
  const nodes = source.nodes.filter(
    (/** @type {any} */ n) => n.name === TARGET,
  );
  if (
    nodes.length !== 1 ||
    nodes[0].type !== 'n8n-nodes-base.code' ||
    typeof nodes[0].parameters?.jsCode !== 'string'
  )
    throw new Error('EVOLUTION_ALBUM_VALIDATOR_INVALID');
  const current = validateEvolutionEvent.toString().replaceAll('\r\n', '\n');
  const begin = current.indexOf('  // INBOX-ALBUM-01:');
  const protocol = current.indexOf('  // INBOX-PROTOCOL-01:', begin);
  const end = current.indexOf('  const quoted =', protocol);
  if (begin < 0 || protocol < 0 || end < 0)
    throw new Error('EVOLUTION_ALBUM_SOURCE_CHANGED');
  const original = current.slice(0, begin) + current.slice(end);
  const albumsOnly = current.slice(0, protocol) + current.slice(end);
  const code = nodes[0].parameters.jsCode.replaceAll('\r\n', '\n');
  const prefix = 'const validate = ';
  const suffix =
    ';\nreturn $input.all().map((item,index)=>{const checked=validate(item.json,';
  const parts = code.split(suffix);
  const validator = parts[0].slice(prefix.length);
  const baseline = validator.replace(
    MESSAGE_KIND + PUBLISHED_DIAGNOSTIC,
    MESSAGE_KIND,
  );
  if (
    parts.length !== 2 ||
    !parts[0].startsWith(prefix) ||
    !parts[1].endsWith(
      ');return checked?{json:checked,pairedItem:{item:index}}:null;}).filter(Boolean);',
    ) ||
    ![original, albumsOnly, current].includes(baseline)
  )
    throw new Error('EVOLUTION_ALBUM_CONTEXT_MISMATCH');
  const tail = parts[1];
  const endConfig = tail.indexOf(');return checked?');
  let config;
  try {
    config = JSON.parse(tail.slice(0, endConfig));
  } catch {
    throw new Error('EVOLUTION_ALBUM_CONFIGURATION_INVALID');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('EVOLUTION_ALBUM_CONFIGURATION_INVALID');
  const workflow = structuredClone(source);
  if (baseline === current) return { workflow, changedNodeNames: [] };
  const updated =
    validator === baseline
      ? current
      : current.replace(MESSAGE_KIND, MESSAGE_KIND + PUBLISHED_DIAGNOSTIC);
  workflow.nodes.find(
    (/** @type {any} */ n) => n.name === TARGET,
  ).parameters.jsCode = prefix + updated + suffix + tail;
  return { workflow, changedNodeNames: [TARGET] };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-evolution-albums.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow } = patchEvolutionAlbums(list[0]);
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write('Prepared Evolution inbound validator patch offline.\n');
}
