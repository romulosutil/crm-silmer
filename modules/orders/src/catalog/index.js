// The order catalog as both the server and the screen read it. Pure, and it
// imports nothing outside this folder: the frontend imports it too
// (scripts/check-boundaries.mjs holds that line).
import catalog from './order-catalog.data.js';
import { FIELDS, NOT_APPLICABLE } from './fields.js';
import { foldText } from './text.js';

export { FIELDS, NOT_APPLICABLE } from './fields.js';
export { foldText } from './text.js';

/**
 * @typedef {import('./types.js').CatalogProduct} CatalogProduct
 * @typedef {import('./types.js').CatalogOption} CatalogOption
 * @typedef {import('./types.js').CatalogScale} CatalogScale
 * @typedef {import('./types.js').FieldRule} FieldRule
 * @typedef {import('./fields.js').FieldDefinition & { rule: FieldRule }} ItemField
 * @typedef {{ label: string, options: CatalogOption[] }} OptionGroup
 * @typedef {{ field: ItemField, value: string | string[], empty: boolean }} ItemCell
 */

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const ORDER_CATALOG = deepFreeze(catalog);

/** @type {Map<string, CatalogProduct>} */
const PRODUCT_BY_NAME = new Map();
for (const product of ORDER_CATALOG.products) {
  PRODUCT_BY_NAME.set(foldText(product.label), product);
  PRODUCT_BY_NAME.set(foldText(product.print), product);
}
const SCALE_BY_ID = new Map(
  ORDER_CATALOG.scales.map((scale) => [scale.id, scale]),
);

/** Path of every `specs.*` field, e.g. `gola`, `locais`. */
export const SPEC_KEYS = Object.freeze(
  FIELDS.filter((field) => field.path.startsWith('specs.')).map((field) =>
    field.path.slice('specs.'.length),
  ),
);

/** FIT-02 @param {unknown} tipo @returns {CatalogProduct | null} */
export function resolveProduct(tipo) {
  const key = foldText(tipo);
  return key === '' ? null : (PRODUCT_BY_NAME.get(key) ?? null);
}

/**
 * FIT-02/FIT-03: the fields of the item in catalog order, with the product's
 * rule and label; a product outside the catalog gets every field, optional.
 *
 * @param {CatalogProduct | null} product
 * @returns {ItemField[]}
 */
export function itemFields(product) {
  return FIELDS.flatMap((field) => {
    if (!product)
      return [{ ...field, rule: /** @type {FieldRule} */ ('optional') }];
    const setting = product.fields[field.id];
    return setting
      ? [{ ...field, label: setting.label ?? field.label, rule: setting.rule }]
      : [];
  });
}

/** @param {readonly CatalogOption[]} options @returns {OptionGroup[]} */
function grouped(options) {
  /** @type {Map<string, CatalogOption[]>} */
  const groups = new Map();
  for (const option of options) {
    const group = groups.get(option.group) ?? [];
    group.push(option);
    groups.set(option.group, group);
  }
  return [...groups].map(([label, entries]) => ({ label, options: entries }));
}

/** FIT-05 @param {string} listId @param {string | null} productId @returns {OptionGroup[]} */
export function fieldOptions(listId, productId) {
  const options = ORDER_CATALOG.lists[listId] ?? [];
  return grouped(
    options.filter(
      (option) =>
        productId === null ||
        option.products.length === 0 ||
        option.products.includes(productId),
    ),
  );
}

/** FIT-01: products by family, offered as their printed name. @returns {OptionGroup[]} */
export function productOptions() {
  return grouped(
    ORDER_CATALOG.products.map((product) => ({
      value: product.print,
      label: product.label,
      group: product.family,
      products: [],
    })),
  );
}

/** @returns {OptionGroup[]} */
export function applicationOptions() {
  return grouped(ORDER_CATALOG.applications);
}

/** FGR-01 @param {CatalogProduct | null} product @returns {CatalogScale[]} */
export function scalesFor(product) {
  if (!product) return [...ORDER_CATALOG.scales];
  return product.scales.flatMap((id) => {
    const scale = SCALE_BY_ID.get(id);
    return scale ? [scale] : [];
  });
}

/** @param {string} id @returns {CatalogScale | null} */
export function scaleById(id) {
  return SCALE_BY_ID.get(id) ?? null;
}

/**
 * The value of a field in a stored item; an item saved before the catalog
 * has no `specs`, which reads as empty (FIM-07).
 *
 * @param {Record<string, any>} item
 * @param {{path: string, kind: string}} field
 * @returns {string | string[]}
 */
export function readField(item, field) {
  const [head, key] = field.path.split('.');
  const value = key === undefined ? item[head] : item[head]?.[key];
  if (field.kind === 'multi')
    return Array.isArray(value) ? value.map(String) : [];
  return typeof value === 'string' ? value : '';
}

/**
 * The item as reading, the banner and the paper see it. "Não aplicável" is
 * empty for a catalog product (F14): the catalog already says what is missing.
 *
 * @param {Record<string, any>} item
 * @returns {{ product: CatalogProduct | null, cells: ItemCell[] }}
 */
export function describeItem(item) {
  const product = resolveProduct(item.tipo);
  const cells = itemFields(product).map((field) => {
    const raw = readField(item, field);
    const value = Array.isArray(raw)
      ? raw.map((entry) => entry.trim()).filter((entry) => entry !== '')
      : raw.trim();
    const empty = Array.isArray(value)
      ? value.length === 0
      : value === '' || (product !== null && value === NOT_APPLICABLE);
    return { field, value, empty };
  });
  return { product, cells };
}
