<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import { request } from '../../lib/api-client.js';
import { openDialog } from '../../lib/ui.js';

const dialog = ref(null);
const title = ref(null);
const closeButton = ref(null);
const order = ref(null);
const entries = ref([]);
const cursor = ref(null);
const loading = ref(false);
const error = ref(false);
let controller;
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

async function load() {
  if (!order.value || loading.value) return;
  const current = new AbortController();
  controller = current;
  const hadMore = Boolean(cursor.value || error.value);
  const url = `/api/v1/orders/${encodeURIComponent(order.value.id)}/cut-map-history`;
  const search = cursor.value
    ? `?${new URLSearchParams({ before: cursor.value })}`
    : '';
  loading.value = true;
  error.value = false;
  try {
    const { data } = await request(url + search, { signal: current.signal });
    entries.value.push(...data.items);
    cursor.value = data.nextCursor;
    if (hadMore && !cursor.value) {
      await nextTick();
      closeButton.value?.focus();
    }
  } catch {
    if (!current.signal.aborted) error.value = true;
  } finally {
    if (controller === current) loading.value = false;
  }
}

async function open(selected, trigger) {
  if (!dialog.value || dialog.value.open) return;
  order.value = selected;
  openDialog(dialog.value, trigger);
  await nextTick();
  if (!dialog.value?.open) return;
  title.value?.focus();
  await load();
}

function clear() {
  controller?.abort();
  controller = undefined;
  order.value = null;
  entries.value = [];
  cursor.value = null;
  loading.value = false;
  error.value = false;
}

onBeforeUnmount(clear);
defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="op-dialog cut-map-dialog cut-map-history"
    aria-labelledby="cut-map-history-title"
    @close="clear"
  >
    <div class="cut-map-header">
      <div>
        <h2 id="cut-map-history-title" ref="title" tabindex="-1">
          Histórico de mapas de corte
        </h2>
        <p v-if="order">Pedido {{ order.number }}</p>
      </div>
      <button
        type="button"
        class="quiet icon-button"
        aria-label="Fechar histórico"
        @click="dialog?.close()"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <div class="cut-map-body">
      <p v-if="loading" role="status">Carregando histórico…</p>
      <p v-if="error" class="op-alert" role="alert">
        Não foi possível carregar o histórico.
      </p>
      <p v-if="!loading && !error && !entries.length">
        Nenhuma geração registrada para este pedido.
      </p>
      <ol v-if="entries.length" class="cut-map-history-list">
        <li v-for="entry in entries" :key="entry.id">
          <time :datetime="entry.generatedAt">{{
            dateTime.format(new Date(entry.generatedAt))
          }}</time>
          <small>Versão {{ entry.orderVersion }} do pedido</small>
        </li>
      </ol>
    </div>
    <div class="op-dialog-actions">
      <button
        v-if="cursor || error"
        type="button"
        class="soft"
        :aria-disabled="loading || undefined"
        @click="load"
      >
        {{ error ? 'Tentar novamente' : 'Ver gerações anteriores' }}
      </button>
      <button ref="closeButton" type="button" @click="dialog?.close()">
        Fechar
      </button>
    </div>
  </dialog>
</template>
