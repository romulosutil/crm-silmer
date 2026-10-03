// Text helpers shared by the printed templates that came after the approved
// v2. `ficha-canonical-v2.js` keeps its own copies: its bytes are locked by
// the approved PDF, so ADR 017 leaves that file untouched.

/** @param {string} value */
export function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** @param {unknown} value */
export function display(value) {
  return escapeHtml(String(value));
}

/**
 * What a text field holds once blanks are discarded: '' for a field nobody
 * filled, for a key a ficha saved before the field existed, or for anything
 * that is not text. Never "null" or "undefined".
 *
 * @param {unknown} value
 */
export function filledText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
