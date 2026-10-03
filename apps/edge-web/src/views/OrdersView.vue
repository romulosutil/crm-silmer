<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { request } from '../lib/api-client.js';
import { dateTimeBR } from '../lib/format.js';
import {
  amountLabel,
  elapsedSince,
  missingHeadline,
} from '../lib/order-format.js';

const LIVE_REFRESH_DELAY_MS = 250;
const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 25;

const FILTERS = Object.freeze([
  Object.freeze({ label: 'Todos', value: '' }),
  Object.freeze({ label: 'Confirmados', value: 'confirmado' }),
  Object.freeze({ label: 'Pendentes', value: 'pendente' }),
]);

const liveEvent = inject('liveEvent', ref(null));
const router = useRouter();
const heading = ref(null);
const filter = ref('');
const query = ref('');
const items = ref([]);
const counts = ref({ confirmado: 0, pendente: 0 });
const nextCursor = ref(null);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
// The clock is refreshed on every load, so "parado há" does not freeze at the
// value the first render happened to compute.
const now = ref(new Date());
let controller;
let refreshTimer = 0;
let searchTimer = 0;
let clockTimer = 0;

const confirmedOrders = computed(() =>
  items.value.filter((order) => order.status === 'confirmado'),
);
const pendingOrders = computed(() =>
  items.value.filter((order) => order.status === 'pendente'),
);
const showConfirmed = computed(
  () => filter.value === '' || filter.value === 'confirmado',
);
const showPending = computed(
  () => filter.value === '' || filter.value === 'pendente',
);
const isEmpty = computed(() => !loading.value && items.value.length === 0);

/** @param {Record<string, any>} order */
function customerName(order) {
  return order.ficha?.summary?.cliente || 'Cliente não informado';
}

/** PLI-04: the event and the seller travel with the customer. */
/** @param {Record<string, any>} order */
function customerContext(order) {
  const event = order.ficha?.summary?.nome || 'Sem evento';
  return `${event} · ${order.seller?.name || 'sem vendedor'}`;
}

/** PLI-05: what is missing and for how long, or who confirmed and when. */
/** @param {Record<string, any>} order */
function situation(order) {
  if (order.status === 'confirmado') {
    const who = order.confirmedBy?.name || 'vendedor';
    return `Confirmado por ${who} · ${dateTimeBR(order.confirmedAt)}`;
  }
  const still = elapsedSince(order.updatedAt, now.value);
  const headline = missingHeadline(order.missingFields);
  return still === '' ? headline : `${headline} · parado há ${still}`;
}

/** A delivered outbound message without a later reply is evidence of waiting. */
function clientWaiting(order) {
  if (order.status !== 'pendente') return '';
  const message = order.lastMessage;
  if (message?.direction !== 'outbound') return '';
  if (!['sent', 'delivered', 'read'].includes(message.deliveryStatus))
    return '';
  if (typeof message.occurredAt !== 'string') return '';
  const lastAt = new Date(message.occurredAt).getTime();
  if (!Number.isFinite(lastAt) || now.value.getTime() - lastAt < 48 * 3_600_000)
    return '';
  return `Cliente sem resposta há ${elapsedSince(message.occurredAt, now.value)}`;
}

function priority(order) {
  if (order.status !== 'pendente') return '';
  if (clientWaiting(order)) return 'Retomar contato';
  const age = now.value.getTime() - new Date(order.updatedAt).getTime();
  return Number.isFinite(age) && age >= 72 * 3_600_000 ? 'Revisar pedido' : '';
}

function openOrder(order, event) {
  if (event.target?.closest?.('a, button, input, select, textarea')) return;
  void router.push(`/pedidos/${order.id}`);
}

/** @param {string|null} cursor */
function listUrl(cursor) {
  const params = new globalThis.URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filter.value) params.set('status', filter.value);
  const needle = query.value.trim();
  if (needle) params.set('q', needle);
  if (cursor) params.set('cursor', cursor);
  return `/api/v1/orders?${params}`;
}

/** @param {boolean} [silent] */
async function load(silent = false) {
  controller?.abort();
  controller = new AbortController();
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const response = await request(listUrl(null), {
      signal: controller.signal,
    });
    items.value = response.data.items;
    counts.value = response.data.counts;
    nextCursor.value = response.data.nextCursor;
    now.value = new Date();
    error.value = '';
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os pedidos.';
    }
  } finally {
    loading.value = false;
  }
}

/** PLI-07: "Ver mais" appends the next page instead of replacing the list. */
async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const response = await request(listUrl(nextCursor.value));
    items.value = [...items.value, ...response.data.items];
    counts.value = response.data.counts;
    nextCursor.value = response.data.nextCursor;
    now.value = new Date();
  } catch {
    error.value = 'Não foi possível carregar mais pedidos.';
  } finally {
    loadingMore.value = false;
  }
}

/** PIM-02: the document is the API's; the browser's own print dialog runs it. */
/** @param {Record<string, any>} order */
function print(order) {
  globalThis.open(
    `/api/v1/orders/${encodeURIComponent(order.id)}/print`,
    '_blank',
    'noopener',
  );
}

/** @param {string} value */
function selectFilter(value) {
  if (filter.value === value) return;
  filter.value = value;
  void load();
}

/** Collapses bursts of live events into one silent refresh. */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void load(true);
  }, LIVE_REFRESH_DELAY_MS);
}

watch(query, () => {
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  searchTimer = globalThis.setTimeout(() => {
    searchTimer = 0;
    void load();
  }, SEARCH_DELAY_MS);
});

