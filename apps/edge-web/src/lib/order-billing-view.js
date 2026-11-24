/*
 * RFC 074 (LPC-09): "Cobranças e recebimentos" in three layers — Situação,
 * Próximo passo and Movimentações — derived from the seller's billing view
 * (docs/api/order-billing-links.md). Pure: no Vue, no DOM, no network. The
 * order page, its rail and the Inbox read the same numbers, the same badge and
 * the same next step from here, so a state never has two names.
 *
 * Money is integer cents; instants are ISO strings read in the store's clock.
 */
import {
  billingLinkUrl,
  billingMoney,
  billingReason,
  billingUrl,
} from './order-billing.js';
import {
  dateBR,
  dateTimeCommaBR,
  dayMonthBR,
  dayMonthTimeBR,
  timeBR,
} from './format.js';

export const money = billingMoney;
const fT = timeBR;
const fDM = dayMonthBR;
const fDMT = dayMonthTimeBR;
const fDT = dateTimeCommaBR;

/** The minimum of a link (InfinitePay): R$ 1,00. */
export const LINK_MIN_CENTS = 100;

/** The name of a line comes from its value when it is created. */
export const KIND = Object.freeze({
  signal: {
    title: 'Sinal · 50%',
    noun: 'sinal',
    of: 'do sinal',
    cap: 'Sinal',
    art: 'o',
    rec: 'recebido',
  },
  balance: {
    title: 'Saldo',
    noun: 'saldo',
    of: 'do saldo',
    cap: 'Saldo',
    art: 'o',
    rec: 'recebido',
  },
  full: {
    title: 'Pagamento integral',
    noun: 'pagamento integral',
    of: 'do pagamento integral',
    cap: 'Pagamento integral',
    art: 'o',
    rec: 'recebido',
  },
  part: {
    title: 'Parcela',
    noun: 'parcela',
    of: 'da parcela',
    cap: 'Parcela',
    art: 'a',
    rec: 'recebida',
  },
});

/** @typedef {keyof typeof KIND} Kind */

/** API kind → line name. @param {unknown} kind @returns {Kind} */
export function kindOf(kind) {
  if (kind === 'signal' || kind === 'balance' || kind === 'full') return kind;
  return 'part';
}
/** @param {Kind} kind @returns {string} the API's own kind */
export function apiKind(kind) {
  return kind === 'part' ? 'installment' : kind;
}

/** Outside receipts: the API method and its words. */
export const METHODS = Object.freeze({
  cash: { label: 'Dinheiro', short: 'Dinheiro' },
  pix_external: { label: 'Pix fora da InfinitePay', short: 'Pix' },
  bank_transfer: { label: 'Transferência bancária', short: 'Transferência' },
  card_external: { label: 'Cartão em outra maquininha', short: 'Cartão' },
});
/** @param {unknown} method */
function methodOf(method) {
  return (
    METHODS[/** @type {keyof typeof METHODS} */ (String(method))] ?? {
      label: 'Outro meio',
      short: 'Outro meio',
    }
  );
}

export const TERMS = Object.freeze({
  0: {
    title: '0% · Sem entrada',
    text: 'Sem entrada',
    after: 'valor integral depois',
  },
  50: {
    title: '50% · Entrada',
    text: 'Entrada de 50%',
    after: 'saldo depois',
  },
  100: {
    title: '100% · Pagamento integral',
    text: 'Pagamento integral',
    after: 'à vista',
  },
});
/** @param {unknown} value @returns {0|50|100|null} */
export function conditionOf(value) {
  const n = Number(value);
  return value !== null && value !== undefined && [0, 50, 100].includes(n)
    ? /** @type {0|50|100} */ (n)
    : null;
}

/** Badges: words first, tone and icon second (never colour alone). */
export const TONE = Object.freeze({
  review: { label: 'Precisa de conferência', tone: 'warning', icon: 'alert' },
  unknown: { label: 'Resultado a conferir', tone: 'warning', icon: 'alert' },
  creating: { label: 'Gerando link', tone: 'info', icon: 'clock' },
  waiting: { label: 'Aguardando o cliente', tone: 'info', icon: 'clock' },
  paying: { label: 'Em pagamento', tone: 'info', icon: 'clock' },
  paid: { label: 'Recebido', tone: 'success', icon: 'check' },
  canceled: { label: 'Cancelado', tone: 'neutral', icon: '' },
  settled: { label: 'Quitado', tone: 'success', icon: 'check' },
  partial: { label: 'Pago parcialmente', tone: 'neutral', icon: '' },
  none: { label: 'Sem cobrança', tone: 'neutral', icon: '' },
});
/** @typedef {{label: string, tone: string, icon: string}} Badge */

/** @param {string} s */
const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** @param {string} text */
export const strong = (text) => ({ strong: text });
/**
 * A paragraph of the next step: text and `{strong}` parts, never HTML.
 * @param {Array<string|{strong: string}>} parts
 * @param {string} [tone] 'muted' · 'message' · 'busy'
 */
const para = (parts, tone = '') => ({ parts, tone });

/** @param {unknown} value */
const cents = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : 0;
};
/** @param {unknown} value */
const instant = (value) =>
  typeof value === 'string' && value ? Date.parse(value) : NaN;
/** @param {unknown} a @param {unknown} b */
const byInstant = (a, b) => (instant(a) || 0) - (instant(b) || 0);

/** InfinitePay method of a paid link, in words. @param {unknown} method */
export function payMethodLabel(method) {
  const value = String(method ?? '').toLowerCase();
  if (value === 'pix') return 'Pix';
  if (['credit_card', 'card', 'debit_card', 'cartao'].includes(value))
    return 'Cartão';
  return 'Pix ou cartão';
}

/**
 * One link of the API as the screen reads it.
 * @param {any} link
 * @param {{review: boolean}} context
 */
export function normalizeLink(link, context) {
  const state = String(link?.state ?? '');
  /** @type {'waiting'|'paying'|'unknown'|'paid'|'review'|'canceled'} */
  let status = 'waiting';
  if (state === 'checkout_requested' || state === 'checkout_open')
    status = 'paying';
  else if (state === 'unknown') status = 'unknown';
  else if (state === 'paid')
    status = link?.inReview && context.review ? 'review' : 'paid';
  else if (state === 'cancelled') status = 'canceled';
  const verifying = link?.verifying;
  const nextCheck =
    typeof verifying === 'string'
      ? verifying
      : (verifying?.nextAt ?? verifying?.nextCheckAt ?? verifying?.at ?? null);
  return {
    id: String(link?.id ?? ''),
    kind: kindOf(link?.kind),
    amountCents: cents(link?.amountCents),
    state,
    status,
    origin: link?.origin === 'generated' ? 'generated' : 'sent',
    url: billingLinkUrl(link?.url) || '',
    rawUrl: typeof link?.url === 'string' ? link.url : '',
    // The API sent an address this page refuses (another origin, LPC-01).
    urlBlocked: Boolean(link?.url) && !billingLinkUrl(link?.url),
    chargeId: link?.chargeId ?? null,
    createdAt: link?.createdAt ?? null,
    createdBy: link?.createdBy ?? '',
    sentAt: link?.sentAt ?? null,
    deliveredAt: link?.deliveredAt ?? null,
    pageOpenedAt: link?.pageOpenedAt ?? null,
    clickedAt: link?.clickedAt ?? null,
    providerValidUntil: link?.providerValidUntil ?? null,
    paidAt: link?.paidAt ?? null,
    payMethod: payMethodLabel(link?.payMethod),
    refundedCents: cents(link?.refundedCents),
    cancelledAt: link?.cancelledAt ?? null,
    cancelledBy: link?.cancelledBy ?? '',
    cancelReason: link?.cancelReason ?? null,
    // Only a queued check is still running (payment_checks.status).
    verifying: Boolean(
      verifying &&
      (typeof verifying === 'string' ||
        !verifying.state ||
        verifying.state === 'queued'),
    ),
    verifyAt: nextCheck ? fT(nextCheck) : '',
    history: Array.isArray(link?.history) ? link.history : null,
    // Owner only: the attempt's checkout and the payment's invoice code.
    checkoutUrl: billingUrl(link?.checkoutUrl),
    invoiceCode: typeof link?.invoiceCode === 'string' ? link.invoiceCode : '',
  };
}
/** @typedef {ReturnType<typeof normalizeLink>} Link */

