// FIP-04/05: preserve the store layout, add shipping notes and remove billing.
import { storeProductLabel } from '../domain/store-catalog.js';
import {
  factoryInstructions,
  assertFactoryText,
} from './factory-instructions.js';
import { display, filledText } from './html.js';

export const TEMPLATE_STORE_V2 = 'ficha-loja-v2';

const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';
const instantFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
});

/** An instant as São Paulo reads it: `07/10/2026 às 23:15`. @param {unknown} value */
export function instantLabel(value) {
  const instant = new Date(filledText(value));
  if (Number.isNaN(instant.getTime())) return '';
  const parts = Object.fromEntries(
    instantFormat.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} às ${parts.hour}:${parts.minute}`;
}

/** `5527900000001` → `+55 (27) 90000-0001`. @param {unknown} value */
export function phoneLabel(value) {
  const digits = filledText(value);
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/u.exec(digits);
  return match ? `+55 (${match[1]}) ${match[2]}-${match[3]}` : digits;
}

/** ADR 028: "Pronta entrega", "1 dia útil" or "10 dias úteis". @param {unknown} days */
export function leadTimeLabel(days) {
  if (!Number.isSafeInteger(days) || Number(days) < 0) return '';
  if (days === 0) return 'Pronta entrega';
  return days === 1 ? '1 dia útil' : `${days} dias úteis`;
}

/**
 * Label, value and an optional class for the `<div>`; empty values are left
 * out. The values are escaped here; `extra` is markup this file builds.
 *
 * @param {Array<[string, string, string?, string?]>} entries
 * @returns {string}
 */
function fields(entries) {
  return entries
    .filter(([, value]) => value !== '')
    .map(
      ([label, value, className = '', extra = '']) =>
        `<div${className ? ` class="${className}"` : ''}><dt>${display(label)}</dt><dd>${display(value)}${extra}</dd></div>`,
    )
    .join('');
}

/** `10` → `10 peças`. @param {unknown} pieces */
function piecesLabel(pieces) {
  if (!Number.isSafeInteger(pieces) || Number(pieces) <= 0) return '';
  return pieces === 1 ? '1 peça' : `${pieces} peças`;
}

/**
 * The store order in the public Order contract.
 *
 * @param {any} order
 * @returns {string}
 */
export function renderStoreFichaHtmlV2(order) {
  const ficha = order?.ficha ?? {};
  const loja = ficha.loja ?? {};
  const observations = factoryInstructions(ficha);
  const item = Array.isArray(ficha.items) ? (ficha.items[0] ?? {}) : {};
  const grade = Array.isArray(item.grade) ? item.grade : [];
  const sizes = grade
    .map((/** @type {any} */ line) => filledText(line?.tamanho))
    .filter(Boolean)
    .join(' / ');
  const confirmed = instantLabel(order?.confirmedAt);
  const number = filledText(order?.number);
  const storeNumber = filledText(order?.storeNumber);
  const testBand = order?.isTest
    ? '<p class="test">Pedido de teste — não produzir nem entregar</p>'
    : '';
  const footer = ['Ficha da loja', number, storeNumber]
    .filter(Boolean)
    .join(' · ');
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Pedido da loja ${display(number)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    :root { --surface: #fff; --raised: #f0eef8; --text: #160e36; --muted: #625b75; --border: #d8d4e4; --deep: #0c042d; --link: #5b3fd1; --warn-bg: #fff0e7; --warn: #8b3100; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: var(--surface); color: var(--text); font-family: Arial, Helvetica, 'Liberation Sans', Arimo, sans-serif; font-size: 13px; margin: 0; }
    h1, h2, p, dl, dd { margin: 0; }
    .sheet-header { align-items: flex-start; border-bottom: 2px solid var(--deep); display: flex; justify-content: space-between; padding-bottom: 10px; }
    .brand { color: var(--link); font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { color: var(--deep); font-size: 24px; letter-spacing: -.02em; margin-top: 2px; }
    .origin { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .order-id { background: var(--deep); border-radius: 6px; color: #fff; min-width: 120px; padding: 8px 12px; text-align: right; }
    .order-id span { display: block; font-size: 12px; letter-spacing: .08em; opacity: .75; text-transform: uppercase; }
    .order-id strong { font-size: 22px; }
    .test { background: var(--warn-bg); border: 1px solid #ffb88f; border-radius: 6px; color: var(--warn); font-weight: 800; margin-top: 12px; padding: 8px 10px; text-transform: uppercase; }
    section { border: 1px solid var(--border); border-radius: 8px; margin-top: 14px; padding: 12px 14px; }
    section.produce { border: 2px solid var(--deep); }
    h2 { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .1em; margin-bottom: 10px; text-transform: uppercase; }
    section.produce h2 { color: var(--deep); }
    dl { display: grid; gap: 12px 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    dt { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    dd { color: var(--deep); font-size: 16px; font-weight: 700; margin-top: 2px; overflow-wrap: anywhere; }
    .size dd { font-size: 32px; line-height: 1.1; }
    .note { color: var(--muted); display: block; font-size: 12px; font-weight: 400; margin-top: 2px; }
    .instructions p { margin-top: 8px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .sheet-footer { border-top: 1px solid var(--border); color: var(--muted); display: flex; font-size: 12px; justify-content: space-between; margin-top: 18px; padding-top: 8px; }
  </style>
</head>
<body>
  <header class="sheet-header"><div><div class="brand">Silmer</div><h1>PEDIDO DA LOJA</h1><p class="origin">${display(storeNumber ? `Origem: Loja do site · ${storeNumber}` : 'Origem: Loja do site')}</p></div><div class="order-id"><span>Pedido</span><strong>${display(number)}</strong></div></header>
  ${testBand}
  <section class="produce"><h2>Produzir</h2><dl>${fields([
    ['Produto', storeProductLabel(loja.produto)],
    ['Cor', filledText(item.cor)],
    ['Tamanho', sizes, 'size'],
    ['Quantidade', piecesLabel(order?.totalPieces)],
    ['Prazo da cor', leadTimeLabel(order?.leadTimeBusinessDays)],
    [
      'Pedido em',
      confirmed,
      '',
      '<span class="note">confirmado pela loja do site</span>',
    ],
  ])}</dl></section>
  <section><h2>Cliente</h2><dl>${fields([
    ['Nome', filledText(ficha.summary?.cliente)],
    ['WhatsApp', phoneLabel(loja.telefone)],
  ])}</dl></section>
  ${observations.length ? `<section class="instructions"><h2>Observações e envio</h2>${observations.map((note) => `<p>${display(note)}</p>`).join('')}</section>` : ''}
  <footer class="sheet-footer"><span>${display(footer)}</span><span>Ficha de produção</span></footer>
</body>
</html>`;
  assertFactoryText(
    html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]*>/gu, ' '),
  );
  return html;
}
