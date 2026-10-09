import assert from 'node:assert/strict';
import test from 'node:test';

import {
  instantLabel,
  isStoreOrder,
  leadTimeLabel,
  storePaymentLabel,
  storeReceiptUrl,
} from '../apps/edge-web/src/lib/order-format.js';
import {
  RETURN_QUERY,
  safeReturnPath,
} from '../apps/edge-web/src/lib/return-path.js';

test('LOJ-22: the store payment reads as confirmed by InfinitePay, in São Paulo time', () => {
  const order = {
    gatewayPayment: { confirmedAt: '2026-10-08T02:15:55.000Z' },
    origin: 'loja',
  };
  assert.equal(isStoreOrder(order), true);
  assert.equal(isStoreOrder({ origin: 'atendimento' }), false);
  assert.equal(instantLabel('2026-10-08T02:15:55.000Z'), '07/10/2026 às 23:15');
  assert.equal(instantLabel('não é data'), '');
  assert.equal(
    storePaymentLabel(order),
    'Pago — confirmado pela InfinitePay em 07/10/2026 às 23:15',
  );
  assert.equal(
    storePaymentLabel({ origin: 'loja' }),
    'Pago — confirmado pela InfinitePay',
  );
});

test('LOJ-22: the lead time reads as ready to ship or business days', () => {
  assert.equal(leadTimeLabel(0), 'Pronta entrega');
  assert.equal(leadTimeLabel(1), '1 dia útil');
  assert.equal(leadTimeLabel(10), '10 dias úteis');
  for (const value of [null, undefined, -1, 1.5, '10']) {
    assert.equal(leadTimeLabel(value), '');
  }
});

test('LOJ-22: only an https receipt link is offered', () => {
  const url = 'https://recibo.infinitepay.io/sintetico';
  assert.equal(storeReceiptUrl({ gatewayPayment: { receiptUrl: url } }), url);
  for (const receiptUrl of [null, 'javascript:alert(1)', 'http://x.io']) {
    assert.equal(storeReceiptUrl({ gatewayPayment: { receiptUrl } }), '');
  }
  assert.equal(storeReceiptUrl({}), '');
});

test('LOJ-24: only an internal path of the app is kept for after the login', () => {
  assert.equal(RETURN_QUERY, 'voltar');
  for (const path of [
    '/pedidos/0c3e0e5a-0000-4000-8000-000000000001',
    '/pedidos?origin=loja',
    '/inbox',
  ]) {
    assert.equal(safeReturnPath(path), path);
  }
  for (const path of [
    '',
    '/',
    '/?voltar=/x',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/pedidos',
    'pedidos/1',
    '/pedidos/\u0000',
    `/${'a'.repeat(600)}`,
    ['/pedidos/1'],
    null,
  ]) {
    assert.equal(safeReturnPath(path), null, JSON.stringify(path));
  }
});
