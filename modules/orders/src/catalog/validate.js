import { FIELDS } from './fields.js';

// CAT-06: the shape every generated catalog must have. The import script runs
// it before writing, and the contract test runs it on the versioned file.

const RULES = new Set(['required', 'optional']);
const FIELD_IDS = new Set(FIELDS.map((field) => field.id));
const LIST_IDS = new Set(
  FIELDS.flatMap((field) =>
    field.colorList ? [field.list, field.colorList] : [field.list],
  ),
);

/** @param {boolean} condition @param {string} message @returns {asserts condition} */
function check(condition, message) {
  if (!condition) throw new Error(`Catálogo inválido: ${message}`);
}

/** @param {unknown} value @returns {value is string} */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** @param {any} options @param {string} where @param {Set<string>} productIds */
function checkOptions(options, where, productIds) {
  check(Array.isArray(options), `${where} deve ser lista`);
  for (const option of options) {
    check(
      isText(option?.value) &&
        isText(option.label) &&
        typeof option.group === 'string',
      `${where}: opção malformada ${JSON.stringify(option)}`,
    );
    check(
      Array.isArray(option.products) &&
        option.products.every((/** @type {string} */ id) => productIds.has(id)),
      `${where}: ${option.value} com produto desconhecido`,
    );
    check(
      option.swatch === undefined || /^#[0-9a-f]{6}$/u.test(option.swatch),
      `${where}: ${option.value} com swatch inválido`,
    );
  }
}

/** @param {any} catalog */
export function assertOrderCatalog(catalog) {
  check(catalog?.schemaVersion === 1, 'schemaVersion deve ser 1');
  check(
    isText(catalog.source?.file) &&
      /^[0-9a-f]{64}$/u.test(String(catalog.source?.sha256)),
    'source precisa de file e sha256',
  );
  check(Array.isArray(catalog.scales), 'scales deve ser lista');
  /** @type {Set<string>} */
  const scaleIds = new Set();
  for (const scale of catalog.scales) {
    check(
      isText(scale?.id) && !scaleIds.has(scale.id),
      `escala com id inválido ou repetido: ${scale?.id}`,
    );
    scaleIds.add(scale.id);
    check(
      isText(scale.label) &&
        typeof scale.freeText === 'boolean' &&
        Array.isArray(scale.sizes) &&
        scale.sizes.every(isText),
      `escala ${scale.id} malformada`,
    );
  }
  check(Array.isArray(catalog.products), 'products deve ser lista');
  /** @type {Set<string>} */
  const productIds = new Set();
  for (const product of catalog.products) {
    check(
      isText(product?.id) && !productIds.has(product.id),
      `produto com id inválido ou repetido: ${product?.id}`,
    );
    productIds.add(product.id);
    check(
      isText(product.label) &&
        isText(product.print) &&
        typeof product.family === 'string',
      `produto ${product.id} sem label, print ou family`,
    );
    check(
      Array.isArray(product.scales) &&
        product.scales.every((/** @type {string} */ id) => scaleIds.has(id)),
      `produto ${product.id} com escala desconhecida`,
    );
    for (const [fieldId, setting] of Object.entries(product.fields ?? {})) {
      check(
        FIELD_IDS.has(fieldId),
        `produto ${product.id} com campo ${fieldId}`,
      );
      check(
        RULES.has(/** @type {any} */ (setting).rule),
        `produto ${product.id}.${fieldId} com regra inválida`,
      );
      const label = /** @type {any} */ (setting).label;
      check(
        label === undefined || isText(label),
        `produto ${product.id}.${fieldId} com rótulo vazio`,
      );
    }
  }
  check(
    catalog.lists !== null && typeof catalog.lists === 'object',
    'lists deve ser objeto',
  );
  for (const listId of LIST_IDS) {
    check(Array.isArray(catalog.lists[listId]), `lista ${listId} ausente`);
  }
  for (const [listId, options] of Object.entries(catalog.lists)) {
    check(LIST_IDS.has(listId), `lista desconhecida ${listId}`);
    checkOptions(options, listId, productIds);
  }
  checkOptions(catalog.applications, 'applications', productIds);
}
