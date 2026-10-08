import { createHmac, randomUUID } from 'node:crypto';

import {
  buildStoreOrder,
  matchStoreCatalog,
  parseStoreOrderRequest,
} from '../domain/store-order.js';

/**
 * @typedef {import('../domain/store-order.js').StoreOrderRequest} StoreOrderRequest
 * @typedef {{perIpPerHour: number, perPhonePerDay: number}} StoreOrderLimits
 * @typedef {{
 *   createStoreOrder(
 *     input: import('../ports/contracts.js').CreateStoreOrderInput,
 *     context: {transaction: unknown},
 *   ): Promise<import('../domain/order.js').Order>,
 * }} StoreOrderRepository
 */

export const DEFAULT_STORE_ORDER_LIMITS = Object.freeze({
  perIpPerHour: 5,
  perPhonePerDay: 5,
});

// A whole Brazilian phone, typed in any of the usual ways; anything shorter
// than an area code and a number is not looked up.
const PHONE_QUERY = /^[\d\s()+.-]+$/u;
const BRAZILIAN_PHONE = /^55[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/u;

/**
 * ADR 027: the application side of the site shop. It reads the notice,
 * checks it against the CRM's catalog, builds the locked order and hands it
 * to the repository with the receipt that limits and audits the public
 * route. The IP and the phone only ever leave this service as HMACs.
 *
 * @param {{
 *   repository: StoreOrderRepository,
 *   fabCode: string,
 *   hmacKey: Buffer,
 *   acceptTest: boolean,
 *   limits?: StoreOrderLimits,
 *   clock?: () => Date,
 *   idFactory?: () => string,
 * }} options
 */
export function createStoreOrderService(options) {
  const { acceptTest, fabCode, hmacKey, repository } = options;
  if (typeof repository?.createStoreOrder !== 'function') {
    throw new TypeError('a store order repository is required');
  }
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32) {
    throw new TypeError('hmacKey must be a 32-byte Buffer');
  }
  if (typeof fabCode !== 'string' || fabCode.trim() === '') {
    throw new TypeError('fabCode is required');
  }
  if (typeof acceptTest !== 'boolean') {
    throw new TypeError('acceptTest must be true or false');
  }
  const limits = Object.freeze({
    ...DEFAULT_STORE_ORDER_LIMITS,
    ...options.limits,
  });
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError('store order limits must be positive integers');
    }
  }
  const key = Buffer.from(hmacKey);
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  /** @param {string} purpose @param {string} value */
  function digest(purpose, value) {
    return createHmac('sha256', key)
      .update(`${purpose}:${value}`)
      .digest('hex');
  }

  return Object.freeze({
    limits,

    /** @param {unknown} body @returns {StoreOrderRequest} */
    parse(body) {
      return parseStoreOrderRequest(body);
    },

    /**
     * LOJ-01/LOJ-04..LOJ-06/LOJ-12/LOJ-13: one new store order, inside the
     * transaction of its idempotency record. A refused notice (422, 429)
     * throws, and the transaction rolls the record back with it.
     *
     * @param {{
     *   request: StoreOrderRequest, origin: string, clientIp: string,
     *   bodySha256: string, correlationId: string, transaction: unknown,
     * }} input
     */
    async create(input) {
      const now = clock();
      const match = matchStoreCatalog(input.request, { acceptTest, now });
      const order = buildStoreOrder({
        fabCode,
        id: idFactory(),
        match,
        now,
        request: input.request,
      });
      return repository.createStoreOrder(
        {
          correlationId: input.correlationId,
          limits,
          now,
          order,
          receipt: {
            bodySha256: input.bodySha256,
            ipDigest: digest('ip', input.clientIp),
            origin: input.origin,
            phoneDigest: digest('phone', input.request.customer.phone),
            requestId: input.request.requestId,
          },
        },
        { transaction: input.transaction },
      );
    },

    /**
     * The HMAC a search for a whole phone matches on store orders: "(27)
     * 99999-1234", "27999991234" and "+55 27 99999-1234" find the same one.
     *
     * @param {string} query
     * @returns {string[]}
     */
    phoneDigestsFor(query) {
      if (!PHONE_QUERY.test(query)) return [];
      let digits = query.replace(/\D/gu, '');
      if (digits.length >= 12 && digits.startsWith('55')) {
        digits = digits.slice(2);
      }
      if (digits.startsWith('0')) digits = digits.slice(1);
      const phone = `55${digits}`;
      return BRAZILIAN_PHONE.test(phone) ? [digest('phone', phone)] : [];
    },
  });
}
