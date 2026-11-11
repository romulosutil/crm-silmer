/**
 * EDIT-01 (ADR 083, design.md §20): the rules of the edit-in-place of "Itens e
 * especificações", kept apart from Vue so they are tested on their own. One
 * change of the seller becomes one command; this module says which command,
 * for which of the three ways an order stores its sizes:
 *
 * - `managed`: `ficha.sizePricing` exists, so each change is one command of
 *   the section `size-pricing` (OLIST-43);
 * - `initialize`: the order was never confirmed and has no subtotals yet, so
 *   the first write sends `initialize` and goes on as `managed`;
 * - `plain`: an order that was confirmed and reopened without subtotals keeps
 *   the whole-array write of the section `items`.
 *
 * The server stays the authority: every rule here is checked again there.
 */
import { parseBrl, sizeKey } from './order-format.js';

/** PFI-07: what the ficha stores when a garment has no sleeve or no viés. */
export const NOT_APPLICABLE = 'NAO APLICAVEL';
export const MAX_ITEMS = 50;
const MAX_QUANTITY = 2_147_483_647;
const MAX_INFORMED = 100_000;
const MAX_TEXT = 200;

export const MESSAGES = Object.freeze({
  conflict: 'Este pedido mudou em outro lugar.',
  dropped: 'Não foi salvo porque a alteração anterior falhou.',
  informed: 'Use um número inteiro de 1 a 100000.',
  list: 'Escreva o tamanho e a quantidade, por exemplo: M 60.',
  needQuantity: 'Informe a quantidade para criar o tamanho.',
  quantity: 'Use uma quantidade inteira maior que zero.',
  sizeLength: 'Use um tamanho com até 200 caracteres.',
  sizeRequired: 'Informe o tamanho ou remova a linha.',
  sizesBlocked:
    'Há tamanhos repetidos ou com espaços. Corrija para informar os subtotais.',
  subtotal: 'Use um subtotal maior que zero no formato 4.820,00.',
});

/** @param {string} size */
export function sizeTakenMessage(size) {
  return `O tamanho ${size} já está neste item. Some a quantidade na outra linha.`;
}

const TEXT_KEYS = Object.freeze([
  'cor',
  'cor_costas',
  'cor_frente',
  'cor_manga_direita',
  'cor_manga_esquerda',
  'estampa',
  'gola',
  'modelo',
  'tipo',
  'tipo_servico',
  'vies_gola',
  'vies_mangas',
]);

// A code that means the page holds an older order than the server.
const STALE_CODES = new Set([
  'ORDER_VERSION_CONFLICT',
  'SIZE_PRICING_ALREADY_INITIALIZED',
  'SIZE_PRICING_CONFLICT',
  'SIZE_PRICING_ITEMS_MANAGED',
  'SIZE_PRICING_NOT_INITIALIZED',
  'TARGET_GONE',
  'VERSION_CONFLICT',
]);

// Words that belong to the size they follow ("12 ANOS", "0-3 MESES").
const SIZE_UNITS = new Set(['ANO', 'ANOS', 'MES', 'MESES']);

/** @param {Record<string, any>|null|undefined} order */
export function persistenceMode(order) {
  if (Array.isArray(order?.ficha?.sizePricing)) return 'managed';
  return (order?.confirmedAt ?? null) === null ? 'initialize' : 'plain';
}

/**
 * The quantity said is optional: blank is null, anything else the number the
 * server checks again.
 *
 * @param {unknown} value
 */
function informedValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  return Number(value);
}

/**
 * Everything of an item but its sizes, as the API validates it.
 *
 * @param {Record<string, any>|null|undefined} item
 */
export function itemAttributes(item) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of TEXT_KEYS) result[key] = String(item?.[key] ?? '');
  result.malhas = (Array.isArray(item?.malhas) ? item.malhas : [])
    .map(String)
    .filter((malha) => malha.trim() !== '');
  result.publico = String(item?.publico ?? '');
  result.quantidade_informada = informedValue(item?.quantidade_informada);
  return result;
}

/**
 * The whole array the section `items` takes, built the way the form that
 * came before EDIT-01 built it: trimmed sizes, numeric quantities, no blank
 * fabric and the quantity said as null or a number.
 *
 * @param {unknown} items
 * @returns {Record<string, any>[]}
 */
