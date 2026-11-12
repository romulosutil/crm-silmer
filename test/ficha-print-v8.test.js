import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCTION_FIELDS_V8,
  renderFichaHtmlV8,
} from '../modules/orders/src/print/ficha-canonical-v8.js';
import {
  planFicha,
  splitNotes,
  textLines,
} from '../modules/orders/src/print/ficha-v8-pages.js';
import {
  PRINT_TEMPLATE,
  TEMPLATE_V6,
  TEMPLATE_V7,
  TEMPLATE_V8,
  TEMPLATE_V9,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';
import { safeArtPreview } from '../modules/orders/src/print/ficha-v8-content.js';
import { printSnapshot } from '../modules/orders/src/print/print-snapshot.js';
import {
  fichaV8Approved,
  validateFichaReviewV8,
} from '../scripts/ficha-pdf-review-v8.mjs';
import { validateFichaPrintSwitch } from '../scripts/ficha-pdf-review.mjs';

const root = new URL('../', import.meta.url);
/** @param {{pedido: unknown}} snapshot */
const pedidoOf = (snapshot) => /** @type {any} */ (snapshot.pedido);
/** @param {string} path */
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const sample = await read('docs/phase0/ficha-pdf-synthetic-v8.json');
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

test('FPI-01: each item gets one sheet, with the order data repeated', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const pages = sheets(html);
  assert.equal(pages.length, 4, 'three items and the observations sheet');
  for (const [index, page] of pages.slice(0, 3).entries()) {
    const text = visible(page);
    assert.ok(text.includes(`Item ${index + 1} de 3`));
    assert.ok(text.includes('128-CRM'));
    assert.ok(text.includes('Associação Atlética Exemplo'));
    assert.ok(text.includes('Uniformes temporada 2027'));
    assert.ok(text.includes('20/11/2026'));
    assert.ok(!text.includes('30/10/2026'), 'no first contact day');
    assert.ok(text.includes('Controle de produção'));
    assert.ok(text.includes(`Folha ${index + 1} de 4`));
  }
  assert.doesNotMatch(html, /Lastro do pedido/u);
});

test('FPI-01: the audience leads the header; the item number is secondary', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const [first, second, third] = sheets(html);
  const head = (/** @type {string} */ page) =>
    /<header class="head">[\s\S]*?<\/header>/u.exec(page)?.[0] ?? '';
  assert.match(
    head(first),
    /<div class="aud"><strong>Masculino<\/strong><span class="seq">Item 1 de 3<\/span>/u,
  );
  assert.match(head(second), /<div class="aud"><strong>Feminino<\/strong>/u);
  assert.match(head(third), /<div class="aud"><strong>Infantil<\/strong>/u);
  // The band is the largest type, a solid orange block edge to edge with the
  // panels and in heavy letters, so it also reads on a laser.
  assert.match(
    html,
    /\.aud \{[^}]*margin-inline: calc\(var\(--inset\) \* -1\)[^}]*background: var\(--brand-primary\)/u,
  );
  assert.match(html, /\.aud strong \{ font-size: var\(--text-3xl\)/u);
  assert.match(html, /--text-3xl: 32px/u);
  // design.md §5: no upper case, and the audience keeps its own spelling.
  assert.doesNotMatch(html, /text-transform|letter-spacing/u);
  // Brand, order and the two dates sit on the same four-column grid.
  assert.equal((head(first).match(/ s3"/gu) ?? []).length, 4);
  assert.ok(head(first).indexOf('Masculino') < head(first).indexOf('Item'));
});

test('FPI-01: both dates sit together in the header; no first contact or FAB', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  for (const page of sheets(html)) {
    const header =
      /<header class="head">[\s\S]*?<\/header>/u.exec(page)?.[0] ?? '';
    assert.match(visible(header), /Pedido 128-CRM/u);
    assert.match(
      visible(header),
      /Data do pedido 04\/11\/2026 .*Previsão de entrega 20\/11\/2026/u,
    );
    const body = visible(page.replace(header, ''));
    assert.ok(!body.includes('Data do pedido'));
    assert.ok(!body.includes('Previsão de entrega'));
  }
  assert.doesNotMatch(
    visible(html),
    /Primeiro contato|FAB|Arte do pedido|O cliente envia a arte/u,
  );
  const snapshot = printSnapshot(shortOrder(), TEMPLATE_V8);
  assert.equal(
    /** @type {any} */ (snapshot.pedido.lastro).primeiro_contato,
    undefined,
  );
  assert.equal(snapshot.pedido.fab, undefined);
  assert.equal(/** @type {any} */ (snapshot.pedido).artwork, undefined);
  assert.ok(
    /** @type {any} */ (printSnapshot(shortOrder(), TEMPLATE_V6).pedido)
      .artwork,
  );
});

test('FPI-01: every section has a title in one scale, nothing outsizes it', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const first = sheets(html)[0];
  for (const title of [
    'Dados do pedido',
    'Dados do item',
    'Controle de produção',
  ]) {
    assert.match(first, new RegExp(`<h2 class="sec">${title}</h2>`, 'u'));
  }
  assert.match(html, /\.sec \{ font-size: var\(--text-lg\)/u);
  assert.match(
    html,
    /\.lbl \{[^}]*font-size: var\(--text-xs\)[^}]*color: var\(--color-text-muted\)/u,
  );
  assert.match(html, /\.val \{ font-size: var\(--val\)[^}]*font-weight: 600/u);
  // Body text is 13 or 14px; the section title is 18px.
  assert.match(html, /--text-lg: 18px/u);
  assert.match(html, /--text-sm: 14px/u);
  assert.doesNotMatch(html, /\.qty-line strong/u);
});

