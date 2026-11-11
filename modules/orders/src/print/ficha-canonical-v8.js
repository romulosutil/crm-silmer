// FPI-01..11 (ADR 078): one A4 portrait sheet per item, in the CRM's design
// system: the customer's data, the item and the production control on the same
// sheet, a line for the count under each size, and ruled room for handwriting.
// The document has no script, one static stylesheet and no style attribute, so
// the print CSP can admit it by hash. The v2–v7 renderers stay untouched.
import { POPPINS_FONT_FACES } from './ficha-v8-fonts.js';
import { gradeLayout, planFicha, splitNotes } from './ficha-v8-pages.js';
import { safeArtPreview } from './ficha-v8-content.js';
import { filledText } from './html.js';
import { NOT_APPLICABLE } from '../domain/ficha.js';

/** The seven production fields that remain on the sheet (FPI-07). */
export const PRODUCTION_FIELDS_V8 = Object.freeze([
  'conferido_arremate_por',
  'conferido_arremate_em',
  'arrematado_por',
  'arrematado_em',
  'observacao_arremate',
  'conferido_embalado_por',
  'conferido_embalado_em',
]);

const LOGO_PATH =
  'M50.1984 135.093C76.3095 135.093 95.6166 118.36 95.6166 96.295C95.6166 71.4713 80.1709 62.6448 50.9343 58.0477C24.0878 54.0018 19.3069 47.3827 19.3069 34.5111C19.3069 22.1911 28.685 13.1813 46.7053 13.1813C64.9091 13.1813 74.471 19.9846 77.597 36.5341H91.9392C89.3649 13.1813 72.9998 0.310046 46.7053 0.310046C21.8816 0.310046 4.41252 15.7561 4.41252 35.9825C4.41252 59.3347 20.7785 67.9774 48.3603 72.206C73.3676 76.2515 80.1709 82.5039 80.1709 97.3982C80.1709 112.292 67.1153 122.222 50.1984 122.222C23.7199 122.222 17.4679 108.983 15.4455 93.3527H0C2.38977 115.786 15.0777 135.093 50.1984 135.093ZM394.439 133.438H409.701V80.6649C409.701 56.9445 422.021 50.8766 441.329 49.957V35.6147C424.044 36.1659 415.769 43.7054 409.701 54.5542V37.2688H394.439V133.438ZM344.739 135.093C366.437 135.093 382.434 123.843 385.744 105.672H370.482C364.096 129.515 326.291 127.862 317.16 105.029C315.292 100.356 314.247 94.7873 314.032 88.3877H386.48V83.4234C386.48 49.0379 365.517 35.6147 343.268 35.6147C316.79 35.6147 298.218 55.8411 298.218 84.8937V86.3653C298.218 115.969 317.525 135.093 344.739 135.093ZM314.583 76.0677C317.157 58.9673 327.638 48.3021 343.268 48.3021C359.082 48.3021 369.379 56.2083 370.85 76.0677H314.583ZM152.226 133.438H167.488V74.597C167.488 57.3119 180.36 48.8538 192.863 48.8538C206.102 48.8538 213.273 55.8411 213.273 72.7582V133.438H228.535V74.597C228.535 57.3119 241.407 48.8538 253.911 48.8538C267.15 48.8538 274.321 55.8411 274.321 72.7582V133.438H289.583V73.8616C289.583 45.9115 274.505 35.6147 257.221 35.6147C245.269 35.6147 230.926 41.131 224.306 53.6348C219.342 40.7635 208.493 35.6147 196.173 35.6147C182.382 35.6147 171.9 42.97 167.488 51.9798V37.2688H152.226V133.438ZM127.963 133.438H143.408V5.77717e-05H127.963V133.438ZM103.515 133.438H118.777V37.2695H103.515V133.438ZM110.871 20.5366C116.387 20.5366 120.984 15.9395 120.984 10.4232C120.984 4.90689 116.387 0.309753 110.871 0.309753C105.354 0.309753 100.757 4.90689 100.757 10.4232C100.757 15.9395 105.354 20.5366 110.871 20.5366Z';

