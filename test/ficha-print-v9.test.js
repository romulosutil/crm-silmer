import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCTION_FIELDS_V9,
  renderFichaHtmlV9,
} from '../modules/orders/src/print/ficha-canonical-v9.js';
import {
  planFichaV9,
  splitNotes,
  textLines,
} from '../modules/orders/src/print/ficha-v9-pages.js';
import {
  PRINT_TEMPLATE,
  TEMPLATE_V8,
  TEMPLATE_V9,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import { safeArtPreview } from '../modules/orders/src/print/ficha-v8-content.js';
import { printSnapshot } from '../modules/orders/src/print/print-snapshot.js';
import {
  fichaV9Approved,
  validateFichaReviewV9,
} from '../scripts/ficha-pdf-review-v9.mjs';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

// FPI-12/13 (ADR 087): two sheets per item. The front has the observations
// where the v8 had the production control; the back has the control and the
// art, both enlarged. Fixtures are synthetic.

const root = new URL('../', import.meta.url);
/** @param {string} path */
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const sample = await read('docs/phase0/ficha-pdf-synthetic-v9.json');
const v8Gate = await read('docs/phase0/ficha-pdf-approval-v8.json');
const shortOrder = () => {
  const order = structuredClone(sample.order);
  order.ficha.items = order.ficha.items.slice(0, 3);
  order.totalPieces = 80;
  order.ficha.observations = order.ficha.observations.slice(0, 3);
  delete order.ficha.serviceData;
  return order;
};
/** @param {string} html */
const sheets = (html) => html.split(/(?=<article class="sheet)/u).slice(1);
/** @param {string} html */
const visible = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ');
/** @param {string} page */
const kind = (page) =>
  /^<article class="sheet( verso| extra)?/u.exec(page)?.[1]?.trim() ?? 'front';
/** @param {string} page */
const noteNumbers = (page) =>
  [...page.matchAll(/<li value="(\d+)">/gu)].map((match) => Number(match[1]));
/** @param {string} page */
const head = (page) =>
  /<header class="head">[\s\S]*?<\/header>/u.exec(page)?.[0] ?? '';
const NOTICE = /Observações do pedido continuam na folha (\d+) de (\d+)/u;

test('FPI-12: each item prints a front and a back, in that order, before any extra sheet', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V9);
  const pages = sheets(html);
  const kinds = pages.map(kind);
  assert.deepEqual(kinds, [
    'front',
    'verso',
    'front',
    'verso',
    'front',
    'verso',
    'front',
    'verso',
    'extra',
  ]);
  for (const [index, page] of pages.entries()) {
    assert.ok(
      visible(page).includes(
        `Folha ${index + 1} de ${pages.length} · versão 9`,
      ),
      `footer of sheet ${index + 1}`,
    );
  }
  // Without observations the order has exactly two sheets per item.
  const bare = shortOrder();
  bare.ficha.observations = [];
  assert.equal(sheets(renderOrderFicha(bare, TEMPLATE_V9)).length, 6);
  assert.ok(!renderOrderFicha(bare, TEMPLATE_V9).includes('sheet extra'));
});

test('FPI-12: the header repeats on the back of the item', () => {
  const pages = sheets(renderOrderFicha(shortOrder(), TEMPLATE_V9));
  assert.equal(pages.length, 6);
  for (const index of [0, 1, 2]) {
    const front = pages[index * 2];
    const back = pages[index * 2 + 1];
    assert.equal(head(front), head(back), `item ${index + 1}`);
    assert.match(visible(head(front)), /Item \d de 3/u);
    assert.match(visible(head(front)), /Pedido 128-CRM/u);
    assert.match(
      visible(head(front)),
      /Data do pedido 04\/11\/2026 .*Previsão de entrega 20\/11\/2026/u,
    );
  }
  const audiences = [0, 1, 2].map(
    (index) => /<div class="aud"><strong>(\w+)</u.exec(pages[index * 2])?.[1],
  );
  assert.deepEqual(audiences, ['Masculino', 'Feminino', 'Infantil']);
});

test('FPI-12: the front has the observations where the v8 had the control, and the back has the control', () => {
  const pages = sheets(renderOrderFicha(shortOrder(), TEMPLATE_V9));
  const titles = (/** @type {string} */ page) =>
    [...page.matchAll(/<h2 class="sec">([^<]*)<\/h2>/gu)].map(
      (match) => match[1],
    );
  for (const index of [0, 2, 4]) {
    assert.deepEqual(titles(pages[index]), [
      'Dados do pedido',
      'Dados do item',
      'Observações e anotações do pedido',
    ]);
    assert.ok(!pages[index].includes('campo-producao-vazio'));
    assert.ok(!pages[index].includes('class="art-box'));
    assert.ok(
      visible(pages[index]).includes(
        `Controle de produção e arte na folha ${index + 2} de 6`,
      ),
    );
  }
  for (const index of [1, 3, 5]) {
    assert.deepEqual(titles(pages[index]), [
      'Dados do pedido',
      'Controle de produção',
      'Arte',
    ]);
    // The short order panel identifies the loose sheet.
    for (const label of [
      'Cliente',
      'Nome do pedido',
      'Vendedor',
      'Entregue em',
    ]) {
      assert.match(
        pages[index],
        new RegExp(`<span class="lbl">${label}</span>`),
      );
    }
    assert.doesNotMatch(pages[index], /Dados do item|<li|Anotações/u);
    assert.ok(
      !visible(pages[index]).includes('Controle de produção e arte na'),
    );
  }
  // Block order inside each sheet.
  const at = (/** @type {string} */ page, /** @type {string} */ text) =>
    page.indexOf(text);
  assert.ok(
    at(pages[0], '<header') < at(pages[0], 'Dados do pedido') &&
      at(pages[0], 'Dados do pedido') < at(pages[0], 'Dados do item') &&
      at(pages[0], 'Dados do item') < at(pages[0], 'Observações e anotações') &&
      at(pages[0], 'Observações e anotações') < at(pages[0], '<footer'),
  );
  assert.ok(
    at(pages[1], 'Dados do pedido') < at(pages[1], 'Controle de produção') &&
      at(pages[1], 'Controle de produção') <
        at(pages[1], 'class="panel arte"') &&
      at(pages[1], 'class="panel arte"') < at(pages[1], '<footer'),
  );
});

test('FPI-12: the observations panel keeps three ruled lines, and with no observations it is only lines', () => {
  const order = shortOrder();
  order.ficha.observations = [];
  const [front] = sheets(renderOrderFicha(order, TEMPLATE_V9));
  assert.match(
    front,
    /<h2 class="sec">Observações e anotações do pedido<\/h2>/u,
  );
  assert.equal(noteNumbers(front).length, 0);
  assert.ok(!front.includes('<ol>') && !front.includes('class="more"'));
  assert.match(
    front,
    /<div class="ruled" aria-hidden="true"><div class="lines">(<i><\/i>){3,}/u,
  );
  const html = renderOrderFicha(order, TEMPLATE_V9);
  assert.match(
    html,
    /\.ruled \{[^}]*flex: 1 1 0[^}]*min-height: calc\(3 \* var\(--space-6\)\)/u,
  );
  assert.match(
    html,
    /\.lines i \{[^}]*height: var\(--space-6\)[^}]*border-bottom/u,
  );
  // The panel takes the rest of the sheet.
  assert.match(html, /\.obs \{ flex: 1 1 auto;/u);
});