test('FPI-05/06: the item fields use Modelo and the old field is the model detail', () => {
  const order = shortOrder();
  order.ficha.items[0].tipo = 'TIPO_SENTINELA';
  order.ficha.items[0].modelo = 'DETALHE_SENTINELA';
  const text = visible(renderOrderFicha(order, TEMPLATE_V8));
  assert.match(text, /Modelo TIPO_SENTINELA/u);
  assert.match(text, /Detalhe do modelo DETALHE_SENTINELA/u);
  assert.doesNotMatch(text, /Tipo de roupa/u);
  assert.match(text, /Modelo de malha/u);
});

test('FPI-07: only the seven production fields stay, blank', () => {
  const order = shortOrder();
  order.ficha.items = order.ficha.items.slice(0, 1);
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.equal(
    (html.match(/campo-producao-vazio/gu) ?? []).length,
    PRODUCTION_FIELDS_V8.length,
  );
  assert.equal(PRODUCTION_FIELDS_V8.length, 7);
  const snapshot = printSnapshot(order, TEMPLATE_V8);
  assert.deepEqual(Object.keys(snapshot.producao), [...PRODUCTION_FIELDS_V8]);
  assert.ok(Object.values(snapshot.producao).every((value) => value === ''));
  assert.doesNotMatch(html, /Cores da arte|cores_frente|Total das partes/u);
  for (const label of [
    'Conferido para arrematar',
    'Arrematado',
    'Conferido / Embalado',
    'OBS arremate',
  ]) {
    assert.ok(html.includes(label), label);
  }
  // The stored production keys of older templates are unchanged.
  assert.equal(
    Object.keys(printSnapshot(order, TEMPLATE_V6).producao).length,
    14,
  );
});

test('FPI-03: the grade has a blank count row, with no step numbers, boxes or heading row', () => {
  const order = shortOrder();
  order.ficha.items = order.ficha.items.slice(0, 1);
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.equal((html.match(/class="check"/gu) ?? []).length, 0);
  assert.doesNotMatch(html, /Caixa de conferência|grade-head/u);
  assert.match(
    html,
    /<tr class="k"><th scope="row">Conferido<\/th>(<td><\/td>)+/u,
  );
  const text = visible(html);
  assert.ok(!text.includes('Escrever a contagem em Conferido'));
  assert.doesNotMatch(
    text,
    /\b[1-7] ?(Modelo|Cor|Quantidade|Aplicação|Modelo de malha|Tamanhos|Gola)\b/u,
  );
  assert.doesNotMatch(text, /Tamanhos(?!, pedido)/u);
  // The size table itself stays.
  for (const label of ['Tamanho', 'Pedido', 'Conferido', 'Total']) {
    assert.ok(html.includes(`>${label}</th>`), label);
  }
});

