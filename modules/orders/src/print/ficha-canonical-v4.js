// Proposed revision of the approved v3 layout. The v2/v3 renderers and their
// review hashes stay immutable while this revision is reviewed.
import { PAGE_ONE_TOP, paginateItems, wrappedLines } from './ficha-v3-pages.js';
import { filledText } from './html.js';
import { NOT_APPLICABLE } from '../domain/ficha.js';

/** @param {unknown} value */
function display(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** @param {unknown} value */
function present(value) {
  const text = String(value ?? '').trim();
  return text
    ? display(text === NOT_APPLICABLE ? 'NÃO APLICÁVEL' : text)
    : '<span class="empty">—</span>';
}

/** Avoid printing "FAB FAB 01" for older orders. @param {unknown} value */
function fabLabel(value) {
  const text = filledText(value);
  if (text === '') return '';
  return /^fab(?:\s|$)/iu.test(text) ? text.toUpperCase() : `FAB ${text}`;
}

/** @param {any} item */
function colorOf(item) {
  if (item.cor) return item.cor;
  const colors = [
    ...new Set([item.cor_frente, item.cor_costas].filter(Boolean)),
  ];
  return colors.join(' / ');
}

/** @param {any} item */
function additionalOf(item) {
  return [
    ['Cor frente', item.cor_frente],
    ['Cor costas', item.cor_costas],
    ['Manga direita', item.cor_manga_direita],
    ['Manga esquerda', item.cor_manga_esquerda],
    ['Viés das mangas', item.vies_mangas],
  ].filter(([, value]) => typeof value === 'string' && value.trim());
}

/** @param {any} artwork */
function originsOf(artwork) {
  return [
    artwork?.feito_pelo_cliente ? 'Feita pelo cliente' : null,
    artwork?.feito_pela_silmer ? 'Feita pela Silmer' : null,
  ].filter(Boolean);
}

/** @param {number} number @param {string} label @param {string} value @param {string} [className] */
function point(number, label, value, className = '') {
  return `<div class="point ${className}"><span class="point-label"><b>${number}</b> ${display(label)}</span><div class="point-value">${value}</div></div>`;
}

/** @param {any} item @param {number} index @param {any} artwork @param {any[]} visibleGrade @param {number} part @param {number} parts */
function renderItem(item, index, artwork, visibleGrade, part, parts) {
  const total = (item.grade ?? []).reduce(
    (/** @type {number} */ sum, /** @type {any} */ line) =>
      sum + line.quantidade,
    0,
  );
  const origins = originsOf(artwork);
  const printDescription = item.estampa ? present(item.estampa) : present('');
  const printValue = `${printDescription}${origins.length ? `<small>Origem: ${display(origins.join(' e '))}</small>` : ''}`;
  const grade = visibleGrade
    .map(
      (/** @type {any} */ line) =>
        `<div class="grade-cell"><span>${display(line.tamanho)}</span><strong>${display(line.quantidade)}</strong></div>`,
    )
    .join('');
  const additional = additionalOf(item);
  return `<article class="item-card">
    <div class="item-number"><span>Item</span><strong>${index + 1}</strong>${parts > 1 ? `<small>parte ${part + 1}/${parts}</small>` : ''}</div>
    <div class="item-points">
      <div class="item-row top-row">
        ${point(1, 'Tipo de roupa', present(item.tipo))}
        ${point(2, 'Cor', present(colorOf(item)))}
        ${point(3, 'Quantidade', `${display(total)} <small>peças</small>`, 'point-quantity')}
        ${point(4, 'Estampa', printValue)}
      </div>
      <div class="item-row bottom-row">
        ${point(5, 'Tecido', present((item.malhas ?? []).join(' / ')))}
        ${point(6, 'Tamanhos', `<div class="grade-list">${grade}</div>`)}
        ${point(7, 'Definição da gola', present(item.gola || item.vies_gola))}
      </div>
      <div class="item-additional"><span>Tipo de serviço</span><strong>${present(item.tipo_servico)}</strong>${additional.length ? `<span>Adicionais</span>${additional.map(([label, value]) => `<span>${display(label)} <strong>${present(value)}</strong></span>`).join('')}` : ''}</div>
    </div>
  </article>`;
}

const productionSections = [
  {
    title: 'Arremate',
    description: 'Registro de conferência e execução.',
    fields: [
      ['Conferido para arrematar por:', 'conferido_arremate_por'],
      ['Data:', 'conferido_arremate_em'],
      ['Arrematado:', 'arrematado_por'],
      ['Data:', 'arrematado_em'],
      ['OBS:', 'observacao_arremate'],
    ],
  },
  {
    title: 'Conferência e embalagem',
    description: 'Fechamento físico do pedido.',
    fields: [
      ['Conferido / Embalado por:', 'conferido_embalado_por'],
      ['Data:', 'conferido_embalado_em'],
    ],
  },
  {
    title: 'Cores e arte',
    description: 'Contagem final por parte da peça.',
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

/**
 * A4 landscape document. The commercial pages are planned before the blank
 * production sheet so long orders keep a repeated header and no item splits.
 * @param {any} snapshot
 * @param {{synthetic?: boolean}} [options]
 * @returns {string}
 */
export function renderFichaHtmlV4(snapshot, options = {}) {
  const order = snapshot.pedido;
  const items = /** @type {any[]} */ (
    Array.isArray(order.itens) ? order.itens : []
  );
  const observations = Array.isArray(order.observacoes)
    ? order.observacoes.map(filledText).filter(Boolean)
    : [];
  // Seven sizes fit in the reference row. A larger grade repeats the item
  // header in numbered parts, so every size prints without a card taller
  // than a commercial page.
  const fragments = items.flatMap((/** @type {any} */ item, itemIndex) => {
    const grade = Array.isArray(item.grade) ? item.grade : [];
    const parts = Math.max(1, Math.ceil(grade.length / 7));
    return Array.from({ length: parts }, (_, part) => ({
      item,
      itemIndex,
      part,
      parts,
      grade: grade.slice(part * 7, (part + 1) * 7),
    }));
  });
  const originLabel = originsOf(order.artwork).join(' e ');
  const printableItems = fragments.map(({ item, grade }) => ({
    tipo: filledText(item.tipo),
    cor: filledText(colorOf(item)),
    estampa: [
      filledText(item.estampa),
      originLabel ? `Origem: ${originLabel}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    tecido: Array.isArray(item.malhas) ? item.malhas.join(' / ') : '',
    gola: filledText(item.gola || item.vies_gola),
    tamanhos: grade,
    adicionais: [
      { label: 'Tipo de serviço', value: filledText(item.tipo_servico) },
      ...additionalOf(item).map(([label, value]) => ({ label, value })),
    ],
  }));
  const technique = filledText(order.aplicacao);
  // The fifth supporting cell may wrap; reserve its extra lines before
  // placing the first item, so Chromium never creates an unheaded page.
  const techniqueHeight = technique
    ? Math.max(0, wrappedLines(technique, 30) - 1) * 13
    : 0;
  const pages = paginateItems(printableItems, observations, {
    firstPageTop: PAGE_ONE_TOP + techniqueHeight,
  });
  /** @param {number} pageIndex */
  const cardsOf = (pageIndex) =>
    pages[pageIndex]
      .map((fragmentIndex) => {
        const fragment = fragments[fragmentIndex];
        return renderItem(
          fragment.item,
          fragment.itemIndex,
          order.artwork,
          fragment.grade,
          fragment.part,
          fragment.parts,
        );
      })
      .join('');
  const orderFooter = `<section class="page-footer-content"><div class="observations"><span class="label">Observações do pedido</span>${observations.length ? `<ol>${observations.map((/** @type {string} */ note) => `<li>${display(note)}</li>`).join('')}</ol>` : present('')}</div><div class="grand-total"><span>Total<br>de peças</span><strong>${display(order.quantidade_total)}</strong></div></section>`;
  /** @param {number} pageIndex */
  const footerOn = (pageIndex) =>
    pageIndex === pages.length - 1 ? orderFooter : '';
  const continuationPages = pages
    .slice(1)
    .map((page, offset) => {
      const pageIndex = offset + 1;
      return `<section class="page-break continuation"><header class="sheet-header"><div><div class="brand">Silmer</div><h1>FICHA DE PEDIDO</h1></div><div class="header-id"><span class="page-marker">Página ${pageIndex + 1} · continuação dos itens</span><div class="order-id"><span>Pedido</span><strong>${display(order.numero)}</strong></div></div></header>${page.length ? `<div class="section-label">Itens: continuação</div><section class="items">${cardsOf(pageIndex)}</section>` : ''}${footerOn(pageIndex)}</section>`;
    })
    .join('');
  const services = [
    ...new Set(
      items.map((/** @type {any} */ item) => item.tipo_servico).filter(Boolean),
    ),
  ];
  const serviceSummary =
    services.length > 2
      ? `${services.length} serviços · ver itens`
      : services.join(' / ');
  const lastro = order.lastro ?? {};
  const lastroEntries = [
    ['Primeiro contato', lastro.primeiro_contato],
    ['Pagamento', lastro.pagamento],
    ['Entrega realizada', lastro.entrega_realizada],
  ];
  const syntheticBand = options.synthetic
    ? '<span class="synthetic">Amostra sintética — não produzir</span>'
    : '';
  const reviewBox = options.synthetic
    ? '<div class="review-box"><strong>Revisão pendente</strong><span>Rose e Operação revisam a nova ficha impressa antes da produção.</span></div><div class="signatures"><span>Assinatura de Rose</span><span>Data</span><span>Assinatura de Operação</span><span>Data</span></div>'
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Ficha de Pedido ${display(order.numero)}</title>
  <style>
    @page { size: A4 landscape; margin: 9mm 9mm 12mm; }
    * { box-sizing: border-box; }
    :root { --canvas: #f8f7fc; --surface: #fff; --raised: #f0eef8; --active: #e8e3fa; --text: #160e36; --muted: #625b75; --border: #d8d4e4; --subtle: #e8e5ef; --accent: #ff5b01; --deep: #0c042d; --link: #5b3fd1; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: var(--canvas); color: var(--text); font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 9.5px; margin: 0; }
    h1, h2, p, dl, dd { margin: 0; }
    .sheet-header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 7px; }
    .brand { color: var(--link); font-size: 9px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { color: var(--deep); font-size: 21px; letter-spacing: -.03em; line-height: 1; margin-top: 2px; }
    .order-id { background: var(--deep); border-radius: 6px; color: white; min-width: 90px; padding: 6px 9px; text-align: right; }
    .order-id span { display: block; font-size: 6px; letter-spacing: .08em; opacity: .75; text-transform: uppercase; }
    .order-id strong { font-size: 13px; }
    .header-id { align-items: center; display: flex; gap: 8px; }
    .page-marker { background: var(--active); border: 1px solid var(--link); border-radius: 999px; color: var(--deep); font-size: 8px; padding: 4px 9px; }
    .synthetic { background: #fff0e7; border: 1px solid #ffb88f; border-radius: 999px; color: #8b3100; font-size: 7px; font-weight: 800; padding: 4px 8px; text-transform: uppercase; }
    .section-label { color: var(--muted); font-size: 8px; font-weight: 800; letter-spacing: .1em; margin: 8px 0 5px; text-transform: uppercase; }
    .summary { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; display: grid; grid-template-columns: 1.35fr 1fr .65fr 1fr; overflow: hidden; }
    .summary > div { border-right: 1px solid var(--subtle); min-height: 48px; padding: 8px 9px; }
    .summary > div:last-child { border-right: 0; }
    .label { color: var(--muted); display: block; font-size: 8px; font-weight: 700; letter-spacing: .07em; margin-bottom: 3px; text-transform: uppercase; }
    .summary strong { color: var(--deep); font-size: 12px; overflow-wrap: anywhere; }
    .summary .quantity { color: var(--accent); font-size: 20px; line-height: .9; }
    .supporting { display: grid; gap: 6px; grid-template-columns: 1.5fr 1fr .8fr .5fr; margin: 7px 0 9px; }
    .supporting.has-technique { grid-template-columns: 1.5fr 1fr .8fr .5fr 1.5fr; }
    .supporting > div { background: var(--raised); border-radius: 5px; min-height: 36px; padding: 7px 8px; }
    .supporting strong { font-size: 9.5px; }
    .lastro { display: grid; gap: 5px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    .lastro > div { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; min-height: 34px; padding: 6px 8px; }
    .lastro strong { font-size: 9px; }
    .empty { color: var(--muted); }
    .items { display: grid; gap: 8px; }
    .item-card { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; break-inside: avoid; display: grid; grid-template-columns: 36px 1fr; overflow: hidden; }
    .item-number { align-items: center; background: var(--raised); display: flex; flex-direction: column; justify-content: center; text-align: center; }
    .item-number span { color: var(--link); font-size: 7px; font-weight: 800; text-transform: uppercase; }
    .item-number strong { font-size: 18px; }
    .item-number small { color: var(--muted); font-size: 6px; font-weight: 700; }
    .item-points { border-left: 4px solid var(--link); min-width: 0; }
    .item-row { display: grid; }
    .top-row { grid-template-columns: 1.4fr 1.15fr .7fr 1.75fr; }
    .bottom-row { border-top: 1px solid var(--border); grid-template-columns: 1.25fr 1.7fr 1.6fr; }
    .point { border-right: 1px solid var(--subtle); min-height: 46px; min-width: 0; padding: 6px 8px; overflow-wrap: anywhere; }
    .point:last-child { border-right: 0; }
    .point-label { color: var(--muted); display: block; font-size: 7px; font-weight: 800; letter-spacing: .05em; margin-bottom: 3px; text-transform: uppercase; }
    .point-label b { background: var(--deep); border-radius: 50%; color: white; display: inline-grid; font-size: 7px; height: 13px; place-items: center; width: 13px; }
    .point-value { font-size: 10px; font-weight: 700; line-height: 1.2; }
    .point small { display: block; font-size: 7px; font-weight: 500; margin-top: 2px; }
    .point-quantity .point-value { color: var(--accent); font-size: 17px; }
    .point-quantity small { color: var(--muted); display: inline; }
    .grade-list { display: flex; flex-wrap: wrap; gap: 4px; }
    .grade-cell { background: var(--active); border-radius: 5px; min-width: 36px; padding: 4px; text-align: center; }
    .grade-cell span { color: var(--muted); display: block; font-size: 7px; font-weight: 700; overflow-wrap: anywhere; }
    .grade-cell strong { font-size: 13px; }
    .item-additional { align-items: center; background: var(--raised); border-top: 1px solid var(--subtle); display: flex; flex-wrap: wrap; gap: 5px 12px; padding: 5px 8px; }
    .item-additional span { color: var(--muted); font-size: 7px; font-weight: 800; text-transform: uppercase; }
    .item-additional strong { color: var(--deep); font-size: 8px; }
    .page-footer-content { display: grid; gap: 8px; grid-template-columns: 1fr 160px; margin-top: 8px; }
    .observations { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; min-height: 66px; padding: 8px 9px; }
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
    .signatures { display: grid; gap: 18px; grid-template-columns: 2fr 1fr 2fr 1fr; margin-top: 30px; }
    .signatures span { border-top: 1px solid var(--text); font-size: 8px; font-weight: 700; padding-top: 4px; }
  </style>
</head>
<body>
  <header class="sheet-header"><div><div class="brand">Silmer</div><h1>FICHA DE PEDIDO</h1></div><div class="header-id">${syntheticBand}<div class="order-id"><span>Pedido</span><strong>${display(order.numero)}</strong></div></div></header>
  <div class="section-label">Resumo do pedido</div>
  <section class="summary">
    <div><span class="label">Cliente</span><strong>${display(order.cliente)}</strong></div>
    <div><span class="label">Entrega prometida</span><strong>${present(order.data_entrega_confirmada)}</strong></div>
    <div><span class="label">Total de peças</span><strong class="quantity">${display(order.quantidade_total)}</strong></div>
    <div><span class="label">Serviços dos itens</span><strong>${present(serviceSummary)}</strong></div>
  </section>
  <section class="supporting${technique ? ' has-technique' : ''}">
    <div><span class="label">Evento / Nome</span><strong>${present(order.nome)}</strong></div>
    <div><span class="label">Vendedor</span><strong>${present(order.vendedor)}</strong></div>
    <div><span class="label">Data do pedido</span><strong>${present(order.data)}</strong></div>
    <div><span class="label">FAB</span><strong>${present(fabLabel(order.fab))}</strong></div>
    ${technique ? `<div><span class="label">Técnica da arte (referência)</span><strong>${present(technique)}</strong></div>` : ''}
  </section>
  <div class="section-label">Lastro do pedido</div><section class="lastro">${lastroEntries.map(([label, value]) => `<div><span class="label">${display(label)}</span><strong>${present(value)}</strong></div>`).join('')}</section>
  <div class="section-label">Itens: os sete pontos e os adicionais</div>
  <section class="items">${cardsOf(0)}</section>${footerOn(0)}${continuationPages}
  <section class="page-break">
    <header class="sheet-header"><div><div class="brand">Silmer</div><h1>CONTROLE DE PRODUÇÃO</h1></div><div class="header-id">${syntheticBand}<div class="order-id"><span>Pedido</span><strong>${display(order.numero)}</strong></div></div></header>
    <p class="production-intro">Preenchimento exclusivo da equipe de produção e arte. Os 14 campos abaixo devem chegar vazios a esta etapa.</p>
    <div class="production-grid">${productionSections.map((section, index) => `<section class="production-panel"><div><span class="panel-number">${index + 1}</span><h2>${display(section.title)}</h2></div><p class="panel-description">${display(section.description)}</p>${section.fields.map(([label, field]) => `<div class="production-field${field.includes('observacao') ? ' observation' : ''}"><strong>${display(label)}</strong><span class="campo-producao-vazio">${display(snapshot.producao[field])}</span></div>`).join('')}</section>`).join('')}</div>${reviewBox}
  </section>
</body>
</html>`;
}