/** @param {any} receipt */
export function normalizeReceipt(receipt) {
  return {
    id: String(receipt?.id ?? ''),
    amountCents: cents(receipt?.amountCents),
    receivedOn: receipt?.receivedOn ?? null,
    method: String(receipt?.method ?? ''),
    note: typeof receipt?.note === 'string' ? receipt.note : '',
    by: receipt?.recordedByName || 'Vendedor',
    recordedAt: receipt?.recordedAt ?? null,
    reversed: Boolean(receipt?.reversedAt),
    // Held for conferência (application_valid false): out of the received.
    held: receipt?.applicationValid === false && !receipt?.reversedAt,
    reversedAt: receipt?.reversedAt ?? null,
    reversedBy: receipt?.reversedByName || '',
    reverseReason:
      typeof receipt?.reversalReason === 'string' ? receipt.reversalReason : '',
  };
}
/** @typedef {ReturnType<typeof normalizeReceipt>} Receipt */

/** Groups the links by what they reserve. @param {Link[]} links */
function groupLinks(links) {
  /** @param {string} s */
  const by = (s) => links.filter((l) => l.status === s);
  const waiting = by('waiting');
  const paying = by('paying');
  const unknown = by('unknown');
  return {
    waiting,
    paying,
    unknown,
    review: by('review'),
    paid: by('paid'),
    open: [...waiting, ...paying, ...unknown],
  };
}

/**
 * Situação: the API's figures when present, else the same arithmetic as the
 * server. Falta receber = total − recebido; Livre para cobrar = falta receber
 * − links abertos. A link in "Resultado a conferir" reserves too (decision 7)
 * but is never "aberto": `checking` is its part of `reserved`, `opened` the
 * rest (`opened + checking = reserved`).
 *
 * @param {any} billing @param {Link[]} links @param {Receipt[]} receipts
 */
export function figuresOf(billing, links, receipts) {
  const f = billing?.figures;
  const total = cents(f?.totalCents ?? billing?.totalAmountCents);
  const g = groupLinks(links);
  let received;
  let remaining;
  let held;
  let reserved;
  let free;
  if (f && typeof f === 'object') {
    received = cents(f.receivedCents);
    remaining = cents(f.remainingCents);
    held = cents(f.heldCents);
    reserved = cents(f.reservedCents);
    free = cents(f.freeCents);
  } else {
    const live = receipts.filter((r) => !r.reversed);
    received =
      g.paid.reduce((s, l) => s + l.amountCents - l.refundedCents, 0) +
      live.filter((r) => !r.held).reduce((s, r) => s + r.amountCents, 0);
    if (!links.length && Number.isSafeInteger(billing?.receivedAmountCents))
      received = cents(billing.receivedAmountCents);
    remaining = Math.max(0, total - received);
    held =
      g.review.reduce((s, l) => s + l.amountCents - l.refundedCents, 0) +
      live.filter((r) => r.held).reduce((s, r) => s + r.amountCents, 0);
    reserved = Math.min(
      remaining,
      g.open.reduce((s, l) => s + l.amountCents, 0),
    );
    free = Math.max(0, remaining - reserved);
  }
  const checking = Math.min(
    reserved,
    g.unknown.reduce((s, l) => s + l.amountCents, 0),
  );
  const opened = reserved - checking;
  const pct =
    total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const pctRes =
    reserved > 0 && total > 0
      ? Math.max(1, Math.min(100 - pct, Math.round((reserved / total) * 100)))
      : 0;
  return {
    total,
    received,
    remaining,
    held,
    reserved,
    opened,
    checking,
    free,
    pct,
    pctRes,
  };
}
/** @typedef {ReturnType<typeof figuresOf>} Figures */

/** @param {string} situation */
function badgeFor(situation) {
  return TONE[/** @type {keyof typeof TONE} */ (situation)] ?? TONE.none;
}

/**
 * Selo da seção: the most urgent state among the links — Resultado a conferir
 * > Precisa de conferência > Em pagamento > Aguardando o cliente > Quitado >
 * Pago parcialmente > Sem cobrança.
 */
function situationOf(
  /** @type {any} */ billing,
  /** @type {ReturnType<typeof groupLinks>} */ g,
  /** @type {Figures} */ k,
) {
  const api = String(billing?.situation ?? '');
  if (api === 'unknown' || g.unknown.length) return 'unknown';
  if (api === 'review' || billing?.review || g.review.length) return 'review';
  if (api === 'paying' || g.paying.length) return 'paying';
  if (api === 'waiting' || g.waiting.length) return 'waiting';
  if (api === 'settled' || api === 'partial' || api === 'none') return api;
  if (k.total > 0 && k.remaining <= 0) return 'settled';
  return k.received > 0 ? 'partial' : 'none';
}

/** "link do sinal". @param {{kind: Kind}} l */
export const linkName = (l) => `link ${KIND[l.kind].of}`;

/** The customer's message, as the conversation sends it. */
export function messageText(
  /** @type {string} */ orderNumber,
  /** @type {Kind} */ kind,
  /** @type {number} */ amountCents,
  /** @type {string} */ url,
) {
  return `Pedido ${orderNumber} — ${KIND[kind].noun} de ${money(amountCents)}. Link para pagamento: ${url}`;
}

/** @param {Link} l */
function sentPhrase(l) {
  if (l.origin !== 'sent' && !l.sentAt) return `gerado às ${fT(l.createdAt)}`;
  return l.deliveredAt
    ? `Entregue às ${fT(l.deliveredAt)}`
    : `Enviado às ${fT(l.sentAt ?? l.createdAt)}`;
}

/** @param {Link} l @param {Receipt[]} _r */
function receivedItem(l, _r) {
  return {
    at: l.paidAt,
    text: `${KIND[l.kind].cap} de ${money(l.amountCents - l.refundedCents)} ${KIND[l.kind].rec} por ${l.payMethod} em ${fDM(l.paidAt)}.`,
    kind: l.kind,
  };
}
/** Received items, oldest first. @param {Link[]} links @param {Receipt[]} receipts */
export function lastReceived(links, receipts) {
  return [
    ...links
      .filter((l) => l.status === 'paid' && l.refundedCents < l.amountCents)
      .map((l) => receivedItem(l, receipts)),
    ...receipts
      .filter((r) => !r.reversed)
      .map((r) => ({
        at: r.recordedAt,
        text: `${money(r.amountCents)} recebido por fora (${methodOf(r.method).short}) em ${fDM(r.receivedOn ? `${r.receivedOn}T15:00:00Z` : r.recordedAt)}.`,
        kind: 'outside',
      })),
  ].sort((a, b) => byInstant(a.at, b.at));
}
/** @param {Link[]} links @param {Receipt[]} receipts @param {Figures} k */
function receivedSentence(links, receipts, k) {
  const items = lastReceived(links, receipts);
  if (!items.length) return '';
  return items.length === 1
    ? items[0].text
    : `${items.length} recebimentos somam ${money(k.received)}.`;
}

/**
 * The first link the condition suggests (the signal), then the free amount.
 * @param {{condition: 0|50|100|null, figures: Figures, links: Link[]}} view
 * @param {0|50|100} [pick] the condition chosen on screen, when none is saved
 */
export function nextCharge(view, pick = 50) {
  const k = view.figures;
  const fromPick = view.condition === null;
  const condition = fromPick ? pick : view.condition;
  if (
    k.received > 0 ||
    k.held > 0 ||
    view.links.some((l) => l.status === 'paid')
  )
    return {
      kind: /** @type {Kind} */ ('balance'),
      amountCents: k.free,
      fromPick: false,
      condition,
    };
  if (condition === 50)
    return {
      kind: /** @type {Kind} */ ('signal'),
      amountCents: Math.round(k.total / 2),
      fromPick,
      condition,
    };
  return {
    kind: /** @type {Kind} */ ('full'),
    amountCents: k.free,
    fromPick,
    condition,
  };
}

/**
 * The automatic name of a new link of any amount (the server decides the same
 * way): Sinal for the condition's entry, Pagamento integral for everything at
 * once, Saldo when it covers all the free amount and nothing else is open.
 *
 * @param {{condition: 0|50|100|null, figures: Figures, groups: {open: Link[]}}} view
 * @param {number} amountCents
 * @returns {Kind}
 */
export function linkKind(view, amountCents) {
  const k = view.figures;
  const nothingYet =
    k.received === 0 && k.held === 0 && !view.groups.open.length;
  if (
    nothingYet &&
    view.condition === 50 &&
    amountCents === Math.round(k.total / 2)
  )
    return 'signal';
  if (nothingYet && amountCents === k.remaining) return 'full';
  if (!view.groups.open.length && amountCents === k.free) return 'balance';
  return 'part';
}