test('FPI-01: the hierarchy has six levels, each a step from the next', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const rule = (/** @type {string} */ selector) => {
    const at = html.indexOf(`
${selector} {`);
    return at < 0 ? '' : html.slice(at, html.indexOf('}', at));
  };
  const size = (/** @type {string} */ selector) =>
    /font-size: var\(--text-(\w+)\)/u.exec(rule(selector))?.[1];
  assert.equal(size('.aud strong'), '3xl');
  assert.equal(size('.order strong, .when strong'), '2xl');
  assert.equal(size('.sec'), 'lg');
  assert.match(rule('.sec'), /font-weight: 600/u);
  assert.match(rule('.val'), /font-size: var\(--val\)[^}]*font-weight: 600/u);
  assert.match(
    rule('.lbl'),
    /font-size: var\(--text-xs\)[^}]*font-weight: 500[^}]*color: var\(--color-text-muted\)/u,
  );
  assert.match(
    rule('.foot'),
    /font-size: var\(--text-xs\)[^}]*font-weight: 400/u,
  );
  assert.match(
    rule('.art-cap'),
    /font-weight: 400[^}]*color: var\(--color-text-muted\)/u,
  );
  const px = (/** @type {string} */ token) =>
    Number(new RegExp(`--text-${token}: ([0-9]+)px`, 'u').exec(html)?.[1]);
  // Strictly decreasing sizes from the audience down to the labels.
  assert.ok(
    px('3xl') > px('2xl') &&
      px('2xl') > px('lg') &&
      px('lg') > px('sm') &&
      px('sm') > px('xs'),
  );
  assert.ok(px('xs') >= 13);
  // Every length of the sheet is on the 4px scale of design.md §6.
  for (const [, value] of html.matchAll(/--space-\d+: (\d+)px/gu)) {
    assert.ok(
      [4, 8, 12, 16, 20, 24, 32, 40, 48, 64].includes(Number(value)),
      value,
    );
  }
});

test('FPI-01: a label binds to its value and the sides never move on a compact sheet', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V8);
  const css = (/** @type {string} */ selector) => {
    const at = html.indexOf(`\n${selector} {`);
    return at < 0 ? '' : html.slice(at, html.indexOf('}', at));
  };
  const space = (/** @type {string} */ token) =>
    Number(new RegExp(`--space-${token}: ([0-9]+)px`, 'u').exec(html)?.[1]);
  // 4px from a label to its value; the next row at least three times that.
  assert.match(css('.lbl'), /margin-bottom: var\(--space-1\)/u);
  assert.equal(space('1'), 4);
  assert.match(css('.sheet'), /--row: var\(--space-5\)/u);
  assert.match(css('.sheet.compact'), /--row: var\(--space-3\)/u);
  assert.ok(space('3') >= 3 * space('1') && space('5') >= 5 * space('1'));
  // Compact shrinks vertical spacing only: the horizontal inset is one value.
  assert.doesNotMatch(css('.sheet.compact'), /--inset/u);
  // The 1px border is paid out of the padding so blocks stay on the 4px grid.
  assert.match(
    css('.panel'),
    /padding: calc\(var\(--pad\) - 1px\) calc\(var\(--space-5\) - 1px\)/u,
  );
  assert.match(css('.sheet'), /--inset: var\(--space-5\)/u);
});

test('FPI-08: annotations on an item sheet have seven ruled lines, beside half-width art', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V8);
  for (const page of sheets(html).slice(0, 4)) {
    assert.equal(
      (
        /<div class="ruled seven"[^>]*>([\s\S]*?)<\/div>/u
          .exec(page)?.[1]
          .match(/<i><\/i>/gu) ?? []
      ).length,
      7,
    );
  }
  assert.match(html, /\.ann \{ grid-column: span 6/u);
  assert.match(html, /\.art \{ grid-column: span 6/u);
});