export function plainItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...itemAttributes(item),
    grade: (Array.isArray(item?.grade) ? item.grade : []).map(
      /** @param {Record<string, any>} line */
      (line) => ({
        quantidade: Number(line?.quantidade),
        tamanho: String(line?.tamanho ?? '').trim(),
      }),
    ),
  }));
}

/**
 * The sizes of one item in one shape, whatever the order stores them in.
 *
 * @param {Record<string, any>|null|undefined} order @param {number} itemIndex
 * @returns {{id: string|null, size: string, quantity: any, subtotalCents: number|null, reviewed: boolean}[]}
 */
export function itemLines(order, itemIndex) {
  const groups = order?.ficha?.sizePricing;
  if (Array.isArray(groups)) {
    return (groups[itemIndex]?.lines ?? []).map(
      /** @param {Record<string, any>} line */
      (line) => ({
        id: String(line.id),
        quantity: line.quantity,
        reviewed: line.subtotalReviewed === true,
        size: String(line.size ?? ''),
        subtotalCents: line.subtotalCents ?? null,
      }),
    );
  }
  const grade = order?.ficha?.items?.[itemIndex]?.grade;
  return (Array.isArray(grade) ? grade : []).map(
    /** @param {Record<string, any>} line */
    (line) => ({
      id: null,
      quantity: line?.quantidade,
      reviewed: false,
      size: String(line?.tamanho ?? ''),
      subtotalCents: null,
    }),
  );
}

/**
 * `initialize` refuses a grade with a size written twice or with spaces
 * around it; the screen says so before asking.
 *
 * @param {unknown} items
 */
export function gradeBlocksSubtotals(items) {
  return (Array.isArray(items) ? items : []).some((item) => {
    const seen = new Set();
    return (Array.isArray(item?.grade) ? item.grade : []).some(
      /** @param {Record<string, any>} line */
      (line) => {
        const size = String(line?.tamanho ?? '');
        const key = sizeKey(size);
        if (size !== size.trim() || seen.has(key)) return true;
        seen.add(key);
        return false;
      },
    );
  });
}

/**
 * A size as it is stored: trimmed and otherwise as typed. The ficha prints
 * what is stored, so nothing here changes its case; comparing two sizes is
 * the job of `sizeKey`, which ignores case and accents.
 *
 * @param {unknown} value
 */
export function normalizeSize(value) {
  return String(value ?? '').trim();
}

/**
 * @param {unknown} text
 * @returns {number|null} a positive whole quantity, or null
 */
export function parseQuantity(text) {
  const value = String(text ?? '').trim();
  if (!/^\d+$/u.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    quantity <= MAX_QUANTITY
    ? quantity
    : null;
}

/**
 * An empty subtotal clears it; anything else must be an amount above zero
 * that the server takes: a positive safe integer of cents (size-pricing.js),
 * 90.071.992.547.409,91 at most. The field has no `maxlength`, so a longer
 * amount reaches this check whole and is refused instead of being cut into a
 * valid one (EDIT-03).
 *
 * @param {unknown} text
 * @returns {{ok: true, cents: number|null}|{ok: false, message: string}}
 */
export function parseSubtotalInput(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/^R\$\s*/iu, '');
  if (value === '') return { cents: null, ok: true };
  const cents = parseBrl(value);
  return cents === null || !Number.isSafeInteger(cents) || cents <= 0
    ? { message: MESSAGES.subtotal, ok: false }
    : { cents, ok: true };
}

/**
 * @param {unknown} text
 * @returns {{ok: true, value: number|null}|{ok: false, message: string}}
 */
export function parseInformedInput(text) {
  const value = String(text ?? '').trim();
  if (value === '') return { ok: true, value: null };
  const quantity = parseQuantity(value);
  return quantity === null || quantity > MAX_INFORMED
    ? { message: MESSAGES.informed, ok: false }
    : { ok: true, value: quantity };
}

