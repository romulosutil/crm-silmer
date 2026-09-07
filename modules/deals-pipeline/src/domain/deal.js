import { DealValidationError } from './errors.js';

export const INITIAL_DEAL_STAGE = 'produto';
export const DEAL_STAGES = Object.freeze([
  'produto',
  'especificacao',
  'estampa',
  'logistica',
  'fechamento',
]);

/** @param {string} stage @param {'advance'|'retreat'} direction */
export function deriveDealStage(stage, direction) {
  const index = DEAL_STAGES.indexOf(stage);
  if (index < 0) throw new DealValidationError('Stored deal stage is invalid');
  const targetIndex = direction === 'advance' ? index + 1 : index - 1;
  if (targetIndex < 0 || targetIndex >= DEAL_STAGES.length) return null;
  return DEAL_STAGES[targetIndex];
}

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