/** The sub-line under "Valor" in the send review. */
export function valueSub(/** @type {Kind} */ kind, /** @type {Figures} */ k) {
  if (kind === 'signal') return `Sinal · 50% de ${money(k.total)}`;
  if (kind === 'balance')
    return `Saldo: ${money(k.total)} − ${money(k.received)} recebido`;
  if (kind === 'part') return 'Parcela do que falta receber';
  return 'Pagamento integral do pedido';
}

/**
 * Parses what the seller typed as an amount: `null` when empty, `NaN` when it
 * is not an amount, else integer cents. "2.400", "2.400,00", "2400,5" and
 * "R$ 1.200,00" are accepted.
 *
 * @param {unknown} raw
 */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/\s|R\$/gu, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./gu, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/u.test(s)) s = s.replace(/\./gu, '');
  if (!/^\d+(\.\d{1,2})?$/u.test(s) || s.length > 15) return NaN;
  const [reais, fraction = ''] = s.split('.');
  return Number(reais) * 100 + Number(fraction.padEnd(2, '0'));
}
/** "2.400,00" for a field. @param {number} amountCents */
export function decimal(amountCents) {
  return money(amountCents)
    .replace(/^R\$\s?/u, '')
    .trim();
}

/**
 * Why the order is in "Precisa de conferência", in plain words (API
 * `review.reason`).
 * @param {any} billing @param {Link[]} links @param {Figures} k
 * @param {Receipt[]} [receipts]
 */
export function reviewCause(billing, links, k, receipts = []) {
  const r = billing?.review;
  if (!r) return '';
  const held = links.find((l) => l.status === 'review');
  const heldCents = cents(r.heldCents) || k.held;
  // Money held only by receipts registered outside the InfinitePay.
  const outside = held ? [] : receipts.filter((x) => x.held);
  // previousTotalCents comes only when the total itself changed.
  const changed = Number.isSafeInteger(r.previousTotalCents)
    ? `O valor do pedido mudou de ${money(r.previousTotalCents)} para ${money(k.total)}`
    : 'O acordo do pedido mudou';
  // Nothing held: never say "R$ 0,00 está guardado".
  const keep =
    heldCents > 0
      ? ` ${money(heldCents)} está guardado, mas ainda não conta no recebido.`
      : '';
  if (outside.length && r.reason !== 'refund') {
    const how =
      outside.length === 1 ? ` (${methodOf(outside[0].method).short})` : '';
    const one = outside.length === 1;
    const what = one
      ? `um pagamento por fora${how} foi registrado`
      : `${outside.length} pagamentos por fora foram registrados`;
    const subject = one ? 'O recebimento' : 'Os recebimentos';
    const kept = one ? 'está guardado' : 'estão guardados';
    if (r.reason === 'order_changed')
      return `${changed} depois que ${what}.${heldCents > 0 ? ` ${subject} de ${money(heldCents)} ${kept}, mas ainda não conta no recebido.` : ''}`;
    return `${one ? `Um pagamento registrado por fora${how} não cabe` : `${outside.length} pagamentos registrados por fora não cabem`} no acordo atual do pedido.${keep}`;
  }
  if (r.reason === 'order_changed') {
    const K = held ? KIND[held.kind] : null;
    const paid = K
      ? `${K.art} ${K.noun} foi pag${K.art}`
      : 'um pagamento foi confirmado';
    const subject = K ? `${ucfirst(K.art)} ${K.noun}` : 'O pagamento';
    return `${changed} depois que ${paid}.${heldCents > 0 ? ` ${subject} de ${money(heldCents)} está guardad${K?.art ?? 'o'}, mas ainda não conta no recebido.` : ' Confira os pagamentos antes de continuar.'}`;
  }
  if (r.reason === 'refund') {
    const refunded = [...links]
      .filter((l) => l.refundedCents > 0)
      .sort((a, b) => byInstant(a.paidAt, b.paidAt))
      .at(-1);
    const amount = cents(r.refundedCents) || refunded?.refundedCents || 0;
    const K = KIND[refunded?.kind ?? 'signal'];
    return `Foi registrada uma devolução de ${money(amount)} ${K.art === 'a' ? 'na' : 'no'} ${K.noun}. O recebido já desconta a devolução; confira na InfinitePay e aplique os pagamentos ao valor atual.`;
  }
  if (r.reason === 'late_payment')
    return `Um pagamento chegou depois que o link foi cancelado ou que o pagamento na InfinitePay venceu.${keep}`;
  if (r.reason === 'outside_agreement')
    return `Um pagamento confirmado pela InfinitePay não cabe no acordo atual do pedido.${keep}`;
  return `Um pagamento precisa de conferência antes de contar no recebido.`;
}

/**
 * Where the money held in conferência came from: payments of links
 * (InfinitePay), receipts registered outside it, or both.
 * @param {{groups: {review: Link[]}, receipts: Receipt[]}} v
 * @returns {'provider'|'outside'|'both'}
 */
export function reviewSource(v) {
  const links = v.groups.review.length > 0;
  const outside = v.receipts.some((r) => r.held);
  if (outside && links) return 'both';
  return outside ? 'outside' : 'provider';
}

/**
 * The words of "Resolver conferência" for each source: the seller is never
 * sent to the InfinitePay for a payment registered outside it.
 * @param {'provider'|'outside'|'both'} source
 */
export function reviewCheck(source) {
  if (source === 'outside')
    return {
      hint: 'Resolver pede que você confira o que foi registrado por fora e escolha o que fazer com esses pagamentos.',
      step: 'Passo 1 de 2 · Confira os pagamentos',
      lead: 'Antes de decidir, confira os pagamentos registrados por fora: valores, datas e meios.',
      check: 'Conferi os pagamentos registrados por fora.',
      error: 'Confirme que conferiu os pagamentos registrados por fora.',
    };
  if (source === 'both')
    return {
      hint: 'Resolver pede que você confira os pagamentos na InfinitePay e os registrados por fora e escolha o que fazer com eles.',
      step: 'Passo 1 de 2 · Confira os pagamentos',
      lead: 'Antes de decidir, confira na InfinitePay os pagamentos desta cobrança e os registrados por fora: valores, datas e se o cliente abriu algum pagamento.',
      check: 'Conferi os pagamentos na InfinitePay e os registrados por fora.',
      error:
        'Confirme que conferiu os pagamentos na InfinitePay e os registrados por fora.',
    };
  return {
    hint: 'Resolver pede que você confira os pagamentos na InfinitePay e escolha o que fazer com eles.',
    step: 'Passo 1 de 2 · Confira na InfinitePay',
    lead: 'Antes de decidir, confira na InfinitePay os pagamentos desta cobrança: valores, datas e se o cliente abriu algum pagamento.',
    check: 'Conferi os pagamentos desta cobrança na InfinitePay.',
    error: 'Confirme que conferiu os pagamentos na InfinitePay.',
  };
}

/**
 * Situação in words: what is due (nothing, in a cancelled order) and, when
 * links reserve money, the legend. "A conferir" (unknown) never reads as
 * "aberto"; during conferência or in a cancelled order nothing is "livre para
 * cobrar" (the API refuses new links with BILLING_REVIEW_REQUIRED).
 * @param {{figures: Figures, review: any, cancelled: boolean}} v
 */
export function situationSummary(v) {
  const k = v.figures;
  if (v.cancelled)
    return {
      due: { label: 'Pedido cancelado', value: 'Nada a receber' },
      legend: null,
    };
  /** @type {Array<string|{strong: string}>} */
  const legend = [];
  /** @param {string} label @param {number} value */
  const add = (label, value) => {
    if (legend.length) legend.push(' · ');
    legend.push(`${label} `, strong(money(value)));
  };
  if (k.opened > 0) add('Em links abertos', k.opened);
  if (k.checking > 0) add('A conferir', k.checking);
  if (legend.length && !v.review) add('Livre para cobrar', k.free);
  return {
    due: { label: 'Falta receber', value: money(k.remaining) },
    legend: legend.length ? legend : null,
  };
}

/** Links the server cancelled when the order's value changed. @param {Link[]} links */
function autoCancelNote(/** @type {any} */ billing, links) {
  if (billing?.review?.reason !== 'order_changed') return '';
  const w = links.filter(
    (l) => l.status === 'canceled' && l.cancelReason === 'order_changed',
  );
  if (!w.length) return '';
  const what =
    w.length === 1
      ? `o ${linkName(w[0])} de ${money(w[0].amountCents)}, que o cliente ainda não clicou, foi cancelado`
      : `os ${w.length} links que o cliente ainda não clicou foram cancelados`;
  return `Se o valor do pedido muda, links que o cliente ainda não clicou são cancelados sozinhos. Aqui, ${what}.`;
}

