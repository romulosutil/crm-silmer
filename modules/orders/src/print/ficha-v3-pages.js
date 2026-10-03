// Pages of the v3 ficha (ADR 017, PIM-12). The browser cannot repeat the
// header with the order number on the pages it breaks by itself, so the
// renderer decides the pages: page 1 takes the summary and the first items,
// every continuation page repeats the header with its page number, and the
// production control follows. Heights are estimated in CSS pixels (96 per
// inch) for Arial or a font with its metrics (the template asks for no other
// font), on the side of caution: an item that might not fit moves to the
// next page instead of spilling onto a page without a header.

/** A4 landscape minus the @page margins (210mm - 9mm - 12mm), in CSS px. */
export const PAGE_HEIGHT = 714;

/** Everything above the first item on page 1: header, summary, trail. */
export const PAGE_ONE_TOP = 236;

/** Everything above the first item on a continuation page. */
export const CONTINUATION_TOP = 74;

const ITEM_GAP = 7;
const CARD_BORDERS = 2;
const CELL_BASE = 30;
const QUANTITY_CELL = 52;
const SIZE_ROW = 36;
const EXTRAS_BASE = 12;
const EXTRAS_LINE = 15;
const FOOTER_BASE = 46;
const FOOTER_MIN = 82;
const OBSERVATION_LINE = 14;

/**
 * Characters per line of each principal point, a conservative guess for
 * uppercase bold text in its column, and the height of a line.
 */
const TEXT = Object.freeze({
  tipo: { perLine: 24, lineHeight: 15 },
  cor: { perLine: 26, lineHeight: 13 },
  estampa: { perLine: 44, lineHeight: 12.5 },
  tecido: { perLine: 28, lineHeight: 13 },
  gola: { perLine: 40, lineHeight: 13 },
});
const SIZES_PER_ROW = 7;
const EXTRAS_PER_LINE = 110;
const OBSERVATION_PER_LINE = 120;

/**
 * Lines a text takes when it wraps at word boundaries and breaks a word that
 * is longer than a line.
 *
 * @param {string} text
 * @param {number} perLine
 */
export function wrappedLines(text, perLine) {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const length = [...word].length;
    if (used > 0 && used + 1 + length <= perLine) {
      used += 1 + length;
      continue;
    }
    if (used > 0) lines += 1;
    lines += Math.ceil(length / perLine) - 1;
    used = length % perLine || perLine;
  }
  return lines;
}

/** @param {string} text @param {{perLine: number, lineHeight: number}} kind */
function cell(text, kind) {
  return CELL_BASE + wrappedLines(text, kind.perLine) * kind.lineHeight;
}

/**
 * @param {{
 *   tipo: string, cor: string, estampa: string, tecido: string, gola: string,
 *   tamanhos: unknown[], adicionais: {label: string, value: string}[],
 * }} item the printable item
 */
export function estimateItemHeight(item) {
  const sizeRows = Math.max(1, Math.ceil(item.tamanhos.length / SIZES_PER_ROW));
  const firstRow = Math.max(
    cell(item.tipo, TEXT.tipo),
    cell(item.cor, TEXT.cor),
    QUANTITY_CELL,
    cell(item.estampa, TEXT.estampa),
  );
  const secondRow = Math.max(
    cell(item.tecido, TEXT.tecido),
    CELL_BASE + sizeRows * SIZE_ROW,
    cell(item.gola, TEXT.gola),
  );
  let extras = 0;
  if (item.adicionais.length > 0) {
    // Each extra is a label and a value that never split across lines.
    let lines = 1;
    let used = 0;
    for (const extra of item.adicionais) {
      const width = Math.min(
        EXTRAS_PER_LINE,
        Math.ceil([...extra.label].length * 0.8) + [...extra.value].length + 4,
      );
      if (used > 0 && used + width > EXTRAS_PER_LINE) {
        lines += 1;
        used = 0;
      }
      used += width;
      lines += Math.ceil(([...extra.value].length + 10) / EXTRAS_PER_LINE) - 1;
    }
    extras = EXTRAS_BASE + lines * EXTRAS_LINE;
  }
  return CARD_BORDERS + firstRow + secondRow + extras;
}

/** The observations and the order total, printed after the last item. */
export function estimateFooterHeight(/** @type {string[]} */ observations) {
  const lines = observations.reduce(
    (total, note) => total + wrappedLines(note, OBSERVATION_PER_LINE),
    0,
  );
  return Math.max(FOOTER_MIN, FOOTER_BASE + lines * OBSERVATION_LINE);
}

/**
 * Item indexes per commercial page. Items go in order and never split; the
 * observations and the total stay with the last item when they fit, or move
 * to a page of their own.
 *
 * @param {Parameters<typeof estimateItemHeight>[0][]} items
 * @param {string[]} observations
 * @param {{firstPageTop?: number}} [options]
 * @returns {number[][]}
 */
export function paginateItems(items, observations, options = {}) {
  /** @type {number[][]} */
  const pages = [[]];
  let used = options.firstPageTop ?? PAGE_ONE_TOP;
  const heights = items.map(estimateItemHeight);
  heights.forEach((height, index) => {
    const page = /** @type {number[]} */ (pages.at(-1));
    const needed = page.length === 0 ? height : ITEM_GAP + height;
    if (page.length > 0 && used + needed > PAGE_HEIGHT) {
      pages.push([index]);
      used = CONTINUATION_TOP + height;
      return;
    }
    page.push(index);
    used += needed;
  });
  const footer = estimateFooterHeight(observations);
  if (used + footer > PAGE_HEIGHT) {
    const last = /** @type {number[]} */ (pages.at(-1));
    const moved = last.length > 1 ? [/** @type {number} */ (last.pop())] : [];
    pages.push(moved);
  }
  return pages;
}