// PLI-08: order, conversation and contact changes may change the list's labels
// or the last message used to prioritize contact.
watch(liveEvent, (event) => {
  if (
    event?.reset ||
    [
      'inbox.order.changed',
      'inbox.conversation.changed',
      'inbox.contact.changed',
    ].includes(event?.type)
  ) {
    scheduleLiveRefresh();
  }
});

onMounted(() => {
  heading.value?.focus();
  void load();
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 60_000);
});
onBeforeUnmount(() => {
  controller?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  if (clockTimer) globalThis.clearInterval(clockTimer);
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Carteira</p>
        <h1 ref="heading" tabindex="-1">Pedidos</h1>
        <p>
          Confirmados já podem ter a ficha impressa. Pedidos pendentes podem ser
          retomados pelo vendedor responsável ou administrador.
        </p>
      </div>
    </header>

    <div class="filter-bar">
      <div class="chip-row" role="group" aria-label="Filtrar pedidos">
        <button
          v-for="option in FILTERS"
          :key="option.value"
          class="chip"
          type="button"
          :aria-pressed="filter === option.value"
          @click="selectFilter(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="search-control">
        <label for="order-search">Buscar número, cliente ou telefone</label>
        <div class="search-field">
          <input id="order-search" v-model="query" type="search" />
        </div>
      </div>
      <p class="filter-summary">
        {{ counts.confirmado }} confirmados · {{ counts.pendente }} pendentes
      </p>
    </div>

    <p v-if="error" role="alert" class="audit-note">{{ error }}</p>
    <div v-if="loading" class="loading-state" role="status">
      Carregando pedidos…
    </div>
    <section v-else-if="isEmpty" class="surface empty-list" aria-live="polite">
      <h2>Nenhum pedido por aqui</h2>
      <p>Revise o filtro ou a busca informada.</p>
    </section>
    <template v-else>
      <section
        v-if="showConfirmed && confirmedOrders.length"
        class="surface section-gap"
        aria-labelledby="orders-confirmed-title"
      >
        <div class="panel-head">
          <h2 id="orders-confirmed-title">
            Confirmados
            <span class="badge" data-tone="success">{{
              counts.confirmado
            }}</span>
          </h2>
          <p>valor e forma de pagamento registrados</p>
        </div>
        <p class="table-scroll-hint">
          Deslize a tabela para ver todas as colunas.
        </p>
        <div
          class="table-wrap"
          role="region"
          tabindex="0"
          aria-label="Pedidos confirmados; role horizontalmente para ver todas as colunas"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">Cliente</th>
                <th scope="col" class="num">Peças</th>
                <th scope="col" class="num">Valor</th>
                <th scope="col">Situação</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="order in confirmedOrders"
                :key="order.id"
                class="clickable-row"
                @click="openOrder(order, $event)"
              >
                <td>#{{ order.number }}</td>
                <td>
                  <strong>{{ customerName(order) }}</strong>
                  <small class="order-context">{{
                    customerContext(order)
                  }}</small>
                </td>
                <td class="num">{{ order.totalPieces }}</td>
                <td class="num">{{ amountLabel(order.finalAmountCents) }}</td>
                <td>{{ situation(order) }}</td>
                <td>
                  <div class="row-actions">
                    <button class="primary" type="button" @click="print(order)">
                      Imprimir
                    </button>
                    <RouterLink class="button-link" :to="`/pedidos/${order.id}`"
                      >Abrir</RouterLink
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="showPending && pendingOrders.length"
        class="surface section-gap"
        aria-labelledby="orders-pending-title"
      >
        <div class="panel-head">
          <h2 id="orders-pending-title">
            Pendentes
            <span class="badge" data-tone="warning">{{ counts.pendente }}</span>
          </h2>
          <p>qualquer vendedor retoma do primeiro campo que falta</p>
        </div>
        <p class="table-scroll-hint">
          Deslize a tabela para ver todas as colunas.
        </p>
        <div
          class="table-wrap"
          role="region"
          tabindex="0"
          aria-label="Pedidos pendentes; role horizontalmente para ver todas as colunas"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">Cliente</th>
                <th scope="col" class="num">Peças</th>
                <th scope="col" class="num">Valor</th>
                <th scope="col">Situação</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="order in pendingOrders"
                :key="order.id"
                class="clickable-row"
                @click="openOrder(order, $event)"
              >
                <td>#{{ order.number }}</td>
                <td>
                  <strong>{{ customerName(order) }}</strong>
                  <small class="order-context">{{
                    customerContext(order)
                  }}</small>
                </td>
                <td class="num">{{ order.totalPieces }}</td>
                <td class="num">{{ amountLabel(order.finalAmountCents) }}</td>
                <td>
                  <span
                    v-if="priority(order)"
                    class="badge"
                    :data-tone="clientWaiting(order) ? 'warning' : 'info'"
                    >{{ priority(order) }}</span
                  >
                  <small v-if="clientWaiting(order)" class="order-context">{{
                    clientWaiting(order)
                  }}</small>
                  <small class="order-context">{{ situation(order) }}</small>
                </td>
                <td>
                  <div class="row-actions">
                    <RouterLink class="button-link" :to="`/pedidos/${order.id}`"
                      >Continuar</RouterLink
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <button
        v-if="nextCursor"
        class="load-more"
        type="button"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Carregando…' : 'Ver mais' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.clickable-row {
  cursor: pointer;
}
</style>
