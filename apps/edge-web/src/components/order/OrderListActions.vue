<script setup>
import { computed, ref, watch } from 'vue';
import AnchoredPopover from '../AnchoredPopover.vue';
import AppIcon from '../AppIcon.vue';

const props = defineProps({
  order: { type: Object, required: true },
  stage: { type: Object, default: null },
  stageBusy: { type: Boolean, default: false },
  pdfBusyId: { type: String, default: '' },
});
const emit = defineEmits(['pdf', 'receipt', 'stage']);
const open = ref(false);
/** @type {import('vue').Ref<HTMLButtonElement | null>} */
const trigger = ref(null);
const menuId = computed(() => `order-list-actions-${props.order.id}`);
const pdfLabel = computed(() =>
  props.pdfBusyId === props.order.id ? 'Gerando PDF…' : 'Gerar PDF',
);
const hasMoreActions = computed(
  () => props.order.productionEditable || props.order.receiptAvailable === true,
);

watch(hasMoreActions, (available) => {
  if (!available) open.value = false;
});

function close() {
  open.value = false;
  trigger.value?.focus();
}

/** @param {FocusEvent} event */
function closeOnFocusOut(event) {
  if (
    open.value &&
    event.relatedTarget instanceof Node &&
    event.currentTarget instanceof HTMLElement &&
    !event.currentTarget.contains(event.relatedTarget)
  ) {
    open.value = false;
  }
}

function receipt() {
  open.value = false;
  emit('receipt', trigger.value);
}

/** @param {string} next */
function advance(next) {
  close();
  emit('stage', next);
}

/** @param {SubmitEvent} event */
function saveInitialStage(event) {
  if (!(event.currentTarget instanceof HTMLFormElement)) return;
  const stage = new FormData(event.currentTarget).get('stage');
  if (typeof stage === 'string' && stage) advance(stage);
}
</script>

<template>
  <div class="order-row-tools" @click.stop @focusout="closeOnFocusOut">
    <button
      v-if="order.status === 'confirmado'"
      type="button"
      class="order-row-icon order-row-pdf quiet"
      :aria-label="`${pdfLabel} ${order.number}`"
      :aria-busy="pdfBusyId === order.id || undefined"
      :title="pdfLabel"
      :disabled="Boolean(pdfBusyId)"
      @click="$emit('pdf')"
    >
      <AppIcon name="download" />
    </button>
    <button
      v-if="hasMoreActions"
      ref="trigger"
      type="button"
      class="order-row-icon order-row-menu-trigger quiet"
      :aria-label="`Mais ações do pedido ${order.number}`"
      title="Mais ações"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click="open = !open"
    >
      <AppIcon name="more" />
    </button>

    <AnchoredPopover
      v-if="open"
      :id="menuId"
      v-model:open="open"
      :anchor="trigger"
      :label="`Ações do pedido ${order.number}`"
      class="order-row-popover"
    >
      <form
        v-if="order.productionEditable && !stage"
        class="order-row-stage-form"
        @submit.prevent="saveInitialStage"
      >
        <label :for="`${menuId}-stage`">Definir etapa</label>
        <select
          :id="`${menuId}-stage`"
          name="stage"
          required
          :aria-label="`Definir etapa do pedido ${order.number}`"
        >
          <option value="">Selecione uma etapa</option>
          <option value="arte">Na arte</option>
          <option value="producao">Na produção</option>
          <option value="pronto">Pronto</option>
        </select>
        <button type="submit" :disabled="stageBusy">
          Salvar etapa<span class="sr-only"> do pedido {{ order.number }}</span>
        </button>
      </form>
      <button
        v-else-if="order.productionEditable && stage"
        type="button"
        class="order-row-menu-item quiet"
        :disabled="stageBusy"
        @click="advance(stage.next)"
      >
        <AppIcon name="chevron" />
        {{ stage.action }}<span class="sr-only"> {{ order.number }}</span>
      </button>
      <button
        v-if="order.receiptAvailable === true"
        type="button"
        class="order-row-menu-item quiet"
        :disabled="Boolean(pdfBusyId)"
        @click="receipt"
      >
        <AppIcon name="orders" />
        Recibo<span class="sr-only"> {{ order.number }}</span>
      </button>
    </AnchoredPopover>
  </div>
</template>
