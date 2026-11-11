<script setup>
import {
  computed,
  h,
  inject,
  nextTick,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { colorSwatch } from '../../lib/order-catalog.js';
import {
  amountLabel,
  AUDIENCE_OPTIONS,
  audienceLabel,
  duplicateSizeWarning,
  formatBrl,
  isDuplicateSize,
  itemPieces,
  itemQuantityLabel,
  itemQuantityWarning,
  orderSteps,
  sortedGrade,
} from '../../lib/order-format.js';
import {
  createSaveQueue,
  firstPendingTarget,
  gradeBlocksSubtotals,
  itemGaps,
  itemLines,
  MAX_ITEMS,
  MESSAGES,
  normalizeSize,
  NOT_APPLICABLE,
  parseInformedInput,
  parseQuantity,
  parseSizeList,
  parseSubtotalInput,
  persistenceMode,
  reconcileIdentity,
  runOperation,
  sameAttributes,
  sizeCollides,
  sizeTakenMessage,
  structuralHint,
} from '../../lib/order-items-inline.js';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

/*
 * EDIT-01 (ADR 083, design.md §20): "Itens e especificações" is edited in
 * place. Whoever may edit a pending order sees every field open; leaving a
 * field or pressing Enter saves that one change. There is no edit mode, no
 * "Editar itens" and no Salvar/Cancelar. A confirmed order and whoever cannot
 * edit read the same card as text (PFI-10).
 */
const SECTION = 'items';
const NOT_APPLICABLE_LABEL = 'Não aplicável';
const NOOP = Object.freeze({ noop: true });
const EMPTY_BLANK = Object.freeze({
  error: '',
  errorOn: '',
  hint: '',
  qty: '',
  size: '',
});

// PIT-01 (ADR 020): the points an item needs, in the order the ficha prints.
// PFI-14: every one is free typed text, never a list of options.
const CORE_FIELDS = Object.freeze([
  { caps: true, id: 'tipo', key: 'tipo', label: 'Modelo' },
  { caps: true, color: true, id: 'cor', key: 'cor', label: 'Cor' },
  {
    hint: 'Silk, DTF, sublimação, bordado… ou Sem estampa.',
    id: 'aplicacao',
    key: 'tipo_servico',
    label: 'Aplicação',
  },
  { id: 'malha', key: 'malhas', kind: 'malhas', label: 'Modelo de malha' },
  { caps: true, id: 'gola', key: 'gola', label: 'Gola' },
]);

// PIT-02 (amended by ADR 083): what the seller may add to an item, each one
// behind its own "+" and shown for good once it holds data. None of it blocks
// the order. Only sleeves and sleeve trim accept "Não aplicável" (PFI-07).
const OPTIONAL_GROUPS = Object.freeze([
  {
    add: 'Público',
    fields: [
      { id: 'publico', key: 'publico', kind: 'audience', label: 'Público' },
    ],
    id: 'publico',
  },
  {
    add: 'Estampa (referência)',
    fields: [
      {
        hint: 'O que vai estampado e onde, se ajudar a produção.',
        id: 'estampa',
        key: 'estampa',
        label: 'Estampa (referência)',
      },
    ],
    id: 'estampa',
  },
  {
    add: 'Cores por parte',
    fields: [
      {
        caps: true,
        color: true,
        id: 'cor_frente',
        key: 'cor_frente',
        label: 'Cor do tecido — frente',
      },
      {
        caps: true,
        color: true,
        id: 'cor_costas',
        key: 'cor_costas',
        label: 'Cor do tecido — costas',
      },
      {
        caps: true,
        color: true,
        id: 'cor_manga_direita',
        key: 'cor_manga_direita',
        label: 'Cor do tecido — manga direita',
        na: true,
      },
      {
        caps: true,
        color: true,
        id: 'cor_manga_esquerda',
        key: 'cor_manga_esquerda',
        label: 'Cor do tecido — manga esquerda',
        na: true,
      },
    ],
    id: 'partes',
  },
  {
    add: 'Viés das mangas',
    fields: [
      {
        caps: true,
        color: true,
        id: 'vies_mangas',
        key: 'vies_mangas',
        label: 'Viés das mangas',
        na: true,
      },
    ],
    id: 'vies_mangas',
  },
  {
    add: 'Detalhe do modelo',
    fields: [{ id: 'modelo', key: 'modelo', label: 'Detalhe do modelo' }],
    id: 'modelo',
  },
  {
    add: 'Quantidade informada',
    fields: [
      {
        hint: 'O que o cliente disse; não entra no total.',
        id: 'informada',
        key: 'quantidade_informada',
        kind: 'informed',
        label: 'Quantidade informada',
      },
    ],
    id: 'informada',
  },
]);

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const sheet = ref(null);
/** design.md §20 (SaveStatus): '' | 'saving' | 'saved'. */
const saveState = ref('');
/** What a screen reader hears after a merge or a copy (ADR 025). */
const announcement = ref('');
const menuUid = ref('');
const confirmUid = ref('');
/** True once the server refused `initialize` for the sizes as they are. */
const initializeRefused = ref(false);
/** What is typed and not yet saved, by item/line identity and field. */
/** @type {Record<string, {text: string}>} */
const drafts = reactive({});
/** @type {Record<string, {message: string, conflict?: boolean, retry?: (() => void)|null}>} */
const errors = reactive({});
/** @type {Record<string, {size: string, qty: string, hint: string, error: string, errorOn: string}>} */
const blanks = reactive({});
/** @type {Record<string, boolean>} */
const openOptionals = reactive({});
/** @type {Record<string, number>} */
const malhaExtras = reactive({});
/** @type {Record<string, string>} */
const beforeNotApplicable = {};

// A stable identity per item and size (see reconcileIdentity), so an order
// refreshed by a save or a live event never rebuilds the field in use.
const identity = shallowRef({ items: [] });
let uidSeed = 0;
let syncedOrder = null;
/** @type {Record<string, any>|null} */
let pendingHint = null;
/** How many saves of this section are waiting for their answer. */
let ownSaves = 0;
const newUid = () => `u${(uidSeed += 1)}`;

function syncIdentity() {
  if (props.order === syncedOrder) return;
  const hint = pendingHint;
  pendingHint = null;
  const before = identity.value;
  const next = reconcileIdentity(before, props.order, newUid, hint);
  // Without ids an identity is a position. When someone else's change adds
  // or removes an item or a size, what was typed no longer has a sure place:
  // it is dropped instead of landing on another line.
  const moved =
    before.items.length !== next.items.length ||
    next.items.some(
      (entry, index) =>
        entry.lines.length !== before.items[index]?.lines.length,
    );
  if (
    syncedOrder &&
    ownSaves === 0 &&
    moved &&
    persistenceMode(props.order) !== 'managed'
  ) {
    for (const store of [drafts, blanks]) {
      for (const key of Object.keys(store)) delete store[key];
    }
  }
  identity.value = next;
  syncedOrder = props.order;
}
watch(() => props.order, syncIdentity, { immediate: true });

const mode = computed(() => persistenceMode(props.order));
const canWrite = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
// A section still in the Editar/Salvar model holds the version it opened
// with; a save here would make its Salvar lose to a conflict (PFI-06).
const blocked = computed(
  () => canWrite.value && editing.editingSection.value !== '',
);
const editable = computed(() => canWrite.value && !blocked.value);
// "Salvo" speaks of the fields; it leaves with them.
watch(editable, (now) => {
  if (!now) saveState.value = '';
});
const uiState = computed(() =>
  editable.value ? 'edit' : blocked.value ? 'blocked' : 'read',
);
const showSubtotal = computed(() => mode.value !== 'plain');
const subtotalsBlocked = computed(
  () =>
    mode.value === 'initialize' &&
    (initializeRefused.value || gradeBlocksSubtotals(props.order.ficha.items)),
);
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);
const gaps = computed(() => itemGaps(props.order));

const cards = computed(() =>
  props.order.ficha.items.map(
    /** @param {Record<string, any>} item @param {number} index */
    (item, index) => {
      const entry = identity.value.items[index];
      return {
        groupId: entry?.id ?? null,
        index,
        item,
        n: index + 1,
        rows: itemLines(props.order, index).map((line, lineIndex) => ({
          ...line,
          index: lineIndex,
          uid: entry?.lines[lineIndex]?.uid ?? `l${lineIndex}`,
        })),
        uid: entry?.uid ?? `i${index}`,
      };
    },
  ),
);