/** The last automatic attempt of an uncertain click. @param {Link} l */
function lastTry(l) {
  const tries = (l.history ?? []).filter(
    (/** @type {any} */ e) => e?.kind === 'checkout_unknown',
  );
  return tries.at(-1)?.at ?? null;
}

/** Steps of a send, in the words the seller reads. */
export function sendSteps(
  /** @type {'send'|'generate'} */ mode,
  /** @type {boolean} */ existing,
) {
  if (mode === 'generate') return ['Gerando link', 'Link gerado'];
  return existing
    ? ['Enviando', 'Enviado', 'Entregue']
    : ['Gerando link', 'Enviando', 'Enviado', 'Entregue'];
}
/**
 * Where a send intent is (GET send-intents/:id). Only the transport may say
 * "Enviado"/"Entregue".
 * @param {string[]} steps @param {unknown} state
 */
export function sendProgress(steps, state) {
  const value = String(state ?? '');
  if (['failed', 'blocked', 'unknown'].includes(value))
    return { index: 0, done: false, failed: value };
  /** @param {string} name */
  const at = (name) => Math.max(0, steps.indexOf(name));
  if (value === 'delivered')
    return { index: steps.length - 1, done: true, failed: '' };
  if (value === 'sent')
    return { index: at('Enviado'), done: false, failed: '' };
  if (value === 'sending')
    return { index: at('Enviando'), done: false, failed: '' };
  return { index: 0, done: false, failed: '' };
}

/**
 * Derives everything the section shows.
 *
 * @param {any} billing the seller's billing view
 * @param {{conv?: boolean, pick?: 0|50|100, sending?: any, busy?: string, orderNumber?: string, destination?: string, changingTerms?: boolean, readOnly?: string, cancelled?: boolean, inbox?: boolean}} [ctx]
 */
export function deriveBillingView(billing, ctx = {}) {
  const review = Boolean(billing?.review);
  const links = (Array.isArray(billing?.links) ? billing.links : [])
    .map((/** @type {any} */ l) => normalizeLink(l, { review }))
    .filter((/** @type {Link} */ l) => l.id);
  const receipts = (
    Array.isArray(billing?.receipts)
      ? billing.receipts
      : Array.isArray(billing?.externalReceipts)
        ? billing.externalReceipts
        : []
  )
    .map(normalizeReceipt)
    .filter((/** @type {Receipt} */ r) => r.id);
  const groups = groupLinks(links);
  const figures = figuresOf(billing, links, receipts);
  const canOperate =
    billing?.canOperate === undefined
      ? Boolean(billing?.canManage)
      : Boolean(billing.canOperate);
  const ownerName = String(billing?.ownerName ?? '');
  // A cancelled order owes nothing and charges nothing (ADR 068).
  const cancelled =
    Boolean(ctx.cancelled) || billing?.blockedReason === 'ORDER_CANCELLED';
  const condition = ctx.changingTerms
    ? null
    : conditionOf(billing?.condition?.percent ?? billing?.percent);
  // CRM links are created at once: "Gerando link" is only a send step.
  const situation = situationOf(billing, groups, figures);
  const badge = badgeFor(situation);
  const charges = new Map(
    (Array.isArray(billing?.charges) ? billing.charges : []).map(
      (/** @type {any} */ c) => [c.id, c],
    ),
  );
  const payments = Array.isArray(billing?.payments) ? billing.payments : [];
  const base = {
    billing,
    ctx,
    links,
    receipts,
    groups,
    figures,
    canOperate,
    ownerName,
    condition,
    situation,
    badge,
    cancelled,
    review: billing?.review ?? null,
    orderNumber: String(ctx.orderNumber ?? ''),
    /** The checkout of the link's current attempt, InfinitePay only. @param {Link} l */
    providerUrl: (l) =>
      canOperate
        ? l.checkoutUrl ||
          (l.chargeId ? billingUrl(charges.get(l.chargeId)?.checkoutUrl) : '')
        : '',
    /** The receipt of a paid link (private). @param {Link} l */
    paymentOf: (l) =>
      canOperate && l.chargeId
        ? (payments.find((/** @type {any} */ p) => p.chargeId === l.chargeId) ??
          null)
        : null,
  };
  const terms =
    condition === null
      ? { strong: 'ainda não combinada', after: '' }
      : { strong: TERMS[condition].text, after: TERMS[condition].after };
  const heldHint = figures.held
    ? `Guardado para conferência: ${money(figures.held)}, fora do recebido.`
    : '';
  const view = { ...base, terms, heldHint };
  return {
    ...view,
    summary: situationSummary(view),
    rows: movementRows(view),
    next: nextStep(view),
    announce: cancelled
      ? `${badge.label}. Pedido cancelado. Recebido ${money(figures.received)}.`
      : `${badge.label}. Recebido ${money(figures.received)}. Falta receber ${money(figures.remaining)}.`,
  };
}
/** @typedef {ReturnType<typeof deriveBillingView>} BillingView */

/** @param {any} v @param {Link} l */
function chargeBadge(v, l) {
  if (l.verifying && l.status === 'paying')
    return {
      label: l.verifyAt
        ? `Verificando na InfinitePay · nova consulta às ${l.verifyAt}`
        : 'Verificando na InfinitePay',
      tone: 'info',
      icon: 'clock',
    };
  if (l.status === 'paid') {
    if (l.refundedCents >= l.amountCents)
      return { label: 'Devolvido', tone: 'neutral', icon: '' };
    if (l.refundedCents > 0)
      return { label: 'Devolução parcial', tone: 'neutral', icon: '' };
  }
  return badgeFor(l.status);
}
/** @param {Receipt} r */
function receiptBadge(r) {
  if (r.reversed) return { label: 'Estornado', tone: 'neutral', icon: '' };
  return r.held
    ? { label: 'Guardado para conferência', tone: 'warning', icon: 'alert' }
    : { label: 'Recebido por fora', tone: 'success', icon: 'check' };
}

/**
 * Why a link was cancelled, by `cancel_reason`. The seller's own cancel says
 * only who did it.
 * @type {Readonly<Record<string, string>>}
 */
const CANCEL_WHY = Object.freeze({
  order_changed: 'o valor do pedido mudou',
  order_cancelled: 'o pedido foi cancelado',
  external_receipt: 'pagamento registrado por fora',
  reconcile: 'resolvido na conferência',
});

/** @param {Link} l */
function chargeMeta(l) {
  const how = l.sentAt
    ? `Enviado na conversa · ${fDMT(l.sentAt)}`
    : `Link gerado, não enviado · ${fDMT(l.createdAt)}`;
  switch (l.status) {
    case 'waiting':
      return `${how} · ${l.pageOpenedAt ? `cliente abriu a página às ${fT(l.pageOpenedAt)}, sem clicar em Pagar` : 'ainda sem clique em Pagar'}`;
    case 'paying':
      return l.providerValidUntil
        ? `Aberto na InfinitePay às ${fT(l.clickedAt)} · vale até ${fDMT(l.providerValidUntil)}`
        : `Cliente clicou em Pagar às ${fT(l.clickedAt)} · abrindo o pagamento na InfinitePay`;
    case 'unknown':
      return `Cliente clicou em Pagar às ${fT(l.clickedAt)} · sem resposta da InfinitePay`;
    case 'canceled': {
      const by = l.cancelledBy ? ` por ${l.cancelledBy}` : '';
      const why = CANCEL_WHY[l.cancelReason ?? ''];
      return `${how} · cancelado${by} às ${fT(l.cancelledAt)}${why ? `: ${why}` : ''}`;
    }
    case 'review':
      return `Pago por ${l.payMethod} em ${fDT(l.paidAt)} · guardado, ainda não conta no recebido`;
    case 'paid':
      return `Pago por ${l.payMethod} pela InfinitePay · ${fDT(l.paidAt)}`;
  }
  return fDT(l.createdAt);
}

const EVENT = Object.freeze({
  sent: 'Enviado na conversa',
  delivered: 'Entregue',
  page_opened: 'Cliente abriu a página',
  clicked: 'Cliente clicou em Pagar',
  checkout_opened: 'Pagamento aberto na InfinitePay',
  checkout_unknown:
    'Sem resposta da InfinitePay · o link fica travado até confirmar o resultado',
  checkout_expired:
    'O pagamento na InfinitePay venceu sem ser pago · o link volta a aceitar um novo clique',
  applied: 'Aplicado ao valor atual do pedido',
});

