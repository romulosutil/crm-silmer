<script setup>
import { computed, h, inject, nextTick, reactive, ref, watch } from 'vue';
import { orderSteps, quantityWarning } from '../../lib/order-format.js';
import { createSaveQueue } from '../../lib/order-items-inline.js';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

/*
 * PED-RD-T03 (PED-RD-09, PED-RD-12; ADR 083, design.md §20): the summary is
 * edited in place. "Nome do pedido" and "Previsão de entrega" are open fields
 * that save by themselves (blur or Enter, the date on change), one field per
 * command, through the same section write the form used (PFI-06). There is no
 * "Editar resumo", no Salvar and no Cancelar.
 */
const SECTION = 'summary';
const NAME = 'nome';
const DELIVERY = 'data_entrega_confirmada';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const sheet = ref(null);
const saveState = ref('');
/** What was typed and not yet saved, by field; it survives an error. */
const drafts = reactive(/** @type {Record<string, string>} */ ({}));
const errors = reactive(
  /** @type {Record<string, {message: string, conflict: boolean}>} */ ({}),
);

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
const summary = computed(() => props.order.ficha.summary);
// PIT-09: a warning only when the sizes add up to something other than what
// the customer said (ADR 020: the figure itself is not repeated beside it).
const warning = computed(() => quantityWarning(props.order));
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);

/** The stored value is an ISO day; the operation reads dd/mm/yyyy. */
/** @param {unknown} value */
function dateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

// PFI-17: the promised delivery is what this section owes to "Gerar"; the
// server's missingFields says whether it is still missing (PFI-15). The head,
// the FieldGap and the footer read that one source.
const deliveryMissing = computed(() => {
  const step = orderSteps(props.order).find((one) => one.key === 'delivery');
  return Boolean(step && !step.done);
});
const headState = computed(() => {
  if (deliveryMissing.value) {
    return { text: 'Falta previsão de entrega', tone: 'missing' };
  }
  const day = dateBR(summary.value[DELIVERY]);
  if (day) return { text: `Entrega ${day}`, tone: 'ok' };
  return { text: 'Sem previsão de entrega', tone: 'neutral' };
});

/** @param {string} key */
function stored(key) {
  return String(summary.value[key] ?? '');
}
/** @param {string} key */
function shown(key) {
  return key in drafts ? drafts[key] : stored(key);
}

/* ------------------------------- queue ------------------------------- */

/**
 * The saves run one after the other, each built from the order the last
 * answer brought: PFI-06 writes the whole section over one version, with only
 * the field of the job changed.
 */
const saveQueue = createSaveQueue({
  async execute(job, sending) {
    const next = String(job.mark ?? '');
    if (next === stored(job.key)) return { noop: true, ok: true };
    sending();
    return editing.save(SECTION, {
      [DELIVERY]: (job.key === DELIVERY ? next : stored(DELIVERY)) || null,
      [NAME]: (job.key === NAME ? next : stored(NAME)) || null,
    });
  },
  onFailure(job, failure) {
    errors[job.key] = failure;
  },
  onState(state) {
    saveState.value = state;
  },
});

/**
 * Blur, Enter or (for the date) change: trimmed and otherwise as typed, only
 * when it differs from what the order holds. A late answer never moves the
 * focus: nothing here does.
 *
 * @param {string} key @param {string} raw
 */
function commit(key, raw) {
  const value = raw.trim();
  // A refused version is not sent again until "Recarregar pedido".
  if (errors[key]?.conflict) return;
  if (value === stored(key) && !saveQueue.isPending(key)) {
    // No draft or error is left over what the order already holds.
    delete drafts[key];
    delete errors[key];
    return;
  }
  delete errors[key];
  saveQueue.enqueue({
    after: () => {
      if (key in drafts && drafts[key].trim() === value) delete drafts[key];
    },
    key,
    mark: value,
  });
}

/** @param {string} key @param {string} text */
function setDraft(key, text) {
  drafts[key] = text;
}

/** VERSION_CONFLICT: the way out is the order as the server has it. */
async function reloadOrder(event) {
  const origin = event?.currentTarget;
  const replaced = await editing.reload?.();
  if (replaced !== true) return;
  for (const key of Object.keys(drafts)) delete drafts[key];
  for (const key of Object.keys(errors)) delete errors[key];
  saveState.value = '';
  // The button is gone with the error: the focus goes back to its field.
  const field = origin?.closest?.('.op-summary-field');
  await nextTick();
  field?.querySelector?.('input')?.focus();
}

/** The error under a field, with its way out (design.md §20, SaveStatus). */
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

