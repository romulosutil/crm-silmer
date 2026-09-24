// scripts/lib/xlsx-reader.mjs
import { inflateRawSync } from 'node:zlib';

// Just enough of the Office Open XML spreadsheet format to read the option
// sheet this repo imports: cell text only, no styles and no formula
// evaluation (a formula cell yields its cached value, or '' without one).

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
});

/**
 * @param {Buffer} bytes
 * @returns {Map<string, Buffer>}
 */
export function unzip(bytes) {
  let end = -1;
  const floor = Math.max(0, bytes.length - 65_557);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new Error('Not a zip file: end of central directory not found');
  }
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) {
      throw new Error('Corrupt zip: bad central directory entry');
    }
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    if (bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`Corrupt zip: bad local header for ${name}`);
    }
    const dataStart =
      localOffset +
      30 +
      bytes.readUInt16LE(localOffset + 26) +
      bytes.readUInt16LE(localOffset + 28);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression ${method} in ${name}`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** @param {string} text */
function decodeXml(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (_match, /** @type {string} */ code) => {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#'))
        return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[
        /** @type {keyof typeof ENTITIES} */ (code.toLowerCase())
      ];
    },
  );
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'u').exec(tag);
  return match ? decodeXml(match[1]) : null;
}

/** Every `<t>` run of a string item, joined (rich text keeps its words). @param {string} xml */
function texts(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

/** @param {string} xml */
function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/gu)].map((match) =>
    texts(match[1] ?? ''),
  );
}

/** @param {string} xml */
function parseRelationships(xml) {
  return new Map(
    [...xml.matchAll(/<Relationship\b[^>]*>/gu)].map(([tag]) => [
      attribute(tag, 'Id') ?? '',
      attribute(tag, 'Target') ?? '',
    ]),
  );
}

/** @param {string} xml @param {Map<string, string>} relationships */
function parseWorkbook(xml, relationships) {
  return [...xml.matchAll(/<sheet\b[^>]*>/gu)].map(([tag]) => {
    const name = attribute(tag, 'name');
    const id = attribute(tag, 'r:id');
    const target = id ? relationships.get(id) : undefined;
    if (!name || !target) {
      throw new Error(`Workbook sheet without name or target: ${tag}`);
    }
    return {
      name,
      path: target.startsWith('/') ? target.slice(1) : `xl/${target}`,
    };
  });
}

/** @param {string} reference e.g. `AB12` */
function columnIndex(reference) {
  let index = 0;
  for (const char of /^[A-Z]+/u.exec(reference)?.[0] ?? '') {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** @param {string | null} type @param {string} content @param {string[]} shared */
function cellText(type, content, shared) {
  if (type === 'inlineStr') return texts(content);
  const value = /<v>([\s\S]*?)<\/v>/u.exec(content)?.[1];
  if (value === undefined) return '';
  if (type === 's') return shared[Number(value)] ?? '';
  return decodeXml(value);
}

/** @param {string} xml @param {string[]} shared @returns {string[][]} */
function parseSheet(xml, shared) {
  /** @type {string[][]} */
  const rows = [];
  for (const [, rowTag, body = ''] of xml.matchAll(
    /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu,
  )) {
    const rowIndex = Number(attribute(rowTag, 'r')) - 1;
    /** @type {string[]} */
    const cells = [];
    for (const [, cellTag, content = ''] of body.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu,
    )) {
      const reference = attribute(cellTag, 'r');
      const column = reference ? columnIndex(reference) : cells.length;
      cells[column] = cellText(attribute(cellTag, 't'), content, shared);
    }
    rows[rowIndex] = Array.from(cells, (value) => value ?? '');
  }
  return Array.from(rows, (row) => row ?? []);
}

/**
 * @param {Buffer} bytes an .xlsx file
 * @returns {Map<string, string[][]>} sheet name → rows (index 0 is row 1) →
 *   cell text, in workbook order
 */
export function readXlsx(bytes) {
  const files = unzip(bytes);
  /** @param {string} path */
  const text = (path) => {
    const file = files.get(path);
    if (!file) throw new Error(`Missing ${path} in workbook`);
    return file.toString('utf8');
  };
  const shared = parseSharedStrings(
    files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '',
  );
  const relationships = parseRelationships(text('xl/_rels/workbook.xml.rels'));
  /** @type {Map<string, string[][]>} */
  const sheets = new Map();
  for (const { name, path } of parseWorkbook(
    text('xl/workbook.xml'),
    relationships,
  )) {
    sheets.set(name, parseSheet(text(path), shared));
  }
  return sheets;
}