test('FPI-06: every field is a small label over a bold value', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  for (const label of [
    'Cliente',
    'Nome do pedido',
    'Vendedor',
    'Entregue em',
    'Modelo',
    'Cor',
    'Aplicação',
    'Modelo de malha',
    'Gola',
    'Viés da gola',
    'Viés das mangas',
    'Detalhe do modelo',
    'Tecido frente',
    'Tecido costas',
    'Tecido manga direita',
    'Tecido manga esquerda',
  ]) {
    assert.match(
      html,
      new RegExp(`<span class="lbl">${label}</span><div class="val">`, 'u'),
      label,
    );
  }
  assert.ok(!html.includes('class="val b"'));
});

test('FPI-03: sixteen short sizes stay in one block, more open another', () => {
  const order = shortOrder();
  order.ficha.items = [structuredClone(sample.order.ficha.items[3])];
  const one = renderOrderFicha(order, TEMPLATE_V8);
  assert.equal((one.match(/<tr class="k">/gu) ?? []).length, 1);
  order.ficha.items[0].grade.push({ tamanho: '18', quantidade: 1 });
  const two = renderOrderFicha(order, TEMPLATE_V8);
  assert.equal((two.match(/<tr class="k">/gu) ?? []).length, 2);
  assert.equal(sheets(two).length >= 1, true);
});

test('FPI-04: no quantity divergence reaches the paper', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const [first] = sheets(html);
  assert.ok(sample.order.ficha.items[0].quantidade_informada !== 40);
  assert.doesNotMatch(visible(html), /Informada|divergente|Confirmar antes/u);
  assert.ok(!html.includes('class="alert"') && !html.includes('class="badge"'));
  // The size table's Total carries the count: no separate quantity line.
  assert.doesNotMatch(visible(html), /Quantidade|no pedido/u);
  assert.match(first, /<th scope="col">Total<\/th>[\s\S]*?<td>40<\/td>/u);
});

