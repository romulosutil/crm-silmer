<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import {
  KIND,
  LINK_MIN_CENTS,
  decimal,
  linkKind,
  parseAmount,
} from '../../../lib/order-billing-view.js';
import {
  focusInDialog,
  uncertainFailure,
} from '../../../lib/order-billing-command.js';
import JourneyDialog from '../../JourneyDialog.vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Enviar outro link" (RFC 074): any amount from R$ 1,00 up to the free
 * amount. The line's name (Sinal, Saldo or Parcela) comes from the value; the
 * review is the message itself. Without a conversation the action is "Gerar"
 * and the words say so; an amount that will not be used never reaches the
 * preview; Enter in the field is the primary action, with the same checks.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
const raw = ref('');
const invalid = ref('');
const busy = ref(/** @type {''|'send'|'generate'} */ (''));
const error = ref('');
const destination = ref('');
/** @type {import('vue').Ref<any>} */
const snapshot = ref(null);

const view = computed(() => snapshot.value ?? ctx.view.value);
const max = computed(() => view.value.figures.free);
const conv = computed(() => Boolean(ctx.conv.value));
const verb = computed(() => (conv.value ? 'Enviar' : 'Gerar'));
/** The primary action: send in the conversation, or only generate. */
const primaryMode = computed(() =>
  conv.value
    ? /** @type {const} */ ('send')
    : /** @type {const} */ ('generate'),
);
const value = computed(() => parseAmount(raw.value));
/** @param {number|null} v */
const valid = (v) =>
  v !== null && !Number.isNaN(v) && v >= LINK_MIN_CENTS && v <= max.value;
const ok = computed(() => valid(value.value));
const amount = computed(() =>
  ok.value ? /** @type {number} */ (value.value) : max.value,
);
const kind = computed(() => linkKind(view.value, amount.value));
const title = computed(() =>
  view.value.groups.open.length
    ? `${verb.value} outro link`
    : `${verb.value} link ${KIND[linkKind(view.value, max.value)].of}`,
);

/** One accepted write per opening: later presses are ignored. */
let done = false;

/** @param {HTMLElement} trigger */
async function open(trigger) {
  done = false;
  snapshot.value = ctx.view.value;
  raw.value = decimal(max.value);
  invalid.value = '';
  error.value = '';
  busy.value = '';
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element, '#order-billing-amount');
  if (conv.value)
    try {
      destination.value = (await ctx.conversation()).label;
    } catch {
      destination.value = 'Conversa vinculada ao pedido';
    }
}
function onInput() {
  if (invalid.value && ok.value) invalid.value = '';
}
/** Enter submits like the primary button; busy() keeps it to one write.
 * @param {KeyboardEvent} event */
