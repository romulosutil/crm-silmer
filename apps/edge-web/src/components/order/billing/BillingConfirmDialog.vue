<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { billingError, billingMoney } from '../../../lib/order-billing.js';
import {
  KIND,
  dayMonthTimeOf,
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
 * "Confirmar resultado na InfinitePay" (RFC 074, LPC-05; contract decision
 * 11): the customer clicked Pagar and the InfinitePay never answered, so the
 * link is locked. Either the customer says they paid — the receipt's invoice
 * code and NSU queue a provider check — or, once the payment opened at the
 * InfinitePay has expired, the link is released for a new click. Nothing here
 * creates a second payment. Refusals (409) are said in place.
 */
const ctx = /** @type {any} */ (inject('orderBillingContext'));
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<any>} */
const link = ref(null);
const choice = ref(/** @type {'check'|'release'} */ ('check'));
const invoice = ref('');
const nsu = ref('');
const errors = ref({ invoice: '', nsu: '' });
const busy = ref(false);
const error = ref('');
const refused = ref('');
const now = ref(Date.now());
const intent = billingIntent((record) => ctx.run(record));

const K = computed(
  () => KIND[/** @type {keyof typeof KIND} */ (link.value?.kind ?? 'part')],
);
const validUntil = computed(() => link.value?.providerValidUntil ?? null);
// Unknown validity: the server decides (409 BILLING_LINK_STILL_VALID).
const releaseOk = computed(
  () => !validUntil.value || Date.parse(validUntil.value) <= now.value,
);
const releaseReason = computed(() =>
  releaseOk.value
    ? ''
    : `Disponível depois de ${dayMonthTimeOf(validUntil.value)}, quando o pagamento aberto na InfinitePay vence.`,
);
const blocked = computed(
  () =>
    Boolean(refused.value) || (choice.value === 'release' && !releaseOk.value),
);

/** @param {HTMLElement} trigger @param {any} target a normalized link */
async function open(trigger, target) {
  link.value = target;
  now.value = Date.now();
  choice.value = 'check';
  invoice.value = '';
  nsu.value = '';
  errors.value = { invoice: '', nsu: '' };
  error.value = '';
  refused.value = '';
  busy.value = false;
  intent.reset();
  await nextTick();
  dlg.value.open(trigger);
  focusInDialog(dlg.value.element);
}
/** @param {string} selector */
function focus(selector) {
  /** @type {HTMLElement|null} */ (
    dlg.value?.element?.querySelector(selector)
  )?.focus();
}
/** @param {'check'|'release'} value @param {Event} event */
async function pick(value, event) {
  now.value = Date.now();
  if (value === 'release' && !releaseOk.value) {
    /** @type {HTMLInputElement} */ (event.target).checked = false;
    await nextTick();
    focus('input[name="order-billing-cf"][value="check"]');
    return;
  }
  choice.value = value;
  intent.reset();
}
/** @param {any} problem */
function conflictText(problem) {
  const state = String(problem?.state ?? '');
  if (state === 'checkout_open' || state === 'checkout_requested')
    return 'O resultado já chegou: a InfinitePay abriu o pagamento. Acompanhe o pagamento.';
  if (state === 'paid')
    return 'O resultado já chegou: o pagamento foi recebido.';
  if (state === 'open')
    return 'O resultado já chegou: o link voltou a aguardar o cliente.';
  if (state === 'cancelled') return 'Este link foi cancelado.';
  return 'O link mudou. Os valores foram atualizados.';
}
async function confirm() {
  if (busy.value || blocked.value) return;
  const release = choice.value === 'release';
  if (!release) {
    errors.value = {
      invoice: invoice.value.trim() ? '' : 'Informe o código da fatura.',
      nsu: nsu.value.trim() ? '' : 'Informe o NSU da transação.',
    };
    if (errors.value.invoice) return focus('#order-billing-cf-invoice');
    if (errors.value.nsu) return focus('#order-billing-cf-nsu');
  }
  busy.value = true;
  error.value = '';
  const target = link.value;
  try {
    await intent.send(() => ({
      path: `links/${encodeURIComponent(target.id)}/confirm-result`,
      body: release
        ? { ...ctx.versions() }
        : {
            ...ctx.versions(),
            invoiceSlug: invoice.value.trim(),
            transactionNsu: nsu.value.trim(),
          },
    }));
    busy.value = false;
    const fresh = ctx.view.value.links.find(
      (/** @type {any} */ l) => l.id === target.id,
    );
    if (release)
      ctx.flash('Link liberado: o cliente pode clicar em Pagar de novo.');
    else {
      ctx.track(target.id);
      ctx.flash(
        fresh?.verifyAt
          ? `Verificação pedida. A InfinitePay responde na próxima consulta, às ${fresh.verifyAt}.`
          : 'Verificação pedida. A InfinitePay responde na próxima consulta.',
        'info',
      );
    }
    dlg.value.close();
  } catch (cause) {
    busy.value = false;
    const code = String(/** @type {any} */ (cause)?.code ?? '');
    if (code === 'BILLING_LINK_STILL_VALID') {
      const fresh = ctx.view.value.links.find(
        (/** @type {any} */ l) => l.id === target.id,
      );
      const until = fresh?.providerValidUntil ?? validUntil.value;
      error.value = until
        ? `Ainda não dá para liberar: o pagamento aberto na InfinitePay vale até ${dayMonthTimeOf(until)}.`
        : 'Ainda não dá para liberar: o pagamento aberto na InfinitePay ainda vale.';
      if (fresh) link.value = fresh;
    } else if (code === 'BILLING_CONFLICT') {
      refused.value = conflictText(/** @type {any} */ (cause)?.problem);
    } else
      error.value = uncertainFailure(cause)
        ? 'Não foi possível confirmar o pedido. Tentar de novo repete o mesmo pedido, sem cobrar duas vezes.'
        : billingError(cause);
    await nextTick();
    focus('.bl-warn[role="alert"]');
  }
}
defineExpose({ open });
</script>

