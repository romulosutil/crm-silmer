import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORE_ACTOR_ID,
  STORE_PRODUCTS,
} from '../modules/orders/src/domain/store-catalog.js';
import {
  buildStoreOrder,
  matchStoreCatalog,
  parseStoreOrderRecord,
  requireUnlocked,
  storeNumberFor,
  storeRecordFingerprint,
} from '../modules/orders/src/domain/store-order.js';
import {
  STORE_NOW,
  STORE_NUMBER,
  STORE_RECEIPT_URL,
  STORE_REQUEST_ID,
  storeOrderBody,
} from './fixtures/store-order.js';

/** @param {() => unknown} work @param {number} statusCode @param {string} code */
function refuses(work, statusCode, code) {
  assert.throws(work, (error) => {
    assert.equal(/** @type {any} */ (error).statusCode, statusCode);
    assert.equal(/** @type {any} */ (error).code, code);
    return true;
  });
}

const accept = { acceptTest: true, now: STORE_NOW };

/** @param {(body: any) => void} [change] */
function parsed(change) {
  return parseStoreOrderRecord(storeOrderBody(change));
}

test('LOJ-15: reads the record the n8n checkout workflow sends', () => {
  const record = parsed((body) => {
    body.pagamento.receipt_url = STORE_RECEIPT_URL;
  });
  assert.deepEqual(record, {
    amountCents: 18000,
    customer: { name: 'Cliente Sintetico da Loja', phone: '5527900000001' },
    item: { colorId: 'preta', leadTimeDays: 10, quantity: 10, sizeId: 'm' },
    payment: {
      gateway: 'infinitepay',
      invoiceSlug: 'fatura-sintetica-1',
      method: 'pix',
      paidAmountCents: 18000,
      paidAt: '2026-10-08T02:15:55.000Z',
      receiptUrl: STORE_RECEIPT_URL,
      transactionNsu: 'nsu-sintetico-0001',
    },
    product: { slug: 'camisa-masculina-lisa' },
    requestId: STORE_REQUEST_ID,
    storeNumber: STORE_NUMBER,
    test: false,
  });
});

test('LOJ-20: an unknown key is UNKNOWN_REQUEST_FIELD; a missing or mistyped one is INVALID_REQUEST', () => {
  refuses(
    () => parsed((body) => (body.extra = 1)),
    400,
    'UNKNOWN_REQUEST_FIELD',
  );
  refuses(
    () => parsed((body) => (body.pagamento.cartao = 'x')),
    400,
    'UNKNOWN_REQUEST_FIELD',
  );
  refuses(
    () => parsed((body) => (body.item.cor = 'Preto')),
    400,
    'UNKNOWN_REQUEST_FIELD',
  );
  for (const change of [
    (/** @type {any} */ body) => delete body.teste,
    (/** @type {any} */ body) => delete body.pagamento.receipt_url,
    (/** @type {any} */ body) => (body.teste = 'false'),
    (/** @type {any} */ body) => (body.valor_centavos = '18000'),
    (/** @type {any} */ body) => (body.valor_centavos = 0),
    (/** @type {any} */ body) => (body.item.quantidade = 10.5),
    (/** @type {any} */ body) => (body.item.prazo_dias = -1),
    (/** @type {any} */ body) => (body.item.cor_id = ' preta'),
    (/** @type {any} */ body) => (body.produto = ['camisa-masculina-lisa']),
    (/** @type {any} */ body) => (body.pedido_id = 'not-a-uuid'),
    // A version-1 UUID is not what the site generates.
    (/** @type {any} */ body) =>
      (body.pedido_id = '5b0c77ed-8c90-11ce-97a4-d5fc1e0a9308'),
    (/** @type {any} */ body) =>
      (body.pagamento.transaction_nsu = 'nsu com espaço'),
    (/** @type {any} */ body) => (body.pagamento.invoice_slug = ''),
    (/** @type {any} */ body) => (body.pagamento.valor_pago_centavos = null),
    (/** @type {any} */ body) => (body.pagamento.forma = 7),
  ]) {
    refuses(() => parsed(change), 400, 'INVALID_REQUEST');
  }
  refuses(() => parseStoreOrderRecord(null), 400, 'INVALID_REQUEST');
  refuses(() => parseStoreOrderRecord([]), 400, 'INVALID_REQUEST');
  refuses(
    () => parsed((body) => (body.schema_version = '1')),
    400,
    'UNSUPPORTED_SCHEMA_VERSION',
  );
});

