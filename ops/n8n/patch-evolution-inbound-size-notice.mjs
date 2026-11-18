import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NORMALIZE = 'Normalizar evento WhatsApp (MVP)';
const PREFIX = 'Inbox - Imagem recebida - ';
const LOOKUP = PREFIX + 'Consultar URL';
const DOWNLOAD = PREFIX + 'Baixar';
const PREPARE_FAILURE = PREFIX + 'Preparar falha';
const REPORT_FAILURE = PREFIX + 'Registrar falha';

/** Classify bytes from the authenticated Evolution lookup, never an HTTP
 * status, provider error string, filename or missing attachment alone.
 * @param {any} response @param {any} source
 */
export function inboundMediaExceedsSizeLimit(response, source) {
  if (source?.channel !== 'whatsapp') return false;
  const normalizeMime = (/** @type {unknown} */ value) =>
    String(value ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
  const expected = normalizeMime(source.media_mime_type);
  const mime = normalizeMime(response?.mimetype);
  const raster = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const audio = ['audio/ogg', 'audio/mpeg'];
  const corel = [
    'application/vnd.corel-draw',
    'application/x-vnd.corel.draw.document+zip',
    'application/cdr',
    'application/x-cdr',
    'application/coreldraw',
    'application/x-coreldraw',
    'image/x-coreldraw',
  ];
  const type = source.message_type;
  const encoded = response?.base64;
  if (typeof encoded !== 'string' || encoded.length % 4 !== 0) return false;

  let limit;
  if (
    ['image', 'document'].includes(type) &&
    mime === expected &&
    raster.includes(mime)
  ) {
    limit = 5 * 1024 * 1024;
  } else if (type === 'audio' && mime === expected && audio.includes(mime)) {
    limit = 16 * 1024 * 1024;
  } else if (type === 'document') {
    const generic = 'application/octet-stream';
    const candidates = ['application/pdf', generic, ...corel];
    if (![mime, expected].every((value) => candidates.includes(value)))
      return false;
    const header = Buffer.from(encoded.slice(0, 16), 'base64');
    const pdf = header.subarray(0, 5).toString('ascii') === '%PDF-';
    const riff =
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 11).toUpperCase() === 'CDR';
    const zip = header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]));
    if (!pdf && !riff && !zip) return false;
    if (
      [mime, expected].some((value) =>
        value === 'application/pdf' ? !pdf : corel.includes(value) && pdf,
      )
    )
      return false;
    limit = 16 * 1024 * 1024;
  } else {
    return false;
  }

  const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='));
  const size = (encoded.length / 4) * 3 - padding;
  if (size <= limit || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const lastQuartet = encoded.slice(-4);
  return Buffer.from(lastQuartet, 'base64').toString('base64') === lastQuartet;
}

/** Apply offline to the existing workflow's failure reporter, preserving its
 * generic path and all nodes, credentials and connections.
 * @param {any} source
 */
export function patchEvolutionInboundSizeNotice(source) {
  if (!Array.isArray(source?.nodes) || !source.connections)
    throw new Error('EXPECTED_EVOLUTION_INBOX_MEDIA_BRANCH');
  const workflow = structuredClone(source);
  /** @param {string} name */
  function find(name) {
    const matches = workflow.nodes.filter(
      (/** @type {any} */ node) => node.name === name,
    );
    if (matches.length !== 1 || matches[0].disabled === true)
      throw new Error('EXPECTED_EVOLUTION_INBOX_MEDIA_BRANCH');
    return matches[0];
  }
  find(NORMALIZE);
  const lookup = find(LOOKUP);
  const download = find(DOWNLOAD);
  const prepare = find(PREPARE_FAILURE);
  const report = find(REPORT_FAILURE);
  /** @param {string} from @param {number} output @param {string} to */
  const connects = (from, output, to) =>
    workflow.connections[from]?.main?.[output]?.some(
      (/** @type {any} */ edge) =>
        edge.node === to && edge.type === 'main' && edge.index === 0,
    );
  const code = prepare.parameters?.jsCode;
  if (
    lookup.type !== 'n8n-nodes-base.httpRequest' ||
    !String(lookup.parameters?.url).includes(
      '/chat/getBase64FromMediaMessage/',
    ) ||
    !lookup.credentials?.httpHeaderAuth?.id ||
    download.type !== 'n8n-nodes-base.code' ||
    !download.parameters?.jsCode?.includes('decodeEvolutionMedia') ||
    !connects(LOOKUP, 0, DOWNLOAD) ||
    !connects(DOWNLOAD, 1, PREPARE_FAILURE) ||
    !connects(PREPARE_FAILURE, 0, REPORT_FAILURE) ||
    report.type !== 'n8n-nodes-base.httpRequest' ||
    !String(report.parameters?.url).endsWith(
      '/api/v1/integrations/n8n/events',
    ) ||
    prepare.type !== 'n8n-nodes-base.code' ||
    typeof code !== 'string' ||
    !code.includes('INBOUND_MEDIA_STORE_FAILED')
  )
    throw new Error('EXPECTED_EVOLUTION_INBOX_MEDIA_BRANCH');
  if (code.includes('/* INBOX-INBOUND-SIZE-NOTICE */'))
    return { workflow, changedNodeNames: [] };

  prepare.parameters.jsCode = `/* INBOX-INBOUND-SIZE-NOTICE */
const failure = (() => {
${code}
})();
const classify = ${inboundMediaExceedsSizeLimit.toString()};
const source = $('${NORMALIZE}').item.json;
let response;
try { response = $('${LOOKUP}').item.json; } catch { return failure; }
if (!classify(response, source) || typeof source.event_id !== 'string' || !source.event_id)
  return failure;
const payload = failure.json.payload;
payload.failure = { code: 'INBOUND_MEDIA_TOO_LARGE' };
payload.external_message_id = source.event_id;
if (source.source) payload.source = source.source;
return failure;`;
  return { workflow, changedNodeNames: [prepare.name] };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-evolution-inbound-size-notice.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow, changedNodeNames } = patchEvolutionInboundSizeNotice(
    list[0],
  );
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `Prepared ${changedNodeNames.length} inbound size notice changes offline.\n`,
  );
}
