import { MAX_ORDER_FILE_BYTES } from '../domain/order-files.js';
import { safeArtPreview } from './ficha-v8-content.js';
import { display, filledText } from './html.js';

/** @typedef {{pages?: string[], notice?: string}} PrintArtwork */
const MAX_ART_URI_LENGTH = Math.ceil(MAX_ORDER_FILE_BYTES / 3) * 4 + 32;

const STYLE = `
@page {
  size: A4 landscape;
  margin: 9mm 10mm 11mm;
  @bottom-right { content: "Folha " counter(page) " de " counter(pages); font: 13px Arial, sans-serif; }
}
* { box-sizing: border-box; }
body { margin: 0; color: #171717; font: 13px/1.35 Arial, sans-serif; }
h1, h2, p, ol, dl, dd { margin: 0; }
h1 { font-size: 22px; }
h2 { font-size: 15px; }
header { margin-bottom: 12px; }
.title { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 2px solid #222; padding-bottom: 4px; }
.details { display: grid; grid-template-columns: 2fr 2fr 1fr 1fr 1fr; gap: 4px 12px; padding-top: 6px; overflow-wrap: anywhere; }
dt, .hint { color: #444; }
dd { font-weight: 600; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th, td { border: 1px solid #a6a6a6; padding: 3px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
thead th { background: #eeeeee; }
.table-title { background: white; border: 0; padding: 0 0 4px; }
.table-title > div { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.table-title span { font-weight: normal; }
.grade-row, .total, .production tr { break-inside: avoid; }
.grade-row > * { padding-block: 1px; }
.item-start > * { border-top-color: #555; }
.item-index, .quantity { text-align: right; }
.total { font-weight: 700; }
.total th { text-align: right; }
.notes { margin: 10px 0; }
.notes h2 { break-after: avoid; }
.notes ol { padding-left: 22px; }
.note { white-space: pre-wrap; overflow-wrap: anywhere; }
.production { margin-top: 10px; }
.production td, .production tbody th { height: 33px; vertical-align: bottom; }
.production .stage { display: grid; grid-template-columns: minmax(0, 1fr) 80px; gap: 6px; }
.field { min-height: 20px; border-bottom: 1px solid #777; }
.date { display: flex; justify-content: space-evenly; color: #555; align-items: end; }
.production-and-art, .approved-art { break-inside: avoid; }
.approved-art { margin-top: 10px; }
.approved-art h2 { margin-bottom: 4px; }
.approved-art img { display: block; margin: 0 auto; max-width: 100%; max-height: 50mm; object-fit: contain; }
.approved-art p { color: #444; }
.art-continuation { break-before: page; }
.art-continuation img { max-height: 170mm; }
`;

/** @param {unknown} value */
function text(value) {
  return display(filledText(value) || '—');
}

/** @param {string} label @param {unknown} value */
function detail(label, value) {
  const content = filledText(value);
  return content ? `<div><b>${label}</b> ${display(content)}</div>` : '';
}

/** @param {any} item @param {number} rows */
function specifications(item, rows) {
  const audience = filledText(item.publico);
  const malhas = Array.isArray(item.malhas)
    ? item.malhas.map(filledText).filter(Boolean).join(' / ')
    : '';
  return [
    `<b>${text(item.tipo)}</b>${detail('Detalhe', item.modelo)}${detail('Cor', item.cor)}${audience ? `<div>${display(audience[0].toUpperCase() + audience.slice(1))}</div>` : ''}`,
    `${text(malhas)}${detail('Aplicação', item.tipo_servico)}${detail('Estampa', item.estampa)}`,
    text(item.cor_frente),
    text(item.cor_costas),
    text(item.cor_manga_direita),
    text(item.cor_manga_esquerda),
    [
      detail('Gola', item.gola),
      detail('Viés da gola', item.vies_gola),
      detail('Viés das mangas', item.vies_mangas),
    ].join('') || '—',
  ]
    .map((value) => `<td rowspan="${rows}">${value}</td>`)
    .join('');
}

/** @param {any} item @returns {{size: string, quantity: number}[]} */
function sizeRows(item) {
  return (Array.isArray(item.grade) ? item.grade : []).map(
    (/** @type {any} */ line) => ({
      size: String(line?.tamanho ?? ''),
      quantity: Number(line?.quantidade) || 0,
    }),
  );
}

