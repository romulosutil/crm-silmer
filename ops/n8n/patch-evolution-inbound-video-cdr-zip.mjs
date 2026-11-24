import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Extend the independent media branch with MP4 video and CorelDRAW sent as ZIP.
 * INBOX-VIDEO-01 / INBOX-CDR-ZIP-01 (follow-up of INBOX-DOC-02); INB-01, MSG-01..03, PRV-03.
 *
 * Pure and self-contained: no imports, fs or Buffer here, so the same function
 * can run offline (CLI below) or in a browser against the live workflow JSON.
 * The generated n8n Code blocks may use Buffer because they run inside n8n.
 * Only the Filtrar expression and the Baixar/Medir code change; every other
 * node, connection and setting stays identical. Applying twice throws.
 * The CRM scanner/libmagic remain authoritative for the final type.
 * @param {any} workflow
 * @returns {any}
 */
export function patchInboundVideoAndCdrZip(workflow) {
  const VIDEO_MARKER = '/* INBOX-VIDEO-01 */';
  const CDR_MARKER = '/* INBOX-CDR-ZIP-01 */';
  const SOURCE = "$('Normalizar evento WhatsApp (MVP)').item.json";
  const PREFIX = 'Inbox - Imagem recebida - ';
  if (!workflow || !Array.isArray(workflow.nodes))
    throw new Error('EXPECTED_WORKFLOW');
  const next = structuredClone(workflow);
  const find = (/** @type {string} */ name) => {
    const found = next.nodes.filter(
      (/** @type {any} */ node) => node?.name === name,
    );
    if (found.length !== 1)
      throw new Error(
        (found.length ? 'AMBIGUOUS_MEDIA_NODE: ' : 'MISSING_MEDIA_NODE: ') +
          name,
      );
    return found[0];
  };
  const filter = find(PREFIX + 'Filtrar');
  const download = find(PREFIX + 'Baixar');
  const measure = find(PREFIX + 'Medir');
  const conditions = filter.parameters?.conditions?.conditions;
  if (
    !Array.isArray(conditions) ||
    conditions.length !== 1 ||
    typeof conditions[0]?.leftValue !== 'string'
  )
    throw new Error('UNEXPECTED_FILTER_SHAPE');
  if (
    typeof download.parameters?.jsCode !== 'string' ||
    typeof measure.parameters?.jsCode !== 'string'
  )
    throw new Error('UNEXPECTED_CODE_NODE_SHAPE');
  const expression = conditions[0].leftValue;
  for (const text of [
    expression,
    download.parameters.jsCode,
    measure.parameters.jsCode,
  ])
    if (text.includes(VIDEO_MARKER) || text.includes(CDR_MARKER))
      throw new Error('VIDEO_CDR_ZIP_PATCH_ALREADY_APPLIED');
  const shape = /^=\{\{([\s\S]*)\}\}$/u.exec(expression);
  if (!shape || !shape[1].trim())
    throw new Error('UNEXPECTED_FILTER_EXPRESSION');

  // Generated n8n code below. Error names match the CRM-side vocabulary.
  /** @param {any} response @param {any} source */
  function decodeInboxVideo(response, source) {
    const normalize = (/** @type {any} */ value) =>
      String(value ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const limit = 16 * 1024 * 1024;
    const invalid = () => new Error('INBOUND_VIDEO_INVALID');
    const encoded = response?.base64;
    if (
      source?.channel !== 'whatsapp' ||
      source.message_type !== 'video' ||
      normalize(source.media_mime_type) !== 'video/mp4' ||
      normalize(response?.mimetype) !== 'video/mp4' ||
      typeof encoded !== 'string' ||
      !encoded.length ||
      encoded.length > Math.ceil(limit / 3) * 4 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw invalid();
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.length < 8 ||
      bytes.length > limit ||
      bytes.toString('base64') !== encoded ||
      bytes.toString('ascii', 4, 8) !== 'ftyp'
    )
      throw invalid();
    return {
      json: { mime_type: 'video/mp4', filename: 'video.mp4' },
      binary: {
        data: {
          data: encoded,
          mimeType: 'video/mp4',
          fileName: 'video.mp4',
          fileExtension: 'mp4',
        },
      },
    };
  }

  /** @param {any} file @param {any} bytes */
  function measureInboxVideo(file, bytes) {
    if (
      !file ||
      String(file.mimeType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase() !== 'video/mp4' ||
      !bytes ||
      bytes.length < 8 ||
      bytes.length > 16 * 1024 * 1024 ||
      bytes.toString('ascii', 4, 8) !== 'ftyp'
    )
      throw new Error('INBOUND_VIDEO_INVALID');
    return {
      json: { mime_type: 'video/mp4', filename: 'video.mp4' },
      binary: {
        data: {
          ...file,
          mimeType: 'video/mp4',
          fileName: 'video.mp4',
          fileExtension: 'mp4',
        },
      },
    };
  }

  /** ZIP is only a candidate: libmagic must still detect Corel's ZIP type.
   * @param {any} response @param {any} source */
  function decodeInboxCdrZip(response, source) {
    const normalize = (/** @type {any} */ value) =>
      String(value ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const zipTypes = ['application/zip', 'application/x-zip-compressed'];
    const cdrZip = 'application/x-vnd.corel.draw.document+zip';
    const limit = 16 * 1024 * 1024;
    const invalid = () => new Error('INBOUND_DOCUMENT_INVALID');
    const encoded = response?.base64;
    if (
      source?.channel !== 'whatsapp' ||
      source.message_type !== 'document' ||
      !zipTypes.includes(normalize(source.media_mime_type)) ||
      !/\.cdr$/i.test(String(source.media_filename ?? '').trim()) ||
      ![...zipTypes, cdrZip].includes(normalize(response?.mimetype)) ||
      typeof encoded !== 'string' ||
      !encoded.length ||
      encoded.length > Math.ceil(limit / 3) * 4 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw invalid();
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.length < 4 ||
      bytes.length > limit ||
      bytes.toString('base64') !== encoded ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
    )
      throw invalid();
    return {
      json: { mime_type: cdrZip, filename: 'documento.cdr' },
      binary: {
        data: {
          data: encoded,
          mimeType: cdrZip,
          fileName: 'documento.cdr',
          fileExtension: 'cdr',
        },
      },
    };
  }

  /** @param {any} file @param {any} bytes */
  function measureInboxCdrZip(file, bytes) {
    const cdrZip = 'application/x-vnd.corel.draw.document+zip';
    if (
      !file ||
      String(file.mimeType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase() !== cdrZip ||
      !bytes ||
      bytes.length < 4 ||
      bytes.length > 16 * 1024 * 1024 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
    )
      throw new Error('INBOUND_DOCUMENT_INVALID');
    return {
      json: { mime_type: cdrZip, filename: 'documento.cdr' },
      binary: {
        data: {
          ...file,
          mimeType: cdrZip,
          fileName: 'documento.cdr',
          fileExtension: 'cdr',
        },
      },
    };
  }

  const mime =
    "String(n.media_mime_type ?? '').split(';')[0].trim().toLowerCase()";
  const video = `(() => { ${VIDEO_MARKER} const n = ${SOURCE}; return n.channel === 'whatsapp' && n.message_type === 'video' && ${mime} === 'video/mp4'; })()`;
  const cdrZip = `(() => { ${CDR_MARKER} const n = ${SOURCE}; return n.channel === 'whatsapp' && n.message_type === 'document' && ['application/zip','application/x-zip-compressed'].includes(${mime}) && /\\.cdr$/i.test(String(n.media_filename ?? '').trim()); })()`;
  const decoder = (
    /** @type {string} */ guard,
    /** @type {Function} */ decode,
  ) =>
    `if (${guard}) { const ${decode.name}=${decode.toString()}; return ${decode.name}($json,${SOURCE}); }\n`;
  const measurer = (
    /** @type {string} */ guard,
    /** @type {Function} */ check,
    /** @type {string} */ error,
  ) =>
    `if (${guard}) { const ${check.name}=${check.toString()}; const file=$input.item.binary?.data; if (!file) throw new Error('${error}'); const bytes=await this.helpers.getBinaryDataBuffer($itemIndex,'data'); return ${check.name}(file,bytes); }\n`;

  conditions[0].leftValue = `={{ ${VIDEO_MARKER} ${CDR_MARKER} (${shape[1]}) || ${video} || ${cdrZip} }}`;
  download.parameters.jsCode =
    decoder(video, decodeInboxVideo) +
    decoder(cdrZip, decodeInboxCdrZip) +
    download.parameters.jsCode;
  measure.parameters.jsCode =
    measurer(video, measureInboxVideo, 'INBOUND_VIDEO_INVALID') +
    measurer(cdrZip, measureInboxCdrZip, 'INBOUND_DOCUMENT_INVALID') +
    measure.parameters.jsCode;
  return next;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || resolve(input) === resolve(output))
    throw new Error(
      'Usage: node patch-evolution-inbound-video-cdr-zip.mjs <current.json> <review.json>',
    );
  const source = JSON.parse(await readFile(input, 'utf8'));
  const list = Array.isArray(source) ? source : [source];
  if (list.length !== 1) throw new Error('EXPECTED_ONE_WORKFLOW');
  const workflow = patchInboundVideoAndCdrZip(list[0]);
  await writeFile(
    output,
    JSON.stringify(Array.isArray(source) ? [workflow] : workflow, null, 2) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    'Prepared Filtrar/Baixar/Medir changes offline; nothing was published.\n',
  );
}