function onEnter(event) {
  if (event.isComposing) return;
  event.preventDefault();
  // After a send the dialog is closed but its field can still hold the
  // focus for a moment: a second Enter must not create a second link.
  if (done || !dlg.value?.element?.open) return;
  void submit(primaryMode.value);
}
function validate() {
  const v = value.value;
  invalid.value =
    v === null
      ? 'Informe o valor do link.'
      : Number.isNaN(v)
        ? 'Use só números, como 1.200,00.'
        : v < LINK_MIN_CENTS
          ? 'O valor mínimo de um link é R$ 1,00.'
          : v > max.value
            ? `O valor passa do livre para cobrar (${billingMoney(max.value)}).`
            : '';
  return !invalid.value;
}
/** @param {'send'|'generate'} mode */
async function submit(mode) {
  if (busy.value || done) return;
  if (!validate()) {
    dlg.value?.element?.querySelector('#order-billing-amount')?.focus();
    return;
  }
  busy.value = mode;
  error.value = '';
  try {
    await ctx.startSend({
      mode,
      kind: kind.value,
      amountCents: amount.value,
    });
    done = true;
    busy.value = '';
    dlg.value.close();
  } catch (cause) {
    busy.value = '';
    error.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar a resposta. Os valores ficam preservados: tentar de novo repete o mesmo pedido, sem duplicar o link.'
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
    :title="title"
    close-label="Fechar"
  >
    <p v-if="error" class="bl-warn" role="alert" tabindex="-1">
      <OrderIcon name="alert" /><span>{{ error }}</span>
    </p>
    <div class="bl-field">
      <label for="order-billing-amount">Valor do link</label>
      <div class="bl-money">
        <span aria-hidden="true">R$</span
        ><input
          id="order-billing-amount"
          v-model="raw"
          inputmode="decimal"
          autocomplete="off"
          :aria-invalid="invalid ? 'true' : 'false'"
          aria-describedby="order-billing-amount-hint order-billing-amount-error"
          enterkeyhint="send"
          @input="onInput"
          @keydown.enter="onEnter"
        />
      </div>
      <p id="order-billing-amount-hint" class="op-hint">
        Livre para cobrar {{ billingMoney(max) }} · mínimo R$ 1,00
      </p>
      <p id="order-billing-amount-error" class="bl-field-error">
        <template v-if="invalid"
          ><OrderIcon name="alert" /><span>{{ invalid }}</span></template
        >
      </p>
    </div>
    <dl class="bl-dl">
      <div>
        <dt>Pedido</dt>
        <dd>
          {{ ctx.orderNumber.value
          }}<span v-if="ctx.orderTitle.value">{{ ctx.orderTitle.value }}</span>
        </dd>
      </div>
      <div v-if="conv">
        <dt>Para</dt>
        <dd>{{ destination || 'Conversa vinculada ao pedido' }}</dd>
      </div>
      <div>
        <dt>Nome da linha</dt>
        <dd>
          {{ KIND[kind].title
          }}<span>Sai do valor: Sinal, Saldo ou Parcela</span>
        </dd>
      </div>
      <div>
        <dt>Formas</dt>
        <dd>
          Pix ou cartão: o cliente escolhe na InfinitePay, depois de clicar em
          Pagar
        </dd>
      </div>
    </dl>
    <p class="bl-review" aria-live="polite">
      <template v-if="ok"
        >Em links abertos passa a
        <strong>{{ billingMoney(view.figures.opened + amount) }}</strong> ·
        livre para cobrar
        <strong>{{ billingMoney(max - amount) }}</strong></template
      ><template v-else
        >Livre para cobrar <strong>{{ billingMoney(max) }}</strong></template
      >
    </p>
    <div class="bl-wa-preview">
      <p id="order-billing-amount-wa" class="bl-wa-label">
        Prévia da mensagem, como o cliente recebe
      </p>
      <div
        class="bl-wa-stage"
        role="group"
        aria-labelledby="order-billing-amount-wa"
      >
        <div v-if="ok" class="bl-bubble">
          Pedido {{ ctx.orderNumber.value }} — {{ KIND[kind].noun }} de
          {{ billingMoney(amount) }}. Link para pagamento:
          <span class="bl-bubble-link" data-pending
            >link do CRM, criado ao {{ conv ? 'enviar' : 'gerar' }}</span
          ><span v-if="conv" class="bl-bubble-meta">agora</span>
        </div>
        <p v-else class="op-hint">
          A prévia aparece quando o valor for válido.
        </p>
      </div>
    </div>
    <p class="bl-note">
      <OrderIcon name="info" /><span
        >Você pode cancelar este link enquanto o cliente não clicar em Pagar.
        {{
          conv
            ? 'Enviar não confirma o pagamento.'
            : 'Gerar o link não envia a mensagem nem confirma o pagamento.'
        }}</span
      >
    </p>
    <template #footer>
      <button type="button" @click="dlg.close()">Voltar</button>
      <button
        v-if="conv"
        type="button"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-busy="busy === 'generate' ? 'true' : undefined"
        @click="submit('generate')"
      >
        Só gerar o link
      </button>
      <button
        type="button"
        class="primary"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-busy="busy === 'send' || (!conv && busy) ? 'true' : undefined"
        @click="submit(primaryMode)"
      >
        {{ ok ? `${verb} link de ${billingMoney(amount)}` : `${verb} link` }}
      </button>
    </template>
  </JourneyDialog>
</template>
