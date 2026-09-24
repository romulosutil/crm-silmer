// modules/orders/src/catalog/text.js
/**
 * Text as the catalog compares it: no accents, lower case, and every run of
 * punctuation or spaces as one space ("Azul-marinho" = "AZUL MARINHO").
 *
 * @param {unknown} value
 */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
