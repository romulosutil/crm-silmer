// ADR 016: the bot records the sizes the way the customer typed them
// ("5 P, 10 M, 8 G", "P5 M10", "25 M e 25G"). They become the item's grade
// only when the text leaves no doubt: every part is a known size next to a
// positive whole number, in either order. Anything else (kids' numeric sizes,
// "10 de cada", a total next to the split, a repeated size, a stray word)
// keeps the grade empty, and the text stays with the seller as "Tamanhos
// informados".

/**
 * @typedef {{tamanho: string, quantidade: number}} GradeLine
 * @typedef {{kind: 'size', size: string} | {kind: 'count', count: number} | {kind: 'break'} | {kind: 'join'}} SizeToken
 */

// The adult letter sizes of the order catalog (RFC 005, section 6.6, and
// `apps/edge-web/src/lib/order-catalog.js`), as the shop floor writes them.
// "Baby look" is a cut of the garment there, not a size, so it is not here.
const LETTER_SIZES = Object.freeze([
  'PP',
  'P',
  'M',
  'G',
  'GG',
  'XG',
  'XGG',
  'EG',
  'EGG',
  'XX',
]);
// Folded spelling → printed spelling.
const SIZE_NAMES = new Map([
  ...LETTER_SIZES.map((size) => /** @type {[string, string]} */ ([size, size])),
  ['JEGAO', 'JEGÃO'],
  ...['G1', 'G2', 'G3', 'G4', 'G5'].map(
    (size) => /** @type {[string, string]} */ ([size, size]),
  ),
]);
const MAX_SIZES_TEXT = 500;

/** @param {string} text */
function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

