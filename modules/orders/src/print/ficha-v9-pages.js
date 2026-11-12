// FPI-12 (ADR 087): the sheets of the v9 ficha. Each item prints two sheets, a
// front (header, order, item, observations with ruled lines) and a back
// (header, order, production control, art), followed by the continuation
// sheets, if any. The document has no script, so the server decides what goes
// on each sheet from estimated heights in CSS pixels, with the glyph widths and
// the rules of text wrapping that `ficha-v8-pages.js` measures: the estimate
// costs a ruled line, never a sheet.
import {
  SHEET_BODY,
  gradeLayout,
  itemBlocks,
  splitNotes,
  textLines,
} from './ficha-v8-pages.js';

export { SHEET_BODY, splitNotes, textLines };

// Lengths follow the 4px scale of design.md §6 and mirror the stylesheet of
// ficha-canonical-v9.js: panel padding and gaps are 20px, or 12px and 8px on a
// compact sheet; a label is 20px of line plus 4px over its value.
const FOOT = 28;
const PANEL_GAP = 20;
// Padding of 20px on both sides; the 1px border is paid out of it.
const PANEL_PADDING = 40;
const ROW_GAP = 20;
const LINE = 20;
const LABEL = 20;
// The text of a panel: 689.7px minus the 20px the list numbers take.
const NOTES_WIDTH = 668;
// A section title: 24px of line and 8px to what follows.
const SECTION_TITLE = 32;
const COMPACT = Object.freeze({
  chrome: 24,
  gap: 8,
  row: 12,
  band: 48,
  // Control grid: caption row, three fields, the taller OBS field, 4 gaps.
  stages: 16 + 3 * 40 + 64 + 4 * 8,
});
const NORMAL = Object.freeze({
  chrome: PANEL_PADDING,
  gap: PANEL_GAP,
  row: ROW_GAP,
  band: 56,
  stages: 16 + 3 * 48 + 80 + 4 * 12,
});
// The observations on the front: 13px type on 20px lines and 4px between two
// of them; the ruled lines are 24px apart and there are at least three.
const NOTE_FONT = 13;
const NOTE_GAP = 4;
const RULE_PITCH = 24;
const RULED_MIN = 3 * RULE_PITCH;
// The notice "Observações do pedido continuam na folha N de M": one line of 20px.
const NOTICE = 20;
// The art box of the back never shrinks below this; its caption is 13px type
// on 20px lines under 4px.
const ART_BOX_MIN = 96;
// Continuation sheets give back a little room so an estimate never costs one.
const CONTINUATION_SLACK = 16;
const CONTINUATION_TITLE = PANEL_GAP + PANEL_PADDING + 24;
const LIST_TABLE_TOP = 2 + 24;
const LIST_TOTAL = 33;

/**
 * Pixels of n of the twelve columns with their 8px gutters. A column is
 * 49.97px: rounding it to 50 is wider by under a pixel in three columns, and
 * the text estimates carry a larger margin than that.
 */
const span = (/** @type {number} */ columns) =>
  50 * columns + 8 * (columns - 1);

/**
 * @typedef {import('./ficha-v8-pages.js').SheetItem} SheetItem
 * @typedef {import('./ficha-v8-pages.js').SheetOrder} SheetOrder
 * @typedef {'r1' | 'r2' | 'r3'} RowKey
 * @typedef {{
 *   itemIndex: number, compact: boolean, moved: RowKey[], gradeKept: number,
 *   notesKept: number, versoCompact: boolean, versoTight: boolean,
 * }} ItemPlanV9
 * @typedef {{itemIndex: number, compact: boolean, rows: RowKey[], grade: {from: number, to: number} | null}} CarriedSection
 * @typedef {{carries: boolean, compact: boolean, sections: CarriedSection[], notes: number[], free: boolean}} ExtraPlanV9
 */

/**
 * The header: the audience band, then brand, order and dates on one row.
 *
 * @param {SheetOrder} order
 * @param {boolean} [compact]
 */
function headHeight(order, compact = false) {
  const meta = Math.max(
    48,
    LABEL + textLines(order.numero || '—', span(3), 24) * 28,
    LABEL + textLines(order.data || '—', span(3), 24) * 28,
    LABEL + textLines(order.previsao || '—', span(3), 24) * 28,
  );
  const sizes = compact ? COMPACT : NORMAL;
  return sizes.band + (compact ? 8 : 12) + meta + sizes.gap;
}

/**
 * The "Dados do pedido" section: title (the pointer to the back sheet shares
 * its line) and the four fields of one row.
 *
 * @param {SheetOrder} order
 * @param {boolean} compact
 */
function clientHeight(order, compact) {
  const font = compact ? 13 : 14;
  return (
    SECTION_TITLE +
    LABEL +
    Math.max(
      textLines(order.cliente, span(3), font),
      textLines(order.nome, span(3), font),
      textLines(order.vendedor, span(3), font),
      textLines(order.entregue, span(3), font),
    ) *
      LINE
  );
}

/**
 * What a note takes in the observations list: its lines in 13px type, then the
 * gap to the next one.
 *
 * @param {string} note
 */
