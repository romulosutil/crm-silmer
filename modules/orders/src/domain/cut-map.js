import { AUDIENCES } from './audiences.js';
import { OrderConflictError, OrderValidationError } from './errors.js';

export const PRODUCTION_STAGES = /** @type {const} */ ([
  'arte',
  'producao',
  'pronto',
]);
export const PRODUCTION_FILTERS = /** @type {const} */ ([
  'all',
  'cut',
  ...PRODUCTION_STAGES,
  'late',
  'risk',
]);
const SIZE_ORDER = [
  'PP',
  'P',
  'M',
  'G',
  'GG',
  'XG',
  'XGG',
  'EG',
  'EGG',
  'XX',
  'JEGÃO',
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
];
const sorter = new Intl.Collator('pt-BR', { numeric: true });

/** @param {import('./order.js').Order} order */
export function isOpenProductionOrder(order) {
  return (
    order.origin === 'atendimento' &&
    order.status === 'confirmado' &&
    !order.isTest &&
    !order.deliveredOn &&
    !order.cancelledAt
  );
}

/** @param {import('./order.js').Order} order */
export function isCutMapOrder(order) {
  return (
    isOpenProductionOrder(order) &&
    ['arte', 'producao'].includes(order.productionStage ?? '')
  );
}

/** @param {unknown} value */
const cleaned = (value) =>
  typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/gu, ' ')
    : '';
/** @param {string} value */
const comparable = (value) => value.toLocaleLowerCase('pt-BR');
/** @param {string} value */
const sizeRank = (value) =>
  SIZE_ORDER.indexOf(value) < 0 ? SIZE_ORDER.length : SIZE_ORDER.indexOf(value);

/**
 * @typedef {{ id: string, number: string, version: number }} CutOrderReference
 * @typedef {{model: string, color: string, audience: typeof AUDIENCES[number], fabrics: string[], details: {label: string, value: string}[], orders: string[], grade: {size: string, quantity: number}[], total: number}} CutLot
 * @typedef {{orders: CutOrderReference[], groups: CutLot[], total: number}} CutMap
 */

/** @param {import('./ficha.js').FichaItem} item */
function specifications(item) {
  return [
    ['Frente', item.cor_frente],
    ['Costas', item.cor_costas],
    ['Manga direita', item.cor_manga_direita],
    ['Manga esquerda', item.cor_manga_esquerda],
    ['Modelo de malha', item.modelo],
    ['Gola', item.gola || item.vies_gola],
    ['Viés da gola', item.vies_gola],
    ['Viés das mangas', item.vies_mangas],
  ]
    .map(([label, value]) => ({ label, value: cleaned(value) }))
    .filter(({ value }) => value);
}

/** @param {import('./order.js').Order[]} input @returns {CutMap} */
export function projectCutMap(input) {
  const orders = [
    ...new Map(input.map((order) => [order.id, order])).values(),
  ].sort((a, b) => a.numberSequence - b.numberSequence);
  /** @type {Map<string, CutLot>} */
  const groups = new Map();
  let total = 0;
  for (const order of orders) {
    if (!isCutMapOrder(order))
      throw new OrderConflictError(
        'Pedido fora da fila de corte',
        'CUT_MAP_NOT_ELIGIBLE',
      );
    let orderTotal = 0;
    const items = Array.isArray(order.ficha?.items) ? order.ficha.items : [];
    for (const [index, item] of items.entries()) {
      const model = cleaned(item.tipo);
      const color = cleaned(item.cor);
      const audience = AUDIENCES.find(
        (value) => value === comparable(cleaned(item.publico)),
      );
      const fabrics = [
        ...new Map(
          (Array.isArray(item.malhas) ? item.malhas : [])
            .map(cleaned)
            .filter(Boolean)
            .map((value) => [comparable(value), value]),
        ).values(),
      ].sort((a, b) => sorter.compare(comparable(a), comparable(b)));
      const details = specifications(item);
      const grade = Array.isArray(item.grade) ? item.grade : [];
      const fields = [
        ...(!model ? ['tipo'] : []),
        ...(!color ? ['cor'] : []),
        ...(!audience ? ['publico'] : []),
        ...(!fabrics.length ? ['malhas'] : []),
        ...(!grade.length ||
        grade.some(
          (line) =>
            !cleaned(line?.tamanho) ||
            !Number.isSafeInteger(line.quantidade) ||
            line.quantidade <= 0,
        )
          ? ['grade']
          : []),
      ];
      if (!audience || fields.length) {
        throw Object.assign(
          new OrderValidationError(
            'Revise o item antes do corte',
            'CUT_MAP_INCOMPLETE',
            fields,
            { itemIndex: index },
          ),
          { orderId: order.id, orderNumber: order.number },
        );
      }
      const key = JSON.stringify([
        comparable(model),
        comparable(color),
        audience,
        fabrics.map(comparable),
        details.map(({ label, value }) => [label, comparable(value)]),
      ]);
      let group = groups.get(key);
      if (!group) {
        group = {
          model,
          color,
          audience,
          fabrics,
          details,
          orders: [],
          grade: [],
          total: 0,
        };
        groups.set(key, group);
      }
      if (group.orders.at(-1) !== order.number) group.orders.push(order.number);
      for (const line of grade) {
        const size = cleaned(line.tamanho).toLocaleUpperCase('pt-BR');
        const existing = group.grade.find((entry) => entry.size === size);
        if (existing) existing.quantity += line.quantidade;
        else group.grade.push({ size, quantity: line.quantidade });
        group.total += line.quantidade;
        orderTotal += line.quantidade;
      }
    }
    // Covers empty or corrupt legacy snapshots even when they reached confirmation.
    if (!orderTotal || orderTotal !== order.totalPieces)
      throw Object.assign(
        new OrderValidationError(
          'A grade não fecha com o total do pedido',
          'CUT_MAP_INCOMPLETE',
          ['grade'],
        ),
        { orderId: order.id, orderNumber: order.number },
      );
    total += orderTotal;
    if (!Number.isSafeInteger(total))
      throw new OrderValidationError(
        'Total de corte inválido',
        'CUT_MAP_INCOMPLETE',
      );
  }
  for (const group of groups.values()) {
    group.grade.sort(
      (a, b) =>
        sizeRank(a.size) - sizeRank(b.size) || sorter.compare(a.size, b.size),
    );
  }
  return {
    orders: orders.map(({ id, number, version }) => ({ id, number, version })),
    groups: [...groups.values()].sort(
      (a, b) =>
        sorter.compare(a.model, b.model) ||
        sorter.compare(a.color, b.color) ||
        sorter.compare(a.audience, b.audience),
    ),
    total,
  };
}
