<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import {
  dayMonthTimeOf,
  linkName,
  reconcileOptions,
  timeOf,
} from '../../../lib/order-billing-view.js';
import {
  billingIntent,
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Resolver conferência" (reconcile), in two steps: confirm the payments in
 * the InfinitePay, then apply them to the current value or cancel the links
 * the customer has not clicked. An option that cannot apply stays visible,
 * aria-disabled, with its reason; "Aplicar" stays available even with a link
 * Em pagamento (only cancelling is blocked).
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
const step = ref(1);
const checked = ref(false);
const checkError = ref('');
const choice = ref(/** @type {'apply'|'cancel'} */ ('apply'));
const busy = ref(false);
const error = ref('');
/** @type {Array<'apply'|'cancel'>} */
const KEYS = ['apply', 'cancel'];
const intent = billingIntent((record) => ctx.run(record));

const view = computed(() => ctx.view.value);
const options = computed(() => reconcileOptions(view.value));
const ok = computed(() => options.value[choice.value].ok);
const heldLink = computed(() => view.value.groups.review[0] ?? null);
const providerUrl = computed(() =>
  heldLink.value ? view.value.providerUrl(heldLink.value) : '',
);

/** @param {HTMLElement} trigger */
async function open(trigger) {
  step.value = 1;
  checked.value = false;
  checkError.value = '';
  choice.value = /** @type {'apply'|'cancel'} */ (options.value.initial);
  busy.value = false;
  error.value = '';
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element);
}
async function show(next = 1) {
  step.value = next;
  await nextTick();
  focusInDialog(dlg.value?.element);
}
function back() {
  if (step.value === 2) void show(1);
  else dlg.value.close();
}
/** @param {'apply'|'cancel'} value @param {Event} event */
async function pick(value, event) {
  if (!options.value[value].ok) {
    /** @type {HTMLInputElement} */ (event.target).checked = false;
    await nextTick();
    /** @type {HTMLElement|null} */ (
      dlg.value?.element?.querySelector(
        `input[name="order-billing-rc"][value="${choice.value}"]`,
      )
    )?.focus();
    return;
  }
  choice.value = value;
}
async function confirm() {
  if (busy.value) return;
  if (step.value === 1) {
    checkError.value = checked.value
      ? ''
      : 'Confirme que conferiu os pagamentos na InfinitePay.';
    if (checkError.value) {
      dlg.value?.element?.querySelector('#order-billing-rc-check')?.focus();
      return;
    }
    await show(2);
    return;
  }
  if (!ok.value) return;
  busy.value = true;
  error.value = '';
  const action =
    choice.value === 'apply' ? 'apply_current' : 'cancel_open_links';
  try {
    await intent.send(() => ({
      path: 'reconcile',
      // The contract's "action" is read by the API as `decision`.
      body: {
        ...ctx.versions(),
        decision: action,
        confirmedProviderReview: true,
      },
    }));
    busy.value = false;
    const fresh = ctx.view.value;
    if (action === 'apply_current')
      ctx.flash(
        `Conferência resolvida. Recebido passa a ${billingMoney(fresh.figures.received)} · falta ${billingMoney(fresh.figures.remaining)}.`,
      );
    else if (!fresh.review)
      ctx.flash('Links cancelados. Conferência resolvida.');
    else
      ctx.flash(
        'Links cancelados. O pagamento guardado continua em conferência.',
        'info',
      );
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    // run() re-read the view on a 409, so the options already say why.
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar a decisão. Confirmar de novo repete o mesmo pedido.'
      : /** @type {any} */ (cause)?.code === 'BILLING_LINK_EXCEEDS_FREE'
        ? options.value.apply.ok
          ? 'Os pagamentos e os links abertos passam do total. Cancele links que o cliente ainda não clicou antes de aplicar.'
          : options.value.apply.reason
        : billingError(cause);
    await nextTick();
    dlg.value?.element?.querySelector('.bl-warn[role="alert"]')?.focus();
  }
}
defineExpose({ open });
</script>

