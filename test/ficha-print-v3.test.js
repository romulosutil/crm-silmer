import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderFichaHtml } from '../modules/orders/src/print/ficha-canonical-v2.js';
import {
  EMPTY_MARK,
  PRINCIPAL_LABELS,
  printableItem,
  renderFichaHtmlV3,
} from '../modules/orders/src/print/ficha-canonical-v3.js';
import {
  TEMPLATE_V2,
  TEMPLATE_V3,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

// ADR 017: the printed ficha with the seven points (PIM-06..09) and the date
// trail (PLA-08). Fixtures are synthetic.

const v2Sample = JSON.parse(
  await readFile(
    new URL('../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

const polo = Object.freeze({
  tipo: 'CAMISA POLO',
  cor: 'AZUL MARINHO',
  estampa: 'BORDADO NO PEITO',
  malhas: ['PIQUET', 'ALGODAO'],
  gola: 'GOLA POLO',
  modelo: '',
  cor_frente: '',
  cor_costas: '',
  cor_manga_direita: '',
  cor_manga_esquerda: '',
  vies_gola: '',
  vies_mangas: '',
  grade: [
    { tamanho: 'P', quantidade: 4 },
    { tamanho: 'M', quantidade: 8 },
    { tamanho: 'G', quantidade: 6 },
  ],
});

const regata = Object.freeze({
  tipo: 'REGATA',
  cor: 'BRANCA',
  estampa: 'SILK NAS COSTAS',
  malhas: ['DRY FIT'],
  gola: 'REGATA',
  modelo: 'CAVADA',
  cor_frente: '',
  cor_costas: 'VERDE',
  cor_manga_direita: 'NAO APLICAVEL',
  cor_manga_esquerda: 'NAO APLICAVEL',
  vies_gola: '',
  vies_mangas: 'VERDE',
  grade: [
    { tamanho: 'PP', quantidade: 1 },
    { tamanho: 'P', quantidade: 2 },
    { tamanho: 'M', quantidade: 3 },
    { tamanho: 'G', quantidade: 4 },
    { tamanho: 'GG', quantidade: 5 },
    { tamanho: 'XG', quantidade: 6 },
  ],
});

/** @param {any[]} items @param {Record<string, unknown>} [extra] */
function order(items, extra = {}) {
  return {
    confirmedBy: { id: 'seller-1', name: 'Vendedora Um' },
    deliveredOn: null,
    fabCode: '01',
    ficha: {
      items,
      observations: ['Separar por tamanho.'],
      summary: {
        aplicacao: 'SUBLIMACAO',
        cliente: 'Cliente Sintetico',
        data_entrega_confirmada: '2026-10-24',
        nome: 'Equipe Sintetica',
      },
    },
    finalAmountCents: 482000,
    firstContactAt: '2026-09-18T13:05:00.000Z',
    number: '07-CRM',
    orderDate: '2026-10-02',
    paidOn: '2026-10-02',
    paymentCondition: 'pix',
    status: 'confirmado',
    totalPieces: items.reduce(
      (total, item) =>
        total +
        item.grade.reduce(
          (/** @type {number} */ sum, /** @type {any} */ line) =>
            sum + line.quantidade,
          0,
        ),
      0,
    ),
    ...extra,
  };
}

/** @param {any} source @param {{synthetic?: boolean}} [options] */
function printed(source, options = { synthetic: false }) {
  return renderFichaHtmlV3(printSnapshot(source, TEMPLATE_V3), options);
}

/** @param {string} html @param {number} index zero-based item */
function itemCard(html, index) {
  const cards = html.split('<article class="item-card">').slice(1);
  return cards[index].slice(0, cards[index].indexOf('</article>'));
}

/** @param {string} html */
function pointLabels(html) {
  return [
    ...html.matchAll(
      /<span class="point-number">(\d)<\/span>([^<]+)<\/dt><dd>/gu,
    ),
  ].map((match) => `${match[1]} ${match[2]}`);
}

/** @param {string} html */
function pageOne(html) {
  return html.slice(0, html.indexOf('<section class="page-break">'));
}

/** @param {string} html */
function productionPage(html) {
  return html.slice(html.indexOf('<section class="page-break">'));
}

test('prints the seven principal points in the bot order with the screen labels (PIM-06)', () => {
  const html = printed(order([polo]));

  assert.deepEqual(PRINCIPAL_LABELS, [
    'Tipo de roupa',
    'Cor',
    'Quantidade',
    'Estampa',
    'Tecido',
    'Tamanhos',
    'Gola',
  ]);
  assert.deepEqual(
    pointLabels(itemCard(html, 0)),
    PRINCIPAL_LABELS.map((label, index) => `${index + 1} ${label}`),
  );
  const card = itemCard(html, 0);
  const values = [
    'CAMISA POLO',
    'AZUL MARINHO',
    '18',
    'BORDADO NO PEITO',
    'PIQUET / ALGODAO',
    'GOLA POLO',
  ].map((value) => card.indexOf(value));
  assert.ok(values.every((position) => position > 0));
  assert.deepEqual(
    values,
    [...values].sort((a, b) => a - b),
  );
});

test('derives the quantity from the grade and prints each size with its count (PIM-06)', () => {
  // A stray stored quantity never reaches the paper.
  const item = { ...regata, quantidade: 999 };
  const html = printed(order([item]));
  const card = itemCard(html, 0);

  assert.equal(printableItem(item).quantidade, 21);
  assert.match(card, /<strong>21<\/strong> peças/u);
  assert.doesNotMatch(card, /999/u);
  assert.deepEqual(
    [
      ...card.matchAll(
        /<span class="size"><span>([^<]+)<\/span><strong>(\d+)<\/strong><\/span>/gu,
      ),
    ].map((match) => `${match[1]}:${match[2]}`),
    ['PP:1', 'P:2', 'M:3', 'G:4', 'GG:5', 'XG:6'],
  );
  assert.equal(printableItem({ ...polo, grade: [] }).quantidade, 0);
  assert.match(
    itemCard(printed(order([{ ...polo, grade: [] }])), 0),
    new RegExp(`Quantidade</dt><dd><span class="empty">${EMPTY_MARK}`, 'u'),
  );
});

test('prints the extras block only when an extra is filled, with only the filled ones (PIM-07)', () => {
  const html = printed(order([polo, regata]));

  assert.doesNotMatch(itemCard(html, 0), /Adicionais/u);
  const extras = itemCard(html, 1).slice(
    itemCard(html, 1).indexOf('<div class="extras">'),
  );
  assert.deepEqual(
    [...extras.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/gu)].map(
      (match) => `${match[1]}=${match[2]}`,
    ),
    [
      'Modelo=CAVADA',
      'Cor costas=VERDE',
      'Manga direita=NAO APLICAVEL',
      'Manga esquerda=NAO APLICAVEL',
      'Viés mangas=VERDE',
    ],
  );
  assert.doesNotMatch(extras, /Cor frente|Viés gola/u);
  assert.deepEqual(
    printableItem({ ...polo, vies_gola: '  ' }).adicionais,
    [],
    'blank text is not an extra',
  );
});

test('prints a ficha saved before the seven points without losing a v2 field (PIM-08)', () => {
  const legacy = v2Sample.pedido.itens[0];
  assert.equal(
    'cor' in legacy || 'estampa' in legacy || 'gola' in legacy,
    false,
  );

  const html = printed(order([legacy]));
  const card = itemCard(html, 0);
  const empty = `<span class="empty">${EMPTY_MARK}</span>`;

  for (const label of ['Cor', 'Estampa', 'Gola']) {
    assert.ok(
      card.includes(`${label}</dt><dd>${empty}</dd>`),
      `${label} prints the empty mark`,
    );
  }
  assert.match(card, /Tipo de roupa<\/dt><dd>CAMISA</u);
  assert.match(card, /DRY FIT 100% POLIESTER \/ GRAMATURA 130/u);
  for (const value of [
    'TRADICIONAL',
    'AZUL MARINHO',
    'BRANCA',
    'OLIMPICA - VERDE',
    'VERDE',
  ]) {
    assert.ok(card.includes(value), `${value} still prints`);
  }
  assert.doesNotMatch(html, /undefined|null|NaN/u);
});

test('names the summary as the screen does and keeps money off the paper (PIM-09)', () => {
  const html = printed(order([polo]));
  const page = pageOne(html);
  const labels = [
    ...page.matchAll(/<span class="label">([^<]+)<\/span>/gu),
  ].map((match) => match[1]);

  assert.deepEqual(labels.slice(0, 8), [
    'Cliente',
    'Entrega prometida',
    'Total de peças',
    'Tipo de serviço',
    'Evento / Nome',
    'Vendedor',
    'Data do pedido',
    'FAB',
  ]);
  assert.match(page, /Tipo de serviço<\/span><strong>SUBLIMACAO</u);
  assert.match(page, /Entrega prometida<\/span><strong>24\/10\/2026</u);
  assert.match(page, /Data do pedido<\/span><strong>02\/10\/2026</u);
  assert.match(page, /FAB<\/span><strong>FAB 01</u);
  assert.match(page, /Vendedor<\/span><strong>Vendedora Um</u);
  assert.doesNotMatch(page, /Aplicacao|Entrega confirmada/u);
  // D12: neither the final amount nor the payment condition is printed.
  assert.doesNotMatch(html, /4\.820,00|482000|R\$|pix|cartao/iu);
});

test('prints an empty summary field as the empty mark, never as null', () => {
  const blank = /** @type {any} */ (
    order([polo], { confirmedBy: null, fabCode: 'FAB 02' })
  );
  blank.ficha.summary = {
    aplicacao: null,
    cliente: 'Cliente Sintetico',
    data_entrega_confirmada: null,
    nome: null,
  };

  const page = pageOne(printed(blank));

  for (const label of [
    'Entrega prometida',
    'Tipo de serviço',
    'Evento / Nome',
    'Vendedor',
  ]) {
    assert.ok(
      page.includes(
        `${label}</span><strong><span class="empty">${EMPTY_MARK}</span></strong>`,
      ),
      label,
    );
  }
  assert.match(page, /FAB<\/span><strong>FAB 02</u);
  assert.doesNotMatch(page, /null|undefined/u);
});

test('prints the five days of the trail on page 1, in order (PLA-08)', () => {
  // 22:30 on 01/10 in São Paulo is already 02/10 in UTC.
  const html = printed(
    order([polo], { firstContactAt: '2026-10-02T01:30:00.000Z' }),
  );
  const trail = html.slice(
    html.indexOf('<section class="trail">'),
    html.indexOf('<section class="items">'),
  );

  assert.ok(html.indexOf('Data do pedido') < html.indexOf('Lastro do pedido'));
  assert.ok(html.indexOf('Lastro do pedido') < html.indexOf('Item'));
  assert.deepEqual(
    [
      ...trail.matchAll(
        /<span class="label">([^<]+)<\/span><strong>(.+?)<\/strong>/gu,
      ),
    ].map((match) => `${match[1]}=${match[2]}`),
    [
      'Primeiro contato=01/10/2026',
      'Pedido fechado=02/10/2026',
      'Pagamento=02/10/2026',
      'Entrega prometida=24/10/2026',
      `Entrega realizada=<span class="empty">${EMPTY_MARK}</span>`,
    ],
  );
});

test('keeps page 2 as the approved v2 and the review marks on the sample only (PIM-09)', () => {
  const source = order([polo, regata]);
  const v2 = {
    real: renderFichaHtml(printSnapshot(source, TEMPLATE_V2), {
      synthetic: false,
    }),
    sample: renderFichaHtml(printSnapshot(source, TEMPLATE_V2), {
      synthetic: true,
    }),
  };
  const v3 = {
    real: printed(source),
    sample: printed(source, { synthetic: true }),
  };
  /** @param {string} html */
  const withoutReviewBox = (html) =>
    productionPage(html).replace(
      /\n\s*<div class="review-box">.*?<\/div>/u,
      '',
    );

  assert.equal(withoutReviewBox(v3.sample), withoutReviewBox(v2.sample));
  assert.equal(productionPage(v3.real), withoutReviewBox(v2.real));
  assert.equal(
    (v3.real.match(/<span class="campo-producao-vazio"><\/span>/gu) ?? [])
      .length,
    14,
  );
  assert.doesNotMatch(
    v3.real,
    /Amostra sintetica|<div class="review-box">|Aprovação pendente/u,
  );
  assert.match(v3.sample, /Amostra sintetica - nao produzir/u);
  assert.match(v3.sample, /Aprovação pendente/u);
  assert.match(v3.sample, /O PO decide quem assina/u);
});

test('escapes every printed text', () => {
  const html = printed(
    order([{ ...polo, cor: '<script>alert(1)</script>', modelo: '"A" & B' }]),
  );

  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&quot;A&quot; &amp; B/u);
});

test('builds the v2 snapshot exactly as before and adds the trail only to v3', () => {
  const source = order([polo]);
  const v2 = printSnapshot(source, TEMPLATE_V2);
  const v3 = printSnapshot(source, TEMPLATE_V3);

  assert.deepEqual(Object.keys(v2.pedido).sort(), [
    'aplicacao',
    'cliente',
    'data',
    'data_entrega_confirmada',
    'fab',
    'itens',
    'nome',
    'numero',
    'observacoes',
    'quantidade_total',
    'vendedor',
  ]);
  assert.equal(v2.pedido.data_entrega_confirmada, '24/10/2026');
  assert.deepEqual(v3.pedido.lastro, {
    primeiro_contato: '18/09/2026',
    pedido_fechado: '02/10/2026',
    pagamento: '02/10/2026',
    entrega_prometida: '24/10/2026',
    entrega_realizada: '',
  });
  assert.throws(() => printSnapshot(source, 'ficha-canonical-v9'), /Unknown/u);
});
