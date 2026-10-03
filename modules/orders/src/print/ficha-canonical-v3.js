// `ficha-canonical-v3` (ADR 017): the printed ficha changes together with the
// order screen. Each item prints the seven principal points of the bot's
// ficha (ADR 012) in their order and under the screen's labels, the optional
// extras only when someone filled them, and page 1 carries each of the five
// days of ADR 008 once. The summary takes the screen's labels (T48). The
// production page keeps the 14 blank fields of v2. Until the review PDF is
// approved, orders keep printing on v2 (`PRINT_TEMPLATE` in `./index.js`).

import { display, filledText } from './html.js';

/** What the paper shows where the CRM has nothing (A01). */
export const EMPTY_MARK = '—';

/**
 * The seven principal points, in the order the bot asks them (ADR 012) and
 * the order screen shows them.
 */
export const PRINCIPAL_LABELS = Object.freeze([
  'Tipo de roupa',
  'Cor',
  'Quantidade',
  'Estampa',
  'Tecido',
  'Tamanhos',
  'Gola',
]);

/**
 * The optional extras, in the order the factory reads a piece: model, body,
 * sleeves, then the bindings. `NAO APLICAVEL` is a filled value.
 */
export const EXTRA_FIELDS = Object.freeze([
  Object.freeze({ field: 'modelo', label: 'Modelo' }),
  Object.freeze({ field: 'cor_frente', label: 'Cor frente' }),
  Object.freeze({ field: 'cor_costas', label: 'Cor costas' }),
  Object.freeze({ field: 'cor_manga_direita', label: 'Manga direita' }),
  Object.freeze({ field: 'cor_manga_esquerda', label: 'Manga esquerda' }),
  Object.freeze({ field: 'vies_gola', label: 'Viés gola' }),
  Object.freeze({ field: 'vies_mangas', label: 'Viés mangas' }),
]);

/**
 * PLA-08: the trail strip, in the order the days happen. The order date
 * ("Data do pedido") and the promised delivery ("Entrega prometida") are the
 * other two days of ADR 008 and print only in the summary (ADR 017).
 */
export const TRAIL_FIELDS = Object.freeze([
  Object.freeze({ field: 'primeiro_contato', label: 'Primeiro contato' }),
  Object.freeze({ field: 'pagamento', label: 'Pagamento' }),
  Object.freeze({ field: 'entrega_realizada', label: 'Entrega realizada' }),
]);

const SYNTHETIC_BAND =
  '<span class="synthetic">Amostra sintetica - nao produzir</span>';

/**
 * @typedef {{tamanho: string, quantidade: number}} PrintedSize
 * @typedef {{
 *   tipo: string, cor: string, quantidade: number, estampa: string,
 *   tecido: string, tamanhos: PrintedSize[], gola: string,
 *   adicionais: {field: string, label: string, value: string}[],
 * }} PrintedItem
 */

/**
 * The item as the v3 sheet prints it. Quantity is the sum of the grade and
 * is never read from a stored field. A ficha saved before the change has no
 * `cor`, `estampa` or `gola` and prints them as empty; every v2 field it has
 * still reaches the paper among the extras.
 *
 * @param {any} item
 * @returns {PrintedItem}
 */
export function printableItem(item) {
  const grade = Array.isArray(item?.grade) ? item.grade : [];
  /** @type {PrintedSize[]} */
  const tamanhos = grade.map((/** @type {any} */ line) => ({
    quantidade: Number.isSafeInteger(line?.quantidade) ? line.quantidade : 0,
    tamanho: filledText(line?.tamanho),
  }));
  const malhas = Array.isArray(item?.malhas) ? item.malhas : [];
  return {
    tipo: filledText(item?.tipo),
    cor: filledText(item?.cor),
    quantidade: tamanhos.reduce((total, line) => total + line.quantidade, 0),
    estampa: filledText(item?.estampa),
    tecido: malhas.map(filledText).filter(Boolean).join(' / '),
    tamanhos,
    gola: filledText(item?.gola),
    adicionais: EXTRA_FIELDS.map(({ field, label }) => ({
      field,
      label,
      value: filledText(item?.[field]),
    })).filter((extra) => extra.value !== ''),
  };
}

