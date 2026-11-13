import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planOrderReceiptPages,
  projectOrderReceipt,
  renderOrderReceiptHtml,
} from '../modules/orders/src/print/order-receipt.js';

const issuedAt = new Date('2026-11-13T01:30:00.000Z');
const item = () => ({
  tipo: 'Camiseta',
  modelo: 'Corrida',
  cor: 'Preta',
  malhas: ['Dry fit'],
  tipo_servico: 'Silk',
  grade: [
    { tamanho: 'P', quantidade: 40 },
    { tamanho: 'M', quantidade: 80 },
    { tamanho: 'G', quantidade: 60 },
  ],
});
/** @returns {any} */
const order = () => ({
  id: 'synthetic-order',
  number: '87-CRM',
  status: 'confirmado',
  version: 4,
  orderDate: '2026-10-28',
  seller: { name: 'Vendedor exemplo' },
  paymentCondition: 'pix',
  amounts: { piecesCents: 528000, freightCents: 2500, totalCents: 530500 },
  pricing: { complete: true, totalCents: 528000 },
  ficha: {
    summary: {
      cliente: 'Equipe Horizonte',
      nome: 'Corrida de rua',
      data_entrega_confirmada: '2026-11-20',
    },
    items: [item()],
    sizePricing: [
      {
        id: 'group-1',
        lines: [
          {
            size: 'P',
            quantity: 40,
            subtotalCents: 116000,
            subtotalReviewed: true,
          },
          {
            size: 'M',
            quantity: 80,
            subtotalCents: 232000,
            subtotalReviewed: true,
          },
          {
            size: 'G',
            quantity: 60,
            subtotalCents: 180000,
            subtotalReviewed: true,
          },
        ],
      },
    ],
  },
});
/** @param {any} input */
const project = (input) => projectOrderReceipt(input, { issuedAt });
/** @param {string} html */
const visible = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ');

test('RCP-05: groups only an item’s equal exact unit prices and preserves official freight/total', () => {
  const receipt = project(order());
  assert.deepEqual(receipt.items, [
    {
      quantity: 120,
      description: 'Camiseta',
      details: ['Corrida', 'Preta', 'Dry fit', 'Silk'],
      sizes: 'P 40 · M 80',
      unitCents: 2900,
      subtotalCents: 348000,
    },
    {
      quantity: 60,
      description: 'Camiseta',
      details: ['Corrida', 'Preta', 'Dry fit', 'Silk'],
      sizes: 'G 60',
      unitCents: 3000,
      subtotalCents: 180000,
    },
  ]);
  assert.equal(receipt.piecesCents, 528000);
  assert.equal(receipt.freightCents, 2500);
  assert.equal(receipt.totalCents, 530500);
});

test('RCP-05: different items never merge even when their exact unit prices match', () => {
  const input = order();
  input.ficha.items.push(item());
  input.ficha.sizePricing.push(structuredClone(input.ficha.sizePricing[0]));
  assert.equal(project(input).items.length, 4);
});

test('RCP-05: fractional unit price is unavailable, with the reviewed subtotal kept exactly', () => {
  const input = order();
  input.ficha.items[0].grade = [{ tamanho: 'M', quantidade: 3 }];
  input.ficha.sizePricing[0].lines = [
    { size: 'M', quantity: 3, subtotalCents: 10000, subtotalReviewed: true },
  ];
  input.amounts = { piecesCents: 10000, freightCents: 0, totalCents: 10000 };
  const receipt = project(input);
  assert.equal(receipt.items[0].unitCents, null);
  assert.equal(receipt.items[0].subtotalCents, 10000);
  assert.equal(receipt.totalCents, 10000);
});

test('RCP-04/05: a stale or unreviewed subtotal never becomes an authoritative partial total', () => {
  const input = order();
  input.status = 'pendente';
  input.ficha.sizePricing[0].lines[1].subtotalReviewed = false;
  const receipt = project(input);
  assert.equal(receipt.items[1].subtotalCents, null);
  assert.equal(receipt.items[1].unitCents, null);
  assert.equal(receipt.items[1].quantity, 80);
  assert.equal(receipt.piecesCents, null);
  assert.equal(receipt.totalCents, null);
  assert.equal(receipt.freightCents, 2500);
});

test('RCP-04: inconsistent grade/prices do not supply a fabricated unit or total', () => {
  const input = order();
  input.ficha.sizePricing[0].lines[0].quantity = 50;
  const receipt = project(input);
  assert.equal(receipt.items[0].quantity, 180);
  assert.equal(receipt.items[0].subtotalCents, null);
  assert.equal(receipt.totalCents, null);
});

