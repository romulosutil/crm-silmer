import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dateTimeLabel,
  fichaPrintedLabel,
  instantLabel,
  isStoreOrder,
  leadTimeLabel,
  shortDateTimeLabel,
  storeConfirmationLabel,
  storeFichaPending,
  storeNoticeText,
  storePaymentLabel,
  storeProductLabel,
  storeReceiptUrl,
} from '../apps/edge-web/src/lib/order-format.js';
import {
  RETURN_QUERY,
  safeReturnPath,
} from '../apps/edge-web/src/lib/return-path.js';

test('LOJ-31: the Dashboard notice counts new site orders in the singular and the plural', () => {
  assert.equal(storeNoticeText(0, null), null);
  assert.equal(storeNoticeText(undefined, null), null);
  assert.deepEqual(storeNoticeText(1, '2026-10-08T02:15:55.000Z'), {
    detail:
      'Confirmado e pago por Pix em 07/10, 23:15. Imprima a ficha para começar a produção.',
    title: '1 pedido novo do site',
  });
  assert.deepEqual(storeNoticeText(3, '2026-10-08T02:15:55.000Z'), {
    detail:
      'Confirmados e pagos por Pix, o mais antigo em 07/10, 23:15. Imprima as fichas para começar a produção.',
    title: '3 pedidos novos do site',
  });
  assert.equal(shortDateTimeLabel('não é data'), '');
  assert.equal(dateTimeLabel('2026-10-08T02:15:55.000Z'), '07/10/2026, 23:15');
});

test('LOJ-33/LOJ-34/LOJ-35: a store order reads as confirmed by the site, with its first print', () => {
  const order = {
    confirmedAt: '2026-10-08T02:16:03.000Z',
    ficha: {
      loja: {
        produto: {
          nome: 'Camisa Masculina Lisa Dry Fit',
          slug: 'camisa-masculina-lisa',
        },
      },
    },
    fichaFirstPrintedAt: null,
    fichaFirstPrintedBy: null,
    gatewayPayment: { confirmedAt: '2026-10-08T02:15:55.000Z' },
    isTest: false,
    origin: 'loja',
  };
  assert.equal(storeProductLabel(order), 'Camisa dry fit');
  assert.equal(
    storeProductLabel({
      ficha: { loja: { produto: { nome: 'Outro', slug: 'outro' } } },
    }),
    'Outro',
  );
  assert.equal(
    storeConfirmationLabel(order),
    'Confirmado pela loja do site · 07/10/2026, 23:15',
  );
  assert.equal(storeFichaPending(order), true);
  assert.equal(storeFichaPending({ ...order, isTest: true }), false);
  assert.equal(storeFichaPending({ origin: 'atendimento' }), false);
  assert.equal(fichaPrintedLabel(order), '');
  const printed = {
    ...order,
    fichaFirstPrintedAt: '2026-10-08T12:12:00.000Z',
    fichaFirstPrintedBy: { id: 'user-1', name: 'Rose Sintética' },
  };
  assert.equal(storeFichaPending(printed), false);
  assert.equal(
    fichaPrintedLabel(printed),
    'Ficha impressa por Rose Sintética · 08/10/2026, 09:12',
  );
});

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