/** @param {string} digits @returns {number|null} */
function count(digits) {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * One word of the text: a size, a count, or both glued ("10P", "P10",
 * "25GG"). "G15" reads as G and 15, never as G1 and 5: a plus size glued to
 * its count would be unreadable, so G1–G5 only stand alone or after a count.
 *
 * @param {string} word
 * @returns {SizeToken[]|null}
 */
function readWord(word) {
  const size = SIZE_NAMES.get(word);
  if (size) return [{ kind: 'size', size }];
  if (/^\d+$/u.test(word)) {
    const value = count(word);
    return value === null ? null : [{ count: value, kind: 'count' }];
  }
  const countFirst = /^(\d+)([A-Z]+[1-5]?)$/u.exec(word);
  if (countFirst && SIZE_NAMES.has(countFirst[2])) {
    const value = count(countFirst[1]);
    return value === null
      ? null
      : [
          { count: value, kind: 'count' },
          {
            kind: 'size',
            size: /** @type {string} */ (SIZE_NAMES.get(countFirst[2])),
          },
        ];
  }
  const sizeFirst = /^([A-Z]+)(\d+)$/u.exec(word);
  if (sizeFirst && SIZE_NAMES.has(sizeFirst[1])) {
    const value = count(sizeFirst[2]);
    return value === null
      ? null
      : [
          {
            kind: 'size',
            size: /** @type {string} */ (SIZE_NAMES.get(sizeFirst[1])),
          },
          { count: value, kind: 'count' },
        ];
  }
  return null;
}

/**
 * Splits the text into sizes, counts, breaks between pairs (comma,
 * semicolon, slash, plus, full stop, line break or the word "e") and joins
 * inside a pair (colon, equals or hyphen, as in "M: 15" or "P-5").
 *
 * @param {string} text
 * @returns {SizeToken[]|null}
 */
function tokenize(text) {
  /** @type {SizeToken[]} */
  const tokens = [];
  const parts =
    fold(text).match(/[A-Z0-9]+|[,;/+.\n]|[:=-]|[^\S\n]+|./gu) ?? [];
  for (const part of parts) {
    if (/^[^\S\n]+$/u.test(part)) continue;
    if (/^[,;/+.\n]$/u.test(part) || part === 'E') {
      tokens.push({ kind: 'break' });
      continue;
    }
    if (/^[:=-]$/u.test(part)) {
      tokens.push({ kind: 'join' });
      continue;
    }
    if (!/^[A-Z0-9]+$/u.test(part)) return null;
    const read = readWord(part);
    if (!read) return null;
    tokens.push(...read);
  }
  return tokens;
}

/**
 * Pairs the tokens two by two, from the left: each pair is one size and one
 * count, with nothing but a join between them. Breaks may only fall between
 * pairs, and every pair keeps the order of the first one ("5 P, 10 M" or
 * "P5 M10"): "P 5 10 M" mixes them and is left to the seller.
 *
 * @param {SizeToken[]} tokens
 * @returns {GradeLine[]|null}
 */
function pair(tokens) {
  /** @type {GradeLine[]} */
  const grade = [];
  /** @type {string|null} */
  let order = null;
  let index = 0;
  const skipBreaks = () => {
    while (tokens[index]?.kind === 'break') index += 1;
  };
  skipBreaks();
  while (index < tokens.length) {
    const first = tokens[index];
    index += 1;
    if (tokens[index]?.kind === 'join') index += 1;
    const second = tokens[index];
    index += 1;
    if (!first || !second) return null;
    /** @type {{size?: string, count?: number}} */
    const line = {};
    for (const token of [first, second]) {
      if (token.kind === 'size' && line.size === undefined) {
        line.size = token.size;
      } else if (token.kind === 'count' && line.count === undefined) {
        line.count = token.count;
      } else {
        return null;
      }
    }
    if (order !== null && order !== first.kind) return null;
    order = first.kind;
    grade.push({
      quantidade: /** @type {number} */ (line.count),
      tamanho: /** @type {string} */ (line.size),
    });
    // Pairs may also sit side by side, as in "P5 M10".
    skipBreaks();
  }
  return grade;
}

/** @param {GradeLine[]} grade */
function withoutRepeats(grade) {
  const seen = new Set(grade.map((line) => line.tamanho));
  return seen.size === grade.length ? grade : null;
}

/**
 * The grade the customer's sizes describe, or null when they do not describe
 * one without doubt. Accepts the text the bot records, an object such as
 * `{"M": 15, "G": 15}` and the structured list the CRM already read.
 *
 * @param {unknown} value
 * @returns {GradeLine[]|null}
 */
export function parseSizes(value) {
  if (typeof value === 'string') {
    if (value.trim() === '' || value.length > MAX_SIZES_TEXT) return null;
    const tokens = tokenize(value);
    const grade = tokens ? pair(tokens) : null;
    return grade && grade.length > 0 ? withoutRepeats(grade) : null;
  }
  if (Array.isArray(value)) return parseSizeList(value);
  if (value !== null && typeof value === 'object') {
    return parseSizeObject(/** @type {Record<string, unknown>} */ (value));
  }
  return null;
}

/** @param {unknown} value @returns {number|null} */
function countOf(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return typeof value === 'string' && /^\s*\d+\s*$/u.test(value)
    ? count(value.trim())
    : null;
}

/**
 * `{"M": 15, "G": 15}`: every key a known size, every value a positive
 * whole number.
 *
 * @param {Record<string, unknown>} value
 */
function parseSizeObject(value) {
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  /** @type {GradeLine[]} */
  const grade = [];
  for (const [key, raw] of entries) {
    const size = SIZE_NAMES.get(fold(key).trim());
    const quantity = countOf(raw);
    if (!size || quantity === null) return null;
    grade.push({ quantidade: quantity, tamanho: size });
  }
  return withoutRepeats(grade);
}

/**
 * The structured list (`[{tamanho, quantidade}]` or `[{size, quantity}]`)
 * keeps its sizes as written: it already says which number goes with which
 * size.
 *
 * @param {unknown[]} value
 */
function parseSizeList(value) {
  if (value.length === 0) return null;
  /** @type {GradeLine[]} */
  const grade = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      return null;
    }
    const record = /** @type {Record<string, unknown>} */ (entry);
    const size = record.tamanho ?? record.size;
    const quantity = record.quantidade ?? record.quantity;
    const tamanho =
      typeof size === 'string'
        ? size.trim()
        : typeof size === 'number' && Number.isFinite(size)
          ? String(size)
          : '';
    if (
      tamanho === '' ||
      !Number.isSafeInteger(quantity) ||
      /** @type {number} */ (quantity) <= 0
    ) {
      return null;
    }
    grade.push({ quantidade: /** @type {number} */ (quantity), tamanho });
  }
  return grade;
}