test('LOJ-20: the store number is LJ- and the first eight hex digits of the pedido_id', () => {
  assert.equal(storeNumberFor(STORE_REQUEST_ID), 'LJ-5B0C77ED');
  // An upper-case pedido_id is the same order.
  const upper = parsed((body) => {
    body.pedido_id = STORE_REQUEST_ID.toUpperCase();
  });
  assert.equal(upper.requestId, STORE_REQUEST_ID);
  for (const numero of ['LJ-5b0c77ed', 'LJ-5B0C77EE', '5B0C77ED', null]) {
    refuses(
      () => parsed((body) => (body.numero_loja = numero)),
      400,
      'INVALID_STORE_NUMBER',
    );
  }
});

test('LOJ-20: the receipt link is null or https on an InfinitePay host', () => {
  for (const url of [
    'https://infinitepay.io/r/abc',
    'https://recibo.infinitepay.io/abc?x=1',
    'https://infinitepay.com.br/comprovante/abc',
    'https://checkout.infinitepay.com.br/abc',
  ]) {
    const record = parsed((body) => (body.pagamento.receipt_url = url));
    assert.equal(record.payment.receiptUrl, url);
  }
  for (const url of [
    'http://recibo.infinitepay.io/abc',
    'https://infinitepay.io.example.com/abc',
    'https://evilinfinitepay.io/abc',
    'https://infinitepay.io:8443/abc',
    'https://user:secret@infinitepay.io/abc',
    'https://infinitepay.io./abc',
    'javascript:alert(1)',
    'https://infinitepay.io/a b',
    '',
    42,
  ]) {
    refuses(
      () => parsed((body) => (body.pagamento.receipt_url = url)),
      400,
      'INVALID_RECEIPT_URL',
    );
  }
});

test('LOJ-20: pago_em is a real instant in ISO UTC', () => {
  assert.equal(
    parsed((body) => (body.pagamento.pago_em = '2026-10-08T02:15:55.123456Z'))
      .payment.paidAt,
    '2026-10-08T02:15:55.123Z',
  );
  for (const paidAt of [
    '2026-10-08 02:15:55Z',
    '2026-10-08T02:15:55-03:00',
    '2026-10-08T02:15:55',
    '2026-02-30T10:00:00Z',
    '2026-10-08T24:00:00Z',
    1759889755000,
  ]) {
    refuses(
      () => parsed((body) => (body.pagamento.pago_em = paidAt)),
      400,
      'INVALID_PAID_AT',
    );
  }
});

test('LOJ-20: name and phone the checkout could not have sent are INVALID_CUSTOMER', () => {
  assert.equal(
    parsed((body) => (body.cliente.nome = '  Maria   da   Silva ')).customer
      .name,
    'Maria da Silva',
  );
  // A landline is a phone.
  assert.equal(
    parsed((body) => (body.cliente.telefone = '552732001234')).customer.phone,
    '552732001234',
  );
  for (const change of [
    (/** @type {any} */ body) => (body.cliente.nome = 'M'),
    (/** @type {any} */ body) => (body.cliente.nome = 'x'.repeat(81)),
    (/** @type {any} */ body) => (body.cliente.nome = 'Maria\u0000'),
    (/** @type {any} */ body) => (body.cliente.telefone = '+5527900000001'),
    (/** @type {any} */ body) => (body.cliente.telefone = '27900000001'),
    (/** @type {any} */ body) => (body.cliente.telefone = '5527800000001'),
  ]) {
    refuses(() => parsed(change), 400, 'INVALID_CUSTOMER');
  }
});

test('LOJ-18: every colour and size maps to the CRM vocabulary, with the lead time of the colour', () => {
  const product = STORE_PRODUCTS['camisa-masculina-lisa'];
  assert.equal(product.precoCentavos, 18000);
  for (const [colorId, nome, prazo] of /** @type {const} */ ([
    ['branca', 'Branco', 0],
    ['chumbo', 'Grafite/chumbo', 10],
    ['preta', 'Preto', 10],
  ])) {
    const match = matchStoreCatalog(
      parsed((body) => {
        body.item.cor_id = colorId;
        body.item.prazo_dias = prazo;
      }),
      accept,
    );
    assert.equal(match.color.nome, nome);
    assert.equal(match.color.prazoDiasUteis, prazo);
  }
  for (const [sizeId, tamanho] of [
    ['pp', 'PP'],
    ['p', 'P'],
    ['m', 'M'],
    ['g', 'G'],
    ['gg', 'GG'],
    ['eg', 'EG'],
    ['xg', 'XG'],
    ['xx', 'XX'],
    ['jeg', 'JEGÃO'],
  ]) {
    const match = matchStoreCatalog(
      parsed((body) => (body.item.tamanho_id = sizeId)),
      accept,
    );
    assert.equal(match.size, tamanho);
  }
});

