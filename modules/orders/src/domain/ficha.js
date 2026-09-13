import { OrderInputError, OrderValidationError } from './errors.js';

// The ficha mirrors the approved `ficha-canonical-v2` blocks (D10): summary,
// items with their grade, and up to five observation lines. Anything the agent
// collected that has no place on the printed document stays as service data
// (D11): shown read-only, never printed.

export const NOT_APPLICABLE = 'NAO APLICAVEL';
export const MAX_OBSERVATIONS = 5;
const MAX_ITEMS = 50;
const MAX_TEXT = 200;

const SUMMARY_INPUT_KEYS = Object.freeze([
  'data_entrega_confirmada',
  'aplicacao',
  'nome',
]);
const ITEM_TEXT_KEYS = Object.freeze([
  'tipo',
  'modelo',
  'cor_frente',
  'cor_costas',
  'cor_manga_direita',
  'cor_manga_esquerda',
  'vies_gola',
  'vies_mangas',
]);
const ITEM_KEYS = new Set([...ITEM_TEXT_KEYS, 'malhas', 'grade']);
const GRADE_KEYS = new Set(['tamanho', 'quantidade']);

// Workflow bookkeeping, not facts about the order.
const BRIEFING_INTERNAL_KEYS = new Set([
  'briefing_status',
  'next_required_field',
]);

/**
 * @typedef {{tamanho: string, quantidade: number}} GradeLine
 * @typedef {{
 *   tipo: string, modelo: string, malhas: string[],
 *   cor_frente: string, cor_costas: string,
 *   cor_manga_direita: string, cor_manga_esquerda: string,
 *   vies_gola: string, vies_mangas: string,
 *   grade: GradeLine[],
 * }} FichaItem
 * @typedef {{
 *   data_entrega_confirmada: string|null, aplicacao: string|null, nome: string|null,
 * }} FichaSummaryInput
 * @typedef {FichaSummaryInput & {cliente: string}} FichaSummary
 * @typedef {{
 *   summary: FichaSummary, items: FichaItem[], observations: string[],
 *   serviceData: Record<string, unknown>,
 * }} Ficha
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** @param {unknown} value @param {string} field @returns {string} */
function requireText(value, field) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new OrderInputError(`${field} must be text`, [field]);
  }
  return value.trim();
}

/** @param {unknown} value @param {string} field @returns {string|null} */
function optionalText(value, field) {
  if (value === null) return null;
  const text = requireText(value, field);
  return text === '' ? null : text;
}

/** @param {Record<string, unknown>} input @param {Set<string>} allowed @param {string} prefix */
function rejectUnknownKeys(input, allowed, prefix) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new OrderInputError(`${prefix}.${key} is not allowed`, [
        `${prefix}.${key}`,
      ]);
    }
  }
}

/**
 * The customer is locked to the conversation contact (D13), so it is never
 * accepted from the seller's section input.
 *
 * @param {unknown} input
 * @returns {FichaSummaryInput}
 */
export function validateSummary(input) {
  if (!isPlainObject(input)) {
    throw new OrderInputError('summary must be an object', ['summary']);
  }
  rejectUnknownKeys(input, new Set(SUMMARY_INPUT_KEYS), 'summary');
  /** @type {Record<string, string|null>} */
  const summary = {};
  for (const key of SUMMARY_INPUT_KEYS) {
    if (!Object.hasOwn(input, key)) {
      throw new OrderInputError(`summary.${key} is required`, [
        `summary.${key}`,
      ]);
    }
    summary[key] = optionalText(input[key], `summary.${key}`);
  }
  return /** @type {FichaSummaryInput} */ (summary);
}

/**
 * @param {unknown} input
 * @returns {FichaItem[]}
 */
export function validateItems(input) {
  if (!Array.isArray(input) || input.length > MAX_ITEMS) {
    throw new OrderInputError('items must be a list', ['items']);
  }
  return input.map((raw, itemIndex) => validateItem(raw, itemIndex));
}

