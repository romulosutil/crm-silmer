import { describeItem, scaleById } from '../catalog/index.js';
import { itemTotal } from '../domain/ficha.js';
import { blankProduction } from './ficha-canonical-v2.js';

export const TEMPLATE_V2 = 'ficha-canonical-v2';
export const TEMPLATE_V3 = 'ficha-canonical-v3';

/** A field nobody filled prints blank, never "null". @param {unknown} value */
function printedText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * The order date and the other days of the order are stored as ISO days;
 * the approved template shows them the way the shop floor reads them
 * (dd/mm/aaaa, as in the approved sample). Older free text prints as typed.
 *
 * @param {unknown} value
 */
function printedDate(value) {
  const text = printedText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : text;
}

// D00.6-05: an instant prints as its São Paulo day.
const OPERATIONAL_DAY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
});

/** @param {unknown} value */
function printedInstantDay(value) {
  if (typeof value !== 'string' || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : OPERATIONAL_DAY.format(date);
}

/**
 * PLA-08 (ADR 008): the five days of the order, in the order they happen. A
 * day nobody recorded yet prints blank, so it can be written in by hand.
 *
 * @param {any} order
 */
function printedTrail(order) {
  return {
    entrega_prometida: printedDate(order.ficha.summary.data_entrega_confirmada),
    entrega_realizada: printedDate(order.deliveredOn),
    pagamento: printedDate(order.paidOn),
    pedido_fechado: printedDate(order.orderDate),
    primeiro_contato: printedInstantDay(order.firstContactAt),
  };
}

/** @param {string | string[]} value */
function joined(value) {
  return Array.isArray(value) ? value.join(' / ') : value;
}

/**
 * FIM-01..05: the item as the v3 sheet prints it — only the fields the product
 * has and someone filled, under the product's own labels.
 *
 * @param {Record<string, any>} item
 */
export function printableItem(item) {
  const filled = describeItem(item).cells.filter((cell) => !cell.empty);
  /** @param {'header'|'grid'|'wide'} placement */
  const placed = (placement) =>
    filled.filter((cell) => cell.field.placement === placement);
  const scale = scaleById(String(item.escala ?? ''));
  const outras = printedText(item.outras).trim();
  return {
    tipo: printedText(item.tipo),
    subtitulo: placed('header')
      .map((cell) => joined(cell.value))
      .join(' · '),
    especificacoes: placed('grid').map((cell) => ({
      rotulo: cell.field.label,
      valor: joined(cell.value),
    })),
    linhas: [
      ...placed('wide').map((cell) => ({
        rotulo: cell.field.label,
        valor: joined(cell.value),
      })),
      ...(outras ? [{ rotulo: 'Outras especificações', valor: outras }] : []),
    ],
    gradeTitulo:
      scale && scale.id !== 'adulto' ? `Grade · ${scale.label}` : 'Grade',
    grade: item.grade,
    total: itemTotal(/** @type {any} */ (item)),
  };
}

/**
 * The printed snapshot built from the order (D10). `vendedor` is whoever
 * confirmed it and `data` is the order date: both are frozen at confirmation,
 * so passing the conversation on afterwards never rewrites the paper. The
 * final amount and the payment condition stay out of the document (D12), and
 * the production block reaches the shop floor blank.
 *
 * @param {any} order
 * @param {string} [templateVersion]
 */
export function printSnapshot(order, templateVersion = TEMPLATE_V2) {
  const { items, observations, summary } = order.ficha;
  return {
    pedido: {
      aplicacao: printedText(summary.aplicacao),
      cliente: printedText(summary.cliente),
      data: printedDate(order.orderDate),
      data_entrega_confirmada: printedDate(summary.data_entrega_confirmada),
      fab: printedText(order.fabCode),
      itens: templateVersion === TEMPLATE_V3 ? items.map(printableItem) : items,
      lastro: printedTrail(order),
      nome: printedText(summary.nome),
      numero: printedText(order.number),
      observacoes: observations,
      quantidade_total: order.totalPieces,
      vendedor: printedText(order.confirmedBy?.name),
    },
    producao: blankProduction(),
  };
}
