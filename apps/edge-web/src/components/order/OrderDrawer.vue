<script setup>
import { computed, ref } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import {
  amountLabel,
  missingFieldLabels,
  missingHeadline,
  orderStatusLabel,
} from '../../lib/order-format.js';
import { openDialog } from '../../lib/ui.js';

/** PFI-09: what keeps "Confirmar pedido" out of reach, as the order page reads it. */
const BLOCKERS = Object.freeze(['items', 'finalAmount', 'paymentCondition']);

/**
 * PCX-07/D22: the order beside the conversation, on demand and read only. It
 * answers "is there an order, and what is still missing" without leaving the
 * Inbox; every change belongs to the order page.
 */
const props = defineProps({
  /** Whether this reader owns the conversation or administrates it (PCX-08). */
  canCreate: { type: Boolean, default: false },
  conversationId: { type: String, required: true },
  /** The version the seller is looking at, so a stale create loses to a 409. */
  conversationVersion: { type: Number, default: 0 },
});
const emit = defineEmits(['changed']);

const dialog = ref(null);
const order = ref(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
let controller;

const title = computed(() =>
  order.value ? `Pedido ${order.value.number}` : 'Sem pedido',
);
const statusLabel = computed(() => orderStatusLabel(order.value?.status));
const headline = computed(() => missingHeadline(order.value?.missingFields));
/**
 * The headline already names what blocks the confirmation, so repeating it
 * underneath would waste the only column this drawer has. The second line is
 * for the ficha fields nothing blocks on — the part the headline drops.
 */
const fichaGapLabels = computed(() =>
  missingFieldLabels(
    (order.value?.missingFields ?? []).filter(
      (/** @type {string} */ field) => !BLOCKERS.includes(field),
    ),
  ),
);
const items = computed(() =>
  (order.value?.ficha?.items ?? []).map((item, index) => ({
    key: `${index}`,
    label: [item.tipo, item.modelo].filter(Boolean).join(' · ') || 'Item',
    pieces: (item.grade ?? []).reduce(
      (/** @type {number} */ total, /** @type {any} */ line) =>
        total + Number(line.quantidade ?? 0),
      0,
    ),
  })),
);
// PCX-08/PCL-11: offered only where the API would accept it — no pending
// order, and a reader who owns the conversation or administrates it.
const canCreateOrder = computed(
  () => props.canCreate && order.value?.status !== 'pendente',
);

/** @param {HTMLElement} trigger the button that opened it, for PCX-09. */
async function open(trigger) {
  const element = dialog.value;
  if (!(element instanceof HTMLDialogElement)) return;
  error.value = '';
  openDialog(element, trigger);
  await load();
}

function close() {
  /** @type {HTMLDialogElement|null} */ (dialog.value)?.close();
}

/**
 * PCX-09: a click on the backdrop lands on the dialog itself, never on the
 * panel inside it.
 *
 * @param {MouseEvent} event
 */
function closeOnBackdrop(event) {
  if (event.target === dialog.value) close();
}

async function load() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  try {
    const response = await request(
      `/api/v1/conversations/${encodeURIComponent(props.conversationId)}/order`,
      { signal: controller.signal },
    );
    order.value = response.data.order;
    error.value = '';
  } catch (cause) {
    if (/** @type {any} */ (cause)?.name === 'AbortError') return;
    order.value = null;
    error.value = 'Não foi possível carregar o pedido desta conversa.';
  } finally {
    loading.value = false;
  }
}

/**
 * PCL-10: the pending order is created from the pré-ficha the conversation
 * already holds. It rides the conversation version on screen, so a create
 * typed over a stale panel loses to a 409 instead of racing the winner.
 */
async function createOrder() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await request(
      `/api/v1/conversations/${encodeURIComponent(props.conversationId)}/orders`,
      {
        body: { expectedVersion: props.conversationVersion },
        idempotencyKey: commandKey(),
        method: 'POST',
      },
    );
    order.value = response.data.order;
    emit('changed');
  } catch (cause) {
    const status = Number(/** @type {any} */ (cause)?.status);
    if (status === 409) {
      error.value = 'A conversa mudou. Feche a gaveta e tente de novo.';
    } else if (status === 403) {
      error.value = 'Só o vendedor responsável ou um administrador cria aqui.';
    } else {
      error.value = 'Não foi possível criar o pedido.';
    }
  } finally {
    busy.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="order-drawer"
    aria-labelledby="order-drawer-title"
    @click="closeOnBackdrop"
  >
    <div class="order-drawer-panel">
      <div class="panel-head">
        <div>
          <h2 id="order-drawer-title">{{ title }}</h2>
          <p>{{ statusLabel }}</p>
        </div>
        <button type="button" @click="close">Fechar</button>
      </div>

      <div v-if="loading" class="loading-state" role="status">
        Carregando pedido…
      </div>
      <p v-else-if="error" role="alert" class="audit-note">{{ error }}</p>

      <template v-if="!loading && order">
        <p class="order-drawer-headline">{{ headline }}</p>
        <p v-if="fichaGapLabels.length" class="footnote">
          Em branco na ficha: {{ fichaGapLabels.join(', ') }}.
        </p>

        <ul class="order-drawer-items" aria-label="Itens do pedido">
          <li v-for="item in items" :key="item.key">
            <span>{{ item.label }}</span>
            <span>{{ item.pieces }} peças</span>
          </li>
          <li v-if="!items.length">Nenhum item registrado.</li>
        </ul>

        <dl class="order-drawer-facts">
          <div>
            <dt>Total de peças</dt>
            <dd>{{ order.totalPieces }} peças</dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd>{{ amountLabel(order.finalAmountCents) }}</dd>
          </div>
        </dl>
      </template>

      <p v-else-if="!loading && !error" class="order-drawer-headline">
        Esta conversa ainda não tem pedido.
      </p>

      <div class="inline-actions">
        <RouterLink
          v-if="order"
          class="button-link"
          :to="`/pedidos/${order.id}?conversa=${conversationId}`"
          >Abrir pedido</RouterLink
        >
        <button
          v-if="canCreateOrder"
          type="button"
          class="primary"
          :disabled="busy"
          @click="createOrder"
        >
          Criar pedido
        </button>
      </div>
    </div>
  </dialog>
</template>
