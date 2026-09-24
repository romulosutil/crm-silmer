// test/helpers/xlsx-fixture.js
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal zip writer, enough to build the workbooks the reader tests read.
 *
 * @param {Array<[string, Buffer]>} entries
 * @param {{deflate?: boolean}} [options]
 */
export function zip(entries, options = {}) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = options.deflate ? deflateRawSync(raw) : raw;
    const method = options.deflate ? 8 : 0;
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** @param {unknown} text */
function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** @param {number} index zero-based column */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * @typedef {string | number | null | {inline: string}} FixtureCell
 * @param {Array<{name: string, rows: FixtureCell[][]}>} sheets
 * @param {{deflate?: boolean}} [options]
 */
export function buildXlsx(sheets, options = {}) {
  /** @type {string[]} */
  const strings = [];
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  /** @param {string} text */
  const shared = (text) => {
    if (!indexOf.has(text)) {
      indexOf.set(text, strings.length);
      strings.push(text);
    }
    return indexOf.get(text);
  };
  /** @param {FixtureCell} value @param {string} ref */
  const cell = (value, ref) => {
    if (value === null || value === '') return '';
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'object') {
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value.inline)}</t></is></c>`;
    }
    return `<c r="${ref}" t="s"><v>${shared(value)}</v></c>`;
  };
  const sheetXml = sheets.map(
    ({ rows }) =>
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((value, c) => cell(value, `${columnName(c)}${r + 1}`))
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
  );
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_sheet, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}</Relationships>`;
  // Built after the sheets, so every string they use is registered.
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
    .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
    .join('')}</sst>`;
  return zip(
    [
      ['xl/workbook.xml', Buffer.from(workbook)],
      ['xl/_rels/workbook.xml.rels', Buffer.from(relationships)],
      ...sheetXml.map(
        (xml, i) =>
          /** @type {[string, Buffer]} */ ([
            `xl/worksheets/sheet${i + 1}.xml`,
            Buffer.from(xml),
          ]),
      ),
      ['xl/sharedStrings.xml', Buffer.from(sharedStrings)],
    ],
    options,
  );
}