test('LOJ-18: anything outside the CRM catalog is STORE_CATALOG_MISMATCH', () => {
  for (const change of [
    (/** @type {any} */ body) => (body.produto.slug = 'camisa-feminina'),
    (/** @type {any} */ body) => (body.produto.slug = 'constructor'),
    (/** @type {any} */ body) => (body.item.cor_id = 'azul'),
    (/** @type {any} */ body) => (body.item.cor_id = 'toString'),
    (/** @type {any} */ body) => (body.item.tamanho_id = 'xxg'),
    (/** @type {any} */ body) => (body.item.quantidade = 20),
    // Black takes ten business days; white is ready to ship.
    (/** @type {any} */ body) => (body.item.prazo_dias = 0),
    (/** @type {any} */ body) => {
      body.item.cor_id = 'branca';
      body.item.prazo_dias = 10;
    },
    // The old price of ADR 027, and the test price on a real order.
    (/** @type {any} */ body) => {
      body.valor_centavos = 19364;
      body.pagamento.valor_pago_centavos = 19364;
    },
    (/** @type {any} */ body) => {
      body.valor_centavos = 100;
      body.pagamento.valor_pago_centavos = 100;
    },
  ]) {
    refuses(
      () => matchStoreCatalog(parsed(change), accept),
      422,
      'STORE_CATALOG_MISMATCH',
    );
  }
});

test('LOJ-19: paid less than the price is AMOUNT_BELOW_PRICE; paid more is accepted', () => {
  refuses(
    () =>
      matchStoreCatalog(
        parsed((body) => (body.pagamento.valor_pago_centavos = 17999)),
        accept,
      ),
    422,
    'AMOUNT_BELOW_PRICE',
  );
  const over = matchStoreCatalog(
    parsed((body) => (body.pagamento.valor_pago_centavos = 18001)),
    accept,
  );
  // The order keeps the catalog price, never the amount paid.
  assert.equal(over.priceCents, 18000);
});

test('LOJ-19: only Pix through InfinitePay is PAYMENT_METHOD_UNSUPPORTED otherwise', () => {
  for (const change of [
    (/** @type {any} */ body) => (body.pagamento.forma = 'cartao_credito'),
    (/** @type {any} */ body) => (body.pagamento.forma = 'PIX'),
    (/** @type {any} */ body) => (body.pagamento.gateway = 'sicredi'),
  ]) {
    refuses(
      () => matchStoreCatalog(parsed(change), accept),
      422,
      'PAYMENT_METHOD_UNSUPPORTED',
    );
  }
});

test('LOJ-19: a test order is TEST_REFUSED where tests are not accepted, and may cost R$ 1,00 where they are', () => {
  const testOrder = parsed((body) => {
    body.teste = true;
    body.valor_centavos = 100;
    body.pagamento.valor_pago_centavos = 100;
  });
  refuses(
    () => matchStoreCatalog(testOrder, { acceptTest: false, now: STORE_NOW }),
    422,
    'TEST_REFUSED',
  );
  assert.equal(matchStoreCatalog(testOrder, accept).priceCents, 100);
  // A test may also be paid at the full price.
  const fullPrice = parsed((body) => (body.teste = true));
  assert.equal(matchStoreCatalog(fullPrice, accept).priceCents, 18000);
});

test('LOJ-20: a new order must have been paid from 30 days before to 5 minutes after now', () => {
  const at = (/** @type {number} */ offsetMs) =>
    parsed(
      (body) =>
        (body.pagamento.pago_em = new Date(
          STORE_NOW.getTime() + offsetMs,
        ).toISOString()),
    );
  matchStoreCatalog(at(5 * 60_000), accept);
  matchStoreCatalog(at(-30 * 24 * 3_600_000), accept);
  refuses(
    () => matchStoreCatalog(at(5 * 60_000 + 1000), accept),
    400,
    'INVALID_PAID_AT',
  );
  refuses(
    () => matchStoreCatalog(at(-30 * 24 * 3_600_000 - 1000), accept),
    400,
    'INVALID_PAID_AT',
  );
});