test('FPI-12: a short order lists every observation on the front, with no extra sheet and no notice', () => {
  const order = shortOrder();
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const pages = sheets(html);
  assert.equal(pages.length, 6);
  assert.ok(!html.includes('sheet extra'));
  assert.doesNotMatch(visible(html), NOTICE);
  for (const index of [0, 2, 4]) {
    assert.deepEqual(noteNumbers(pages[index]), [1, 2, 3]);
    for (const note of order.ficha.observations) {
      assert.ok(visible(pages[index]).includes(note), note);
    }
  }
  // The same strings the v8 printed as the order's observations.
  const strings = printSnapshot(order, TEMPLATE_V8).pedido.observacoes;
  assert.deepEqual(strings, order.ficha.observations);
});

test('FPI-12: observations that do not fit continue on a final sheet, with a notice on the front', () => {
  const order = structuredClone(sample.order);
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const pages = sheets(html);
  const total = pages.length;
  const extra = pages[total - 1];
  assert.equal(kind(extra), 'extra');
  assert.equal(pages.filter((page) => kind(page) === 'extra').length, 1);
  assert.match(
    extra,
    /<div class="aud plain"><strong>Observações \(continuação\)<\/strong>/u,
  );
  assert.match(
    extra,
    /<h2 class="sec">Observações do pedido \(continuação\)<\/h2>/u,
  );
  assert.ok(visible(extra).includes(`Folha ${total} de ${total}`));
  const snapshot = printSnapshot(order, TEMPLATE_V9);
  const expected = splitNotes(
    /** @type {string[]} */ (snapshot.pedido.observacoes),
  );
  assert.equal(expected.length, 14);
  // Every note has a place: on the front of the item, or on the extra sheet,
  // which starts at the first note that did not fit on some item.
  const fronts = pages.filter((page) => kind(page) === 'front');
  assert.equal(fronts.length, 4);
  const kept = fronts.map((page) => noteNumbers(page).length);
  const firstOnExtra = Math.min(...kept) + 1;
  assert.deepEqual(
    noteNumbers(extra),
    Array.from(
      { length: expected.length - firstOnExtra + 1 },
      (_, index) => firstOnExtra + index,
    ),
  );
  for (const [index, front] of fronts.entries()) {
    assert.deepEqual(
      noteNumbers(front),
      Array.from({ length: kept[index] }, (_, i) => i + 1),
    );
    // A front that does not hold them all says where the rest is.
    const notice = NOTICE.exec(visible(front));
    assert.ok(kept[index] < expected.length && notice, `front ${index + 1}`);
    assert.deepEqual([notice[1], notice[2]], [String(total), String(total)]);
  }
  for (const note of order.ficha.observations) {
    assert.ok(visible(html).includes(note), note);
  }
  assert.ok(visible(extra).includes('informação complementar do atendimento'));
  // The extra sheet has no production control and no art.
  assert.doesNotMatch(
    extra,
    /campo-producao-vazio|art-box|Controle de produção/u,
  );
});