const noteHeight = (note) =>
  textLines(note, NOTES_WIDTH, NOTE_FONT, { preserve: true }) * LINE + NOTE_GAP;

const ROW_ORDER = /** @type {RowKey[]} */ (['r3', 'r2', 'r1']);

/**
 * How many whole notes, from the first, fit in `inner` pixels of the panel
 * with the three ruled lines (and the notice when some are left over).
 *
 * @param {number[]} heights
 * @param {number} inner
 */
function notesThatFit(heights, inner) {
  const prefix = [0];
  for (const height of heights) prefix.push(prefix[prefix.length - 1] + height);
  for (let kept = heights.length; kept > 0; kept -= 1) {
    const notice = kept < heights.length ? NOTICE : 0;
    if (prefix[kept] + notice + RULED_MIN <= inner) return kept;
  }
  return 0;
}

/**
 * The front of one item: what stays on it and how many observations fit under
 * it. A sheet that cannot hold the item data sends whole rows and then whole
 * blocks of the grade to a continuation sheet, always with a notice; the
 * observations panel shrinks to its minimum before that happens.
 *
 * @param {SheetOrder} order
 * @param {SheetItem} item
 * @param {number} itemIndex
 * @param {number[]} noteHeights
 * @returns {{compact: boolean, moved: RowKey[], gradeKept: number, notesKept: number}}
 */
function planFront(order, item, itemIndex, noteHeights) {
  const unitCount = gradeLayout(item.grade).units.length;
  const hasNotes = noteHeights.length > 0;
  /**
   * The height of the sheet without the observations panel.
   *
   * @param {boolean} compact
   * @param {Set<RowKey>} present
   * @param {number} gradeKeep
   */
  const above = (compact, present, gradeKeep) => {
    const blocks = itemBlocks(item, compact, gradeKeep);
    const sizes = compact ? COMPACT : NORMAL;
    const rows = [...present].map((key) => blocks[key]);
    const movedNotice = present.size < 3 ? sizes.row + LINE : 0;
    // Title, then each row and the grade, with a row gap between them.
    const item$ =
      sizes.chrome +
      SECTION_TITLE +
      rows.reduce((sum, height) => sum + height, 0) +
      blocks.grade +
      rows.length * sizes.row +
      movedNotice;
    return (
      headHeight(order, compact) +
      sizes.chrome +
      clientHeight(order, compact) +
      sizes.gap +
      item$ +
      sizes.gap +
      FOOT
    );
  };
  // The least the panel can be: its padding, title and three ruled lines, and
  // the notice when the observations may not fit.
  const minimum = (/** @type {boolean} */ compact) =>
    (compact ? COMPACT : NORMAL).chrome +
    SECTION_TITLE +
    RULED_MIN +
    (hasNotes ? NOTICE : 0);
  const total = (
    /** @type {boolean} */ compact,
    /** @type {Set<RowKey>} */ present,
    /** @type {number} */ gradeKeep,
  ) => above(compact, present, gradeKeep) + minimum(compact);
  const all = new Set(ROW_ORDER);
  const compact = total(false, all, unitCount) > SHEET_BODY;
  /** @type {RowKey[]} */
  const moved = [];
  const present = new Set(ROW_ORDER);
  for (const key of ROW_ORDER) {
    if (total(compact, present, unitCount) <= SHEET_BODY) break;
    present.delete(key);
    moved.unshift(key);
  }
  let gradeKept = unitCount;
  while (gradeKept > 0 && total(compact, present, gradeKept) > SHEET_BODY) {
    gradeKept -= 1;
  }
  const sizes = compact ? COMPACT : NORMAL;
  const inner =
    SHEET_BODY -
    above(compact, present, gradeKept) -
    sizes.chrome -
    SECTION_TITLE;
  return {
    compact,
    moved,
    gradeKept,
    notesKept: hasNotes ? notesThatFit(noteHeights, inner) : 0,
  };
}

/**
 * The back of one item: header, the short order panel, the production control
 * and the art, which takes what is left. It goes compact (tighter spacing and
 * 40px fields) when the art would be smaller than its minimum, and tight
 * (the art box may shrink to what is left) when even that does not fit, as
 * with order data at the limit of every field.
 *
 * @param {SheetOrder} order
 * @param {SheetItem} item
 */
function planBack(order, item) {
  const caption = item.estampa
    ? 4 +
      textLines(`Estampa (referência): ${item.estampa}`, NOTES_WIDTH, 13) * LINE
    : 0;
  /** @param {boolean} compact @param {number} artMin */
  const needed = (compact, artMin) => {
    const sizes = compact ? COMPACT : NORMAL;
    return (
      headHeight(order, compact) +
      sizes.chrome +
      clientHeight(order, compact) +
      sizes.gap +
      (sizes.chrome + SECTION_TITLE + sizes.stages) +
      sizes.gap +
      (sizes.chrome + SECTION_TITLE + artMin + caption) +
      FOOT
    );
  };
  const versoCompact = needed(false, ART_BOX_MIN) > SHEET_BODY;
  return {
    versoCompact,
    versoTight: versoCompact && needed(true, ART_BOX_MIN) > SHEET_BODY,
  };
}