/** @param {any[]} items @param {string} orderNumber */
function itemsTable(items, orderNumber) {
  let total = 0;
  const body = items
    .map((item, index) => {
      const sizes = sizeRows(item);
      const lines = sizes.length ? sizes : [{ size: '', quantity: 0 }];
      // Keep the specifications with the first sizes without forcing a very
      // large item onto a new page as a single spanning cell.
      const span = Math.min(lines.length, 12);
      const rows = lines
        .map(({ size, quantity }, line) => {
          total += quantity;
          const details =
            line === 0
              ? `<th scope="rowgroup" rowspan="${span}" class="item-index">${index + 1}</th>${specifications(item, span)}`
              : line >= span
                ? '<td colspan="8"></td>'
                : '';
          return `<tr class="grade-row${line === 0 ? ' item-start' : ''}">${details}<td>${text(size)}</td><td class="quantity">${sizes.length ? display(quantity) : '—'}</td><td aria-label="Conferido à mão"></td></tr>`;
        })
        .join('');
      return `<tbody>${rows}</tbody>`;
    })
    .join('');
  return `<table aria-label="Itens, especificações e grade">
      <colgroup>
        <col style="width:4%"><col style="width:15%"><col style="width:16%">
        <col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:8%">
        <col style="width:12%"><col style="width:9%"><col style="width:4%"><col style="width:8%">
      </colgroup>
      <thead>
        <tr><th colspan="11" class="table-title"><div><h2>Itens, especificações e grade</h2><span>Pedido ${orderNumber}</span></div></th></tr>
        <tr><th scope="col">Item</th><th scope="col">Modelo</th><th scope="col">Malha e aplicação</th>
        <th scope="col">Frente</th><th scope="col">Costas</th><th scope="col">Manga dir.</th><th scope="col">Manga esq.</th>
        <th scope="col">Gola e viés</th><th scope="col">Tam.</th><th scope="col" class="quantity">Qtd.</th><th scope="col">Conferido</th></tr>
      </thead>
      ${body}<tbody><tr class="total"><th scope="row" colspan="9">Total de peças</th><td class="quantity">${display(total)}</td><td></td></tr></tbody>
    </table>`;
}

/** @param {string} orderNumber */
function productionTable(orderNumber) {
  const stage =
    '<td><div class="stage"><div class="field"></div><div class="field date"><span>/</span><span>/</span></div></div></td>';
  return `<table class="production" aria-label="Controle de produção">
    <colgroup><col span="4" style="width:25%"></colgroup>
    <thead>
      <tr><th colspan="4" class="table-title"><div><h2>Controle de produção</h2><span class="hint">Pedido ${orderNumber} · Responsável e data por etapa</span></div></th></tr>
      <tr><th scope="col">Conferido para arrematar</th><th scope="col">Arrematado</th><th scope="col">Conferido / Embalado</th><th scope="col">OBS arremate</th></tr>
    </thead>
    <tbody><tr>${stage.repeat(3)}<td><div class="field"></div></td></tr></tbody>
  </table>`;
}

/** @param {any} pedido @param {PrintArtwork} [artwork] */
export function renderFichaParaImpressao(pedido, artwork = {}) {
  const items = Array.isArray(pedido.itens) ? pedido.itens : [];
  const orderNumber = text(pedido.numero);
  const metadata = [
    ['Cliente', pedido.cliente],
    ['Nome do pedido', pedido.nome],
    ['Vendedor', pedido.vendedor],
    ['Pedido em', pedido.data],
    ['Previsão de entrega', pedido.data_entrega_confirmada],
  ];
  const delivered = filledText(pedido.lastro?.entrega_realizada);
  if (delivered) metadata.push(['Entregue em', delivered]);
  /** @type {string[]} */
  const notes = Array.isArray(pedido.observacoes)
    ? pedido.observacoes.map(filledText).filter(Boolean)
    : [];
  const [firstArt, ...extraArt] = (artwork.pages ?? [])
    .map((page) => safeArtPreview(page, MAX_ART_URI_LENGTH))
    .filter(Boolean);
  const heading = 'Arte final aprovada pelo cliente';
  const unavailable =
    'Não foi possível exibir a arte final. Consulte o arquivo no pedido.';

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Pedido ${orderNumber} · Impressão</title><style>${STYLE}</style></head>
<body>
  <header>
    <div class="title"><h1>Ficha de pedido ${orderNumber}</h1><span>Silmer</span></div>
    <dl class="details">${metadata.map(([label, value]) => `<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>
  </header>
  ${itemsTable(items, orderNumber)}
  ${notes.length ? `<section class="notes"><h2>Observações do pedido ${orderNumber}</h2><ol>${notes.map((note) => `<li class="note">${display(note)}</li>`).join('')}</ol></section>` : ''}
  <div class="production-and-art">
    ${productionTable(orderNumber)}
    <section class="approved-art" aria-label="${heading}">
      <h2>${heading}</h2>
      ${firstArt ? `<img src="${firstArt}" alt="Prévia da arte final do pedido" data-art-fallback="${unavailable}">` : ''}
      ${artwork.notice ? `<p>${display(artwork.notice)}</p>` : ''}
      ${!firstArt && !artwork.notice ? '<p>Nenhuma arte final anexada ao pedido.</p>' : ''}
    </section>
  </div>
  ${extraArt.map((page, index) => `<section class="approved-art art-continuation"><h2>${heading} · página ${index + 2} · Pedido ${orderNumber}</h2><img src="${page}" alt="Página ${index + 2} da arte final do pedido" data-art-fallback="${unavailable}"></section>`).join('')}
</body>
</html>`;
}
