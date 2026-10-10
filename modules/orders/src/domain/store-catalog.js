// ADRs 027 and 028: what the site shop sells, as the CRM records it. The CRM
// never trusts the price, the kit size or the lead time that a caller sends;
// it checks them against this catalog and stores this catalog's values. A
// product, price or lead time changed on the site (repository `silmer-web`)
// or in the n8n checkout workflow changes here first.
//
// Colours and sizes are the CRM vocabulary (`apps/edge-web/src/lib/order-catalog.js`
// and `sizes.js`), keyed by the id the site and the checkout send.

/** The system that confirms a store order on the gateway's word (RULES 21). */
export const STORE_ACTOR_ID = 'system:loja-do-site';
export const STORE_ACTOR_NAME = 'Loja do site';

/** ADR 028: the one gateway and the one method the shop takes. */
export const STORE_PAYMENT_GATEWAY = 'infinitepay';
export const STORE_PAYMENT_METHOD = 'pix';

/**
 * @typedef {{nome: string, prazoDiasUteis: number}} StoreColor
 * @typedef {{
 *   slug: string, nome: string, tipo: string, publico: string,
 *   malha: string, gola: string, precoCentavos: number,
 *   precoTesteCentavos: number, pecasPorKit: number,
 *   cores: Readonly<Record<string, Readonly<StoreColor>>>,
 *   tamanhos: Readonly<Record<string, string>>,
 * }} StoreProduct
 */

/** @type {Readonly<Record<string, Readonly<StoreProduct>>>} */
export const STORE_PRODUCTS = Object.freeze({
  'camisa-masculina-lisa': Object.freeze({
    // ADR 028: white is ready to ship; graphite and black take 10 business
    // days.
    cores: Object.freeze({
      branca: Object.freeze({ nome: 'Branco', prazoDiasUteis: 0 }),
      chumbo: Object.freeze({ nome: 'Grafite/chumbo', prazoDiasUteis: 10 }),
      preta: Object.freeze({ nome: 'Preto', prazoDiasUteis: 10 }),
    }),
    gola: 'Gola redonda',
    malha: 'Dry fit liso de poliéster',
    nome: 'Camisa Masculina Lisa Dry Fit',
    pecasPorKit: 10,
    precoCentavos: 18000,
    // A test order (STORE_ORDERS_ACCEPT_TEST) may be paid with R$ 1,00.
    precoTesteCentavos: 100,
    publico: 'masculino',
    slug: 'camisa-masculina-lisa',
    tamanhos: Object.freeze({
      eg: 'EG',
      g: 'G',
      gg: 'GG',
      jeg: 'JEGÃO',
      m: 'M',
      p: 'P',
      pp: 'PP',
      xg: 'XG',
      xx: 'XX',
    }),
    tipo: 'Camiseta',
  }),
});

/** @param {string} slug @returns {Readonly<StoreProduct>|null} */
export function storeProduct(slug) {
  return Object.hasOwn(STORE_PRODUCTS, slug) ? STORE_PRODUCTS[slug] : null;
}
