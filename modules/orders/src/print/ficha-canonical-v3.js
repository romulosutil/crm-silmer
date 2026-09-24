// `ficha-canonical-v3` (ADR 007): the v2 document with the item card driven by
// the order catalog — only the fields the product has, under its own labels,
// the location and other specifications on full-width lines, and the scale
// named above the grade. Page 2 is byte for byte the v2 production control.

const SYNTHETIC_BAND =
  '<span class="synthetic">Amostra sintetica - nao produzir</span>';

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** @param {unknown} value */
function display(value) {
  return escapeHtml(String(value));
}

/**
 * Renders the approved A4 landscape document in two pages: the commercial
 * sheet and the blank production control. The snapshot has the shape of
 * `docs/phase0/ficha-pdf-synthetic.json`; validating it belongs to whoever
 * builds it, so a real order renders without the synthetic review gate.
 *
 * @param {any} snapshot
 * @param {{synthetic?: boolean}} [options]
 * @returns {string}
 */
export function renderFichaHtmlV3(snapshot, options = {}) {
  const syntheticBand = options.synthetic ? SYNTHETIC_BAND : '';
  const itemCards = snapshot.pedido.itens
    .map((/** @type {any} */ item, /** @type {number} */ itemIndex) => {
      const lines = item.linhas
        .map(
          (/** @type {any} */ line) =>
            `<div class="spec-wide"><dt>${display(line.rotulo)}</dt><dd>${display(line.valor)}</dd></div>`,
        )
        .join('');
      return `<article class="item-card">
        <div class="item-heading">
          <div><span class="eyebrow">Item ${display(itemIndex + 1)}</span><h3>${display(item.tipo)} <span>${display(item.subtitulo)}</span></h3></div>
          <div class="item-total"><strong>${display(item.total)}</strong><span>pecas</span></div>
        </div>
        <div class="item-body">
          <dl class="spec-grid">${item.especificacoes
            .map(
              (/** @type {any} */ spec) =>
                `<div><dt>${display(spec.rotulo)}</dt><dd>${display(spec.valor)}</dd></div>`,
            )
            .join('')}${lines}</dl>
          <div class="grade-block"><span class="grade-title">${display(item.gradeTitulo)}</span><div class="grade-list">${item.grade
            .map(
              (/** @type {any} */ grade) =>
                `<div class="grade-cell"><span>${display(grade.tamanho)}</span><strong>${display(grade.quantidade)}</strong></div>`,
            )
            .join('')}</div></div>
        </div>
      </article>`;
    })
    .join('');
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

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Ficha de Pedido ${display(snapshot.pedido.numero)}</title>
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
      .summary { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; display: grid; grid-template-columns: 1.35fr 1fr .65fr 1fr; overflow: hidden; }
      .summary > div { border-right: 1px solid var(--subtle); min-height: 48px; padding: 8px 9px; }
      .summary > div:last-child { border-right: 0; }
      .label { color: var(--muted); display: block; font-size: 8px; font-weight: 700; letter-spacing: .07em; margin-bottom: 3px; text-transform: uppercase; }
      .summary strong { color: var(--deep); font-size: 12px; }
      .summary .quantity { color: var(--accent); font-size: 20px; line-height: .9; }
      .supporting { display: grid; gap: 6px; grid-template-columns: 1.5fr 1fr .8fr .5fr; margin: 7px 0 9px; }
      .supporting > div { background: var(--raised); border-radius: 5px; min-height: 36px; padding: 7px 8px; }
      .supporting strong { font-size: 9.5px; }
      .items { display: grid; gap: 8px; }
      .item-card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--link); border-radius: 7px; break-inside: avoid; overflow: hidden; }
      .item-heading { align-items: center; background: linear-gradient(90deg, var(--raised), var(--surface)); display: flex; justify-content: space-between; padding: 8px 9px; }
      .eyebrow { color: var(--link); font-size: 7.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      h3 { font-size: 13px; line-height: 1.1; }
      h3 span { color: var(--muted); font-size: 9px; font-weight: 600; margin-left: 5px; }
      .item-total { align-items: baseline; display: flex; gap: 3px; }
      .item-total strong { color: var(--accent); font-size: 19px; }
      .item-total span { color: var(--muted); font-size: 8px; }
      .item-body { display: grid; gap: 9px; grid-template-columns: 1fr 240px; padding: 9px; }
      .spec-grid { display: grid; gap: 7px; grid-template-columns: repeat(3, 1fr); }
      .spec-grid div { border-bottom: 1px solid var(--subtle); min-height: 38px; padding-bottom: 5px; }
      .spec-grid .spec-wide { grid-column: 1 / -1; min-height: 0; }
      dt { color: var(--muted); font-size: 7.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
      dd { font-size: 9px; font-weight: 700; margin-top: 3px; }
      .grade-block { border-left: 1px solid var(--subtle); padding-left: 9px; }
      .grade-title { color: var(--muted); display: block; font-size: 8px; font-weight: 800; letter-spacing: .08em; margin-bottom: 6px; text-transform: uppercase; }
      .grade-list { display: grid; gap: 4px; grid-template-columns: repeat(4, 1fr); }
      .grade-cell { background: var(--active); border-radius: 5px; padding: 8px 2px; text-align: center; }
      .grade-cell span { color: var(--muted); display: block; font-size: 7.5px; font-weight: 700; }
      .grade-cell strong { color: var(--deep); font-size: 15px; }
      .page-footer-content { align-items: stretch; display: grid; gap: 8px; grid-template-columns: 1fr 160px; margin-top: 8px; }
      .observations { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; min-height: 76px; padding: 8px 9px; }
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
      <div class="header-id">${syntheticBand}<div class="order-id"><span>Pedido</span><strong>${display(snapshot.pedido.numero)}</strong></div></div>
    </header>
    <div class="section-label">Resumo do pedido</div>
    <section class="summary">
      <div><span class="label">Cliente</span><strong>${display(snapshot.pedido.cliente)}</strong></div>
      <div><span class="label">Entrega confirmada</span><strong>${display(snapshot.pedido.data_entrega_confirmada)}</strong></div>
      <div><span class="label">Total de pecas</span><strong class="quantity">${display(snapshot.pedido.quantidade_total)}</strong></div>
      <div><span class="label">Aplicacao</span><strong>${display(snapshot.pedido.aplicacao)}</strong></div>
    </section>
    <section class="supporting">
      <div><span class="label">Evento / Nome</span><strong>${display(snapshot.pedido.nome)}</strong></div>
      <div><span class="label">Vendedor</span><strong>${display(snapshot.pedido.vendedor)}</strong></div>
      <div><span class="label">Data do pedido</span><strong>${display(snapshot.pedido.data)}</strong></div>
      <div><span class="label">FAB</span><strong>FAB ${display(snapshot.pedido.fab)}</strong></div>
    </section>
    <div class="section-label">Itens e especificacoes</div>
    <section class="items">${itemCards}</section>
    <section class="page-footer-content">
      <div class="observations"><span class="label">Observacoes do pedido</span><ol>${snapshot.pedido.observacoes.map((/** @type {string} */ note) => `<li>${display(note)}</li>`).join('')}</ol></div>
      <div class="grand-total"><span>Total<br>de pecas</span><strong>${display(snapshot.pedido.quantidade_total)}</strong></div>
    </section>

    <section class="page-break">
      <header class="sheet-header">
        <div><div class="brand">Silmer</div><h1>CONTROLE DE PRODUCAO</h1></div>
        <div class="header-id"><span class="synthetic">Campos vazios para preenchimento</span><div class="order-id"><span>Pedido</span><strong>${display(snapshot.pedido.numero)}</strong></div></div>
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
        .join('')}</div>
      <div class="review-box"><strong>Gate humano pendente</strong><span>Rose e Operacao devem revisar legibilidade, conteudo, ordem, grade, totais e impressao. Este arquivo nao registra aprovacao.</span></div>
    </section>
  </body>
</html>`;
}