// Tokens from design.md §5 and §6 (apps/edge-web/src/tokens.css, light theme).
// Six levels of hierarchy, each a step apart in size, weight or contrast:
//   L1 audience band   32/40 600 ink          (--text-3xl; Poppins 700 is not embedded)
//   L2 order, dates    24/28 600 ink          (--text-2xl)
//   L3 section titles  18/24 600 ink          (--text-lg)
//   L4 field values    14/20 600 ink          (--text-sm; 13 on a compact sheet)
//   L5 field labels    13/20 500 muted        (--text-xs)
//   L6 helper, footer  13/20 400 muted        (--text-xs)
// Line heights sit on the 4px baseline (16 for labels, 20, 24, 28, 40) instead of
// the 1.5 ratio. Lengths are the 4px scale of §6. The sheet is 729.7px wide inside
// its 32px margins: twelve columns of ~50px with 8px gutters, the same on every
// sheet; a compact sheet only shrinks vertical spacing.
// A label sits 4px over its value and a row 20px (12 compact) from the next, so
// a label always binds to its own value.
const STYLE = `${POPPINS_FONT_FACES}
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --brand-primary: #ff5b01; --brand-ink: #0c042d; --color-surface: #ffffff; --color-surface-raised: color-mix(in srgb, var(--brand-ink) 4%, #ffffff); --color-text: var(--brand-ink); --color-text-muted: color-mix(in srgb, var(--brand-ink) 64%, #ffffff); --color-border: color-mix(in srgb, var(--brand-ink) 14%, #ffffff); --color-border-strong: color-mix(in srgb, var(--brand-ink) 45%, #ffffff); --color-emphasis-surface: var(--brand-ink); --color-emphasis-text: color-mix(in srgb, var(--brand-ink) 6%, #ffffff); --radius-md: 8px; --radius-lg: 12px; --text-xs: 13px; --text-sm: 14px; --text-lg: 18px; --text-2xl: 24px; --text-3xl: 32px; --lh-xs: 16px; --lh-sm: 20px; --lh-lg: 24px; --lh-xl: 28px; --lh-3xl: 40px; --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --field-h: 32px; }
body { margin: 0; background: var(--color-surface); color: var(--color-text); font-family: Poppins, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; }
h1, h2, h3, p, ol { margin: 0; }
b, strong { font-weight: 600; }
@media screen { .sheet { margin: 0 auto; } }
.sheet { --val: var(--text-sm); --pad: var(--space-5); --inset: calc(var(--space-5) + 1px); --gap: var(--space-5); --row: var(--space-5); text-rendering: geometricPrecision; display: flex; flex-direction: column; width: 210mm; min-height: 1120px; padding: var(--space-6) var(--space-8); background: var(--color-surface); color: var(--color-text); font-size: var(--text-sm); line-height: var(--lh-sm); break-after: page; }
.sheet:last-of-type { break-after: auto; }
.sheet.compact { --val: var(--text-xs); --pad: var(--space-3); --gap: var(--space-2); --row: var(--space-3); }
.sec { font-size: var(--text-lg); line-height: var(--lh-lg); font-weight: 600; }
.panel > .sec { margin-bottom: var(--space-2); }
.lbl { display: block; margin-bottom: var(--space-1); font-size: var(--text-xs); line-height: var(--lh-xs); font-weight: 500; color: var(--color-text-muted); }
.val { font-size: var(--val); line-height: var(--lh-sm); font-weight: 600; overflow-wrap: anywhere; }
.dash { font-weight: 400; color: var(--color-text-muted); }
.g12, .row, .head { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: var(--space-2); }
.s3 { grid-column: span 3; }
.head { row-gap: var(--space-3); align-items: start; padding-inline: var(--inset); margin-bottom: var(--gap); }
.aud { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-height: 56px; margin-inline: calc(var(--inset) * -1); padding: var(--space-2) var(--inset); border-radius: var(--radius-lg); background: var(--brand-primary); color: var(--brand-ink); }
.aud strong { font-size: var(--text-3xl); line-height: var(--lh-3xl); font-weight: 600; white-space: nowrap; }
.aud .seq { font-size: var(--text-sm); line-height: var(--lh-sm); font-weight: 500; white-space: nowrap; }
.aud.plain { background: var(--color-emphasis-surface); color: var(--color-emphasis-text); }
.sheet.compact .aud { min-height: 48px; padding-block: var(--space-1); }
.sheet.compact .head { row-gap: var(--space-2); }
.brand svg { display: block; height: var(--space-6); width: auto; fill: var(--brand-primary); margin-bottom: var(--space-1); }
.brand .lbl { margin-bottom: 0; }
.order strong, .when strong { display: block; font-size: var(--text-2xl); line-height: var(--lh-xl); font-weight: 600; overflow-wrap: anywhere; }
.panel { border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--pad) var(--space-5); background: var(--color-surface); }
.panel + .panel { margin-top: var(--gap); }
.client { row-gap: var(--row); }
.c { min-width: 0; }
.item { display: flex; flex-direction: column; gap: var(--row); }
.item > .sec { margin-bottom: 0; }
.item > .sec + * { margin-top: calc(var(--space-2) - var(--row)); }
.dt { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; break-inside: avoid; }
.dt + .dt { margin-top: var(--space-2); }
table { border-collapse: separate; border-spacing: 0; table-layout: fixed; width: 100%; }
caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
col.c-label { width: 84px; }
col.c-total { width: 56px; }
th, td { position: relative; padding: 0 2px; text-align: center; font-size: var(--text-sm); line-height: var(--lh-sm); font-weight: 600; border-left: 1px solid var(--color-border); overflow-wrap: anywhere; }
tr > :first-child { border-left: 0; }
th[scope="row"] { padding-left: var(--space-3); text-align: left; font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 500; color: var(--color-text-muted); }
tr.t th { height: var(--space-6); background: var(--color-surface-raised); font-size: var(--text-xs); }
tr.t th[scope="row"] { font-weight: 500; }
tr.p td, tr.p th, tr.k td, tr.k th { border-top: 1px solid var(--color-border); }
tr.p td, tr.p th { height: var(--space-8); }
tr.k td, tr.k th { height: var(--space-8); }
tr.k th[scope="row"] { font-weight: 500; }
td.spacer, th.spacer { border-left: 0; background: var(--color-surface); }
.list th[scope="col"] { height: var(--space-6); background: var(--color-surface-raised); font-size: var(--text-xs); }
.list th[scope="col"]:first-child { text-align: left; padding-left: var(--space-3); }
.list th[scope="col"]:nth-child(n+2) { width: 96px; }
.list tbody th, .list tbody td, .list tfoot th, .list tfoot td { height: var(--space-8); border-top: 1px solid var(--color-border); }
.list tbody th[scope="row"] { color: var(--color-text); font-size: var(--val); font-weight: 600; }
.notes ol { padding-left: var(--space-5); font-size: var(--val); line-height: var(--lh-sm); }
.notes li { overflow-wrap: anywhere; white-space: pre-wrap; margin-bottom: var(--space-1); }
.more { margin-top: var(--space-1); font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 400; color: var(--color-text-muted); }
.item > .more { margin-top: 0; }
.control { flex: 1 1 auto; display: flex; flex-direction: column; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; height: var(--lh-lg); margin-bottom: var(--space-2); }
.sec-head span { font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 400; color: var(--color-text-muted); }
.stages { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: var(--lh-xs) repeat(2, var(--field-h)); gap: var(--space-1) var(--space-2); align-items: center; }
.cap, .lb { font-size: var(--text-xs); line-height: var(--lh-xs); font-weight: 500; color: var(--color-text-muted); }
.fld { position: relative; display: block; height: var(--field-h); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
.fld .fv { position: absolute; left: var(--space-2); top: 5px; font-size: var(--text-sm); line-height: var(--lh-sm); }
.stages .l, .stages .f { grid-column: span 2; }
.stages .wide { grid-column: span 4; }
.date { display: flex; align-items: center; justify-content: space-evenly; }
.date .sep { color: var(--color-border-strong); font-size: var(--text-sm); line-height: var(--lh-sm); }
.free { margin-top: var(--gap); }
.free h3 { font-size: var(--text-xs); line-height: var(--lh-xs); font-weight: 500; color: var(--color-text-muted); margin-bottom: var(--space-1); }
.free.split { flex: 1 1 0; min-height: calc(var(--lh-xs) + var(--space-1) + 7 * var(--space-5)); display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: var(--space-2); }
.ann { grid-column: span 6; display: flex; flex-direction: column; min-width: 0; }
.ruled { position: relative; flex: 1 1 0; min-height: 0; }
.ruled.seven { display: grid; grid-template-rows: repeat(7, minmax(var(--space-5), 1fr)); }
.ruled.seven i { display: block; border-bottom: 1px solid var(--color-border-strong); }
.art { grid-column: span 6; display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.art-box { display: flex; flex: 1 1 0; align-items: center; justify-content: center; min-height: 96px; overflow: hidden; border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
.art-box.empty { border-style: dashed; font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 500; color: var(--color-text-muted); }
.art-box img { display: block; width: 100%; height: 100%; object-fit: contain; }
.art-cap { font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 400; color: var(--color-text-muted); overflow-wrap: anywhere; }
.extra .free-panel { flex: 1 1 0; min-height: 0; display: flex; }
.extra .free-panel .free { flex: 1 1 0; min-height: 0; margin-top: 0; display: flex; flex-direction: column; }
.extra .free-panel .ruled { position: relative; flex: 1 1 0; min-height: 0; }
.extra .lines { position: absolute; inset: 0; display: flex; flex-direction: column-reverse; overflow: hidden; }
.extra .lines i { display: block; flex: none; height: var(--space-8); border-bottom: 1px solid var(--color-border-strong); }
.extra .notes-panel { flex: 0 0 auto; }
.foot { display: flex; justify-content: space-between; gap: var(--space-4); margin-top: auto; padding: var(--space-2) var(--inset) 0; font-size: var(--text-xs); line-height: var(--lh-sm); font-weight: 400; color: var(--color-text-muted); }
.band { font-weight: 600; color: var(--color-text); white-space: nowrap; }
`;

