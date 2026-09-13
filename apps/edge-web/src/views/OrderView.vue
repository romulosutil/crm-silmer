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
import OrderInfoStrips from '../components/order/OrderInfoStrips.vue';
import OrderItemsSection from '../components/order/OrderItemsSection.vue';
import OrderObservationsSection from '../components/order/OrderObservationsSection.vue';
import OrderSummarySection from '../components/order/OrderSummarySection.vue';
import { commandKey, request } from '../lib/api-client.js';
import {
  missingFieldLabels,
  PRINT_LOCKED_REASON,
} from '../lib/order-format.js';

const LIVE_REFRESH_DELAY_MS = 250;
const BLOCKERS = Object.freeze(['items', 'finalAmount', 'paymentCondition']);

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
const missingFields = computed(() => order.value?.missingFields ?? []);
const blockerLabels = computed(() =>
  missingFieldLabels(
    missingFields.value.filter((field) => BLOCKERS.includes(field)),
  ),
);
const fichaGapLabels = computed(() =>
  missingFieldLabels(
    missingFields.value.filter((field) => !BLOCKERS.includes(field)),
  ),
);
const customerName = computed(
  () => order.value?.ficha?.summary?.cliente || 'Cliente não informado',
);
const orderContext = computed(() => {
  const event = order.value?.ficha?.summary?.nome || 'Sem evento';
  const seller = order.value?.seller?.name;
  return seller ? `${event} · com ${seller}` : event;
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

provide('orderEditing', {
  canEdit,
  editingSection,
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

/** PIM-02: the API renders the approved document; the browser prints it. */
function print() {
  globalThis.open(
    `/api/v1/orders/${encodeURIComponent(props.orderId)}/print`,
    '_blank',
    'noopener',
  );
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
  <div class="page">
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

      <header class="page-heading order-head">
        <div>
          <p class="eyebrow">
            Pedido {{ order.number }} · FAB {{ order.fabCode }}
          </p>
          <h1 ref="heading" tabindex="-1">Pedido {{ order.number }}</h1>
          <p>{{ customerName }} — {{ orderContext }}</p>
        </div>
        <div class="inline-actions">
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
            Imprimir
          </button>
        </div>
      </header>

      <p v-if="isPending" id="order-print-reason" class="footnote">
        {{ PRINT_LOCKED_REASON }}
      </p>
      <p v-if="error" role="alert" class="audit-note">{{ error }}</p>
      <p v-if="!canEdit" class="audit-note">
        Somente {{ order.seller?.name || 'o dono da conversa' }} ou um
        administrador edita este pedido.
      </p>

      <div class="surface order-banner" role="status">
        <p v-if="blockerLabels.length">
          Falta para confirmar: {{ blockerLabels.join(', ') }}.
        </p>
        <p v-if="fichaGapLabels.length">
          Ainda em branco na ficha: {{ fichaGapLabels.join(', ') }}.
        </p>
        <p v-else>Os campos da ficha impressa estão completos.</p>
      </div>

      <!-- PFI-01: the order of the printed ficha, top to bottom. -->
      <OrderSummarySection :order="order" />
      <OrderItemsSection :order="order" />
      <OrderObservationsSection :order="order" />
      <OrderInfoStrips :order="order" />
      <section
        class="surface section-gap"
        aria-labelledby="order-closing-title"
      >
        <div class="panel-head">
          <h2 id="order-closing-title">Fechamento e pagamento</h2>
        </div>
      </section>
    </template>
  </div>
</template>
