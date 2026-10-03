import { OrderInputError, OrderValidationError } from './errors.js';
import { parseSizes } from './sizes.js';

// The ficha mirrors the approved `ficha-canonical-v2` blocks (D10): summary,
// items with their grade, and up to five observation lines. Anything the agent
// collected that has no place on the printed document stays as service data
// (D11): shown read-only, never printed.
//
// ADR 016: an item is built around the seven points the bot asks for. The
// principal fields, in the order the page shows them, are the type of garment
// (`tipo`), colour (`cor`), quantity (never stored: the sum of `grade`),
// artwork (`estampa`), fabric (`malhas`), sizes (`grade`) and collar
// (`gola`). The seller also assigns a service type to every item before
// confirmation. The model and the old collar binding remain readable for
// legacy orders; the colour of each part and sleeve binding are additional.

export const NOT_APPLICABLE = 'NAO APLICAVEL';
// What the bot records when the customer leaves a point to the seller. It is
// an answer to the bot, never a value of the ficha.
export const DEFERRED = 'Definir com o vendedor';
export const MAX_OBSERVATIONS = 5;
const MAX_ITEMS = 50;
const MAX_TEXT = 200;

// The stored principal fields that must be filled to generate the order, in
// the order the page shows them; a missing grade is also the missing quantity.
export const ITEM_REQUIRED_FIELDS = Object.freeze(
  /** @type {const} */ (['tipo', 'cor', 'estampa', 'malhas', 'grade', 'gola']),
);
export const ITEM_EXTRA_FIELDS = Object.freeze(
  /** @type {const} */ ([
    'modelo',
    'cor_frente',
    'cor_costas',
    'cor_manga_direita',
    'cor_manga_esquerda',
    'vies_gola',
    'vies_mangas',
  ]),
);

const SUMMARY_INPUT_KEYS = Object.freeze([
  'data_entrega_confirmada',
  'aplicacao',
  'nome',
]);
const ITEM_TEXT_KEYS = Object.freeze([
  'tipo',
  'tipo_servico',
  'cor',
  'estampa',
  'gola',
  ...ITEM_EXTRA_FIELDS,
]);
// Optional and legacy fields may be absent in the seven-point form, but
// values supplied by older clients are still validated and preserved.
const OPTIONAL_ITEM_TEXT_KEYS = new Set([
  'tipo_servico',
  'cor',
  'estampa',
  'gola',
  ...ITEM_EXTRA_FIELDS,
]);
const ITEM_KEYS = new Set([...ITEM_TEXT_KEYS, 'malhas', 'grade']);
const GRADE_KEYS = new Set(['tamanho', 'quantidade']);

// Workflow bookkeeping, not facts about the order.
const BRIEFING_INTERNAL_KEYS = new Set([
  'briefing_status',
  'next_required_field',
]);
// The briefing fields that describe the first item: any of them opens it.
const ITEM_BRIEFING_KEYS = Object.freeze([
  'product_model',
  'product_type',
  'colors',
  'quantity',
  'artwork_status',
  'fabrics',
  'sizes',
  'collar',
]);

/**
 * @typedef {{tamanho: string, quantidade: number}} GradeLine
 * @typedef {{
 *   tipo: string, tipo_servico?: string, cor: string, estampa: string, malhas: string[],
 *   grade: GradeLine[], gola: string, modelo: string,
 *   cor_frente: string, cor_costas: string,
 *   cor_manga_direita: string, cor_manga_esquerda: string,
 *   vies_gola: string, vies_mangas: string,
 * }} FichaItem
 * @typedef {{
 *   data_entrega_confirmada: string|null, aplicacao: string|null, nome: string|null,
 * }} FichaSummaryInput
 * @typedef {FichaSummaryInput & {cliente: string}} FichaSummary
 * @typedef {{feito_pelo_cliente: boolean, feito_pela_silmer: boolean, files: unknown[]}} FichaArtwork
 * @typedef {{
 *   summary: FichaSummary, items: FichaItem[], observations: string[],
 *   artwork?: FichaArtwork, serviceData: Record<string, unknown>,
 * }} Ficha
 */

/** @returns {FichaItem} */
export function blankItem() {
  return {
    cor: '',
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    estampa: '',
    gola: '',
    grade: [],
    malhas: [],
    modelo: '',
    tipo: '',
    tipo_servico: '',
    vies_gola: '',
    vies_mangas: '',
  };
}

/**
 * ADR 016: a ficha stored before the seven-point item has no `cor`,
 * `estampa` or `gola`. It is read with them blank, so nothing is migrated
 * and the encrypted envelope keeps its version.
 *
 * @param {Ficha} ficha
 * @returns {Ficha}
 */