/** @param {unknown} value */
function display(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** What the paper reads for a stored value. @param {unknown} value */
function printed(value) {
  const text = filledText(value);
  if (!text) return '—';
  return text === NOT_APPLICABLE ? 'NÃO APLICÁVEL' : text;
}

/** @param {unknown} value */
function value(value) {
  const text = printed(value);
  return `<div class="val">${text === '—' ? '<span class="dash">—</span>' : display(text)}</div>`;
}

/** @param {unknown} value */
function humanized(value) {
  const text = filledText(value);
  return text === NOT_APPLICABLE ? 'NÃO APLICÁVEL' : text;
}

/** @param {any} item */
function colorOf(item) {
  if (item.cor) return humanized(item.cor);
  return [...new Set([item.cor_frente, item.cor_costas].filter(Boolean))]
    .map(humanized)
    .join(' / ');
}

const AUDIENCE_LABELS = Object.freeze({
  feminino: 'Feminino',
  infantil: 'Infantil',
  masculino: 'Masculino',
  unissex: 'Unissex',
});

/** @param {any} item */
function audienceOf(item) {
  return (
    AUDIENCE_LABELS[
      /** @type {keyof typeof AUDIENCE_LABELS} */ (item.publico)
    ] ?? ''
  );
}

/** @param {any} item @returns {import('./ficha-v8-pages.js').SheetItem} */
function sheetItem(item) {
  const grade = (Array.isArray(item.grade) ? item.grade : []).map(
    (/** @type {any} */ line) => ({
      t: String(line.tamanho ?? ''),
      q: Number(line.quantidade) || 0,
    }),
  );
  const total = grade.reduce(
    (/** @type {number} */ sum, /** @type {{q: number}} */ line) =>
      sum + line.q,
    0,
  );
  return {
    tipo: printed(item.tipo),
    cor: printed(colorOf(item)),
    aplicacao: printed(item.tipo_servico),
    malha: printed(
      (Array.isArray(item.malhas) ? item.malhas : [])
        .map(humanized)
        .join(' / '),
    ),
    // Empty when the item has no reference text: the caption is then omitted.
    estampa: humanized(item.estampa),
    gola: printed(item.gola || item.vies_gola),
    viesGola: printed(item.vies_gola),
    viesMangas: printed(item.vies_mangas),
    modelo: printed(item.modelo),
    frente: printed(item.cor_frente),
    costas: printed(item.cor_costas),
    mangaDireita: printed(item.cor_manga_direita),
    mangaEsquerda: printed(item.cor_manga_esquerda),
    grade,
    total,
  };
}

const RULES = '<i></i>'.repeat(38);
const SEVEN = '<i></i>'.repeat(7);

/** Label small and muted over a bold value, the one pattern of every field. @param {string} span @param {string} label @param {unknown} text */
const cell = (span, label, text) =>
  `<div class="c ${span}"><span class="lbl">${display(label)}</span>${value(text)}</div>`;

/**
 * The units [from, to) of the grade. Only the last one prints the total.
 *
 * @param {import('./ficha-v8-pages.js').SheetItem} item
 * @param {number} from
 * @param {number} to
 */
function gradeTables(item, from, to) {
  const { list, units } = gradeLayout(item.grade);
  if (units.length === 0) {
    return '<div class="val"><span class="dash">—</span></div>';
  }
  const slice = units.slice(from, to);
  if (slice.length === 0) return '';
  const lastSheet = to === units.length;
  if (list) {
    const rows = slice
      .flatMap((unit) => unit.lines)
      .map(
        (line) =>
          `<tr><th scope="row">${display(line.t)}</th><td>${display(line.q)}</td><td></td></tr>`,
      )
      .join('');
    const foot = lastSheet
      ? `<tfoot><tr><th scope="row">Total</th><td>${display(item.total)}</td><td></td></tr></tfoot>`
      : '';
    return `<div class="dt"><table class="list"><caption>Tamanhos, pedido e conferido</caption><thead><tr><th scope="col">Tamanho</th><th scope="col">Pedido</th><th scope="col">Conferido</th></tr></thead><tbody>${rows}</tbody>${foot}</table></div>`;
  }
  const many = units.length > 1;
  const perBlock = units[0].lines.length;
  return slice
    .map((unit, offset) => {
      const index = from + offset;
      const block = unit.lines;
      const last = index === units.length - 1;
      const missing =
        many && block.length < perBlock ? perBlock - block.length : 0;
      const filler = missing
        ? `<td class="spacer" colspan="${missing}"></td>`
        : '';
      const fillerHead = missing
        ? `<th class="spacer" colspan="${missing}"></th>`
        : '';
      const blank = '<td class="spacer"></td>';
      const columns = '<col>'.repeat(many ? perBlock : block.length);
      return `<div class="dt"><table><caption>Tamanhos, pedido e conferido${many ? `, bloco ${index + 1} de ${units.length}` : ''}</caption><colgroup><col class="c-label">${columns}<col class="c-total"></colgroup><tr class="t"><th scope="row">Tamanho</th>${block.map((line) => `<th scope="col">${display(line.t)}</th>`).join('')}${fillerHead}${last ? '<th scope="col">Total</th>' : blank}</tr><tr class="p"><th scope="row">Pedido</th>${block.map((line) => `<td>${display(line.q)}</td>`).join('')}${filler}${last ? `<td>${display(item.total)}</td>` : blank}</tr><tr class="k"><th scope="row">Conferido</th>${block.map(() => '<td></td>').join('')}${filler}${last ? '<td></td>' : blank}</tr></table></div>`;
    })
    .join('');
}

/**
 * Three groups on the one four-column grid: the product, the finishing and
 * the fabrics. The size table's Total carries the quantity.
 *
 * @param {import('./ficha-v8-pages.js').SheetItem} item
 * @returns {Record<'r1' | 'r2' | 'r3', string>}
 */
function itemRows(item) {
  return {
    r1: `<div class="row r1">${cell('s3', 'Modelo', item.tipo)}${cell('s3', 'Cor', item.cor)}${cell('s3', 'Modelo de malha', item.malha)}${cell('s3', 'Aplicação', item.aplicacao)}</div>`,
    r2: `<div class="row r2">${cell('s3', 'Gola', item.gola)}${cell('s3', 'Viés da gola', item.viesGola)}${cell('s3', 'Viés das mangas', item.viesMangas)}${cell('s3', 'Detalhe do modelo', item.modelo)}</div>`,
    r3: `<div class="row r3">${cell('s3', 'Tecido frente', item.frente)}${cell('s3', 'Tecido costas', item.costas)}${cell('s3', 'Tecido manga direita', item.mangaDireita)}${cell('s3', 'Tecido manga esquerda', item.mangaEsquerda)}</div>`,
  };
}

/**
 * @param {import('./ficha-v8-pages.js').SheetItem} item
 * @param {number} keep
 * @param {string} notice
 */
function gradeBlock(item, keep, notice) {
  return `<div class="grade">${gradeTables(item, 0, keep)}${notice}</div>`;
}

/**
 * The header on the page's twelve columns. The audience of the item is what
 * the cutter looks for first, so it is a full-width band in the brand orange,
 * edge to edge with the panels, in the heaviest type of the sheet, which also reads on a
 * black-and-white laser; "Item N de M" is its secondary text. Brand, order
 * number and the two dates sit below on the same four-column grid as the
 * body.
 *
 * @param {any} model
 * @param {{audience: string, sequence?: string, title?: string}} top
 */
function head(model, top) {
  const band = top.title
    ? `<div class="aud plain"><strong>${display(top.title)}</strong></div>`
    : `<div class="aud"><strong>${top.audience ? display(top.audience) : '<span class="dash">—</span>'}</strong>${top.sequence ? `<span class="seq">${display(top.sequence)}</span>` : ''}</div>`;
  return `<header class="head">${band}<div class="brand s3"><svg viewBox="0 0 442 136" role="img" aria-label="Silmer"><path d="${LOGO_PATH}"/></svg><span class="lbl">Ficha de pedido</span></div><div class="order s3"><span class="lbl">Pedido</span><strong>${display(model.numero)}</strong></div><div class="when s3"><span class="lbl">Data do pedido</span><strong>${display(printed(model.data))}</strong></div><div class="when s3"><span class="lbl">Previsão de entrega</span><strong>${display(printed(model.previsao))}</strong></div></header>`;
}

/** @param {any} model @param {string} [pointer] */
function clientPanel(model, pointer = '') {
  return `<section class="panel" aria-label="Dados do pedido"><div class="sec-head"><h2 class="sec">Dados do pedido</h2>${pointer}</div><div class="g12 client">${cell('s3', 'Cliente', model.cliente)}${cell('s3', 'Nome do pedido', model.nome)}${cell('s3', 'Vendedor', model.vendedor)}${cell('s3', 'Entregue em', model.entregue)}</div></section>`;
}

/** @param {number[]} indexes @param {string[]} notes */
const noteList = (indexes, notes) =>
  `<ol>${indexes.map((index) => `<li value="${index + 1}">${display(notes[index])}</li>`).join('')}</ol>`;

/** @param {any} production @param {string} field @param {string} [extra] */
const writeField = (production, field, extra = '') =>
  `<div class="fld f campo-producao-vazio${extra}"><span class="fv">${display(production[field])}</span></div>`;

/** @param {any} production @param {string} field */
const dateField = (production, field) =>
  `<div class="fld f date campo-producao-vazio"><span class="fv">${display(production[field])}</span><span class="sep">/</span><span class="sep">/</span></div>`;

/**
 * The art the seller attached, in a fixed box half the width of the control
 * panel, with the estampa reference as helper text under it. Without an image the box says so; without text there is no
 * caption.
 *
 * @param {string} art a validated data URI, or ''
 * @param {string} estampa
 * @param {number} number
 */
function artColumn(art, estampa, number) {
  const box = art
    ? `<div class="art-box"><img src="${display(art)}" alt="Prévia da arte anexada ao item ${number}"></div>`
    : '<div class="art-box empty" role="img" aria-label="Sem arte anexada"><span>Sem arte anexada</span></div>';
  const caption = estampa
    ? `<p class="art-cap">Estampa (referência): ${display(estampa)}</p>`
    : '';
  return `<div class="art">${box}${caption}</div>`;
}

/** @param {any} production @param {string} annotationsTitle @param {string} artHtml */
function controlPanel(production, annotationsTitle, artHtml) {
  const cap =
    '<span class="cap l">Etapa</span><span class="cap f">Por</span><span class="cap f">Data</span>';
  return `<section class="panel control" aria-label="Controle de produção"><div class="sec-head"><h2 class="sec">Controle de produção</h2><span>Preencher à mão</span></div><div class="stages">${cap}${cap}<span class="lb l">Conferido para arrematar</span>${writeField(production, 'conferido_arremate_por')}${dateField(production, 'conferido_arremate_em')}<span class="lb l">Arrematado</span>${writeField(production, 'arrematado_por')}${dateField(production, 'arrematado_em')}<span class="lb l">Conferido / Embalado</span>${writeField(production, 'conferido_embalado_por')}${dateField(production, 'conferido_embalado_em')}<span class="lb l">OBS arremate</span>${writeField(production, 'observacao_arremate', ' wide')}</div><div class="free split"><div class="ann"><h3>${display(annotationsTitle)}</h3><div class="ruled seven" aria-hidden="true">${SEVEN}</div></div>${artHtml}</div></section>`;
}

/** @param {number} sheet @param {number} total @param {any} model @param {string} printedAt @param {boolean} synthetic */
function footer(sheet, total, model, printedAt, synthetic) {
  const version =
    model.versao === null ? '' : ` · versão ${display(model.versao)}`;
  const at = printedAt ? ` · impresso em ${display(printedAt)}` : '';
  return `<footer class="foot"><span>Folha ${sheet} de ${total}${version}${at}</span>${synthetic ? '<span class="band">Amostra sintética — não produzir</span>' : ''}</footer>`;
}

const PRINTED_AT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
});

