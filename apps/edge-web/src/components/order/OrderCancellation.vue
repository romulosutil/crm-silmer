<script setup>
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { dateTimeBR } from '../../lib/format.js';
import { openDialog } from '../../lib/ui.js';

const props = defineProps({
  order: { type: Object, required: true },
  allowed: { type: Boolean, default: false },
  blocked: { type: Boolean, default: true },
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(['saved', 'refresh', 'busy']);
const liveEvent = inject('liveEvent', ref(null));
const dialog = ref(null);
const title = ref(null);
const notice = ref(null);
const cancelButton = ref(null);
let restorePending = false;
const reason = ref('');
const error = ref('');
const busy = ref(false);
const stale = ref(false);
let expectedVersion;
let controller;
let disposed = false;

async function focusNotice() {
  await nextTick();
  if (!disposed) notice.value?.focus();
}
/** @param {Event} event */
function begin(event) {
  if (!props.allowed || props.blocked || props.order.cancelledAt) return;
  expectedVersion = props.order.version;
  reason.value = '';
  error.value = '';
  stale.value = false;
  openDialog(dialog.value, /** @type {HTMLElement} */ (event.currentTarget));
  emit('busy', true);
}
function close() {
  if (busy.value) return;
  dialog.value?.close();
  emit('busy', false);
}
function closed() {
  restorePending = true;
  emit('busy', false);
}
watch(
  () => props.blocked,
  async (blocked) => {
    if (blocked || !restorePending || !props.allowed || dialog.value?.open)
      return;
    restorePending = false;
    await nextTick();
    if (!disposed) cancelButton.value?.focus();
  },
);
function invalidate() {
  if (!dialog.value?.open) return;
  stale.value = true;
  error.value =
    'O pedido ou seu acesso mudou. Volte e atualize o pedido antes de cancelar.';
}
async function cancelOrder() {
  if (busy.value || stale.value || !props.allowed || props.blocked) return;
  if (!reason.value.trim() || /[\u0000-\u001f\u007f]/u.test(reason.value)) {
    error.value =
      'Informe um motivo, em uma única linha, para cancelar o pedido.';
    await focusNotice();
    return;
  }
  const orderId = props.order.id;
  const own = new AbortController();
  controller = own;
  busy.value = true;
  error.value = '';
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: 'POST',
        body: { expectedVersion, reason: reason.value.trim() },
        idempotencyKey: commandKey(),
        signal: own.signal,
      },
    );
    if (disposed || own.signal.aborted || props.order.id !== orderId) return;
    busy.value = false;
    close();
    emit('saved', response.data.order);
    await nextTick();
    title.value?.focus();
  } catch (cause) {
    if (disposed || own.signal.aborted) return;
    stale.value = true;
    error.value =
      cause?.code === 'ORDER_CANCELLATION_BLOCKED'
        ? 'Há uma venda reservada, enviada, vinculada ou incerta. O cancelamento local está bloqueado. Atualize o pedido.'
        : [401, 403].includes(Number(cause?.status))
          ? 'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.'
          : Number(cause?.status) === 409
            ? 'O pedido mudou. Volte e atualize o pedido antes de decidir novamente.'
            : 'Não foi possível confirmar o cancelamento. Volte e atualize o pedido para conferir o resultado.';
    await focusNotice();
  } finally {
    if (!disposed) busy.value = false;
  }
}
watch(
  () => [props.order.id, props.order.version, props.allowed, props.blocked],
  invalidate,
);
watch(liveEvent, invalidate);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  emit('busy', false);
});
</script>

<template>
  <section
    class="op-sheet order-cancellation"
    :class="{ 'order-cancellation--embedded': embedded }"
    aria-labelledby="order-cancellation-title"
  >
    <div class="op-sheet-body">
      <template v-if="order.cancelledAt">
        <h2 id="order-cancellation-title" ref="title" tabindex="-1">
          Pedido cancelado
        </h2>
        <p>
          Cancelado em {{ dateTimeBR(order.cancelledAt) }} · responsável
          {{ order.cancelledBy?.name || 'Pessoa autorizada' }}.
        </p>
        <p>
          Motivo:
          {{ order.cancellationReason || 'Motivo registrado no histórico.' }}
        </p>
        <p class="field-help">
          Este cancelamento é definitivo. Histórico, pagamentos e Nota criada
          foram preservados. Nenhum estorno ou cancelamento no Olist foi
          solicitado.
        </p>
      </template>
      <details v-else-if="allowed">
        <summary id="order-cancellation-title">Cancelamento local</summary>
        <p class="field-help">
          Retira o pedido das filas e totais ativos. O histórico e os pagamentos
          são preservados, sem estorno ou cancelamento no Olist.
        </p>
        <p v-if="blocked" class="field-help">
          Salve a edição e confira o estado Olist. Uma venda reservada, enviada,
          vinculada ou incerta impede o cancelamento local.
        </p>
        <button
          v-else
          ref="cancelButton"
          type="button"
          class="danger"
          @click="begin"
        >
          Cancelar pedido localmente
        </button>
      </details>
    </div>
    <dialog
      ref="dialog"
      class="op-dialog op-generate-dialog"
      aria-labelledby="cancel-order-heading"
      aria-describedby="cancel-order-description"
      @cancel="busy ? $event.preventDefault() : undefined"
      @close="closed"
    >
      <form @submit.prevent="cancelOrder">
        <h2 id="cancel-order-heading">Cancelar pedido localmente?</h2>
        <p id="cancel-order-description">
          O pedido {{ order.number }} ficará cancelado definitivamente. Não será
          possível editar, reabrir ou gerar no Olist. Histórico, pagamentos e
          Nota criada serão preservados.
        </p>
        <p class="field-help">
          Esta ação não estorna dinheiro nem cancela uma venda no ERP.
        </p>
        <label for="order-cancellation-reason">Motivo do cancelamento</label>
        <input
          id="order-cancellation-reason"
          v-model="reason"
          type="text"
          maxlength="1000"
          required
          :disabled="busy || stale"
        />
        <p
          v-if="error"
          ref="notice"
          class="inline-error"
          role="alert"
          tabindex="-1"
        >
          {{ error }}
        </p>
        <div class="form-actions op-dialog-actions">
          <button type="button" :disabled="busy" @click="close">Voltar</button>
          <button
            v-if="stale"
            type="button"
            @click="
              close();
              emit('refresh');
            "
          >
            Atualizar pedido
          </button>
          <button
            v-else
            type="submit"
            class="danger"
            :disabled="busy || !allowed || blocked"
          >
            {{ busy ? 'Cancelando…' : 'Cancelar definitivamente' }}
          </button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.order-cancellation {
  margin-top: var(--space-4);
}
.order-cancellation .op-sheet-body {
  padding-block: var(--space-3);
}
.order-cancellation--embedded {
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.order-cancellation--embedded .op-sheet-body {
  padding: 0;
}
.order-cancellation--embedded details {
  padding: 0;
  border: 0;
  border-radius: 0;
}
.order-cancellation summary {
  cursor: pointer;
  min-height: var(--target-min);
  align-content: center;
  font-weight: 600;
}
.order-cancellation p,
.order-cancellation .form-actions {
  margin-top: var(--space-3);
}
.order-cancellation p {
  overflow-wrap: anywhere;
}
.order-cancellation button {
  min-height: var(--target-min);
}
.order-cancellation .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.order-cancellation input {
  width: 100%;
}
</style>
