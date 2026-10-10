// ADR 028: the paid store order as the n8n checkout workflow records it,
// after InfinitePay confirms the Pix (`payment_check`). The customer and the
// gateway identifiers are synthetic: no real name, phone, NSU or receipt
// ever lands in a fixture.

export const STORE_REQUEST_ID = '5b0c77ed-8c90-46ce-97a4-d5fc1e0a9308';
export const STORE_NUMBER = 'LJ-5B0C77ED';
// 02:15 UTC is 23:15 of the day before in São Paulo.
export const STORE_PAID_AT = '2026-10-08T02:15:55Z';
export const STORE_NOW = new Date('2026-10-08T02:16:03.000Z');
export const STORE_RECEIPT_URL =
  'https://recibo.infinitepay.io/sintetico-5b0c77ed';

const BODY = Object.freeze({
  cliente: { nome: 'Cliente Sintetico da Loja', telefone: '5527900000001' },
  item: { cor_id: 'preta', prazo_dias: 10, quantidade: 10, tamanho_id: 'm' },
  numero_loja: STORE_NUMBER,
  pagamento: {
    forma: 'pix',
    gateway: 'infinitepay',
    invoice_slug: 'fatura-sintetica-1',
    pago_em: STORE_PAID_AT,
    receipt_url: null,
    transaction_nsu: 'nsu-sintetico-0001',
    valor_pago_centavos: 18000,
  },
  pedido_id: STORE_REQUEST_ID,
  produto: { slug: 'camisa-masculina-lisa' },
  schema_version: '1.0',
  teste: false,
  valor_centavos: 18000,
});

/**
 * A fresh copy of the record; `change` edits it in place before it is
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

/**
 * Another paid order: its own `pedido_id`, store number and NSU.
 *
 * @param {number} index 1..9999
 * @param {(body: any) => void} [change]
 */
export function otherStoreOrderBody(index, change) {
  const suffix = String(index).padStart(4, '0');
  return storeOrderBody((body) => {
    body.pedido_id = `${suffix}abcd-8c90-46ce-97a4-d5fc1e0a9308`;
    body.numero_loja = `LJ-${suffix}ABCD`;
    body.pagamento.transaction_nsu = `nsu-sintetico-${suffix}`;
    change?.(body);
  });
}