test('LOJ-21: the store order is born confirmed on the gateway word, at the catalog price', () => {
  const record = parsed((body) => {
    body.pagamento.receipt_url = STORE_RECEIPT_URL;
    body.pagamento.valor_pago_centavos = 18050;
  });
  const order = buildStoreOrder({
    fabCode: '01',
    id: 'order-store-1',
    match: matchStoreCatalog(record, accept),
    now: STORE_NOW,
    record,
  });
  assert.deepEqual(
    {
      confirmedAt: order.confirmedAt,
      confirmedBy: order.confirmedBy,
      conversationId: order.conversationId,
      createdBy: order.createdBy,
      createdByKind: order.createdByKind,
      finalAmountCents: order.finalAmountCents,
      gatewayPayment: order.gatewayPayment,
      isTest: order.isTest,
      leadTimeBusinessDays: order.leadTimeBusinessDays,
      orderDate: order.orderDate,
      origin: order.origin,
      paidOn: order.paidOn,
      paymentCondition: order.paymentCondition,
      status: order.status,
      storeNumber: order.storeNumber,
      totalPieces: order.totalPieces,
    },
    {
      confirmedAt: STORE_NOW.toISOString(),
      confirmedBy: STORE_ACTOR_ID,
      conversationId: null,
      createdBy: STORE_ACTOR_ID,
      createdByKind: 'automation',
      finalAmountCents: 18000,
      gatewayPayment: {
        confirmedAt: '2026-10-08T02:15:55.000Z',
        invoiceSlug: 'fatura-sintetica-1',
        paidAmountCents: 18050,
        source: 'infinitepay',
        transactionNsu: 'nsu-sintetico-0001',
      },
      isTest: false,
      leadTimeBusinessDays: 10,
      // 02:15 UTC is still the 7th in São Paulo.
      orderDate: '2026-10-07',
      origin: 'loja',
      paidOn: '2026-10-07',
      paymentCondition: 'pix',
      status: 'confirmado',
      storeNumber: 'LJ-5B0C77ED',
      totalPieces: 10,
    },
  );
  assert.deepEqual(order.ficha.loja, {
    comprovanteUrl: STORE_RECEIPT_URL,
    produto: {
      nome: 'Camisa Masculina Lisa Dry Fit',
      slug: 'camisa-masculina-lisa',
    },
    telefone: '5527900000001',
  });
  assert.equal(order.ficha.summary.cliente, 'Cliente Sintetico da Loja');
  assert.equal(order.ficha.artwork.sem_estampa, true);
  const [item] = order.ficha.items;
  assert.equal(item.cor, 'Preto');
  assert.equal(item.tipo, 'Camiseta');
  assert.equal(item.publico, 'masculino');
  assert.equal(item.gola, 'Gola redonda');
  assert.deepEqual(item.malhas, ['Dry fit liso de poliéster']);
  assert.deepEqual(item.grade, [{ quantidade: 10, tamanho: 'M' }]);
});

test('LOJ-17: the fingerprint ignores the receipt link and the instant format, and catches any other change', () => {
  const base = storeRecordFingerprint(parsed());
  assert.match(base, /^[0-9a-f]{64}$/u);
  assert.equal(
    storeRecordFingerprint(
      parsed((body) => {
        body.pagamento.receipt_url = STORE_RECEIPT_URL;
        body.pagamento.pago_em = '2026-10-08T02:15:55.000Z';
        body.cliente.nome = 'Cliente  Sintetico da Loja';
      }),
    ),
    base,
  );
  for (const change of [
    (/** @type {any} */ body) => (body.item.tamanho_id = 'g'),
    (/** @type {any} */ body) => (body.pagamento.transaction_nsu = 'nsu-2'),
    (/** @type {any} */ body) => (body.pagamento.valor_pago_centavos = 18001),
    (/** @type {any} */ body) =>
      (body.pagamento.pago_em = '2026-10-08T02:15:56Z'),
    (/** @type {any} */ body) => (body.cliente.telefone = '5527900000002'),
    (/** @type {any} */ body) => (body.teste = true),
  ]) {
    assert.notEqual(storeRecordFingerprint(parsed(change)), base);
  }
});

test('LOJ-07: a store order is locked; any other order is not', () => {
  assert.throws(() => requireUnlocked({ origin: 'loja' }), {
    code: 'ORDER_LOCKED',
    statusCode: 409,
  });
  assert.doesNotThrow(() => requireUnlocked({ origin: 'atendimento' }));
  assert.doesNotThrow(() => requireUnlocked({}));
});