test('FPI-12: no observation is cut or dropped when notes are many and long', () => {
  const notes = [
    'Á'.repeat(2500),
    'linha\n'.repeat(45),
    ...Array.from({ length: 40 }, (_, i) => `Instrução ${i}: conferir tudo.`),
  ];
  const pieces = splitNotes(notes);
  assert.equal(pieces.join(''), notes.join(''));
  const order = shortOrder();
  order.ficha.observations = notes;
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const pages = sheets(html);
  const printed = new Set(pages.flatMap(noteNumbers));
  assert.deepEqual(
    [...printed].sort((a, b) => a - b),
    Array.from({ length: pieces.length }, (_, index) => index + 1),
  );
  // Notes on extra sheets are consecutive and in order.
  const onExtras = pages
    .filter((page) => kind(page) === 'extra')
    .flatMap(noteNumbers);
  assert.deepEqual(
    onExtras,
    [...onExtras].sort((a, b) => a - b),
  );
  assert.ok(pages.filter((page) => kind(page) === 'extra').length > 1);
  // The extra sheets come after all items' sheets.
  const firstExtra = pages.findIndex((page) => kind(page) === 'extra');
  assert.equal(firstExtra, 6);
  assert.ok(pages.slice(firstExtra).every((page) => kind(page) === 'extra'));
  for (const front of pages.filter((page) => kind(page) === 'front')) {
    assert.match(visible(front), NOTICE);
  }
});

test('FPI-12: an item that already fills its front keeps the minimum panel and sends the notes to the extra sheet', () => {
  const order = shortOrder();
  const huge = 'Texto longo do item no limite do campo '
    .repeat(6)
    .slice(0, 200);
  const [base] = order.ficha.items;
  order.ficha.items = [
    {
      ...base,
      tipo: huge,
      cor: huge,
      estampa: huge,
      tipo_servico: huge,
      malhas: [huge],
      gola: huge,
      vies_gola: huge,
      vies_mangas: huge,
      modelo: huge,
      cor_frente: huge,
      cor_costas: huge,
      cor_manga_direita: huge,
      cor_manga_esquerda: huge,
    },
  ];
  order.ficha.summary.cliente = huge;
  order.ficha.summary.nome = huge;
  order.ficha.observations = Array.from(
    { length: 12 },
    (_, index) =>
      `Instrução ${index + 1}: ${'conferir o item antes de seguir. '.repeat(5)}`,
  );
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const pages = sheets(html);
  assert.ok(pages.length >= 3);
  assert.deepEqual(pages.slice(0, 2).map(kind), ['front', 'verso']);
  assert.ok(visible(pages[0]).includes('Parte dos dados deste item continua'));
  assert.ok(
    pages.slice(2).some((page) => page.includes('Item 1 · continuação')),
  );
  assert.match(visible(pages[0]), NOTICE);
  for (const note of order.ficha.observations) {
    assert.ok(visible(html).includes(note.trim()), note);
  }
  assert.equal((html.match(/campo-producao-vazio/gu) ?? []).length, 7);
});

