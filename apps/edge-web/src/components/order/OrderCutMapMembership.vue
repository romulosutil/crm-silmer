<script setup>
import { nextTick, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import { openDialog } from '../../lib/ui.js';

const dialog = ref(null);
const title = ref(null);
const order = ref(null);
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

async function open(selected, trigger) {
  if (!selected.cutMap || !dialog.value || dialog.value.open) return;
  order.value = selected;
  openDialog(dialog.value, trigger);
  await nextTick();
  title.value?.focus();
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="op-dialog cut-map-dialog cut-map-membership"
    aria-labelledby="cut-map-membership-title"
    @close="order = null"
  >
    <div class="cut-map-header">
      <h2 id="cut-map-membership-title" ref="title" tabindex="-1">
        Mapa de corte {{ order?.cutMap.number }}
      </h2>
      <button
        type="button"
        class="quiet icon-button"
        aria-label="Fechar mapa de corte"
        @click="dialog?.close()"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <div v-if="order" class="cut-map-body">
      <p>
        <strong>Pedido {{ order.number }}</strong>
      </p>
      <p>
        Gerado em
        <time :datetime="order.cutMap.generatedAt">{{
          dateTime.format(new Date(order.cutMap.generatedAt))
        }}</time>
      </p>
      <p>Versão {{ order.cutMap.orderVersion }} do pedido</p>
    </div>
    <div class="op-dialog-actions">
      <button type="button" @click="dialog?.close()">Fechar</button>
    </div>
  </dialog>
</template>
