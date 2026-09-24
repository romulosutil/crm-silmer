import { FIELDS } from './order-catalog.js';

/**
 * Reading and writing an order in the browser (ADR 006). The amount rules
 * mirror `modules/orders/src/domain/money.js` on purpose: edge-web ships no
 * runtime dependencies, so the seller gets the error next to the field before
 * the request instead of a round trip. The server stays the authority — it
 * parses the text again and answers 422 INVALID_AMOUNT when the two disagree.
 */

// PFI-11: thousands in groups of three separated by dots, cents after a
// comma. "4,820.00" is a different number, so it is refused, never guessed.
const BRL_AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}|\d))?$/u;

const ORDER_STATUS_LABELS = Object.freeze({
  confirmado: 'Confirmado',
  pendente: 'Pendente',
});

export const PAYMENT_CONDITION_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Pix', value: 'pix' }),
  Object.freeze({ label: 'Cartão de crédito', value: 'cartao_credito' }),
  Object.freeze({ label: 'Cartão de débito', value: 'cartao_debito' }),
]);

/** A03: every `reason_code` the CHECK of migration 0013 accepts. */
export const HANDOFF_REASON_LABELS = Object.freeze({
  briefing_complete: 'Pré-ficha completa',
  complaint: 'Reclamação',
  customer_requested_human: 'Pediu um vendedor',
  human_requested: 'Pediu um vendedor',
  low_confidence: 'Agente sem confiança',
  negotiation: 'Perguntou o valor',
  price_before_quote: 'Perguntou o valor',
  unresolved_blocker: 'Dado divergente',
  unsupported: 'Conteúdo não suportado',
  urgency: 'Urgência',
});

/**
 * The FAB as the ficha prints it. Codes arrive either bare ("01") or already
 * prefixed ("FAB 01"); both read "FAB 01".
 *
 * @param {unknown} code
 */
export function fabLabel(code) {
  const text = String(code ?? '').trim();
  if (text === '') return '—';
  return /^fab(?:\s|$)/iu.test(text) ? text.toUpperCase() : `FAB ${text}`;
}

/** PIM-01: why the button is locked, said in the place of the button. */
export const PRINT_LOCKED_REASON = 'Disponível depois de gerar o pedido';

const SUMMARY_LABELS = Object.freeze({
  aplicacao: 'aplicação',
  cliente: 'cliente',
  data_entrega_confirmada: 'entrega confirmada',
  nome: 'evento/nome',
});

const ITEM_LABELS = Object.freeze({
  cor_costas: 'cor das costas',
  cor_frente: 'cor da frente',
  cor_manga_direita: 'cor da manga direita',
  cor_manga_esquerda: 'cor da manga esquerda',
  grade: 'grade',
  malhas: 'malhas',
  modelo: 'modelagem',
  tipo: 'tipo',
  vies_gola: 'viés da gola',
  vies_mangas: 'viés das mangas',
});

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** @param {unknown} status */
export function orderStatusLabel(status) {
  return (
    ORDER_STATUS_LABELS[
      /** @type {keyof typeof ORDER_STATUS_LABELS} */ (status)
    ] ?? 'Sem pedido'
  );
}

/** @param {unknown} condition */
export function paymentConditionLabel(condition) {
  return (
    PAYMENT_CONDITION_OPTIONS.find((option) => option.value === condition)
      ?.label ?? '—'
  );
}

/** @param {unknown} reasonCode */
export function handoffReasonLabel(reasonCode) {
  return (
    HANDOFF_REASON_LABELS[
      /** @type {keyof typeof HANDOFF_REASON_LABELS} */ (reasonCode)
    ] ?? 'Aguardando vendedor'
  );
}

/**
 * @param {unknown} text
 * @returns {number|null} integer cents > 0, or null when the text is not an
 *   amount this operation can charge.
 */
export function parseBrl(text) {
  if (typeof text !== 'string') return null;
  const match = BRL_AMOUNT.exec(text.trim());
  if (!match) return null;
  const reais = Number(match[1].replaceAll('.', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/** @param {unknown} cents @returns {string} e.g. `4.820,00`, or '' when unset */
export function formatBrl(cents) {
  if (!Number.isSafeInteger(cents) || Number(cents) <= 0) return '';
  const value = Number(cents);
  const reais = Math.trunc(value / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${reais},${String(value % 100).padStart(2, '0')}`;
}

/** PFI-11: the prefix is fixed; an order with no amount yet shows a dash. */
/** @param {unknown} cents */
export function amountLabel(cents) {
  const formatted = formatBrl(cents);
  return formatted === '' ? '—' : `R$ ${formatted}`;
}

/**
 * PFI-09: `missingFields` as the banner reads it. An entry this screen does
 * not know is shown as it is, so a field added to the ficha appears as a raw
 * name instead of disappearing from the list.
 *
 * @param {unknown} missingFields
 * @returns {string[]}
 */
export function missingFieldLabels(missingFields) {
  if (!Array.isArray(missingFields)) return [];
  return missingFields.map((field) => missingFieldLabel(String(field)));
}

/** @param {string} field */
function missingFieldLabel(field) {
  if (field === 'items') return 'nenhum item com grade';
  if (field === 'finalAmount') return 'valor final';
  if (field === 'paymentCondition') return 'condição de pagamento';
  const summary = /^summary\.(\w+)$/u.exec(field);
  if (summary) {
    return (
      SUMMARY_LABELS[/** @type {keyof typeof SUMMARY_LABELS} */ (summary[1])] ??
      field
    );
  }
  const item = /^items\[(\d+)\]\.([\w.]+)$/u.exec(field);
  if (item) {
    const known =
      ITEM_LABELS[/** @type {keyof typeof ITEM_LABELS} */ (item[2])] ??
      FIELDS.find((entry) => entry.path === item[2])?.label.toLocaleLowerCase(
        'pt-BR',
      );
    return `item ${Number(item[1]) + 1}: ${known ?? item[2]}`;
  }
  return field;
}

/**
 * PLI-05: one line for the Situação column. Blockers come first — they are
 * what keeps "Confirmar pedido" out of reach — and an empty ficha field is
 * named only when nothing blocks.
 *
 * @param {unknown} missingFields
 */
export function missingHeadline(missingFields) {
  const missing = Array.isArray(missingFields) ? missingFields.map(String) : [];
  if (missing.length === 0) return 'Pronto para confirmar';
  if (missing.includes('items')) return 'Nenhum item';
  const amount = missing.includes('finalAmount');
  const condition = missing.includes('paymentCondition');
  if (amount && condition) return 'Falta valor e condição';
  if (amount) return 'Falta o valor final';
  if (condition) return 'Falta a condição de pagamento';
  return `Falta ${missingFieldLabel(missing[0])}`;
}

/**
 * A02: how long the order has been still, counted from its last change. A
 * clock slightly ahead of the browser reads as "agora" rather than as a
 * negative age.
 *
 * @param {unknown} since @param {Date} [now]
 */
export function elapsedSince(since, now = new Date()) {
  if (typeof since !== 'string' || since === '') return '';
  const start = new Date(since);
  if (Number.isNaN(start.getTime())) return '';
  const elapsed = now.getTime() - start.getTime();
  if (elapsed < MINUTE_MS) return 'agora';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}min`;
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  const hours = Math.floor((elapsed % DAY_MS) / HOUR_MS);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}
