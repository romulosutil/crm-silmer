import { InboxValidationError } from './errors.js';

export const INBOX_STATES = Object.freeze([
  'nova',
  'em_analise',
  'em_atendimento',
  'requer_atencao',
  'convertida_em_lead',
  'sem_lead',
]);

export const TERMINAL_INBOX_STATES = Object.freeze([
  'convertida_em_lead',
  'sem_lead',
]);

/** @param {unknown} state */
export function assertInboxState(state) {
  if (typeof state !== 'string' || !INBOX_STATES.includes(state)) {
    throw new InboxValidationError('state must be an approved inbox state');
  }
}

/** @param {unknown} state */
export function isTerminalInboxState(state) {
  return typeof state === 'string' && TERMINAL_INBOX_STATES.includes(state);
}

/** @param {unknown} value @param {string} field */
export function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InboxValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

/** @param {unknown} value */
export function requireVersion(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 1) {
    throw new InboxValidationError(
      'expectedVersion must be a positive integer',
    );
  }
  return value;
}

/** @template T @param {T} value @returns {T} */
export function freezeInboxRecord(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeInboxRecord(item);
    Object.freeze(value);
  }
  return value;
}
