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
 * ADR 031: `rotulo` is how the screen and the printed ficha name the product
 * ("Camisa dry fit"); `nome` and `slug` stay what the site and the checkout
 * send and what each order recorded.
 *
 * @typedef {{nome: string, prazoDiasUteis: number, estampa?: string}} StoreColor
 * @typedef {{
 *   slug: string, nome: string, rotulo: string, tipo: string, publico: string,
 *   malha: string, gola: string, precoCentavos: number,
 *   precoTesteCentavos: number, pecasPorKit: number, quantidadeMaxima?: number,
 *   cores: Readonly<Record<string, Readonly<StoreColor>>>,
 *   tamanhos: Readonly<Record<string, string>>,
 * }} StoreProduct
 */

const STORE_SIZES = Object.freeze({
  eg: 'EG',
  g: 'G',
  gg: 'GG',
  jeg: 'JEGÃO',
  m: 'M',
  p: 'P',
  pp: 'PP',
  xg: 'XG',
  xx: 'XX',
});

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
    rotulo: 'Camisa dry fit',
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
  'bloquinho-22': Object.freeze({
    cores: Object.freeze({
      'branca-amarela': Object.freeze({
        nome: 'Branco',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22 — amarela',
      }),
      'branca-rosa': Object.freeze({
        nome: 'Branco',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22 — rosa',
      }),
      'branca-azul': Object.freeze({
        nome: 'Branco',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22 — azul',
      }),
      'branca-preta': Object.freeze({
        nome: 'Branco',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22 — preta',
      }),
      'branca-verde': Object.freeze({
        nome: 'Branco',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22 — verde',
      }),
    }),
    gola: 'Gola redonda',
    malha: 'Dry fit liso de poliéster',
    nome: 'Bloquinho 22',
    pecasPorKit: 1,
    precoCentavos: 3000,
    precoTesteCentavos: 100,
    publico: 'masculino',
    quantidadeMaxima: 10,
    rotulo: 'Camisa Bloquinho 22',
    slug: 'bloquinho-22',
    tamanhos: STORE_SIZES,
    tipo: 'Camiseta',
  }),
  'bloquinho-22-colorido': Object.freeze({
    cores: Object.freeze({
      amarela: Object.freeze({
        nome: 'Amarelo',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
      'azul-clara': Object.freeze({
        nome: 'Azul-celeste',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
      preta: Object.freeze({
        nome: 'Preto',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
      'rosa-clara': Object.freeze({
        nome: 'Rosa-claro',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
      pink: Object.freeze({
        nome: 'Pink/magenta',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
      verde: Object.freeze({
        nome: 'Verde-bandeira',
        prazoDiasUteis: 1,
        estampa: 'Bloquinho 22',
      }),
    }),
    gola: 'Gola redonda',
    malha: 'Dry fit liso de poliéster',
    nome: 'Bloquinho 22 Colorido',
    pecasPorKit: 1,
    precoCentavos: 3000,
    precoTesteCentavos: 100,
    publico: 'masculino',
    quantidadeMaxima: 10,
    rotulo: 'Camisa Bloquinho 22 Colorido',
    slug: 'bloquinho-22-colorido',
    tamanhos: STORE_SIZES,
    tipo: 'Camiseta',
  }),
});

/** @param {string} slug @returns {Readonly<StoreProduct>|null} */
export function storeProduct(slug) {
  return Object.hasOwn(STORE_PRODUCTS, slug) ? STORE_PRODUCTS[slug] : null;
}

/**
 * ADR 031: the product as people read it — the catalog's `rotulo` for a
 * known slug, else the name the order recorded.
 *
 * @param {{slug?: unknown, nome?: unknown}|null|undefined} produto
 */
export function storeProductLabel(produto) {
  const product =
    typeof produto?.slug === 'string' ? storeProduct(produto.slug) : null;
  if (product) return product.rotulo;
  return typeof produto?.nome === 'string' ? produto.nome.trim() : '';
}