<template>
  <JourneyDialog
    ref="dlg"
    class="bl-dialog"
    title="Confirmar resultado na InfinitePay"
    close-label="Fechar"
  >
    <template v-if="link">
      <p v-if="refused" class="bl-warn" role="alert" tabindex="-1">
        <OrderIcon name="alert" /><span>{{ refused }}</span>
      </p>
      <p v-else-if="error" class="bl-warn" role="alert" tabindex="-1">
        <OrderIcon name="alert" /><span>{{ error }}</span>
      </p>
      <dl class="bl-dl">
        <div>
          <dt>Link</dt>
          <dd>
            {{ K.title }} · {{ billingMoney(link.amountCents)
            }}<span
              >Cliente clicou em Pagar às {{ timeOf(link.clickedAt) }} · sem
              resposta da InfinitePay</span
            >
          </dd>
        </div>
      </dl>
      <template v-if="!refused">
        <p class="bl-lead">
          O cliente clicou em Pagar às {{ timeOf(link.clickedAt) }}, mas não
          sabemos se a InfinitePay abriu o pagamento. O link fica travado até
          confirmar.<template v-if="validUntil">
            O pagamento aberto na InfinitePay vale até
            {{ dayMonthTimeOf(validUntil) }}.</template
          >
        </p>
        <fieldset class="bl-terms-pick">
          <legend>O que você sabe</legend>
          <div class="bl-cards" data-count="1">
            <label class="bl-card"
              ><input
                type="radio"
                name="order-billing-cf"
                value="check"
                :checked="choice === 'check'"
                @change="pick('check', $event)"
              /><span class="bl-card-title">O cliente diz que pagou</span
              ><span class="bl-card-detail"
                >Informe os dados do comprovante: a InfinitePay confirma ou
                não.</span
              ></label
            >
            <label
              class="bl-card"
              :data-unavailable="releaseOk ? undefined : ''"
              ><input
                type="radio"
                name="order-billing-cf"
                value="release"
                :checked="choice === 'release'"
                :aria-disabled="releaseOk ? undefined : 'true'"
                :aria-describedby="
                  releaseOk ? undefined : 'order-billing-cf-release-reason'
                "
                @change="pick('release', $event)"
              /><span class="bl-card-title">Liberar o link</span
              ><span class="bl-card-detail"
                >O pagamento aberto na InfinitePay venceu sem ser pago. O link
                volta a aceitar um novo clique, sem cobrar duas vezes.</span
              ><span
                v-if="!releaseOk"
                id="order-billing-cf-release-reason"
                class="bl-card-reason"
                ><OrderIcon name="info" /><span>{{ releaseReason }}</span></span
              ></label
            >
          </div>
        </fieldset>
        <template v-if="choice === 'check'">
          <p id="order-billing-cf-hint" class="op-hint">
            Estão no comprovante que o cliente recebeu da InfinitePay ou no
            painel da InfinitePay.
          </p>
          <div class="bl-field-row">
            <div class="bl-field">
              <label for="order-billing-cf-invoice">Código da fatura</label>
              <input
                id="order-billing-cf-invoice"
                v-model="invoice"
                autocomplete="off"
                :aria-invalid="errors.invoice ? 'true' : 'false'"
                aria-describedby="order-billing-cf-hint order-billing-cf-invoice-error"
                @input="intent.reset()"
              />
              <p id="order-billing-cf-invoice-error" class="bl-field-error">
                <template v-if="errors.invoice"
                  ><OrderIcon name="alert" /><span>{{
                    errors.invoice
                  }}</span></template
                >
              </p>
            </div>
            <div class="bl-field">
              <label for="order-billing-cf-nsu">NSU da transação</label>
              <input
                id="order-billing-cf-nsu"
                v-model="nsu"
                inputmode="numeric"
                autocomplete="off"
                :aria-invalid="errors.nsu ? 'true' : 'false'"
                aria-describedby="order-billing-cf-hint order-billing-cf-nsu-error"
                @input="intent.reset()"
              />
              <p id="order-billing-cf-nsu-error" class="bl-field-error">
                <template v-if="errors.nsu"
                  ><OrderIcon name="alert" /><span>{{
                    errors.nsu
                  }}</span></template
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
        <p v-else class="bl-note">
          <OrderIcon name="info" /><span
            >Se o cliente pagar depois, o pagamento vai para conferência. Nada é
            cobrado duas vezes.</span
          >
        </p>
      </template>
    </template>
    <template #footer>
      <button type="button" @click="dlg.close()">
        {{ refused ? 'Fechar' : 'Voltar' }}
      </button>
      <button
        v-if="!refused"
        type="button"
        class="primary"
        :aria-disabled="busy || blocked ? 'true' : undefined"
        :aria-describedby="
          choice === 'release' && !releaseOk
            ? 'order-billing-cf-release-reason'
            : undefined
        "
        :aria-busy="busy ? 'true' : undefined"
        @click="confirm"
      >
        {{
          busy
            ? 'Enviando…'
            : choice === 'release'
              ? 'Liberar o link'
              : 'Pedir verificação'
        }}
      </button>
    </template>
  </JourneyDialog>
</template>