/**
 * What was typed or pasted in the size cell of the blank row. One size alone
 * (of one word or of many, with no number of its own) waits for its
 * quantity; "P 20 M 60", "P:20", "20 P" and "P-20" are a list of sizes with
 * quantities; a list with a size lacking its quantity is refused instead of
 * guessed.
 *
 * @param {unknown} text
 * @returns {{kind: 'empty'}|{kind: 'single', size: string}|{kind: 'pairs', pairs: {size: string, quantity: number}[]}|{kind: 'invalid', message: string}}
 */
export function parseSizeList(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { kind: 'empty' };
  /** @type {string[]} */
  const tokens = [];
  for (const piece of raw
    .replace(/[,;\n\r\t]+/gu, ' ')
    .replace(/\s*[:=]\s*/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)) {
    // "P-20" and "20-P" are a pair; "0-3" stays one size.
    const sizeFirst = /^(\D.*?)-(\d+)$/u.exec(piece);
    const quantityFirst = /^(\d+)-(\D.*)$/u.exec(piece);
    if (sizeFirst) tokens.push(sizeFirst[1], sizeFirst[2]);
    else if (quantityFirst) tokens.push(quantityFirst[1], quantityFirst[2]);
    else if (SIZE_UNITS.has(sizeKey(piece)) && tokens.length > 0) {
      tokens[tokens.length - 1] = `${tokens.at(-1)} ${piece}`;
    } else tokens.push(piece);
  }
  // With no quantity anywhere the text is one size, whatever its words:
  // "EX G", "G1 PLUS" and "BABY LOOK P" wait for the quantity in its cell.
  const named = tokens.every((token) => parseQuantity(token) === null);
  if (tokens.length === 1 || named) {
    const size = normalizeSize(named ? raw : tokens[0]);
    return size.length > MAX_TEXT
      ? { kind: 'invalid', message: MESSAGES.sizeLength }
      : { kind: 'single', size };
  }
  if (tokens.length % 2 !== 0)
    return { kind: 'invalid', message: MESSAGES.list };
  const pairs = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const first = tokens[index];
    const second = tokens[index + 1];
    const firstQuantity = parseQuantity(first);
    const secondQuantity = parseQuantity(second);
    // Two numbers read as a child size and its quantity: "12 20".
    if (secondQuantity !== null) {
      pairs.push({ quantity: secondQuantity, size: normalizeSize(first) });
    } else if (firstQuantity !== null) {
      pairs.push({ quantity: firstQuantity, size: normalizeSize(second) });
    } else return { kind: 'invalid', message: MESSAGES.list };
  }
  if (pairs.some((pair) => pair.size === '' || pair.size.length > MAX_TEXT)) {
    return { kind: 'invalid', message: MESSAGES.list };
  }
  return { kind: 'pairs', pairs };
}

/**
 * design.md §20: a size that is already in the item is never written twice;
 * its quantity is added to the line it has ("M" and "m " are the same size).
 *
 * @param {{size: string, quantity: any}[]} lines
 * @param {{size: string, quantity: number}[]} pairs
 * @returns {({kind: 'add', size: string, quantity: number}|{kind: 'merge', lineIndex: number, size: string, quantity: number, added: number})[]}
 */
export function planSizes(lines, pairs) {
  const working = lines.map((line) => ({
    quantity: Number.parseInt(String(line.quantity), 10) || 0,
    size: String(line.size),
  }));
  /** @type {any[]} */
  const steps = [];
  for (const pair of pairs) {
    const key = sizeKey(pair.size);
    const lineIndex = working.findIndex((line) => sizeKey(line.size) === key);
    if (lineIndex === -1) {
      working.push({ quantity: pair.quantity, size: pair.size });
      steps.push({ kind: 'add', quantity: pair.quantity, size: pair.size });
      continue;
    }
    working[lineIndex].quantity += pair.quantity;
    const earlier = steps.find(
      (step) =>
        (step.kind === 'merge' && step.lineIndex === lineIndex) ||
        (step.kind === 'add' && sizeKey(step.size) === key),
    );
    if (earlier) {
      earlier.quantity = working[lineIndex].quantity;
      if (earlier.kind === 'merge') earlier.added += pair.quantity;
      continue;
    }
    steps.push({
      added: pair.quantity,
      kind: 'merge',
      lineIndex,
      quantity: working[lineIndex].quantity,
      size: working[lineIndex].size,
    });
  }
  return steps;
}