/** @param {string} key @param {string} gapId @param {string} errorId */
function describedBy(key, gapId, errorId) {
  return (
    [
      key === DELIVERY && deliveryMissing.value ? gapId : '',
      errors[key] ? errorId : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

// ADR 016: "Informar a previsão de entrega" (the progress, the footer or
// "Gerar pedido") brings the summary into view and puts the focus on the
// delivery date; with the fields closed it only brings the summary into view.
watch(
  () => editing.editRequest?.value,
  async (request) => {
    if (request?.section !== SECTION) return;
    await nextTick();
    sheet.value?.scrollIntoView?.({ block: 'start' });
    if (!editable.value) return;
    await nextTick();
    const field = globalThis.document?.getElementById('summary-entrega');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView?.({ block: 'center' });
  },
);
</script>

<template>
  <section
    ref="sheet"
    class="op-sheet"
    :data-summary-mode="editable ? 'edit' : 'read'"
    aria-labelledby="order-summary-title"
  >
    <OrderSheetHead
      title-id="order-summary-title"
      title="Resumo do pedido"
      :state="headState.text"
      :tone="headState.tone"
      :can-edit="false"
      section="summary"
      body-id="order-summary-body"
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
      id="order-summary-body"
      class="op-sheet-body op-summary"
      :class="{ 'op-summary-edit': editable }"
      :hidden="!open"
    >
      <p v-if="blocked" class="op-hint op-items-blocked">
        Salve ou cancele a edição aberta para alterar o resumo.
      </p>

      <div class="op-summary-fields">
        <div class="op-summary-client">
          <span id="summary-cliente-label" class="op-summary-label"
            >Cliente</span
          >
          <p class="op-summary-text" aria-labelledby="summary-cliente-label">
            {{ summary.cliente || '—' }}
            <span v-if="order.conversationId" class="op-origin-note">
              vem da conversa
            </span>
          </p>
        </div>

        <div class="op-summary-field" data-field="nome">
          <template v-if="editable">
            <label for="summary-nome">Nome do pedido</label>
            <input
              id="summary-nome"
              type="text"
              maxlength="200"
              autocomplete="off"
              :value="shown(NAME)"
              :aria-invalid="errors[NAME] ? 'true' : undefined"
              :aria-describedby="
                describedBy(NAME, 'summary-nome-gap', 'summary-nome-error')
              "
              @input="setDraft(NAME, $event.target.value)"
              @change="commit(NAME, $event.target.value)"
              @keydown.enter.prevent="commit(NAME, $event.target.value)"
            />
            <FieldError id="summary-nome-error" :error="errors[NAME]" />
          </template>
          <template v-else>
            <span id="summary-nome-label" class="op-summary-label"
              >Nome do pedido</span
            >
            <p class="op-summary-text" aria-labelledby="summary-nome-label">
              {{ summary.nome || '—' }}
            </p>
          </template>
        </div>

        <div class="op-summary-field" data-field="entrega">
          <template v-if="editable">
            <label for="summary-entrega">Previsão de entrega</label>
            <input
              id="summary-entrega"
              type="date"
              :value="shown(DELIVERY)"
              :aria-required="deliveryMissing ? 'true' : undefined"
              :aria-invalid="errors[DELIVERY] ? 'true' : undefined"
              :aria-describedby="
                describedBy(
                  DELIVERY,
                  'summary-entrega-gap',
                  'summary-entrega-error',
                )
              "
              @input="setDraft(DELIVERY, $event.target.value)"
              @change="commit(DELIVERY, $event.target.value)"
              @keydown.enter.prevent="commit(DELIVERY, $event.target.value)"
            />
            <span
              v-if="deliveryMissing"
              id="summary-entrega-gap"
              class="badge op-field-gap"
              data-tone="warning"
              ><OrderIcon name="alert" />Falta<span class="op-visually-hidden">
                para gerar o pedido</span
              ></span
            >
            <FieldError id="summary-entrega-error" :error="errors[DELIVERY]" />
          </template>
          <template v-else>
            <span id="summary-entrega-label" class="op-summary-label"
              >Previsão de entrega</span
            >
            <p
              class="op-summary-text op-num"
              aria-labelledby="summary-entrega-label"
            >
              {{ dateBR(summary[DELIVERY]) || '—' }}
            </p>
            <span
              v-if="deliveryMissing && permitted"
              class="badge op-field-gap"
              data-tone="warning"
              ><OrderIcon name="alert" />Falta<span class="op-visually-hidden">
                para gerar o pedido</span
              ></span
            >
          </template>
        </div>
      </div>

      <p v-if="warning" class="op-quantity-warning">
        <OrderIcon name="alert" />{{ warning }}
      </p>
    </div>
  </section>
</template>