test('FPI-12: a grade too long for the sheet points to the extra sheets, which come after the back', () => {
  const order = shortOrder();
  const [base] = order.ficha.items;
  order.ficha.items = [
    {
      ...base,
      quantidade_informada: null,
      grade: Array.from({ length: 60 }, (_, index) => ({
        quantidade: 1,
        tamanho: `Masculino adulto ${index + 1}`,
      })),
    },
  ];
  order.totalPieces = 60;
  order.ficha.observations = [];
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const pages = sheets(html);
  assert.ok(pages.length >= 3);
  assert.match(
    visible(pages[0]),
    new RegExp(
      `Os tamanhos deste item continuam na folha 3 de ${pages.length}\\.`,
      'u',
    ),
  );
  assert.equal(kind(pages[1]), 'verso');
  assert.ok(pages[2].includes('Tamanhos (continuação)'));
  assert.equal((html.match(/>Total<\/th>/gu) ?? []).length, 1);
  for (let i = 1; i <= 60; i += 1) {
    assert.ok(html.includes(`Masculino adulto ${i}<`), String(i));
  }
});

test('FPI-12: the back has seven blank fields, wider labels and a taller art, with no annotations', () => {
  const order = shortOrder();
  order.ficha.items = order.ficha.items.slice(0, 1);
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const back = sheets(html)[1];
  assert.equal((back.match(/campo-producao-vazio/gu) ?? []).length, 7);
  assert.equal((html.match(/campo-producao-vazio/gu) ?? []).length, 7);
  assert.equal(PRODUCTION_FIELDS_V9.length, 7);
  const snapshot = printSnapshot(order, TEMPLATE_V9);
  assert.deepEqual(Object.keys(snapshot.producao), [...PRODUCTION_FIELDS_V9]);
  assert.ok(Object.values(snapshot.producao).every((value) => value === ''));
  for (const label of [
    'Conferido para arrematar',
    'Arrematado',
    'Conferido / Embalado',
    'OBS arremate',
  ]) {
    assert.ok(back.includes(`>${label}</span>`), label);
  }
  assert.equal((back.match(/<span class="cap [lfd]">/gu) ?? []).length, 3);
  assert.equal((back.match(/class="fld d date/gu) ?? []).length, 3);
  assert.ok(!visible(html).includes('Anotações'));
  assert.doesNotMatch(html, /Cores da arte|cores_frente|Total das partes/u);
  // The 12 columns: stage 4, who 5, date 3; the notes field takes 5 + 3.
  assert.match(html, /\.stages \.l \{ grid-column: span 4; \}/u);
  assert.match(html, /\.stages \.f \{ grid-column: span 5; \}/u);
  assert.match(html, /\.stages \.d \{ grid-column: span 3; \}/u);
  assert.match(html, /\.stages \.wide \{ grid-column: span 8; \}/u);
  // Fields of 48px (the v8 had 32px), and 80px for the notes field.
  assert.match(html, /--field-h: 48px; --obs-h: 80px;/u);
  assert.match(
    html,
    /\.sheet\.compact \{[^}]*--field-h: 40px; --obs-h: 64px;/u,
  );
  assert.ok(!back.includes('class="ruled'));
  // Every length of the sheet is on the 4px scale of design.md §6.
  for (const [, value] of html.matchAll(/--space-\d+: (\d+)px/gu)) {
    assert.ok([4, 8, 12, 16, 20, 24, 32, 40, 48, 64].includes(Number(value)));
  }
});

test('FPI-12: no text on the sheet is smaller than 13px and the hierarchy is the one of the v8', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V9);
  const css = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1] ?? '';
  const sizes = [...css.matchAll(/font-size: (\d+)px/gu)].map((m) =>
    Number(m[1]),
  );
  const tokens = [...css.matchAll(/--text-\w+: (\d+)px/gu)].map((m) =>
    Number(m[1]),
  );
  assert.ok(sizes.length + tokens.length > 0);
  for (const size of [...sizes, ...tokens]) assert.ok(size >= 13, String(size));
  const rule = (/** @type {string} */ selector) => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  // The observations are the reduced type: --text-xs (13px) on 20px lines.
  assert.match(
    rule('.obs ol'),
    /font-size: var\(--text-xs\)[^}]*line-height: var\(--lh-sm\)/u,
  );
  assert.match(css, /--text-xs: 13px/u);
  assert.match(css, /--lh-sm: 20px/u);
  // L1..L6 as in the v8.
  assert.match(rule('.aud strong'), /font-size: var\(--text-3xl\)/u);
  assert.match(
    rule('.order strong, .when strong'),
    /font-size: var\(--text-2xl\)/u,
  );
  assert.match(
    rule('.sec'),
    /font-size: var\(--text-lg\)[^}]*font-weight: 600/u,
  );
  assert.match(rule('.val'), /font-size: var\(--val\)[^}]*font-weight: 600/u);
  assert.match(
    rule('.lbl'),
    /font-size: var\(--text-xs\)[^}]*font-weight: 500[^}]*color: var\(--color-text-muted\)/u,
  );
  assert.match(
    rule('.foot'),
    /font-size: var\(--text-xs\)[^}]*font-weight: 400/u,
  );
  assert.doesNotMatch(html, /text-transform|letter-spacing/u);
  for (const page of sheets(html)) {
    assert.equal(
      (head(page).match(/ s3"/gu) ?? []).length,
      4,
      'brand, order and two dates on the same grid',
    );
  }
});

