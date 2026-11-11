import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Only authenticated gateway bytes; never fetch a provider-supplied URL.
 * @param {any} response @param {any} source
 */
export function decodeInboxPdf(response, source) {
  const mime = String(response?.mimetype ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const expected = String(source.media_mime_type ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const encoded = response?.base64;
  const limit = 16 * 1024 * 1024;
  if (
    source.channel !== 'whatsapp' ||
    source.message_type !== 'document' ||
    mime !== 'application/pdf' ||
    expected !== mime ||
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > Math.ceil(limit / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error('INBOUND_PDF_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 5 ||
    bytes.length > limit ||
    bytes.toString('base64') !== encoded ||
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw new Error('INBOUND_PDF_INVALID');
  return {
    json: {},
    binary: {
      data: {
        data: encoded,
        mimeType: mime,
        fileName: 'documento.pdf',
        fileExtension: 'pdf',
      },
    },
  };
}

/** @param {any} file @param {Buffer} bytes */
export function measureInboxPdf(file, bytes) {
  if (
    !file ||
    String(file.mimeType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase() !== 'application/pdf' ||
    bytes.length < 5 ||
    bytes.length > 16 * 1024 * 1024 ||
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw new Error('INBOUND_PDF_INVALID');
  return {
    json: { mime_type: 'application/pdf', filename: 'documento.pdf' },
    binary: {
      data: {
        ...file,
        mimeType: 'application/pdf',
        fileName: 'documento.pdf',
        fileExtension: 'pdf',
      },
    },
  };
}

/** Extend the existing persistence branch, preserving commercial routing and credentials.
 * INBOX-PDF-01 / INB-01 / MSG-01..03. Offline only; apply to a fresh private export.
 * @param {any} source
 */
export function patchEvolutionInboundPdf(source) {
  if (
    !Array.isArray(source?.nodes) ||
    !source.connections ||
    source.settings?.executionOrder !== 'v1'
  )
    throw new Error('EXPECTED_V1_WORKFLOW');
  const workflow = structuredClone(source);
  const prefix = 'Inbox - Imagem recebida - ';
  /** @param {string} name */
  const find = (name) => {
    const nodes = workflow.nodes.filter(
      (/** @type {any} */ n) => n.name === name,
    );
    if (nodes.length !== 1 || nodes[0].disabled === true)
      throw new Error('EXPECTED_ACTIVE_UNIQUE_MEDIA_NODE');
    return nodes[0];
  };
  find('Evolution - Validar origem (MVP)');
  find('Normalizar evento WhatsApp (MVP)');
  const filter = find(prefix + 'Filtrar');
  const lookup = find(prefix + 'Consultar URL');
  const download = find(prefix + 'Baixar');
  const measure = find(prefix + 'Medir');
  const report = find(prefix + 'Registrar falha');
  const condition = filter.parameters?.conditions?.conditions;
  if (
    filter.type !== 'n8n-nodes-base.if' ||
    condition?.length !== 1 ||
    condition[0].operator?.type !== 'boolean' ||
    condition[0].operator?.operation !== 'true' ||
    lookup.type !== 'n8n-nodes-base.httpRequest' ||
    lookup.parameters?.method !== 'POST' ||
    !/^http:\/\/[a-z0-9_-]+:8080\/chat\/getBase64FromMediaMessage\/[a-z0-9_-]+$/u.test(
      lookup.parameters?.url ?? '',
    ) ||
    !lookup.credentials?.httpHeaderAuth?.id ||
    download.type !== 'n8n-nodes-base.code' ||
    !download.parameters?.jsCode?.includes('decodeEvolutionMedia') ||
    measure.type !== 'n8n-nodes-base.code' ||
    !measure.parameters?.jsCode?.includes('getBinaryDataBuffer')
  )
    throw new Error('EXPECTED_EVOLUTION_MEDIA_BRANCH');
  const chain = [
    'Filtrar',
    'Consultar URL',
    'Baixar',
    'Medir',
    'SHA256',
    'Preparar anexo',
    'Salvar no CRM',
  ];
  const failure = prefix + 'Preparar falha';
  find(failure);
  for (let i = 0; i < chain.length; i++) {
    const name = prefix + chain[i];
    const node = find(name);
    const outputs = workflow.connections[name]?.main ?? [];
    const expected = [
      ...(chain[i + 1] ? [prefix + chain[i + 1]] : []),
      ...(i ? [failure] : []),
    ];
    if (
      JSON.stringify(outputs.flat().map((/** @type {any} */ e) => e.node)) !==
        JSON.stringify(expected) ||
      (i && node.onError !== 'continueErrorOutput')
    )
      throw new Error('EXPECTED_MEDIA_CHAIN');
  }
  const fanout =
    workflow.connections['CRM - Registrar inbound (MVP)']?.main?.[0];
  if (
    !Array.isArray(fanout) ||
    fanout.filter((/** @type {any} */ e) => e.node === filter.name).length !==
      1 ||
    workflow.connections[failure]?.main?.flat().length !== 1 ||
    workflow.connections[failure]?.main?.[0]?.[0]?.node !== report.name ||
    (workflow.connections[report.name]?.main?.flat().length ?? 0) !== 0
  )
    throw new Error('EXPECTED_MEDIA_FANOUT');
  const expression = condition[0].leftValue;
  if (
    typeof expression !== 'string' ||
    !expression.startsWith('={{') ||
    expression.indexOf('}}', 3) !== expression.length - 2
  )
    throw new Error('EXPECTED_MEDIA_EXPRESSION');
  const markers = [
    expression.includes('/* INBOX-PDF-01 */'),
    download.parameters.jsCode.includes('const decodeInboxPdf='),
    measure.parameters.jsCode.includes('const measureInboxPdf='),
  ];
  if (markers.every(Boolean)) return { workflow, changedNodeNames: [] };
  if (markers.some(Boolean)) throw new Error('PARTIAL_PDF_PATCH');
  const sourceExpression = "$('Normalizar evento WhatsApp (MVP)').item.json";
  const predicate = `(() => { const n = ${sourceExpression}; return n.channel === 'whatsapp' && n.message_type === 'document' && String(n.media_mime_type ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf'; })()`;
  condition[0].leftValue = `={{ /* INBOX-PDF-01 */ (${expression.slice(3, -2)}) || ${predicate} }}`;
  download.parameters.jsCode = `if (${predicate}) { const decodeInboxPdf=${decodeInboxPdf.toString()}; return decodeInboxPdf($json,${sourceExpression}); }\n${download.parameters.jsCode}`;
  measure.parameters.jsCode = `if (${predicate}) { const measureInboxPdf=${measureInboxPdf.toString()}; return measureInboxPdf($input.item.binary?.data,await this.helpers.getBinaryDataBuffer($itemIndex,'data')); }\n${measure.parameters.jsCode}`;
  // n8n v1 orders sibling branches by position; persist before AI/human routing.
  const siblings = fanout
    .filter((/** @type {any} */ e) => e.node !== filter.name)
    .map((/** @type {any} */ e) => find(e.node));
  if (!siblings.length) throw new Error('EXPECTED_COMMERCIAL_FANOUT');
  filter.position[1] =
    Math.min(...siblings.map((/** @type {any} */ n) => n.position[1])) - 320;
  report.onError = 'continueRegularOutput';
  return {
    workflow,
    changedNodeNames: [filter.name, download.name, measure.name, report.name],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (
    !inputPath ||
    !outputPath ||
    extra.length ||
    resolve(inputPath) === resolve(outputPath)
  )
    throw new Error(
      'Usage: node patch-evolution-inbound-pdf.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(inputPath, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow, changedNodeNames } = patchEvolutionInboundPdf(list[0]);
  await writeFile(
    outputPath,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `Prepared ${changedNodeNames.length} node changes offline; nothing was published.\n`,
  );
}
