import { readFile } from 'node:fs/promises';
import { brand } from '../../../apps/edge-web/src/brand/index.js';

/** @param {unknown} value */
const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
/** @param {string} label @param {string} value */
const entry = (label, value) =>
  `<div class="entry"><dt>${escape(label)}</dt><dd>${escape(value || '—')}</dd></div>`;

export const serviceLabels = Object.freeze({
  notes: 'Anotações',
  customizations: 'Personalização',
  numbers: 'Numeração',
  sponsors: 'Patrocinadores',
  artwork_locations: 'Locais da estampa',
  delivery_mode: 'Entrega',
  delivery_address: 'Endereço',
  city_or_postal_code: 'Cidade / CEP',
  needed_by: 'Data desejada',
  purpose: 'Finalidade',
  purchase_profile: 'Perfil do pedido',
});

/** Explicit production projection. @param {typeof import('./sample.json')} source */
export function productionData(source) {
  if (source.syntheticOnly !== true)
    throw new Error('Only synthetic proposal data is accepted');
  const items = source.itemSeeds.map((item, index) => {
    const grade = item.sizes.map((size, sizeIndex) => ({
      size,
      quantity: sizeIndex + 1,
    }));
    return {
      type: item.type,
      audience: item.audience,
      model: item.model,
      color: item.color,
      front: item.front,
      back: item.back,
      rightSleeve: item.rightSleeve,
      leftSleeve: item.leftSleeve,
      collar: item.collar,
      collarTrim: item.collarTrim,
      sleeveTrim: item.sleeveTrim,
      technique: item.technique,
      fabrics: [...item.fabrics],
      printReference: item.printReference,
      informedQuantity: item.informedQuantity,
      grade,
      quantity: grade.reduce((sum, row) => sum + row.quantity, 0),
      index: index + 1,
    };
  });
  const data = {
    number: source.number,
    name: source.name,
    orderDate: source.orderDate,
    firstContact: source.firstContact,
    deliveredOn: source.deliveredOn,
    deliveryForecast: source.deliveryForecast,
    seller: source.seller,
    fab: source.fab,
    customer: {
      name: source.customer.name,
      phone: source.customer.phone,
      email: source.customer.email,
      address: source.customer.address,
      delivery: source.customer.delivery,
    },
    artwork: {
      origin: source.artwork.origin,
      finalFile: source.artwork.finalFile,
      references: [...source.artwork.references],
    },
    observations: [...source.observations],
    serviceData: Object.fromEntries(
      /** @type {(keyof typeof serviceLabels)[]} */ (Object.keys(serviceLabels))
        .filter((key) => typeof source.serviceData[key] === 'string')
        .map((key) => [key, source.serviceData[key]]),
    ),
    items,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
  };
  // Stop for review rather than silently deleting a production instruction.
  // This deterministic check supplements, and does not replace, note review.
  if (
    /(?:R\s*\$|US\s*\$|€|\b(?:reais|pre[çc]o|desconto|pagamento|cobran[çc]a|parcelas?|saldo|boleto|pix|infinitepay)\b|https?:\/\/[^\s"]*checkout)/iu.test(
      JSON.stringify(data),
    )
  ) {
    throw new Error(
      'FACTORY_NOTE_REQUIRES_REVIEW: financial reference in printable content',
    );
  }
  return data;
}

/** @param {string} label @param {string} key @param {string} [extra] */
function line(label, key, extra = '') {
  return `<div class="write-field ${extra}" data-production-field="${key}"><span>${escape(label)}</span><span class="write-line" aria-hidden="true"></span></div>`;
}

/** @param {number} index */
function production(index) {
  return `<section class="production" aria-labelledby="production-${index}">
    <h3 id="production-${index}">Controle de produção</h3>
    <div class="production-grid">
      <section class="production-group"><h4>Arremate</h4>
        <div class="write-pair">${line('Conferido por', 'conferido_arremate_por')}${line('Data', 'conferido_arremate_em')}</div>
        <div class="write-pair">${line('Arrematado por', 'arrematado_por')}${line('Data', 'arrematado_em')}</div>
        ${line('Observações do arremate', 'observacao_arremate', 'write-note')}
      </section>
      <section class="production-group"><h4>Conferência e embalagem</h4>
        ${line('Conferido / embalado por', 'conferido_embalado_por')}
        ${line('Data', 'conferido_embalado_em')}
      </section>
      <section class="production-group"><h4>Cores da arte</h4>
        <div class="color-fields">${line('Frente', 'cores_frente')}${line('Costas', 'cores_costas')}${line('Manga direita', 'cores_manga_direita')}${line('Manga esquerda', 'cores_manga_esquerda')}${line('Total nas partes', 'total_cores_partes')}${line('Cores distintas', 'quantidade_total_cores')}</div>
        ${line('Observações das cores', 'observacao_cores', 'write-note')}
      </section>
    </div>
  </section>`;
}

/** @param {ReturnType<typeof productionData>} data @param {ReturnType<typeof productionData>['items'][number]} item */
function sheet(data, item) {
  const count = data.items.length;
  const extras = [
    ['Modelo', item.model],
    ['Estampa de referência', item.printReference],
    ['Tecido · frente', item.front],
    ['Tecido · costas', item.back],
    ['Tecido · manga direita', item.rightSleeve],
    ['Tecido · manga esquerda', item.leftSleeve],
    ['Viés da gola', item.collarTrim],
    ['Viés das mangas', item.sleeveTrim],
  ];
  return `<article class="sheet" data-item="${item.index}" ${item.index === 1 ? '' : 'hidden'} aria-labelledby="item-${item.index}">
    <header class="sheet-header">
      <div class="sheet-title"><svg class="brand-mark" viewBox="${escape(brand.logo.viewBox)}" role="img" aria-label="${escape(brand.companyName)}"><path d="${escape(brand.logo.path)}"/></svg><h2>Ficha de produção</h2></div>
      <div class="sheet-id"><strong>Pedido ${escape(data.number)}</strong><span>Item ${item.index} de ${count} · Folha ${item.index}/${count}</span></div>
    </header>
    <section class="customer" aria-label="Cliente e pedido">
      <div class="customer-top"><strong>${escape(data.customer.name)}</strong><span>Previsão de entrega <b>${escape(data.deliveryForecast)}</b></span></div>
      <p class="contact-line">${escape(data.customer.phone)} <span>·</span> ${escape(data.customer.email)}</p>
      <p>${escape(data.customer.address)}</p>
      <p class="order-line"><span>Pedido: <b>${escape(data.name)}</b></span><span>Data: ${escape(data.orderDate)} · Primeiro contato: ${escape(data.firstContact)} · Entregue em: ${escape(data.deliveredOn)}</span></p>
      <p>Vendedor: ${escape(data.seller)} · FAB ${escape(data.fab)} · ${escape(data.customer.delivery)}</p>
    </section>
    <div class="item-heading"><div><h3 id="item-${item.index}">${escape(item.type)}</h3><p>${escape(item.audience)} · Item ${item.index} de ${count}</p></div><p class="item-quantity"><strong>${item.quantity}</strong><span>peças neste item</span></p></div>
    <div class="sheet-body"><div class="item-layout">
      <div class="specification">
        <dl class="specs">${entry('Cor', item.color)}${entry('Aplicação', item.technique)}${entry('Modelo de malha', item.fabrics.join(' / '))}${entry('Gola', item.collar)}</dl>
        <section class="grade" tabindex="0" aria-label="Tamanhos e quantidades"><h4>Tamanhos e quantidades</h4><table><thead><tr>${item.grade.map((row) => `<th scope="col">${escape(row.size)}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody><tr>${item.grade.map((row) => `<td>${row.quantity}</td>`).join('')}<td class="grade-total">${item.quantity}</td></tr></tbody></table>${item.informedQuantity !== item.quantity ? `<p class="quantity-reference">Quantidade informada pelo cliente: ${item.informedQuantity}. Grade confirmada: ${item.quantity} peças.</p>` : ''}</section>
        <section class="extras"><h4>Adicionais do item</h4><dl>${extras
          .filter(([, value]) => value)
          .map(([label, value]) => entry(label, value))
          .join('')}</dl></section>
        <section class="artwork"><h4>Arte do pedido</h4><p>${escape(data.artwork.origin)}</p><p><b>Arte final:</b> ${escape(data.artwork.finalFile)}</p><p><b>Referências:</b> ${data.artwork.references.map(escape).join(' · ')}</p></section>
      </div>
      <div class="instructions">
        <section class="order-notes"><h4>Observações do pedido</h4><ol>${data.observations.map((note) => `<li>${escape(note)}</li>`).join('')}</ol></section>
        <section class="service-notes"><h4>Dados do atendimento</h4><dl>${Object.entries(
          data.serviceData,
        )
          .map(([key, value]) =>
            entry(
              serviceLabels[/** @type {keyof typeof serviceLabels} */ (key)],
              value,
            ),
          )
          .join('')}</dl></section>
      </div>
    </div>
    ${production(item.index)}</div>
    <footer class="sheet-footer"><span>Amostra sintética · não produzir</span><span>${escape(data.number)} · Item ${item.index}/${count} · ${data.quantity} peças no pedido</span></footer>
  </article>`;
}

/** @param {ReturnType<typeof productionData>} data */
export async function renderProposal(data) {
  const fonts = await Promise.all(
    [400, 500, 600, 700].map(async (weight) => {
      const bytes = await readFile(
        new URL(
          `../../../node_modules/@fontsource/poppins/files/poppins-latin-${weight}-normal.woff2`,
          import.meta.url,
        ),
      );
      return `@font-face{font-family:Poppins;font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');}`;
    }),
  );
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Ficha por item · proposta ${escape(data.number)}</title><style>${fonts.join('\n')}\n${css}</style><style id="paper-format">@page{size:A4 portrait;margin:8mm;}</style></head><body>
  <header class="viewer"><div><h1>Ficha por item</h1><p>Um item, sua especificação e seu controle na mesma folha.</p></div><div class="viewer-controls"><label>Formato<select id="orientation"><option value="portrait">A4 retrato</option><option value="landscape">A4 paisagem</option></select></label><label>Prévia<select id="item-selector"><option value="all">Todos os ${data.items.length} itens</option>${data.items.map((item) => `<option value="${item.index}" ${item.index === 1 ? 'selected' : ''}>Item ${item.index} · ${escape(item.audience)}</option>`).join('')}</select></label><button id="print" type="button">Imprimir todas as fichas</button></div></header>
  <main id="sheets" class="sheets">${data.items.map((item) => sheet(data, item)).join('')}</main><p class="fit-message" role="status" aria-live="polite"></p>
  <script>
  const orientation=document.getElementById('orientation');
  const selector=document.getElementById('item-selector');
  orientation.addEventListener('change',()=>{document.body.classList.toggle('landscape',orientation.value==='landscape');document.getElementById('paper-format').textContent='@page{size:A4 '+orientation.value+';margin:8mm;}';});
  selector.addEventListener('change',()=>{document.querySelectorAll('.sheet').forEach(sheet=>{sheet.hidden=selector.value!=='all'&&sheet.dataset.item!==selector.value;});});
  document.getElementById('print').addEventListener('click',()=>window.print());
  </script></body></html>`;
}
