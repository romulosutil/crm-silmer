import {
  CONTINUATION_TOP,
  PAGE_HEIGHT,
  PAGE_ONE_TOP,
  estimateItemHeight,
  paginateItems,
  wrappedLines,
} from './ficha-v3-pages.js';

/** Split only overlong notes; preserve every character and its order. @param {string} note */
function chunks(note) {
  const result = [];
  let chunk = '';
  let size = 0;
  let newlines = 0;
  for (const char of note) {
    chunk += char;
    size += 1;
    if (char === '\n' || char === '\r') newlines += 1;
    if (size >= 600 || newlines >= 20) {
      result.push(chunk);
      chunk = '';
      size = 0;
      newlines = 0;
    }
  }
  if (chunk) result.push(chunk);
  return result;
}

/** Match pre-wrap: explicit newlines and repeated spaces consume paper. @param {string[]} notes */
export function estimateFactoryNotesHeight(notes) {
  const lines = notes.reduce(
    (sum, note) =>
      sum +
      note
        .replace(/\r\n?/gu, '\n')
        .split('\n')
        .reduce((count, line) => {
          const expanded = line.replaceAll('\t', '        ');
          return (
            count +
            Math.max(
              1,
              wrappedLines(expanded, 100),
              Math.ceil([...expanded].length / 100),
            )
          );
        }, 0),
    0,
  );
  return Math.max(82, 54 + lines * 14);
}

/**
 * FIP-02: keep the existing item layout, and continue observations in the
 * same footer block when the collected instructions need more paper.
 * @param {Parameters<typeof estimateItemHeight>[0][]} items
 * @param {string[]} observations
 * @param {{firstPageTop?: number, continuationTop?: number}} [options]
 */
export function paginateFactoryItems(items, observations, options = {}) {
  const pages = paginateItems(items, [], options).map((indexes) => ({
    items: indexes,
    observations: /** @type {string[]} */ ([]),
    start: 1,
  }));
  let number = 1;
  for (const note of observations.flatMap(chunks)) {
    let page = pages[pages.length - 1];
    const top =
      pages.length === 1
        ? (options.firstPageTop ?? PAGE_ONE_TOP)
        : (options.continuationTop ?? CONTINUATION_TOP);
    const used =
      top +
      page.items.reduce(
        (sum, index) => sum + estimateItemHeight(items[index]),
        0,
      ) +
      Math.max(0, page.items.length - 1) * 8;
    // Extra margin covers headings and wrapped long tokens in the notes.
    if (
      used + estimateFactoryNotesHeight([...page.observations, note]) + 24 >
      PAGE_HEIGHT
    ) {
      page = { items: [], observations: [], start: number };
      pages.push(page);
    }
    page.observations.push(note);
    number += 1;
  }
  return pages;
}
