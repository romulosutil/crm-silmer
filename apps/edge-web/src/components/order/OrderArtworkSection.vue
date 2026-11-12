<script setup>
import { computed, h, inject, nextTick, ref, watch } from 'vue';
import { brand } from '../../brand/index.js';
import { orderSteps } from '../../lib/order-format.js';
import { createSaveQueue } from '../../lib/order-items-inline.js';
import OrderArtworkFiles from './OrderArtworkFiles.vue';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

/*
 * PED-RD-T04 (PED-RD-10, PED-RD-12; ADR 083, design.md §20): the art is edited
 * in place. "Quem faz a arte" is open and each toggle saves by itself, one
 * after the other, through the same section write the form used (PFI-06).
 * There is no "Editar arte", no Salvar and no Cancelar. "Arte final" and
 * "Arquivos da arte" sit side by side once the chapter body is 36rem wide;
 * their file actions make their own requests (ADR 023).
 */
const SECTION = 'artwork';
const GROUP = 'origem';
// ADR 020: who makes the art of the whole order. The customer and Silmer may
// both be marked; "Sem estampa" stands alone. One mark is needed to generate.
// PFI-20 (ADR 035): the company's name comes from the brand, never written
// here; the key `feito_pela_silmer` is the API's and does not change.
const ORIGINS = Object.freeze([
  Object.freeze({ key: 'feito_pelo_cliente', label: 'O cliente envia a arte' }),
  Object.freeze({
    key: 'feito_pela_silmer',
    label: `A ${brand.companyName} cria a arte`,
  }),
  Object.freeze({ key: 'sem_estampa', label: 'Sem estampa' }),
]);
const SOURCE_HINT = `Obrigatório para gerar. O cliente e a ${brand.companyName} podem ser marcados juntos; “Sem estampa” vale sozinho.`;
const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const sheet = ref(null);
const saveState = ref('');
/** What was toggled and not yet saved; it survives an error. */
const draft = ref(/** @type {Record<string, boolean>|null} */ (null));
const error = ref(
  /** @type {{message: string, conflict: boolean}|null} */ (null),
);
let sequence = 0;

const artwork = computed(() => props.order.ficha?.artwork ?? {});
// PFI-10: a confirmed order is read-only; to change it the seller reopens it.
const permitted = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
// design.md §20: a section not yet migrated in "Editar" leaves this one in
// reading, with the reason, until that one is saved or cancelled.
const blocked = computed(
  () => permitted.value && editing.editingSection.value !== '',
);
const editable = computed(() => permitted.value && !blocked.value);
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);

/** @returns {Record<string, boolean>} */
function stored() {
  return {
    feito_pela_silmer: artwork.value.feito_pela_silmer === true,
    feito_pelo_cliente: artwork.value.feito_pelo_cliente === true,
    sem_estampa: artwork.value.sem_estampa === true,
  };
}
const shown = computed(() => draft.value ?? stored());
/** @param {Record<string, boolean>} a @param {Record<string, boolean>} b */
function same(a, b) {
  return ORIGINS.every((origin) => a[origin.key] === b[origin.key]);
}

const markedLabels = computed(() =>
  ORIGINS.filter((origin) => artwork.value[origin.key] === true).map(
    (origin) => origin.label,
  ),
);
// PFI-15: "Falta" is a blocker only while the server lists `artwork`; the
// head, the FieldGap and the footer read that one source.
const missing = computed(() => {
  const step = orderSteps(props.order).find((one) => one.key === 'artwork');
  return Boolean(step && !step.done);
});
// PFI-17: who makes the art is the head's state.
const headState = computed(() => {
  if (markedLabels.value.length > 0) {
    return { text: markedLabels.value.join(' · '), tone: 'ok' };
  }
  return {
    text: 'Falta marcar quem faz a arte',
    tone: missing.value ? 'missing' : 'neutral',
  };
});

/* ------------------------------- queue ------------------------------- */

/**
 * The saves run one after the other: PFI-06 writes the whole section over one
 * version. Each job carries the complete value, so a late answer never
 * undoes a later toggle.
 */
const saveQueue = createSaveQueue({
  async execute(job, sending) {
    if (same(job.value, stored())) return { noop: true, ok: true };
    sending();
    return editing.save(SECTION, {
      feito_pela_silmer: job.value.feito_pela_silmer,
      feito_pelo_cliente: job.value.feito_pelo_cliente,
      sem_estampa: job.value.sem_estampa,
    });
  },
  onFailure(job, failure) {
    error.value = failure;
  },
  onState(state) {
    saveState.value = state;
  },
});