/** @param {string} value */
function shown(value) {
  return value === ''
    ? `<span class="empty">${EMPTY_MARK}</span>`
    : display(value);
}

/** The FAB as the screen shows it: "01" and "FAB 01" both read "FAB 01". */
function fabLabel(/** @type {unknown} */ value) {
  const text = filledText(value);
  if (text === '') return '';
  return /^fab(?:\s|$)/iu.test(text) ? text.toUpperCase() : `FAB ${text}`;
}

/**
 * @param {number} index
 * @param {string} label
 * @param {string} content already escaped
 * @param {string} [modifier]
 */
function point(index, label, content, modifier = '') {
  return `<div class="point${modifier ? ` ${modifier}` : ''}"><dt><span class="point-number">${display(index + 1)}</span>${display(label)}</dt><dd>${content}</dd></div>`;
}

/** @param {PrintedItem} item */
function principalPoints(item) {
  const sizes =
    item.tamanhos.length === 0
      ? shown('')
      : `<span class="sizes">${item.tamanhos
          .map(
            (line) =>
              `<span class="size"><span>${shown(line.tamanho)}</span><strong>${display(line.quantidade)}</strong></span>`,
          )
          .join('')}</span>`;
  const quantity =
    item.tamanhos.length === 0
      ? shown('')
      : `<strong>${display(item.quantidade)}</strong> peças`;
  const contents = [
    [shown(item.tipo), 'point-type'],
    [shown(item.cor), ''],
    [quantity, 'point-quantity'],
    [shown(item.estampa), 'point-print'],
    [shown(item.tecido), ''],
    [sizes, 'point-sizes'],
    [shown(item.gola), ''],
  ];
  return contents
    .map(([content, modifier], index) =>
      point(index, PRINCIPAL_LABELS[index], content, modifier),
    )
    .join('');
}

/** @param {PrintedItem} item */
function extrasBlock(item) {
  if (item.adicionais.length === 0) return '';
  return `<div class="extras"><span class="extras-title">Adicionais</span><dl>${item.adicionais
    .map(
      (extra) =>
        `<div><dt>${display(extra.label)}</dt><dd>${display(extra.value)}</dd></div>`,
    )
    .join('')}</dl></div>`;
}

/**
 * Renders the A4 landscape document in two pages: the commercial sheet and
 * the blank production control. The snapshot comes from `printSnapshot(order,
 * 'ficha-canonical-v3')`; `synthetic` marks the review package only.
 *
 * @param {any} snapshot
 * @param {{synthetic?: boolean}} [options]
 * @returns {string}
 */
