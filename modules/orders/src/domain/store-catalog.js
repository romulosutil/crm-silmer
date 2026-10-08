// ADR 027: what the site shop sells, as the CRM records it. The CRM never
// trusts the price, the kit size or the product description a browser sends;
// it checks them against this catalog and stores this catalog's values. A
// product or price changed on the site (repository `silmer-web`,
// `apps/landingpage/src/data/loja.ts`) changes here first.
//
// Colours and sizes are the CRM vocabulary (`apps/edge-web/src/lib/order-catalog.js`
// and `sizes.js`), keyed by the id the site sends next to them.

/** The automation actor that confirms a store order (RULES 21). */
export const STORE_ACTOR_ID = 'system:loja-do-site';
export const STORE_ACTOR_NAME = 'Loja do site';

/**
 * @typedef {{
 *   slug: string, nome: string, tipo: string, publico: string,
 *   malha: string, gola: string, precoCentavos: number, pecasPorKit: number,
 *   retirada: string,
 *   cores: Readonly<Record<string, string>>,
 *   tamanhos: Readonly<Record<string, string>>,
 * }} StoreProduct
 */

const SILMER_SHOP_ADDRESS =
  'Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES';

/** @type {Readonly<Record<string, Readonly<StoreProduct>>>} */
export const STORE_PRODUCTS = Object.freeze({
  'camisa-masculina-lisa': Object.freeze({
    cores: Object.freeze({
      branca: 'Branco',
      chumbo: 'Grafite/chumbo',
      preta: 'Preto',
    }),
    gola: 'Gola redonda',
    malha: 'Dry fit liso de poliéster',
    nome: 'Camisa Masculina Lisa Dry Fit',
    pecasPorKit: 10,
    precoCentavos: 19364,
    publico: 'masculino',
    retirada: SILMER_SHOP_ADDRESS,
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
