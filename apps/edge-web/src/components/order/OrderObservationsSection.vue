<script setup>
import { computed, h, inject, nextTick, reactive, ref, watch } from 'vue';
import { createSaveQueue } from '../../lib/order-items-inline.js';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

/*
 * PED-RD-T05 (PED-RD-11, PED-RD-12; ADR 083, design.md §20): the observations
 * are edited in place. Each line is an open field that saves by itself (blur
 * or Enter), the BlankRow at the end creates the next one, and a line left
 * empty is removed. There is no "Editar observações", no Salvar and no
 * Cancelar. Every save sends the whole list (PFI-05, zero to five lines of
 * 200 characters) through the same section write the form used (PFI-06).
 */
const SECTION = 'observations';
const MAX_OBSERVATIONS = 5;
const MAX_LENGTH = 200;

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const list = ref(null);
const saveState = ref('');
/** The lines as the seller sees them; each carries a stable `uid` for the DOM. */
const rows = ref(/** @type {{uid: number, text: string}[]} */ ([]));
const blank = ref('');
const errors = reactive(
  /** @type {Record<string, {message: string, conflict: boolean}>} */ ({}),
);
let nextUid = 1;
/** Saves sent and not yet answered, queued ones included. */
let inFlight = 0;

// PFI-10: a confirmed order is read-only; to change it the seller reopens it.
const permitted = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
// design.md §20: a section still in "Editar" (the price composition, the
// billing, the dates) leaves this one in reading, with the reason, until that
// one is saved or cancelled.
const blocked = computed(
  () => permitted.value && editing.editingSection.value !== '',
);
const editable = computed(() => permitted.value && !blocked.value);
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);
const observations = computed(() => props.order.ficha.observations ?? []);
// PFI-17: observations never block "Gerar"; the state is the plain count.
const headline = computed(
  () => `${observations.value.length} de ${MAX_OBSERVATIONS} linhas`,
);
const showBlank = computed(() => rows.value.length < MAX_OBSERVATIONS);
const hint = computed(() =>
  showBlank.value
    ? `Escreva na linha em branco e saia do campo, ou tecle Enter, para criar a observação. Até ${MAX_OBSERVATIONS} linhas de ${MAX_LENGTH} caracteres.`
    : `Limite de ${MAX_OBSERVATIONS} linhas atingido. Apague uma linha para escrever outra.`,
);

/** @param {unknown[]} lines */
function toRows(lines) {
  return lines.map((text) => ({ text: String(text), uid: nextUid++ }));
}
rows.value = toRows(observations.value);

/** What the list would send: trimmed, with no blank line (never an empty bullet). */
function values() {
  return rows.value.map((row) => row.text.trim()).filter((text) => text !== '');
}

// Another place changed the observations (a live refresh, "Recarregar
// pedido"): the list follows once nothing of ours is waiting to be saved.
watch(
  () => JSON.stringify(observations.value),
  () => {
    if (inFlight > 0) return;
    if (JSON.stringify(values()) === JSON.stringify(observations.value)) return;
    rows.value = toRows(observations.value);
  },
);

/* ------------------------------- queue ------------------------------- */

/**
 * The saves run one after the other and each carries the complete list, so a
 * late answer never undoes a later change.
 */
const saveQueue = createSaveQueue({
  async execute(job, sending) {
    if (JSON.stringify(job.value) === JSON.stringify(observations.value)) {
      return { noop: true, ok: true };
    }
    sending();
    return editing.save(SECTION, job.value);
  },
  onFailure(job, failure) {
    inFlight = Math.max(0, inFlight - 1);
    if (
      job.uid !== undefined &&
      rows.value.some((row) => row.uid === job.uid)
    ) {
      errors[job.uid] = failure;
      return;
    }
    // The line is gone (removed) or never existed (the BlankRow): the error
    // goes under the list, and what was typed comes back where it was.
    errors.list = failure;
    job.restore?.();
  },
  onState(state) {
    saveState.value = state;
  },
});

/** @param {Record<string, any>} job */
function send(job) {
  inFlight += 1;
  const queued = saveQueue.enqueue({
    after: () => {
      inFlight = Math.max(0, inFlight - 1);
    },
    key: `line-${job.uid}`,
    mark: JSON.stringify(job.value),
    ...job,
  });
  // An equal save is already on its way: it answers for this one too.
  if (!queued) inFlight -= 1;
}

/** @param {number} uid */
function clearError(uid) {
  delete errors[uid];
  delete errors.list;
}

function hasConflict() {
  return Object.values(errors).some((error) => error.conflict);
}

/* ------------------------------ interactions ------------------------------ */

function lineInputs() {
  return Array.from(list.value?.querySelectorAll('input[data-obs-line]') ?? []);
}
function blankInput() {
  return /** @type {HTMLInputElement|null} */ (
    list.value?.querySelector('[data-blank-row] input')
  );
}

/** design.md §20: the focus goes to the next line, else to the BlankRow. */
async function focusAt(index) {
  await nextTick();
  const target = lineInputs()[index] ?? blankInput() ?? lineInputs().at(-1);
  /** @type {HTMLElement|undefined} */ (target)?.focus();
}

/**
 * Blur or Enter on a line: trimmed; empty removes the line; only a value that
 * differs from what the order holds is sent.
 *
 * @param {number} uid @param {boolean} [follow] whether Enter moves the focus on
 */
