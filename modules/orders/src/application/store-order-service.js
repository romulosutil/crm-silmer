import { createHmac, randomUUID } from 'node:crypto';

import {
  buildStoreOrder,
  matchStoreCatalog,
  parseStoreOrderRecord,
  StoreOrderDuplicateError,
  StoreOrderError,
  storeRecordFingerprint,
} from '../domain/store-order.js';

/**
 * @typedef {import('../domain/store-order.js').StoreOrderRecord} StoreOrderRecord
 * @typedef {import('../ports/contracts.js').StoreOrderRepository} StoreOrderRepository
 * @typedef {import('../ports/contracts.js').StoredStoreOrder} StoredStoreOrder
 * @typedef {import('../domain/order.js').Order} Order
 * @typedef {{order: Order, created: boolean, receiptAttached: boolean}} StoreOrderOutcome
 */

// A whole Brazilian phone, typed in any of the usual ways; anything shorter
// than an area code and a number is not looked up.
const PHONE_QUERY = /^[\d\s()+.-]+$/u;
const BRAZILIAN_PHONE = /^55[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/u;

/**
 * ADR 028: the application side of the paid store order. The `pedido_id` is
 * the natural key: a retry with the same data answers the order already
 * recorded, before the catalog is consulted, so a later price change never
 * turns a retry into a refusal; the receipt link that arrives later is
 * attached; any other difference is a conflict. Only a new order is checked
 * against the catalog and built. The phone only leaves this service as an
 * HMAC.
 *
 * @param {{
 *   repository: StoreOrderRepository,
 *   fabCode: string,
 *   hmacKey: Buffer,
 *   acceptTest: boolean,
 *   clock?: () => Date,
 *   idFactory?: () => string,
 * }} options
 */
export function createStoreOrderService(options) {
  const { acceptTest, fabCode, hmacKey, repository } = options;
  for (const method of [
    'attachStoreReceipt',
    'createStoreOrder',
    'findStoreOrder',
  ]) {
    if (
      typeof (/** @type {Record<string, unknown>} */ (repository)?.[method]) !==
      'function'
    ) {
      throw new TypeError(`a store order repository must implement ${method}`);
    }
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
  const key = Buffer.from(hmacKey);
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  /** @param {string} purpose @param {string} value */
  function digest(purpose, value) {
    return createHmac('sha256', key)
      .update(`${purpose}:${value}`)
      .digest('hex');
  }

  /**
   * LOJ-17: answers a retry from the order already recorded.
   *
   * @param {StoredStoreOrder} existing
   * @param {StoreOrderRecord} record
   * @param {string} fingerprint
   * @param {{actor: string, correlationId: string}} audit
   * @returns {Promise<StoreOrderOutcome>}
   */
  async function reconcile(existing, record, fingerprint, audit) {
    if (existing.recordSha256 !== fingerprint) {
      throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
    }
    const stored = existing.order.ficha?.loja?.comprovanteUrl ?? null;
    const sent = record.payment.receiptUrl;
    if (sent === null || sent === stored) {
      return { created: false, order: existing.order, receiptAttached: false };
    }
    if (stored !== null) {
      throw new StoreOrderError(409, 'STORE_ORDER_CONFLICT');
    }
    const { attached, order } = await repository.attachStoreReceipt({
      audit,
      now: clock(),
      orderId: existing.order.id,
      receiptUrl: sent,
    });
    return { created: false, order, receiptAttached: attached };
  }

  return Object.freeze({
    /** @param {unknown} body @returns {StoreOrderRecord} */
    parse(body) {
      return parseStoreOrderRecord(body);
    },

    /**
     * LOJ-15/LOJ-17..LOJ-21: records the paid order once. A refused record
     * (409, 422, 400 for the instant) throws before anything is written.
     *
     * @param {{record: StoreOrderRecord, actor: string, correlationId: string}} input
     * @returns {Promise<StoreOrderOutcome>}
     */
    async record(input) {
      const { record } = input;
      const fingerprint = storeRecordFingerprint(record);
      const audit = { actor: input.actor, correlationId: input.correlationId };
      const existing = await repository.findStoreOrder(record.requestId);
      if (existing) return reconcile(existing, record, fingerprint, audit);

      const now = clock();
      const match = matchStoreCatalog(record, { acceptTest, now });
      const order = buildStoreOrder({
        fabCode,
        id: idFactory(),
        match,
        now,
        record,
      });
      try {
        const saved = await repository.createStoreOrder({
          audit,
          now,
          order,
          receipt: {
            phoneDigest: digest('phone', record.customer.phone),
            recordSha256: fingerprint,
            requestId: record.requestId,
          },
        });
        return { created: true, order: saved, receiptAttached: false };
      } catch (error) {
        // A concurrent retry recorded the same pedido_id first.
        if (!(error instanceof StoreOrderDuplicateError)) throw error;
        const raced = await repository.findStoreOrder(record.requestId);
        if (!raced) throw error;
        return reconcile(raced, record, fingerprint, audit);
      }
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
