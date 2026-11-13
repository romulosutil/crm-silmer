/* global Response */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOrderReceipt,
  getOrderReceiptPdf,
  receiptFilename,
} from '../apps/edge-web/src/lib/order-receipt.js';

/** @type {import('../apps/edge-web/src/lib/order-receipt.js').OrderReceipt} */
const receipt = {
  schema: 'order-receipt-v1',
  orderId: 'order-1',
  number: '87-CRM',
  status: 'confirmado',
  version: 4,
  customerName: 'Cliente exemplo',
  orderName: '',
  orderDate: null,
  issuedAt: '2026-11-13T01:00:00Z',
  sellerName: 'Vendedor exemplo',
  deliveryOn: null,
  paymentCondition: 'Pix',
  isTest: false,
  items: [],
  piecesCents: 10000,
  freightCents: 0,
  totalCents: 10000,
};
const fingerprint = 'a'.repeat(64);
/** @param {(url:string,options:any)=>Promise<Response>} respond @param {()=>Promise<void>} work */
async function withFetch(respond, work) {
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {typeof fetch} */ (respond);
  try {
    await work();
  } finally {
    globalThis.fetch = original;
  }
}

test('RCP-07/08: preview uses the requested order, same-origin credentials and abort signal', async () => {
  const controller = new AbortController();
  await withFetch(
    async (url, options) => {
      assert.equal(url, '/api/v1/orders/order-1/receipt');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.signal, controller.signal);
      return new Response(JSON.stringify({ receipt, fingerprint }), {
        headers: { 'content-type': 'application/json' },
      });
    },
    async () => {
      assert.deepEqual(await getOrderReceipt('order-1', controller.signal), {
        receipt,
        fingerprint,
      });
    },
  );
});

test('RCP-07: malformed or another order’s preview cannot become the current document', async () => {
  for (const data of [
    { receipt: { ...receipt, orderId: 'another' }, fingerprint },
    { receipt, fingerprint: 'wrong' },
    { receipt: { ...receipt, schema: 'other' }, fingerprint },
  ]) {
    await withFetch(
      async () =>
        new Response(JSON.stringify(data), {
          headers: { 'content-type': 'application/json' },
        }),
      async () => {
        await assert.rejects(getOrderReceipt('order-1'), {
          status: 502,
          code: 'RECEIPT_INVALID_RESPONSE',
        });
      },
    );
  }
});

test('RCP-07: PDF request contains only the preview version/fingerprint and validates the binary response', async () => {
  const controller = new AbortController();
  await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        `/api/v1/orders/order-1/receipt/pdf?expectedVersion=4&fingerprint=${fingerprint}`,
      );
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.headers.Accept, 'application/pdf');
      assert.equal(options.signal, controller.signal);
      return new Response('%PDF-1.4\nsynthetic', {
        headers: { 'content-type': 'application/pdf' },
      });
    },
    async () => {
      assert.equal(
        await (
          await getOrderReceiptPdf(receipt, fingerprint, controller.signal)
        ).text(),
        '%PDF-1.4\nsynthetic',
      );
    },
  );
});

test('RCP-07/08/09: PDF refusals retain status/code, including stale preview, lost access and rate limit', async () => {
  for (const [status, code] of [
    [401, 'INVALID_CREDENTIALS'],
    [403, 'FORBIDDEN'],
    [404, 'ORDER_NOT_FOUND'],
    [409, 'RECEIPT_STALE'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ]) {
    await withFetch(
      async () =>
        new Response(JSON.stringify({ error: { code } }), {
          status: Number(status),
          headers: { 'content-type': 'application/json' },
        }),
      async () => {
        await assert.rejects(getOrderReceiptPdf(receipt, fingerprint), {
          status,
          code,
        });
      },
    );
  }
});

test('RCP-09: proxy/non-PDF success cannot be downloaded as a receipt', async () => {
  await withFetch(
    async () => new Response('proxy failure', { status: 503 }),
    async () => {
      await assert.rejects(getOrderReceiptPdf(receipt, fingerprint), {
        status: 503,
      });
    },
  );
  await withFetch(
    async () =>
      new Response('<html>login</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    async () => {
      await assert.rejects(getOrderReceiptPdf(receipt, fingerprint), {
        status: 502,
        code: 'RECEIPT_INVALID_RESPONSE',
      });
    },
  );
});

test('RCP-07: aborting after body preparation refuses the bytes', async () => {
  const controller = new AbortController();
  await withFetch(
    async () => {
      const response = new Response('%PDF', {
        headers: { 'content-type': 'application/pdf' },
      });
      const read = response.blob.bind(response);
      response.blob = async () => {
        const bytes = await read();
        controller.abort();
        return bytes;
      };
      return response;
    },
    async () => {
      await assert.rejects(
        getOrderReceiptPdf(receipt, fingerprint, controller.signal),
        { name: 'AbortError' },
      );
    },
  );
});

test('RCP-03/06: receipt filenames distinguish state and sanitize the number', () => {
  assert.equal(receiptFilename(receipt), 'recibo-87-CRM.pdf');
  assert.equal(
    receiptFilename({ ...receipt, status: 'pendente' }),
    'recibo-87-CRM-provisorio.pdf',
  );
  assert.equal(
    receiptFilename({ ...receipt, status: 'cancelado' }),
    'recibo-87-CRM-cancelado.pdf',
  );
  assert.equal(
    receiptFilename({ ...receipt, number: '../87"\r\n' }),
    'recibo-.._87___.pdf',
  );
});
