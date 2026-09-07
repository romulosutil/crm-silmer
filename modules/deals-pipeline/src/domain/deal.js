import { DealValidationError } from './errors.js';

export const INITIAL_DEAL_STAGE = 'produto';

/** @template T @param {T} value @returns {Readonly<T>} */
export function freezeDealRecord(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDealRecord(nested);
    Object.freeze(value);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
export function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DealValidationError(`${field} must be a non-empty string`);
  }
}

/** @param {unknown} value */
export function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new DealValidationError('expectedVersion must be a positive integer');
  }
}