<template>
  <JourneyDialog
    ref="dlg"
    class="bl-dialog"
    title="Resolver conferência"
    close-label="Fechar"
  >
    <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
      <OrderIcon name="alert" /><span>{{ error }}</span>
    </p>
    <template v-if="step === 1">
      <p class="bl-step">Passo 1 de 2 · Confira na InfinitePay</p>
      <p class="bl-lead">
        Antes de decidir, confira na InfinitePay os pagamentos desta cobrança:
        valores, datas e se o cliente abriu algum pagamento.
      </p>
      <dl class="bl-dl">
        <div v-for="row in view.rows" :key="row.id">
          <dt>
            {{ row.title
            }}<span v-if="row.type === 'charge'" class="op-hint bl-dt-sub"
              >link de {{ dayMonthTimeOf(row.item.createdAt) }}</span
            >
          </dt>
          <dd>
            {{
              billingMoney(
                row.type === 'charge'
                  ? row.amountCents - row.item.refundedCents
                  : row.amountCents,
              )
            }}<span>{{ row.badge.label }}</span>
          </dd>
        </div>
      </dl>
      <a
        v-if="providerUrl"
        class="bl-external"
        :href="providerUrl"
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        ><OrderIcon name="external" />Abrir cobrança na InfinitePay<span
          class="sr-only"
        >
          (abre em nova aba)</span
        ></a
      >
      <label class="bl-check"
        ><input
          id="order-billing-rc-check"
          v-model="checked"
          type="checkbox"
          :aria-invalid="checkError ? 'true' : 'false'"
          aria-describedby="order-billing-rc-error"
          @change="checked && (checkError = '')"
        />Conferi os pagamentos desta cobrança na InfinitePay.</label
      >
      <p id="order-billing-rc-error" class="bl-field-error">
        <template v-if="checkError"
          ><OrderIcon name="alert" /><span>{{ checkError }}</span></template
        >
      </p>
      <p v-if="options.paying" class="bl-warn">
        <OrderIcon name="alert" /><span
          >O cliente está pagando o {{ linkName(options.paying) }} na
          InfinitePay (aberto às {{ timeOf(options.paying.clickedAt) }}).
          Enquanto isso, os links não podem ser cancelados.</span
        >
      </p>
    </template>
    <template v-else>
      <p class="bl-step">Passo 2 de 2 · Escolha o que fazer</p>
      <fieldset class="bl-terms-pick">
        <legend>O que fazer com os pagamentos</legend>
        <div class="bl-cards" data-count="1">
          <label
            v-for="key in KEYS"
            :key="key"
            class="bl-card"
            :data-unavailable="options[key].ok ? undefined : ''"
            ><input
              type="radio"
              name="order-billing-rc"
              :value="key"
              :checked="choice === key"
              :aria-disabled="options[key].ok ? undefined : 'true'"
              :aria-describedby="
                options[key].ok ? undefined : `order-billing-rc-${key}-reason`
              "
              @change="pick(key, $event)"
            /><span class="bl-card-title">{{ options[key].title }}</span
            ><span class="bl-card-detail">{{ options[key].detail }}</span
            ><span
              v-if="!options[key].ok"
              :id="`order-billing-rc-${key}-reason`"
              class="bl-card-reason"
              ><OrderIcon name="info" /><span>{{
                options[key].reason
              }}</span></span
            ></label
          >
        </div>
      </fieldset>
      <p class="bl-note">
        <OrderIcon name="info" /><span
          >A decisão fica no histórico. O CRM não move dinheiro.</span
        >
      </p>
    </template>
    <template #footer>
      <button type="button" @click="back">Voltar</button>
      <button
        type="button"
        class="primary"
        :aria-disabled="busy || (step === 2 && !ok) ? 'true' : undefined"
        :aria-describedby="
          step === 2 && !ok ? `order-billing-rc-${choice}-reason` : undefined
        "
        :aria-busy="busy ? 'true' : undefined"
        @click="confirm"
      >
        {{
          step === 1
            ? 'Continuar'
            : choice === 'apply'
              ? 'Aplicar pagamentos'
              : 'Cancelar links'
        }}
      </button>
    </template>
  </JourneyDialog>
</template>
