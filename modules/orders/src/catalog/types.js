// modules/orders/src/catalog/types.js
/**
 * @typedef {'required'|'optional'} FieldRule
 * @typedef {{ rule: FieldRule, label?: string }} ProductField
 * @typedef {{
 *   id: string, label: string, print: string, family: string,
 *   scales: string[], fields: Record<string, ProductField>,
 * }} CatalogProduct
 * @typedef {{
 *   value: string, label: string, group: string, products: string[],
 *   note?: string, swatch?: string,
 * }} CatalogOption
 * @typedef {{ id: string, label: string, sizes: string[], freeText: boolean }} CatalogScale
 * @typedef {{
 *   schemaVersion: 1,
 *   source: { file: string, sha256: string },
 *   products: CatalogProduct[],
 *   lists: Record<string, CatalogOption[]>,
 *   scales: CatalogScale[],
 *   applications: CatalogOption[],
 * }} OrderCatalog
 */
export {};
