// ADR 022: the bot records how the customer splits the quantity by audience
// ("4 masculinas, 3 femininas e 3 infantis") in `audiences`. The split
// becomes one order item per audience only when the text leaves no doubt:
// every part is one positive whole number next to one known audience, and
// no audience repeats. Anything else ("metade masculina", "infantil
// masculino", a total next to the split, a part without a number, a word
// that is neither) stays with the seller as "Divisão informada".

/** @typedef {'masculino'|'feminino'|'infantil'|'unissex'} Audience */
/** @typedef {{publico: Audience, quantidade: number}} AudiencePart */

// D1: a closed list, so it counts and prints the same everywhere. Kids are
// not split by gender (D2).
export const AUDIENCES = Object.freeze(
  /** @type {const} */ (['masculino', 'feminino', 'infantil', 'unissex']),
);

// Folded words → audience. "Baby look" is a model, not an audience, and
// "meninos"/"meninas" say both age and gender, so neither is here.
const AUDIENCE_WORDS = new Map([
  ...['masculino', 'masculinos', 'masculina', 'masculinas', 'masc'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'masculino']),
  ),
  ...['homem', 'homens'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'masculino']),
  ),
  ...['feminino', 'femininos', 'feminina', 'femininas', 'fem'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'feminino']),
  ),
  ...['mulher', 'mulheres'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'feminino']),
  ),
  ...['infantil', 'infantis', 'crianca', 'criancas', 'kids', 'kid'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'infantil']),
  ),
  ...['unissex', 'unisex'].map(
    (word) => /** @type {[string, Audience]} */ ([word, 'unissex']),
  ),
]);
// Words that only name the pieces and change nothing in the split.
const FILLER_WORDS = new Set([
  'de',
  'do',
  'da',
  'pecas',
  'peca',
  'camisas',
  'camisa',
  'camisetas',
  'camiseta',
  'unidades',
  'unidade',
  'tamanho',
]);
const MAX_AUDIENCES_TEXT = 500;

/** @param {string} text */
function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** @param {string} digits @returns {number|null} */
function count(digits) {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 && value <= 100000
    ? value
    : null;
}

/**
 * One part of the split ("4 masculinas", "feminino: 3", "10 camisas
 * infantis"): exactly one count and one audience, in either order.
 *
 * @param {string} part
 * @returns {AudiencePart|null|undefined} undefined for an empty part
 */
function readPart(part) {
  const words = part.split(/[\s:=-]+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  /** @type {Audience|undefined} */
  let publico;
  /** @type {number|undefined} */
  let quantidade;
  for (const word of words) {
    const audience = AUDIENCE_WORDS.get(word);
    if (audience) {
      if (publico !== undefined) return null;
      publico = audience;
    } else if (/^\d+$/u.test(word)) {
      const value = count(word);
      if (value === null || quantidade !== undefined) return null;
      quantidade = value;
    } else if (!FILLER_WORDS.has(word)) {
      return null;
    }
  }
  return publico !== undefined && quantidade !== undefined
    ? { publico, quantidade }
    : null;
}

/** @param {AudiencePart[]} parts */
function withoutRepeats(parts) {
  const seen = new Set(parts.map((part) => part.publico));
  return seen.size === parts.length ? parts : null;
}

/**
 * The split the customer's text describes, or null when it does not describe
 * one without doubt. Accepts the text the bot records and an object such as
 * `{"masculino": 4, "feminino": 3}`.
 *
 * @param {unknown} value
 * @returns {AudiencePart[]|null}
 */
export function parseAudiences(value) {
  if (typeof value === 'string') {
    if (value.trim() === '' || value.length > MAX_AUDIENCES_TEXT) return null;
    /** @type {AudiencePart[]} */
    const parts = [];
    for (const raw of fold(value).split(/[,;/+\n]|\.(?!\d)|\be\b/u)) {
      const part = readPart(raw.trim());
      if (part === null) return null;
      if (part) parts.push(part);
    }
    return parts.length > 0 ? withoutRepeats(parts) : null;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.entries(/** @type {object} */ (value));
    if (entries.length === 0) return null;
    /** @type {AudiencePart[]} */
    const parts = [];
    for (const [key, raw] of entries) {
      const publico = AUDIENCE_WORDS.get(fold(key).trim());
      const quantidade =
        typeof raw === 'number' || typeof raw === 'string'
          ? count(String(raw).trim())
          : null;
      if (!publico || quantidade === null) return null;
      parts.push({ publico, quantidade });
    }
    return withoutRepeats(parts);
  }
  return null;
}
