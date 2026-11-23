<script setup>
import { inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';
import BillingCancelBody from './BillingCancelBody.vue';

/*
 * "Cancelar link" (RFC 074, LPC-03/04): only while the customer has not
 * clicked Pagar. If the click won the race, the refusal replaces the body in
 * place (role=alert, focused) and only "Fechar" remains.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const link = ref(null);
/** @type {import('vue').Ref<any>} */
const figures = ref(null);
/** @type {import('vue').Ref<any>} */
const refusal = ref(null);
const busy = ref(false);
const error = ref('');
const intent = billingIntent((record) => ctx.run(record));

/** @param {HTMLElement} trigger @param {any} target a normalized link */
async function open(trigger, target) {
  link.value = target;
  figures.value = ctx.view.value.figures;
  refusal.value = null;
  error.value = '';
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element);
}
async function confirm() {
  if (busy.value || refusal.value) return;
  busy.value = true;
  error.value = '';
  const target = link.value;
  try {
    await intent.send(() => ({
      path: `links/${encodeURIComponent(target.id)}/cancel`,
      body: { ...ctx.versions() },
    }));
    busy.value = false;
    ctx.flash(
      `Link de ${billingMoney(target.amountCents)} cancelado. Quem abrir o link verá que ele foi cancelado.`,
    );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    const problem = /** @type {any} */ (cause)?.problem ?? {};
    if (/** @type {any} */ (cause)?.code === 'BILLING_LINK_NOT_OPEN') {
      // run() already re-read the view on a 409.
      const fresh = ctx.view.value.links.find(
        (/** @type {any} */ l) => l.id === target.id,
      );
      const state = String(problem.state ?? fresh?.state ?? '');
      refusal.value = {
        state: state === 'cancelled' || state === 'paid' ? state : 'paying',
        clickedAt: problem.clickedAt ?? fresh?.clickedAt ?? null,
        providerValidUntil: fresh?.providerValidUntil ?? null,
      };
      if (fresh) link.value = fresh;
      await nextTick();
      dlg.value?.element
        ?.querySelector('#order-billing-cancel-refusal')
        ?.focus();
      return;
    }
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o cancelamento. Cancelar de novo repete o mesmo pedido.'
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
    title="Cancelar link"
    close-label="Fechar"
  >
    <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
      <OrderIcon name="alert" /><span>{{ error }}</span>
    </p>
    <BillingCancelBody
      v-if="link"
      :link="link"
      :figures="figures"
      :refusal="refusal"
    />
    <template #footer>
      <button type="button" @click="dlg.close()">
        {{ refusal ? 'Fechar' : 'Voltar' }}
      </button>
      <button
        v-if="!refusal"
        type="button"
        class="primary"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-busy="busy ? 'true' : undefined"
        @click="confirm"
      >
        {{ busy ? 'Cancelando…' : 'Cancelar link' }}
      </button>
    </template>
  </JourneyDialog>
</template>