/** History of a link in domain words. @param {Link} l @param {any} billing */
function chargeEvents(l, billing) {
  /** @type {Array<[unknown, string]>} */
  const e = [];
  if (l.history) {
    for (const item of l.history) {
      const kind = String(item?.kind ?? '');
      const actor = item?.actor ? String(item.actor) : '';
      if (kind === 'created')
        e.push([item.at, `Link do CRM criado${actor ? ` por ${actor}` : ''}`]);
      else if (kind === 'paid') {
        e.push([
          item.at,
          `Pagamento confirmado pela InfinitePay (${l.payMethod})`,
        ]);
        e.push([item.at, 'Comprovante disponível']);
      } else if (kind === 'cancelled')
        e.push([
          item.at,
          l.cancelReason === 'order_changed' && !actor
            ? 'Link cancelado sozinho: o valor do pedido mudou'
            : l.cancelReason === 'order_cancelled'
              ? `Link cancelado${actor ? ` por ${actor}` : ' sozinho'}: o pedido foi cancelado`
              : l.cancelReason === 'external_receipt'
                ? `Link cancelado${actor ? ` por ${actor}` : ''} ao registrar pagamento por fora`
                : l.cancelReason === 'reconcile'
                  ? `Link cancelado${actor ? ` por ${actor}` : ''} na conferência`
                  : `Link cancelado${actor ? ` por ${actor}` : ''}`,
        ]);
      else if (kind === 'refund')
        e.push([
          item.at,
          Number.isSafeInteger(item?.amountCents)
            ? `Devolução registrada · ${money(item.amountCents)}`
            : 'Devolução registrada',
        ]);
      else if (kind === 'review')
        e.push([
          item.at,
          billing?.review?.reason === 'order_changed'
            ? 'Guardado para conferência: o valor do pedido mudou'
            : 'Guardado para conferência',
        ]);
      else if (Object.hasOwn(EVENT, kind))
        e.push([item.at, EVENT[/** @type {keyof typeof EVENT} */ (kind)]]);
    }
    return e;
  }
  e.push([
    l.createdAt,
    `Link do CRM criado${l.createdBy ? ` por ${l.createdBy}` : ''}`,
  ]);
  if (l.sentAt) e.push([l.sentAt, EVENT.sent]);
  if (l.deliveredAt) e.push([l.deliveredAt, EVENT.delivered]);
  if (l.pageOpenedAt) e.push([l.pageOpenedAt, EVENT.page_opened]);
  if (l.clickedAt) {
    e.push([l.clickedAt, EVENT.clicked]);
    if (l.status !== 'unknown') e.push([l.clickedAt, EVENT.checkout_opened]);
  }
  if (l.paidAt) {
    e.push([
      l.paidAt,
      `Pagamento confirmado pela InfinitePay (${l.payMethod})`,
    ]);
    e.push([l.paidAt, 'Comprovante disponível']);
  }
  if (l.cancelledAt)
    e.push([
      l.cancelledAt,
      l.cancelledBy ? `Link cancelado por ${l.cancelledBy}` : 'Link cancelado',
    ]);
  return e.sort((x, y) => byInstant(x[0], y[0]));
}
/** @param {Receipt} r */
function receiptEvents(r) {
  const m = methodOf(r.method);
  /** @type {Array<[unknown, string]>} */
  const e = [
    [
      r.recordedAt,
      `Registrado por ${r.by} · ${m.label} · recebido em ${dateBR(r.receivedOn)}`,
    ],
  ];
  if (r.note) e.push([r.recordedAt, `Observação: “${r.note}”`]);
  if (r.reversed)
    e.push([
      r.reversedAt,
      `Estornado${r.reversedBy ? ` por ${r.reversedBy}` : ''}${r.reverseReason ? ` · motivo: “${r.reverseReason}”` : ''}`,
    ]);
  return e;
}

/** Rare actions of a row, only those valid in its state. */
function menuItems(/** @type {any} */ v, /** @type {any} */ row) {
  if (!v.canOperate) return [];
  const locked = Boolean(v.ctx.readOnly);
  /** @type {Array<{label: string, act: string, icon: string}>} */
  const items = [];
  if (row.type === 'charge') {
    /** @type {Link} */
    const l = row.item;
    switch (l.status) {
      case 'waiting':
        if (locked) break;
        if (l.url)
          items.push({ label: 'Copiar link', act: 'copy-link', icon: 'copy' });
        items.push({ label: 'Cancelar link', act: 'cancel-link', icon: 'x' });
        break;
      case 'paying':
        if (v.providerUrl(l))
          items.push({
            label: 'Abrir na InfinitePay',
            act: 'provider',
            icon: 'external',
          });
        if (
          !locked &&
          !l.verifying &&
          l.chargeId &&
          v.billing?.paymentCheckEnabled !== false
        )
          items.push({
            label: 'Verificar pagamento na InfinitePay',
            act: 'verify',
            icon: 'info',
          });
        break;
      case 'unknown':
        if (!locked && !l.verifying)
          items.push({
            label: 'Confirmar resultado na InfinitePay',
            act: 'confirm-unknown',
            icon: 'info',
          });
        break;
      case 'paid':
        if (l.chargeId)
          items.push({
            label: 'Ver comprovante',
            act: 'receipt-view',
            icon: 'receipt',
          });
        if (
          !locked &&
          l.chargeId &&
          l.refundedCents < l.amountCents &&
          !v.review
        )
          items.push({
            label: 'Registrar devolução',
            act: 'refund',
            icon: 'undo',
          });
        break;
      case 'review':
        if (v.providerUrl(l))
          items.push({
            label: 'Abrir na InfinitePay',
            act: 'provider',
            icon: 'external',
          });
        if (l.chargeId)
          items.push({
            label: 'Ver comprovante',
            act: 'receipt-view',
            icon: 'receipt',
          });
        break;
    }
  } else if (!locked && !row.item.reversed && !v.review) {
    items.push({ label: 'Estornar registro', act: 'reverse', icon: 'undo' });
  }
  return items;
}

/** Movimentações: one row per link and per receipt, oldest first. */
function movementRows(/** @type {any} */ v) {
  const list = [
    ...v.links.map((/** @type {Link} */ l) => ({
      type: 'charge',
      item: l,
      at: l.createdAt,
    })),
    ...v.receipts.map((/** @type {Receipt} */ r) => ({
      type: 'receipt',
      item: r,
      at: r.recordedAt,
    })),
  ].sort((a, b) => byInstant(a.at, b.at));
  return list.map((row) => {
    const isC = row.type === 'charge';
    const it = row.item;
    const title = isC
      ? KIND[/** @type {Link} */ (it).kind].title
      : `Recebido por fora · ${methodOf(/** @type {Receipt} */ (it).method).short}`;
    const meta = isC
      ? chargeMeta(/** @type {Link} */ (it))
      : /** @type {Receipt} */ (it).reversed
        ? `Estornado em ${fDMT(it.reversedAt)} · registrado por ${/** @type {Receipt} */ (it).by}`
        : `Registrado por ${/** @type {Receipt} */ (it).by} · recebido em ${dateBR(/** @type {Receipt} */ (it).receivedOn)}`;
    const events = (
      isC
        ? chargeEvents(/** @type {Link} */ (it), v.billing)
        : receiptEvents(/** @type {Receipt} */ (it))
    ).map(([at, label]) => ({ at: fDT(at), label }));
    const link = /** @type {Link} */ (it);
    return {
      id: it.id,
      type: row.type,
      item: it,
      icon: isC ? 'card' : 'cash',
      title,
      meta,
      noun: isC ? 'desta cobrança' : 'deste recebimento',
      badge: isC
        ? chargeBadge(v, link)
        : receiptBadge(/** @type {Receipt} */ (it)),
      amountCents: it.amountCents,
      struck: isC
        ? link.status === 'canceled'
        : /** @type {Receipt} */ (it).reversed,
      sub:
        isC && link.refundedCents > 0
          ? `− ${money(link.refundedCents)} devolvido`
          : isC && link.status === 'canceled'
            ? 'fora da soma'
            : '',
      events,
      menu: menuItems(v, { type: row.type, item: it }),
    };
  });
}
/** @typedef {ReturnType<typeof movementRows>[number]} Row */