test('FPI-11: the art fills the back; without one, a dashed box says so', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V9);
  const pages = sheets(html);
  const backs = pages.filter((page) => kind(page) === 'verso');
  assert.equal(backs.length, 4);
  for (const index of [0, 3]) {
    assert.match(
      backs[index],
      /<div class="art-box"><img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="Prévia da arte anexada ao item \d">/u,
    );
    assert.ok(!backs[index].includes('Sem arte anexada'));
  }
  for (const index of [1, 2]) {
    assert.match(
      backs[index],
      /<div class="art-box empty"[^>]*><span>Sem arte anexada<\/span>/u,
    );
    assert.ok(!backs[index].includes('<img'));
  }
  assert.match(html, /\.art-box img \{[^}]*object-fit: contain/u);
  assert.match(html, /\.art-box \{[^}]*flex: 1 1 0[^}]*min-height: 96px/u);
  assert.match(html, /\.arte \{ flex: 1 1 auto;/u);
  assert.doesNotMatch(html, /\.art \{ grid-column: span 6|\.ann \{/u);
  assert.doesNotMatch(html, /\sstyle=|<script/iu);
  // No image or box on a front.
  for (const front of pages.filter((page) => kind(page) === 'front')) {
    assert.ok(!front.includes('<img') && !front.includes('art-box'));
  }
});

test('FPI-11: the estampa is helper text under the art box and is omitted when empty', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V9);
  const [front, back] = sheets(html);
  assert.match(
    back,
    /<\/div><p class="art-cap">Estampa \(referência\): Escudo no peito e número nas costas<\/p>/u,
  );
  assert.ok(!front.includes('Estampa'));
  const order = shortOrder();
  order.ficha.items[0].estampa = '';
  const bare = sheets(renderOrderFicha(order, TEMPLATE_V9))[1];
  assert.ok(!visible(bare).includes('Estampa'));
  assert.ok(!bare.includes('art-cap'));
});

