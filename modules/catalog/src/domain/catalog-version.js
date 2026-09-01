import { CatalogValidationError } from './errors.js';

/**
 * @typedef {{ code: string, name: string }} CatalogEntry
 * @typedef {{ code: string, name: string, productCode: string }} CatalogModel
 * @typedef {{
 *   products: CatalogEntry[],
 *   models: CatalogModel[],
 *   materials: CatalogEntry[],
 *   techniques: CatalogEntry[],
 * }} CatalogValues
 * @typedef {Readonly<{
 *   id: string,
 *   number: number,
 *   publishedAt: string,
 *   publishedBy: string,
 *   reason: string,
 *   status: 'published',
 *   values: Readonly<CatalogValues>,
 * }>} PublishedCatalogVersion
 */

const VALUE_GROUPS = Object.freeze([
  'materials',
  'models',
  'products',
  'techniques',
]);

/** @param {unknown} value */
function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {asserts value is Record<string, unknown>}
 */
function assertRecord(value, path) {
  if (!isPlainRecord(value)) {
    throw new CatalogValidationError(`${path} must be an object`);
  }
}

/**
 * @param {Record<string, unknown>} value
 * @param {readonly string[]} expected
 * @param {string} path
 */
function assertExactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new CatalogValidationError(
      `${path} must contain only: ${wanted.join(', ')}`,
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {asserts value is string}
 */
function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CatalogValidationError(`${path} must be a non-empty string`);
  }
}

/**
 * @param {unknown} value
 * @param {string} group
 * @param {boolean} modelGroup
 * @returns {Set<string>}
 */
function validateEntries(value, group, modelGroup = false) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CatalogValidationError(`${group} must be a non-empty array`);
  }

  const codes = new Set();
  for (const [index, entry] of value.entries()) {
    const path = `${group}[${index}]`;
    assertRecord(entry, path);
    assertExactKeys(
      entry,
      modelGroup ? ['code', 'name', 'productCode'] : ['code', 'name'],
      path,
    );
    assertNonEmptyString(entry.code, `${path}.code`);
    assertNonEmptyString(entry.name, `${path}.name`);
    if (!/^[A-Z0-9-]{2,32}$/u.test(entry.code)) {
      throw new CatalogValidationError(`${path}.code is invalid`);
    }
    if (entry.name !== entry.name.trim()) {
      throw new CatalogValidationError(`${path}.name must be trimmed`);
    }
    if (modelGroup) {
      assertNonEmptyString(entry.productCode, `${path}.productCode`);
      if (!/^[A-Z0-9-]{2,32}$/u.test(entry.productCode)) {
        throw new CatalogValidationError(`${path}.productCode is invalid`);
      }
    }
    if (codes.has(entry.code)) {
      throw new CatalogValidationError(`${group} contains duplicate codes`);
    }
    codes.add(entry.code);
  }
  return codes;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function immutableCatalogClone(value) {
  return deepFreeze(structuredClone(value));
}

/**
 * @param {unknown} values
 * @returns {Readonly<CatalogValues>}
 */
export function normalizeCatalogValues(values) {
  assertRecord(values, 'values');
  assertExactKeys(values, VALUE_GROUPS, 'values');
  const productCodes = validateEntries(values.products, 'products');
  validateEntries(values.materials, 'materials');
  validateEntries(values.models, 'models', true);
  validateEntries(values.techniques, 'techniques');
  const catalogValues = /** @type {CatalogValues} */ (
    /** @type {unknown} */ (values)
  );

  for (const [index, model] of catalogValues.models.entries()) {
    if (!productCodes.has(model.productCode)) {
      throw new CatalogValidationError(
        `models[${index}] references an unknown product`,
      );
    }
  }

  return /** @type {Readonly<CatalogValues>} */ (immutableCatalogClone(values));
}

/**
 * @param {{
 *   id: string,
 *   number: number,
 *   publishedAt: string,
 *   publishedBy: string,
 *   reason: string,
 *   values: unknown,
 * }} input
 * @returns {PublishedCatalogVersion}
 */
export function createPublishedCatalogVersion(input) {
  assertNonEmptyString(input.id, 'id');
  assertNonEmptyString(input.publishedAt, 'publishedAt');
  assertNonEmptyString(input.publishedBy, 'publishedBy');
  assertNonEmptyString(input.reason, 'reason');
  if (!Number.isSafeInteger(input.number) || input.number < 1) {
    throw new CatalogValidationError('number must be a positive integer');
  }

  return immutableCatalogClone({
    id: input.id,
    number: input.number,
    publishedAt: input.publishedAt,
    publishedBy: input.publishedBy,
    reason: input.reason.trim(),
    status: /** @type {const} */ ('published'),
    values: normalizeCatalogValues(input.values),
  });
}

/**
 * @param {unknown} storedVersion
 * @param {{materialCode: string, modelCode: string, techniqueCode: string}} input
 */
export function createCatalogSelection(storedVersion, input) {
  assertRecord(storedVersion, 'catalogVersion');
  if (storedVersion.status !== 'published') {
    throw new CatalogValidationError('Catalog version is unavailable');
  }
  assertNonEmptyString(storedVersion.id, 'catalogVersion.id');
  const versionNumber = /** @type {number} */ (storedVersion.number);
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new CatalogValidationError('catalogVersion.number is invalid');
  }
  const values = normalizeCatalogValues(storedVersion.values);
  for (const [field, code] of Object.entries(input)) {
    assertNonEmptyString(code, field);
  }

  const model = values.models.find((entry) => entry.code === input.modelCode);
  const material = values.materials.find(
    (entry) => entry.code === input.materialCode,
  );
  const technique = values.techniques.find(
    (entry) => entry.code === input.techniqueCode,
  );
  const product = values.products.find(
    (entry) => entry.code === model?.productCode,
  );
  if (!model || !material || !technique || !product) {
    throw new CatalogValidationError(
      'Selection is outside the catalog version',
    );
  }

  return immutableCatalogClone({
    catalogVersionId: storedVersion.id,
    catalogVersionNumber: versionNumber,
    snapshot: { material, model, product, technique },
  });
}
