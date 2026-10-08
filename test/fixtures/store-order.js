// ADR 027: the site shop's contract v1 notice, as `silmer-web` sends it
// (`apps/landingpage/src/lib/pedido-loja.ts`, `montarPedido`). The customer
// is synthetic: no real name or phone ever lands in a fixture.

export const STORE_REQUEST_ID = '5b0c77ed-8c90-46ce-97a4-d5fc1e0a9308';
export const STORE_ORIGIN = 'https://silmer.com.br';
// 02:15 UTC is 23:15 of the day before in São Paulo.
export const STORE_DECLARED_AT = '2026-10-08T02:15:55.693Z';
export const STORE_NOW = new Date('2026-10-08T02:16:03.000Z');

const BODY = Object.freeze({
  cliente: { nome: 'Cliente Sintetico da Loja', telefone: '5527900000001' },
  item: {
    cor: 'Preto',
    cor_id: 'preta',
    gola: 'Gola redonda',
    malha: 'Dry fit liso de poliéster',
    publico: 'masculino',
    quantidade: 10,
    tamanho: 'M',
    tamanho_id: 'm',
    tipo: 'Camiseta',
  },
  pagamento: { forma: 'pix', informado_pelo_cliente_em: STORE_DECLARED_AT },
  pedido_id: STORE_REQUEST_ID,
  produto: {
    nome: 'Camisa Masculina Lisa Dry Fit',
    slug: 'camisa-masculina-lisa',
  },
  retirada: {
    local:
      'Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES',
  },
  teste: true,
  valor_centavos: 19364,
  versao: '1',
});

/**
 * A fresh copy of the notice; `change` edits it in place before it is
 * returned, so each test states only what it breaks.
 *
 * @param {(body: any) => void} [change]
 * @returns {any}
 */
export function storeOrderBody(change) {
  const body = structuredClone(BODY);
  change?.(body);
  return body;
}
