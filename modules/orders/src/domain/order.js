import { OrderConflictError, OrderValidationError } from './errors.js';

// ADR 006: an order is `pendente` (unofficial draft) or `confirmado`
// (official). The only way forward is a human confirmation and the only way
// back is a reopen; payment, production, time and the agent never move it.

export const ORDER_STATUSES = Object.freeze(
  /** @type {const} */ (['pendente', 'confirmado']),
);
export const PAYMENT_CONDITIONS = Object.freeze(
  /** @type {const} */ (['pix', 'cartao_credito', 'cartao_debito']),
);

// D00.6-05: the operation runs on São Paulo time; timestamps persist in UTC.
const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';
const orderDateFormat = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
});

const ITEM_FIELD_ORDER = Object.freeze([
  'tipo',
  'modelo',
  'malhas',
  'cor_frente',
  'cor_costas',
  'cor_manga_direita',
  'cor_manga_esquerda',
  'vies_gola',
  'vies_mangas',
  'grade',
]);
const SUMMARY_FIELD_ORDER = Object.freeze([
  'cliente',
  'data_entrega_confirmada',
  'aplicacao',
  'nome',
]);

/**
 * @typedef {typeof ORDER_STATUSES[number]} OrderStatus
 * @typedef {typeof PAYMENT_CONDITIONS[number]} PaymentCondition
 * @typedef {import('./ficha.js').Ficha} Ficha
 * @typedef {{
 *   id: string, number: string, numberSequence: number,
 *   conversationId: string, status: OrderStatus, fabCode: string,
 *   ficha: Ficha, totalPieces: number, missingFields: string[],
 *   finalAmountCents: number|null, paymentCondition: PaymentCondition|null,
 *   orderDate: string|null, confirmedAt: string|null, confirmedBy: string|null,
 *   reopenedAt: string|null, reopenedBy: string|null,
 *   createdByKind: 'automation'|'user', createdBy: string|null,
 *   version: number, createdAt: string, updatedAt: string,
 * }} Order
 */

/** @param {number} sequence */
export function formatOrderNumber(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new TypeError('order number sequence must be a positive integer');
  }
  return `${String(sequence).padStart(2, '0')}-CRM`;
}

/** @param {{actorId: string, now: Date}} input */
function requireActorAndClock({ actorId, now }) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TypeError('actorId is required');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
}

/** @param {Order} order @param {OrderStatus} expected @param {string} command */
function requireStatus(order, expected, command) {
  if (order.status !== expected) {
    throw new OrderConflictError(
      `Only ${expected} orders can be ${command}`,
      'ORDER_STATUS_CONFLICT',
    );
  }
}

/** @param {readonly {grade: readonly unknown[]}[]} items */
function hasItemWithGrade(items) {
  return items.some((item) => item.grade.length > 0);
}

/**
 * @param {readonly {grade: readonly unknown[]}[]} items
 * @param {unknown} amountCents
 * @param {unknown} paymentCondition
 * @returns {string[]}
 */
function confirmationBlockers(items, amountCents, paymentCondition) {
  const blockers = [];
  if (!hasItemWithGrade(items)) blockers.push('items');
  if (
    !Number.isSafeInteger(amountCents) ||
    /** @type {number} */ (amountCents) <= 0
  ) {
    blockers.push('finalAmount');
  }
  if (
    !PAYMENT_CONDITIONS.includes(
      /** @type {PaymentCondition} */ (paymentCondition),
    )
  ) {
    blockers.push('paymentCondition');
  }
  return blockers;
}

/**
 * A01: confirmation is blocked only by amount, condition and at least one
 * item with grade. Empty ficha fields are listed after the blockers so the
 * banner shows them, but they never block.
 *
 * @param {Order} order
 * @returns {string[]}
 */
export function missingForConfirmation(order) {
  if (order.status === 'confirmado') return [];
  const { items, summary } = order.ficha;
  const missing = confirmationBlockers(
    items,
    order.finalAmountCents,
    order.paymentCondition,
  );
  for (const key of SUMMARY_FIELD_ORDER) {
    const value = summary[/** @type {keyof typeof summary} */ (key)];
    if (value === null || value === '') missing.push(`summary.${key}`);
  }
  items.forEach((item, index) => {
    for (const key of ITEM_FIELD_ORDER) {
      const value = item[/** @type {keyof typeof item} */ (key)];
      if (value === '' || (Array.isArray(value) && value.length === 0)) {
        missing.push(`items[${index}].${key}`);
      }
    }
  });
  return missing;
}

/**
 * @param {Order} order
 * @param {{amountCents: number, paymentCondition: PaymentCondition, actorId: string, now: Date}} input
 * @returns {Order}
 */
export function confirmOrder(order, input) {
  requireActorAndClock(input);
  requireStatus(order, 'pendente', 'confirmed');
  const blockers = confirmationBlockers(
    order.ficha.items,
    input.amountCents,
    input.paymentCondition,
  );
  if (blockers.length > 0) {
    throw new OrderValidationError(
      'The order is not ready to be confirmed',
      'ORDER_NOT_CONFIRMABLE',
      blockers,
    );
  }
  const confirmedAt = input.now.toISOString();
  return {
    ...structuredClone(order),
    confirmedAt,
    confirmedBy: input.actorId,
    finalAmountCents: input.amountCents,
    missingFields: [],
    orderDate: orderDateFormat.format(input.now),
    paymentCondition: input.paymentCondition,
    status: 'confirmado',
    updatedAt: confirmedAt,
  };
}

/**
 * @param {Order} order
 * @param {{actorId: string, now: Date}} input
 * @returns {Order}
 */
export function reopenOrder(order, input) {
  requireActorAndClock(input);
  requireStatus(order, 'confirmado', 'reopened');
  const reopenedAt = input.now.toISOString();
  const reopened = /** @type {Order} */ ({
    ...structuredClone(order),
    reopenedAt,
    reopenedBy: input.actorId,
    status: 'pendente',
    updatedAt: reopenedAt,
  });
  return { ...reopened, missingFields: missingForConfirmation(reopened) };
}
