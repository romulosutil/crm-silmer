<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingMoney, billingUrl } from '../../../lib/order-billing.js';
import { KIND, dateTimeOf } from '../../../lib/order-billing-view.js';
import { focusInDialog } from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Ver comprovante": private — only the owner and administrators (the API
 * sends nothing private to anyone else). The NSU is masked.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const link = ref(null);
/** @type {import('vue').Ref<any>} */
const payment = ref(null);
const K = computed(
  () => KIND[/** @type {keyof typeof KIND} */ (link.value?.kind ?? 'part')],
);
const nsu = computed(() => {
  const value = String(payment.value?.transactionNsu ?? '');
  return value ? `•••• ${value.slice(-4)}` : '';
});
const invoice = computed(
  () => link.value?.invoiceCode || payment.value?.invoiceCode || '',
);
const receiptUrl = computed(() => billingUrl(payment.value?.receiptUrl));

/** @param {HTMLElement} trigger @param {any} target */
async function open(trigger, target) {
  link.value = target;
  payment.value = ctx.view.value.paymentOf(target);
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element);
}
defineExpose({ open });
</script>

<template>
  <JourneyDialog
    ref="dlg"
    class="bl-dialog"
    :title="`Comprovante ${K.of}`"
    close-label="Fechar"
  >
    <template v-if="link">
      <dl class="bl-dl">
        <div>
          <dt>Cobrança</dt>
          <dd>{{ K.title }}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{{ billingMoney(link.amountCents) }}</dd>
        </div>
        <div>
          <dt>Forma</dt>
          <dd>{{ link.payMethod }} pela InfinitePay</dd>
        </div>
        <div>
          <dt>Pago em</dt>
          <dd>{{ dateTimeOf(link.paidAt) }}</dd>
        </div>
        <div v-if="invoice">
          <dt>Código da fatura</dt>
          <dd>{{ invoice }}</dd>
        </div>
        <div v-if="nsu">
          <dt>NSU da transação</dt>
          <dd>{{ nsu }}</dd>
        </div>
      </dl>
      <a
        v-if="receiptUrl"
        class="bl-external"
        :href="receiptUrl"
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        ><OrderIcon name="external" />Abrir comprovante na InfinitePay<span
          class="sr-only"
        >
          (abre em nova aba)</span
        ></a
      >
      <p class="bl-note">
        <OrderIcon name="lock" /><span
          >Comprovante emitido pela InfinitePay. Só o responsável e
          administradores o veem.</span
        >
      </p>
    </template>
    <template #footer>
      <button type="button" @click="dlg.close()">Fechar</button>
    </template>
  </JourneyDialog>
</template>