/**
 * @typedef {{label: string, act: string, id?: string, icon?: string, disabled?: string, busy?: boolean}} Action
 * @typedef {{parts: Array<string|{strong: string}>, tone: string}} Paragraph
 */

/**
 * Próximo passo: a sentence, at most one primary and two secondaries (§16).
 * The same model serves the order page and the Inbox.
 *
 * @param {any} v
 * @returns {{tone: string, title: string, body: Paragraph[], primary: Action|null, secondary: Action[], after: Paragraph[], quiet: (Action & {q: string})|null, lock: string, terms: any, sending: any}}
 */
export function nextStep(v) {
  const model = stepModel(v);
  // LPC-01: a link whose address this page refuses is said, never dropped in
  // silence (the copy actions are gone with it).
  if (
    !model.lock &&
    !model.sending &&
    v.groups.waiting.some((/** @type {Link} */ l) => l.urlBlocked)
  )
    model.body.push(para([LINK_URL_BLOCKED], 'warning'));
  return model;
}

/**
 * Shown when the API's link address is not this page's origin.
 */
export const LINK_URL_BLOCKED =
  'O endereço deste link é diferente do endereço deste CRM, então ele não é mostrado nem copiado aqui. Abra o CRM pelo endereço oficial ou peça ao administrador para conferir o endereço público configurado (APP_BASE_URL).';

