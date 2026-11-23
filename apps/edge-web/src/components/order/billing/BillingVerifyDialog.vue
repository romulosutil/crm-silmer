<script setup>
import { inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import { KIND, dayMonthTimeOf } from '../../../lib/order-billing-view.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Verificar pagamento na InfinitePay" (payment_check): when the customer says
 * they paid and the payment does not show. It registers nothing; the
 * InfinitePay confirms or not.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const link = ref(null);
const invoice = ref('');
const nsu = ref('');
const errors = ref({ invoice: '', nsu: '' });
const busy = ref(false);
const error = ref('');
const intent = billingIntent((record) => ctx.run(record));

/** @param {HTMLElement} trigger @param {any} target */
async function open(trigger, target) {
  link.value = target;
  invoice.value = '';
  nsu.value = '';
  errors.value = { invoice: '', nsu: '' };
  error.value = '';
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element, '#order-billing-v-invoice');
}
/** @param {string} selector */
function focus(selector) {
  /** @type {HTMLElement|null} */ (
    dlg.value?.element?.querySelector(selector)
  )?.focus();
}
async function confirm() {
  if (busy.value) return;
  errors.value = {
    invoice: invoice.value.trim() ? '' : 'Informe o código da fatura.',
    nsu: nsu.value.trim() ? '' : 'Informe o NSU da transação.',
  };
  if (errors.value.invoice) return focus('#order-billing-v-invoice');
  if (errors.value.nsu) return focus('#order-billing-v-nsu');
  busy.value = true;
  error.value = '';
  const target = link.value;
  try {
    await intent.send(() => ({
      path: `charges/${encodeURIComponent(target.chargeId)}/check-payment`,
      body: {
        ...ctx.versions(),
        invoiceSlug: invoice.value.trim(),
        transactionNsu: nsu.value.trim(),
      },
    }));
    busy.value = false;
    const fresh = ctx.view.value.links.find(
      (/** @type {any} */ l) => l.id === target.id,
    );
    ctx.flash(
      fresh?.verifyAt
        ? `Verificação pedida. A InfinitePay responde na próxima consulta, às ${fresh.verifyAt}.`
        : 'Verificação pedida. A InfinitePay responde na próxima consulta.',
      'info',
    );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o pedido de verificação. Pedir de novo repete o mesmo pedido.'
      : billingError(cause);
    await nextTick();
    focus('.bl-warn');
  }
}
defineExpose({ open });
</script>

<template>
  <JourneyDialog
    ref="dlg"
    class="bl-dialog"
    title="Verificar pagamento na InfinitePay"
    close-label="Fechar"
  >
    <template v-if="link">
      <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
        <OrderIcon name="alert" /><span>{{ error }}</span>
      </p>
      <dl class="bl-dl">
        <div>
          <dt>Cobrança</dt>
          <dd>
            {{ KIND[link.kind].cap }} · {{ billingMoney(link.amountCents)
            }}<span>{{
              link.clickedAt
                ? `aberto na InfinitePay às ${dayMonthTimeOf(link.clickedAt)}`
                : `link de ${dayMonthTimeOf(link.createdAt)}`
            }}</span>
          </dd>
        </div>
      </dl>
      <p class="bl-lead">
        Use quando o cliente diz que pagou e o pagamento ainda não aparece aqui.
      </p>
      <p id="order-billing-v-hint" class="op-hint">
        Estão no comprovante que o cliente recebeu da InfinitePay ou no painel
        da InfinitePay.
      </p>
      <div class="bl-field-row">
        <div class="bl-field">
          <label for="order-billing-v-invoice">Código da fatura</label>
          <input
            id="order-billing-v-invoice"
            v-model="invoice"
            autocomplete="off"
            :aria-invalid="errors.invoice ? 'true' : 'false'"
            aria-describedby="order-billing-v-hint order-billing-v-invoice-error"
          />
          <p id="order-billing-v-invoice-error" class="bl-field-error">
            <template v-if="errors.invoice"
              ><OrderIcon name="alert" /><span>{{
                errors.invoice
              }}</span></template
            >
          </p>
        </div>
        <div class="bl-field">
          <label for="order-billing-v-nsu">NSU da transação</label>
          <input
            id="order-billing-v-nsu"
            v-model="nsu"
            inputmode="numeric"
            autocomplete="off"
            :aria-invalid="errors.nsu ? 'true' : 'false'"
            aria-describedby="order-billing-v-hint order-billing-v-nsu-error"
          />
          <p id="order-billing-v-nsu-error" class="bl-field-error">
            <template v-if="errors.nsu"
              ><OrderIcon name="alert" /><span>{{ errors.nsu }}</span></template
            >
          </p>
        </div>
      </div>
      <p class="bl-note">
        <OrderIcon name="info" /><span
          >Isto não registra pagamento: a InfinitePay confirma ou não.</span
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
        {{ busy ? 'Pedindo…' : 'Pedir verificação' }}
      </button>
    </template>
  </JourneyDialog>
</template>
