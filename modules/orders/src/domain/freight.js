import { OrderInputError, OrderValidationError } from './errors.js';
import { sizePricingSummary } from './size-pricing-composition.js';

// ADR 080 (OLC-05a-j): the order's freight is its own datum, in integer cents,
// and the final amount of an order priced by size is pieces + freight. Zero or
// absent freight is "no freight", never a pendency. Legacy orders (no size
// pricing) and store orders keep freight zero and their stored total.

/** The money limit of the domain, the same one the size subtotals obey. */
export const MAX_FREIGHT_CENTS = Number.MAX_SAFE_INTEGER;

export const FREIGHT_SOURCES = Object.freeze(
  /** @type {const} */ (['seller', 'quote']),
);
/** ADR 080 item 8: the calculation rule an order was last written under. */
export const PRICING_RULES = Object.freeze(
  /** @type {const} */ (['pieces-v1', 'pieces-freight-v1']),
);
export const FREIGHT_PRICING_RULE = 'pieces-freight-v1';

/** @param {string} code @param {string} message */
function refused(code, message) {
  return new OrderValidationError(message, code, ['freightCents']);
}

/**
 * Strict: only a JSON integer number of cents. A negative value, a fraction,
 * text (even numeric), null, NaN or Infinity is refused, never rounded; a
 * value above the domain limit is an overflow.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function parseFreightCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw refused(
      'FREIGHT_INVALID',
      'Informe o frete em centavos inteiros, sem texto.',
    );
  }
  if (value > MAX_FREIGHT_CENTS) {
    throw refused(
      'FREIGHT_OVERFLOW',
      'O frete ultrapassa o limite de valores do pedido.',
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw refused(
      'FREIGHT_INVALID',
      'Informe o frete em centavos inteiros, sem valor negativo ou fração.',
    );
  }
  // -0 is an integer for JavaScript; the order keeps a plain zero.
  return value === 0 ? 0 : value;
}

/**
 * The two forms of the freight command, and only one of them: a value the
 * seller declares, or the identity of a persisted shipping estimate and of
 * its service. An estimate never travels with a price: both forms at once,
 * neither, or anything next to the two identities is a malformed command.
 * The value itself is judged later by `parseFreightCents`.
 *
 * @param {{freightCents?: unknown, quote?: unknown}} input
 * @returns {{freightCents: unknown}|{quote: {quoteId: string, serviceId: number}}}
 */
export function readFreightCommand(input) {
  const byQuote = Object.hasOwn(input, 'quote') && input.quote !== undefined;
  const byValue = Object.hasOwn(input, 'freightCents');
  if (byQuote === byValue) {
    throw new OrderInputError('Inform a value or a quote, never both', [
      'freightCents',
    ]);
  }
  if (!byQuote) return { freightCents: input.freightCents };
  const quote = /** @type {Record<string, unknown>} */ (input.quote);
  if (
    quote === null ||
    typeof quote !== 'object' ||
    Array.isArray(quote) ||
    Object.keys(quote).length !== 2 ||
    typeof quote.quoteId !== 'string' ||
    quote.quoteId === '' ||
    typeof quote.serviceId !== 'number' ||
    !Number.isSafeInteger(quote.serviceId) ||
    quote.serviceId < 1
  ) {
    throw new OrderInputError('quote is invalid', ['quote']);
  }
  return { quote: { quoteId: quote.quoteId, serviceId: quote.serviceId } };
}

/**
 * The freight an order carries. Orders written before the freight existed,
 * legacy orders and store orders have none.
 *
 * @param {{freightCents?: number|null, origin?: string, ficha?: {sizePricing?: unknown}}} order
 * @returns {number}
 */
export function orderFreightCents(order) {
  if (order.origin === 'loja' || order.ficha?.sizePricing === undefined)
    return 0;
  return order.freightCents ?? 0;
}

/**
 * pieces + freight in exact cents. The total stays unknown (null) while the
 * pieces are incomplete: freight alone never makes a total.
 *
 * @param {number|null} piecesCents @param {number} freightCents
 * @returns {number|null}
 */
export function orderTotalCents(piecesCents, freightCents) {
  if (piecesCents === null) return null;
  const total = BigInt(piecesCents) + BigInt(parseFreightCents(freightCents));
  if (total > BigInt(MAX_FREIGHT_CENTS)) {
    throw new OrderValidationError(
      'A soma dos subtotais com o frete ultrapassa o limite de valores do pedido.',
      'FREIGHT_OVERFLOW',
      ['freightCents'],
    );
  }
  return Number(total);
}

/**
 * What the order reads as: pieces, freight and total. An order priced by size
 * derives the three; any other order (legacy composition, store) shows its
 * stored total as pieces, with freight zero.
 *
 * @param {{ficha: import('./ficha.js').Ficha, finalAmountCents: number|null, freightCents?: number|null, origin?: string}} order
 * @returns {{piecesCents: number|null, freightCents: number, totalCents: number|null}}
 */
export function orderAmounts(order) {
  if (order.origin === 'loja' || order.ficha.sizePricing === undefined) {
    return {
      freightCents: 0,
      piecesCents: order.finalAmountCents,
      totalCents: order.finalAmountCents,
    };
  }
  const freightCents = orderFreightCents(order);
  const piecesCents = sizePricingSummary(order.ficha).totalCents;
  return {
    freightCents,
    piecesCents,
    totalCents: orderTotalCents(piecesCents, freightCents),
  };
}
