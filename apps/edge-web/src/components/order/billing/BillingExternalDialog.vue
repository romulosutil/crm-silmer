<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import {
  METHODS,
  linkName,
  outsidePlan,
  outsidePrimary,
  outsideReview,
  parseAmount,
  timeOf,
} from '../../../lib/order-billing-view.js';
import { todayISO } from '../../../lib/format.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Registrar pagamento por fora" (RFC 074, LPC-06/07): up to the free amount.
 * When the value needs money reserved in links the customer has not clicked,
 * the same confirmation cancels those links (`cancelLinkIds`) and the review
 * says both effects. A link Em pagamento or in Resultado a conferir refuses,
 * with the reason; a click that wins the race refuses in place.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
const amount = ref('');
const receivedOn = ref('');
const method = ref('');
const note = ref('');
const errors = ref({ amount: '', date: '', method: '' });
const busy = ref(false);
const error = ref('');
/** @type {import('vue').Ref<any>} */
const raced = ref(null);
const today = ref(todayISO());
const intent = billingIntent((record) => ctx.run(record));

const view = computed(() => ctx.view.value);
const k = computed(() => view.value.figures);
const value = computed(() => parseAmount(amount.value));
const plan = computed(() => outsidePlan(value.value, view.value));
const blockId = computed(() =>
  raced.value
    ? 'order-billing-x-race'
    : plan.value.refuse
      ? 'order-billing-x-refuse'
      : '',
);
const primaryLabel = computed(() =>
  raced.value ? 'Registrar pagamento' : outsidePrimary(value.value, plan.value),
);
const review = computed(() =>
  raced.value
    ? outsideReview(null, { ok: false, cancel: [], refuse: '' }, k.value)
    : outsideReview(value.value, plan.value, k.value),
);
const hint = computed(
  () =>
    `Falta receber ${billingMoney(k.value.remaining)}${k.value.reserved > 0 ? ` · livre para cobrar ${billingMoney(k.value.free)}; o resto está em links abertos` : ''}`,
);
const offer = computed(() => {
  const p = plan.value;
  if (!p.ok || !p.cancel.length || value.value === null) return '';
  const where =
    p.cancel.length === 1
      ? `no ${linkName(p.cancel[0])} (${billingMoney(p.cancel[0].amountCents)})`
      : `em ${p.cancel.length} links abertos`;
  return `${billingMoney(value.value - k.value.free)} deste valor está reservado ${where}, que o cliente ainda não clicou. Para registrar, ${p.cancel.length === 1 ? 'o link é cancelado' : 'os links são cancelados'} no mesmo passo.`;
});
const raceText = computed(() => {
  const r = raced.value;
  if (!r) return '';
  return `Não deu para cancelar o ${linkName(r)}: o cliente clicou em Pagar às ${timeOf(r.clickedAt)}. Nada foi registrado. Acompanhe o pagamento${k.value.free >= 1 ? ` ou registre só até o livre para cobrar (${billingMoney(k.value.free)})` : ''}.`;
});

