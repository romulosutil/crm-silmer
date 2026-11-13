import { ApiError, request } from './api-client.js';

/** @typedef {{quantity:number|null,description:string,details:string[],sizes:string,unitCents:number|null,subtotalCents:number|null}} ReceiptItem */
/** @typedef {{schema:'order-receipt-v1',orderId:string,number:string,status:'pendente'|'confirmado'|'cancelado',version:number,customerName:string,orderName:string,orderDate:string|null,issuedAt:string,sellerName:string,deliveryOn:string|null,paymentCondition:string|null,isTest:boolean,items:ReceiptItem[],piecesCents:number|null,freightCents:number,totalCents:number|null}} OrderReceipt */

const FINGERPRINT = /^[a-f0-9]{64}$/u;

/** @param {string} orderId @param {AbortSignal} [signal] */
export async function getOrderReceipt(orderId, signal) {
  const response = await request(
    `/api/v1/orders/${encodeURIComponent(orderId)}/receipt`,
    { signal },
  );
  signal?.throwIfAborted();
  const data = response.data;
  if (
    data?.receipt?.schema !== 'order-receipt-v1' ||
    data.receipt.orderId !== orderId ||
    !Number.isSafeInteger(data.receipt.version) ||
    data.receipt.version < 1 ||
    !['pendente', 'confirmado', 'cancelado'].includes(data.receipt.status) ||
    !Array.isArray(data.receipt.items) ||
    typeof data.fingerprint !== 'string' ||
    !FINGERPRINT.test(data.fingerprint)
  ) {
    throw new ApiError(502, { code: 'RECEIPT_INVALID_RESPONSE' });
  }
  return /** @type {{receipt:OrderReceipt,fingerprint:string}} */ (data);
}

/** @param {OrderReceipt} receipt */
export function receiptFilename(receipt) {
  const suffix =
    receipt.status === 'pendente'
      ? '-provisorio'
      : receipt.status === 'cancelado'
        ? '-cancelado'
        : '';
  return `recibo-${receipt.number}${suffix}.pdf`.replace(
    /[^A-Za-z0-9.-]/gu,
    '_',
  );
}

/** @param {OrderReceipt} receipt @param {string} fingerprint @param {AbortSignal} [signal] */
export async function getOrderReceiptPdf(receipt, fingerprint, signal) {
  signal?.throwIfAborted();
  const query = new globalThis.URLSearchParams({
    expectedVersion: String(receipt.version),
    fingerprint,
  });
  const response = await globalThis.fetch(
    `/api/v1/orders/${encodeURIComponent(receipt.orderId)}/receipt/pdf?${query}`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf' },
      signal,
    },
  );
  if (!response.ok) {
    let problem = {};
    try {
      const data = await response.json();
      problem = data?.error ?? data ?? {};
    } catch {
      // A proxy error may have no JSON. Only the status is useful to the UI.
    }
    throw new ApiError(response.status, problem);
  }
  if (!(response.headers.get('content-type') ?? '').includes('application/pdf'))
    throw new ApiError(502, { code: 'RECEIPT_INVALID_RESPONSE' });
  const blob = await response.blob();
  signal?.throwIfAborted();
  return blob;
}
