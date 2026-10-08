// ADR 027: the simplified ficha of a site shop order — the receipt Rose
// hands over at pickup. Only the standard fields: number, date, customer,
// product, the kit's one colour and size, amount, the Pix the customer
// declared, the pickup address and the origin. No art, technique,
// observations or production control, and no empty field. It is not the
// canonical ficha: `PRINT_TEMPLATE` never selects it and it carries no
// review hash; the print route picks it by the order's origin.
import { display, filledText } from './html.js';

export const TEMPLATE_STORE_V1 = 'ficha-loja-v1';

const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';
const AUDIENCE_LABELS = Object.freeze({
  feminino: 'Feminino',
  infantil: 'Infantil',
  masculino: 'Masculino',
  unissex: 'Unissex',
});
const declaredFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
});

/** `2026-10-07` → `07/10/2026`. @param {unknown} value */
function day(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(filledText(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** An instant as São Paulo reads it: `07/10/2026 às 23:15`. @param {unknown} value */
export function declaredAtLabel(value) {
  const instant = new Date(filledText(value));
  if (Number.isNaN(instant.getTime())) return '';
  const parts = Object.fromEntries(
    declaredFormat
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} às ${parts.hour}:${parts.minute}`;
}

/** `5527900000001` → `+55 (27) 90000-0001`. @param {unknown} value */
export function phoneLabel(value) {
  const digits = filledText(value);
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/u.exec(digits);
  return match ? `+55 (${match[1]}) ${match[2]}-${match[3]}` : digits;
}

/** @param {unknown} cents */
function money(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const value = Number(cents);
  const reais = Math.trunc(value / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `R$ ${reais},${String(value % 100).padStart(2, '0')}`;
}

/**
 * @param {Array<[string, string]>} entries
 * @returns {string}
 */
function fields(entries) {
  return entries
    .filter(([, value]) => value !== '')
    .map(
      ([label, value]) =>
        `<div><dt>${display(label)}</dt><dd>${display(value)}</dd></div>`,
    )
    .join('');
}

/**
 * The store order in the public Order contract.
 *
 * @param {any} order
 * @returns {string}
 */
export function renderStoreFichaHtml(order) {
  const ficha = order?.ficha ?? {};
  const loja = ficha.loja ?? {};
  const item = Array.isArray(ficha.items) ? (ficha.items[0] ?? {}) : {};
  const grade = Array.isArray(item.grade) ? item.grade : [];
  const sizes = grade
    .map((/** @type {any} */ line) => filledText(line?.tamanho))
    .join(' / ');
  const declared = declaredAtLabel(order?.paymentDeclaredAt);
  const testBand = order?.isTest
    ? '<p class="test">Pedido de teste — não entregar</p>'
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Pedido da loja ${display(order?.number ?? '')}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    :root { --surface: #fff; --raised: #f0eef8; --text: #160e36; --muted: #625b75; --border: #d8d4e4; --deep: #0c042d; --link: #5b3fd1; --warn-bg: #fff0e7; --warn: #8b3100; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: var(--surface); color: var(--text); font-family: Arial, Helvetica, 'Liberation Sans', Arimo, sans-serif; font-size: 12px; margin: 0; }
    h1, h2, p, dl, dd { margin: 0; }
    .sheet-header { align-items: flex-start; border-bottom: 2px solid var(--deep); display: flex; justify-content: space-between; padding-bottom: 10px; }
    .brand { color: var(--link); font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { color: var(--deep); font-size: 24px; letter-spacing: -.02em; margin-top: 2px; }
    .origin { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .order-id { background: var(--deep); border-radius: 6px; color: #fff; min-width: 120px; padding: 8px 12px; text-align: right; }
    .order-id span { display: block; font-size: 9px; letter-spacing: .08em; opacity: .75; text-transform: uppercase; }
    .order-id strong { font-size: 20px; }
    .test { background: var(--warn-bg); border: 1px solid #ffb88f; border-radius: 6px; color: var(--warn); font-weight: 800; margin-top: 12px; padding: 8px 10px; text-transform: uppercase; }
    section { border: 1px solid var(--border); border-radius: 8px; margin-top: 14px; padding: 12px 14px; }
    h2 { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .1em; margin-bottom: 8px; text-transform: uppercase; }
    dl { display: grid; gap: 10px 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    dl.wide { grid-template-columns: minmax(0, 1fr); }
    dt { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    dd { color: var(--deep); font-size: 15px; font-weight: 700; margin-top: 2px; overflow-wrap: anywhere; }
    .paid { background: var(--raised); border-radius: 6px; padding: 8px 10px; }
  </style>
</head>
<body>
  <header class="sheet-header"><div><div class="brand">Silmer</div><h1>PEDIDO DA LOJA</h1><p class="origin">Origem: Loja do site</p></div><div class="order-id"><span>Pedido</span><strong>${display(order?.number ?? '')}</strong></div></header>
  ${testBand}
  <section><h2>Pedido</h2><dl>${fields([
    ['Número', filledText(order?.number)],
    ['Data do pedido', day(order?.orderDate)],
  ])}</dl></section>
  <section><h2>Cliente</h2><dl>${fields([
    ['Nome', filledText(ficha.summary?.cliente)],
    ['Telefone', phoneLabel(loja.telefone)],
  ])}</dl></section>
  <section><h2>Produto</h2><dl>${fields([
    ['Produto', filledText(loja.produto?.nome)],
    ['Tipo', filledText(item.tipo)],
    [
      'Público',
      AUDIENCE_LABELS[
        /** @type {keyof typeof AUDIENCE_LABELS} */ (item.publico)
      ] ?? '',
    ],
    ['Cor', filledText(item.cor)],
    [
      'Malha',
      Array.isArray(item.malhas) ? item.malhas.map(filledText).join(' / ') : '',
    ],
    ['Gola', filledText(item.gola)],
    ['Tamanho', sizes],
    ['Quantidade', String(order?.totalPieces ?? '')],
  ])}</dl></section>
  <section><h2>Pagamento</h2><dl>${fields([
    ['Valor', money(order?.finalAmountCents)],
    ['Forma', order?.paymentCondition === 'pix' ? 'Pix' : ''],
  ])}</dl><p class="paid">${display(
    declared
      ? `Pago — informado pelo cliente em ${declared}`
      : 'Pago — informado pelo cliente',
  )}</p></section>
  <section><h2>Retirada</h2><dl class="wide">${fields([
    ['Retirada na loja', filledText(loja.retirada)],
  ])}</dl></section>
</body>
</html>`;
}