/** @param {any} v */
function stepModel(v) {
  const ctx = v.ctx;
  const k = /** @type {Figures} */ (v.figures);
  const conv = Boolean(ctx.conv);
  const model = {
    tone: 'normal',
    title: 'Próximo passo',
    body: /** @type {Paragraph[]} */ ([]),
    primary: /** @type {Action|null} */ (null),
    secondary: /** @type {Action[]} */ ([]),
    after: /** @type {Paragraph[]} */ ([]),
    quiet: /** @type {(Action & {q: string})|null} */ (null),
    lock: '',
    terms: /** @type {any} */ (null),
    sending: /** @type {any} */ (null),
  };
  if (!v.canOperate) {
    model.lock = v.ownerName
      ? `Só ${v.ownerName} (responsável) ou um administrador opera as cobranças deste pedido.`
      : 'Só o responsável pelo pedido ou um administrador opera as cobranças deste pedido.';
    return model;
  }
  if (ctx.readOnly || v.cancelled) {
    model.lock = ctx.readOnly || billingReason('ORDER_CANCELLED');
    return model;
  }
  /** @type {Link[]} */
  const W = v.groups.waiting;
  /** @type {Link[]} */
  const P = v.groups.paying;
  const sending = ctx.sending;
  if (sending && !sending.done) {
    const what = [
      `o link ${KIND[/** @type {Kind} */ (sending.kind)].of} de `,
      strong(money(sending.amountCents)),
    ];
    model.body.push(
      para(
        sending.mode === 'send'
          ? ['Enviando ', ...what, ` para ${ctx.destination || 'a conversa'}.`]
          : ['Gerando ', ...what, '.'],
      ),
    );
    model.sending = { steps: sending.steps, index: sending.index };
    return model;
  }
  const u = v.groups.unknown[0];
  if (u) {
    model.tone = 'attention';
    model.body.push(
      para([
        `O cliente clicou em Pagar às ${fT(u.clickedAt)}, mas não sabemos se a InfinitePay abriu o pagamento. O link fica travado até confirmar.`,
      ]),
    );
    model.primary =
      ctx.busy === 'confirm' || u.verifying
        ? { label: 'Confirmando resultado…', act: 'noop', busy: true }
        : {
            label: 'Confirmar resultado na InfinitePay',
            act: 'confirm-unknown',
            id: u.id,
          };
    const tried = lastTry(u);
    if (u.verifying)
      model.after.push(
        para(
          [
            u.verifyAt
              ? `Verificando na InfinitePay · nova consulta às ${u.verifyAt}`
              : 'Verificando na InfinitePay',
          ],
          'busy',
        ),
      );
    // Decision 11: an uncertain link never reopens by itself and no new
    // attempt is made while it is unknown.
    model.after.push(
      para(
        [
          `${tried ? `Sem resposta da InfinitePay desde ${fT(tried)}. ` : ''}O link não reabre sozinho e nenhum pagamento novo é criado até você confirmar o resultado.`,
        ],
        'muted',
      ),
    );
    return model;
  }
  if (v.review) {
    model.tone = 'attention';
    model.body.push(para([reviewCause(v.billing, v.links, k, v.receipts)]));
    const auto = autoCancelNote(v.billing, v.links);
    if (auto) model.body.push(para([auto]));
    model.body.push(
      para([
        'Até resolver, não é possível cobrar, enviar link ou registrar pagamento por fora.',
      ]),
    );
    model.body.push(para([reviewCheck(reviewSource(v)).hint], 'muted'));
    model.primary = { label: 'Resolver conferência', act: 'reconcile' };
    return model;
  }
  const external = { label: 'Registrar pagamento por fora', act: 'external' };
  // A link sent with an amount other than the agreed one, before any click.
  const exp =
    v.condition === 50
      ? {
          kind: /** @type {Kind} */ ('signal'),
          amountCents: Math.round(k.total / 2),
        }
      : v.condition === 100
        ? { kind: /** @type {Kind} */ ('full'), amountCents: k.total }
        : null;
  if (
    exp &&
    k.received === 0 &&
    k.held === 0 &&
    v.groups.open.length === 1 &&
    W.length === 1 &&
    W[0].origin === 'sent' &&
    W[0].amountCents !== exp.amountCents
  ) {
    const w = W[0];
    const E = KIND[exp.kind];
    model.tone = 'attention';
    model.body.push(
      para([
        `O link enviado às ${fT(w.sentAt ?? w.createdAt)} cobra `,
        strong(money(w.amountCents)),
        `, mas ${E.art} ${E.noun} combinado é `,
        strong(money(exp.amountCents)),
        '. O cliente ainda não clicou em Pagar.',
      ]),
    );
    model.body.push(
      para([
        strong('Enviou o valor errado?'),
        ' Cancele antes que o cliente clique em Pagar.',
      ]),
    );
    model.primary = {
      label: `Cancelar link de ${money(w.amountCents)}`,
      act: 'cancel-link',
      id: w.id,
    };
    return model;
  }
  // Em pagamento: the customer clicked; the link can no longer be cancelled.
  if (P.length) {
    const p = P[P.length - 1];
    model.body.push(
      para([
        `O cliente abriu o pagamento na InfinitePay às ${fT(p.clickedAt)}. Este link não pode mais ser cancelado.`,
      ]),
    );
    if (W.length)
      model.body.push(
        para(
          [
            W.length === 1
              ? `O ${linkName(W[0])} de ${money(W[0].amountCents)} ainda aguarda o cliente.`
              : `Outros ${W.length} links ainda aguardam o cliente.`,
          ],
          'muted',
        ),
      );
    if (p.verifying)
      model.body.push(
        para(
          [
            p.verifyAt
              ? `Verificando na InfinitePay · nova consulta às ${p.verifyAt}`
              : 'Verificando na InfinitePay',
          ],
          'busy',
        ),
      );
    model.secondary = [external];
    if (p.providerValidUntil)
      model.after.push(
        para(
          [
            `Se não pagar até ${fDMT(p.providerValidUntil)}, o link volta a aceitar um novo clique.`,
          ],
          'busy',
        ),
      );
    if (!p.verifying && p.chargeId && v.billing?.paymentCheckEnabled !== false)
      model.quiet = {
        q: 'O cliente pagou e não apareceu?',
        label: 'Verificar pagamento na InfinitePay',
        act: 'verify',
        id: p.id,
      };
    return model;
  }
  if (W.length) {
    const single = W.length === 1 ? W[0] : null;
    const recv = receivedSentence(v.links, v.receipts, k);
    const recvP = recv ? [para([recv])] : [];
    const outside = { q: 'Recebeu por outro meio?', ...external };
    // PO 2026-11-24: one link waiting also offers another one, up to the
    // free amount, as with several links. The Inbox footer carries only
    // copy/cancel, so it is left out there.
    const more = ctx.inbox ? null : anotherLink(k, conv);
    /**
     * At most two secondaries (§16): when the new action does not fit,
     * Cancelar link gives way — it stays in the row's Mais ações menu.
     * @param {Action[]} list
     */
    const fit = (list) => {
      const all = more ? [...list, more] : list;
      return all.length > 2 ? all.filter((a) => a.act !== 'cancel-link') : all;
    };
    if (single && single.origin !== 'sent' && !single.sentAt) {
      const of = KIND[single.kind].of;
      if (conv) {
        model.body.push(
          ...recvP,
          para([
            `Link ${of} de `,
            strong(money(single.amountCents)),
            ` gerado às ${fT(single.createdAt)} e ainda não enviado. O cliente não clicou em Pagar.`,
          ]),
        );
        model.primary = {
          label: 'Enviar link na conversa',
          act: 'send-existing',
          id: single.id,
        };
        model.secondary = fit([
          ...(single.url
            ? [
                {
                  label: 'Copiar mensagem',
                  act: 'copy-message',
                  icon: 'copy',
                  id: single.id,
                },
              ]
            : []),
          { label: 'Cancelar link', act: 'cancel-link', id: single.id },
        ]);
        model.quiet = outside;
        return model;
      }
      model.body.push(
        ...recvP,
        para([
          single.url
            ? `Link ${of} gerado. Copie a mensagem e envie ao cliente pelo canal que vocês usam. Dá para cancelar o link enquanto o cliente não clicar em Pagar.`
            : `Link ${of} gerado. Dá para cancelar o link enquanto o cliente não clicar em Pagar.`,
        ]),
        // Never a message with an empty link (LPC-01).
        ...(single.url
          ? [
              para(
                [
                  messageText(
                    v.orderNumber,
                    single.kind,
                    single.amountCents,
                    single.url,
                  ),
                ],
                'message',
              ),
            ]
          : []),
      );
      model.primary = single.url
        ? {
            label: 'Copiar mensagem',
            act: 'copy-message',
            icon: 'copy',
            id: single.id,
          }
        : null;
      model.secondary = fit([
        { label: 'Cancelar link', act: 'cancel-link', id: single.id },
      ]);
      model.quiet = outside;
      return model;
    }
    if (k.received === 0 && single) {
      model.body.push(
        para([
          `Link ${KIND[single.kind].of} enviado na conversa · ${sentPhrase(single)}. O cliente ainda não clicou em Pagar.`,
        ]),
      );
      // Nothing else is primary here: the new link takes that place, so
      // Copiar link and Cancelar link both stay.
      model.primary = more;
      model.secondary = [
        ...(single.url
          ? [
              {
                label: 'Copiar link',
                act: 'copy-link',
                icon: 'copy',
                id: single.id,
              },
            ]
          : []),
        { label: 'Cancelar link', act: 'cancel-link', id: single.id },
      ];
      model.quiet = outside;
      return model;
    }
    if (k.free < LINK_MIN_CENTS) {
      if (single)
        model.body.push(
          ...recvP,
          para([
            `Link ${KIND[single.kind].of} de `,
            strong(money(single.amountCents)),
            ` enviado na conversa · ${sentPhrase(single)}. O cliente ainda não clicou em Pagar.`,
          ]),
          para(
            [
              'Todo o valor que falta está neste link. Se o cliente pagou de outro jeito, registre o pagamento: o mesmo passo cancela o link.',
            ],
            'muted',
          ),
        );
      else
        model.body.push(
          ...recvP,
          para([
            'Todo o valor que falta, ',
            strong(money(k.reserved)),
            `, está em ${W.length} links que aguardam o cliente.`,
          ]),
          para(
            [
              'Se o cliente pagou de outro jeito, registre o pagamento: o mesmo passo cancela os links necessários.',
            ],
            'muted',
          ),
        );
      model.primary = external;
      model.secondary = single
        ? [
            ...(single.url
              ? [
                  {
                    label: 'Copiar link',
                    act: 'copy-link',
                    icon: 'copy',
                    id: single.id,
                  },
                ]
              : []),
            { label: 'Cancelar link', act: 'cancel-link', id: single.id },
          ]
        : [];
      return model;
    }
    const waitText = single
      ? [
          `${ucfirst(KIND[single.kind].art)} ${KIND[single.kind].noun} de `,
          strong(money(single.amountCents)),
          ` aguarda o cliente desde ${fDMT(single.sentAt ?? single.createdAt)}.`,
        ]
      : [
          `${W.length} links aguardam o cliente, somando `,
          strong(money(k.reserved)),
          '.',
        ];
    model.body.push(
      ...recvP,
      para([...waitText, ' Livre para cobrar ', strong(money(k.free)), '.']),
    );
    model.primary = anotherLink(k, conv);
    model.secondary = [external];
    return model;
  }
  if (k.total > 0 && k.remaining <= 0) {
    const paidL = v.links.filter(
      (/** @type {Link} */ l) =>
        l.status === 'paid' && l.refundedCents < l.amountCents,
    );
    const recs = v.receipts.filter((/** @type {Receipt} */ r) => !r.reversed);
    const n = paidL.length + recs.length;
    const lastAt =
      v.billing?.settledAt ??
      [
        ...paidL.map((/** @type {Link} */ l) => l.paidAt),
        ...recs.map((/** @type {Receipt} */ r) =>
          r.receivedOn ? `${r.receivedOn}T15:00:00Z` : r.recordedAt,
        ),
      ]
        .filter(Boolean)
        .sort((a, b) => byInstant(b, a))[0];
    model.tone = 'success';
    model.title = 'Tudo recebido';
    model.body.push(
      para([
        `Pedido quitado${lastAt ? ` em ${fDM(lastAt)}` : ''}: ${n === 1 ? `1 recebimento de ${money(k.received)}` : `${n} recebimentos somam ${money(k.received)}`}.`,
      ]),
    );
    return model;
  }
  if (k.received > 0) {
    const nc = nextCharge(v);
    const items = lastReceived(v.links, v.receipts);
    const last = items[items.length - 1];
    const sentence =
      items.length === 1 && last.kind === 'signal'
        ? `${last.text} Falta o saldo.`
        : `${receivedSentence(v.links, v.receipts, k)} Falta receber ${money(k.remaining)}.`;
    const small = nc.amountCents < LINK_MIN_CENTS;
    const label = conv
      ? `Enviar link do saldo de ${money(nc.amountCents)} na conversa`
      : `Gerar link do saldo de ${money(nc.amountCents)}`;
    model.body.push(para([sentence]));
    if (!small)
      model.body.push(
        para(
          [
            'Se combinar em partes, mude o valor no envio: cada link reserva só a parte dele.',
          ],
          'muted',
        ),
      );
    model.primary = small
      ? {
          label,
          act: 'send-amount',
          disabled:
            'O saldo é menor que R$ 1,00, o mínimo de um link. Registre-o como pagamento por fora.',
        }
      : { label, act: 'send-amount' };
    model.secondary = [external];
    return model;
  }
  if (v.condition === null) {
    const pick = ctx.pick ?? 50;
    const nc = nextCharge(v, pick);
    model.body.push(para(['Combine a condição com o cliente.']));
    model.terms = termsPicker(k, [0, 50, 100], pick);
    if (pick === 0)
      model.after.push(
        para(
          ['Nenhum link é gerado. Você cobra o valor integral quando quiser.'],
          'muted',
        ),
      );
    model.primary =
      pick === 0
        ? { label: 'Salvar sem entrada', act: 'save-zero' }
        : conv
          ? {
              label: `Enviar link de ${money(nc.amountCents)} na conversa`,
              act: 'send',
            }
          : {
              label: `Gerar link de ${money(nc.amountCents)}`,
              act: 'generate',
            };
    model.secondary =
      conv && pick !== 0 ? [{ label: 'Só gerar o link', act: 'generate' }] : [];
    return model;
  }
  if (v.condition === 0) {
    model.body.push(
      para([
        'Sem entrada combinada. Nenhum link foi gerado: você cobra o valor integral quando quiser.',
      ]),
    );
    model.secondary = [
      conv
        ? { label: `Enviar link de ${money(k.free)} na conversa`, act: 'send' }
        : { label: `Gerar link de ${money(k.free)}`, act: 'generate' },
      external,
    ];
    if (!v.links.length && !v.receipts.length)
      model.quiet = {
        q: 'Combinou outra condição?',
        label: 'Mudar condição',
        act: 'change-terms',
      };
    return model;
  }
  const nc = nextCharge(v);
  model.body.push(
    para([
      `Condição do pedido: ${TERMS[/** @type {0|50|100} */ (v.condition)].text}. Envie o link ${KIND[nc.kind].of} de `,
      strong(money(nc.amountCents)),
      '.',
    ]),
  );
  model.primary = conv
    ? {
        label: `Enviar link de ${money(nc.amountCents)} na conversa`,
        act: 'send',
      }
    : { label: `Gerar link de ${money(nc.amountCents)}`, act: 'generate' };
  model.secondary = [
    ...(conv ? [{ label: 'Só gerar o link', act: 'generate' }] : []),
    external,
  ];
  return model;
}