test('FPI-11: the order-level preview is the fallback, and only inline raster images pass', () => {
  const png = sample.order.ficha.items[0].artPreview;
  assert.ok(safeArtPreview(png));
  const prefix = 'data:image/png;base64,';
  const atLimit = prefix + 'A'.repeat(1_000_000 - prefix.length);
  assert.equal(safeArtPreview(atLimit), atLimit);
  assert.equal(safeArtPreview(`${atLimit}A`), '', '1,000,001 characters');
  const oversized = shortOrder();
  for (const item of oversized.ficha.items) item.artPreview = `${atLimit}A`;
  oversized.artPreview = `${atLimit}A`;
  const big = renderOrderFicha(oversized, TEMPLATE_V9);
  assert.ok(!big.includes('<img'));
  assert.equal((big.match(/Sem arte anexada/gu) ?? []).length, 6);
  const order = shortOrder();
  for (const item of order.ficha.items) delete item.artPreview;
  order.artPreview = png;
  const backs = sheets(renderOrderFicha(order, TEMPLATE_V9)).filter(
    (page) => kind(page) === 'verso',
  );
  for (const page of backs)
    assert.ok(page.includes('<img src="data:image/png'));
  // An item preview wins over the order one.
  const other = sample.order.ficha.items[3].artPreview;
  order.ficha.items[1].artPreview = other;
  const mixed = sheets(renderOrderFicha(order, TEMPLATE_V9)).filter(
    (page) => kind(page) === 'verso',
  );
  assert.ok(mixed[1].includes(other) && !mixed[1].includes(png));
  // Remote or SVG sources never reach the document; the placeholder prints.
  for (const bad of [
    'https://exemplo.test/arte.png',
    'http://exemplo.test/arte.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,AAAA" onerror="x',
    'javascript:alert(1)',
  ]) {
    const hostile = shortOrder();
    for (const item of hostile.ficha.items) item.artPreview = bad;
    hostile.artPreview = bad;
    const html = renderOrderFicha(hostile, TEMPLATE_V9);
    assert.ok(!html.includes('<img') && !html.includes('exemplo.test'));
    assert.equal((html.match(/class="art-box empty"/gu) ?? []).length, 3);
    const snapshot = /** @type {any} */ (printSnapshot(hostile, TEMPLATE_V9));
    assert.equal(snapshot.pedido.artPreview, '');
    assert.ok(
      snapshot.pedido.itens.every(
        (/** @type {any} */ item) => item.artPreview === '',
      ),
    );
  }
  // The renderer validates on its own, whoever builds the snapshot.
  const snapshot = /** @type {any} */ (
    printSnapshot(sample.order, TEMPLATE_V9)
  );
  assert.equal(snapshot.pedido.itens[0].artPreview, png);
  assert.equal(snapshot.pedido.itens[1].artPreview, '');
  const direct = renderFichaHtmlV9({
    ...snapshot,
    pedido: {
      ...snapshot.pedido,
      itens: [
        {
          ...snapshot.pedido.itens[0],
          artPreview: 'https://exemplo.test/x.png',
        },
      ],
      artPreview: png,
    },
  });
  assert.ok(direct.includes(png) && !direct.includes('exemplo.test'));
});

test('FPI-09/10: money stays off the paper and explicit financial text blocks it with 422', () => {
  const order = structuredClone(sample.order);
  Object.assign(order, {
    finalAmountCents: 99887766,
    paymentCondition: 'FINANCEIRO_SECRETO',
    paidOn: '2024-01-31',
    billing: { url: 'COBRANCA_SECRETA' },
    olist: { id: 'ERP_SECRETO' },
  });
  order.ficha.serviceData.billing = { amount: 'COBRANCA_SECRETA' };
  order.ficha.items[0].grade[0].subtotalCents = 88776655;
  assert.doesNotMatch(
    renderOrderFicha(order, TEMPLATE_V9),
    /99887766|88776655|FINANCEIRO_SECRETO|COBRANCA_SECRETA|ERP_SECRETO|31\/01\/2024|Pago em/u,
  );
  for (const note of [
    'Separar etiquetas. R$ 500',
    'Valor pago: 500',
    'Cobrança no Pix',
    '500 reais',
    'Pagamento parcelado',
  ]) {
    const blocked = shortOrder();
    blocked.ficha.observations = [note];
    assert.throws(() => renderOrderFicha(blocked, TEMPLATE_V9), {
      code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
      statusCode: 422,
    });
  }
  // The check reads the whole note, before it is split for paper.
  const long = shortOrder();
  long.ficha.observations = [`${'x '.repeat(299)}pagamento à vista`];
  assert.equal(splitNotes(long.ficha.observations).length, 2);
  assert.throws(() => renderOrderFicha(long, TEMPLATE_V9), {
    code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
  });
  // Identity and item fields print; financial service data prints masked.
  const named = shortOrder();
  named.ficha.summary.cliente = 'Pix Confecções Ltda';
  named.ficha.serviceData = {
    notes: ['Cliente paga R$ 500 no Pix', 'Conferir a manga direita'],
  };
  const text = visible(renderOrderFicha(named, TEMPLATE_V9));
  assert.ok(text.includes('Pix Confecções Ltda'));
  assert.ok(
    text.includes(
      'Notas do atendimento — contém informação financeira; conferir no CRM',
    ),
  );
  assert.doesNotMatch(text, /R\$ 500|paga R/u);
  assert.ok(text.includes('Conferir a manga direita'));
});

