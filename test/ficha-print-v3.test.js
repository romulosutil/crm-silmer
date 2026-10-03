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
  PAGE_HEIGHT,
  estimateItemHeight,
  paginateItems,
  wrappedLines,
} from '../modules/orders/src/print/ficha-v3-pages.js';
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
  return html.slice(0, html.indexOf('<section class="page-break'));
}

/** @param {string} html @returns {string[]} each continuation page */
function continuationPages(html) {
  return html
    .slice(0, html.indexOf('<section class="page-break">'))
    .split('<section class="page-break continuation">')
    .slice(1);
}

/** @param {string} text */
function withoutAccents(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replaceAll('—', '-');
}

/** What the paper reads: the document without its style and its tags. */
function printedText(/** @type {string} */ html) {
  return html
    .replace(/<style>[\s\S]*?<\/style>/u, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ');
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
      'Manga direita=NÃO APLICÁVEL',
      'Manga esquerda=NÃO APLICÁVEL',
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

test('prints each of the five days once on page 1: two in the summary, three in the trail (PLA-08)', () => {
  // 22:30 on 01/10 in São Paulo is already 02/10 in UTC.
  const html = printed(
    order([polo], { firstContactAt: '2026-10-02T01:30:00.000Z' }),
  );
  const page = pageOne(html);
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
      'Pagamento=02/10/2026',
      `Entrega realizada=<span class="empty">${EMPTY_MARK}</span>`,
    ],
  );
  // The order date and the promised delivery print once, in the summary.
  assert.doesNotMatch(
    trail,
    /Pedido fechado|Entrega prometida|Data do pedido/u,
  );
  assert.equal(page.match(/Entrega prometida<\/span>/gu)?.length, 1);
  assert.equal(page.match(/Data do pedido<\/span>/gu)?.length, 1);
  assert.match(page, /Data do pedido<\/span><strong>02\/10\/2026</u);
  assert.match(page, /Entrega prometida<\/span><strong>24\/10\/2026</u);
});

test('keeps the 14 production fields of v2 and the review marks on the sample only (PIM-09)', () => {
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
      /\n\s*<div class="review-box">.*?<\/div>(?:\n\s*<div class="signatures">.*?<\/div>)?/u,
      '',
    );

  // Same fields, order and layout as the approved v2; only the accents of
  // the printed labels change (PIM-11).
  assert.equal(
    withoutAccents(withoutReviewBox(v3.sample)),
    withoutReviewBox(v2.sample),
  );
  assert.equal(
    withoutAccents(productionPage(v3.real)),
    withoutReviewBox(v2.real),
  );
  assert.equal(
    (v3.real.match(/<span class="campo-producao-vazio"><\/span>/gu) ?? [])
      .length,
    14,
  );
  assert.doesNotMatch(
    v3.real,
    /Amostra sint|<div class="review-box">|Aprovação pendente/u,
  );
  assert.match(v3.sample, /Amostra sintética — não produzir/u);
  assert.match(v3.sample, /Aprovação pendente/u);
  // Rose and Operação sign the printed sample by hand (ADR 017).
  assert.match(
    v3.sample,
    /Rose e Operação aprovam a v3 assinando à mão esta amostra impressa/u,
  );
  assert.match(
    v3.sample,
    /<div class="signatures"><span>Assinatura de Rose<\/span><span>Data<\/span><span>Assinatura de Operação<\/span><span>Data<\/span><\/div>/u,
  );
  assert.doesNotMatch(v3.real, /<div class="signatures">/u);
});

test('writes every printed label with its accents, on both pages (PIM-11)', () => {
  const text = printedText(printed(order([polo, regata]), { synthetic: true }));

  for (const label of [
    'Amostra sintética — não produzir',
    'Total de peças',
    'Tipo de serviço',
    'Itens: os sete pontos e os adicionais',
    'Viés mangas',
    'Observações do pedido',
    'CONTROLE DE PRODUÇÃO',
    'Preenchimento exclusivo da equipe de produção e arte.',
    'Conferência e embalagem',
    'Registro de conferência e execução.',
    'Fechamento físico do pedido.',
    'Contagem final por parte da peça.',
  ]) {
    assert.ok(text.includes(label), label);
  }
  assert.doesNotMatch(
    text,
    /sintetica|nao produzir|PRODUCAO|producao e arte|Conferencia|conferencia|execucao|fisico|\bpecas?\b|Observacoes|servico|Vies/u,
  );
});