test('RCP-04: missing fields stay empty/null, empty quantity is not zero, and the renderer names the absence', () => {
  const receipt = project({
    id: 'empty',
    status: 'pendente',
    version: 1,
    ficha: { items: [{}] },
  });
  assert.equal(receipt.customerName, '');
  assert.equal(receipt.sellerName, '');
  assert.equal(receipt.paymentCondition, null);
  assert.equal(receipt.orderDate, null);
  assert.equal(receipt.deliveryOn, null);
  assert.equal(receipt.items[0].quantity, null);
  assert.equal(receipt.items[0].unitCents, null);
  assert.equal(receipt.items[0].subtotalCents, null);
  assert.equal(receipt.totalCents, null);
  const html = renderOrderReceiptHtml(receipt);
  assert.match(visible(html), /Não informado/u);
  assert.match(visible(html), /A definir/u);
  assert.doesNotMatch(visible(html), /R\$ 0,00|undefined|null/u);
});

test('RCP-04: legacy and store orders preserve the official total without distributing it into lines', () => {
  for (const origin of ['atendimento', 'loja']) {
    const input = order();
    delete input.ficha.sizePricing;
    const receipt = project({ ...input, origin, finalAmountCents: 530500 });
    assert.equal(receipt.totalCents, 530500);
    assert.equal(receipt.items[0].quantity, 180);
    assert.equal(receipt.items[0].unitCents, null);
    assert.equal(receipt.items[0].subtotalCents, null);
  }
});

test('RCP-10: projects the exact allowlist without internal data or mutations', () => {
  const input = order();
  Object.assign(input, {
    paidOn: '2026-10-30',
    customer: { cpf: 'PRIVATE-CPF' },
    gatewayPayment: { receiptUrl: 'https://private.test' },
    cancellationReason: 'PRIVATE-CANCEL',
  });
  Object.assign(input.ficha, {
    observations: ['PRIVATE-NOTE'],
    serviceData: { chat: 'PRIVATE-CHAT' },
    artwork: { files: ['PRIVATE-ART'] },
    loja: { telefone: 'PRIVATE-PHONE' },
  });
  const before = structuredClone(input);
  const receipt = project(input);
  assert.deepEqual(
    Object.keys(receipt).sort(),
    [
      'schema',
      'orderId',
      'number',
      'status',
      'version',
      'customerName',
      'orderName',
      'orderDate',
      'issuedAt',
      'sellerName',
      'deliveryOn',
      'paymentCondition',
      'isTest',
      'items',
      'piecesCents',
      'freightCents',
      'totalCents',
    ].sort(),
  );
  assert.equal(receipt.schema, 'order-receipt-v1');
  assert.equal(receipt.orderId, 'synthetic-order');
  assert.equal(receipt.issuedAt, issuedAt.toISOString());
  assert.equal(receipt.paymentCondition, 'Pix');
  assert.equal(receipt.isTest, false);
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE-|https:/u);
  assert.deepEqual(input, before);
});