/** @param {unknown} raw @param {number} itemIndex @returns {FichaItem} */
function validateItem(raw, itemIndex) {
  const prefix = `items[${itemIndex}]`;
  if (!isPlainObject(raw)) {
    throw new OrderInputError(`${prefix} must be an object`, [prefix]);
  }
  rejectUnknownKeys(raw, ITEM_KEYS, prefix);
  /** @type {Record<string, unknown>} */
  const item = {};
  for (const key of ITEM_TEXT_KEYS) {
    item[key] = requireText(raw[key], `${prefix}.${key}`);
  }

  const malhas = Array.isArray(raw.malhas)
    ? raw.malhas.map((value) => requireText(value, `${prefix}.malhas`))
    : null;
  if (!malhas || malhas.length === 0 || malhas.some((value) => value === '')) {
    throw new OrderInputError(`${prefix} needs at least one fabric`, [
      `${prefix}.malhas`,
    ]);
  }
  item.malhas = malhas;

  if (!Array.isArray(raw.grade) || raw.grade.length === 0) {
    throw new OrderValidationError(
      'Informe ao menos um tamanho com quantidade.',
      'INVALID_GRADE',
      [`${prefix}.grade`],
      { itemIndex },
    );
  }
  item.grade = raw.grade.map((line, index) => {
    const refuse = () =>
      new OrderValidationError(
        'Use uma quantidade inteira maior que zero.',
        'INVALID_GRADE',
        [`${prefix}.grade[${index}]`],
        { index, itemIndex },
      );
    if (!isPlainObject(line)) throw refuse();
    for (const key of Object.keys(line)) {
      if (!GRADE_KEYS.has(key)) throw refuse();
    }
    const { quantidade, tamanho } = line;
    if (
      typeof tamanho !== 'string' ||
      tamanho.trim() === '' ||
      tamanho.length > MAX_TEXT ||
      !Number.isSafeInteger(quantidade) ||
      /** @type {number} */ (quantidade) <= 0
    ) {
      throw refuse();
    }
    return {
      quantidade: /** @type {number} */ (quantidade),
      tamanho: tamanho.trim(),
    };
  });
  return /** @type {FichaItem} */ (item);
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
export function validateObservations(input) {
  if (!Array.isArray(input) || input.length > MAX_OBSERVATIONS) {
    throw new OrderInputError(
      `observations must be at most ${MAX_OBSERVATIONS} lines`,
      ['observations'],
    );
  }
  return input
    .map((line) => requireText(line, 'observations'))
    .filter((line) => line !== '');
}

/** @param {{grade: readonly GradeLine[]}} item */
export function itemTotal(item) {
  return item.grade.reduce((total, line) => total + line.quantidade, 0);
}

/** @param {readonly {grade: readonly GradeLine[]}[]} items */
export function orderTotal(items) {
  return items.reduce((total, item) => total + itemTotal(item), 0);
}

/** @param {unknown} value @returns {string|undefined} */
function briefingText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** @param {unknown} value @returns {string[]|undefined} */
function briefingList(value) {
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [value.trim()];
  }
  if (!Array.isArray(value)) return undefined;
  /** @type {string[]} */
  const texts = [];
  for (const entry of value) {
    const text = briefingText(entry);
    if (text === undefined) return undefined;
    if (text !== '') texts.push(text);
  }
  return texts;
}

/** @param {unknown} value @returns {GradeLine[]|undefined} */
function briefingGrade(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  /** @type {GradeLine[]} */
  const grade = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return undefined;
    const tamanho = briefingText(entry.tamanho ?? entry.size);
    const quantidade = entry.quantidade ?? entry.quantity;
    if (
      !tamanho ||
      !Number.isSafeInteger(quantidade) ||
      /** @type {number} */ (quantidade) <= 0
    ) {
      return undefined;
    }
    grade.push({ quantidade: /** @type {number} */ (quantidade), tamanho });
  }
  return grade;
}