/** @param {Date | undefined} date */
function printedAtText(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  /** @type {Record<string, string>} */
  const part = {};
  for (const { type, value: piece } of PRINTED_AT.formatToParts(date)) {
    part[type] = piece;
  }
  return `${part.day}/${part.month}/${part.year} ${part.hour}:${part.minute}`;
}

/**
 * @param {any} snapshot
 * @param {{synthetic?: boolean, printedAt?: Date}} [options]
 * @returns {string}
 */
export function renderFichaHtmlV8(snapshot, options = {}) {
  const order = snapshot.pedido;
  const production = snapshot.producao;
  const rawItems = /** @type {any[]} */ (
    Array.isArray(order.itens) ? order.itens : []
  );
  const lastro = order.lastro ?? {};
  const notes = splitNotes(
    (Array.isArray(order.observacoes) ? order.observacoes : [])
      .map(filledText)
      .filter(Boolean),
  );
  const model = {
    numero: order.numero,
    previsao: order.data_entrega_confirmada,
    cliente: printed(order.cliente),
    nome: printed(order.nome),
    vendedor: printed(order.vendedor),
    data: printed(order.data),
    entregue: printed(lastro.entrega_realizada),
    versao: Number.isSafeInteger(order.versao) ? order.versao : null,
    items: rawItems.map(sheetItem),
    notes,
  };
  const plan = planFicha(model);
  const itemCount = plan.items.length;
  const total = itemCount + plan.extras.length;
  const synthetic = options.synthetic === true;
  const printedAt = printedAtText(options.printedAt);
  const firstExtraWith = (/** @type {(extra: any) => boolean} */ test) => {
    const offset = plan.extras.findIndex(test);
    return offset < 0 ? 0 : itemCount + offset + 1;
  };
  const notesSheet = firstExtraWith((extra) => extra.notes.length > 0);
  const annotationsSheet = firstExtraWith((extra) => extra.free);
  const orderArt = safeArtPreview(order.artPreview);
  const pointer = notesSheet
    ? `<span>Observações do pedido na folha ${notesSheet}</span>`
    : '';
  const itemSheets = plan.items.map((itemPlan, index) => {
    const item = model.items[index];
    const rows = itemRows(item);
    const present = /** @type {('r1' | 'r2' | 'r3')[]} */ ([
      'r1',
      'r2',
      'r3',
    ]).filter((key) => !itemPlan.moved.includes(key));
    const carriedSheet = firstExtraWith((extra) =>
      extra.sections.some(
        (/** @type {any} */ section) =>
          section.itemIndex === index && section.rows.length > 0,
      ),
    );
    const gradeSheet = firstExtraWith((extra) =>
      extra.sections.some(
        (/** @type {any} */ section) =>
          section.itemIndex === index && section.grade !== null,
      ),
    );
    const gradeNotice = gradeSheet
      ? `<p class="more">Os tamanhos deste item continuam na folha ${gradeSheet} de ${total}.</p>`
      : '';
    const movedNotice = itemPlan.moved.length
      ? `<p class="more">Parte dos dados deste item continua na folha ${carriedSheet} de ${total}.</p>`
      : '';
    const itemHtml = `<section class="panel item" aria-label="Item ${index + 1}"><h2 class="sec">Dados do item</h2>${present.map((key) => rows[key]).join('')}${gradeBlock(item, itemPlan.gradeKept, gradeNotice)}${movedNotice}</section>`;
    const annotations = annotationsSheet
      ? `Anotações (continua na folha ${annotationsSheet} de ${total})`
      : 'Anotações';
    const art = safeArtPreview(rawItems[index].artPreview) || orderArt;
    return `<article class="sheet${itemPlan.compact ? ' compact' : ''}">${head(model, { audience: audienceOf(rawItems[index]), sequence: `Item ${index + 1} de ${itemCount}` })}${clientPanel(model, pointer)}${itemHtml}${controlPanel(production, annotations, artColumn(art, item.estampa, index + 1))}${footer(index + 1, total, model, printedAt, synthetic)}</article>`;
  });
  const extraSheets = plan.extras.map((extra, offset) => {
    const carried = extra.sections
      .map((section) => {
        const rows = itemRows(model.items[section.itemIndex]);
        if (section.grade) {
          return `<section class="panel item"><h2 class="sec">Tamanhos (continuação) · Item ${section.itemIndex + 1}</h2><div class="grade">${gradeTables(model.items[section.itemIndex], section.grade.from, section.grade.to)}</div></section>`;
        }
        return `<section class="panel item"><h2 class="sec">Item ${section.itemIndex + 1} · continuação</h2>${section.rows.map((key) => rows[key]).join('')}</section>`;
      })
      .join('');
    const notesPanel = extra.notes.length
      ? `<section class="panel notes notes-panel" aria-label="Observações do pedido"><h2 class="sec">Observações do pedido</h2>${noteList(extra.notes, notes)}</section>`
      : '';
    const annotations = extra.free
      ? `<section class="panel free-panel"><div class="free"><h3>Anotações (continuação) · Item ______</h3><div class="ruled" aria-hidden="true"><div class="lines">${RULES}</div></div></div></section>`
      : '';
    return `<article class="sheet extra${extra.compact ? ' compact' : ''}">${head(model, { audience: '', title: extra.carries ? 'Continuação' : 'Observações' })}${clientPanel(model)}${carried}${notesPanel}${annotations}${footer(itemCount + offset + 1, total, model, printedAt, synthetic)}</article>`;
  });
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Ficha de Pedido ${display(order.numero)}</title>
  <style>${STYLE}</style>
</head>
<body>
<main>${itemSheets.join('')}${extraSheets.join('')}</main>
</body>
</html>`;
  return html;
}
