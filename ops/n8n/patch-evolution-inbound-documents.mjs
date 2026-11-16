import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchEvolutionInboundPdf } from './patch-evolution-inbound-pdf.mjs';

/** Decode authenticated gateway bytes; scanner/libmagic remain authoritative.
 * Generic gateway MIME is only a candidate, never permission to store arbitrary files.
 * @param {any} response @param {any} source
 */
export function decodeInboxDocument(response, source) {
  const normalize = (/** @type {any} */ value) =>
    String(value ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
  const cdrTypes = [
    'application/vnd.corel-draw',
    'application/x-vnd.corel.draw.document+zip',
    'application/cdr',
    'application/x-cdr',
    'application/coreldraw',
    'application/x-coreldraw',
    'image/x-coreldraw',
  ];
  const expected = normalize(source.media_mime_type);
  const mime = normalize(response?.mimetype);
  const allowed = ['application/pdf', 'application/octet-stream', ...cdrTypes];
  const encoded = response?.base64;
  const limit = 16 * 1024 * 1024;
  const invalid = () => new Error('INBOUND_DOCUMENT_INVALID');
  if (
    source.channel !== 'whatsapp' ||
    source.message_type !== 'document' ||
    !allowed.includes(expected) ||
    !allowed.includes(mime) ||
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > Math.ceil(limit / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw invalid();
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 5 ||
    bytes.length > limit ||
    bytes.toString('base64') !== encoded
  )
    throw invalid();
  const pdf = bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  const riff =
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 11).toUpperCase() === 'CDR';
  // A ZIP signature only admits a scanner candidate. Plain ZIP is rejected by
  // libmagic's detected MIME in PrivateMediaVolume, never admitted as CDR.
  const zip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]));
  if (!pdf && !riff && !zip) throw invalid();
  for (const declared of [expected, mime]) {
    if (
      (declared === 'application/pdf' && !pdf) ||
      (cdrTypes.includes(declared) && pdf)
    )
      throw invalid();
  }
  const type = pdf
    ? 'application/pdf'
    : zip
      ? 'application/x-vnd.corel.draw.document+zip'
      : 'application/vnd.corel-draw';
  const ext = pdf ? 'pdf' : 'cdr';
  return {
    json: { mime_type: type, filename: 'documento.' + ext },
    binary: {
      data: {
        data: encoded,
        mimeType: type,
        fileName: 'documento.' + ext,
        fileExtension: ext,
      },
    },
  };
}

/** Extend only the existing independent media branch; preserve all other nodes.
 * INBOX-DOC-02 / INB-01 / MSG-01..03 / PRV-03.
 * @param {any} source
 */
export function patchEvolutionInboundDocuments(source) {
  const { workflow, changedNodeNames } = patchEvolutionInboundPdf(source);
  const prefix = 'Inbox - Imagem recebida - ';
  const node = (/** @type {string} */ name) =>
    workflow.nodes.find((/** @type {any} */ n) => n.name === prefix + name);
  const filter = node('Filtrar');
  const download = node('Baixar');
  const measure = node('Medir');
  const expression = filter.parameters.conditions.conditions[0].leftValue;
  const markers = [
    expression.includes('/* INBOX-DOC-02 */'),
    download.parameters.jsCode.includes('const decodeInboxDocument='),
    measure.parameters.jsCode.includes('const decodeInboxDocument='),
  ];
  if (markers.every(Boolean)) return { workflow, changedNodeNames: [] };
  if (markers.some(Boolean)) throw new Error('PARTIAL_DOCUMENT_PATCH');
  const sourceExpression = "$('Normalizar evento WhatsApp (MVP)').item.json";
  const predicate = `(() => { const n = ${sourceExpression}; return n.channel === 'whatsapp' && n.message_type === 'document' && ['application/pdf','application/octet-stream','application/vnd.corel-draw','application/x-vnd.corel.draw.document+zip','application/cdr','application/x-cdr','application/coreldraw','application/x-coreldraw','image/x-coreldraw'].includes(String(n.media_mime_type ?? '').split(';')[0].trim().toLowerCase()); })()`;
  filter.parameters.conditions.conditions[0].leftValue = `={{ /* INBOX-DOC-02 */ (${expression.slice(3, -2)}) || ${predicate} }}`;
  download.parameters.jsCode = `if (${predicate}) { const decodeInboxDocument=${decodeInboxDocument.toString()}; return decodeInboxDocument($json,${sourceExpression}); }\n${download.parameters.jsCode}`;
  measure.parameters.jsCode = `if (${predicate}) { const decodeInboxDocument=${decodeInboxDocument.toString()}; const file=$input.item.binary?.data; if (!file) throw new Error('INBOUND_DOCUMENT_INVALID'); const bytes=await this.helpers.getBinaryDataBuffer($itemIndex,'data'); const output=decodeInboxDocument({mimetype:file.mimeType,base64:bytes.toString('base64')},${sourceExpression}); return {...output,binary:{data:{...file,mimeType:output.binary.data.mimeType,fileName:output.binary.data.fileName,fileExtension:output.binary.data.fileExtension}}}; }\n${measure.parameters.jsCode}`;
  return {
    workflow,
    changedNodeNames: [
      ...new Set([
        ...changedNodeNames,
        filter.name,
        download.name,
        measure.name,
      ]),
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-evolution-inbound-documents.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const { workflow, changedNodeNames } = patchEvolutionInboundDocuments(
    list[0],
  );
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `Prepared ${changedNodeNames.length} node changes offline; nothing was published.\n`,
  );
}
