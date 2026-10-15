<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { brand } from '../../brand/index.js';
import { orderSteps } from '../../lib/order-format.js';
import OrderArtworkFiles from './OrderArtworkFiles.vue';
import OrderSheetHead from './OrderSheetHead.vue';

const SECTION = 'artwork';
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
const firstField = ref(null);
const draft = ref({
  feito_pela_silmer: false,
  feito_pelo_cliente: false,
  sem_estampa: false,
});
const saving = ref(false);
const errorMessage = ref('');
const artwork = computed(() => props.order.ficha?.artwork ?? {});
const isEditing = computed(() => editing.editingSection.value === SECTION);
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);
// PFI-17: who makes the art is the head's state; "Falta" is a blocker only
// while the server lists `artwork` (PFI-15).
const headState = computed(() => {
  const marked = ORIGINS.filter(
    (origin) => artwork.value[origin.key] === true,
  ).map((origin) => origin.label);
  if (marked.length > 0) return { text: marked.join(' · '), tone: 'ok' };
  const step = orderSteps(props.order).find((one) => one.key === 'artwork');
  return {
    text: 'Falta marcar quem faz a arte',
    tone: step && !step.done ? 'missing' : 'neutral',
  };
});

async function startEditing() {
  draft.value = {
    feito_pela_silmer: artwork.value.feito_pela_silmer === true,
    feito_pelo_cliente: artwork.value.feito_pelo_cliente === true,
    sem_estampa: artwork.value.sem_estampa === true,
  };
  errorMessage.value = '';
  editing.start(SECTION);
  await nextTick();
  firstField.value?.focus();
}

function cancel() {
  errorMessage.value = '';
  editing.stop();
}

/**
 * "Sem estampa" clears the two origins, and an origin clears "Sem estampa",
 * so the form never holds a pair the server refuses.
 *
 * @param {string} key @param {boolean} checked
 */
function mark(key, checked) {
  const next = { ...draft.value, [key]: checked };
  if (checked && key === 'sem_estampa') {
    next.feito_pela_silmer = false;
    next.feito_pelo_cliente = false;
  } else if (checked) {
    next.sem_estampa = false;
  }
  draft.value = next;
}

// The next step, "Marcar quem faz a arte" (PFI-15), opens this editor;
// with another section open, it only brings the section into view.
const sheet = ref(null);
watch(
  () => editing.editRequest?.value,
  (request) => {
    if (request?.section !== SECTION || isEditing.value) return;
    if (canEdit.value && !otherSectionOpen.value) {
      void startEditing();
      return;
    }
    sheet.value?.scrollIntoView?.({ block: 'start' });
  },
);

async function save() {
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(SECTION, {
    feito_pela_silmer: draft.value.feito_pela_silmer,
    feito_pelo_cliente: draft.value.feito_pelo_cliente,
    sem_estampa: draft.value.sem_estampa,
  });
  saving.value = false;
  if (result.ok) editing.stop();
  else errorMessage.value = result.message;
}
</script>

<template>
  <section ref="sheet" class="op-sheet" aria-labelledby="order-artwork-title">
    <OrderSheetHead
      title-id="order-artwork-title"
      title="Arte do pedido"
      :state="headState.text"
      :tone="headState.tone"
      edit-label="Editar arte"
      :can-edit="canEdit"
      :blocked="otherSectionOpen"
      :editing="isEditing"
      section="artwork"
      body-id="order-artwork-body"
      @edit="startEditing"
    />

    <p v-if="errorMessage" role="alert" class="op-alert" :hidden="!open">
      {{ errorMessage }}
    </p>

    <form
      v-if="isEditing"
      class="op-form"
      :hidden="!open"
      @submit.prevent="save"
    >
      <fieldset
        class="op-artwork-source"
        aria-describedby="order-artwork-source-hint"
      >
        <legend>Quem faz a arte?</legend>
        <p id="order-artwork-source-hint" class="op-hint">
          {{ SOURCE_HINT }}
        </p>
        <label
          v-for="(origin, index) in ORIGINS"
          :key="origin.key"
          class="op-check"
        >
          <input
            :ref="
              (element) => {
                if (index === 0) firstField = element;
              }
            "
            type="checkbox"
            :checked="draft[origin.key]"
            @change="mark(origin.key, $event.target.checked)"
          />
          <span>{{ origin.label }}</span>
        </label>
      </fieldset>
      <div class="op-form-actions">
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar arte' }}
        </button>
      </div>
    </form>

    <OrderArtworkFiles id="order-artwork-body" :order="order" :hidden="!open" />
  </section>
</template>
