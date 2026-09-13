import { OrderValidationError } from './errors.js';

// PFI-11: the seller types the final amount in Brazilian format behind a fixed
// "R$" prefix. Thousands use dots in groups of three, cents use a comma; the
// dot-decimal form ("4,820.00") is refused rather than guessed.
const BRL_AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/u;

/** @param {string} [message] */
function invalidAmount(message = 'Use o formato 4.820,00.') {
  return new OrderValidationError(message, 'INVALID_AMOUNT', ['finalAmount']);
}

/**
 * @param {string} text
 * @returns {number} integer cents, always > 0
 */
export function parseBrlAmount(text) {
  if (typeof text !== 'string') throw invalidAmount();
  const match = BRL_AMOUNT.exec(text.trim());
  if (!match) throw invalidAmount();
  const reais = Number(match[1].replaceAll('.', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = reais * 100 + cents;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw invalidAmount('O valor final precisa ser maior que zero.');
  }
  return total;
}

/**
 * @param {number} cents
 * @returns {string} e.g. `4.820,00`
 */
export function formatBrlAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw invalidAmount();
  const reais = Math.trunc(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${reais},${String(cents % 100).padStart(2, '0')}`;
}
