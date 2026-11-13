import { POPPINS_FONT_FACES } from './ficha-v8-fonts.js';
import { textWidth } from './ficha-v8-pages.js';
import { escapeHtml, filledText } from './html.js';

// RCP-03/04/05/10/11, ADR 089: an allowlisted commercial document. It never
// consumes observations, service data, artwork, customer registration or
// payment evidence, and it never changes the production ficha.

/** @typedef {{quantity:number|null, description:string, details:string[], sizes:string, unitCents:number|null, subtotalCents:number|null}} OrderReceiptItem */
/** @typedef {{schema:'order-receipt-v1', orderId:string, number:string, status:'pendente'|'confirmado'|'cancelado', version:number, customerName:string, orderName:string, orderDate:string|null, issuedAt:string, sellerName:string, deliveryOn:string|null, paymentCondition:string|null, isTest:boolean, items:OrderReceiptItem[], piecesCents:number|null, freightCents:number, totalCents:number|null}} OrderReceipt */

const LOGO_PATH =
  'M50.1984 135.093C76.3095 135.093 95.6166 118.36 95.6166 96.295C95.6166 71.4713 80.1709 62.6448 50.9343 58.0477C24.0878 54.0018 19.3069 47.3827 19.3069 34.5111C19.3069 22.1911 28.685 13.1813 46.7053 13.1813C64.9091 13.1813 74.471 19.9846 77.597 36.5341H91.9392C89.3649 13.1813 72.9998 0.310046 46.7053 0.310046C21.8816 0.310046 4.41252 15.7561 4.41252 35.9825C4.41252 59.3347 20.7785 67.9774 48.3603 72.206C73.3676 76.2515 80.1709 82.5039 80.1709 97.3982C80.1709 112.292 67.1153 122.222 50.1984 122.222C23.7199 122.222 17.4679 108.983 15.4455 93.3527H0C2.38977 115.786 15.0777 135.093 50.1984 135.093ZM394.439 133.438H409.701V80.6649C409.701 56.9445 422.021 50.8766 441.329 49.957V35.6147C424.044 36.1659 415.769 43.7054 409.701 54.5542V37.2688H394.439V133.438ZM344.739 135.093C366.437 135.093 382.434 123.843 385.744 105.672H370.482C364.096 129.515 326.291 127.862 317.16 105.029C315.292 100.356 314.247 94.7873 314.032 88.3877H386.48V83.4234C386.48 49.0379 365.517 35.6147 343.268 35.6147C316.79 35.6147 298.218 55.8411 298.218 84.8937V86.3653C298.218 115.969 317.525 135.093 344.739 135.093ZM314.583 76.0677C317.157 58.9673 327.638 48.3021 343.268 48.3021C359.082 48.3021 369.379 56.2083 370.85 76.0677H314.583ZM152.226 133.438H167.488V74.597C167.488 57.3119 180.36 48.8538 192.863 48.8538C206.102 48.8538 213.273 55.8411 213.273 72.7582V133.438H228.535V74.597C228.535 57.3119 241.407 48.8538 253.911 48.8538C267.15 48.8538 274.321 55.8411 274.321 72.7582V133.438H289.583V73.8616C289.583 45.9115 274.505 35.6147 257.221 35.6147C245.269 35.6147 230.926 41.131 224.306 53.6348C219.342 40.7635 208.493 35.6147 196.173 35.6147C182.382 35.6147 171.9 42.97 167.488 51.9798V37.2688H152.226V133.438ZM127.963 133.438H143.408V5.77717e-05H127.963V133.438ZM103.515 133.438H118.777V37.2695H103.515V133.438ZM110.871 20.5366C116.387 20.5366 120.984 15.9395 120.984 10.4232C120.984 4.90689 116.387 0.309753 110.871 0.309753C105.354 0.309753 100.757 4.90689 100.757 10.4232C100.757 15.9395 105.354 20.5366 110.871 20.5366Z';
const PAYMENT_LABELS = Object.freeze({
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
});
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** @param {unknown} value @returns {number|null} */
const cents = (value) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
/** @param {unknown} value @returns {number|null} */
const quantity = (value) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
/** @param {unknown} value @returns {string|null} */
const day = (value) =>
  typeof value === 'string' && DATE.test(value) ? value : null;