export function renderFichaHtmlV3(snapshot, options = {}) {
  const synthetic = options.synthetic === true;
  const syntheticBand = synthetic ? SYNTHETIC_BAND : '';
  const order = snapshot.pedido;
  /** @type {PrintedItem[]} */
  const items = (Array.isArray(order.itens) ? order.itens : []).map(
    printableItem,
  );
  const itemCards = items
    .map(
      (item, itemIndex) => `<article class="item-card">
        <div class="item-tab"><span>Item</span><strong>${display(itemIndex + 1)}</strong></div>
        <div class="item-content">
          <dl class="points">${principalPoints(item)}</dl>${extrasBlock(item)}
        </div>
      </article>`,
    )
    .join('');
  const trailCells = TRAIL_FIELDS.map(
    ({ field, label }) =>
      `<div><span class="label">${display(label)}</span><strong>${shown(filledText(order.lastro?.[field]))}</strong></div>`,
  ).join('');
  /** @type {string[]} */
  const observations = (
    Array.isArray(order.observacoes) ? order.observacoes : []
  )
    .map(filledText)
    .filter(Boolean);
  const productionSections = [
    {
      title: 'Arremate',
      description: 'Registro de conferencia e execucao.',
      fields: [
        ['Conferido para arrematar por:', 'conferido_arremate_por'],
        ['Data:', 'conferido_arremate_em'],
        ['Arrematado:', 'arrematado_por'],
        ['Data:', 'arrematado_em'],
        ['OBS:', 'observacao_arremate'],
      ],
    },
    {
      title: 'Conferencia e embalagem',
      description: 'Fechamento fisico do pedido.',
      fields: [
        ['Conferido / Embalado por:', 'conferido_embalado_por'],
        ['Data:', 'conferido_embalado_em'],
      ],
    },
    {
      title: 'Cores e arte',
      description: 'Contagem final por parte da peca.',
      fields: [
        ['Cores Frente:', 'cores_frente'],
        ['Costas:', 'cores_costas'],
        ['Manga Direita:', 'cores_manga_direita'],
        ['Manga Esq:', 'cores_manga_esquerda'],
        ['Total:', 'total_cores_partes'],
        ['OBS:', 'observacao_cores'],
        ['Qtd total de cores do pedido:', 'quantidade_total_cores'],
      ],
    },
  ];
  // The review box belongs to the synthetic review package, like the band:
  // a printed order never tells the shop floor that a gate is pending.
  const reviewBox = synthetic
    ? '\n      <div class="review-box"><strong>Aprovação pendente</strong><span>Amostra para aprovar a v3 antes de valer (ADR 017). O PO decide quem assina; a aprovação fica registrada no repositório, nunca neste arquivo.</span></div>'
    : '';

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Ficha de Pedido ${display(order.numero)}</title>
    <style>
      @page { size: A4 landscape; margin: 9mm 9mm 12mm; }
      * { box-sizing: border-box; }
      :root { --canvas: #f7f6fb; --surface: #ffffff; --raised: #f0eef8; --active: #e8e3fa; --text: #1b1530; --muted: #625b75; --border: #d8d4e4; --subtle: #e8e5ef; --accent: #ff5b01; --deep: #0c042d; --link: #5b3fd1; }
      body { background: var(--canvas); color: var(--text); font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 9.5px; margin: 0; }
      h1, h2, h3, p, dl, dd { margin: 0; }
      .sheet-header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 7px; }
      .brand { color: var(--link); font-size: 9px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
      h1 { color: var(--deep); font-size: 21px; letter-spacing: -.03em; line-height: 1; margin-top: 2px; }
      .header-id { align-items: center; display: flex; gap: 8px; }
      .synthetic { background: #fff0e7; border: 1px solid #ffb88f; border-radius: 999px; color: #8b3100; font-size: 7px; font-weight: 800; padding: 4px 8px; text-transform: uppercase; }
      .order-id { background: var(--deep); border-radius: 6px; color: white; min-width: 90px; padding: 6px 9px; text-align: right; }
      .order-id span { display: block; font-size: 6px; letter-spacing: .08em; opacity: .75; text-transform: uppercase; }
      .order-id strong { font-size: 13px; }
      .section-label { color: var(--muted); font-size: 8px; font-weight: 800; letter-spacing: .1em; margin-bottom: 5px; text-transform: uppercase; }
      .label { color: var(--muted); display: block; font-size: 8px; font-weight: 700; letter-spacing: .07em; margin-bottom: 3px; text-transform: uppercase; }
      .empty { color: var(--muted); font-weight: 600; }
      .summary { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; display: grid; grid-template-columns: 1.35fr 1fr .65fr 1fr; overflow: hidden; }
      .summary > div { border-right: 1px solid var(--subtle); min-height: 44px; padding: 7px 9px; }
      .summary > div:last-child { border-right: 0; }
      .summary strong { color: var(--deep); font-size: 12px; overflow-wrap: anywhere; }
      .summary .quantity { color: var(--accent); font-size: 20px; line-height: .9; }
      .supporting { display: grid; gap: 6px; grid-template-columns: 1.5fr 1fr .8fr .5fr; margin: 6px 0 8px; }
      .supporting > div, .trail > div { background: var(--raised); border-radius: 5px; min-height: 34px; padding: 6px 8px; }
      .supporting strong, .trail strong { font-size: 9.5px; overflow-wrap: anywhere; }
      .trail { display: grid; gap: 6px; grid-template-columns: repeat(3, 1fr); margin-bottom: 8px; }
      .trail > div { background: var(--surface); border: 1px solid var(--border); }
      .trail strong { color: var(--deep); }
      .items { display: grid; gap: 7px; }
      .item-card { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; break-inside: avoid; display: grid; grid-template-columns: 40px 1fr; overflow: hidden; }
      .item-tab { align-items: center; background: linear-gradient(180deg, var(--raised), var(--surface)); border-right: 4px solid var(--link); display: flex; flex-direction: column; justify-content: center; padding: 6px 2px; }
      .item-tab span { color: var(--link); font-size: 7px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      .item-tab strong { color: var(--deep); font-size: 18px; line-height: 1.1; }
      .points { display: grid; grid-template-columns: 1.15fr 1fr .62fr 1.55fr; }
      .point { border-right: 1px solid var(--subtle); min-height: 40px; padding: 6px 8px; }
      .point:nth-child(-n + 4) { border-bottom: 1px solid var(--subtle); }
      .point:nth-child(4), .point:nth-child(7) { border-right: 0; }
      .point-sizes { grid-column: span 2; }
      dt { align-items: center; color: var(--muted); display: flex; font-size: 7.5px; font-weight: 800; gap: 4px; letter-spacing: .06em; text-transform: uppercase; }
      .point-number { align-items: center; background: var(--deep); border-radius: 50%; color: white; display: inline-flex; flex: none; font-size: 6.5px; height: 12px; justify-content: center; letter-spacing: 0; width: 12px; }
      dd { color: var(--deep); font-size: 10px; font-weight: 700; margin-top: 3px; overflow-wrap: anywhere; }
      .point-type dd { font-size: 12px; }
      .point-quantity dd { color: var(--muted); font-size: 8px; }
      .point-quantity strong { color: var(--accent); font-size: 18px; line-height: 1; }
      .point-print dd { font-size: 9px; line-height: 1.3; }
      .sizes { display: flex; flex-wrap: wrap; gap: 4px; }
      .size { background: var(--active); border-radius: 5px; min-width: 38px; padding: 3px 5px; text-align: center; }
      .size span { color: var(--muted); display: block; font-size: 7.5px; font-weight: 700; }
      .size strong { color: var(--deep); font-size: 13px; }
      .extras { align-items: baseline; background: var(--raised); border-top: 1px solid var(--subtle); display: flex; gap: 10px; padding: 5px 8px; }
      .extras-title { color: var(--link); flex: none; font-size: 7.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      .extras dl { display: flex; flex-wrap: wrap; gap: 3px 14px; }
      .extras dl div { align-items: baseline; display: flex; gap: 4px; }
      .extras dt { font-size: 7px; }
      .extras dd { font-size: 9px; margin-top: 0; }
      .page-footer-content { align-items: stretch; display: grid; gap: 8px; grid-template-columns: 1fr 160px; margin-top: 8px; }
      .observations { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; min-height: 64px; padding: 7px 9px; }
      .observations ol { margin: 3px 0 0; padding-left: 16px; }
      .observations li { line-height: 1.35; }
      .grand-total { align-items: center; background: var(--deep); border-radius: 6px; color: white; display: flex; justify-content: space-between; padding: 7px 10px; }
      .grand-total span { font-size: 7px; font-weight: 700; text-transform: uppercase; }
      .grand-total strong { color: #ffb185; font-size: 22px; }
      .page-break { break-before: page; }
      .production-intro { background: #fff0e7; border-left: 4px solid var(--accent); border-radius: 0 6px 6px 0; color: #5b280a; margin-bottom: 8px; padding: 7px 9px; }
      .production-grid { display: grid; gap: 7px; grid-template-columns: 1fr .72fr 1.25fr; }
      .production-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; min-height: 400px; padding: 8px; }
      .panel-number { align-items: center; background: var(--deep); border-radius: 50%; color: white; display: inline-flex; font-size: 8px; font-weight: 800; height: 20px; justify-content: center; margin-right: 5px; width: 20px; }
      .production-panel h2 { color: var(--deep); display: inline; font-size: 12px; }
      .panel-description { color: var(--muted); font-size: 7px; margin: 3px 0 8px 27px; }
      .production-field { border-top: 1px solid var(--subtle); min-height: 54px; padding: 7px 2px 4px; }
      .production-field.observation { min-height: 77px; }
      .production-field strong { font-size: 7.5px; }
      .campo-producao-vazio { border-bottom: 1px solid var(--text); display: block; height: 28px; margin-top: 5px; }
      .production-field.observation .campo-producao-vazio { height: 49px; }
      .review-box { align-items: center; background: var(--deep); border-radius: 7px; color: white; display: flex; justify-content: space-between; margin-top: 8px; padding: 8px 10px; }
      .review-box strong { color: #ffb185; }
      .review-box span { font-size: 7px; max-width: 590px; }
    </style>
  </head>
  <body>
    <header class="sheet-header">
      <div><div class="brand">Silmer</div><h1>FICHA DE PEDIDO</h1></div>
      <div class="header-id">${syntheticBand}<div class="order-id"><span>Pedido</span><strong>${display(order.numero)}</strong></div></div>
    </header>
    <div class="section-label">Resumo do pedido</div>
    <section class="summary">
      <div><span class="label">Cliente</span><strong>${shown(filledText(order.cliente))}</strong></div>
      <div><span class="label">Entrega prometida</span><strong>${shown(filledText(order.data_entrega_confirmada))}</strong></div>
      <div><span class="label">Total de peças</span><strong class="quantity">${display(order.quantidade_total)}</strong></div>
      <div><span class="label">Tipo de serviço</span><strong>${shown(filledText(order.aplicacao))}</strong></div>
    </section>
    <section class="supporting">
      <div><span class="label">Evento / Nome</span><strong>${shown(filledText(order.nome))}</strong></div>
      <div><span class="label">Vendedor</span><strong>${shown(filledText(order.vendedor))}</strong></div>
      <div><span class="label">Data do pedido</span><strong>${shown(filledText(order.data))}</strong></div>
      <div><span class="label">FAB</span><strong>${shown(fabLabel(order.fab))}</strong></div>
    </section>
    <div class="section-label">Lastro do pedido</div>
    <section class="trail">${trailCells}</section>
    <div class="section-label">Itens: os sete pontos e os adicionais</div>
    <section class="items">${itemCards}</section>
    <section class="page-footer-content">
      <div class="observations"><span class="label">Observações do pedido</span>${observations.length === 0 ? shown('') : `<ol>${observations.map((note) => `<li>${display(note)}</li>`).join('')}</ol>`}</div>
      <div class="grand-total"><span>Total<br>de peças</span><strong>${display(order.quantidade_total)}</strong></div>
    </section>

    <section class="page-break">
      <header class="sheet-header">
        <div><div class="brand">Silmer</div><h1>CONTROLE DE PRODUCAO</h1></div>
        <div class="header-id"><span class="synthetic">Campos vazios para preenchimento</span><div class="order-id"><span>Pedido</span><strong>${display(order.numero)}</strong></div></div>
      </header>
      <p class="production-intro">Preenchimento exclusivo da equipe de producao e arte. Os 14 campos abaixo devem chegar vazios a esta etapa.</p>
      <div class="production-grid">${productionSections
        .map(
          (section, sectionIndex) =>
            `<section class="production-panel"><div><span class="panel-number">${display(sectionIndex + 1)}</span><h2>${display(section.title)}</h2></div><p class="panel-description">${display(section.description)}</p>${section.fields
              .map(
                ([label, field]) =>
                  `<div class="production-field${field.includes('observacao') ? ' observation' : ''}"><strong>${display(label)}</strong><span class="campo-producao-vazio">${display(snapshot.producao[field])}</span></div>`,
              )
              .join('')}</section>`,
        )
        .join('')}</div>${reviewBox}
    </section>
  </body>
</html>`;
}