test('prints the stored NAO APLICAVEL as NÃO APLICÁVEL and typed text as typed (PIM-11)', () => {
  const item = {
    ...regata,
    gola: 'NAO APLICAVEL',
    vies_gola: 'nao aplicavel',
    vies_mangas: 'NAO APLICAVEL NA MANGA CURTA',
  };
  const card = itemCard(printed(order([item])), 0);

  assert.match(card, /Gola<\/dt><dd>NÃO APLICÁVEL</u);
  assert.match(card, /Manga direita<\/dt><dd>NÃO APLICÁVEL</u);
  assert.match(card, /Viés gola<\/dt><dd>nao aplicavel</u);
  assert.match(card, /Viés mangas<\/dt><dd>NAO APLICAVEL NA MANGA CURTA</u);
  // The stored value does not change: only the paper spells it out.
  assert.equal(printableItem(item).gola, 'NAO APLICAVEL');
});

test('keeps a short order on page 1, with no continuation page (PIM-12)', () => {
  const html = printed(order([polo, regata]));

  assert.deepEqual(continuationPages(html), []);
  assert.match(pageOne(html), /Observações do pedido/u);
  assert.doesNotMatch(html, /continuação dos itens/u);
});

test('repeats the header, the order number and the page number on every continuation page (PIM-12)', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    ...regata,
    tipo: `REGATA ${index + 1}`,
  }));
  const html = printed(order(items));
  const pages = continuationPages(html);

  assert.ok(pages.length >= 2, 'seven tall items need two continuation pages');
  pages.forEach((page, offset) => {
    assert.match(page, /<h1>FICHA DE PEDIDO<\/h1>/u);
    assert.match(page, /<span>Pedido<\/span><strong>07-CRM<\/strong>/u);
    assert.match(
      page,
      new RegExp(
        `<span class="page-marker"><strong>Página ${offset + 2}</strong> · continuação dos itens</span>`,
        'u',
      ),
    );
    assert.doesNotMatch(page, /Amostra sint/u);
  });
  // Items keep their order and their numbers across pages, never split.
  assert.deepEqual(
    [...html.matchAll(/<span>Item<\/span><strong>(\d+)<\/strong>/gu)].map(
      (match) => Number(match[1]),
    ),
    [1, 2, 3, 4, 5, 6, 7],
  );
  // The summary prints once; the observations and the total close the last
  // commercial page; the production control keeps its own header.
  assert.equal(html.match(/Resumo do pedido/gu)?.length, 1);
  assert.equal(html.match(/Observações do pedido/gu)?.length, 1);
  assert.match(/** @type {string} */ (pages.at(-1)), /Observações do pedido/u);
  assert.match(productionPage(html), /CONTROLE DE PRODUÇÃO/u);
  assert.doesNotMatch(productionPage(html), /page-marker/u);
});

test('marks the sample on continuation pages too', () => {
  const items = [polo, regata, regata, regata];
  const pages = continuationPages(printed(order(items), { synthetic: true }));

  assert.ok(pages.length > 0);
  for (const page of pages) {
    assert.match(page, /Amostra sintética — não produzir/u);
  }
});

test('plans the pages from conservative heights and keeps the total with the last item (PIM-12)', () => {
  assert.equal(wrappedLines('', 10), 1);
  assert.equal(wrappedLines('AZUL MARINHO', 12), 1);
  assert.equal(wrappedLines('AZUL MARINHO', 11), 2);
  assert.equal(wrappedLines('M'.repeat(25), 10), 3);

  const short = printableItem(polo);
  const tall = printableItem({
    ...regata,
    estampa: 'ARTE '.repeat(40).trim(),
    grade: Array.from({ length: 14 }, (_, index) => ({
      quantidade: 1,
      tamanho: `T${index}`,
    })),
  });
  assert.ok(estimateItemHeight(tall) > estimateItemHeight(short));
  assert.deepEqual(paginateItems([short], []), [[0]]);
  assert.deepEqual(paginateItems([], []), [[]]);
  const many = Array.from({ length: 9 }, () => tall);
  const pages = paginateItems(many, ['Separar por tamanho.']);
  assert.deepEqual(pages.flat(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(pages.every((page) => page.length > 0));
  assert.ok(estimateItemHeight(tall) * 3 < PAGE_HEIGHT);
  // When the observations do not fit after the last item, the last item
  // moves with them to a page of its own.
  const twoAndTotal = paginateItems(
    [short, tall, tall],
    Array.from({ length: 5 }, () => 'OBSERVACAO '.repeat(18).trim()),
  );
  assert.equal(twoAndTotal.length, 2);
  assert.deepEqual(twoAndTotal.at(-1), [2]);
});

test('escapes every printed text', () => {
  const html = printed(
    order([{ ...polo, cor: '<script>alert(1)</script>', modelo: '"A" & B' }]),
  );

  assert.doesNotMatch(html, /<script\b/iu);
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
    pagamento: '02/10/2026',
    entrega_realizada: '',
  });
  assert.equal(v3.pedido.data, '02/10/2026');
  assert.equal(v3.pedido.data_entrega_confirmada, '24/10/2026');
  assert.throws(() => printSnapshot(source, 'ficha-canonical-v9'), /Unknown/u);
});
