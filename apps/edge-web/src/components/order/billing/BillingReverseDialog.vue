<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import { METHODS, dateOf } from '../../../lib/order-billing-view.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Estornar registro": undoes a manual receipt. The record stays in the
 * history; no money is returned.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const receipt = ref(null);
const reason = ref('');
const invalid = ref('');
const busy = ref(false);
const error = ref('');
const intent = billingIntent((record) => ctx.run(record));
const k = computed(() => ctx.view.value.figures);
const method = computed(
  () =>
    METHODS[/** @type {keyof typeof METHODS} */ (receipt.value?.method)]
      ?.short ?? 'Outro meio',
);

/** @param {HTMLElement} trigger @param {any} target */
async function open(trigger, target) {
  receipt.value = target;
  reason.value = '';
  invalid.value = '';
  error.value = '';
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element, '#order-billing-rv-reason');
}
async function confirm() {
  if (busy.value) return;
  invalid.value = reason.value.trim() ? '' : 'Escreva o motivo do estorno.';
  if (invalid.value) {
    dlg.value?.element?.querySelector('#order-billing-rv-reason')?.focus();
    return;
  }
  busy.value = true;
  error.value = '';
  const target = receipt.value;
  try {
    await intent.send(() => ({
      path: `external-receipts/${encodeURIComponent(target.id)}/reverse`,
      body: { ...ctx.versions(), reason: reason.value.trim() },
    }));
    busy.value = false;
    const f = ctx.view.value.figures;
    ctx.flash(
      `Registro estornado. Recebido passa a ${billingMoney(f.received)} · falta ${billingMoney(f.remaining)}.`,
    );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o estorno. Estornar de novo repete o mesmo pedido.'
      : billingError(cause);
    await nextTick();
    dlg.value?.element?.querySelector('.bl-warn')?.focus();
  }
}
defineExpose({ open });
</script>

<template>
  <JourneyDialog
    ref="dlg"
    class="bl-dialog"
    title="Estornar registro"
    close-label="Fechar"
  >
    <template v-if="receipt">
      <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
        <OrderIcon name="alert" /><span>{{ error }}</span>
      </p>
      <dl class="bl-dl">
        <div>
          <dt>Registro</dt>
          <dd>
            Recebido por fora · {{ method
            }}<span
              >{{ billingMoney(receipt.amountCents) }} · recebido em
              {{ dateOf(receipt.receivedOn) }}</span
            >
          </dd>
        </div>
      </dl>
      <div class="bl-field">
        <label for="order-billing-rv-reason">Motivo do estorno</label>
        <textarea
          id="order-billing-rv-reason"
          v-model="reason"
          maxlength="500"
          rows="3"
          :aria-invalid="invalid ? 'true' : 'false'"
          aria-describedby="order-billing-rv-error order-billing-rv-count"
          @input="reason.trim() && (invalid = '')"
        ></textarea>
        <div class="bl-field-foot">
          <p id="order-billing-rv-error" class="bl-field-error">
            <template v-if="invalid"
              ><OrderIcon name="alert" /><span>{{ invalid }}</span></template
            >
          </p>
          <p id="order-billing-rv-count" class="op-hint">
            {{ reason.length }}/500
          </p>
        </div>
      </div>
      <p class="bl-review">
        Recebido passa a
        <strong>{{ billingMoney(k.received - receipt.amountCents) }}</strong> ·
        falta
        <strong>{{ billingMoney(k.remaining + receipt.amountCents) }}</strong>
      </p>
      <p class="bl-note">
        <OrderIcon name="info" /><span
          >O registro continua no histórico. Nenhum dinheiro é devolvido.</span
        >
      </p>
    </template>
    <template #footer>
      <button type="button" @click="dlg.close()">Voltar</button>
      <button
        type="button"
        class="primary"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-busy="busy ? 'true' : undefined"
        @click="confirm"
      >
        {{ busy ? 'Estornando…' : 'Estornar registro' }}
      </button>
    </template>
  </JourneyDialog>
</template>