/**
 * "Sem estampa" clears the two origins, and an origin clears "Sem estampa",
 * so the order never holds a pair the server refuses.
 *
 * @param {string} key @param {boolean} checked
 */
function mark(key, checked) {
  // A refused version is not sent again until "Recarregar pedido".
  if (error.value?.conflict) return;
  const next = { ...shown.value, [key]: checked };
  if (checked && key === 'sem_estampa') {
    next.feito_pela_silmer = false;
    next.feito_pelo_cliente = false;
  } else if (checked) {
    next.sem_estampa = false;
  }
  error.value = null;
  draft.value = next;
  sequence += 1;
  saveQueue.enqueue({
    after: () => {
      if (draft.value && same(draft.value, next)) draft.value = null;
    },
    key: GROUP,
    mark: String(sequence),
    value: next,
  });
}

/** VERSION_CONFLICT: the way out is the order as the server has it. */
async function reloadOrder() {
  const replaced = await editing.reload?.();
  if (replaced !== true) return;
  draft.value = null;
  error.value = null;
  saveState.value = '';
  // The button is gone with the error: the focus goes back to the group.
  await nextTick();
  globalThis.document?.getElementById('artwork-origin-first')?.focus();
}

/** The error under the group, with its way out (design.md §20, SaveStatus). */
const GroupError = (context) =>
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
GroupError.props = ['error', 'id'];

const describedBy = computed(() =>
  [
    'order-artwork-source-hint',
    missing.value ? 'order-artwork-source-gap' : '',
    error.value ? 'order-artwork-source-error' : '',
  ]
    .filter(Boolean)
    .join(' '),
);

// The next step, "Marcar quem faz a arte" (PFI-15), brings the section into
// view and puts the focus on the first origin; with the controls closed it
// only brings the section into view.
watch(
  () => editing.editRequest?.value,
  async (request) => {
    if (request?.section !== SECTION) return;
    await nextTick();
    sheet.value?.scrollIntoView?.({ block: 'start' });
    if (!editable.value) return;
    await nextTick();
    const field = globalThis.document?.getElementById('artwork-origin-first');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView?.({ block: 'center' });
  },
);
</script>

<template>
  <section
    ref="sheet"
    class="op-sheet"
    :data-artwork-mode="editable ? 'edit' : 'read'"
    aria-labelledby="order-artwork-title"
  >
    <OrderSheetHead
      title-id="order-artwork-title"
      title="Arte do pedido"
      :state="headState.text"
      :tone="headState.tone"
      :can-edit="false"
      section="artwork"
      body-id="order-artwork-body"
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
      id="order-artwork-body"
      class="op-sheet-body op-artwork"
      :hidden="!open"
    >
      <p v-if="blocked" class="op-hint op-items-blocked">
        Salve ou cancele a edição aberta para alterar a arte.
      </p>

      <fieldset
        v-if="editable"
        class="op-artwork-source"
        :aria-describedby="describedBy"
      >
        <legend>Quem faz a arte?</legend>
        <p id="order-artwork-source-hint" class="op-hint">
          {{ SOURCE_HINT }}
        </p>
        <div class="op-artwork-options">
          <label
            v-for="(origin, index) in ORIGINS"
            :key="origin.key"
            class="op-check"
          >
            <input
              :id="index === 0 ? 'artwork-origin-first' : undefined"
              type="checkbox"
              :checked="shown[origin.key]"
              @change="mark(origin.key, $event.target.checked)"
            />
            <span>{{ origin.label }}</span>
          </label>
        </div>
        <span
          v-if="missing"
          id="order-artwork-source-gap"
          class="badge op-field-gap"
          data-tone="warning"
          ><OrderIcon name="alert" />Falta<span class="op-visually-hidden">
            para gerar o pedido</span
          ></span
        >
        <GroupError id="order-artwork-source-error" :error="error" />
      </fieldset>

      <div v-else class="op-artwork-source op-artwork-read">
        <span id="artwork-source-label" class="op-summary-label"
          >Quem faz a arte</span
        >
        <ul
          v-if="markedLabels.length"
          class="op-artwork-marked"
          aria-labelledby="artwork-source-label"
        >
          <li v-for="label in markedLabels" :key="label">
            <OrderIcon name="check" />{{ label }}
          </li>
        </ul>
        <p
          v-else
          class="op-summary-text"
          aria-labelledby="artwork-source-label"
        >
          —
        </p>
        <span
          v-if="missing && permitted"
          class="badge op-field-gap"
          data-tone="warning"
          ><OrderIcon name="alert" />Falta<span class="op-visually-hidden">
            para gerar o pedido</span
          ></span
        >
      </div>

      <OrderArtworkFiles :order="order" />
    </div>
  </section>
</template>