/**
 * Maps the agent pre-ficha onto the printed sections without guessing: a fact
 * only lands in a ficha field when its shape leaves no doubt. Colours are not
 * split into front/back/sleeves and the desired date is not a confirmed
 * delivery, so both stay as service data for the seller to act on.
 *
 * @param {Record<string, unknown>|null|undefined} briefing
 * @returns {Ficha}
 */
export function briefingToFicha(briefing) {
  const source = isPlainObject(briefing) ? briefing : {};
  /** @type {Set<string>} */
  const consumed = new Set();
  /** @template T @param {string} key @param {(value: unknown) => T|undefined} read @returns {T|undefined} */
  const take = (key, read) => {
    if (source[key] === undefined || source[key] === null) {
      consumed.add(key);
      return undefined;
    }
    const value = read(source[key]);
    if (value !== undefined) consumed.add(key);
    return value;
  };

  const cliente = take('customer_name', briefingText) ?? '';
  const nome = take('order_name', briefingText) || null;
  const aplicacao = take('artwork_technique', briefingText) || null;
  const tipo = take('product_type', briefingText);
  const modelo = take('product_model', briefingText);
  const malhas = take('fabrics', briefingList);
  const grade = take('sizes', briefingGrade);

  const hasItem = ['product_type', 'product_model', 'fabrics', 'sizes'].some(
    (key) => source[key] !== undefined && source[key] !== null,
  );
  /** @type {FichaItem[]} */
  const items = hasItem
    ? [
        {
          cor_costas: '',
          cor_frente: '',
          cor_manga_direita: '',
          cor_manga_esquerda: '',
          grade: grade ?? [],
          malhas: malhas ?? [],
          modelo: modelo ?? '',
          tipo: tipo ?? '',
          vies_gola: '',
          vies_mangas: '',
        },
      ]
    : [];

  /** @type {Record<string, unknown>} */
  const serviceData = {};
  for (const [key, value] of Object.entries(source)) {
    if (consumed.has(key) || BRIEFING_INTERNAL_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    serviceData[key] = structuredClone(value);
  }

  return {
    items,
    observations: [],
    serviceData,
    summary: {
      aplicacao,
      cliente,
      data_entrega_confirmada: null,
      nome,
    },
  };
}

/**
 * PAG-01: re-applies the agent's cumulative pre-ficha onto a pending ficha.
 * Only what the agent collects moves — event name, technique and the first
 * item's type, model, fabrics and grade — and only when the briefing has it.
 * Colours, the confirmed delivery date, observations and any further items
 * are the seller's and stay as they are.
 *
 * @param {Ficha} ficha
 * @param {Record<string, unknown>|null|undefined} briefing
 * @returns {Ficha}
 */
export function projectBriefingOntoFicha(ficha, briefing) {
  const draft = briefingToFicha(briefing);
  const current = structuredClone(ficha);
  const [draftItem] = draft.items;
  const [firstItem, ...otherItems] = current.items;
  let items = current.items;
  if (draftItem && !firstItem) {
    items = [draftItem];
  } else if (draftItem && firstItem) {
    items = [
      {
        ...firstItem,
        grade: draftItem.grade.length > 0 ? draftItem.grade : firstItem.grade,
        malhas:
          draftItem.malhas.length > 0 ? draftItem.malhas : firstItem.malhas,
        modelo: draftItem.modelo || firstItem.modelo,
        tipo: draftItem.tipo || firstItem.tipo,
      },
      ...otherItems,
    ];
  }
  return {
    items,
    observations: current.observations,
    serviceData: draft.serviceData,
    summary: {
      ...current.summary,
      aplicacao: draft.summary.aplicacao ?? current.summary.aplicacao,
      cliente: current.summary.cliente || draft.summary.cliente,
      nome: draft.summary.nome ?? current.summary.nome,
    },
  };
}
