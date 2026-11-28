<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import { request } from '../../lib/api-client.js';
import { downloadIssuedCutMap } from '../../lib/order-pdf.js';

const maps = ref([]);
const list = ref(null);
const region = ref(null);
const searchInput = ref(null);
const query = ref('');
const activeSearch = ref('');
const nextCursor = ref(null);
const loading = ref(false);
const loadError = ref('');
const pendingPdf = ref(null);
const downloadError = ref(null);
const controller = new AbortController();
let listController;
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

async function load(focusResults = false, reset = false) {
  if (loading.value && !reset) return;
  if (reset) {
    listController?.abort();
    maps.value = [];
    nextCursor.value = null;
    loadError.value = '';
    downloadError.value = null;
  }
  const current = new AbortController();
  listController = current;
  const previousCount = maps.value.length;
  const params = new URLSearchParams();
  if (activeSearch.value) params.set('q', activeSearch.value);
  if (nextCursor.value) params.set('before', nextCursor.value);
  const search = params.size ? `?${params}` : '';
  loading.value = true;
  try {
    const { data } = await request(`/api/v1/orders/cut-maps${search}`, {
      signal: current.signal,
    });
    if (current.signal.aborted) return;
    maps.value.push(...data.items);
    nextCursor.value = data.nextCursor;
    loadError.value = '';
    await nextTick();
    if (focusResults && !current.signal.aborted) {
      const next = list.value?.children[previousCount]?.querySelector('h3');
      (next ?? region.value)?.focus();
    }
  } catch (cause) {
    if (!current.signal.aborted)
      loadError.value =
        activeSearch.value && cause?.status === 400 ? 'invalid' : 'load';
  } finally {
    if (listController === current) loading.value = false;
  }
}

function submitSearch() {
  const term = query.value.trim();
  if (loading.value && term === activeSearch.value) return;
  activeSearch.value = term;
  void load(false, true);
}

function clearSearch() {
  query.value = '';
  if (activeSearch.value) submitSearch();
  searchInput.value?.focus();
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
onBeforeUnmount(() => {
  listController?.abort();
  controller.abort();
});
</script>

<template>
  <div
    ref="region"
    class="cut-map-history"
    role="region"
    aria-label="Histórico de mapas de corte"
    tabindex="-1"
  >
    <form
      class="search-control cut-map-history-search"
      role="search"
      aria-label="Buscar no histórico de mapas de corte"
      @submit.prevent="submitSearch"
    >
      <label for="cut-map-history-query">Número do mapa ou do pedido</label>
      <div class="search-field">
        <input
          id="cut-map-history-query"
          ref="searchInput"
          v-model="query"
          type="search"
          maxlength="32"
          placeholder="Ex.: 24 ou 07-CRM"
          :aria-invalid="
            (loadError === 'invalid' && query.trim() === activeSearch) ||
            undefined
          "
          :aria-describedby="
            loadError === 'invalid' && query.trim() === activeSearch
              ? 'cut-map-history-invalid-search'
              : undefined
          "
        />
        <button
          v-if="query || activeSearch"
          type="button"
          class="quiet icon-button"
          aria-label="Limpar busca de mapas de corte"
          @click="clearSearch"
        >
          <AppIcon name="close" />
        </button>
        <button type="submit" class="soft">Buscar</button>
      </div>
    </form>
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
      <p
        v-if="loadError === 'invalid'"
        id="cut-map-history-invalid-search"
        class="op-alert"
        role="alert"
      >
        Digite um número de mapa ou de pedido, como 24 ou 07-CRM.
      </p>
      <p v-else-if="loadError && !loading" class="op-alert" role="alert">
        Não foi possível carregar o histórico.
      </p>
      <p v-else-if="!loading && !maps.length" role="status">
        {{
          activeSearch
            ? 'Nenhum mapa de corte encontrado para essa busca.'
            : 'Nenhum mapa de corte disponível.'
        }}
      </p>
      <button
        v-if="nextCursor || loadError === 'load'"
        type="button"
        class="soft"
        :aria-disabled="loading || undefined"
        @click="load(true)"
      >
        {{ loadError ? 'Tentar novamente' : 'Carregar mais mapas' }}
      </button>
      <p v-if="loading" role="status">Carregando mapas de corte…</p>
    </div>
    <p class="sr-only" aria-live="polite">
      <template v-if="activeSearch && maps.length && !loading">
        {{
          maps.length === 1
            ? '1 mapa encontrado.'
            : `${maps.length} mapas encontrados.`
        }}
      </template>
    </p>
  </div>
</template>
