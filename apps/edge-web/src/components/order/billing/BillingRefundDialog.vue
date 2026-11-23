<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import { KIND, dateOf, parseAmount } from '../../../lib/order-billing-view.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Registrar devolução": only a record of what was done in the InfinitePay;
 * the CRM moves no money. After it, the charge goes to conferência.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const link = ref(null);
const raw = ref('');
const done = ref(false);
const errors = ref({ amount: '', check: '' });
const busy = ref(false);
const error = ref('');
const intent = billingIntent((record) => ctx.run(record));

const k = computed(() => ctx.view.value.figures);
const max = computed(() =>
  link.value ? link.value.amountCents - link.value.refundedCents : 0,
);
const value = computed(() => parseAmount(raw.value));
const validValue = computed(
  () =>
    value.value !== null &&
    !Number.isNaN(value.value) &&
    value.value > 0 &&
    value.value <= max.value,
);

const cents = computed(() => (validValue.value ? Number(value.value) : 0));

/** @param {HTMLElement} trigger @param {any} target */
async function open(trigger, target) {
  link.value = target;
  raw.value = '';
  done.value = false;
  errors.value = { amount: '', check: '' };
  error.value = '';
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element, '#order-billing-rf-amount');
}
/** @param {string} selector */
function focus(selector) {
  /** @type {HTMLElement|null} */ (
    dlg.value?.element?.querySelector(selector)
  )?.focus();
}
async function confirm() {
  if (busy.value) return;
  const v = value.value;
  errors.value = {
    amount:
      v === null
        ? 'Informe o valor devolvido.'
        : Number.isNaN(v)
          ? 'Use só números, como 500,00.'
          : v <= 0
            ? 'Informe um valor maior que zero.'
            : v > max.value
              ? `O valor passa do que pode ser devolvido (${billingMoney(max.value)}).`
              : '',
    check: done.value
      ? ''
      : 'Confirme que a devolução já foi feita na InfinitePay.',
  };
  if (errors.value.amount) return focus('#order-billing-rf-amount');
  if (errors.value.check) return focus('#order-billing-rf-check');
  busy.value = true;
  error.value = '';
  const target = link.value;
  try {
    await intent.send(() => ({
      path: `charges/${encodeURIComponent(target.chargeId)}/refund`,
      body: { ...ctx.versions(), amountCents: v },
    }));
    busy.value = false;
    ctx.flash(
      `Devolução de ${billingMoney(/** @type {number} */ (v))} registrada. A cobrança foi para conferência.`,
      'info',
    );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o registro. Registrar de novo repete o mesmo pedido, sem duplicar.'
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
    title="Registrar devolução"
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
            {{ KIND[link.kind].title
            }}<span
              >{{ billingMoney(link.amountCents) }} pago por
              {{ link.payMethod }} em {{ dateOf(link.paidAt) }}</span
            >
          </dd>
        </div>
        <div>
          <dt>Já devolvido</dt>
          <dd>{{ billingMoney(link.refundedCents) }}</dd>
        </div>
      </dl>
      <div class="bl-field">
        <label for="order-billing-rf-amount"
          >Valor já devolvido ao cliente</label
        >
        <div class="bl-money">
          <span aria-hidden="true">R$</span
          ><input
            id="order-billing-rf-amount"
            v-model="raw"
            inputmode="decimal"
            autocomplete="off"
            :aria-invalid="errors.amount ? 'true' : 'false'"
            aria-describedby="order-billing-rf-hint order-billing-rf-error"
            @input="errors.amount = ''"
          />
        </div>
        <p id="order-billing-rf-hint" class="op-hint">
          Até {{ billingMoney(max) }}
        </p>
        <p id="order-billing-rf-error" class="bl-field-error">
          <template v-if="errors.amount"
            ><OrderIcon name="alert" /><span>{{
              errors.amount
            }}</span></template
          >
        </p>
      </div>
      <label class="bl-check"
        ><input
          id="order-billing-rf-check"
          v-model="done"
          type="checkbox"
          :aria-invalid="errors.check ? 'true' : 'false'"
          aria-describedby="order-billing-rf-check-error"
          @change="done && (errors.check = '')"
        />Já devolvi este valor pela InfinitePay.</label
      >
      <p id="order-billing-rf-check-error" class="bl-field-error">
        <template v-if="errors.check"
          ><OrderIcon name="alert" /><span>{{ errors.check }}</span></template
        >
      </p>
      <p class="bl-review" aria-live="polite">
        <template v-if="validValue"
          >Recebido passa a
          <strong>{{ billingMoney(k.received - cents) }}</strong>
          · falta
          <strong>{{ billingMoney(k.remaining + cents) }}</strong></template
        ><template v-else
          >Recebido hoje <strong>{{ billingMoney(k.received) }}</strong> · falta
          <strong>{{ billingMoney(k.remaining) }}</strong></template
        >
      </p>
      <p class="bl-note">
        <OrderIcon name="info" /><span
          >O CRM não devolve dinheiro: isto só registra o que foi feito na
          InfinitePay. Depois do registro, a cobrança vai para
          conferência.</span
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
        {{ busy ? 'Registrando…' : 'Registrar devolução' }}
      </button>
    </template>
  </JourneyDialog>
</template>
