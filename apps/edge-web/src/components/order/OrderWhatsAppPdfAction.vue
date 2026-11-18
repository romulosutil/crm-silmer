<script setup>
import { ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { openDialog } from '../../lib/ui.js';

const props = defineProps({
  order: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
});
/** @type {import('vue').Ref<HTMLDialogElement|null>} */
const dialog = ref(null);
const preview = ref(null);
const feedback = ref('');
const error = ref('');
const loading = ref(false);
const submitting = ref(false);
/** @type {{id:string,version:number,key:string,submitted:boolean}|null} */
let attempt = null;

watch(
  () => [props.order.id, props.order.version, props.order.pdfWhatsAppAvailable],
  () => {
    attempt = null;
    preview.value = null;
    if (dialog.value?.open) dialog.value.close();
  },
);

/** @param {MouseEvent} event */
async function prepare(event) {
  if (
    !dialog.value ||
    dialog.value.open ||
    loading.value ||
    submitting.value ||
    props.disabled
  )
    return;
  const trigger = /** @type {HTMLElement} */ (event.currentTarget);
  const current = {
    id: props.order.id,
    version: props.order.version,
    key: commandKey(),
    submitted: false,
  };
  if (
    !attempt?.submitted ||
    attempt.id !== current.id ||
    attempt?.version !== current.version ||
    !preview.value
  ) {
    attempt = current;
    preview.value = null;
  }
  error.value = '';
  feedback.value = '';
  openDialog(dialog.value, trigger);
  if (preview.value) return;
  loading.value = true;
  try {
    const { data } = await request(
      `/api/v1/orders/${encodeURIComponent(current.id)}/pdf/whatsapp?expectedVersion=${current.version}`,
    );
    if (attempt === current && dialog.value?.open) preview.value = data;
  } catch {
    if (attempt === current)
      error.value =
        'Confira o pedido e a conexão da linha para preparar o envio.';
  } finally {
    loading.value = false;
  }
}

async function send() {
  const current = attempt;
  if (!current || !preview.value || submitting.value || props.disabled) return;
  current.submitted = true;
  submitting.value = true;
  error.value = '';
  try {
    const { data: result } = await request(
      `/api/v1/orders/${encodeURIComponent(current.id)}/pdf/whatsapp`,
      {
        method: 'POST',
        idempotencyKey: current.key,
        body: {
          expectedVersion: current.version,
          preparation: preview.value.preparation,
        },
      },
    );
    if (attempt !== current) return;
    feedback.value = ['failed', 'outcome_unknown'].includes(result.status)
      ? 'Confira o status da ficha na conversa antes de preparar outro envio.'
      : 'Solicitação registrada. Acompanhe o envio na conversa.';
    attempt = null;
    preview.value = null;
    dialog.value?.close();
  } catch (cause) {
    if (attempt !== current) return;
    const status = Number(/** @type {any} */ (cause)?.status);
    if ([400, 403, 404, 409, 422].includes(status)) {
      attempt = null;
      preview.value = null;
      error.value =
        status === 422
          ? 'Não foi possível preparar o PDF desta ficha. Confira o pedido antes de tentar novamente.'
          : 'O pedido ou o destino mudou. Atualize o pedido e confira o envio na conversa.';
    } else {
      error.value =
        'A confirmação da solicitação está indisponível. Confira a conversa ou confirme novamente esta mesma solicitação.';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-disabled="loading || submitting || undefined"
    @click="prepare"
  >
    Enviar ficha pelo WhatsApp
  </button>
  <p v-if="feedback" role="status" class="op-hint">{{ feedback }}</p>
  <dialog
    ref="dialog"
    class="op-dialog op-generate-dialog"
    aria-labelledby="ficha-whatsapp-title"
    @cancel="submitting && $event.preventDefault()"
  >
    <form @submit.prevent="send">
      <h2 id="ficha-whatsapp-title">Enviar ficha pelo WhatsApp</h2>
      <p v-if="loading" role="status">Conferindo linha e destinatário…</p>
      <template v-if="preview">
        <p>Ficha em PDF do pedido {{ order.number }}.</p>
        <dl>
          <dt>Sua linha</dt>
          <dd>{{ preview.sender }}</dd>
          <dt>WhatsApp do cliente</dt>
          <dd>{{ preview.recipient }}</dd>
        </dl>
      </template>
      <p v-if="error" role="alert" class="op-alert">{{ error }}</p>
      <div class="op-dialog-actions">
        <button type="button" :disabled="submitting" @click="dialog?.close()">
          Voltar
        </button>
        <button
          v-if="preview"
          type="submit"
          class="primary"
          :disabled="disabled"
          :aria-disabled="submitting || undefined"
        >
          {{ submitting ? 'Preparando envio…' : 'Confirmar envio' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