test('FPI-09: free text is escaped and unknown service data is dropped', () => {
  const order = shortOrder();
  order.ficha.observations = ['OBS <img src=x onerror=alert(1)>'];
  order.ficha.items[0].tipo = '<script>alert(1)</script>';
  order.ficha.items[0].estampa = '<b>estampa</b> & "aspas"';
  order.ficha.serviceData = {
    notes: ['NOTA & <b>x</b>', null, 3, { private: 'SECRET' }],
    purchase_profile: 'PERFIL_PRIVADO',
    unknown: 'DESCONHECIDO',
  };
  const html = renderOrderFicha(order, TEMPLATE_V9);
  assert.doesNotMatch(
    html,
    /<script>|<img src=x|<b>x|<b>estampa|SECRET|PERFIL_PRIVADO|DESCONHECIDO|\[object Object\]/u,
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('NOTA &amp;'));
  assert.ok(
    html.includes('&lt;b&gt;estampa&lt;/b&gt; &amp; &quot;aspas&quot;'),
  );
});

test('FPI-06/07: item labels, not-applicable values and the removed texts', () => {
  const order = shortOrder();
  order.ficha.items[0] = {
    ...order.ficha.items[0],
    tipo: 'TIPO_SENTINELA',
    modelo: 'DETALHE_SENTINELA',
    cor: '',
    cor_frente: 'NAO APLICAVEL',
    cor_costas: 'AZUL',
    malhas: ['NAO APLICAVEL', 'DRY'],
  };
  const html = renderOrderFicha(order, TEMPLATE_V9);
  const text = visible(html);
  assert.match(text, /Modelo TIPO_SENTINELA/u);
  assert.match(text, /Detalhe do modelo DETALHE_SENTINELA/u);
  assert.ok(text.includes('NÃO APLICÁVEL / AZUL'));
  assert.ok(text.includes('NÃO APLICÁVEL / DRY'));
  assert.doesNotMatch(
    text,
    /Tipo de roupa|Lastro do pedido|Primeiro contato|FAB|Arte do pedido|Cores da arte|Nº de cores|Quantidade|Informada|divergente|NAO APLICAVEL/u,
  );
  // The grade keeps its blank count row.
  assert.match(
    html,
    /<tr class="k"><th scope="row">Conferido<\/th>(<td><\/td>)+/u,
  );
  assert.match(
    sheets(html)[0],
    /<th scope="col">Total<\/th>[\s\S]*?<td>40<\/td>/u,
  );
});

test('FPI-08/13: the footer prints the version and the time only when given; the sample band only on a sample', () => {
  const order = shortOrder();
  const plain = renderOrderFicha(order, TEMPLATE_V9);
  assert.ok(visible(plain).includes('Folha 1 de 6 · versão 9'));
  assert.ok(!plain.includes('impresso em'));
  assert.equal(plain, renderOrderFicha(order, TEMPLATE_V9));
  const stamped = renderOrderFicha(order, TEMPLATE_V9, {
    printedAt: new Date('2026-11-09T17:20:00.000Z'),
  });
  assert.ok(
    stamped.includes('Folha 6 de 6 · versão 9 · impresso em 09/11/2026 14:20'),
  );
  assert.ok(!plain.includes('Amostra sintética'));
  assert.ok(
    renderFichaHtmlV9(printSnapshot(order, TEMPLATE_V9), {
      synthetic: true,
    }).includes('Amostra sintética — não produzir'),
  );
});

test('FPI-13: one static stylesheet, no script, no inline style, no external request', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V9);
  assert.equal((html.match(/<style>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /\sstyle=|<script/iu);
  assert.ok(html.includes('font-family: Poppins'));
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/u);
  // The stylesheet does not depend on the order.
  const other = shortOrder();
  other.number = '9-CRM';
  const css = (/** @type {string} */ page) =>
    /<style>([\s\S]*?)<\/style>/u.exec(page)?.[1];
  assert.equal(css(renderOrderFicha(other, TEMPLATE_V9)), css(html));
  // The snapshot of the v9 is the one of the v8.
  assert.deepEqual(
    printSnapshot(sample.order, TEMPLATE_V9),
    printSnapshot(sample.order, TEMPLATE_V8),
  );
});