test('RCP-03/10: confirmed removes the provisional notice; pending/reopened/cancelled identify every page', () => {
  for (const state of ['confirmado', 'pendente', 'cancelado']) {
    const input = {
      ...order(),
      status: state === 'cancelado' ? 'pendente' : state,
      cancelledAt: state === 'cancelado' ? '2026-11-10T12:00:00Z' : null,
    };
    input.ficha.items = Array.from({ length: 20 }, item);
    delete input.ficha.sizePricing;
    const receipt = project(input);
    assert.equal(receipt.status, state);
    const html = renderOrderReceiptHtml(receipt);
    const pages = html.split(/(?=<article class="receipt-sheet)/u).slice(1);
    assert.ok(pages.length > 1);
    for (const page of pages) {
      assert.match(page, /87-CRM/u);
      if (state === 'pendente')
        assert.match(
          visible(page),
          /Pedido pendente - resumo provisório, sujeito a alterações/u,
        );
      else if (state === 'cancelado')
        assert.match(visible(page), /Pedido cancelado - documento histórico/u);
      else {
        assert.match(visible(page), /Pedido confirmado/u);
        assert.doesNotMatch(visible(page), /provisório/u);
      }
    }
  }
});

test('RCP-10: HTML escapes allowed fields, embeds official fonts/logo, and never adds executable/external resources', () => {
  const input = order();
  input.ficha.summary.cliente = '<script src="https://evil.test">&\'"</script>';
  input.ficha.items[0].tipo =
    '<img src="https://evil.test" onerror="alert(1)">';
  const html = renderOrderReceiptHtml(project(input));
  assert.match(
    visible(html),
    /&lt;script src=&quot;https:\/\/evil\.test&quot;&gt;&amp;&#039;&quot;&lt;\/script&gt;/u,
  );
  assert.match(
    visible(html),
    /&lt;img src=&quot;https:\/\/evil\.test&quot; onerror=&quot;alert\(1\)&quot;&gt;/u,
  );
  assert.match(html, /data:font\/woff2;base64,/u);
  assert.match(html, /<svg[^>]+viewBox="0 0 442 136"/u);
  assert.doesNotMatch(
    html,
    /<script|<img|<link|<iframe|\s(?:href|src)="https?:/u,
  );
  assert.match(
    visible(html),
    /Sem valor fiscal\. Este resumo não comprova pagamento\./u,
  );
  assert.match(html, /@page\s*\{\s*size:\s*A5 portrait/u);
});

test('RCP-11: long rows continue without losing text, with totals/footer only on the final page', () => {
  const input = order();
  input.ficha.items[0].tipo = 'Modelo '.repeat(1000) + 'FINAL-DA-DESCRICAO';
  input.ficha.items[0].cor = 'Cor extensa '.repeat(100) + 'FINAL-DA-COR';
  const receipt = project(input);
  const plan = planOrderReceiptPages(receipt);
  assert.ok(plan.length > 3);
  const html = renderOrderReceiptHtml(receipt);
  const pages = html.split(/(?=<article class="receipt-sheet)/u).slice(1);
  assert.equal(pages.length, plan.length);
  assert.match(visible(html), /FINAL-DA-DESCRICAO/u);
  assert.match(visible(html), /FINAL-DA-COR/u);
  assert.equal(pages.filter((page) => /Total do pedido/u.test(page)).length, 1);
  assert.match(pages[pages.length - 1], /Total do pedido/u);
  assert.equal(
    pages.filter((page) => /Sem valor fiscal/u.test(page)).length,
    1,
  );
  assert.ok(plan.every((page) => page.usedHeight <= page.availableHeight));
  assert.deepEqual(
    plan
      .flatMap((page) => page.rows)
      .flatMap((row) => row.lines.map((line) => line.text))
      .join('')
      .replace(/[\s·]/gu, ''),
    receipt.items
      .flatMap((row) => [row.description, ...row.details, row.sizes])
      .join('')
      .replace(/[\s·]/gu, ''),
  );
});

test('RCP-05: maximum safe cent values are formatted without rounding', () => {
  const receipt = project({
    ...order(),
    amounts: {
      piecesCents: Number.MAX_SAFE_INTEGER,
      freightCents: 0,
      totalCents: Number.MAX_SAFE_INTEGER,
    },
    ficha: { ...order().ficha, sizePricing: undefined },
  });
  assert.match(
    visible(renderOrderReceiptHtml(receipt)),
    /90\.071\.992\.547\.409,91/u,
  );
});

test('RCP-04/10: dates use São Paulo and absent dates/unknown payment never become invented values', () => {
  const input = {
    ...order(),
    orderDate: null,
    createdAt: '2026-11-13T01:30:00.000Z',
  };
  assert.equal(project(input).orderDate, '2026-11-12');
  assert.match(
    visible(renderOrderReceiptHtml(project(input))),
    /Emitido em 12\/11\/2026/u,
  );
  assert.equal(project({ ...input, createdAt: null }).orderDate, null);
  assert.equal(project({ ...input, createdAt: '' }).orderDate, null);
  assert.equal(
    project({ ...input, paymentCondition: 'à vista' }).paymentCondition,
    null,
  );
  assert.equal(
    project({ ...input, paymentCondition: 'cartao_credito' }).paymentCondition,
    'Cartão de crédito',
  );
  assert.equal(
    project({ ...input, paymentCondition: 'cartao_debito' }).paymentCondition,
    'Cartão de débito',
  );
});

test('RCP-11: a short order fits one A5 page and test orders are labelled', () => {
  const input = order();
  input.ficha.sizePricing[0].lines[2].subtotalCents = 174000;
  input.amounts = { piecesCents: 522000, freightCents: 0, totalCents: 522000 };
  const receipt = project({ ...input, isTest: true });
  assert.equal(receipt.isTest, true);
  assert.equal(planOrderReceiptPages(receipt).length, 1);
  assert.match(
    visible(renderOrderReceiptHtml(receipt)),
    /Pedido de teste - não produzir nem entregar/u,
  );
});