/** @param {number[]} values @returns {number|null} */
function sum(values) {
  const total = values.reduce((n, value) => n + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}
/** @param {any[]} grade */
function gradeQuantity(grade) {
  const values = grade.map((line) => quantity(line?.quantidade));
  return values.length && values.every((value) => value !== null)
    ? sum(/** @type {number[]} */ (values))
    : null;
}
/** @param {{size:string,quantity:number|null}[]} grade */
function sizes(grade) {
  return grade
    .map((line) =>
      [
        line.size || 'Tamanho não informado',
        line.quantity === null ? '' : String(line.quantity),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' · ');
}
/** @param {any} item @param {string} fallback */
function itemDescription(item, fallback) {
  return {
    description: filledText(item.tipo) || fallback || 'Descrição não informada',
    details: [
      filledText(item.modelo),
      filledText(item.cor),
      (Array.isArray(item.malhas)
        ? item.malhas.map(filledText).filter(Boolean)
        : []
      ).join(', '),
      filledText(item.tipo_servico),
    ].filter(Boolean),
  };
}

/**
 * The input is the authorized public order. The caller supplies any approved
 * legacy composition as ficha.sizePricing; no hidden source is discovered here.
 * Missing prices never become zero, a guessed average or a partial total.
 * @param {any} order
 * @param {{issuedAt:Date}} options
 * @returns {OrderReceipt}
 */
export function projectOrderReceipt(order, { issuedAt }) {
  const ficha = order.ficha ?? {};
  const inputItems = Array.isArray(ficha.items) ? ficha.items : [];
  const hasPricing = Array.isArray(ficha.sizePricing);
  const groups = hasPricing ? ficha.sizePricing : [];
  let complete =
    hasPricing &&
    groups.length === inputItems.length &&
    inputItems.length > 0 &&
    order.pricing?.complete !== false;
  /** @type {OrderReceiptItem[]} */
  const items = [];
  inputItems.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const base = itemDescription(
      item,
      order.origin === 'loja' ? filledText(ficha.loja?.produto?.nome) : '',
    );
    const grade = Array.isArray(item.grade) ? item.grade : [];
    const lines = groups[index]?.lines;
    const aligned =
      hasPricing &&
      Array.isArray(lines) &&
      grade.length > 0 &&
      lines.length === grade.length &&
      lines.every(
        (/** @type {any} */ line, /** @type {number} */ i) =>
          quantity(line.quantity) !== null &&
          line.size === grade[i].tamanho &&
          line.quantity === grade[i].quantidade,
      );
    if (!aligned) {
      if (hasPricing) complete = false;
      items.push({
        ...base,
        quantity: gradeQuantity(grade),
        sizes: sizes(
          grade.map((/** @type {any} */ line) => ({
            size: filledText(line.tamanho),
            quantity: quantity(line.quantidade),
          })),
        ),
        unitCents: null,
        subtotalCents: null,
      });
      return;
    }
    /** @type {Map<number,OrderReceiptItem>} */
    const exactGroups = new Map();
    for (const line of lines) {
      const subtotal =
        line.subtotalReviewed === true ? cents(line.subtotalCents) : null;
      if (subtotal === null) complete = false;
      const unit =
        subtotal !== null && subtotal % line.quantity === 0
          ? subtotal / line.quantity
          : null;
      const size = sizes([
        { size: filledText(line.size), quantity: line.quantity },
      ]);
      const existing = unit === null ? null : exactGroups.get(unit);
      if (existing) {
        existing.quantity = sum([
          /** @type {number} */ (existing.quantity),
          line.quantity,
        ]);
        existing.subtotalCents = sum([
          /** @type {number} */ (existing.subtotalCents),
          /** @type {number} */ (subtotal),
        ]);
        existing.sizes += ` · ${size}`;
      } else {
        const row = {
          ...base,
          details: [...base.details],
          quantity: line.quantity,
          sizes: size,
          unitCents: unit,
          subtotalCents: subtotal,
        };
        items.push(row);
        if (unit !== null) exactGroups.set(unit, row);
      }
    }
  });
  const total =
    hasPricing && !complete
      ? null
      : cents(order.amounts?.totalCents ?? order.finalAmountCents);
  const created = new Date(filledText(order.createdAt));
  const orderDate =
    day(order.orderDate) ??
    (Number.isNaN(created.getTime()) ? null : dayFormat.format(created));
  return {
    schema: 'order-receipt-v1',
    orderId: filledText(order.id),
    number: filledText(order.number),
    status: order.cancelledAt
      ? 'cancelado'
      : order.status === 'confirmado'
        ? 'confirmado'
        : 'pendente',
    version: Number.isSafeInteger(order.version) ? order.version : 0,
    customerName: filledText(ficha.summary?.cliente),
    orderName: filledText(ficha.summary?.nome),
    orderDate,
    issuedAt: issuedAt.toISOString(),
    sellerName: filledText(order.seller?.name),
    deliveryOn: day(ficha.summary?.data_entrega_confirmada),
    paymentCondition:
      PAYMENT_LABELS[
        /** @type {keyof typeof PAYMENT_LABELS} */ (order.paymentCondition)
      ] ?? null,
    isTest: order.isTest === true,
    items,
    piecesCents:
      hasPricing && !complete
        ? null
        : cents(order.amounts?.piecesCents ?? total),
    freightCents: cents(order.amounts?.freightCents) ?? 0,
    totalCents: total,
  };
}