test('FPI-12: the planner counts the sheets, never leaves a note without a place and is empty without items or notes', () => {
  assert.equal(textLines('', 100, 14), 1);
  const base = {
    cliente: 'C',
    nome: 'N',
    vendedor: 'V',
    data: '—',
    entregue: '—',
    notes: /** @type {string[]} */ ([]),
    items: /** @type {any[]} */ ([]),
  };
  assert.deepEqual(planFichaV9(base), { items: [], extras: [], notesFrom: 0 });
  // Notes with no items still get a sheet.
  const orphan = planFichaV9({ ...base, notes: ['a', 'b'] });
  assert.equal(orphan.extras.length, 1);
  assert.deepEqual(orphan.extras[0].notes, [0, 1]);
  const html = renderOrderFicha(
    (() => {
      const order = shortOrder();
      order.ficha.items = [];
      order.totalPieces = 0;
      return order;
    })(),
    TEMPLATE_V9,
  );
  assert.equal(sheets(html).length, 1);
  assert.equal(kind(sheets(html)[0]), 'extra');
  // With items: the plan has one entry per item and a note kept is a prefix.
  const order = structuredClone(sample.order);
  const model = printSnapshot(order, TEMPLATE_V9).pedido;
  assert.equal(/** @type {any[]} */ (model.itens).length, 4);
  const plan = planFichaV9({
    ...base,
    items: shortItems(order),
    notes: Array.from({ length: 60 }, (_, i) => `Nota ${i + 1}`),
  });
  assert.equal(plan.items.length, 4);
  assert.ok(
    plan.items.every((item) => item.notesKept > 0 && item.notesKept < 60),
  );
  assert.equal(plan.notesFrom, Math.min(...plan.items.map((i) => i.notesKept)));
  assert.equal(plan.extras.at(-1)?.notes.at(-1), 59);
});

/** @param {any} order */
function shortItems(order) {
  return order.ficha.items.map((/** @type {any} */ item) => ({
    tipo: item.tipo,
    cor: item.cor,
    aplicacao: item.tipo_servico,
    malha: item.malhas.join(' / '),
    estampa: item.estampa,
    gola: item.gola,
    viesGola: item.vies_gola,
    viesMangas: item.vies_mangas,
    modelo: item.modelo,
    frente: item.cor_frente,
    costas: item.cor_costas,
    mangaDireita: item.cor_manga_direita,
    mangaEsquerda: item.cor_manga_esquerda,
    grade: item.grade.map((/** @type {any} */ line) => ({
      t: line.tamanho,
      q: line.quantidade,
    })),
    total: 0,
  }));
}

test('FPI-13: the v9 is addressable, the switch still names v8 and refuses v9 without the PO approval', async () => {
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V8);
  assert.equal(
    renderOrderFicha(sample.order),
    renderOrderFicha(sample.order, TEMPLATE_V8),
    'the default is still v8',
  );
  assert.notEqual(
    renderOrderFicha(sample.order, TEMPLATE_V9),
    renderOrderFicha(sample.order, TEMPLATE_V8),
  );
  const gate = await validateFichaReviewV9();
  assert.equal(gate.templateVersion, TEMPLATE_V9);
  assert.equal(gate.task, 'FPI-T05');
  assert.equal(gate.versioning.supersedesTemplateVersion, TEMPLATE_V8);
  assert.equal(gate.versioning.overwriteApprovedVersion, false);
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(gate.approval.approved, false);
  // While the PO has not reviewed the sample, the switch refuses v9.
  assert.equal(gate.provisionalApproval.approved, false);
  assert.equal(fichaV9Approved(gate), false);
  assert.throws(
    () =>
      validateFichaPrintSwitch({
        gate: {},
        gateV9: gate,
        printTemplate: TEMPLATE_V9,
      }),
    /before its approval is recorded/u,
  );
  assert.throws(
    () => validateFichaPrintSwitch({ gate: {}, printTemplate: TEMPLATE_V9 }),
    /before its approval is recorded/u,
  );
  // v8 stays valid for the switch regardless of the v9 record.
  assert.doesNotThrow(() =>
    validateFichaPrintSwitch({
      gate: {},
      gateV8: v8Gate,
      gateV9: gate,
      printTemplate: TEMPLATE_V8,
    }),
  );
  // The approval record is the PO's decision, tied to the hashes of the sample.
  const approved = structuredClone(gate);
  approved.provisionalApproval.status = 'approved';
  approved.provisionalApproval.approved = true;
  approved.provisionalApproval.reviewedBy.name = 'PO sintético';
  approved.provisionalApproval.reviewedAt = '2026-11-13';
  assert.equal(fichaV9Approved(approved), true);
  assert.doesNotThrow(() =>
    validateFichaPrintSwitch({
      gate: {},
      gateV9: approved,
      printTemplate: TEMPLATE_V9,
    }),
  );
  const fake = structuredClone(approved);
  fake.snapshotSha256 = createHash('sha256').update('outra').digest('hex');
  assert.equal(fichaV9Approved(fake), false, 'approval needs the same sample');
  const unnamed = structuredClone(approved);
  unnamed.provisionalApproval.reviewedBy.name = '';
  assert.equal(fichaV9Approved(unnamed), false, 'approval needs the reviewer');
});