/**
 * "Enviar outro link de até R$ X" ("Gerar" without a conversation): any
 * amount from R$ 1,00 up to the free amount; null below the minimum.
 * @param {Figures} k @param {boolean} conv @returns {Action|null}
 */
function anotherLink(k, conv) {
  return k.free >= LINK_MIN_CENTS
    ? {
        label: `${conv ? 'Enviar' : 'Gerar'} outro link de até ${money(k.free)}`,
        act: 'send-another',
      }
    : null;
}

/** The condition cards: "0% · Sem entrada" and what is charged now and later. */
export function termsPicker(
  /** @type {Figures} */ k,
  /** @type {Array<0|50|100>} */ options,
  /** @type {0|50|100} */ pick,
) {
  /** @param {number} value */
  const now = (value) =>
    value === 0 ? 0 : value === 50 ? Math.round(k.total / 2) : k.total;
  return {
    pick,
    cards: options.map((value) => ({
      value,
      title: TERMS[value].title,
      detail:
        value === 100
          ? `${money(now(value))} agora`
          : `${money(now(value))} agora · ${money(k.total - now(value))} depois`,
    })),
    now: now(pick),
    later: k.total - now(pick),
  };
}

/**
 * Registrar pagamento por fora: accepts up to the free amount; if the value
 * needs money reserved in links the customer has not clicked, those links are
 * cancelled in the same step. A link Em pagamento (or Resultado a conferir)
 * refuses.
 *
 * @param {number|null} value cents
 * @param {{figures: Figures, groups: {waiting: Link[], paying: Link[], unknown: Link[]}}} view
 * @returns {{ok: boolean, cancel: Link[], refuse: string}}
 */
export function outsidePlan(value, view) {
  const k = view.figures;
  if (
    value === null ||
    Number.isNaN(value) ||
    value <= 0 ||
    value > k.remaining
  )
    return { ok: false, cancel: [], refuse: '' };
  if (value <= k.free) return { ok: true, cancel: [], refuse: '' };
  const need = value - k.free;
  const waiting = view.groups.waiting;
  const one = [...waiting]
    .sort((a, b) => a.amountCents - b.amountCents)
    .find((l) => l.amountCents >= need);
  /** @type {Link[]|null} */
  let cancel = one ? [one] : [];
  if (!one) {
    let sum = 0;
    for (const l of [...waiting].reverse()) {
      if (sum >= need) break;
      cancel.push(l);
      sum += l.amountCents;
    }
    if (sum < need) cancel = null;
  }
  if (cancel) return { ok: true, cancel, refuse: '' };
  const p = view.groups.paying[0];
  const u = view.groups.unknown[0];
  return {
    ok: false,
    cancel: [],
    refuse: p
      ? `${ucfirst(linkName(p))} (${money(p.amountCents)}) está Em pagamento. O cliente está pagando este link na InfinitePay. Aguarde ou verifique o pagamento.`
      : u
        ? `${ucfirst(linkName(u))} está em Resultado a conferir. Confirme o resultado antes de registrar.`
        : 'Este valor usa dinheiro reservado em links abertos.',
  };
}

/** The review line of "Registrar pagamento por fora". */
export function outsideReview(
  /** @type {number|null} */ value,
  /** @type {ReturnType<typeof outsidePlan>} */ plan,
  /** @type {Figures} */ k,
) {
  if (!plan.ok || value === null || Number.isNaN(value))
    return [
      'Recebido hoje ',
      strong(money(k.received)),
      ' · falta ',
      strong(money(k.remaining)),
    ];
  const rem = k.remaining - value;
  /** @type {Array<string|{strong: string}>} */
  const parts = [];
  for (const l of plan.cancel)
    parts.push(`${ucfirst(linkName(l))}: `, strong('cancelado'), ' · ');
  parts.push('Recebido passa a ', strong(money(k.received + value)), ' · ');
  if (rem <= 0) parts.push(strong('Quitado'));
  else parts.push('falta ', strong(money(rem)));
  return parts;
}

/** "Cancelar o link do saldo e registrar R$ 2.400,00". */
export function outsidePrimary(
  /** @type {number|null} */ value,
  /** @type {ReturnType<typeof outsidePlan>} */ plan,
) {
  if (plan.ok && value !== null && plan.cancel.length) {
    const names =
      plan.cancel.length === 1
        ? `o ${linkName(plan.cancel[0])}`
        : `${plan.cancel.length} links`;
    return `Cancelar ${names} e registrar ${money(value)}`;
  }
  return plan.ok && value !== null
    ? `Registrar ${money(value)}`
    : 'Registrar pagamento';
}

/** What cancelling a link frees. @param {Link} l @param {Figures} k */
export function cancelReview(l, k) {
  return {
    // "Em links abertos passa a": a link A conferir is not open.
    reserved: Math.max(0, k.opened - l.amountCents),
    free: Math.min(k.remaining, k.free + l.amountCents),
  };
}

/**
 * Resolver conferência, step 2: apply the payments, or cancel the links the
 * customer has not clicked (unavailable, with its reason, while a link is Em
 * pagamento).
 *
 * @param {BillingView} v
 */
export function reconcileOptions(v) {
  const k = v.figures;
  const unclicked = v.groups.waiting;
  const paying = v.groups.paying[0] ?? null;
  const net = k.received + k.held;
  // Every reserving link (Aguardando o cliente, Em pagamento, Resultado a
  // conferir) counts too: the API refuses with BILLING_LINK_EXCEEDS_FREE.
  const linked = net + v.groups.open.reduce((s, l) => s + l.amountCents, 0);
  const applyOk = linked <= k.total;
  const cancelOk = !paying && unclicked.length > 0;
  const heldL = v.groups.review[0] ?? null;
  const sum = unclicked.reduce((s, l) => s + l.amountCents, 0);
  const keep = heldL
    ? ` ${ucfirst(KIND[heldL.kind].art)} ${KIND[heldL.kind].noun} de ${money(k.held)} continua fora do recebido e a conferência continua.`
    : '';
  return {
    apply: {
      ok: applyOk,
      title: 'Aplicar os pagamentos ao valor atual',
      detail: `Recebido passa a ${money(Math.min(net, k.total))} · falta ${money(Math.max(0, k.total - net))}`,
      reason:
        net > k.total
          ? `Os pagamentos somam ${money(net)}, mais que o total de ${money(k.total)}.`
          : `Os pagamentos e os links abertos somam ${money(linked)}, mais que o total de ${money(k.total)}. Cancele links que o cliente ainda não clicou antes de aplicar.`,
    },
    cancel: {
      ok: cancelOk,
      title: 'Cancelar links que o cliente ainda não clicou',
      detail: unclicked.length
        ? `Cancela ${unclicked.length === 1 ? `o ${linkName(unclicked[0])} (${money(sum)})` : `${unclicked.length} links (${money(sum)})`}. Em links abertos passa a ${money(Math.max(0, k.opened - sum))}.${keep}`
        : `Nenhum link para cancelar.${keep}`,
      reason: paying
        ? `O cliente está pagando o ${linkName(paying)} na InfinitePay (aberto às ${fT(paying.clickedAt)}).`
        : 'Não há link que o cliente ainda não clicou.',
    },
    paying,
    initial: !applyOk && cancelOk ? 'cancel' : 'apply',
  };
}

/** Flash after a send or a generated link. */
export function sendFlash(
  /** @type {'send'|'generate'} */ mode,
  /** @type {Kind} */ kind,
  /** @type {unknown} */ deliveredAt,
) {
  const of = KIND[kind].of;
  if (mode === 'generate')
    return `Link ${of} gerado. Ele ainda não foi enviado ao cliente.`;
  return deliveredAt
    ? `Link ${of} enviado na conversa e entregue às ${fT(deliveredAt)}. Você pode cancelá-lo enquanto o cliente não clicar em Pagar.`
    : `Link ${of} enviado na conversa. Você pode cancelá-lo enquanto o cliente não clicar em Pagar.`;
}

/** "Recebido R$ 2.400,00 de R$ 4.800,00 · 50%" in plain text (rail, Inbox). @param {Figures} k */
export function progressText(k) {
  return `Recebido ${money(k.received)} de ${money(k.total)} · ${k.pct}%`;
}

export {
  fT as timeOf,
  fDMT as dayMonthTimeOf,
  fDT as dateTimeOf,
  dateBR as dateOf,
};
