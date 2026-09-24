<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue';
import OrderClosingSection from '../components/order/OrderClosingSection.vue';
import OrderIcon from '../components/order/OrderIcon.vue';
import OrderInfoStrips from '../components/order/OrderInfoStrips.vue';
import OrderItemsSection from '../components/order/OrderItemsSection.vue';
import OrderObservationsSection from '../components/order/OrderObservationsSection.vue';
import OrderSummarySection from '../components/order/OrderSummarySection.vue';
import { commandKey, request } from '../lib/api-client.js';
import {
  fabLabel,
  orderStatusLabel,
  PRINT_LOCKED_REASON,
} from '../lib/order-format.js';

const LIVE_REFRESH_DELAY_MS = 250;

const props = defineProps({
  fromConversationId: { type: String, default: '' },
  orderId: { type: String, required: true },
});

const liveEvent = inject('liveEvent', ref(null));
const sessionUser = inject('sessionUser', ref({}));
const heading = ref(null);
const order = ref(null);
const loading = ref(true);
const notFound = ref(false);
const error = ref('');
// PFI-06: one section in edit at a time, decided here so two open forms can
// never disagree about the version they are saving over.
const editingSection = ref('');
let controller;
let refreshTimer = 0;
let headingAnnounced = false;

const isPending = computed(() => order.value?.status === 'pendente');
const isAdmin = computed(() =>
  (sessionUser.value?.capabilities ?? []).includes('COMMERCIAL_ADMIN'),
);
/**
 * PAU-01: editing follows the conversation owner (D08). A reader who is
 * neither the owner nor an administrator sees the whole page, and no button
 * that the API would refuse with 403.
 */
const canEdit = computed(
  () =>
    Boolean(order.value) &&
    (isAdmin.value || order.value.seller?.id === sessionUser.value?.id),
);
const customerName = computed(
  () => order.value?.ficha?.summary?.cliente || 'Cliente não informado',
);
const orderContext = computed(() => {
  const event = order.value?.ficha?.summary?.nome || 'Sem evento';
  const seller = order.value?.seller?.name;
  return seller ? `${event} · com ${seller}` : event;
});
const itemCount = computed(() => order.value?.ficha?.items?.length ?? 0);
const deliveryLabel = computed(() => {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(
    String(order.value?.ficha?.summary?.data_entrega_confirmada ?? ''),
  );
  return match ? `entrega ${match[2]}/${match[1]}` : 'sem entrega confirmada';
});

/**
 * What a failed write means to the seller. The message is chosen here, next
 * to the version the page is holding, so every section says the same thing
 * about the same code.
 *
 * @param {any} cause
 */
function describeWriteError(cause) {
  const status = Number(cause?.status);
  const code = String(cause?.code ?? '');
  if (status === 409) return 'Este pedido mudou. Recarregue a seção.';
  if (status === 403) return 'Este pedido é de outro vendedor.';
  if (code === 'INVALID_AMOUNT') return 'Use o formato 4.820,00.';
  if (status >= 500) return 'Serviço indisponível no momento.';
  return 'Não foi possível salvar esta seção.';
}

/**
 * PFI-06: a section is written whole, over the version the page is showing.
 * The answer carries the new order, so the page never guesses what the server
 * derived (totals, what is missing) from the change.
 *
 * @param {string} section @param {unknown} value
 */
async function saveSection(section, value) {
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(props.orderId)}/sections/${section}`,
      {
        body: { expectedVersion: order.value.version, value },
        idempotencyKey: commandKey(),
        method: 'PATCH',
      },
    );
    order.value = response.data.order;
    return { ok: true };
  } catch (cause) {
    return {
      code: String(/** @type {any} */ (cause)?.code ?? ''),
      fields: /** @type {any} */ (cause)?.problem?.fields ?? [],
      index: /** @type {any} */ (cause)?.problem?.index,
      message: describeWriteError(cause),
      ok: false,
    };
  }
}

/**
 * PCL-04/PCL-07: the only two transitions of the order, both human. They ride
 * the version the page is showing, so a confirmation typed over a stale screen
 * loses to a 409 instead of overwriting the winner (PCL-09).
 *
 * @param {'confirm'|'reopen'} action @param {Record<string, unknown>} body
 */
async function runCommand(action, body) {
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(props.orderId)}/${action}`,
      {
        body: { ...body, expectedVersion: order.value.version },
        idempotencyKey: commandKey(),
        method: 'POST',
      },
    );
    order.value = response.data.order;
    return { ok: true };
  } catch (cause) {
    return {
      code: String(/** @type {any} */ (cause)?.code ?? ''),
      fields: /** @type {any} */ (cause)?.problem?.fields ?? [],
      message: describeWriteError(cause),
      ok: false,
    };
  }
}

