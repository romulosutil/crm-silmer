<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import { openDialog } from '../../lib/ui.js';
import { request } from '../../lib/api-client.js';
import { downloadIssuedCutMap } from '../../lib/order-pdf.js';

const dialog = ref(null);
const title = ref(null);
const number = ref(null);
const map = ref(null);
const loading = ref(false);
const downloading = ref(false);
const error = ref('');
const retryable = ref(false);
let controller;
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

async function open(selected, trigger) {
  if (!selected.cutMap || !dialog.value || dialog.value.open) return;
  number.value = selected.cutMap.number;
  openDialog(dialog.value, trigger);
  await nextTick();
  if (!dialog.value?.open) return;
  title.value?.focus();
  await load();
}

async function load() {
  if (!number.value || loading.value) return;
  const current = new AbortController();
  controller = current;
  loading.value = true;
  error.value = '';
  retryable.value = false;
  try {
    const { data } = await request(`/api/v1/orders/cut-map/${number.value}`, {
      signal: current.signal,
    });
    if (!current.signal.aborted) map.value = data.map;
  } catch (cause) {
    if (current.signal.aborted) return;
    retryable.value = ![401, 403, 404].includes(cause?.status);
    error.value = retryable.value
      ? 'Não foi possível abrir o mapa. Tente novamente.'
      : 'Este mapa está indisponível para consulta.';
  } finally {
    if (controller === current) loading.value = false;
  }
}

async function download() {
  if (!map.value?.pdfAvailable || downloading.value) return;
  const current = new AbortController();
  controller = current;
  downloading.value = true;
  error.value = '';
  try {
    await downloadIssuedCutMap(number.value, current.signal);
  } catch (cause) {
    if (current.signal.aborted) return;
    if ([401, 403, 404].includes(cause?.status)) {
      map.value = null;
      error.value = 'O arquivo deste mapa está indisponível.';
    } else {
      error.value = 'Não foi possível baixar o PDF. Tente novamente.';
    }
  } finally {
    if (controller === current) downloading.value = false;
  }
}

function clear() {
  controller?.abort();
  controller = undefined;
  number.value = null;
  map.value = null;
  loading.value = false;
  downloading.value = false;
  error.value = '';
  retryable.value = false;
}

onBeforeUnmount(clear);
defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="op-dialog cut-map-dialog cut-map-membership"
    aria-labelledby="cut-map-membership-title"
    @close="clear"
  >
    <div class="cut-map-header">
      <h2 id="cut-map-membership-title" ref="title" tabindex="-1">
        Mapa de corte {{ number }}
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
    <div class="cut-map-body">
      <p v-if="loading" role="status">Carregando mapa de corte…</p>
      <p v-if="error" class="op-alert" role="alert">{{ error }}</p>
      <template v-if="map">
        <p>
          Emitido em
          <time :datetime="map.generatedAt">{{
            dateTime.format(new Date(map.generatedAt))
          }}</time>
        </p>
        <section aria-labelledby="cut-map-orders-title">
          <h3 id="cut-map-orders-title">
            Pedidos incluídos ({{ map.orders.length }})
          </h3>
          <ul class="cut-map-membership-orders">
            <li v-for="orderNumber in map.orders" :key="orderNumber">
              Pedido {{ orderNumber }}
            </li>
          </ul>
        </section>
        <p v-if="!map.pdfAvailable">
          O arquivo original não está disponível para este mapa.
        </p>
      </template>
    </div>
    <div class="op-dialog-actions">
      <button type="button" @click="dialog?.close()">Fechar</button>
      <button v-if="retryable" type="button" class="soft" @click="load">
        Tentar novamente
      </button>
      <button
        v-if="map?.pdfAvailable"
        type="button"
        class="primary"
        :aria-disabled="downloading || undefined"
        @click="download"
      >
        {{ downloading ? 'Baixando PDF…' : 'Baixar PDF' }}
      </button>
    </div>
  </dialog>
</template>