/**
 * Continuation sheets: the item data that did not fit on a front, then the
 * observations from `notesFrom` on, never cut in the middle of a note.
 *
 * @param {SheetOrder} order
 * @param {ItemPlanV9[]} plans
 * @param {number[]} noteHeights
 * @param {number} notesFrom
 * @returns {ExtraPlanV9[]}
 */
function planExtras(order, plans, noteHeights, notesFrom) {
  const unitsOf = (/** @type {ItemPlanV9} */ plan) =>
    gradeLayout(order.items[plan.itemIndex].grade);
  const carried = plans.filter(
    (plan) =>
      plan.moved.length > 0 || plan.gradeKept < unitsOf(plan).units.length,
  );
  const pending = noteHeights.length - notesFrom;
  if (carried.length === 0 && pending <= 0) return [];
  /** @type {ExtraPlanV9[]} */
  const extras = [];
  let used = 0;
  const start = (/** @type {boolean} */ carries) => {
    /** @type {ExtraPlanV9} */
    const fresh = {
      carries,
      compact: carries,
      sections: [],
      notes: [],
      free: false,
    };
    extras.push(fresh);
    used =
      headHeight(order, carries) +
      PANEL_PADDING +
      clientHeight(order, carries) +
      FOOT;
    return fresh;
  };
  let sheet = start(carried.length > 0);
  const hasContent = () => sheet.sections.length > 0 || sheet.notes.length > 0;
  /** A new sheet when `need` does not fit and this one already holds content. */
  const makeRoom = (
    /** @type {number} */ need,
    /** @type {boolean} */ carries,
  ) => {
    if (used + need <= SHEET_BODY - CONTINUATION_SLACK || !hasContent())
      return false;
    sheet = start(carries);
    return true;
  };
  for (const plan of carried) {
    const blocks = itemBlocks(order.items[plan.itemIndex], plan.compact);
    const open = () => {
      /** @type {CarriedSection} */
      const section = {
        itemIndex: plan.itemIndex,
        compact: plan.compact,
        rows: [],
        grade: null,
      };
      sheet.sections.push(section);
      return section;
    };
    /** @type {CarriedSection | null} */
    let section = null;
    for (const key of plan.moved) {
      const height = ROW_GAP + blocks[key];
      if (makeRoom((section ? 0 : CONTINUATION_TITLE) + height, true)) {
        section = null;
      }
      if (!section) {
        section = open();
        used += CONTINUATION_TITLE;
      }
      section.rows.push(key);
      used += height;
    }
    const { list, units } = unitsOf(plan);
    section = null;
    for (let index = plan.gradeKept; index < units.length; index += 1) {
      const last = index === units.length - 1;
      const cost = (/** @type {boolean} */ first) =>
        (list ? (first ? LIST_TABLE_TOP : 0) : first ? 0 : 8) +
        units[index].height +
        (list && last ? LIST_TOTAL : 0) +
        (first ? CONTINUATION_TITLE + ROW_GAP : 0);
      if (makeRoom(cost(!section), true)) section = null;
      const first = !section;
      if (!section) section = open();
      if (section.grade === null)
        section.grade = { from: index, to: index + 1 };
      else section.grade.to = index + 1;
      used += cost(first);
    }
  }
  for (let index = notesFrom; index < noteHeights.length; index += 1) {
    const header = PANEL_GAP + PANEL_PADDING + SECTION_TITLE;
    // The panel header is part of what must fit when this sheet has no notes
    // yet; a sheet opened here starts with no notes and takes it too.
    makeRoom(
      (sheet.notes.length === 0 ? header : 0) + noteHeights[index],
      false,
    );
    if (sheet.notes.length === 0) used += header;
    sheet.notes.push(index);
    used += noteHeights[index];
  }
  // The panel of the last sheet with notes stretches and shows ruled lines
  // when the three of them fit under the notes.
  sheet.free = sheet.notes.length > 0 && SHEET_BODY - used >= RULED_MIN;
  return extras;
}

/**
 * @param {SheetOrder} order
 * @returns {{items: ItemPlanV9[], extras: ExtraPlanV9[], notesFrom: number}}
 */
export function planFichaV9(order) {
  const noteHeights = order.notes.map(noteHeight);
  const items = order.items.map((item, itemIndex) => ({
    itemIndex,
    ...planFront(order, item, itemIndex, noteHeights),
    ...planBack(order, item),
  }));
  // The notes the extra sheets start with: the first one that did not fit on
  // the front of some item, so no item's observations lack a place.
  const spilled = items.filter((plan) => plan.notesKept < noteHeights.length);
  const notesFrom =
    items.length === 0
      ? 0
      : spilled.length > 0
        ? Math.min(...spilled.map((plan) => plan.notesKept))
        : noteHeights.length;
  return {
    items,
    extras: planExtras(order, items, noteHeights, notesFrom),
    notesFrom,
  };
}