// PFI-04: every total is summed from the sizes and never typed.
const totalPieces = computed(() =>
  props.order.ficha.items.reduce(
    /** @param {number} total @param {Record<string, any>} item */
    (total, item) => total + itemPieces(item),
    0,
  ),
);
const headline = computed(() => {
  const count = props.order.ficha.items.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${totalPieces.value} peças`;
});
// PFI-17: what the items still owe to "Gerar", in the words of the progress
// (PFI-15); with nothing missing, how many items and pieces there are.
const headState = computed(() => {
  const step = orderSteps(props.order).find((one) => one.key === 'items');
  if (step && !step.done) {
    return {
      text: step.missing.charAt(0).toUpperCase() + step.missing.slice(1),
      tone: 'missing',
    };
  }
  return {
    text: headline.value,
    tone: props.order.ficha.items.length ? 'ok' : 'neutral',
  };
});
const orderTotal = computed(() => {
  const cents = props.order.pricing?.totalCents;
  return cents == null ? '' : amountLabel(cents);
});

/* ------------------------------ reading ------------------------------ */

/** @param {number} count */
function piecesLabel(count) {
  return `${count} ${count === 1 ? 'peça' : 'peças'}`;
}

/** Historical front/back colours imply a whole garment colour only when equal. */
function itemColor(item) {
  return (
    item.cor ||
    (item.cor_frente && item.cor_frente === item.cor_costas
      ? item.cor_frente
      : '')
  );
}

/** @param {unknown} value */
function swatchOf(value) {
  if (value === NOT_APPLICABLE || !value) return '';
  return colorSwatch(value);
}

/** @param {Record<string, any>} item */
function itemName(item) {
  return [String(item.tipo ?? '').trim(), audienceLabel(item.publico)]
    .filter(Boolean)
    .join(' · ');
}

/** An older ficha carried the collar trim apart; it stays readable. */
function legacyCollarTrim(item) {
  const trim = String(item.vies_gola ?? '');
  return trim !== '' && item.gola && trim !== item.gola ? trim : '';
}

/**
 * The optional points that hold data, as text (PIT-02).
 *
 * @param {Record<string, any>} item
 */
function filledOptionals(item) {
  const points = [];
  if (legacyCollarTrim(item)) {
    points.push({ label: 'Viés da gola', value: legacyCollarTrim(item) });
  }
  for (const group of OPTIONAL_GROUPS) {
    for (const field of group.fields) {
      const raw = item[field.key];
      if (raw === null || raw === undefined || String(raw) === '') continue;
      points.push({
        label: field.label,
        muted: raw === NOT_APPLICABLE,
        swatch: field.color ? swatchOf(raw) : '',
        value:
          raw === NOT_APPLICABLE
            ? NOT_APPLICABLE_LABEL
            : field.kind === 'audience'
              ? audienceLabel(raw)
              : String(raw),
        wide: field.key === 'estampa',
      });
    }
  }
  return points;
}

/** @param {Record<string, any>} card */
function readRows(card) {
  return sortedGrade(card.item.grade).map((line) => ({
    ...line,
    subtotalCents: card.rows[line.index]?.subtotalCents ?? null,
  }));
}

/* ------------------------------ drafts ------------------------------- */

/** @param {string} uid @param {string} key */
const fieldKey = (uid, key) => `${uid}|${key}`;
/** @param {Record<string, any>} card @param {Record<string, any>} row @param {string} column */
const lineKey = (card, row, column) => `${card.uid}|${row.uid}|${column}`;

/**
 * EDIT-02/EDIT-03: one write per committed value. Enter and the blur that
 * follows it commit the same value twice; a write that failed is not sent
 * again by that second commit (a stale 409 would put back an error that
 * "Recarregar pedido" cleared). The mark of each refused write is kept here,
 * by job key, until the seller types again, the write succeeds or the order
 * is reloaded; "Tentar de novo" is the way to send the same value again.
 *
 * @type {Map<string, string>}
 */
const refusedMarks = new Map();
/** True while "Tentar de novo" sends a refused write again on purpose. */
let retrying = false;
/** Grows on every reload: an answer to a write sent before it is old news. */
let epoch = 0;

/** @param {string} key */
function forgetRefused(key) {
  refusedMarks.delete(key);
  // A fabric is typed in `malhas.N` and saved as the one value `malhas`.
  const malhas = /^(.*\|malhas)\.\d+$/u.exec(key);
  if (malhas) refusedMarks.delete(malhas[1]);
}

/** @param {string} key @param {string|undefined} mark */
function refusedBefore(key, mark) {
  return !retrying && mark !== undefined && refusedMarks.get(key) === mark;
}

/** @param {string} key @param {string} text */
function setDraft(key, text) {
  drafts[key] = { text };
  delete errors[key];
  forgetRefused(key);
}

/**
 * A saved draft gives way to the server's value, unless the seller typed on.
 *
 * @param {string} key @param {string} mark
 */
function settleDraft(key, mark) {
  if (drafts[key] && String(drafts[key].text).trim() === mark) {
    delete drafts[key];
  }
}

/** @param {Record<string, any>} item @param {string} key */
function storedText(item, key) {
  if (key === 'cor') return itemColor(item);
  if (key === 'gola') return item.gola || item.vies_gola || '';
  return item[key] === null || item[key] === undefined ? '' : String(item[key]);
}

/** @param {Record<string, any>} card @param {Record<string, any>} field */
function fieldText(card, field) {
  return (
    drafts[fieldKey(card.uid, field.key)]?.text ??
    storedText(card.item, field.key)
  );
}

/** @param {Record<string, any>} card @param {Record<string, any>} field */
function isNotApplicable(card, field) {
  return Boolean(field.na) && fieldText(card, field) === NOT_APPLICABLE;
}

/** @param {Record<string, any>} card @param {string} key */
function hasGap(card, key) {
  return gaps.value.fields[card.index]?.includes(key) ?? false;
}

/** @param {Record<string, any>} card @param {Record<string, any>} field */
function fieldId(card, field) {
  return `item-${card.index}-${field.id}`;
}

/**
 * design.md §20 (FieldGap): the description, the pendência and the error a
 * field is described by, in that order.
 *
 * @param {Record<string, any>} card @param {Record<string, any>} field
 */
function describedBy(card, field) {
  const id = fieldId(card, field);
  return (
    [
      field.hint ? `${id}-hint` : '',
      hasGap(card, field.key) ? `${id}-gap` : '',
      errors[fieldKey(card.uid, field.key)] ? `${id}-error` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

/* --------------------------- optional fields ------------------------- */

/** @param {Record<string, any>} card @param {Record<string, any>} group */
function optionalShown(card, group) {
  return (
    openOptionals[fieldKey(card.uid, group.id)] ||
    group.fields.some(
      /** @param {Record<string, any>} field */
      (field) => fieldText(card, field) !== '',
    )
  );
}

/** @param {Record<string, any>} card */
function shownFields(card) {
  return [
    ...CORE_FIELDS,
    ...OPTIONAL_GROUPS.filter((group) => optionalShown(card, group)).flatMap(
      (group) => group.fields,
    ),
  ];
}

/** @param {Record<string, any>} card */
function hiddenOptionals(card) {
  return OPTIONAL_GROUPS.filter((group) => !optionalShown(card, group));
}

/**
 * An optional field in use stays on screen even when emptied, so it never
 * leaves from under the cursor.
 *
 * @param {Record<string, any>} card
 */
function keepOptional(card, event) {
  const key = event.target.closest?.('[data-field]')?.dataset.field;
  const group = OPTIONAL_GROUPS.find((one) =>
    one.fields.some((field) => field.key === key),
  );
  if (group) openOptionals[fieldKey(card.uid, group.id)] = true;
}

/** @param {Record<string, any>} card @param {Record<string, any>} group */
async function showOptional(card, group) {
  openOptionals[fieldKey(card.uid, group.id)] = true;
  await nextTick();
  focusId(fieldId(card, group.fields[0]));
}

/* ------------------------------- focus ------------------------------- */

/** @param {string} id */
function focusId(id) {
  const element = globalThis.document?.getElementById(id);
  element?.focus();
  return Boolean(element);
}

/** @param {...string} ids */
async function focusFirst(...ids) {
  await nextTick();
  ids.some((id) => focusId(id));
}

/**
 * A save answers later than the seller types. The focus a save moves when it
 * returns goes only if it is still where the action left it (or nowhere):
 * whoever went on typing keeps the caret.
 *
 * @param {Element|null|undefined} anchor @param {...string} ids
 */
async function moveFocus(anchor, ...ids) {
  await nextTick();
  const now = globalThis.document?.activeElement;
  const held =
    !now ||
    now === anchor ||
    now === globalThis.document.body ||
    !now.isConnected;
  if (held) ids.some((id) => focusId(id));
}

/** The element an action starts from, for moveFocus. */
function focusAnchor() {
  return globalThis.document?.activeElement ?? null;
}

/**
 * What a screen reader hears. The text is emptied first so the same
 * sentence said twice in a row is announced twice.
 *
 * @param {string} text
 */
async function announce(text) {
  announcement.value = '';
  await nextTick();
  announcement.value = text;
}

/** Focus the first control of the place an error button sat in. */
async function focusNear(origin) {
  if (origin?.closest?.('#order-items-add-error')) {
    await nextTick();
    focusId('order-items-add');
    return;
  }
  const place = origin?.closest?.('[data-field], .op-size-row, .op-item');
  await nextTick();
  const target =
    (place?.isConnected ? place : sheet.value)?.querySelector(
      'input:not(:disabled), button:not(:disabled)',
    ) ?? null;
  target?.focus();
}

/* ------------------------------- queue ------------------------------- */

/**
 * @typedef {{key: string, mark?: string, epoch?: number, build: () => Record<string, any>|null, after?: (result: Record<string, any>) => unknown, rollback?: (result: Record<string, any>|null) => void, retry?: () => void}} Job
 */

const io = {
  getOrder: () => props.order,
  /** @param {string} section @param {unknown} value */
  async save(section, value) {
    ownSaves += 1;
    try {
      const result = await editing.save(section, value);
      // The next command is built from the order this answer brought.
      await nextTick();
      syncIdentity();
      return result;
    } finally {
      ownSaves -= 1;
    }
  },
};

/** @param {string} uid */
function indexOfUid(uid) {
  syncIdentity();
  return identity.value.items.findIndex((entry) => entry.uid === uid);
}

/** @param {string} uid @param {string} rowUid */
function locate(uid, rowUid) {
  const itemIndex = indexOfUid(uid);
  const lineIndex =
    identity.value.items[itemIndex]?.lines.findIndex(
      (line) => line.uid === rowUid,
    ) ?? -1;
  return itemIndex === -1 || lineIndex === -1 ? null : { itemIndex, lineIndex };
}

// The saves run strictly one after the other (see createSaveQueue). The
// error stays at the field with what was typed; what was queued behind it
// is not sent over an order that did not change as expected.
const saveQueue = createSaveQueue({
  async execute(queued, sending) {
    const job = /** @type {Job} */ (queued);
    const op = job.build();
    if (op === null) return { code: 'TARGET_GONE', ok: false };
    if (op === NOOP) return { noop: true, ok: true };
    sending();
    pendingHint = structuralHint(op);
    // Sizes the screen already knows `initialize` refuses are not asked.
    const skipInitialize = gradeBlocksSubtotals(props.order.ficha.items);
    try {
      const result = await runOperation(op, { ...io, skipInitialize });
      if (!skipInitialize && result.initializeBlocked !== undefined) {
        initializeRefused.value = result.initializeBlocked;
      }
      return result;
    } finally {
      pendingHint = null;
    }
  },
  onFailure(queued, failure, result) {
    const job = /** @type {Job} */ (queued);
    // Sent before "Recarregar pedido": the order it spoke of is gone.
    if (job.epoch !== epoch) return;
    if (job.mark !== undefined) refusedMarks.set(job.key, job.mark);
    errors[job.key] = {
      ...failure,
      retry: failure.conflict ? null : (job.retry ?? null),
    };
    job.rollback?.(result);
  },
  onState(state) {
    saveState.value = state;
  },
});

/**
 * @param {Job} job
 * @returns {boolean} false when nothing was queued
 */
function enqueue(job) {
  if (refusedBefore(job.key, job.mark)) return false;
  const after = job.after;
  job.epoch = epoch;
  job.after = async (result) => {
    refusedMarks.delete(job.key);
    await after?.(result);
  };
  if (!saveQueue.enqueue(job)) return false;
  delete errors[job.key];
  return true;
}

/**
 * A draft equal to what the order holds, with nothing on its way, is no
 * draft: dropping it on blur lets a later refresh show in the field.
 *
 * @param {string} key @param {unknown} stored @param {string} [jobKey]
 */
function dropStaleDraft(key, stored, jobKey = key) {
  if (
    drafts[key] &&
    String(drafts[key].text).trim() === String(stored ?? '').trim() &&
    !saveQueue.isPending(jobKey)
  ) {
    delete drafts[key];
  }
}

/**
 * VERSION_CONFLICT: the way out is the order as the server has it. What was
 * typed and the error stay until that order really arrives.
 */
async function reloadOrder(event) {
  const origin = event?.currentTarget;
  const replaced = await editing.reload?.();
  if (replaced !== true) return;
  epoch += 1;
  refusedMarks.clear();
  for (const store of [drafts, errors, blanks]) {
    for (const key of Object.keys(store)) delete store[key];
  }
  saveState.value = '';
  await focusNear(origin);
}

/** @param {{retry?: (() => void)|null}} error */
async function retryWrite(error, event) {
  // The focus is settled first, so the retried save knows where it started.
  await focusNear(event?.currentTarget);
  retrying = true;
  try {
    error.retry?.();
  } finally {
    retrying = false;
  }
}

/** The error under a field, with its way out (design.md §20, SaveStatus). */
const FieldError = (context) =>
  context.error
    ? h('p', { class: 'op-field-error', id: context.id, role: 'alert' }, [
        h('span', context.error.message),
        context.error.conflict
          ? h(
              'button',
              {
                class: 'link-button',
                onClick: reloadOrder,
                type: 'button',
              },
              'Recarregar pedido',
            )
          : context.error.retry
            ? h(
                'button',
                {
                  class: 'link-button',
                  onClick: (event) => retryWrite(context.error, event),
                  type: 'button',
                },
                'Tentar de novo',
              )
            : null,
      ])
    : null;
FieldError.props = ['error', 'id'];

/* --------------------------- item attributes ------------------------- */

/**
 * @param {string} uid @param {string} key @param {Record<string, any>} attributes
 * @param {string} mark @param {(() => unknown)} [after]
 */
function saveAttributes(uid, key, attributes, mark, after) {
  enqueue({
    after: async () => {
      settleDraft(key, mark);
      await after?.();
    },
    build: () => {
      const itemIndex = indexOfUid(uid);
      if (itemIndex === -1) return null;
      return sameAttributes(props.order.ficha.items[itemIndex], attributes)
        ? NOOP
        : { attributes, itemIndex, type: 'setAttributes' };
    },
    key,
    mark,
    retry: () => saveAttributes(uid, key, attributes, mark, after),
  });
}

/**
 * A text field saves on change (blur or Enter), trimmed and otherwise as
 * typed, only when it differs from what the order holds.
 *
 * @param {Record<string, any>} card @param {Record<string, any>} field @param {string} raw
 */
function commitField(card, field, raw) {
  const key = fieldKey(card.uid, field.key);
  /** @type {Record<string, any>} */
  let attributes;
  if (field.kind === 'informed') {
    const parsed = parseInformedInput(raw);
    if (!parsed.ok) {
      errors[key] = { message: parsed.message };
      return;
    }
    attributes = { quantidade_informada: parsed.value };
  } else attributes = { [field.key]: String(raw).trim() };
  if (!drafts[key] && sameAttributes(card.item, attributes)) {
    delete errors[key];
    return;
  }
  saveAttributes(card.uid, key, attributes, String(raw).trim());
}

/**
 * An older ficha shows its colour or collar from another key (equal front
 * and back colours, `vies_gola`); with the point still listed as missing,
 * leaving the field stores what the screen shows. That holds with no
 * `change` event (the text typed again as it was) and with a draft on screen;
 * a save of this field already on its way is not doubled (EDIT-02, EDIT-04).
 *
 * @param {Record<string, any>} card @param {Record<string, any>} field
 */
function onFieldBlur(card, field, event) {
  const key = fieldKey(card.uid, field.key);
  const value = String(event.target.value);
  if (
    hasGap(card, field.key) &&
    value.trim() !== '' &&
    !saveQueue.isPending(key)
  ) {
    commitField(card, field, value);
    return;
  }
  dropStaleDraft(key, storedText(card.item, field.key));
}

/** @param {Record<string, any>} card @param {string} value */
function toggleAudience(card, value) {
  const key = fieldKey(card.uid, 'publico');
  const current = drafts[key]?.text ?? card.item.publico ?? '';
  const next = current === value ? '' : value;
  setDraft(key, next);
  saveAttributes(card.uid, key, { publico: next }, next);
}

/**
 * Turning it off restores what was typed before: an unpressed chip means
 * "there is a colour here", not "erase it" (PFI-07).
 *
 * @param {Record<string, any>} card @param {Record<string, any>} field
 */
function toggleNotApplicable(card, field) {
  const key = fieldKey(card.uid, field.key);
  const current = fieldText(card, field);
  let next = NOT_APPLICABLE;
  if (current === NOT_APPLICABLE) next = beforeNotApplicable[key] ?? '';
  else beforeNotApplicable[key] = String(current).trim();
  setDraft(key, next);
  saveAttributes(card.uid, key, { [field.key]: next }, next);
}

/** @param {Record<string, any>} card */
function malhaCount(card) {
  return (
    Math.max(1, card.item.malhas?.length ?? 0) + (malhaExtras[card.uid] ?? 0)
  );
}

/** @param {Record<string, any>} card @param {number} index */
function malhaText(card, index) {
  return (
    drafts[fieldKey(card.uid, `malhas.${index}`)]?.text ??
    card.item.malhas?.[index] ??
    ''
  );
}

/**
 * The fabrics are one value: the entries in order, an emptied one dropped.
 *
 * @param {Record<string, any>} card
 */
function commitMalhas(card) {
  const { uid } = card;
  const key = fieldKey(uid, 'malhas');
  const count = malhaCount(card);
  const texts = Array.from({ length: count }, (_, index) =>
    String(malhaText(card, index)),
  );
  const malhas = texts.map((text) => text.trim()).filter(Boolean);
  const save = () =>
    enqueue({
      after: () => {
        texts.forEach((text, index) => {
          const draftKey = fieldKey(uid, `malhas.${index}`);
          if (drafts[draftKey]?.text === text) delete drafts[draftKey];
        });
        // The inputs on screen stay as many as they were.
        malhaExtras[uid] = Math.max(0, count - Math.max(1, malhas.length));
      },
      build: () => {
        const itemIndex = indexOfUid(uid);
        if (itemIndex === -1) return null;
        return sameAttributes(props.order.ficha.items[itemIndex], { malhas })
          ? NOOP
          : { attributes: { malhas }, itemIndex, type: 'setAttributes' };
      },
      key,
      mark: JSON.stringify(malhas),
      retry: save,
    });
  save();
}

/** @param {Record<string, any>} card @param {number} index */
function onMalhaBlur(card, index) {
  dropStaleDraft(
    fieldKey(card.uid, `malhas.${index}`),
    card.item.malhas?.[index],
    fieldKey(card.uid, 'malhas'),
  );
}

/** @param {Record<string, any>} card */
async function addMalha(card) {
  const index = malhaCount(card);
  malhaExtras[card.uid] = (malhaExtras[card.uid] ?? 0) + 1;
  await focusFirst(`item-${card.index}-malha-${index}`);
}

/* -------------------------------- sizes ------------------------------ */

/** @param {Record<string, any>} card @param {Record<string, any>} row @param {string} column */
function lineText(card, row, column) {
  const draft = drafts[lineKey(card, row, column)];
  return draft ? draft.text : storedLineText(row, column);
}

/** @param {Record<string, any>} row @param {string} column */
function storedLineText(row, column) {
  if (column === 'size') return row.size;
  if (column === 'qty') return String(row.quantity ?? '');
  return formatBrl(row.subtotalCents);
}

/** @param {Record<string, any>} card @param {Record<string, any>} row @param {string} column */
function onLineBlur(card, row, column) {
  dropStaleDraft(lineKey(card, row, column), storedLineText(row, column));
}

/** @param {Record<string, any>} card @param {Record<string, any>} row */
function lineError(card, row) {
  return (
    errors[lineKey(card, row, 'size')] ??
    errors[lineKey(card, row, 'qty')] ??
    errors[lineKey(card, row, 'sub')] ??
    errors[lineKey(card, row, 'row')] ??
    null
  );
}

/** The size as the names of its row say it. */
function sizeName(card, row) {
  return normalizeSize(lineText(card, row, 'size')) || 'sem nome';
}

/**
 * OLIST-43: the server lists the size whose subtotal is missing or was not
 * reviewed after a change; the subtotal field carries that pendência.
 *
 * @param {Record<string, any>} card @param {Record<string, any>} row
 */
function lineGap(card, row) {
  if (!showSubtotal.value || subtotalsBlocked.value) return false;
  const open = row.subtotalCents === null || !row.reviewed;
  // Before the subtotals are started the server lists them as one key.
  if (!card.groupId) return gaps.value.pricing && open;
  if (gaps.value.lines.includes(`${card.groupId}.${row.id}`)) return true;
  return (
    (gaps.value.pricing || gaps.value.groups.includes(card.groupId)) && open
  );
}

/**
 * OLIST-43: the sizes of an item whose subtotal is set and waits for a
 * second look; two or more get one "Manter os N subtotais".
 *
 * @param {Record<string, any>} card
 */
function unreviewedRows(card) {
  if (mode.value !== 'managed') return [];
  return card.rows.filter(
    /** @param {Record<string, any>} row */
    (row) => row.subtotalCents !== null && !row.reviewed,
  );
}

/** @param {Record<string, any>} card */
function keepAllSubtotals(card) {
  const { uid } = card;
  const first = unreviewedRows(card)[0];
  const save = (anchor = focusAnchor()) =>
    enqueue({
      after: async () => {
        const at = first ? locate(uid, first.uid) : null;
        if (!at) return;
        // The button leaves with the pendências; the focus goes to the first.
        await moveFocus(
          anchor,
          `item-${at.itemIndex}-subtotal-${at.lineIndex}`,
        );
      },
      build: () => {
        const itemIndex = indexOfUid(uid);
        if (itemIndex === -1) return null;
        const pending = itemLines(props.order, itemIndex).some(
          (line) => line.subtotalCents !== null && !line.reviewed,
        );
        return pending ? { itemIndex, type: 'keepSubtotals' } : NOOP;
      },
      key: fieldKey(uid, 'keep-all'),
      retry: () => save(),
    });
  save();
}

/**
 * The line under a size: the error, what its subtotal still needs, or the
 * price per piece as a check (never typed, never stored).
 *
 * @param {Record<string, any>} card @param {Record<string, any>} row
 */
function lineNote(card, row) {
  if (lineError(card, row)) return { tone: 'error' };
  if (!showSubtotal.value || subtotalsBlocked.value) return null;
  if (row.subtotalCents === null) {
    return { text: 'Falta o subtotal', tone: 'warning' };
  }
  if (!row.reviewed) {
    return {
      keep: `Manter ${amountLabel(row.subtotalCents)}`,
      text: 'Confira o subtotal.',
      tone: 'warning',
    };
  }
  const quantity = Number(row.quantity);
  const each = quantity > 0 ? Math.round(row.subtotalCents / quantity) : 0;
  return each > 0
    ? { text: `${amountLabel(each)} por peça`, tone: 'muted' }
    : null;
}

/**
 * @param {Record<string, any>} card @param {Record<string, any>} row @param {string} column
 * @param {string} mark @param {Record<string, any>} op
 * @param {(line: Record<string, any>) => boolean} isSame
 * @param {(anchor: Element|null) => unknown} [after]
 */
function saveLine(card, row, column, mark, op, isSame, after) {
  const key = lineKey(card, row, column);
  const { uid } = card;
  const rowUid = row.uid;
  // EDIT-01: the anchor is taken at each enqueue, a retry included.
  const save = (anchor = focusAnchor()) =>
    enqueue({
      after: async () => {
        settleDraft(key, mark);
        await after?.(anchor);
      },
      build: () => {
        const at = locate(uid, rowUid);
        if (!at) return null;
        const line = itemLines(props.order, at.itemIndex)[at.lineIndex];
        return isSame(line) ? NOOP : { ...op, ...at };
      },
      key,
      mark,
      retry: () => save(),
    });
  save();
}

/** @returns {boolean} false when the value was refused here */
function commitSize(card, row, raw) {
  const key = lineKey(card, row, 'size');
  const size = normalizeSize(raw);
  let message = '';
  if (size === '') message = MESSAGES.sizeRequired;
  else if (size.length > 200) message = MESSAGES.sizeLength;
  else if (sizeCollides(card.rows, row.index, size)) {
    message = sizeTakenMessage(size);
  }
  if (message) {
    errors[key] = { message };
    return false;
  }
  if (!drafts[key] && size === row.size) return true;
  saveLine(
    card,
    row,
    'size',
    String(raw).trim(),
    { size, type: 'renameLine' },
    (line) => line.size === size,
  );
  return true;
}

/** @returns {boolean} false when the value was refused here */
function commitQuantity(card, row, raw) {
  const key = lineKey(card, row, 'qty');
  const quantity = parseQuantity(raw);
  if (quantity === null) {
    errors[key] = { message: MESSAGES.quantity };
    return false;
  }
  if (!drafts[key] && Number(row.quantity) === quantity) return true;
  saveLine(
    card,
    row,
    'qty',
    String(raw).trim(),
    { quantity, type: 'setQuantity' },
    (line) => Number(line.quantity) === quantity,
  );
  return true;
}

/** @returns {boolean} false when the value was refused here */
function commitSubtotal(card, row, raw) {
  const key = lineKey(card, row, 'sub');
  const parsed = parseSubtotalInput(raw);
  if (!parsed.ok) {
    errors[key] = { message: parsed.message };
    return false;
  }
  const { cents } = parsed;
  /** @param {Record<string, any>} line */
  const isSame = (line) =>
    line.subtotalCents === cents && (cents === null || line.reviewed);
  if (!drafts[key] && isSame(row)) return true;
  saveLine(
    card,
    row,
    'sub',
    String(raw).trim(),
    { subtotalCents: cents, type: 'setSubtotal' },
    isSame,
  );
  return true;
}

/**
 * OLIST-43: a changed quantity asks a human to look at the subtotal again;
 * "Manter" is that look, sending the same amount as reviewed.
 */
function keepSubtotal(card, row) {
  const cents = row.subtotalCents;
  const { uid } = card;
  const rowUid = row.uid;
  saveLine(
    card,
    row,
    'sub',
    `keep:${cents}`,
    { subtotalCents: cents, type: 'setSubtotal' },
    (line) => line.subtotalCents === cents && line.reviewed,
    async (anchor) => {
      const at = locate(uid, rowUid);
      // The button is gone with the pendência; the focus stays on its line.
      if (at) {
        await moveFocus(
          anchor,
          `item-${at.itemIndex}-subtotal-${at.lineIndex}`,
        );
      }
    },
  );
}

function removeLine(card, row) {
  const { uid } = card;
  const rowUid = row.uid;
  const key = lineKey(card, row, 'row');
  const save = (anchor = focusAnchor()) =>
    enqueue({
      after: async () => {
        for (const column of ['size', 'qty', 'sub']) {
          delete drafts[`${uid}|${rowUid}|${column}`];
          delete errors[`${uid}|${rowUid}|${column}`];
        }
        const itemIndex = indexOfUid(uid);
        // design.md §20: the focus goes to the next size or to the BlankRow.
        await moveFocus(
          anchor,
          `item-${itemIndex}-qty-${row.index}`,
          `item-${itemIndex}-new-size`,
        );
      },
      // A second click finds the size already gone: nothing left to do.
      build: () => {
        const at = locate(uid, rowUid);
        return at ? { ...at, type: 'removeLine' } : NOOP;
      },
      key,
      retry: () => save(),
    });
  save();
}

/** Enter walks the sizes like a spreadsheet (design.md §20, BlankRow). */
function onLineEnter(card, row, column, event) {
  event.preventDefault();
  const raw = event.target.value;
  const accepted =
    column === 'size'
      ? commitSize(card, row, raw)
      : column === 'qty'
        ? commitQuantity(card, row, raw)
        : commitSubtotal(card, row, raw);
  if (!accepted) return;
  const subtotal = showSubtotal.value && !subtotalsBlocked.value;
  if (column === 'size') focusId(`item-${card.index}-qty-${row.index}`);
  else if (column === 'qty' && subtotal) {
    focusId(`item-${card.index}-subtotal-${row.index}`);
  } else {
    focusId(`item-${card.index}-qty-${row.index + 1}`) ||
      focusId(`item-${card.index}-new-size`);
  }
}

/* ------------------------------ BlankRow ----------------------------- */

/** @param {string} uid */
function blankOf(uid) {
  return blanks[uid] ?? EMPTY_BLANK;
}

/** @param {string} uid @param {Record<string, string>} patch */
function setBlank(uid, patch) {
  blanks[uid] = { ...blankOf(uid), ...patch };
}

function onBlankInput(card, column, event) {
  setBlank(card.uid, {
    error: '',
    errorOn: '',
    hint: '',
    [column]: event.target.value,
  });
  delete errors[fieldKey(card.uid, 'blank')];
  forgetRefused(fieldKey(card.uid, 'blank'));
}

/** True while the blank row holds nothing the seller typed. */
function blankIsEmpty(uid) {
  const state = blankOf(uid);
  return state.size === '' && state.qty === '';
}

/**
 * design.md §20: the blank row becomes a size once it has a size and a whole
 * quantity; a list typed or pasted in the size cell becomes all its sizes,
 * and a size the item already has is added to its line.
 *
 * @param {Record<string, any>} card
 * @param {boolean} follow whether the focus goes on to what was created
 * @param {Element|null} [from] where the focus is left while the save runs
 * @returns {'empty'|'held'|'refused'|'need-quantity'|'sent'}
 */
function submitBlank(card, follow, from) {
  const { uid } = card;
  const state = blankOf(uid);
  const parsed = parseSizeList(state.size);
  if (parsed.kind === 'empty') return 'empty';
  if (parsed.kind === 'invalid') {
    setBlank(uid, { error: parsed.message, errorOn: 'size', hint: '' });
    return 'refused';
  }
  /** @type {{size: string, quantity: number}[]} */
  let pairs;
  if (parsed.kind === 'pairs') pairs = parsed.pairs;
  else {
    if (String(state.qty).trim() === '') return 'need-quantity';
    const quantity = parseQuantity(state.qty);
    if (quantity === null) {
      setBlank(uid, { error: MESSAGES.quantity, errorOn: 'qty', hint: '' });
      return 'refused';
    }
    pairs = [{ quantity, size: parsed.size }];
  }
  // What goes back to the row when the save is refused.
  let typed = { qty: state.qty, size: state.size };
  const key = fieldKey(uid, 'blank');
  /** The sizes asked for, as one value: the same list is the same commit. */
  const markOf = () =>
    JSON.stringify(pairs.map((pair) => [pair.size, pair.quantity]));
  // Enter and then leaving the row, with the first write refused, would send
  // it again; the row keeps what was typed and the error says why.
  if (refusedBefore(key, markOf())) return 'held';
  const save = (anchor = from ?? focusAnchor()) => {
    setBlank(uid, { ...EMPTY_BLANK });
    enqueue({
      after: async (result) => {
        const itemIndex = indexOfUid(uid);
        const steps = result.lines ?? [];
        const merged = steps.filter((step) => step.kind === 'merge');
        if (merged.length > 0) {
          void announce(
            merged
              .map(
                (step) =>
                  `O tamanho ${step.size} já estava no item ${itemIndex + 1}: a quantidade foi somada e agora é ${step.quantity}.`,
              )
              .join(' '),
          );
        }
        // Whoever went on typing the next size keeps the caret there.
        if (!follow || !blankIsEmpty(uid)) return;
        const last = identity.value.items[itemIndex]?.lines.length - 1;
        const toSubtotal =
          steps.length === 1 &&
          steps[0].kind === 'add' &&
          showSubtotal.value &&
          !subtotalsBlocked.value;
        await moveFocus(
          anchor,
          toSubtotal ? `item-${itemIndex}-subtotal-${last}` : '',
          `item-${itemIndex}-new-size`,
        );
      },
      build: () => {
        const itemIndex = indexOfUid(uid);
        return itemIndex === -1 ? null : { itemIndex, pairs, type: 'addLines' };
      },
      key,
      mark: markOf(),
      // A retry starts from where "Tentar de novo" left the focus.
      retry: () => save(focusAnchor()),
      // A list refused halfway keeps only the sizes not written yet: a
      // retry, Enter or leaving the row must not add the others twice.
      rollback: (result) => {
        const remaining = result?.remaining;
        if (remaining && remaining.length < pairs.length) {
          pairs = remaining;
          typed =
            remaining.length === 1
              ? {
                  qty: String(remaining[0].quantity),
                  size: remaining[0].size,
                }
              : {
                  qty: '',
                  size: remaining
                    .map((pair) => `${pair.size} ${pair.quantity}`)
                    .join(', '),
                };
          // What the row gets back is what was refused.
          refusedMarks.set(key, markOf());
        }
        if (blankIsEmpty(uid)) setBlank(uid, typed);
      },
    });
  };
  save();
  return 'sent';
}

function onBlankSizeEnter(card, event) {
  event.preventDefault();
  const outcome = submitBlank(card, true);
  if (outcome === 'need-quantity') focusId(`item-${card.index}-new-qty`);
}

function onBlankQuantityEnter(card, event) {
  event.preventDefault();
  const outcome = submitBlank(card, true);
  if (outcome === 'empty') focusId(`item-${card.index}-new-size`);
  else if (outcome === 'need-quantity') askQuantity(card);
}

/**
 * design.md §20 (BlankRow): a size without its quantity is incomplete, not
 * wrong; the row keeps it and says what it lacks, without an error.
 *
 * @param {Record<string, any>} card
 */
function askQuantity(card) {
  setBlank(card.uid, { error: '', errorOn: '', hint: MESSAGES.needQuantity });
  void announce(MESSAGES.needQuantity);
}

/** A pasted list creates its sizes at once; one size alone waits. */
function onBlankPaste(card) {
  globalThis.setTimeout(() => {
    const parsed = parseSizeList(blankOf(card.uid).size);
    if (parsed.kind === 'pairs' || parsed.kind === 'invalid') {
      submitBlank(card, true);
    }
  }, 0);
}

let tabbedOut = '';
function onBlankTab(card, event) {
  if (event.shiftKey) return;
  tabbedOut = card.uid;
  globalThis.setTimeout(() => {
    tabbedOut = '';
  }, 0);
}

/**
 * Leaving the row with a size and a quantity creates the size. Only Tab
 * carries the focus on to the new subtotal; a click elsewhere keeps it there.
 */
function onBlankFocusOut(card, event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  // The save starts from where Tab took the focus, not from the row it left.
  const outcome = submitBlank(
    card,
    tabbedOut === card.uid,
    event.relatedTarget ?? globalThis.document?.body ?? null,
  );
  if (outcome === 'need-quantity') askQuantity(card);
}

/** @param {Record<string, any>} card */
function sizesHint(card) {
  return card.rows.length > 0
    ? 'A linha em branco é o próximo tamanho.'
    : 'Digite o primeiro tamanho na linha em branco. Para vários de uma vez, cole “P 20 M 60 G 50”.';
}

/* ------------------------------- totals ------------------------------ */

/** @param {Record<string, any>} card */
function cardPieces(card) {
  return card.rows.reduce(
    /** @param {number} total @param {Record<string, any>} row */
    (total, row) => {
      const draft = drafts[lineKey(card, row, 'qty')];
      const typed = draft ? parseQuantity(draft.text) : null;
      return (
        total + (typed ?? (Number.parseInt(String(row.quantity), 10) || 0))
      );
    },
    0,
  );
}

/**
 * The server's subtotal of the item once it has one; before that, and while
 * a subtotal is being typed, the sum of what the sizes show.
 *
 * @param {Record<string, any>} card
 */
function cardMoney(card) {
  if (!showSubtotal.value) return '';
  let typing = false;
  const sum = card.rows.reduce(
    /** @param {number} total @param {Record<string, any>} row */
    (total, row) => {
      const draft = drafts[lineKey(card, row, 'sub')];
      const parsed = draft ? parseSubtotalInput(draft.text) : null;
      if (parsed?.ok) {
        typing = true;
        return total + (parsed.cents ?? 0);
      }
      return total + (row.subtotalCents ?? 0);
    },
    0,
  );
  const server = props.order.pricing?.groups?.find(
    /** @param {Record<string, any>} group */
    (group) => group.id === card.groupId,
  )?.subtotalCents;
  const cents = !typing && server != null ? server : sum;
  return cents > 0 ? amountLabel(cents) : '';
}

/**
 * PIT-09: an item with no sizes yet says what the customer informed, in the
 * words the reading view gives its Quantidade ("— (cliente informou 30
 * peças)"); edited in place, the card has no Quantidade, so its pieces say it.
 *
 * @param {Record<string, any>} card
 */
function cardTotal(card) {
  const money = cardMoney(card);
  const count = editable.value ? cardPieces(card) : itemPieces(card.item);
  const said =
    editable.value && count === 0 && itemPieces(card.item) === 0
      ? itemQuantityLabel(card.item, card.index, props.order)
      : '—';
  const pieces = said === '—' ? piecesLabel(count) : said;
  return money ? `${pieces} · ${money}` : pieces;
}

/* ----------------------------- item actions -------------------------- */

/** @param {Record<string, any>} card */
async function toggleMenu(card) {
  if (menuUid.value === card.uid) {
    menuUid.value = '';
    return;
  }
  menuUid.value = card.uid;
  confirmUid.value = '';
  await nextTick();
  menuItems(card.index)[0]?.focus();
}

/** @param {number} index */
function menuItems(index) {
  return [
    ...(globalThis.document
      ?.getElementById(`item-${index}-menu-list`)
      ?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? []),
  ];
}

function onMenuKeydown(card, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    menuUid.value = '';
    focusId(`item-${card.index}-menu`);
    return;
  }
  const items = menuItems(card.index);
  const at = items.indexOf(event.target);
  const next = {
    ArrowDown: items[(at + 1) % items.length],
    ArrowUp: items[(at - 1 + items.length) % items.length],
    End: items.at(-1),
    Home: items[0],
  }[event.key];
  if (!next || at === -1) return;
  event.preventDefault();
  next.focus();
}

function onMenuFocusOut(card, event) {
  if (menuUid.value !== card.uid) return;
  if (!event.currentTarget.contains(event.relatedTarget)) menuUid.value = '';
}

/** A chosen action closes the menu and leaves the focus on its button. */
function closeMenu(card) {
  menuUid.value = '';
  focusId(`item-${card.index}-menu`);
}

/**
 * @param {Record<string, any>} card @param {(itemIndex: number) => Record<string, any>} op
 * @param {(itemIndex: number, anchor: Element|null) => unknown} after
 * @param {boolean} [settledWhenGone] moving or removing an item that is no
 *   longer there has nothing left to do
 */
function saveItem(card, op, after, settledWhenGone = false) {
  const { uid } = card;
  const save = (anchor = focusAnchor()) =>
    enqueue({
      after: () => after(indexOfUid(uid), anchor),
      build: () => {
        const itemIndex = indexOfUid(uid);
        if (itemIndex === -1) return settledWhenGone ? NOOP : null;
        return op(itemIndex);
      },
      key: fieldKey(uid, 'item'),
      retry: () => save(),
    });
  save();
}

/**
 * ADR 025 (D7): a copy right below with everything but the sizes and the
 * quantity said, so each audience of a split gets its own item. The focus
 * goes to the copy's audience, the field the seller changes next.
 */
function duplicateItem(card) {
  closeMenu(card);
  saveItem(
    card,
    (itemIndex) => ({ itemIndex, type: 'duplicateItem' }),
    async (itemIndex, anchor) => {
      const copy = identity.value.items[itemIndex + 1];
      if (!copy) return;
      openOptionals[fieldKey(copy.uid, 'publico')] = true;
      void announce(
        `Item ${itemIndex + 2} criado como cópia do item ${itemIndex + 1}.`,
      );
      await moveFocus(anchor, `item-${itemIndex + 1}-publico`);
    },
  );
}

/** @param {Record<string, any>} card @param {number} delta */
function moveItem(card, delta) {
  closeMenu(card);
  saveItem(
    card,
    (itemIndex) => ({ delta, itemIndex, type: 'moveItem' }),
    (itemIndex, anchor) => moveFocus(anchor, `item-${itemIndex}-menu`),
    true,
  );
}

/** design.md §20 (InlineConfirm): asked inside the card, focus on "Manter". */
async function askRemove(card) {
  menuUid.value = '';
  confirmUid.value = card.uid;
  await focusFirst(`item-${card.index}-keep`);
}

function keepItem(card) {
  confirmUid.value = '';
  focusId(`item-${card.index}-menu`);
}

function removeItem(card) {
  const { index } = card;
  keepItem(card);
  saveItem(
    card,
    (itemIndex) => ({ itemIndex, type: 'removeItem' }),
    (_, anchor) =>
      moveFocus(
        anchor,
        `item-${index}-menu`,
        `item-${index - 1}-menu`,
        'order-items-add',
      ),
    true,
  );
}

function addItem() {
  const save = (anchor = focusAnchor()) =>
    enqueue({
      after: () =>
        moveFocus(anchor, `item-${props.order.ficha.items.length - 1}-tipo`),
      build: () => ({ type: 'addItem' }),
      key: 'section|add',
      retry: () => save(),
    });
  save();
}

/* --------------------------- "Completar itens" ----------------------- */

/** The control that fills the first thing the server still asks for. */
function pendingElementId() {
  const target = firstPendingTarget(props.order);
  if (!target) return '';
  if (target.kind === 'add-item') return 'order-items-add';
  if (target.kind === 'blank-size') return `item-${target.itemIndex}-new-size`;
  if (target.kind === 'subtotal') {
    // With the subtotals blocked the way on is to fix the sizes first.
    return subtotalsBlocked.value || !showSubtotal.value
      ? `item-${target.itemIndex}-size-${target.lineIndex}`
      : `item-${target.itemIndex}-subtotal-${target.lineIndex}`;
  }
  const field = CORE_FIELDS.find((one) => one.key === target.key);
  if (!field) return '';
  return field.kind === 'malhas'
    ? `item-${target.itemIndex}-malha-0`
    : `item-${target.itemIndex}-${field.id}`;
}

// PFI-15/PFI-16: "Completar itens" (the progress, the footer or "Gerar
// pedido") brings the items into view and puts the focus on the first
// pending field; with no field to offer it only brings them into view.
watch(
  () => editing.editRequest?.value,
  async (request) => {
    if (request?.section !== SECTION) return;
    await nextTick();
    sheet.value?.scrollIntoView?.({ block: 'start' });
    if (!editable.value) return;
    await nextTick();
    const element =
      globalThis.document?.getElementById(pendingElementId()) ??
      sheet.value?.querySelector('#order-items-body input:not(:disabled)') ??
      globalThis.document?.getElementById('order-items-add');
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'center' });
  },
);
</script>

<template>
  <section
    ref="sheet"
    class="op-sheet"
    aria-labelledby="order-items-title"
    :data-items-state="uiState"
    :data-items-mode="mode"
  >
    <OrderSheetHead
      title-id="order-items-title"
      title="Itens e especificações"
      :state="headState.text"
      :tone="headState.tone"
      :can-edit="false"
      section="items"
      body-id="order-items-body"
    >
      <template #status>
        <!-- design.md §20 (SaveStatus): the one status region of the section. -->
        <p
          class="op-save-status"
          :class="{ 'op-visually-hidden': saveState === '' }"
          role="status"
          :data-save-status="saveState || 'idle'"
        >
          <template v-if="saveState === 'saving'">Salvando…</template>
          <template v-else-if="saveState === 'saved'">
            <OrderIcon name="check" />Salvo
          </template>
        </p>
      </template>
    </OrderSheetHead>

    <div
      id="order-items-body"
      class="op-sheet-body op-item-list"
      :class="{ 'op-items-edit': editable }"
      :hidden="!open"
    >
      <p v-if="blocked" class="op-hint op-items-blocked">
        Salve ou cancele a edição aberta para alterar os itens.
      </p>

      <p v-if="!cards.length" class="op-items-empty">
        <strong>Nenhum item ainda</strong>
        <span v-if="editable"
          >Comece pelo modelo; o resto pode ser preenchido em qualquer
          ordem.</span
        >
      </p>

      <div
        v-for="card in cards"
        :key="card.uid"
        class="op-item"
        role="group"
        :aria-labelledby="`item-${card.index}-title`"
        :data-item-index="card.index"
        :data-group-id="card.groupId || undefined"
      >
        <div class="op-item-head">
          <h3 :id="`item-${card.index}-title`" class="op-item-title">
            <span class="op-visually-hidden">Item </span>
            <span class="op-item-number op-num">{{ card.n }}</span>
            <span
              class="op-item-name"
              :data-empty="itemName(card.item) === '' || undefined"
              >{{
                itemName(card.item) || (editable ? 'Novo item' : 'Sem modelo')
              }}</span
            >
          </h3>
          <p class="op-item-meta op-num">{{ cardTotal(card) }}</p>
          <div
            v-if="editable"
            class="op-item-menu"
            @focusout="onMenuFocusOut(card, $event)"
            @keydown="menuUid === card.uid && onMenuKeydown(card, $event)"
          >
            <button
              :id="`item-${card.index}-menu`"
              type="button"
              class="op-icon-button op-item-menu-button"
              aria-haspopup="menu"
              :aria-expanded="menuUid === card.uid ? 'true' : 'false'"
              :aria-controls="
                menuUid === card.uid
                  ? `item-${card.index}-menu-list`
                  : undefined
              "
              @click="toggleMenu(card)"
            >
              <OrderIcon name="more" />
              <span class="op-visually-hidden"
                >Mais ações do item {{ card.n }}</span
              >
            </button>
            <div
              v-if="menuUid === card.uid"
              :id="`item-${card.index}-menu-list`"
              class="op-item-menu-list"
              role="menu"
              :aria-label="`Ações do item ${card.n}`"
            >
              <button
                type="button"
                role="menuitem"
                :disabled="cards.length >= MAX_ITEMS"
                @click="duplicateItem(card)"
              >
                <OrderIcon name="copy" />Duplicar para outro público
              </button>
              <button
                type="button"
                role="menuitem"
                :disabled="card.index === 0"
                @click="moveItem(card, -1)"
              >
                <OrderIcon name="up" />Mover para cima
              </button>
              <button
                type="button"
                role="menuitem"
                :disabled="card.index === cards.length - 1"
                @click="moveItem(card, 1)"
              >
                <OrderIcon name="down" />Mover para baixo
              </button>
              <button
                type="button"
                role="menuitem"
                data-danger
                @click="askRemove(card)"
              >
                <OrderIcon name="trash" />Remover item
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="editable && confirmUid === card.uid"
          class="op-inline-confirm"
          role="group"
          :aria-labelledby="`item-${card.index}-confirm`"
          @keydown.esc.prevent="keepItem(card)"
        >
          <p :id="`item-${card.index}-confirm`">
            Remover o item {{ card.n }} e os tamanhos dele?
          </p>
          <button
            :id="`item-${card.index}-keep`"
            type="button"
            @click="keepItem(card)"
          >
            Manter
          </button>
          <button type="button" class="danger" @click="removeItem(card)">
            Remover
          </button>
        </div>
        <FieldError
          v-if="editable"
          :id="`item-${card.index}-error`"
          :error="errors[fieldKey(card.uid, 'item')]"
        />

        <!-- Editing in place: a Field em linha per point, sizes beside. -->
        <div v-if="editable" class="op-item-body">
          <div class="op-specs" @focusin="keepOptional(card, $event)">
            <template v-for="field in shownFields(card)" :key="field.key">
              <div
                v-if="field.kind === 'malhas'"
                class="op-inline-field"
                data-field="malhas"
              >
                <label :for="`item-${card.index}-malha-0`">{{
                  field.label
                }}</label>
                <div class="op-inline-control">
                  <input
                    v-for="(_, malhaIndex) in malhaCount(card)"
                    :id="`item-${card.index}-malha-${malhaIndex}`"
                    :key="malhaIndex"
                    type="text"
                    maxlength="200"
                    autocomplete="off"
                    autocapitalize="characters"
                    :value="malhaText(card, malhaIndex)"
                    :aria-label="
                      malhaIndex > 0
                        ? `Modelo de malha ${malhaIndex + 1}`
                        : undefined
                    "
                    :aria-required="hasGap(card, 'malhas') ? 'true' : undefined"
                    :aria-invalid="
                      errors[fieldKey(card.uid, 'malhas')] ? 'true' : undefined
                    "
                    :aria-describedby="
                      [
                        hasGap(card, 'malhas')
                          ? `item-${card.index}-malha-gap`
                          : '',
                        errors[fieldKey(card.uid, 'malhas')]
                          ? `item-${card.index}-malha-error`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    "
                    @input="
                      setDraft(
                        fieldKey(card.uid, `malhas.${malhaIndex}`),
                        $event.target.value,
                      )
                    "
                    @change="commitMalhas(card)"
                    @blur="onMalhaBlur(card, malhaIndex)"
                    @keydown.enter.prevent="commitMalhas(card)"
                  />
                  <span
                    v-if="hasGap(card, 'malhas')"
                    :id="`item-${card.index}-malha-gap`"
                    class="badge op-field-gap"
                    data-tone="warning"
                    ><OrderIcon name="alert" />Falta<span
                      class="op-visually-hidden"
                    >
                      para gerar o pedido</span
                    ></span
                  >
                  <FieldError
                    :id="`item-${card.index}-malha-error`"
                    :error="errors[fieldKey(card.uid, 'malhas')]"
                  />
                  <button
                    type="button"
                    class="op-add-inline"
                    @click="addMalha(card)"
                  >
                    <OrderIcon name="plus" />Outra malha
                  </button>
                </div>
              </div>

              <div
                v-else-if="field.kind === 'audience'"
                class="op-inline-field"
                data-field="publico"
                role="group"
                :aria-labelledby="`item-${card.index}-publico-label`"
              >
                <span
                  :id="`item-${card.index}-publico-label`"
                  class="op-inline-label"
                  >{{ field.label }}</span
                >
                <div class="op-inline-control">
                  <div class="op-chip-group">
                    <button
                      v-for="(option, optionIndex) in AUDIENCE_OPTIONS"
                      :id="
                        optionIndex === 0
                          ? `item-${card.index}-publico`
                          : undefined
                      "
                      :key="option.value"
                      type="button"
                      class="op-toggle-chip"
                      :aria-pressed="
                        fieldText(card, field) === option.value
                          ? 'true'
                          : 'false'
                      "
                      @click="toggleAudience(card, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                  <FieldError
                    :id="`item-${card.index}-publico-error`"
                    :error="errors[fieldKey(card.uid, 'publico')]"
                  />
                </div>
              </div>

              <div v-else class="op-inline-field" :data-field="field.key">
                <label :for="fieldId(card, field)">{{ field.label }}</label>
                <div class="op-inline-control">
                  <div class="op-inline-input">
                    <span
                      v-if="field.color && swatchOf(fieldText(card, field))"
                      class="op-swatch"
                      :style="{
                        background: swatchOf(fieldText(card, field)),
                      }"
                      aria-hidden="true"
                    ></span>
                    <input
                      :id="fieldId(card, field)"
                      type="text"
                      :maxlength="field.kind === 'informed' ? 6 : 200"
                      autocomplete="off"
                      :autocapitalize="field.caps ? 'characters' : undefined"
                      :inputmode="
                        field.kind === 'informed' ? 'numeric' : undefined
                      "
                      :class="{ 'op-num': field.kind === 'informed' }"
                      :value="
                        isNotApplicable(card, field)
                          ? NOT_APPLICABLE_LABEL
                          : fieldText(card, field)
                      "
                      :disabled="isNotApplicable(card, field)"
                      :aria-required="
                        hasGap(card, field.key) ? 'true' : undefined
                      "
                      :aria-invalid="
                        errors[fieldKey(card.uid, field.key)]
                          ? 'true'
                          : undefined
                      "
                      :aria-describedby="describedBy(card, field)"
                      @input="
                        setDraft(
                          fieldKey(card.uid, field.key),
                          $event.target.value,
                        )
                      "
                      @change="commitField(card, field, $event.target.value)"
                      @blur="onFieldBlur(card, field, $event)"
                      @keydown.enter.prevent="
                        commitField(card, field, $event.target.value)
                      "
                    />
                    <button
                      v-if="field.na"
                      type="button"
                      class="op-toggle-chip"
                      :aria-pressed="
                        isNotApplicable(card, field) ? 'true' : 'false'
                      "
                      :aria-label="`Não aplicável: ${field.label}`"
                      @click="toggleNotApplicable(card, field)"
                    >
                      Não aplicável
                    </button>
                  </div>
                  <p
                    v-if="field.hint"
                    :id="`${fieldId(card, field)}-hint`"
                    class="op-hint"
                  >
                    {{ field.hint }}
                  </p>
                  <span
                    v-if="hasGap(card, field.key)"
                    :id="`${fieldId(card, field)}-gap`"
                    class="badge op-field-gap"
                    data-tone="warning"
                    ><OrderIcon name="alert" />Falta<span
                      class="op-visually-hidden"
                    >
                      para gerar o pedido</span
                    ></span
                  >
                  <FieldError
                    :id="`${fieldId(card, field)}-error`"
                    :error="errors[fieldKey(card.uid, field.key)]"
                  />
                </div>
              </div>

              <div
                v-if="field.key === 'gola' && legacyCollarTrim(card.item)"
                class="op-inline-field"
                data-field="vies_gola"
              >
                <span class="op-inline-label">Viés da gola</span>
                <p class="op-inline-text">{{ legacyCollarTrim(card.item) }}</p>
              </div>
            </template>

            <div
              v-if="hiddenOptionals(card).length"
              class="op-optional-adds"
              role="group"
              :aria-label="`Adicionais do item ${card.n}, não obrigatórios`"
            >
              <button
                v-for="group in hiddenOptionals(card)"
                :key="group.id"
                type="button"
                class="op-add-inline"
                :data-optional="group.id"
                @click="showOptional(card, group)"
              >
                <OrderIcon name="plus" />{{ group.add }}
              </button>
            </div>
          </div>

          <div class="op-sizes" :data-priced="showSubtotal || undefined">
            <div class="op-sizes-head" aria-hidden="true">
              <span>Tamanho</span>
              <span>Quantidade</span>
              <span v-if="showSubtotal">Subtotal</span>
            </div>
            <ul
              class="op-sizes-rows"
              :aria-label="`Tamanhos do item ${card.n}`"
            >
              <li
                v-for="row in card.rows"
                :key="row.uid"
                class="op-size-row"
                :data-line-index="row.index"
                :data-line-id="row.id || undefined"
                :data-duplicate="
                  isDuplicateSize(card.item.grade, row.size) || undefined
                "
              >
                <input
                  :id="`item-${card.index}-size-${row.index}`"
                  class="op-size-input"
                  type="text"
                  maxlength="200"
                  autocomplete="off"
                  autocapitalize="characters"
                  enterkeyhint="next"
                  :value="lineText(card, row, 'size')"
                  :aria-label="`Tamanho, linha ${row.index + 1} do item ${card.n}`"
                  :aria-invalid="
                    errors[lineKey(card, row, 'size')] ? 'true' : undefined
                  "
                  :aria-describedby="
                    lineError(card, row)
                      ? `item-${card.index}-line-${row.index}-note`
                      : undefined
                  "
                  @input="
                    setDraft(lineKey(card, row, 'size'), $event.target.value)
                  "
                  @change="commitSize(card, row, $event.target.value)"
                  @blur="onLineBlur(card, row, 'size')"
                  @keydown.enter="onLineEnter(card, row, 'size', $event)"
                />
                <input
                  :id="`item-${card.index}-qty-${row.index}`"
                  class="op-qty-input op-num"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  autocomplete="off"
                  enterkeyhint="next"
                  :value="lineText(card, row, 'qty')"
                  :aria-label="`Quantidade do tamanho ${sizeName(card, row)}, item ${card.n}`"
                  :aria-invalid="
                    errors[lineKey(card, row, 'qty')] ? 'true' : undefined
                  "
                  :aria-describedby="
                    lineError(card, row)
                      ? `item-${card.index}-line-${row.index}-note`
                      : undefined
                  "
                  @input="
                    setDraft(lineKey(card, row, 'qty'), $event.target.value)
                  "
                  @change="commitQuantity(card, row, $event.target.value)"
                  @blur="onLineBlur(card, row, 'qty')"
                  @keydown.enter="onLineEnter(card, row, 'qty', $event)"
                />
                <input
                  v-if="showSubtotal"
                  :id="`item-${card.index}-subtotal-${row.index}`"
                  class="op-subtotal-input op-num"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  enterkeyhint="next"
                  :value="lineText(card, row, 'sub')"
                  :disabled="subtotalsBlocked"
                  :data-review="
                    (row.subtotalCents !== null && !row.reviewed) || undefined
                  "
                  :aria-label="`Subtotal do tamanho ${sizeName(card, row)}, item ${card.n}`"
                  :aria-required="lineGap(card, row) ? 'true' : undefined"
                  :aria-invalid="
                    errors[lineKey(card, row, 'sub')] ? 'true' : undefined
                  "
                  :aria-describedby="
                    subtotalsBlocked
                      ? `item-${card.index}-sizes-blocked`
                      : `item-${card.index}-line-${row.index}-note`
                  "
                  @input="
                    setDraft(lineKey(card, row, 'sub'), $event.target.value)
                  "
                  @change="commitSubtotal(card, row, $event.target.value)"
                  @blur="onLineBlur(card, row, 'sub')"
                  @keydown.enter="onLineEnter(card, row, 'sub', $event)"
                />
                <button
                  :id="`item-${card.index}-remove-${row.index}`"
                  type="button"
                  class="op-icon-button op-icon-button--quiet op-size-remove"
                  @click="removeLine(card, row)"
                >
                  <OrderIcon name="x" />
                  <span class="op-visually-hidden"
                    >Remover tamanho {{ sizeName(card, row) }} do item
                    {{ card.n }}</span
                  >
                </button>
                <div
                  :id="`item-${card.index}-line-${row.index}-note`"
                  class="op-size-note op-num"
                  :data-tone="lineNote(card, row)?.tone"
                >
                  <FieldError
                    v-if="lineError(card, row)"
                    :error="lineError(card, row)"
                  />
                  <template v-else-if="lineNote(card, row)">
                    <OrderIcon
                      v-if="lineNote(card, row).tone === 'warning'"
                      name="alert"
                    />
                    <span>{{ lineNote(card, row).text }}</span>
                    <button
                      v-if="lineNote(card, row).keep"
                      type="button"
                      class="link-button"
                      @click="keepSubtotal(card, row)"
                    >
                      {{ lineNote(card, row).keep }}
                    </button>
                  </template>
                </div>
              </li>

              <!-- design.md §20 (BlankRow): always the last, never a size. -->
              <li
                class="op-size-row"
                data-blank-row
                @focusout="onBlankFocusOut(card, $event)"
              >
                <input
                  :id="`item-${card.index}-new-size`"
                  class="op-size-input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="characters"
                  enterkeyhint="next"
                  :value="blankOf(card.uid).size"
                  :aria-label="`Novo tamanho do item ${card.n}`"
                  :aria-required="hasGap(card, 'grade') ? 'true' : undefined"
                  :aria-invalid="
                    blankOf(card.uid).errorOn === 'size' ||
                    errors[fieldKey(card.uid, 'blank')]
                      ? 'true'
                      : undefined
                  "
                  :aria-describedby="
                    [
                      `item-${card.index}-sizes-hint`,
                      hasGap(card, 'grade')
                        ? `item-${card.index}-grade-gap`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  "
                  @input="onBlankInput(card, 'size', $event)"
                  @paste="onBlankPaste(card)"
                  @keydown.enter="onBlankSizeEnter(card, $event)"
                />
                <input
                  :id="`item-${card.index}-new-qty`"
                  class="op-qty-input op-num"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  autocomplete="off"
                  enterkeyhint="done"
                  :value="blankOf(card.uid).qty"
                  :aria-label="`Quantidade do novo tamanho do item ${card.n}`"
                  :aria-invalid="
                    blankOf(card.uid).errorOn === 'qty' ? 'true' : undefined
                  "
                  :aria-describedby="`item-${card.index}-sizes-hint`"
                  @input="onBlankInput(card, 'qty', $event)"
                  @keydown.enter="onBlankQuantityEnter(card, $event)"
                  @keydown.tab="onBlankTab(card, $event)"
                />
              </li>
            </ul>

            <div :id="`item-${card.index}-sizes-hint`" class="op-sizes-hint">
              <FieldError
                v-if="errors[fieldKey(card.uid, 'blank')]"
                :error="errors[fieldKey(card.uid, 'blank')]"
              />
              <p
                v-else-if="blankOf(card.uid).error"
                role="alert"
                class="op-field-error"
              >
                {{ blankOf(card.uid).error }}
              </p>
              <p v-else class="op-hint">
                {{ blankOf(card.uid).hint || sizesHint(card) }}
              </p>
            </div>
            <span
              v-if="hasGap(card, 'grade')"
              :id="`item-${card.index}-grade-gap`"
              class="badge op-field-gap"
              data-tone="warning"
              ><OrderIcon name="alert" />Falta<span class="op-visually-hidden">
                para gerar o pedido</span
              ></span
            >
            <p
              v-if="subtotalsBlocked && card.rows.length"
              :id="`item-${card.index}-sizes-blocked`"
              class="op-quantity-warning"
            >
              <OrderIcon name="alert" />{{ MESSAGES.sizesBlocked }}
            </p>

            <p class="op-item-total op-num">
              <span>Total do item</span>
              <strong>{{ cardTotal(card) }}</strong>
            </p>
            <!-- OLIST-43: a change to the item un-reviews all its subtotals;
                 one look keeps them all. -->
            <div v-if="unreviewedRows(card).length > 1" class="op-keep-all">
              <button
                :id="`item-${card.index}-keep-all`"
                type="button"
                class="link-button"
                @click="keepAllSubtotals(card)"
              >
                Manter os {{ unreviewedRows(card).length }} subtotais
              </button>
            </div>
            <FieldError
              :id="`item-${card.index}-keep-all-error`"
              :error="errors[fieldKey(card.uid, 'keep-all')]"
            />
            <p
              v-if="itemQuantityWarning(card.item)"
              class="op-quantity-warning"
            >
              <OrderIcon name="alert" />{{ itemQuantityWarning(card.item) }}
            </p>
            <p
              v-if="duplicateSizeWarning(card.item.grade)"
              class="op-quantity-warning"
            >
              <OrderIcon name="alert" />{{
                duplicateSizeWarning(card.item.grade)
              }}
            </p>
          </div>
        </div>

        <!-- Reading (PFI-10): the same card as text, as the ficha prints. -->
        <template v-else>
          <dl class="op-points">
            <div>
              <dt>Modelo</dt>
              <dd>{{ card.item.tipo || '—' }}</dd>
            </div>
            <div>
              <dt>Cor</dt>
              <dd>
                <span
                  v-if="swatchOf(itemColor(card.item))"
                  class="op-swatch"
                  :style="{ background: swatchOf(itemColor(card.item)) }"
                  aria-hidden="true"
                ></span>
                {{ itemColor(card.item) || '—' }}
              </dd>
            </div>
            <div>
              <dt>Quantidade</dt>
              <dd class="op-num">
                {{ itemQuantityLabel(card.item, card.index, order) }}
              </dd>
            </div>
            <div class="op-point--wide">
              <dt>Aplicação</dt>
              <dd>{{ card.item.tipo_servico || '—' }}</dd>
            </div>
            <div>
              <dt>Modelo de malha</dt>
              <dd>{{ (card.item.malhas ?? []).join(' / ') || '—' }}</dd>
            </div>
            <div class="op-point--wide">
              <dt>Tamanhos</dt>
              <dd>
                <!-- Pesquisa UX 2026-10-15, achado 4: size and quantity with
                     the same weight, in the order the floor counts them. -->
                <ul
                  v-if="card.item.grade?.length"
                  class="op-grade-tiles"
                  :aria-label="`Tamanhos do item ${card.n}`"
                >
                  <li
                    v-for="line in sortedGrade(card.item.grade)"
                    :key="line.index"
                    :data-duplicate="
                      isDuplicateSize(card.item.grade, line.tamanho) ||
                      undefined
                    "
                  >
                    <span class="op-grade-tile-size">{{ line.tamanho }}</span>
                    <span class="op-grade-tile-qty op-num"
                      >{{ line.quantidade
                      }}<span class="op-visually-hidden">
                        {{ Number(line.quantidade) === 1 ? 'peça' : 'peças' }}
                      </span></span
                    >
                    <span
                      v-if="isDuplicateSize(card.item.grade, line.tamanho)"
                      class="op-visually-hidden"
                      >, tamanho repetido</span
                    >
                  </li>
                </ul>
                <template v-else>—</template>
              </dd>
            </div>
            <div>
              <dt>Gola</dt>
              <dd>{{ card.item.gola || card.item.vies_gola || '—' }}</dd>
            </div>
            <div
              v-for="point in filledOptionals(card.item)"
              :key="point.label"
              :class="{ 'op-point--wide': point.wide }"
            >
              <dt>{{ point.label }}</dt>
              <dd :data-muted="point.muted || undefined">
                <span
                  v-if="point.swatch"
                  class="op-swatch"
                  :style="{ background: point.swatch }"
                  aria-hidden="true"
                ></span>
                {{ point.value }}
              </dd>
            </div>
          </dl>

          <!-- OLIST-43: what each size was sold for, once the order has it. -->
          <table
            v-if="mode === 'managed' && card.rows.length"
            class="op-size-prices"
          >
            <caption class="op-visually-hidden">
              Tamanhos e subtotais do item
              {{
                card.n
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Tamanho</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in readRows(card)" :key="line.index">
                <th scope="row">{{ line.tamanho }}</th>
                <td class="op-num">{{ line.quantidade }}</td>
                <td class="op-num">
                  <template v-if="line.subtotalCents !== null">{{
                    amountLabel(line.subtotalCents)
                  }}</template>
                  <span v-else class="op-size-prices-gap"
                    ><OrderIcon name="alert" />Falta o subtotal</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
          <p class="op-item-total op-num">
            <span>Total do item</span>
            <strong>{{ cardTotal(card) }}</strong>
          </p>
          <p v-if="itemQuantityWarning(card.item)" class="op-quantity-warning">
            <OrderIcon name="alert" />{{ itemQuantityWarning(card.item) }}
          </p>
          <p
            v-if="duplicateSizeWarning(card.item.grade)"
            class="op-quantity-warning"
          >
            <OrderIcon name="alert" />{{
              duplicateSizeWarning(card.item.grade)
            }}
          </p>
        </template>
      </div>

      <template v-if="editable && cards.length < MAX_ITEMS">
        <button
          id="order-items-add"
          type="button"
          class="op-add-item"
          @click="addItem"
        >
          <OrderIcon name="plus" />Adicionar item
        </button>
        <FieldError id="order-items-add-error" :error="errors['section|add']" />
      </template>

      <p v-if="cards.length" class="op-items-total op-num">
        <span>Total do pedido</span>
        <strong
          >{{ piecesLabel(totalPieces)
          }}<template v-if="orderTotal"> · {{ orderTotal }}</template></strong
        >
      </p>
      <p class="op-visually-hidden" aria-live="polite" data-items-announcement>
        {{ announcement }}
      </p>
    </div>
  </section>
</template>
