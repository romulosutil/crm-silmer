<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import { request } from '../../lib/api-client.js';
import { downloadIssuedCutMap } from '../../lib/order-pdf.js';

const maps = ref([]);
const list = ref(null);
const region = ref(null);
const nextCursor = ref(null);
const loading = ref(false);
const loadError = ref(false);
const pendingPdf = ref(null);
const downloadError = ref(null);
const controller = new AbortController();
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

async function load(focusResults = false) {
  if (loading.value) return;
  const previousCount = maps.value.length;
  const search = nextCursor.value
    ? `?${new URLSearchParams({ before: nextCursor.value })}`
    : '';
  loading.value = true;
  try {
    const { data } = await request(`/api/v1/orders/cut-maps${search}`, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    maps.value.push(...data.items);
    nextCursor.value = data.nextCursor;
    loadError.value = false;
    await nextTick();
    if (focusResults) {
      const next = list.value?.children[previousCount]?.querySelector('h3');
      (next ?? region.value)?.focus();
    }
  } catch {
    if (!controller.signal.aborted) loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function download(number) {
  if (pendingPdf.value) return;
  pendingPdf.value = number;
  downloadError.value = null;
  try {
    await downloadIssuedCutMap(number, controller.signal);
  } catch (cause) {
    if (!controller.signal.aborted)
      downloadError.value = {
        number,
        message: [401, 403, 404].includes(cause?.status)
          ? 'O PDF deste mapa está indisponível.'
          : 'Não foi possível baixar o PDF. Tente novamente.',
      };
  } finally {
    pendingPdf.value = null;
  }
}

onMounted(load);
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <div
    ref="region"
    class="cut-map-history"
    role="region"
    aria-label="Histórico de mapas de corte"
    tabindex="-1"
  >
    <ol v-if="maps.length" ref="list" class="cut-map-history-list" role="list">
      <li v-for="map in maps" :key="map.number" class="cut-map-history-row">
        <div>
          <h3 tabindex="-1">Mapa de corte {{ map.number }}</h3>
          <time :datetime="map.generatedAt">{{
            dateTime.format(new Date(map.generatedAt))
          }}</time>
        </div>
        <p><strong>Pedidos incluídos</strong> {{ map.orders.join(', ') }}</p>
        <button
          v-if="map.pdfAvailable"
          type="button"
          class="soft"
          :aria-label="`${pendingPdf === map.number ? 'Baixando' : 'Baixar'} PDF do mapa de corte ${map.number}`"
          :aria-disabled="pendingPdf !== null || undefined"
          @click="download(map.number)"
        >
          <AppIcon name="download" />
          {{ pendingPdf === map.number ? 'Baixando PDF…' : 'Baixar PDF' }}
        </button>
        <span v-else class="cut-map-history-unavailable">PDF indisponível</span>
        <p
          v-if="downloadError?.number === map.number"
          class="op-alert cut-map-history-error"
          role="alert"
        >
          {{ downloadError.message }}
        </p>
      </li>
    </ol>
    <div
      v-if="loading || loadError || !maps.length || nextCursor"
      class="cut-map-history-status"
    >
      <p v-if="loadError && !loading" class="op-alert" role="alert">
        Não foi possível carregar o histórico.
      </p>
      <p v-else-if="!loading && !maps.length" role="status">
        Nenhum mapa de corte disponível.
      </p>
      <button
        v-if="nextCursor || loadError"
        type="button"
        class="soft"
        :aria-disabled="loading || undefined"
        @click="load(true)"
      >
        {{ loadError ? 'Tentar novamente' : 'Carregar mais mapas' }}
      </button>
      <p v-if="loading" role="status">Carregando mapas de corte…</p>
    </div>
  </div>
</template>
