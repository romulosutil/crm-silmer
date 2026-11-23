<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingMoney, billingError } from '../../../lib/order-billing.js';
import { KIND, TERMS, valueSub } from '../../../lib/order-billing-view.js';
import {
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';
import BillingSendReview from './BillingSendReview.vue';

/*
 * "Enviar link do sinal": the review before the link leaves (RFC 074). The
 * condition, when chosen now, is saved with the send. The progress continues
 * in Próximo passo once the send is accepted.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const plan = ref(null);
const destination = ref('');
const busy = ref(false);
const error = ref('');

const K = computed(
  () => KIND[/** @type {keyof typeof KIND} */ (plan.value?.kind ?? 'part')],
);
const condition = computed(() =>
  plan.value?.fromPick
    ? TERMS[/** @type {0|50|100} */ (plan.value.condition)]
    : null,
);

/**
 * @param {HTMLElement} trigger
 * @param {{kind: string, amountCents: number, fromPick?: boolean, condition?: number, linkId?: string, url?: string}} next
 */
async function open(trigger, next) {
  plan.value = next;
  error.value = '';
  busy.value = false;
  destination.value = 'Conversa vinculada ao pedido';
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element);
  try {
    destination.value = (await ctx.conversation()).label;
  } catch {
    destination.value = 'Conversa vinculada ao pedido';
  }
}
async function confirm() {
  if (busy.value || !plan.value) return;
  busy.value = true;
  error.value = '';
  try {
    await ctx.startSend({
      mode: 'send',
      kind: plan.value.kind,
      amountCents: plan.value.amountCents,
      linkId: plan.value.linkId,
      percent: plan.value.fromPick ? plan.value.condition : undefined,
    });
    busy.value = false;
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o envio. Os valores ficam preservados: Enviar de novo repete o mesmo pedido, sem duplicar o link.'
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
    :title="`Enviar link ${K.of}`"
    close-label="Fechar"
  >
    <template v-if="plan">
      <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
        <OrderIcon name="alert" /><span>{{ error }}</span>
      </p>
      <BillingSendReview
        :order-number="ctx.orderNumber.value"
        :order-title="ctx.orderTitle.value"
        :destination="destination"
        :kind="plan.kind"
        :amount-cents="plan.amountCents"
        :value-sub="valueSub(plan.kind, ctx.view.value.figures)"
        :condition="condition"
        :url="plan.url || ''"
        :existing="Boolean(plan.linkId)"
      />
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
        {{
          busy
            ? 'Enviando…'
            : `Enviar link de ${billingMoney(plan?.amountCents ?? 0)}`
        }}
      </button>
    </template>
  </JourneyDialog>
</template>
