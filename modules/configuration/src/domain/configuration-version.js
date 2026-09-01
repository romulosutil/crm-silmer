import { ConfigurationValidationError } from './errors.js';

const CONFIGURATION_SECTIONS = Object.freeze([
  'channels',
  'fab',
  'featureFlags',
  'pix',
  'recipient',
  'templates',
]);
const FAB = Object.freeze({ code: '01', displayName: 'FAB 01' });
const RECIPIENT = Object.freeze({
  name: 'Rose',
  phoneReference: 'secret://crm/order-recipient-phone',
});
const SECRET_FIELD_NAMES = new Set([
  'key',
  'password',
  'pixKey',
  'rawKey',
  'secret',
  'secretValue',
  'token',
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
    throw new ConfigurationValidationError(`${path} must be an object`);
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
    throw new ConfigurationValidationError(
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
    throw new ConfigurationValidationError(
      `${path} must be a non-empty string`,
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertJsonValue(value, path) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new ConfigurationValidationError(`${path} must be a finite number`);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }

  assertRecord(value, path);
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD_NAMES.has(key)) {
      throw new ConfigurationValidationError(
        `${path}.${key} cannot contain secret material`,
      );
    }
    assertJsonValue(item, `${path}.${key}`);
  }
}

/** @param {Record<string, unknown>} fab */
function assertFab(fab) {
  assertExactKeys(fab, ['code', 'displayName'], 'values.fab');
  if (fab.code !== FAB.code || fab.displayName !== FAB.displayName) {
    throw new ConfigurationValidationError(
      'values.fab must use the approved pilot value FAB 01',
    );
  }
}

/** @param {Record<string, unknown>} pix */
function assertPix(pix) {
  assertExactKeys(pix, ['keyReference', 'maskedKey'], 'values.pix');
  assertNonEmptyString(pix.keyReference, 'values.pix.keyReference');
  assertNonEmptyString(pix.maskedKey, 'values.pix.maskedKey');
  if (!pix.keyReference.startsWith('secret://')) {
    throw new ConfigurationValidationError(
      'values.pix.keyReference must be an opaque secret reference',
    );
  }
  if (!pix.maskedKey.includes('*')) {
    throw new ConfigurationValidationError(
      'values.pix.maskedKey must be masked',
    );
  }
}

/** @param {Record<string, unknown>} recipient */
function assertRecipient(recipient) {
  assertExactKeys(recipient, ['name', 'phoneReference'], 'values.recipient');
  if (
    recipient.name !== RECIPIENT.name ||
    recipient.phoneReference !== RECIPIENT.phoneReference
  ) {
    throw new ConfigurationValidationError(
      'values.recipient must match the approved destination reference',
    );
  }
}

/** @param {Record<string, unknown>} templates */
function assertTemplates(templates) {
  if (Object.keys(templates).length === 0) {
    throw new ConfigurationValidationError(
      'values.templates must contain at least one versioned template',
    );
  }

  for (const [name, template] of Object.entries(templates)) {
    assertRecord(template, `values.templates.${name}`);
    assertExactKeys(
      template,
      ['enabled', 'version'],
      `values.templates.${name}`,
    );
    if (typeof template.enabled !== 'boolean') {
      throw new ConfigurationValidationError(
        `values.templates.${name}.enabled must be boolean`,
      );
    }
    assertNonEmptyString(template.version, `values.templates.${name}.version`);
  }
}

/** @param {Record<string, unknown>} channels */
function assertChannels(channels) {
  assertExactKeys(channels, ['instagram', 'whatsapp'], 'values.channels');
  for (const name of ['instagram', 'whatsapp']) {
    const channel = channels[name];
    assertRecord(channel, `values.channels.${name}`);
    assertExactKeys(channel, ['enabled'], `values.channels.${name}`);
    if (typeof channel.enabled !== 'boolean') {
      throw new ConfigurationValidationError(
        `values.channels.${name}.enabled must be boolean`,
      );
    }
  }
}

/** @param {Record<string, unknown>} featureFlags */
function assertFeatureFlags(featureFlags) {
  if (featureFlags.vendedor_silmer_autonomia_comercial !== false) {
    throw new ConfigurationValidationError(
      'vendedor_silmer_autonomia_comercial must remain disabled in the MVP',
    );
  }

  for (const [name, enabled] of Object.entries(featureFlags)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(name) || typeof enabled !== 'boolean') {
      throw new ConfigurationValidationError(
        `values.featureFlags.${name} must be a boolean flag`,
      );
    }
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * @param {unknown} values
 * @returns {Readonly<Record<string, unknown>>}
 */
export function normalizeConfigurationValues(values) {
  assertRecord(values, 'values');
  assertExactKeys(values, CONFIGURATION_SECTIONS, 'values');
  assertJsonValue(values, 'values');

  assertRecord(values.fab, 'values.fab');
  assertFab(values.fab);
  assertRecord(values.pix, 'values.pix');
  assertPix(values.pix);
  assertRecord(values.recipient, 'values.recipient');
  assertRecipient(values.recipient);
  assertRecord(values.templates, 'values.templates');
  assertTemplates(values.templates);
  assertRecord(values.channels, 'values.channels');
  assertChannels(values.channels);
  assertRecord(values.featureFlags, 'values.featureFlags');
  assertFeatureFlags(values.featureFlags);

  return /** @type {Readonly<Record<string, unknown>>} */ (
    deepFreeze(structuredClone(values))
  );
}

/**
 * @param {{
 *   actorId: string,
 *   createdAt: string,
 *   id: string,
 *   reason: string,
 *   values: unknown,
 *   version: number,
 * }} input
 */
export function createConfigurationVersion(input) {
  assertNonEmptyString(input.id, 'id');
  assertNonEmptyString(input.actorId, 'actorId');
  assertNonEmptyString(input.createdAt, 'createdAt');
  assertNonEmptyString(input.reason, 'reason');
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new ConfigurationValidationError(
      'version must be a positive integer',
    );
  }

  return deepFreeze({
    createdAt: input.createdAt,
    createdBy: input.actorId,
    id: input.id,
    reason: input.reason.trim(),
    values: normalizeConfigurationValues(input.values),
    version: input.version,
  });
}

/**
 * Projects the only configuration fields that channel runtimes may consume.
 * PIX, recipient and template references deliberately stay behind the
 * configuration boundary.
 *
 * @param {{version: number, values: unknown}} configuration
 */
export function createChannelConfiguration(configuration) {
  if (
    !Number.isSafeInteger(configuration?.version) ||
    configuration.version < 1
  ) {
    throw new ConfigurationValidationError(
      'configuration.version must be a positive integer',
    );
  }
  const values = normalizeConfigurationValues(configuration.values);
  return deepFreeze({
    channels: structuredClone(values.channels),
    featureFlags: structuredClone(values.featureFlags),
    version: configuration.version,
  });
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function freezeConfigurationRecord(value) {
  return deepFreeze(value);
}