test('FPI-02/10: the observations live only on the last sheet, which the item sheets point to', () => {
  const order = structuredClone(sample.order);
  const html = renderOrderFicha(order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.equal(pages.length, 5);
  for (const [index, page] of pages.slice(0, 4).entries()) {
    assert.equal((page.match(/<li value=/gu) ?? []).length, 0);
    assert.ok(!visible(page).includes('Continua na folha de observações'));
    assert.ok(visible(page).includes('Observações do pedido na folha 5'));
    assert.ok(visible(page).includes(`Folha ${index + 1} de 5`));
    for (const note of order.ficha.observations) {
      assert.ok(!visible(page).includes(note), note);
    }
  }
  const extra = pages[4];
  assert.ok(extra.includes('class="sheet extra'));
  assert.match(extra, /<h2 class="sec">Observações do pedido<\/h2>/u);
  assert.equal((extra.match(/<li value=/gu) ?? []).length, 14);
  for (const note of order.ficha.observations) {
    assert.ok(visible(extra).includes(note), note);
  }
  assert.ok(visible(extra).includes('informação complementar do atendimento'));
  assert.ok(visible(extra).includes('Anotações (continuação) · Item'));
  assert.ok(visible(pages[0]).includes('Anotações (continua na folha 5 de 5)'));
  assert.ok(visible(extra).includes('Folha 5 de 5'));
});

test('FPI-02: without observations there is no observations sheet and no pointer', () => {
  const order = shortOrder();
  order.ficha.observations = [];
  const html = renderOrderFicha(order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.equal(pages.length, 3);
  assert.ok(!html.includes('sheet extra'));
  assert.doesNotMatch(visible(html), /Observações|Anotações \(continua/u);
  assert.ok(visible(pages[2]).includes('Folha 3 de 3'));
});

test('FPI-02: an order with observations has M+1 sheets and a pointer on each item sheet', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  const pages = sheets(html);
  assert.equal(pages.length, 4);
  for (const page of pages.slice(0, 3)) {
    assert.ok(visible(page).includes('Observações do pedido na folha 4'));
  }
  assert.ok(pages[3].includes('sheet extra'));
  assert.ok(visible(pages[3]).includes('Folha 4 de 4'));
});

test('FPI-11: the art preview renders in a fixed box, or a placeholder says there is none', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.equal(pages.length, 5);
  for (const index of [0, 3]) {
    assert.match(
      pages[index],
      /<div class="art-box"><img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="Prévia da arte anexada ao item \d">/u,
    );
    assert.ok(!pages[index].includes('Sem arte anexada'));
  }
  for (const index of [1, 2]) {
    assert.match(
      pages[index],
      /<div class="art-box empty"[^>]*><span>Sem arte anexada<\/span>/u,
    );
    assert.ok(!pages[index].includes('<img'));
  }
  assert.match(html, /\.art-box img \{[^}]*object-fit: contain/u);
  assert.match(html, /\.art-box \{[^}]*flex: 1 1 0[^}]*min-height: 96px/u);
  assert.match(html, /\.ann \{ grid-column: span 6/u);
  assert.match(html, /\.art \{ grid-column: span 6/u);
  assert.doesNotMatch(html, /\sstyle=|<script/iu);
});

test('FPI-11: the estampa is helper text under the art box and is omitted when empty', () => {
  const html = renderOrderFicha(sample.order, TEMPLATE_V8);
  const [first] = sheets(html);
  assert.match(
    first,
    /<p class="art-cap">Estampa \(referência\): Escudo no peito e número nas costas<\/p>/u,
  );
  assert.match(
    html,
    /\.art-cap \{[^}]*font-weight: 400[^}]*color: var\(--color-text-muted\)/u,
  );
  const item =
    /<section class="panel item"[\s\S]*?<\/section>/u.exec(first)?.[0] ?? '';
  assert.ok(!item.includes('Estampa'));
  const order = shortOrder();
  order.ficha.items[0].estampa = '';
  const bare = sheets(renderOrderFicha(order, TEMPLATE_V8))[0];
  assert.ok(!visible(bare).includes('Estampa'));
  assert.ok(!bare.includes('art-cap'));
});

test('FPI-11: the order-level preview is the fallback, and only inline raster images pass', () => {
  const png = sample.order.ficha.items[0].artPreview;
  assert.ok(safeArtPreview(png));
  for (const bad of [
    'https://exemplo.test/arte.png',
    'http://exemplo.test/arte.png',
    '//exemplo.test/arte.png',
    '/api/arte.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/svg+xml,<svg/>',
    'data:text/html;base64,PGgxPng8L2gxPg==',
    'data:image/png;base64,AAAA" onerror="x',
    'data:image/png,AAAA',
    'javascript:alert(1)',
    'blob:https://exemplo.test/1',
    '',
    null,
    42,
  ]) {
    assert.equal(safeArtPreview(bad), '', String(bad));
  }
  const prefix = 'data:image/png;base64,';
  const atLimit = prefix + 'A'.repeat(1_000_000 - prefix.length);
  assert.equal(atLimit.length, 1_000_000);
  assert.equal(safeArtPreview(atLimit), atLimit);
  assert.equal(safeArtPreview(`${atLimit}A`), '', '1,000,001 characters');
  const oversized = shortOrder();
  for (const item of oversized.ficha.items) item.artPreview = `${atLimit}A`;
  oversized.artPreview = `${atLimit}A`;
  const big = renderOrderFicha(oversized, TEMPLATE_V8);
  assert.ok(!big.includes('<img'));
  assert.equal((big.match(/Sem arte anexada/gu) ?? []).length, 6);
  for (const type of ['png', 'jpeg', 'webp']) {
    assert.ok(safeArtPreview(`data:image/${type};base64,AAAA`), type);
  }
  const order = shortOrder();
  for (const item of order.ficha.items) delete item.artPreview;
  order.artPreview = png;
  for (const page of sheets(renderOrderFicha(order, TEMPLATE_V8)).slice(0, 3)) {
    assert.ok(page.includes('<img src="data:image/png'));
  }
  // An item preview wins over the order one.
  const other = sample.order.ficha.items[3].artPreview;
  order.ficha.items[1].artPreview = other;
  const mixed = sheets(renderOrderFicha(order, TEMPLATE_V8));
  assert.ok(mixed[1].includes(other) && !mixed[1].includes(png));
  // Remote or SVG sources never reach the document; the placeholder prints.
  for (const bad of [
    'https://exemplo.test/arte.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ]) {
    const hostile = shortOrder();
    for (const item of hostile.ficha.items) item.artPreview = bad;
    hostile.artPreview = bad;
    const html = renderOrderFicha(hostile, TEMPLATE_V8);
    assert.ok(!html.includes('<img') && !html.includes('exemplo.test'));
    assert.equal((html.match(/class="art-box empty"/gu) ?? []).length, 3);
    const snapshot = printSnapshot(hostile, TEMPLATE_V8);
    assert.equal(snapshot.pedido.artPreview, '');
    assert.ok(
      pedidoOf(snapshot).itens.every(
        (/** @type {any} */ item) => item.artPreview === '',
      ),
    );
  }
  // A valid item preview survives the snapshot; a missing one stays empty.
  const snapshot = printSnapshot(sample.order, TEMPLATE_V8);
  assert.equal(pedidoOf(snapshot).itens[0].artPreview, png);
  assert.equal(pedidoOf(snapshot).itens[1].artPreview, '');
  // The renderer validates on its own, whoever builds the snapshot.
  const direct = renderFichaHtmlV8({
    ...snapshot,
    pedido: {
      ...snapshot.pedido,
      itens: [
        {
          ...pedidoOf(snapshot).itens[0],
          artPreview: 'https://exemplo.test/x.png',
        },
      ],
      artPreview: png,
    },
  });
  assert.ok(direct.includes(png) && !direct.includes('exemplo.test'));
});

test('FPI-02: a short order without observations needs no extra sheet', () => {
  const order = shortOrder();
  order.ficha.observations = [];
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.ok(!html.includes('sheet extra'));
  assert.ok(!html.includes('Continua na folha de observações'));
});

test('FPI-10: long notes keep every character, split between sheets', () => {
  const notes = [
    'Á'.repeat(2500),
    'linha\n'.repeat(45),
    ...Array.from({ length: 40 }, (_, i) => `Instrução ${i}: conferir tudo.`),
  ];
  const pieces = splitNotes(notes);
  assert.equal(pieces.join(''), notes.join(''));
  const order = shortOrder();
  order.ficha.observations = notes;
  const html = renderOrderFicha(order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.ok(pages.length > 4);
  const extras = pages.filter((page) => page.includes('sheet extra'));
  const printed = extras.flatMap((page) =>
    [...page.matchAll(/<li value="(\d+)">([\s\S]*?)<\/li>/gu)].map((match) =>
      Number(match[1]),
    ),
  );
  assert.deepEqual(
    printed,
    Array.from({ length: pieces.length }, (_, index) => index + 1),
  );
});

test('FPI-10: an item too long for its sheet continues with a printed notice', () => {
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
  const html = renderOrderFicha(order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.ok(pages.length >= 2);
  assert.ok(visible(pages[0]).includes('Parte dos dados deste item continua'));
  assert.ok(
    pages.slice(1).some((page) => page.includes('Item 1 · continuação')),
  );
  assert.equal((html.match(/class="check"/gu) ?? []).length, 0);
});

test('FPI-09: money, billing and payment day stay off the paper', () => {
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
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.doesNotMatch(
    html,
    /99887766|88776655|FINANCEIRO_SECRETO|COBRANCA_SECRETA|ERP_SECRETO|31\/01\/2024|Pago em/u,
  );
  assert.equal(
    /** @type {any} */ (printSnapshot(order, TEMPLATE_V8).pedido.lastro)
      .pagamento,
    undefined,
  );
});

test('FPI-09: explicit financial text blocks the paper with 422', () => {
  for (const note of [
    'Separar etiquetas. R$ 500',
    'Valor pago: 500',
    'Cobrança no Pix',
    '500 reais',
    'Pagamento parcelado',
  ]) {
    const order = shortOrder();
    order.ficha.observations = [note];
    assert.throws(() => renderOrderFicha(order, TEMPLATE_V8), {
      code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
      statusCode: 422,
    });
    assert.deepEqual(order.ficha.observations, [note]);
  }
});

test('FPI-09: free text is escaped and unknown service data is dropped', () => {
  const order = shortOrder();
  order.ficha.observations = ['OBS <img src=x onerror=alert(1)>'];
  order.ficha.items[0].tipo = '<script>alert(1)</script>';
  order.ficha.serviceData = {
    notes: ['NOTA & <b>x</b>', null, 3, { private: 'SECRET' }],
    purchase_profile: 'PERFIL_PRIVADO',
    unknown: 'DESCONHECIDO',
  };
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.doesNotMatch(
    html,
    /<script>|<img src=x|<b>x|SECRET|PERFIL_PRIVADO|DESCONHECIDO|\[object Object\]/u,
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('NOTA &amp;'));
});

test('FPI-08: the footer prints the version and the time only when given', () => {
  const order = shortOrder();
  const plain = renderOrderFicha(order, TEMPLATE_V8);
  assert.ok(visible(plain).includes('Folha 1 de 4 · versão 9'));
  assert.ok(!plain.includes('impresso em'));
  assert.equal(plain, renderOrderFicha(order, TEMPLATE_V8));
  const stamped = renderOrderFicha(order, TEMPLATE_V8, {
    printedAt: new Date('2026-11-09T17:20:00.000Z'),
  });
  assert.ok(stamped.includes('impresso em 09/11/2026 14:20'));
  assert.ok(!plain.includes('Amostra sintética'));
  assert.ok(
    renderFichaHtmlV8(printSnapshot(order, TEMPLATE_V8), {
      synthetic: true,
    }).includes('Amostra sintética — não produzir'),
  );
});

test('FPI-08: the sheet has a static stylesheet and no script or inline style', () => {
  const html = renderOrderFicha(shortOrder(), TEMPLATE_V8);
  assert.equal((html.match(/<style>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /\sstyle=|<script/iu);
  assert.ok(html.includes('font-family: Poppins'));
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/u);
});

test('FPI-10: text estimates wrap, keep explicit breaks and break long tokens', () => {
  assert.equal(textLines('', 100, 14), 1);
  assert.equal(textLines('a\nb\r\nc', 500, 14, { preserve: true }), 3);
  assert.ok(textLines('M'.repeat(300), 100, 14) >= 40);
  assert.ok(textLines('palavra '.repeat(40), 100, 14) >= 20);
  const plan = planFicha({
    cliente: 'C',
    nome: 'N',
    vendedor: 'V',
    data: '—',
    entregue: '—',
    notes: [],
    items: [],
  });
  assert.deepEqual(plan, { items: [], extras: [] });
});

test('FPI-08: the v8 stays addressable and earlier templates do not change', () => {
  const order = sample.order;
  assert.equal(PRINT_TEMPLATE, TEMPLATE_V9, 'v9 supersedes it (ADR 087)');
  assert.notEqual(
    renderOrderFicha(order),
    renderOrderFicha(order, TEMPLATE_V8),
    'the default is no longer v8',
  );
  assert.ok(!renderOrderFicha(order, TEMPLATE_V7).includes('sheet extra'));
  assert.ok(renderOrderFicha(order, TEMPLATE_V7).includes('Tipo de roupa'));
  assert.ok(renderOrderFicha(order, TEMPLATE_V6).includes('Tipo de roupa'));
});

test('FPI-08: the sample is locked by hash; the PO approval opens the switch, the physical signature stays pending', async () => {
  const gate = await validateFichaReviewV8();
  assert.equal(gate.templateVersion, TEMPLATE_V8);
  assert.equal(gate.provisionalApproval.status, 'approved');
  assert.equal(gate.provisionalApproval.reviewedAt, '2026-11-12');
  assert.equal(gate.approval.status, 'pending-human-approval');
  assert.equal(fichaV8Approved(gate), true);
  assert.doesNotThrow(() =>
    validateFichaPrintSwitch({
      gate: {},
      gateV8: gate,
      printTemplate: TEMPLATE_V8,
    }),
  );
  const pending = structuredClone(gate);
  pending.provisionalApproval.status = 'pending-po-review';
  pending.provisionalApproval.approved = false;
  assert.equal(fichaV8Approved(pending), false);
  assert.throws(
    () =>
      validateFichaPrintSwitch({
        gate: {},
        gateV8: pending,
        printTemplate: TEMPLATE_V8,
      }),
    /before its approval/u,
  );
  const fake = structuredClone(gate);
  fake.snapshotSha256 = createHash('sha256').update('outra').digest('hex');
  assert.equal(
    fichaV8Approved(fake),
    false,
    'approval cannot refer to a changed sample',
  );
  const unnamed = structuredClone(gate);
  unnamed.provisionalApproval.reviewedBy.name = '';
  assert.equal(fichaV8Approved(unnamed), false, 'approval needs the reviewer');
});

test('FPI-10: only editable observations block; identity and item fields print', () => {
  const order = shortOrder();
  order.ficha.summary.cliente = 'Pix Confecções Ltda';
  order.ficha.summary.nome = 'Equipe 10 Reais';
  order.ficha.items[0].estampa = 'Logo do pagamento rápido';
  const html = renderOrderFicha(order, TEMPLATE_V8);
  assert.ok(visible(html).includes('Pix Confecções Ltda'));
  assert.ok(visible(html).includes('Equipe 10 Reais'));
  for (const note of [
    'Pagamentos na entrega',
    'Já pago',
    'Boleto enviado',
    'NSU 1234',
    'Valor parcelado em duas vezes',
  ]) {
    const blocked = shortOrder();
    blocked.ficha.observations = [note];
    assert.throws(() => renderOrderFicha(blocked, TEMPLATE_V8), {
      code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
      statusCode: 422,
    });
  }
  const visit = shortOrder();
  visit.ficha.observations = ['Colocar o cartão de visita na embalagem'];
  assert.doesNotThrow(() => renderOrderFicha(visit, TEMPLATE_V8));
});

test('FPI-10: financial service data prints masked and never stops the paper', () => {
  const order = shortOrder();
  order.ficha.serviceData = {
    notes: ['Cliente paga R$ 500 no Pix', 'Conferir a manga direita'],
    customizations: 'Nomes individuais',
  };
  const text = visible(renderOrderFicha(order, TEMPLATE_V8));
  assert.ok(
    text.includes(
      'Notas do atendimento — contém informação financeira; conferir no CRM',
    ),
  );
  assert.doesNotMatch(text, /R\$ 500|paga R/u);
  assert.ok(text.includes('Conferir a manga direita'));
  assert.ok(text.includes('Nomes individuais'));
});

test('FPI-10: the financial check reads the whole note, before it is split', () => {
  const order = shortOrder();
  order.ficha.observations = [`${'x '.repeat(299)}pagamento à vista`];
  assert.equal(splitNotes(order.ficha.observations).length, 2);
  assert.throws(() => renderOrderFicha(order, TEMPLATE_V8), {
    code: 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED',
  });
});

test('FPI-01: a grade too long for the sheet continues with header and count rows', () => {
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
  const html = renderOrderFicha(order, TEMPLATE_V8);
  const pages = sheets(html);
  assert.ok(pages.length >= 2);
  assert.match(
    visible(pages[0]),
    /Os tamanhos deste item continuam na folha 2 de \d+\./u,
  );
  const continuation = pages.filter((page) =>
    page.includes('Tamanhos (continuação)'),
  );
  assert.ok(continuation.length >= 1);
  for (const page of continuation) {
    assert.ok(page.includes('>Conferido</th>'));
    assert.ok(page.includes('>Tamanho</th>'));
  }
  assert.equal((html.match(/>Total<\/th>/gu) ?? []).length, 1);
  const labels = Array.from(
    { length: 60 },
    (_, i) => `Masculino adulto ${i + 1}`,
  );
  for (const label of labels) assert.ok(html.includes(label), label);
});

test('FPI-06: not-applicable values print readable, also in combinations', () => {
  const order = shortOrder();
  order.ficha.items[0] = {
    ...order.ficha.items[0],
    cor: '',
    cor_frente: 'NAO APLICAVEL',
    cor_costas: 'AZUL',
    malhas: ['NAO APLICAVEL', 'DRY'],
    gola: '',
    vies_gola: 'VIES_NA_GOLA',
  };
  const text = visible(renderOrderFicha(order, TEMPLATE_V8));
  assert.ok(text.includes('NÃO APLICÁVEL / AZUL'));
  assert.ok(text.includes('NÃO APLICÁVEL / DRY'));
  assert.doesNotMatch(text, /NAO APLICAVEL/u);
  assert.match(text, /Gola VIES_NA_GOLA/u);
});
