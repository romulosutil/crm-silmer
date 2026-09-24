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
 * The order date is stored as an ISO day in Sao Paulo time; the approved
 * template shows it the way the shop floor reads it.
 *
 * @param {unknown} value
 */
function printedDate(value) {
  const text = printedText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : text;
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
      data_entrega_confirmada: printedText(summary.data_entrega_confirmada),
      fab: printedText(order.fabCode),
      itens: templateVersion === TEMPLATE_V3 ? items.map(printableItem) : items,
      nome: printedText(summary.nome),
      numero: printedText(order.number),
      observacoes: observations,
      quantidade_total: order.totalPieces,
      vendedor: printedText(order.confirmedBy?.name),
    },
    producao: blankProduction(),
  };
}
