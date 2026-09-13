<script setup>
import { computed, inject, ref, watch } from 'vue';
import { dateTimeBR } from '../../lib/format.js';
import {
  amountLabel,
  formatBrl,
  parseBrl,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
} from '../../lib/order-format.js';

// PCL-05: what each blocker the server may name means to the seller.
const BLOCKER_MESSAGES = Object.freeze({
  finalAmount: 'Informe o valor final aprovado pelo cliente.',
  items: 'O pedido precisa de ao menos um item com grade.',
  paymentCondition: 'Escolha a condição de pagamento.',
});
const AMOUNT_FORMAT_MESSAGE = 'Use o formato 4.820,00.';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const amountText = ref(formatBrl(props.order.finalAmountCents));
const paymentCondition = ref(props.order.paymentCondition ?? '');
const busy = ref(false);
const errorMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const fieldErrors = ref({});

const isPending = computed(() => props.order.status === 'pendente');
const canCommand = computed(() => editing.canEdit.value);
const sectionOpenElsewhere = computed(
  () => editing.editingSection.value !== '',
);

// PCL-07: reopening keeps the amount and the condition already recorded, so
// the form comes back filled with what was confirmed.
watch(
  () => [props.order.finalAmountCents, props.order.paymentCondition],
  ([cents, condition]) => {
    amountText.value = formatBrl(cents);
    paymentCondition.value = condition ?? '';
  },
);

async function confirm() {
  fieldErrors.value = {};
  errorMessage.value = '';
  // PFI-11: a malformed amount is caught here so the message lands under the
  // field; the server parses the same text again and would answer 422.
  if (parseBrl(amountText.value) === null) {
    fieldErrors.value = { finalAmount: AMOUNT_FORMAT_MESSAGE };
    return;
  }
  if (paymentCondition.value === '') {
    fieldErrors.value = { paymentCondition: BLOCKER_MESSAGES.paymentCondition };
    return;
  }
  busy.value = true;
  const result = await editing.command('confirm', {
    amountText: amountText.value.trim(),
    paymentCondition: paymentCondition.value,
  });
  busy.value = false;
  if (result.ok) return;
  if (result.code === 'ORDER_NOT_CONFIRMABLE') {
    /** @type {Record<string, string>} */
    const errors = {};
    for (const field of result.fields ?? []) {
      errors[field] =
        BLOCKER_MESSAGES[
          /** @type {keyof typeof BLOCKER_MESSAGES} */ (field)
        ] ?? field;
    }
    fieldErrors.value = errors;
    return;
  }
  if (result.code === 'INVALID_AMOUNT') {
    fieldErrors.value = { finalAmount: AMOUNT_FORMAT_MESSAGE };
    return;
  }
  errorMessage.value = result.message;
}

async function reopen() {
  errorMessage.value = '';
  busy.value = true;
  const result = await editing.command('reopen', {});
  busy.value = false;
  if (!result.ok) errorMessage.value = result.message;
}

function resetDraft() {
  amountText.value = formatBrl(props.order.finalAmountCents);
  paymentCondition.value = props.order.paymentCondition ?? '';
  fieldErrors.value = {};
  errorMessage.value = '';
}

const blockerNotes = computed(() =>
  Object.entries(fieldErrors.value)
    .filter(([field]) => !['finalAmount', 'paymentCondition'].includes(field))
    .map(([field, message]) => ({ field, message })),
);
</script>

<template>
  <section class="surface section-gap" aria-labelledby="order-closing-title">
    <div class="panel-head">
      <h2 id="order-closing-title">Fechamento e pagamento</h2>
      <p>{{ isPending ? 'pedido pendente' : 'pedido confirmado' }}</p>
    </div>

    <p v-if="errorMessage" role="alert" class="audit-note">
      {{ errorMessage }}
    </p>

    <template v-if="isPending && canCommand">
      <form class="order-form" novalidate @submit.prevent="confirm">
        <div class="field-list">
          <label for="closing-amount">Valor final</label>
          <div class="amount-field">
            <span aria-hidden="true">R$</span>
            <input
              id="closing-amount"
              v-model="amountText"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              :aria-describedby="
                fieldErrors.finalAmount ? 'closing-amount-error' : undefined
              "
            />
          </div>
          <p
            v-if="fieldErrors.finalAmount"
            id="closing-amount-error"
            role="alert"
            class="audit-note"
          >
            {{ fieldErrors.finalAmount }}
          </p>
          <p class="footnote">
            Valor aprovado pelo cliente. O agente nunca informa preço.
          </p>
        </div>

        <fieldset class="order-conditions">
          <legend>Condição de pagamento</legend>
          <label
            v-for="option in PAYMENT_CONDITION_OPTIONS"
            :key="option.value"
            class="checkbox-line"
          >
            <input
              v-model="paymentCondition"
              type="radio"
              name="payment-condition"
              :value="option.value"
            />
            {{ option.label }}
          </label>
          <p
            v-if="fieldErrors.paymentCondition"
            role="alert"
            class="audit-note"
          >
            {{ fieldErrors.paymentCondition }}
          </p>
          <p class="footnote">
            Fica registrada no pedido. Nenhuma cobrança é enviada pelo sistema.
          </p>
        </fieldset>

        <p
          v-for="note in blockerNotes"
          :key="note.field"
          role="alert"
          class="audit-note"
        >
          {{ note.message }}
        </p>

        <p class="footnote">
          Confirmar grava o valor, a condição e quem confirmou — e libera a
          impressão.
        </p>
        <div class="inline-actions">
          <button type="button" :disabled="busy" @click="resetDraft">
            Cancelar
          </button>
          <!-- PFI-13: the only primary button of the page. -->
          <button
            class="primary"
            type="submit"
            :disabled="busy || sectionOpenElsewhere"
          >
            {{ busy ? 'Confirmando…' : 'Confirmar pedido' }}
          </button>
        </div>
      </form>
    </template>

    <template v-else>
      <dl class="client-facts">
        <div>
          <dt>Valor final</dt>
          <dd>{{ amountLabel(order.finalAmountCents) }}</dd>
        </div>
        <div>
          <dt>Condição de pagamento</dt>
          <dd>{{ paymentConditionLabel(order.paymentCondition) }}</dd>
        </div>
        <div v-if="order.confirmedAt">
          <dt>Confirmação</dt>
          <dd>
            Confirmado por {{ order.confirmedBy?.name || 'vendedor' }} ·
            {{ dateTimeBR(order.confirmedAt) }}
          </dd>
        </div>
        <div v-if="order.reopenedAt">
          <dt>Última reabertura</dt>
          <dd>
            Reaberto por {{ order.reopenedBy?.name || 'vendedor' }} ·
            {{ dateTimeBR(order.reopenedAt) }}
          </dd>
        </div>
      </dl>
      <div v-if="!isPending && canCommand" class="inline-actions">
        <button type="button" :disabled="busy" @click="reopen">
          {{ busy ? 'Reabrindo…' : 'Reabrir pedido' }}
        </button>
      </div>
    </template>

    <p class="footnote">
      Valor e condição ficam no CRM: a ficha impressa não mostra preço.
    </p>
  </section>
</template>
