import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MAX_ORDER_FILE_BYTES } from '@crm-silmer/orders';

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PDF_TYPE = 'application/pdf';
const MAX_PDF_PREVIEW_PAGES = 4;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const UNAVAILABLE = {
  notice: 'Não foi possível exibir a arte final. Consulte o arquivo no pedido.',
};
let activeReads = 0;

/**
 * Only the approved slot may reach the production sheet. Use the same
 * order visibility and download audit as the artwork panel.
 * @param {Record<string, any>} orders
 * @param {{orderId: string, actor: any, correlationId: string}} input
 */
export async function loadOrderPrintArtwork(orders, input) {
  if (activeReads >= 2) {
    throw Object.assign(new Error('Print artwork busy'), { statusCode: 503 });
  }
  activeReads += 1;
  try {
    const final = await orders.findFinalArtwork(input.orderId, input.actor);
    if (!final) return undefined;
    const { contentType } = final;
    if (contentType !== PDF_TYPE && !RASTER_TYPES.has(contentType)) {
      return {
        notice:
          'Este formato não tem prévia para impressão. Abra a arte final no pedido.',
      };
    }

    const opened = await orders.openFileContent({ ...input, fileId: final.id });
    const content = await readArtwork(opened.stream, opened.file.sizeBytes);
    if (
      opened.file.slot !== 'final' ||
      createHash('sha256').update(content).digest('hex') !==
        opened.file.contentSha256
    ) {
      return UNAVAILABLE;
    }
    if (contentType !== PDF_TYPE)
      return { pages: [inlineImage(contentType, content)] };

    const pages = await renderPdfArtwork(content);
    return {
      pages: pages.slice(0, MAX_PDF_PREVIEW_PAGES),
      ...(pages.length > MAX_PDF_PREVIEW_PAGES
        ? {
            notice:
              'Prévia das primeiras quatro páginas. Consulte a arte completa no pedido.',
          }
        : {}),
    };
  } catch (error) {
    const status = /** @type {{statusCode?: number}} */ (error)?.statusCode;
    const code = /** @type {{code?: string}} */ (error)?.code;
    if (status === 403 || (status === 404 && code !== 'FILE_NOT_FOUND'))
      throw error;
    return UNAVAILABLE;
  } finally {
    activeReads -= 1;
  }
}

/** @param {import('node:stream').Readable} stream @param {number} expectedBytes */
async function readArtwork(stream, expectedBytes) {
  const timeout = setTimeout(
    () => stream.destroy(new Error('Artwork read timed out')),
    8_000,
  );
  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_ORDER_FILE_BYTES || bytes > expectedBytes) {
        throw new Error('Invalid artwork size');
      }
      chunks.push(chunk);
    }
    if (bytes === 0 || bytes !== expectedBytes)
      throw new Error('Incomplete artwork');
    return Buffer.concat(chunks, bytes);
  } finally {
    clearTimeout(timeout);
  }
}

/** @param {string} contentType @param {Buffer} content */
function inlineImage(contentType, content) {
  return `data:${contentType};base64,${content.toString('base64')}`;
}

/** @param {Buffer} content */
async function renderPdfArtwork(content) {
  // An extra page tells the sheet whether it must point to the full file.
  // Poppler emits sequential PNGs to stdout without writing either file to disk.
  const output = await /** @type {Promise<Buffer>} */ (
    new Promise((resolve, reject) => {
      const child = execFile(
        'pdftoppm',
        [
          '-f',
          '1',
          '-l',
          String(MAX_PDF_PREVIEW_PAGES + 1),
          '-scale-to',
          '1100',
          '-hide-annotations',
          '-png',
          '-',
        ],
        {
          encoding: 'buffer',
          maxBuffer: 20 * 1024 * 1024,
          timeout: 8_000,
          killSignal: 'SIGKILL',
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      // A rejected or encrypted document may make the converter exit early.
      child.stdin?.on('error', () => {});
      child.stdin?.end(content);
    })
  );
  const pages = [];
  let offset = 0;
  while (offset < output.length && pages.length <= MAX_PDF_PREVIEW_PAGES) {
    const end = pngEnd(output, offset);
    pages.push(inlineImage('image/png', output.subarray(offset, end)));
    offset = end;
  }
  if (!pages.length || offset !== output.length)
    throw new Error('Incomplete PDF artwork');
  return pages;
}

/** Follow PNG chunk boundaries between pages. @param {Buffer} bytes @param {number} start */
function pngEnd(bytes, start) {
  let cursor = start + PNG_SIGNATURE.length;
  if (bytes.subarray(start, cursor).equals(PNG_SIGNATURE)) {
    while (cursor + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(cursor);
      const end = cursor + 12 + length;
      if (end > bytes.length) break;
      if (
        length === 0 &&
        bytes.toString('ascii', cursor + 4, cursor + 8) === 'IEND'
      )
        return end;
      cursor = end;
    }
  }
  throw new Error('Invalid PDF preview image');
}