/** @param {number|null} value */
function money(value) {
  if (value === null) return 'A definir';
  const n = BigInt(value);
  return `R$ ${(n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.')},${String(n % 100n).padStart(2, '0')}`;
}
/** @param {string|null} value */
const dateLabel = (value) =>
  value ? value.split('-').reverse().join('/') : 'Não informado';
/** @param {string} text @param {number} width @param {number} [font] @returns {string[]} */
function wrap(text, width, font = 13) {
  const words = text.replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean);
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const word of words) {
    if (textWidth(`${current}${current ? ' ' : ''}${word}`, font) <= width) {
      current += `${current ? ' ' : ''}${word}`;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    for (const char of word) {
      if (current && textWidth(current + char, font) > width) {
        lines.push(current);
        current = '';
      }
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** @typedef {{text:string,kind:'description'|'detail'|'sizes'}} ReceiptLine */
/** @typedef {{itemIndex:number,continued:boolean,lines:ReceiptLine[],quantity:string[],unit:string[],subtotal:string[],height:number}} ReceiptRow */
/** @typedef {{rows:ReceiptRow[],summary:boolean,first:boolean,usedHeight:number,availableHeight:number}} ReceiptPage */
const BODY_HEIGHT = 736;
const INNER_WIDTH = 503;
const CELL_WIDTHS = Object.freeze({
  quantity: 40,
  description: 237,
  unit: 88,
  subtotal: 96,
});
const LINE_HEIGHT = 18;

/** @param {OrderReceipt} receipt */
function statusText(receipt) {
  if (receipt.status === 'pendente')
    return 'Pedido pendente - resumo provisório, sujeito a alterações.';
  if (receipt.status === 'cancelado')
    return 'Pedido cancelado - documento histórico.';
  return 'Pedido confirmado';
}
/** @param {OrderReceipt} receipt */
function headHeight(receipt) {
  const numberLines = Math.max(
    1,
    wrap(receipt.number || 'Não informado', 250, 22).length,
  );
  const statusLines = wrap(statusText(receipt), INNER_WIDTH).length;
  return (
    Math.max(64, 22 + numberLines * 28 + 4 + 18) +
    26 +
    statusLines * 18 +
    (receipt.isTest ? 26 : 0)
  );
}
/** @param {OrderReceipt} receipt */
function clientHeight(receipt) {
  return (
    18 +
    Math.max(
      1,
      wrap(receipt.customerName || 'Não informado', INNER_WIDTH, 16).length,
    ) *
      24 +
    (receipt.orderName
      ? 4 + wrap(receipt.orderName, INNER_WIDTH).length * 18
      : 0) +
    28
  );
}
/** @param {OrderReceipt} receipt */
function summaryHeight(receipt) {
  return (
    (receipt.freightCents > 0 ? 52 : 0) +
    238 +
    Math.max(0, wrap(receipt.sellerName || 'Não informado', 235).length - 1) *
      18
  );
}

/**
 * Explicit A5 pages, using the same measured Poppins advances as the factory
 * sheets. Long item descriptions/details continue in another row/page; no
 * character is discarded and quantity/prices print only on the first part.
 * The plan is exported so tests and render QA can check all content/budgets.
 * @param {OrderReceipt} receipt
 * @returns {ReceiptPage[]}
 */
export function planOrderReceiptPages(receipt) {
  /** @type {ReceiptPage[]} */
  const pages = [];
  const header = headHeight(receipt);
  /** @param {boolean} first */
  const newPage = (first) => {
    /** @type {ReceiptPage} */
    const page = {
      first,
      rows: [],
      summary: false,
      usedHeight: header + (first ? clientHeight(receipt) : 0) + 34 + 24,
      availableHeight: BODY_HEIGHT,
    };
    pages.push(page);
    return page;
  };
  let page = newPage(true);
  receipt.items.forEach((item, itemIndex) => {
    /** @type {ReceiptLine[]} */
    const lines = [
      ...wrap(item.description, CELL_WIDTHS.description).map((text) => ({
        text,
        kind: /** @type {const} */ ('description'),
      })),
      ...wrap(item.details.join(' · '), CELL_WIDTHS.description).map(
        (text) => ({
          text,
          kind: /** @type {const} */ ('detail'),
        }),
      ),
      ...wrap(item.sizes, CELL_WIDTHS.description).map((text) => ({
        text,
        kind: /** @type {const} */ ('sizes'),
      })),
    ];
    const q = wrap(
      item.quantity === null ? 'Não informado' : String(item.quantity),
      CELL_WIDTHS.quantity,
    );
    const unit = wrap(money(item.unitCents), CELL_WIDTHS.unit);
    const subtotal = wrap(money(item.subtotalCents), CELL_WIDTHS.subtotal);
    let from = 0;
    do {
      const continued = from > 0;
      const minimumLines = continued
        ? 1
        : Math.max(q.length, unit.length, subtotal.length, 1);
      const remaining = BODY_HEIGHT - page.usedHeight;
      const maxLines = Math.floor(
        (remaining - 17 - (continued ? 18 : 0)) / LINE_HEIGHT,
      );
      if (maxLines < minimumLines) {
        page = newPage(false);
        continue;
      }
      const taken = lines.slice(from, from + maxLines);
      const height =
        17 +
        (continued ? 18 : 0) +
        Math.max(taken.length, minimumLines) * LINE_HEIGHT;
      page.rows.push({
        itemIndex,
        continued,
        lines: taken,
        quantity: continued ? [] : q,
        unit: continued ? [] : unit,
        subtotal: continued ? [] : subtotal,
        height,
      });
      page.usedHeight += height;
      from += taken.length;
    } while (from < lines.length);
  });
  const tail = summaryHeight(receipt);
  if (page.usedHeight + tail > BODY_HEIGHT) page = newPage(false);
  page.summary = true;
  page.usedHeight += tail;
  return pages;
}

/** @param {string[]} values @param {string} [className] */
function printedLines(values, className = '') {
  return values
    .map(
      (value) =>
        `<span class="line${className ? ` ${className}` : ''}">${escapeHtml(value)}</span>`,
    )
    .join('');
}
/** @param {ReceiptRow} row */
function printedRow(row) {
  return `<tr data-item="${row.itemIndex}"${row.continued ? ' data-continuation="true"' : ''}><td>${printedLines(row.quantity)}</td><td>${row.continued ? '<span class="line muted">Continuação do item</span>' : ''}${row.lines.map((line) => printedLines([line.text], line.kind === 'description' ? '' : 'muted')).join('')}</td><td class="num">${printedLines(row.unit)}</td><td class="num">${printedLines(row.subtotal)}</td></tr>`;
}
/** @param {OrderReceipt} receipt */
function printedSummary(receipt) {
  const emitted = new Date(receipt.issuedAt);
  const issued = Number.isNaN(emitted.getTime())
    ? 'Não informado'
    : dateLabel(dayFormat.format(emitted));
  return `<section class="summary" aria-label="Totais e condições">${receipt.freightCents > 0 ? `<dl class="freight"><div><dt>Subtotal das peças</dt><dd>${escapeHtml(money(receipt.piecesCents))}</dd></div><div><dt>Frete</dt><dd>${escapeHtml(money(receipt.freightCents))}</dd></div></dl>` : ''}<div class="total"><span>Total do pedido</span><strong>${escapeHtml(money(receipt.totalCents))}</strong></div><dl class="facts"><div><dt>Previsão de entrega</dt><dd>${escapeHtml(dateLabel(receipt.deliveryOn))}</dd></div><div><dt>Condição de pagamento</dt><dd>${escapeHtml(receipt.paymentCondition || 'A definir')}</dd></div><div class="seller"><dt>Vendedor</dt><dd>${printedLines(wrap(receipt.sellerName || 'Não informado', 235))}</dd></div></dl><div class="disclaimer"><p>Sem valor fiscal. Este resumo não comprova pagamento.</p><p>Emitido em ${escapeHtml(issued)} · Versão ${receipt.version} do pedido</p></div></section>`;
}

const STYLE = `${POPPINS_FONT_FACES}
@page { size: A5 portrait; margin: 0; }
* { box-sizing: border-box; }
html { color-scheme: light; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
body { margin: 0; font: 400 13px/18px Poppins, sans-serif; color: #201634; background: #fff; font-variant-numeric: tabular-nums; }
h1,h2,p,dl,dd { margin: 0; }
.receipt-sheet { width: 148mm; height: 210mm; padding: 28px; display: flex; flex-direction: column; break-after: page; background: #fff; color: #201634; }
.receipt-sheet:last-child { break-after: auto; }
.head-top { display: flex; align-items: start; justify-content: space-between; gap: 20px; }
.logo { width: 96px; height: 30px; color: #0c042d; fill: currentColor; }
.brand-caption { max-width: 150px; margin-top: 6px; font-size: 11px; line-height: 14px; color: #625a6e; }
.identity { text-align: right; max-width: 270px; }
h1 { font-weight: 600; font-size: 16px; line-height: 22px; }
.number { font-weight: 600; font-size: 22px; line-height: 28px; margin: 2px 0; }
.number .line { line-height: 28px; }
.status { margin-top: 12px; padding-bottom: 12px; border-bottom: 1px solid #dcd6e4; }
.status[data-status="pendente"],.status[data-status="cancelado"] { font-weight: 500; }
.test { margin-top: 8px; font-weight: 600; }
.client { margin: 12px 0 16px; }
.client dt,.facts dt { color: #625a6e; }
.client-name { font-size: 16px; line-height: 24px; font-weight: 500; }
.client-name .line { line-height: 24px; }
.client dd + dd { margin-top: 4px; }
.muted { color: #625a6e; }
.line { display: block; line-height: 18px; white-space: pre; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; color: #201634; background: #fff; }
col.quantity { width: 52px; } col.description { width: 249px; } col.unit { width: 100px; } col.subtotal { width: 102px; }
th { text-align: left; font-weight: 500; color: #625a6e; border-block: 1px solid #dcd6e4; padding: 7px 6px; line-height: 18px; }
td { color: #201634; background: #fff; padding: 8px 6px; border-bottom: 1px solid #dcd6e4; vertical-align: top; }
th:last-child,td:last-child { padding-right: 0; }
.num { text-align: right; }
tr { break-inside: avoid; }
.summary { margin-top: 16px; }
.freight { margin: 0 0 8px; }
.freight div { display: flex; justify-content: space-between; gap: 16px; min-height: 22px; }
.total { display: flex; align-items: baseline; justify-content: flex-end; gap: 20px; margin-bottom: 16px; min-height: 32px; }
.total strong { font-size: 22px; line-height: 32px; font-weight: 600; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-block: 12px; border-block: 1px solid #dcd6e4; }
.facts dd { margin-top: 4px; }
.disclaimer { margin-top: 16px; font-size: 11px; line-height: 16px; color: #625a6e; }
.disclaimer p + p { margin-top: 4px; }
.page-number { margin-top: auto; padding-top: 8px; line-height: 16px; font-size: 11px; color: #625a6e; text-align: right; }
`;

/** @param {OrderReceipt} receipt @returns {string} */
export function renderOrderReceiptHtml(receipt) {
  const pages = planOrderReceiptPages(receipt);
  const html = pages
    .map(
      (page, index) =>
        `<article class="receipt-sheet" aria-label="Página ${index + 1} de ${pages.length}"><header><div class="head-top"><div><svg class="logo" viewBox="0 0 442 136" role="img" aria-label="Silmer"><path d="${LOGO_PATH}"/></svg><p class="brand-caption">Camisetas, abadás e uniformes esportivos</p></div><div class="identity"><h1>Recibo do pedido</h1><div class="number">${printedLines(wrap(receipt.number || 'Não informado', 250, 22))}</div><p>Pedido de ${escapeHtml(dateLabel(receipt.orderDate))}</p></div></div><p class="status" data-status="${receipt.status}">${printedLines(wrap(statusText(receipt), INNER_WIDTH))}</p>${receipt.isTest ? '<p class="test">Pedido de teste - não produzir nem entregar</p>' : ''}</header>${page.first ? `<dl class="client"><dt>Cliente</dt><dd class="client-name">${printedLines(wrap(receipt.customerName || 'Não informado', INNER_WIDTH, 16))}</dd>${receipt.orderName ? `<dd>${printedLines(wrap(receipt.orderName, INNER_WIDTH), 'muted')}</dd>` : ''}</dl>` : ''}<table aria-label="Itens e valores"><colgroup><col class="quantity"><col class="description"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th scope="col">Qtd.</th><th scope="col">Descrição</th><th scope="col" class="num">Unitário</th><th scope="col" class="num">Subtotal</th></tr></thead><tbody>${page.rows.map(printedRow).join('')}</tbody></table>${page.summary ? printedSummary(receipt) : ''}<footer class="page-number">Página ${index + 1} de ${pages.length}</footer></article>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo do pedido ${escapeHtml(receipt.number)}</title><style>${STYLE}</style></head><body>${html}</body></html>`;
}