export function normalizeFicha(ficha) {
  const copy = structuredClone(ficha);
  return {
    ...copy,
    artwork: copy.artwork ?? {
      feito_pelo_cliente: false,
      feito_pela_silmer: false,
      files: [],
    },
    items: (copy.items ?? []).map((item) => ({
      ...blankItem(),
      ...item,
      gola: item.gola || item.vies_gola || '',
      grade: Array.isArray(item.grade) ? item.grade : [],
      malhas: Array.isArray(item.malhas) ? item.malhas : [],
    })),
  };
}

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

/**
 * ADR 016: an item may be saved half filled — the bot opens the order with
 * what it has and the seller completes it — so nothing here is required to
 * have a value. What is there must still be well formed: text fields are
 * text, a fabric line is not blank and every size line names a size with a
 * whole quantity above zero.
 *
 * @param {unknown} raw @param {number} itemIndex @returns {FichaItem}
 */
function validateItem(raw, itemIndex) {
  const prefix = `items[${itemIndex}]`;
  if (!isPlainObject(raw)) {
    throw new OrderInputError(`${prefix} must be an object`, [prefix]);
  }
  rejectUnknownKeys(raw, ITEM_KEYS, prefix);
  /** @type {Record<string, unknown>} */
  const item = {};
  for (const key of ITEM_TEXT_KEYS) {
    item[key] =
      OPTIONAL_ITEM_TEXT_KEYS.has(key) && !Object.hasOwn(raw, key)
        ? ''
        : requireText(raw[key], `${prefix}.${key}`);
  }
  item.gola = item.gola || item.vies_gola;

  const malhas = Array.isArray(raw.malhas)
    ? raw.malhas.map((value) => requireText(value, `${prefix}.malhas`))
    : null;
  if (!malhas || malhas.some((value) => value === '')) {
    throw new OrderInputError(`${prefix}.malhas must be a list of fabrics`, [
      `${prefix}.malhas`,
    ]);
  }
  item.malhas = malhas;

  if (!Array.isArray(raw.grade)) {
    throw new OrderValidationError(
      'Informe os tamanhos como uma lista.',
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
 * Only a seller can set artwork provenance through the order section route.
 * Neither checkbox is exclusive; absent provenance remains unknown.
 * File bytes and metadata are not accepted until durable storage is ready.
 * @param {unknown} input
 * @returns {FichaArtwork}
 */
export function validateArtwork(input) {
  if (!isPlainObject(input)) {
    throw new OrderInputError('artwork must be an object', ['artwork']);
  }
  rejectUnknownKeys(
    input,
    new Set(['feito_pelo_cliente', 'feito_pela_silmer']),
    'artwork',
  );
  for (const field of ['feito_pelo_cliente', 'feito_pela_silmer']) {
    if (typeof input[field] !== 'boolean') {
      throw new OrderInputError(`artwork.${field} must be boolean`, [
        `artwork.${field}`,
      ]);
    }
  }
  return {
    feito_pelo_cliente: /** @type {boolean} */ (input.feito_pelo_cliente),
    feito_pela_silmer: /** @type {boolean} */ (input.feito_pela_silmer),
    files: [],
  };
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

/** @param {string} text */
function foldText(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

/** @param {string} text */
function isDeferred(text) {
  return foldText(text).replace(/[.!]+$/u, '') === foldText(DEFERRED);
}

/** "Sem aplicação" is how the bot records a plain garment. @param {string} text */
function isPlain(text) {
  return /^sem (aplicacao|estampa)[.!]?$/u.test(foldText(text));
}

/**
 * The texts in a briefing value (text, a number or a list of them), without
 * blanks and without the seller's placeholder. Undefined when the value has
 * another shape, or holds nothing but the placeholder: either way it stays as
 * service data for the seller to read.
 *
 * @param {unknown} value
 * @returns {string[]|undefined}
 */
function briefingParts(value) {
  const entries = Array.isArray(value) ? value : [value];
  /** @type {string[]} */
  const parts = [];
  let deferred = false;
  for (const entry of entries) {
    const text = briefingText(entry);
    if (text === undefined) return undefined;
    if (isDeferred(text)) {
      deferred = true;
    } else if (text !== '') {
      parts.push(text);
    }
  }
  return deferred && parts.length === 0 ? undefined : parts;
}

/** @param {unknown} value @returns {string|undefined} */
function fichaText(value) {
  return briefingParts(value)?.join(', ');
}

// A briefing technique reaches "Tipo de serviço" only when it names one;
// "estampada", "com foto" or a description stay with the seller.
const TECHNIQUE =
  /(^|[^a-z0-9])(silk|silk ?screen|serigrafia|sublimacao|sublimatica|sublimad[oa]|dtf|dtg|bordad[oa]s?|transfer|sem aplicacao)($|[^a-z0-9])/u;

/** @param {unknown} value @returns {string|undefined} */
function techniqueText(value) {
  const text = fichaText(value);
  return text && TECHNIQUE.test(foldText(text)) ? text : undefined;
}

/** Where the artwork goes, when it says a place. @param {unknown} value */
function artworkPlaces(value) {
  const text = fichaText(value);
  return text && !isPlain(text) ? text : undefined;
}

/** @param {unknown} value @returns {GradeLine[]|undefined} */
function briefingGrade(value) {
  return parseSizes(value) ?? undefined;
}

/**
 * ADR 016: maps the agent pre-ficha onto the order without guessing. The
 * seven points land on the first item — type of garment (`product_model`,
 * else `product_type`), colour, artwork (with its places), fabric, sizes
 * when they read without doubt, and collar — and the order name and a named
 * technique on the summary. A point left to the seller ("Definir com o
 * vendedor") is never a ficha value: the field stays blank, so it keeps
 * blocking the order, and the text stays as service data. So does anything
 * else the bot collected, including the quantity the customer said.
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

  const cliente = take('customer_name', fichaText) ?? '';
  const nome = take('order_name', fichaText) || null;
  const aplicacao = take('artwork_technique', techniqueText) || null;
  // The type of garment is what the bot asks; the kind of product only
  // stands in for it when the customer never said the type.
  const tipo =
    take('product_model', fichaText) || take('product_type', fichaText);
  const status = take('artwork_status', fichaText);
  let estampa = status;
  if (status && isPlain(status)) {
    estampa = 'Sem estampa';
  } else if (status) {
    const places = take('artwork_locations', artworkPlaces);
    if (places) estampa = `${status} · ${places}`;
  }

  /** @type {FichaItem} */
  const item = {
    ...blankItem(),
    cor: take('colors', fichaText) ?? '',
    estampa: estampa ?? '',
    gola: take('collar', fichaText) ?? '',
    grade: take('sizes', briefingGrade) ?? [],
    malhas: take('fabrics', briefingParts) ?? [],
    tipo: tipo ?? '',
  };
  const hasItem = ITEM_BRIEFING_KEYS.some(
    (key) => source[key] !== undefined && source[key] !== null,
  );

  /** @type {Record<string, unknown>} */
  const serviceData = {};
  for (const [key, value] of Object.entries(source)) {
    if (consumed.has(key) || BRIEFING_INTERNAL_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    serviceData[key] = structuredClone(value);
  }

  return {
    artwork: { feito_pelo_cliente: false, feito_pela_silmer: false, files: [] },
    items: hasItem ? [item] : [],
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
 * PIT-11 and ADR 018: who the order is for — the contact's confirmed name,
 * else the name the customer gave the bot, else blank for the seller. A
 * pending order reads it again on every read; generating writes it down.
 *
 * @param {{customerName: string|null, briefing: Record<string, unknown>|null}} context
 * @returns {string}
 */
export function orderClient(context) {
  if (context.customerName) return context.customerName;
  const { briefing } = context;
  return (isPlainObject(briefing) && fichaText(briefing.customer_name)) || '';
}

/**
 * PAG-01: re-applies the agent's cumulative pre-ficha onto a pending ficha.
 * Only what the agent collects moves — event name, technique and the seven
 * points of the first item — and only when the briefing has a value for it.
 * The model, the colour of each part, the trims, the confirmed delivery date,
 * observations and any further items are the seller's and stay as they are.
 *
 * @param {Ficha} ficha
 * @param {Record<string, unknown>|null|undefined} briefing
 * @returns {Ficha}
 */
export function projectBriefingOntoFicha(ficha, briefing) {
  const draft = briefingToFicha(briefing);
  const current = normalizeFicha(ficha);
  const [draftItem] = draft.items;
  const [firstItem, ...otherItems] = current.items;
  let items = current.items;
  if (draftItem && !firstItem) {
    items = [draftItem];
  } else if (draftItem && firstItem) {
    items = [
      {
        ...firstItem,
        cor: draftItem.cor || firstItem.cor,
        estampa: draftItem.estampa || firstItem.estampa,
        gola: draftItem.gola || firstItem.gola,
        grade: draftItem.grade.length > 0 ? draftItem.grade : firstItem.grade,
        malhas:
          draftItem.malhas.length > 0 ? draftItem.malhas : firstItem.malhas,
        tipo: draftItem.tipo || firstItem.tipo,
      },
      ...otherItems,
    ];
  }
  return {
    artwork: current.artwork,
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