/**
 * True when another line of the item already has this size.
 *
 * @param {{size: string}[]} lines @param {number} lineIndex @param {string} size
 */
export function sizeCollides(lines, lineIndex, size) {
  const key = sizeKey(size);
  return lines.some(
    (line, index) => index !== lineIndex && sizeKey(line.size) === key,
  );
}

/**
 * @param {Record<string, any>} item @param {Record<string, any>} attributes
 */
export function sameAttributes(item, attributes) {
  const current = itemAttributes(item);
  return Object.entries(attributes).every(
    ([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value),
  );
}

const done = Object.freeze({ ok: true });
const gone = Object.freeze({ code: 'TARGET_GONE', message: '', ok: false });
// Taking away or moving what is no longer there is already done: a second
// click on "Remover tamanho" is not a conflict.
const SETTLED_WHEN_GONE = new Set(['moveItem', 'removeItem', 'removeLine']);

/**
 * The sizes of a list that were not written yet, for a retry that must not
 * add twice what the order already took.
 *
 * @param {Record<string, any>[]} steps @param {number} from
 */
function remainingPairs(steps, from) {
  return steps.slice(from).map((step) => ({
    quantity: step.kind === 'add' ? step.quantity : step.added,
    size: step.size,
  }));
}

/**
 * @typedef {{getOrder: () => Record<string, any>, save: (section: string, value: unknown) => Promise<Record<string, any>>, skipInitialize?: boolean}} OperationIo
 */

/**
 * One change of the seller, sent as the requests its mode asks for, one after
 * the other and each built from the order as the last answer left it. It
 * stops at the first refusal and returns it.
 *
 * `op.type`: setAttributes, addItem, duplicateItem, moveItem, removeItem,
 * addLines, setQuantity, renameLine, removeLine, setSubtotal or
 * keepSubtotals; items and lines are named by their index at the time it
 * runs. A list refused halfway answers with `remaining`, the sizes not
 * written yet.
 *
 * @param {Record<string, any>} op @param {OperationIo} io
 * @returns {Promise<Record<string, any>>}
 */
export async function runOperation(op, io) {
  let mode = persistenceMode(io.getOrder());
  let initializeBlocked;
  if (mode === 'initialize') {
    if (io.skipInitialize) {
      mode = 'plain';
      initializeBlocked = true;
    } else {
      const started = await io.save('size-pricing', { action: 'initialize' });
      if (started.ok) {
        mode = 'managed';
        initializeBlocked = false;
      } else if (started.code === 'SIZE_PRICING_INVALID') {
        mode = 'plain';
        initializeBlocked = true;
      } else return started;
    }
  }
  const result =
    mode === 'managed' ? await runManaged(op, io) : await runPlain(op, io);
  return initializeBlocked === undefined
    ? result
    : { ...result, initializeBlocked };
}

/** @param {Record<string, any>} op @param {OperationIo} io */
async function runManaged(op, io) {
  /** @param {Record<string, any>} command */
  const send = (command) => io.save('size-pricing', command);
  /** @returns {Record<string, any>[]} */
  const groups = () => io.getOrder().ficha.sizePricing ?? [];
  /** @returns {Record<string, any>[]} */
  const items = () => io.getOrder().ficha.items ?? [];
  if (op.type === 'addItem') {
    return send({
      action: 'add_group',
      item: { ...itemAttributes(null), grade: [] },
    });
  }
  const missing = SETTLED_WHEN_GONE.has(op.type) ? done : gone;
  const group = groups()[op.itemIndex];
  if (!group) return missing;
  const groupId = group.id;
  const line = op.lineIndex === undefined ? null : group.lines[op.lineIndex];
  if (op.lineIndex !== undefined && !line) return missing;

  switch (op.type) {
    case 'setAttributes':
      return send({
        action: 'update_group',
        attributes: op.attributes,
        groupId,
      });
    case 'removeItem':
      return send({ action: 'remove_group', groupId });
    case 'moveItem': {
      const ids = groups().map((one) => one.id);
      const target = op.itemIndex + op.delta;
      if (target < 0 || target >= ids.length) return done;
      [ids[op.itemIndex], ids[target]] = [ids[target], ids[op.itemIndex]];
      return send({ action: 'reorder_groups', groupIds: ids });
    }
    case 'duplicateItem': {
      // ADR 025 (D7): everything but the sizes and the quantity said.
      // `duplicate_group` copies the sizes, so the copy is a new group.
      const added = await send({
        action: 'add_group',
        item: {
          ...itemAttributes(items()[op.itemIndex]),
          grade: [],
          quantidade_informada: null,
        },
      });
      if (!added.ok) return added;
      const ids = groups().map((one) => one.id);
      const source = ids.indexOf(groupId);
      if (source === -1 || source === ids.length - 2) return done;
      const copy = ids.pop();
      ids.splice(source + 1, 0, copy);
      return send({ action: 'reorder_groups', groupIds: ids });
    }
    case 'addLines': {
      const steps = planSizes(itemLines(io.getOrder(), op.itemIndex), op.pairs);
      for (const [index, step] of steps.entries()) {
        const remaining = remainingPairs(steps, index);
        const current = groups().find((one) => one.id === groupId);
        if (!current) return { ...gone, remaining };
        const result =
          step.kind === 'add'
            ? await send({
                action: 'add_line',
                groupId,
                quantity: step.quantity,
                size: step.size,
              })
            : await send({
                action: 'change_quantity',
                groupId,
                lineId: current.lines[step.lineIndex].id,
                quantity: step.quantity,
              });
        if (!result.ok) return { ...result, remaining };
      }
      return { lines: steps, ok: true };
    }
    case 'keepSubtotals': {
      // OLIST-43: one look at every subtotal a change left to review, sent
      // as the same amounts, one command per size.
      const pending = group.lines.filter(
        /** @param {Record<string, any>} one */
        (one) => one.subtotalCents !== null && one.subtotalReviewed !== true,
      );
      for (const one of pending) {
        const result = await send({
          action: 'review_subtotal',
          groupId,
          lineId: one.id,
          subtotalCents: one.subtotalCents,
        });
        if (!result.ok) return result;
      }
      return done;
    }
    case 'setQuantity':
      return send({
        action: 'change_quantity',
        groupId,
        lineId: line.id,
        quantity: op.quantity,
      });
    case 'renameLine':
      return send({
        action: 'rename_line',
        groupId,
        lineId: line.id,
        size: op.size,
      });
    case 'removeLine':
      return send({ action: 'remove_line', groupId, lineId: line.id });
    case 'setSubtotal':
      return send({
        action: 'review_subtotal',
        groupId,
        lineId: line.id,
        subtotalCents: op.subtotalCents,
      });
    default:
      return gone;
  }
}

/** @param {Record<string, any>} op @param {OperationIo} io */
async function runPlain(op, io) {
  const items = plainItems(io.getOrder().ficha.items);
  const item = items[op.itemIndex];
  const line = op.lineIndex === undefined ? null : item?.grade[op.lineIndex];
  const missing = SETTLED_WHEN_GONE.has(op.type) ? done : gone;
  if (op.type !== 'addItem' && !item) return missing;
  if (op.lineIndex !== undefined && !line) return missing;
  let lines;

  switch (op.type) {
    case 'addItem':
      items.push({ ...itemAttributes(null), grade: [] });
      break;
    case 'setAttributes':
      Object.assign(item, op.attributes);
      break;
    case 'removeItem':
      items.splice(op.itemIndex, 1);
      break;
    case 'moveItem': {
      const target = op.itemIndex + op.delta;
      if (target < 0 || target >= items.length) return done;
      [items[op.itemIndex], items[target]] = [items[target], item];
      break;
    }
    case 'duplicateItem':
      items.splice(op.itemIndex + 1, 0, {
        ...itemAttributes(item),
        grade: [],
        quantidade_informada: null,
      });
      break;
    case 'addLines':
      lines = planSizes(itemLines(io.getOrder(), op.itemIndex), op.pairs);
      for (const step of lines) {
        if (step.kind === 'add') {
          item.grade.push({ quantidade: step.quantity, tamanho: step.size });
        } else item.grade[step.lineIndex].quantidade = step.quantity;
      }
      break;
    case 'setQuantity':
      line.quantidade = op.quantity;
      break;
    case 'renameLine':
      line.tamanho = op.size;
      break;
    case 'removeLine':
      item.grade.splice(op.lineIndex, 1);
      break;
    default:
      // A subtotal needs the sizes under `size-pricing`.
      return {
        code: 'SUBTOTAL_UNAVAILABLE',
        message: MESSAGES.sizesBlocked,
        ok: false,
      };
  }
  const result = await io.save('items', items);
  return result.ok && lines ? { ...result, lines } : result;
}

/**
 * What a refused write says under the field that asked for it, and whether
 * reloading the order is the way out.
 *
 * @param {Record<string, any>} result
 * @returns {{message: string, conflict: boolean}}
 */
export function describeFailure(result) {
  const code = String(result?.code ?? '');
  const message = String(result?.message ?? '');
  // The page words every 409 as "Este pedido mudou. …".
  if (STALE_CODES.has(code) || message.startsWith('Este pedido mudou')) {
    return { conflict: true, message: MESSAGES.conflict };
  }
  if (code === 'INVALID_GRADE') {
    return { conflict: false, message: MESSAGES.quantity };
  }
  if (code === 'SIZE_PRICING_INVALID') {
    return {
      conflict: false,
      message:
        'Não foi possível salvar. Confira o tamanho, a quantidade e o subtotal.',
    };
  }
  if (code === 'ORDER_INVALID') {
    return {
      conflict: false,
      message: 'Não foi possível salvar. Confira o texto deste campo.',
    };
  }
  return {
    conflict: false,
    message: message || 'Não foi possível salvar esta alteração.',
  };
}

/**
 * @typedef {{key: string, mark?: string, after?: (result: Record<string, any>) => unknown} & Record<string, any>} SaveJob
 */

/**
 * The saves of a section edited in place, strictly one after the other:
 * without an edit mode each one rides the version the last answer left, and
 * a second request in flight would lose to a conflict of its own making.
 *
 * - a job equal (same key and mark) to one waiting or running is not queued;
 * - `execute(job, sending)` answers `{ok}`; it calls `sending()` right before
 *   a real request, so `onState` hears 'saving' and, at the end, 'saved';
 * - the first refusal stops the queue: `onFailure` gets that job with what
 *   to say, and every job behind it with "not saved because the change
 *   before it failed" (a job of the same key keeps the first message).
 *
 * @param {{execute: (job: SaveJob, sending: () => void) => Promise<Record<string, any>>, onFailure: (job: SaveJob, failure: {message: string, conflict: boolean}, result: Record<string, any>|null) => void, onState?: (state: ''|'saving'|'saved') => void}} options
 */
export function createSaveQueue({ execute, onFailure, onState }) {
  /** @type {SaveJob[]} */
  const waiting = [];
  /** @type {SaveJob|null} */
  let active = null;
  /** @type {Promise<void>} */
  let idle = Promise.resolve();

  async function drain() {
    let sent = false;
    let failed = false;
    while (waiting.length > 0) {
      active = /** @type {SaveJob} */ (waiting.shift());
      const job = active;
      /** @type {Record<string, any>} */
      let result;
      try {
        result = await execute(job, () => {
          sent = true;
          onState?.('saving');
        });
      } catch {
        result = { ok: false };
      }
      if (result.ok) {
        await job.after?.(result);
        continue;
      }
      failed = true;
      onFailure(job, describeFailure(result), result);
      for (const dropped of waiting.splice(0)) {
        if (dropped.key !== job.key) {
          onFailure(
            dropped,
            { conflict: false, message: MESSAGES.dropped },
            null,
          );
        }
      }
    }
    active = null;
    if (failed) onState?.('');
    else if (sent) onState?.('saved');
  }

  return {
    /**
     * @param {SaveJob} job
     * @returns {boolean} false when an equal job is already on its way
     */
    enqueue(job) {
      const same = [active, ...waiting].some(
        (other) =>
          other !== null &&
          other.key === job.key &&
          job.mark !== undefined &&
          other.mark === job.mark,
      );
      if (same) return false;
      waiting.push(job);
      if (!active) idle = drain();
      return true;
    },
    /** @param {string} key */
    isPending(key) {
      return [active, ...waiting].some((job) => job?.key === key);
    },
    /** Resolves once nothing is running or waiting. */
    whenIdle: () => idle,
  };
}

/**
 * What a change does to the position of items and lines, for an order whose
 * items carry no id of their own (`initialize` refused, or `plain`).
 *
 * @param {Record<string, any>} op
 */
export function structuralHint(op) {
  switch (op?.type) {
    case 'removeItem':
      return { index: op.itemIndex, type: 'removeItem' };
    case 'duplicateItem':
      return { index: op.itemIndex + 1, type: 'insertItem' };
    case 'moveItem':
      return {
        from: op.itemIndex,
        to: op.itemIndex + op.delta,
        type: 'moveItem',
      };
    case 'removeLine':
      return {
        itemIndex: op.itemIndex,
        lineIndex: op.lineIndex,
        type: 'removeLine',
      };
    default:
      return null;
  }
}

/**
 * @typedef {{uid: string, id: string|null, lines: {uid: string, id: string|null}[]}} ItemIdentity
 */

/**
 * @param {ItemIdentity[]} entries @param {Record<string, any>} hint
 * @param {() => string} newUid
 */
function applyHint(entries, hint, newUid) {
  const next = entries.map((entry) => ({ ...entry, lines: [...entry.lines] }));
  if (hint.type === 'removeItem') next.splice(hint.index, 1);
  else if (hint.type === 'insertItem') {
    next.splice(hint.index, 0, { id: null, lines: [], uid: newUid() });
  } else if (hint.type === 'moveItem') {
    if (next[hint.from] && next[hint.to]) {
      [next[hint.from], next[hint.to]] = [next[hint.to], next[hint.from]];
    }
  } else if (hint.type === 'removeLine') {
    next[hint.itemIndex]?.lines.splice(hint.lineIndex, 1);
  }
  return next;
}

/**
 * A stable identity for every item and size on screen, so a refreshed order
 * never moves the text under the cursor: the group and line ids once the
 * order has them, the position (corrected by `hint`) before that. The first
 * order with ids adopts the identities by position, so starting the subtotals
 * does not rebuild the fields.
 *
 * @param {{items: ItemIdentity[]}|null|undefined} previous
 * @param {Record<string, any>|null|undefined} order
 * @param {() => string} newUid
 * @param {Record<string, any>|null} [hint]
 * @returns {{items: ItemIdentity[]}}
 */
export function reconcileIdentity(previous, order, newUid, hint = null) {
  /** @type {Record<string, any>[]} */
  const items = Array.isArray(order?.ficha?.items) ? order.ficha.items : [];
  /** @type {Record<string, any>[]|null} */
  const groups = Array.isArray(order?.ficha?.sizePricing)
    ? order.ficha.sizePricing
    : null;
  let base = previous?.items ?? [];
  if (!groups && hint) base = applyHint(base, hint, newUid);
  /**
   * @param {{uid: string, id: string|null}[]} entries
   * @param {number} index @param {string|null} id
   */
  const match = (entries, index, id) => {
    if (id === null) return entries[index];
    return (
      entries.find((entry) => entry.id === id) ??
      (entries[index]?.id === null ? entries[index] : undefined)
    );
  };
  return {
    items: items.map((item, index) => {
      const group = groups?.[index];
      const id = group ? String(group.id) : null;
      const prior = /** @type {ItemIdentity|undefined} */ (
        match(base, index, id)
      );
      const lines = group ? group.lines : (item?.grade ?? []);
      const uid = prior?.uid ?? newUid();
      return {
        id,
        lines: lines.map(
          /** @param {Record<string, any>} line @param {number} lineIndex */
          (line, lineIndex) => {
            const lineId = group ? String(line.id) : null;
            return {
              id: lineId,
              uid:
                match(prior?.lines ?? [], lineIndex, lineId)?.uid ?? newUid(),
            };
          },
        ),
        uid,
      };
    }),
  };
}

/**
 * `missingFields` sorted by where the items show it (design.md §20,
 * FieldGap): per item the keys it lacks, the sizes that lack a reviewed
 * subtotal, and whether the order has no item at all.
 *
 * @param {Record<string, any>|null|undefined} order
 * @returns {{empty: boolean, pricing: boolean, fields: Record<number, string[]>, groups: string[], lines: string[]}}
 */
export function itemGaps(order) {
  /** @type {{empty: boolean, pricing: boolean, fields: Record<number, string[]>, groups: string[], lines: string[]}} */
  const gaps = {
    empty: false,
    fields: {},
    groups: [],
    lines: [],
    pricing: false,
  };
  const missing = Array.isArray(order?.missingFields)
    ? order.missingFields.map(String)
    : [];
  for (const field of missing) {
    const item = /^items\[(\d+)\]\.(\w+)$/u.exec(field);
    const pricing = /^sizePricing\.([^.]+)(?:\.([^.]+))?$/u.exec(field);
    if (field === 'items') gaps.empty = true;
    else if (field === 'sizePricing') gaps.pricing = true;
    else if (item) (gaps.fields[Number(item[1])] ??= []).push(item[2]);
    else if (pricing?.[2]) gaps.lines.push(`${pricing[1]}.${pricing[2]}`);
    else if (pricing) gaps.groups.push(pricing[1]);
  }
  return gaps;
}

/**
 * PFI-15/PFI-16: where "Completar itens" puts the focus — the first thing
 * the server still asks of the items, in the order it lists them.
 *
 * @param {Record<string, any>|null|undefined} order
 * @returns {{kind: 'add-item'}|{kind: 'field', itemIndex: number, key: string}|{kind: 'blank-size', itemIndex: number}|{kind: 'subtotal', itemIndex: number, lineIndex: number}|null}
 */
export function firstPendingTarget(order) {
  /** @type {Record<string, any>[]} */
  const groups = Array.isArray(order?.ficha?.sizePricing)
    ? order.ficha.sizePricing
    : [];
  const itemCount = order?.ficha?.items?.length ?? 0;
  /** @param {number} itemIndex */
  const openLine = (itemIndex) =>
    (groups[itemIndex]?.lines ?? []).findIndex(
      /** @param {Record<string, any>} line */
      (line) => line.subtotalCents === null || line.subtotalReviewed !== true,
    );
  const missing = Array.isArray(order?.missingFields)
    ? order.missingFields.map(String)
    : [];
  for (const field of missing) {
    if (field === 'items') return { kind: 'add-item' };
    const item = /^items\[(\d+)\]\.(\w+)$/u.exec(field);
    if (item) {
      const itemIndex = Number(item[1]);
      if (itemIndex >= itemCount) continue;
      return item[2] === 'grade'
        ? { itemIndex, kind: 'blank-size' }
        : { itemIndex, key: item[2], kind: 'field' };
    }
    const pricing = /^sizePricing\.([^.]+)(?:\.([^.]+))?$/u.exec(field);
    if (pricing) {
      const itemIndex = groups.findIndex((group) => group.id === pricing[1]);
      if (itemIndex === -1) continue;
      const lines = groups[itemIndex].lines ?? [];
      const lineIndex = pricing[2]
        ? lines.findIndex(
            /** @param {Record<string, any>} line */
            (line) => line.id === pricing[2],
          )
        : openLine(itemIndex);
      if (lineIndex !== -1) return { itemIndex, kind: 'subtotal', lineIndex };
      if (!pricing[2]) return { itemIndex, kind: 'blank-size' };
      continue;
    }
    if (field === 'sizePricing') {
      for (let itemIndex = 0; itemIndex < groups.length; itemIndex += 1) {
        const lineIndex = openLine(itemIndex);
        if (lineIndex !== -1) return { itemIndex, kind: 'subtotal', lineIndex };
      }
      // An order whose subtotals were never started: its sizes are in the
      // items, and the first of them is the first subtotal to type.
      if (!Array.isArray(order?.ficha?.sizePricing)) {
        const itemIndex = (order?.ficha?.items ?? []).findIndex(
          /** @param {Record<string, any>} one */
          (one) => Array.isArray(one?.grade) && one.grade.length > 0,
        );
        if (itemIndex !== -1)
          return { itemIndex, kind: 'subtotal', lineIndex: 0 };
      }
      return itemCount > 0
        ? { itemIndex: 0, kind: 'blank-size' }
        : { kind: 'add-item' };
    }
  }
  return null;
}
