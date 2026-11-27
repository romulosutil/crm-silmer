import { display } from './html.js';
import { LOGO_PATH } from './order-receipt.js';
import { POPPINS_FONT_FACES } from './ficha-v8-fonts.js';

const quantity = new Intl.NumberFormat('pt-BR');
const date = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
});
const audiences = {
  unissex: 'Unissex',
  masculino: 'Masculino',
  feminino: 'Feminino',
  infantil: 'Infantil',
};
const styles = `
  @page { size: A4 portrait; margin: 12mm 12mm 16mm;
    @bottom-left { content: 'Mapa de corte'; color: #605a72; font: 10pt Poppins, sans-serif; }
    @bottom-right { content: 'Folha ' counter(page) ' de ' counter(pages); color: #605a72; font: 10pt Poppins, sans-serif; }
  }
  :root { --ink: #0c042d; --brand: #ff5b01; --muted: #605a72; --border: #dcdbe4; --raised: #f5f4f8; }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 10.5pt/1.45 Poppins, sans-serif; font-variant-numeric: tabular-nums; print-color-adjust: exact; }
  h1, h2, p, dl, dd { margin: 0; overflow-wrap: anywhere; }
  .band, .meta, .lot-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; }
  .band { padding: 10px 15px; background: var(--brand); border-radius: 9px; }
  .band h1 { font-size: 21pt; line-height: 1.2; font-weight: 600; }
  .band strong, h2 { font-size: 13pt; font-weight: 600; }
  .meta { align-items: center; padding: 11px 0; border-bottom: 1px solid var(--border); }
  .meta svg { width: 81px; height: auto; fill: var(--brand); }
  .meta p, .sources, .spec, .details { color: var(--muted); }
  .orders { margin: 10px 0 12px; }
  .lot { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; break-inside: avoid; }
  .lot-head, .details { break-after: avoid; }
  .spec { font-weight: 500; }
  .spec strong { color: var(--ink); font-weight: 600; }
  .sources { margin-top: 5px; }
  .grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); margin-top: 7px; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; text-align: center; }
  .grade > div { background: white; break-inside: avoid; }
  .grade dt { padding: 3px; background: var(--raised); }
  .grade dd { padding: 3px; font-size: 13pt; font-weight: 600; }
  .grade .total, .total dt { background: #eeedf6; }
`;

/** @param {import('../domain/cut-map.js').CutLot} lot */
function renderLot(lot) {
  const details = lot.details
    .map(({ label, value }) => `${display(label)}: ${display(value)}`)
    .join(' · ');
  return `<section class="lot">
    <div class="lot-head"><h2>${display(lot.model)} · ${display(lot.color)}</h2><p class="spec"><strong>${display(audiences[lot.audience])}</strong> · ${lot.fabrics.map(display).join(', ')}</p></div>
    ${details ? `<p class="details">${details}</p>` : ''}
    <dl class="grade" aria-label="Peças por tamanho">${lot.grade.map(({ size, quantity: count }) => `<div><dt>${display(size)}</dt><dd>${quantity.format(count)}</dd></div>`).join('')}<div class="total"><dt>Total</dt><dd>${quantity.format(lot.total)}</dd></div></dl>
    <p class="sources">${lot.orders.length === 1 ? 'Pedido' : 'Pedidos'} ${lot.orders.map(display).join(', ')}</p>
  </section>`;
}

/** @param {import('../domain/cut-map.js').CutMap} map @param {Date} [issuedAt] */
export function renderCutMapHtml(map, issuedAt = new Date()) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mapa de corte</title>
    <style>${POPPINS_FONT_FACES}\n${styles}</style></head><body><main>
    <header><div class="band"><h1>Mapa de corte</h1><strong>${quantity.format(map.total)} ${map.total === 1 ? 'peça a cortar' : 'peças a cortar'}</strong></div>
    <div class="meta"><svg viewBox="0 0 442 136" role="img" aria-label="Silmer"><path d="${LOGO_PATH}"/></svg><p>Emissão <strong>${date.format(issuedAt)}</strong></p></div>
    <div class="orders"><strong>${map.orders.length === 1 ? 'Pedido no mapa' : 'Pedidos no mapa'}</strong><p class="sources">${map.orders.map(({ number }) => display(number)).join(', ')}</p></div></header>
    ${map.groups.map(renderLot).join('')}</main></body></html>`;
}
