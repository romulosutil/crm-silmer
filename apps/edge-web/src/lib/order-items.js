import {
  FIELDS,
  foldText,
  itemFields,
  resolveProduct,
} from './order-catalog.js';

// Pure helpers for the item draft of the order page (ficha por produto).

const COMPOSITE_SEPARATOR = ' · ';
const CORE_TEXT_FIELDS = FIELDS.filter(
  (field) => !field.path.startsWith('specs.') && field.kind !== 'multi',
);

/**
 * A copy the form can edit; an item saved before the catalog gets the new
 * keys, and at least one fabric input.
 *
 * @param {Record<string, any>} item
 */
export function draftItem(item) {
  return {
    ...item,
    escala: typeof item.escala === 'string' ? item.escala : '',
    outras: typeof item.outras === 'string' ? item.outras : '',
    malhas:
      Array.isArray(item.malhas) && item.malhas.length > 0
        ? [...item.malhas]
        : [''],
    specs: { ...(item.specs ?? {}) },
    grade: (item.grade ?? []).map(
      (/** @type {Record<string, any>} */ line) => ({ ...line }),
    ),
  };
}

export function emptyItem() {
  return draftItem({
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    grade: [{ quantidade: 1, tamanho: '' }],
    malhas: [''],
    modelo: '',
    tipo: '',
    vies_gola: '',
    vies_mangas: '',
  });
}

/**
 * @typedef {{
 *   tipo: string, modelo: string, malhas: string[],
 *   cor_frente: string, cor_costas: string,
 *   cor_manga_direita: string, cor_manga_esquerda: string,
 *   vies_gola: string, vies_mangas: string,
 *   specs: Record<string, string | string[]>, escala: string, outras: string,
 *   grade: {quantidade: number, tamanho: string}[],
 * }} ItemPayload
 */

/**
 * What "Salvar itens" sends: fields the product lacks go empty (FIT-04),
 * grade lines left without a quantity are dropped (FGR-02), text is trimmed.
 *
 * @param {Record<string, any>} item
 * @returns {ItemPayload}
 */
export function itemPayload(item) {
  const kept = new Set(
    itemFields(resolveProduct(item.tipo)).map((field) => field.id),
  );
  /** @type {Record<string, string | string[]>} */
  const specs = {};
  for (const field of FIELDS) {
    if (!field.path.startsWith('specs.') || !kept.has(field.id)) continue;
    const key = field.path.slice('specs.'.length);
    const value = item.specs?.[key];
    if (field.kind === 'multi') {
      const values = (Array.isArray(value) ? value : [])
        .map((entry) => String(entry).trim())
        .filter((entry) => entry !== '');
      if (values.length > 0) specs[key] = values;
    } else if (String(value ?? '').trim() !== '') {
      specs[key] = String(value).trim();
    }
  }
  /** @type {Record<string, string>} */
  const core = {};
  for (const field of CORE_TEXT_FIELDS) {
    core[field.path] = kept.has(field.id) ? String(item[field.path] ?? '') : '';
  }
  return /** @type {ItemPayload} */ ({
    ...core,
    tipo: String(item.tipo ?? ''),
    malhas: (item.malhas ?? [])
      .map((/** @type {unknown} */ malha) => String(malha).trim())
      .filter((/** @type {string} */ malha) => malha !== ''),
    specs,
    escala: String(item.escala ?? ''),
    outras: String(item.outras ?? '').trim(),
    grade: (item.grade ?? [])
      .filter(
        (/** @type {Record<string, any>} */ line) =>
          String(line.quantidade ?? '').trim() !== '',
      )
      .map((/** @type {Record<string, any>} */ line) => ({
        quantidade: Number(line.quantidade),
        tamanho: String(line.tamanho).trim(),
      })),
  });
}

/**
 * F12: "RIBANA · VERDE" is a finish and a colour; an older free text stays
 * whole in the finish.
 *
 * @param {unknown} value
 * @returns {[string, string]}
 */
export function splitComposite(value) {
  const text = String(value ?? '');
  const at = text.indexOf(COMPOSITE_SEPARATOR);
  return at < 0
    ? [text, '']
    : [text.slice(0, at), text.slice(at + COMPOSITE_SEPARATOR.length)];
}

/** @param {string} finish @param {string} color */
export function joinComposite(finish, color) {
  return [finish.trim(), color.trim()]
    .filter((part) => part !== '')
    .join(COMPOSITE_SEPARATOR);
}

/**
 * FGR-02: picking a scale adds one line per size the grade does not have yet,
 * with no quantity; a line without a size is replaced.
 *
 * @param {Array<Record<string, any>>} grade
 * @param {{sizes: readonly string[]}} scale
 */
export function gradeForScale(grade, scale) {
  const kept = grade.filter((line) => String(line.tamanho ?? '').trim() !== '');
  const present = new Set(kept.map((line) => foldText(line.tamanho)));
  return [
    ...kept,
    ...scale.sizes
      .filter((size) => !present.has(foldText(size)))
      .map((size) => ({ quantidade: '', tamanho: size })),
  ];
}
