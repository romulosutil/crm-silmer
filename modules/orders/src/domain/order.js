import { OrderConflictError, OrderValidationError } from './errors.js';
import { ITEM_REQUIRED_FIELDS } from './ficha.js';

// ADR 006: an order is `pendente` (unofficial draft) or `confirmado`
// (official). The only way forward is a human confirmation and the only way
// back is a reopen; payment, production, time and the agent never move it.

export const ORDER_STATUSES = Object.freeze(
  /** @type {const} */ (['pendente', 'confirmado']),
);
export const PAYMENT_CONDITIONS = Object.freeze(
  /** @type {const} */ (['pix', 'cartao_credito', 'cartao_debito']),
);
// ADR 008: the two days of the order trail that only a person knows.
export const MILESTONE_FIELDS = Object.freeze(
  /** @type {const} */ (['paidOn', 'deliveredOn']),
);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

// D00.6-05: the operation runs on São Paulo time; timestamps persist in UTC.
const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';
const orderDateFormat = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
});

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
 *   firstContactAt: string|null, paidOn: string|null, deliveredOn: string|null,
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

/** @param {unknown} now */
function requireClock(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
}

/** @param {{actorId: string, now: Date}} input */
function requireActorAndClock({ actorId, now }) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TypeError('actorId is required');
  }
  requireClock(now);
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

/**
 * The principal points an item still lacks, as `items[N].<field>`. A size
 * line always carries a quantity above zero, so the grade stands for both the
 * sizes and the quantity.
 *
 * @param {Record<string, unknown>} item @param {number} index
 */
function itemGaps(item, index) {
  return ITEM_REQUIRED_FIELDS.filter((key) => {
    const value = item?.[key];
    if (key === 'grade') return !Array.isArray(value) || value.length === 0;
    if (key === 'malhas') {
      return (
        !Array.isArray(value) ||
        !value.some((entry) => typeof entry === 'string' && entry.trim() !== '')
      );
    }
    return typeof value !== 'string' || value.trim() === '';
  }).map((key) => `items[${index}].${key}`);
}

/**
 * ADR 016 (replaces A01): generating the order needs at least one item, the
 * seven principal points of every item, the final amount and the payment
 * method. Nothing else blocks or is listed: the additional item fields and
 * the summary stay as the seller leaves them.
 *
 * @param {readonly Record<string, any>[]} items
 * @param {unknown} amountCents
 * @param {unknown} paymentCondition
 * @returns {string[]} `items`, `items[N].<field>`, `finalAmount` and
 *   `paymentCondition`, in that order
 */
function confirmationBlockers(items, amountCents, paymentCondition) {
  const blockers =
    items.length === 0
      ? ['items']
      : items.flatMap((item, index) => itemGaps(item, index));
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
 * PFI-09: what still keeps a pending order from being generated. A
 * confirmed order lacks nothing.
 *
 * @param {Pick<Order, 'status'|'ficha'|'finalAmountCents'|'paymentCondition'>} order
 * @returns {string[]}
 */
export function missingForConfirmation(order) {
  if (order.status === 'confirmado') return [];
  return confirmationBlockers(
    order.ficha.items,
    order.finalAmountCents,
    order.paymentCondition,
  );
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

/**
 * A manual day of the trail is null while nobody has recorded it, or a
 * calendar day that has already come in São Paulo.
 *
 * @param {unknown} value @param {string} today
 */
function isMilestoneDay(value, today) {
  if (value === null) return true;
  const match = typeof value === 'string' ? ISO_DAY.exec(value) : null;
  if (!match) return false;
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return day.toISOString().slice(0, 10) === value && match[0] <= today;
}

/**
 * ADR 008: when the customer paid and when the order reached them. A person
 * records both, pending or confirmed, without reopening: neither moves the
 * status nor blocks the confirmation (PCL-08), so a printed ficha stays valid.
 *
 * @param {Order} order
 * @param {{paidOn: unknown, deliveredOn: unknown, now: Date}} input
 * @returns {Order}
 */
export function recordMilestones(order, input) {
  requireClock(input.now);
  const today = orderDateFormat.format(input.now);
  const invalid = MILESTONE_FIELDS.filter(
    (field) => !isMilestoneDay(input[field], today),
  );
  if (invalid.length > 0) {
    throw new OrderValidationError(
      'Use a calendar day that has already come',
      'INVALID_DATE',
      invalid,
    );
  }
  return {
    ...structuredClone(order),
    deliveredOn: /** @type {string|null} */ (input.deliveredOn),
    paidOn: /** @type {string|null} */ (input.paidOn),
    updatedAt: input.now.toISOString(),
  };
}