function commitLine(uid, follow = false) {
  const index = rows.value.findIndex((row) => row.uid === uid);
  if (index === -1) return;
  // A refused version is not sent again until "Recarregar pedido".
  if (hasConflict()) return;
  const row = rows.value[index];
  const text = row.text.trim();
  if (text === '') {
    removeLine(uid, follow);
    return;
  }
  row.text = text;
  clearError(uid);
  send({ uid, value: values() });
  if (follow) focusAt(index + 1);
}

/** @param {number} uid @param {boolean} [follow] */
function removeLine(uid, follow = true) {
  const index = rows.value.findIndex((row) => row.uid === uid);
  if (index === -1 || hasConflict()) return;
  const [removed] = rows.value.splice(index, 1);
  delete errors[uid];
  delete errors.list;
  send({
    restore: () =>
      rows.value.splice(Math.min(index, rows.value.length), 0, removed),
    uid,
    value: values(),
  });
  if (follow) focusAt(index);
}

/** @param {boolean} follow whether Enter keeps the focus walking the list */
function commitBlank(follow = false) {
  const text = blank.value.trim();
  if (text === '' || hasConflict() || !showBlank.value) return;
  delete errors.list;
  const row = { text, uid: nextUid++ };
  rows.value.push(row);
  blank.value = '';
  send({
    restore: () => {
      rows.value = rows.value.filter((one) => one.uid !== row.uid);
      if (blank.value === '') blank.value = text;
    },
    uid: row.uid,
    value: values(),
  });
  // At the fifth line the BlankRow leaves: the focus stays on the last line.
  if (follow) focusAt(rows.value.length);
}

/** VERSION_CONFLICT: the way out is the order as the server has it. */
async function reloadOrder() {
  const replaced = await editing.reload?.();
  if (replaced !== true) return;
  rows.value = toRows(observations.value);
  for (const key of Object.keys(errors)) delete errors[key];
  saveState.value = '';
  focusAt(0);
}

/** The error of a line or of the list, with its way out (design.md §20). */
const FieldError = (context) =>
  context.error
    ? h('p', { class: 'op-field-error', id: context.id, role: 'alert' }, [
        h('span', context.error.message),
        context.error.conflict
          ? h(
              'button',
              { class: 'link-button', onClick: reloadOrder, type: 'button' },
              'Recarregar pedido',
            )
          : null,
      ])
    : null;
FieldError.props = ['error', 'id'];
</script>

<template>
  <section
    class="op-sheet"
    :data-observations-mode="editable ? 'edit' : 'read'"
    aria-labelledby="order-observations-title"
  >
    <OrderSheetHead
      title-id="order-observations-title"
      title="Observações do pedido"
      :state="headline"
      :can-edit="false"
      section="observations"
      body-id="order-observations-body"
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
      v-if="editable"
      id="order-observations-body"
      class="op-sheet-body op-obs-edit"
      :hidden="!open"
    >
      <div class="op-obs-head" aria-hidden="true">
        <span>Nº</span><span>Observação</span>
      </div>
      <ol ref="list" class="op-obs-list" aria-label="Observações">
        <li v-for="(row, index) in rows" :key="row.uid" class="op-obs-row">
          <span class="op-obs-index op-num" aria-hidden="true">{{
            index + 1
          }}</span>
          <div class="op-obs-field">
            <input
              v-model="row.text"
              data-obs-line
              type="text"
              autocomplete="off"
              enterkeyhint="next"
              :maxlength="MAX_LENGTH"
              :aria-label="`Observação ${index + 1}`"
              :aria-invalid="errors[row.uid] ? 'true' : undefined"
              :aria-describedby="
                errors[row.uid] ? `observation-error-${row.uid}` : undefined
              "
              @blur="commitLine(row.uid)"
              @keydown.enter.prevent="commitLine(row.uid, true)"
            />
            <FieldError
              :id="`observation-error-${row.uid}`"
              :error="errors[row.uid]"
            />
          </div>
          <button
            type="button"
            class="op-icon-button op-icon-button--quiet op-obs-remove"
            @click="removeLine(row.uid)"
          >
            <OrderIcon name="x" />
            <span class="op-visually-hidden">{{
              `Remover observação ${index + 1}`
            }}</span>
          </button>
        </li>
        <!-- design.md §20 (BlankRow): always the last, never a line yet. -->
        <li v-if="showBlank" class="op-obs-row" data-blank-row>
          <span class="op-obs-index op-num" aria-hidden="true">{{
            rows.length + 1
          }}</span>
          <div class="op-obs-field">
            <input
              v-model="blank"
              type="text"
              autocomplete="off"
              enterkeyhint="next"
              placeholder="Adicionar observação"
              :maxlength="MAX_LENGTH"
              :aria-label="`Nova observação, linha ${rows.length + 1}`"
              aria-describedby="order-observations-hint"
              @blur="commitBlank()"
              @keydown.enter.prevent="commitBlank(true)"
            />
          </div>
        </li>
      </ol>
      <FieldError id="order-observations-error" :error="errors.list" />
      <p id="order-observations-hint" class="op-hint">{{ hint }}</p>
    </div>

    <div
      v-else
      id="order-observations-body"
      class="op-sheet-body"
      :hidden="!open"
    >
      <p v-if="blocked" class="op-hint op-items-blocked">
        Salve ou cancele a edição aberta para alterar as observações.
      </p>
      <ol v-if="observations.length" class="op-observations">
        <li v-for="(line, index) in observations" :key="index">{{ line }}</li>
      </ol>
      <p v-else class="op-empty">Sem observações.</p>
    </div>
  </section>
</template>