/** PIM-02: the API renders the approved document; the browser prints it. */
function print() {
  globalThis.open(
    `/api/v1/orders/${encodeURIComponent(props.orderId)}/print`,
    '_blank',
    'noopener',
  );
}

provide('orderEditing', {
  canEdit,
  command: runCommand,
  editingSection,
  print,
  save: saveSection,
  /** @param {string} section */
  start(section) {
    editingSection.value = section;
  },
  stop() {
    editingSection.value = '';
  },
});

/** @param {boolean} [silent] */
async function load(silent = false) {
  controller?.abort();
  controller = new AbortController();
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(props.orderId)}`,
      { signal: controller.signal },
    );
    order.value = response.data.order;
    notFound.value = false;
    error.value = '';
  } catch (cause) {
    if (cause?.name === 'AbortError') return;
    if (Number(cause?.status) === 404) {
      notFound.value = true;
      order.value = null;
      return;
    }
    error.value = 'Não foi possível carregar o pedido.';
  } finally {
    loading.value = false;
    // The heading only exists once the order (or its absence) is known, so
    // focus lands after the first answer instead of on the loading state.
    if (!headingAnnounced) {
      headingAnnounced = true;
      await nextTick();
      heading.value?.focus();
    }
  }
}

/** Collapses bursts of live events into one silent refresh. */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void load(true);
  }, LIVE_REFRESH_DELAY_MS);
}

// A section under edit is not overwritten from under the seller: the refresh
// waits for Salvar or Cancelar.
watch(liveEvent, (event) => {
  if (editingSection.value !== '') return;
  if (event?.reset || event?.type === 'inbox.order.changed') {
    scheduleLiveRefresh();
  }
});

onMounted(() => {
  void load();
});
onBeforeUnmount(() => {
  controller?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page op-page">
    <div v-if="loading" class="loading-state" role="status">
      Carregando pedido…
    </div>

    <section v-else-if="notFound" class="surface empty-list">
      <h1 ref="heading" tabindex="-1">Pedido não encontrado</h1>
      <p>Ele pode ter sido removido ou o endereço está errado.</p>
      <RouterLink class="button-link" to="/pedidos"
        >Voltar para Pedidos</RouterLink
      >
    </section>

    <template v-else-if="order">
      <nav class="order-trail" aria-label="Rastro">
        <RouterLink to="/pedidos">← Pedidos</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ order.number }}</span>
        <span v-if="fromConversationId" class="order-origin">
          aberto a partir da conversa de {{ customerName }}
        </span>
      </nav>

      <header class="op-head">
        <div class="op-head-text">
          <div class="op-head-title">
            <h1 ref="heading" tabindex="-1">Pedido {{ order.number }}</h1>
            <span class="op-status" :data-status="order.status">
              <OrderIcon :name="isPending ? 'clock' : 'check'" />
              {{ orderStatusLabel(order.status) }}
            </span>
          </div>
          <p>
            {{ customerName }} — {{ orderContext }} ·
            {{ fabLabel(order.fabCode) }}
          </p>
        </div>
        <div class="op-head-actions">
          <RouterLink
            v-if="fromConversationId"
            class="button-link quiet-link"
            to="/inbox"
            >Abrir conversa</RouterLink
          >
          <button
            type="button"
            :disabled="isPending"
            :aria-describedby="isPending ? 'order-print-reason' : undefined"
            @click="print"
          >
            <OrderIcon name="printer" />Imprimir
          </button>
        </div>
      </header>

      <p v-if="isPending" id="order-print-reason" class="op-print-reason">
        {{ PRINT_LOCKED_REASON }}
      </p>
      <p v-if="error" role="alert" class="op-alert">{{ error }}</p>
      <p v-if="!canEdit" class="op-readonly">
        <OrderIcon name="lock" />
        Somente {{ order.seller?.name || 'o dono da conversa' }} ou um
        administrador edita este pedido.
      </p>

      <div class="op-layout">
        <!-- PFI-01: the order of the printed ficha, top to bottom. -->
        <div class="op-main">
          <OrderSummarySection :order="order" />
          <OrderItemsSection :order="order" />
          <OrderObservationsSection :order="order" />
          <OrderInfoStrips :order="order" />
        </div>
        <aside class="op-rail" aria-label="Gerar pedido">
          <OrderClosingSection :order="order" />
          <p class="op-total">
            <span class="op-total-label">
              Total de peças
              <span class="op-num"
                >{{ itemCount }} {{ itemCount === 1 ? 'item' : 'itens' }} ·
                {{ deliveryLabel }}</span
              >
            </span>
            <strong class="op-num">{{ order.totalPieces }}</strong>
          </p>
        </aside>
      </div>
    </template>
  </div>
</template>