/** @param {HTMLElement} trigger */
async function open(trigger) {
  amount.value = '';
  today.value = todayISO();
  receivedOn.value = today.value;
  method.value = '';
  note.value = '';
  errors.value = { amount: '', date: '', method: '' };
  error.value = '';
  raced.value = null;
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element, '#order-billing-x-amount');
}
function onAmount() {
  raced.value = null;
  intent.reset();
  if (errors.value.amount) errors.value.amount = '';
}
/** @param {string} selector */
function focus(selector) {
  /** @type {HTMLElement|null} */ (
    dlg.value?.element?.querySelector(selector)
  )?.focus();
}
async function submit() {
  if (busy.value || blockId.value) return;
  const v = value.value;
  const remaining = k.value.remaining;
  errors.value = {
    amount:
      v === null
        ? 'Informe o valor recebido.'
        : Number.isNaN(v)
          ? 'Use só números, como 1.000,00.'
          : v <= 0
            ? 'Informe um valor maior que zero.'
            : v > remaining
              ? `O valor passa do que falta receber (${billingMoney(remaining)}).`
              : '',
    date: !receivedOn.value
      ? 'Informe a data do recebimento.'
      : receivedOn.value > today.value
        ? 'A data não pode ser futura.'
        : '',
    method: method.value ? '' : 'Escolha a forma de pagamento.',
  };
  if (errors.value.amount) return focus('#order-billing-x-amount');
  if (errors.value.date) return focus('#order-billing-x-date');
  if (errors.value.method) return focus('input[name="order-billing-x-method"]');
  const p = plan.value;
  if (!p.ok || v === null) return;
  busy.value = true;
  error.value = '';
  const cancelled = p.cancel;
  try {
    await intent.send(() => ({
      path: 'external-receipts',
      body: {
        ...ctx.versions(),
        amountCents: v,
        receivedOn: receivedOn.value,
        method: method.value,
        note: note.value.trim(),
        cancelLinkIds: cancelled.map((l) => l.id),
      },
    }));
    busy.value = false;
    const short =
      METHODS[/** @type {keyof typeof METHODS} */ (method.value)]?.short ?? '';
    const tail = cancelled.length
      ? ` ${cancelled.length === 1 ? `O ${linkName(cancelled[0])} foi cancelado.` : `${cancelled.length} links foram cancelados.`}`
      : '';
    ctx.flash(
      `${billingMoney(v)} registrado como recebido por fora (${short}).${tail}`,
    );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    const code = String(/** @type {any} */ (cause)?.code ?? '');
    if (code === 'BILLING_LINK_NOT_OPEN' && cancelled.length) {
      const problem = /** @type {any} */ (cause)?.problem ?? {};
      const fresh =
        view.value.links.find(
          (/** @type {any} */ l) => l.id === cancelled[0].id,
        ) ?? cancelled[0];
      raced.value = {
        ...fresh,
        clickedAt: problem.clickedAt ?? fresh.clickedAt,
      };
      await nextTick();
      focus('#order-billing-x-race');
      return;
    }
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o registro. Os valores ficam preservados: registrar de novo repete o mesmo pedido, sem duplicar.'
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
    title="Registrar pagamento por fora"
    close-label="Fechar"
  >
    <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
      <OrderIcon name="alert" /><span>{{ error }}</span>
    </p>
    <p class="bl-lead">
      Para um pagamento que o cliente fez fora da InfinitePay. O CRM só registra
      o valor; não há comprovante anexado.
    </p>
    <div class="bl-field-row">
      <div class="bl-field">
        <label for="order-billing-x-amount">Valor recebido</label>
        <div class="bl-money">
          <span aria-hidden="true">R$</span
          ><input
            id="order-billing-x-amount"
            v-model="amount"
            inputmode="decimal"
            autocomplete="off"
            :aria-invalid="errors.amount ? 'true' : 'false'"
            aria-describedby="order-billing-x-amount-hint order-billing-x-amount-error"
            @input="onAmount"
          />
        </div>
        <p id="order-billing-x-amount-hint" class="op-hint">{{ hint }}</p>
        <p id="order-billing-x-amount-error" class="bl-field-error">
          <template v-if="errors.amount"
            ><OrderIcon name="alert" /><span>{{
              errors.amount
            }}</span></template
          >
        </p>
      </div>
      <div class="bl-field">
        <label for="order-billing-x-date">Data do recebimento</label>
        <input
          id="order-billing-x-date"
          v-model="receivedOn"
          type="date"
          :max="today"
          :aria-invalid="errors.date ? 'true' : 'false'"
          aria-describedby="order-billing-x-date-error"
          @input="errors.date = ''"
        />
        <p id="order-billing-x-date-error" class="bl-field-error">
          <template v-if="errors.date"
            ><OrderIcon name="alert" /><span>{{ errors.date }}</span></template
          >
        </p>
      </div>
    </div>
    <p
      v-if="raced"
      id="order-billing-x-race"
      class="bl-warn"
      tabindex="-1"
      role="alert"
    >
      <OrderIcon name="alert" /><span>{{ raceText }}</span>
    </p>
    <p v-else-if="plan.refuse" id="order-billing-x-refuse" class="bl-warn">
      <OrderIcon name="alert" /><span>{{ plan.refuse }}</span>
    </p>
    <p v-else-if="offer" class="bl-warn">
      <OrderIcon name="alert" /><span>{{ offer }}</span>
    </p>
    <fieldset class="bl-radio-group">
      <legend>Forma de pagamento</legend>
      <div class="bl-radio-options">
        <label v-for="(m, key) in METHODS" :key="key" class="bl-radio"
          ><input
            v-model="method"
            type="radio"
            name="order-billing-x-method"
            :value="key"
            :aria-invalid="errors.method ? 'true' : 'false'"
            aria-describedby="order-billing-x-method-error"
            @change="errors.method = ''"
          />{{ m.label }}</label
        >
      </div>
      <p id="order-billing-x-method-error" class="bl-field-error">
        <template v-if="errors.method"
          ><OrderIcon name="alert" /><span>{{ errors.method }}</span></template
        >
      </p>
    </fieldset>
    <div class="bl-field">
      <label for="order-billing-x-note">Observação (opcional)</label>
      <textarea
        id="order-billing-x-note"
        v-model="note"
        maxlength="500"
        rows="2"
        aria-describedby="order-billing-x-note-count"
      ></textarea>
      <p id="order-billing-x-note-count" class="op-hint">
        {{ note.length }}/500
      </p>
    </div>
    <p class="bl-review" aria-live="polite">
      <template v-for="(part, at) in review" :key="at"
        ><strong v-if="typeof part === 'object'">{{ part.strong }}</strong
        ><template v-else>{{ part }}</template></template
      >
    </p>
    <template #footer>
      <button type="button" @click="dlg.close()">Voltar</button>
      <button
        type="button"
        class="primary"
        :aria-disabled="busy || blockId ? 'true' : undefined"
        :aria-describedby="blockId || undefined"
        :aria-busy="busy ? 'true' : undefined"
        @click="submit"
      >
        {{ busy ? 'Registrando…' : primaryLabel }}
      </button>
    </template>
  </JourneyDialog>
</template>
