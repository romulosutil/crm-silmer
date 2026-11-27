import { OrderValidationError } from './errors.js';

export const ORDER_ITEM_OPTIONS = {
  color: [
    'Amarelo',
    'Azul',
    'Azul royal',
    'Azul turquesa',
    'Branco',
    'Chumbo',
    'Cinza claro',
    'Cinza prata',
    'Colorido',
    'Mescla claro',
    'Preto',
    'Rosa',
    'Roxo',
    'Verde',
    'Verde bandeira',
    'Verde claro',
    'Verde musgo',
    'Vermelho',
  ],
  fabric: [
    'Algodão',
    'All Star',
    'Dry Fit',
    'Oxford',
    'Piquet',
    'Poliéster',
    'Poliéster com elastano',
    'PV',
    'Tactel',
    'Tactel com elastano',
  ],
  size: [
    'PP',
    'P',
    'M',
    'G',
    'GG',
    'EG',
    'XG',
    'XX',
    'Jegão',
    'Único',
    'PP infantil',
    'P infantil',
    'M infantil',
    'G infantil',
    'GG infantil',
  ],
};

/** @type {Record<'color'|'fabric', Record<string, string>>} */
export const ORDER_ITEM_OPTION_ALIASES = {
  color: {
    branca: 'Branco',
    preta: 'Preto',
    amarela: 'Amarelo',
    vermelha: 'Vermelho',
    roxa: 'Roxo',
    colorida: 'Colorido',
    royal: 'Azul royal',
    turquesa: 'Azul turquesa',
  },
  fabric: {
    allstar: 'All Star',
    'all star corrida': 'All Star',
    'allstar corrida': 'All Star',
    dryfit: 'Dry Fit',
    'poliester 100%': 'Poliéster',
    '100% poliester': 'Poliéster',
    'tactel c/ elastano': 'Tactel com elastano',
  },
};

/**
 * @param {string} value
 */
export function orderItemOptionKey(value) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/[-\s]+/gu, ' ')
    .toLowerCase();
}

/**
 * @param {unknown} kind @param {unknown} raw
 * @returns {{kind:'color'|'fabric'|'size', key:string, label:string, official:boolean}}
 */
export function parseOrderItemOption(kind, raw) {
  const invalid = () =>
    new OrderValidationError(
      'An operational option name is required',
      'ORDER_ITEM_OPTION_INVALID',
      ['label'],
    );
  if (kind !== 'color' && kind !== 'fabric' && kind !== 'size') throw invalid();
  if (typeof raw !== 'string' || raw.length > 80 || /[\p{Cc}\p{Cf}]/u.test(raw))
    throw invalid();
  const label = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const key = orderItemOptionKey(label);
  if (
    !key ||
    !/[\p{L}\p{N}]/u.test(label) ||
    !/^[\p{L}\p{M}0-9 ./,%()+&'-]+$/u.test(label) ||
    /(?:[0-9][ .()-]*){8}/u.test(label) ||
    key === 'nao aplicavel' ||
    (kind === 'size' && /[,+]/u.test(label))
  )
    throw invalid();
  const names = kind === 'size' ? undefined : ORDER_ITEM_OPTION_ALIASES[kind];
  const alias = names && Object.hasOwn(names, key) ? names[key] : undefined;
  const official =
    alias ??
    ORDER_ITEM_OPTIONS[kind].find(
      (option) => orderItemOptionKey(option) === key,
    );
  return {
    kind,
    key: official ? orderItemOptionKey(official) : key,
    label: official ?? label,
    official: Boolean(official),
  };
}
