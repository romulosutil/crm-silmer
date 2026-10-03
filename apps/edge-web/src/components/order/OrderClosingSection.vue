<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { dateTimeBR } from '../../lib/format.js';
import {
  amountLabel,
  formatBrl,
  isItemGap,
  joinPt,
  missingFieldLabels,
  parseBrl,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
} from '../../lib/order-format.js';
import OrderIcon from './OrderIcon.vue';

// PCL-05: what the amount and the payment method mean to the seller when the
// server refuses them; the item points are named one by one (PIT-06).
const BLOCKER_MESSAGES = Object.freeze({
  finalAmount: 'Informe o valor final aprovado pelo cliente.',
  paymentCondition: 'Escolha a forma de pagamento.',
});
const AMOUNT_FORMAT_MESSAGE = 'Use o formato 4.820,00.';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const dialog = ref(null);
const amountText = ref(formatBrl(props.order.finalAmountCents));
const paymentCondition = ref(props.order.paymentCondition ?? '');
const busy = ref(false);
const confirmOpen = ref(false);
const justGenerated = ref(false);
const errorMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const fieldErrors = ref({});

const isPending = computed(() => props.order.status === 'pendente');
const canCommand = computed(() => editing.canEdit.value);
const sectionOpenElsewhere = computed(
  () => editing.editingSection.value !== '',
);
const missing = computed(() => (props.order.missingFields ?? []).map(String));
const amountValid = computed(() => parseBrl(amountText.value) !== null);
// ADR 016: the points the items still lack, as the server listed them.
const itemGaps = computed(() =>
  missingFieldLabels(missing.value.filter(isItemGap)),
);
const items = computed(() => props.order.ficha?.items ?? []);
const itemsHeadline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${props.order.totalPieces} peças`;
});

/**
 * PFI-09/PIT-05: the checklist next to the button. The items are judged by
 * the server; amount and payment method by what the seller is typing right
 * now, since both only reach the order when it is generated.
 */
const checks = computed(() => [
  {
    hint:
      itemGaps.value.length === 0
        ? itemsHeadline.value
        : missing.value.includes('items')
          ? 'nenhum item'
          : `${itemGaps.value.length} ${itemGaps.value.length === 1 ? 'ponto' : 'pontos'} a preencher`,
    key: 'items',
    label: 'Itens completos',
    ok: itemGaps.value.length === 0,
  },
  {
    hint: amountValid.value ? `R$ ${amountText.value.trim()}` : 'pendente',
    key: 'finalAmount',
    label: 'Valor final',
    ok: amountValid.value,
  },
  {
    hint: paymentCondition.value
      ? paymentConditionLabel(paymentCondition.value)
      : 'pendente',
    key: 'paymentCondition',
    label: 'Forma de pagamento',
    ok: paymentCondition.value !== '',
  },
]);
// PIT-06: "Falta para gerar" names every point, item by item.
const pendingLabels = computed(() => [
  ...itemGaps.value,
  ...(amountValid.value ? [] : ['valor final']),
  ...(paymentCondition.value === '' ? ['forma de pagamento'] : []),
]);
const readyCount = computed(
  () => checks.value.filter((check) => check.ok).length,
);
const readiness = computed(() => {
  if (pendingLabels.value.length > 0) {
    return `Falta para gerar: ${joinPt(pendingLabels.value)}.`;
  }
  if (sectionOpenElsewhere.value) {
    return 'Salve ou cancele a seção em edição antes de gerar.';
  }
  return 'Tudo pronto. Gerar confirma o pedido e libera a ficha.';
});

/** @param {unknown} value */
function dateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

// PCL-07: reopening keeps the amount and the condition already recorded, so
// the form comes back filled with what was confirmed. Only a change of those
// two values rewrites the form: saving another section while the items are
// completed (ADR 016) keeps what the seller already typed here.
watch(
  [() => props.order.finalAmountCents, () => props.order.paymentCondition],
  ([cents, condition]) => {
    amountText.value = formatBrl(cents);
    paymentCondition.value = condition ?? '';
  },
);

// A condition picked after the warning clears the warning.
watch(paymentCondition, (value) => {
  if (value === '' || !fieldErrors.value.paymentCondition) return;
  const { paymentCondition: _cleared, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
});

/**
 * On leaving the field, a plain number ("4820", "4820,5") is written the way
 * the rule reads it ("4.820,00"); anything else is left as typed and, when it
 * still is not an amount, the message shows now instead of on "Gerar".
 */
function settleAmount() {
  const text = amountText.value.trim();
  const plain = /^(\d+)(?:,(\d{1,2}))?$/u.exec(text);
  if (plain) {
    const cents =
      Number(plain[1]) * 100 + Number((plain[2] ?? '').padEnd(2, '0'));
    if (Number.isSafeInteger(cents) && cents > 0) {
      amountText.value = formatBrl(cents);
    }
  }
  if (amountText.value.trim() !== '' && !amountValid.value) {
    fieldErrors.value = {
      ...fieldErrors.value,
      finalAmount: AMOUNT_FORMAT_MESSAGE,
    };
    return;
  }
  const { finalAmount: _cleared, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
}

/**
 * The item points in one sentence, from the keys the server uses.
 *
 * @param {string[]} fields
 */
function itemsMessage(fields) {
  if (fields.includes('items')) return 'O pedido precisa de ao menos um item.';
  return `Complete os itens antes de gerar: ${joinPt(missingFieldLabels(fields))}.`;
}

/**
 * PFI-11: a malformed amount is caught here so the message lands under the
 * field; the server parses the same text again and would answer 422.
 */
async function requestGenerate() {
  fieldErrors.value = {};
  errorMessage.value = '';
  justGenerated.value = false;
  if (!amountValid.value) {
    fieldErrors.value = { finalAmount: AMOUNT_FORMAT_MESSAGE };
    return;
  }
  if (paymentCondition.value === '') {
    fieldErrors.value = { paymentCondition: BLOCKER_MESSAGES.paymentCondition };
    return;
  }
  if (itemGaps.value.length > 0) {
    fieldErrors.value = {
      items: itemsMessage(missing.value.filter(isItemGap)),
    };
    return;
  }
  confirmOpen.value = true;
  await nextTick();
  dialog.value?.showModal?.();
}

function closeDialog() {
  dialog.value?.close?.();
  confirmOpen.value = false;
}

/** PCL-04: the human transition that dates the order and frees the ficha. */
async function generate() {
  busy.value = true;
  const result = await editing.command('confirm', {
    amountText: amountText.value.trim(),
    paymentCondition: paymentCondition.value,
  });
  busy.value = false;
  closeDialog();
  if (result.ok) {
    justGenerated.value = true;
    return;
  }
  if (result.code === 'ORDER_NOT_CONFIRMABLE') {
    const fields = (result.fields ?? []).map(String);
    /** @type {Record<string, string>} */
    const errors = {};
    const gaps = fields.filter(isItemGap);
    if (gaps.length > 0) errors.items = itemsMessage(gaps);
    for (const field of fields.filter((name) => !isItemGap(name))) {
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
  justGenerated.value = false;
  busy.value = true;
  const result = await editing.command('reopen', {});
  busy.value = false;
  if (!result.ok) errorMessage.value = result.message;
}

const blockerNotes = computed(() =>
  Object.entries(fieldErrors.value)
    .filter(([field]) => !['finalAmount', 'paymentCondition'].includes(field))
    .map(([field, message]) => ({ field, message })),
);
</script>

<template>
  <section class="op-sheet op-closing" aria-labelledby="order-closing-title">
    <div class="op-sheet-head">
      <h2 id="order-closing-title">Fechamento e pagamento</h2>
      <p>{{ isPending ? 'pedido pendente' : 'pedido confirmado' }}</p>
    </div>

    <div class="op-sheet-body op-closing-body">
      <p v-if="errorMessage" role="alert" class="op-alert">
        {{ errorMessage }}
      </p>

      <p v-if="justGenerated && !isPending" role="status" class="op-success">
        <OrderIcon name="check" />
        Pedido confirmado e ficha gerada.
      </p>

      <template v-if="isPending && canCommand">
        <div class="op-checklist">
          <h3 class="op-checklist-title">
            Pronto para gerar
            <span class="op-num" :data-ready="readyCount === checks.length"
              >{{ readyCount }} de {{ checks.length }}</span
            >
          </h3>
          <ul>
            <li
              v-for="check in checks"
              :key="check.key"
              :data-ok="check.ok || undefined"
            >
              <span class="op-check-mark" aria-hidden="true">
                <OrderIcon v-if="check.ok" name="check" />
              </span>
              <span class="op-check-label">
                {{ check.label }}
                <span class="op-visually-hidden">{{
                  check.ok ? '— pronto' : '— pendente'
                }}</span>
              </span>
              <span class="op-check-hint op-num">{{ check.hint }}</span>
            </li>
          </ul>
        </div>

        <form
          class="op-closing-form"
          novalidate
          @submit.prevent="requestGenerate"
        >
          <div class="op-field">
            <label for="closing-amount">Valor final</label>
            <div class="op-amount">
              <span aria-hidden="true">R$</span>
              <input
                id="closing-amount"
                v-model="amountText"
                class="op-num"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0,00"
                enterkeyhint="done"
                @blur="settleAmount"
                :aria-invalid="Boolean(fieldErrors.finalAmount) || undefined"
                :aria-describedby="
                  fieldErrors.finalAmount
                    ? 'closing-amount-error'
                    : 'closing-amount-hint'
                "
              />
            </div>
            <p
              v-if="fieldErrors.finalAmount"
              id="closing-amount-error"
              role="alert"
              class="op-field-error"
            >
              {{ fieldErrors.finalAmount }}
            </p>
            <p v-else id="closing-amount-hint" class="op-hint">
              Aprovado pelo cliente. O agente nunca informa preço.
            </p>
          </div>

          <fieldset class="op-conditions">
            <legend>Forma de pagamento</legend>
            <div class="op-condition-chips">
              <label
                v-for="option in PAYMENT_CONDITION_OPTIONS"
                :key="option.value"
                class="op-condition"
              >
                <input
                  v-model="paymentCondition"
                  type="radio"
                  name="payment-condition"
                  :value="option.value"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
            <p
              v-if="fieldErrors.paymentCondition"
              role="alert"
              class="op-field-error"
            >
              {{ fieldErrors.paymentCondition }}
            </p>
            <p class="op-hint">
              Fica no CRM. A ficha impressa não mostra preço e nenhuma cobrança
              é enviada.
            </p>
          </fieldset>

          <p
            v-for="note in blockerNotes"
            :key="note.field"
            role="alert"
            class="op-field-error"
          >
            {{ note.message }}
          </p>

          <!-- PFI-13: the only primary button of the page. -->
          <button
            class="primary op-generate"
            type="submit"
            :disabled="busy || sectionOpenElsewhere"
            aria-describedby="closing-readiness"
          >
            <OrderIcon name="ficha" />Gerar pedido
          </button>
          <p
            id="closing-readiness"
            role="status"
            class="op-readiness"
            :data-ready="
              (pendingLabels.length === 0 && !sectionOpenElsewhere) || undefined
            "
          >
            {{ readiness }}
          </p>
        </form>
      </template>

      <template v-else>
        <dl class="op-deal">
          <div>
            <dt>Valor final</dt>
            <dd class="op-num">{{ amountLabel(order.finalAmountCents) }}</dd>
          </div>
          <div>
            <dt>Forma de pagamento</dt>
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

        <div v-if="!isPending" class="op-ficha-card">
          <span class="op-ficha-thumb" aria-hidden="true">
            <OrderIcon name="ficha" />
          </span>
          <span class="op-ficha-name">
            <strong>Ficha {{ order.number }}</strong>
            <span>2 páginas · pedido e controle de produção</span>
          </span>
          <button type="button" class="op-save" @click="editing.print">
            Abrir ficha
          </button>
        </div>

        <div v-if="!isPending && canCommand" class="op-reopen">
          <button type="button" :disabled="busy" @click="reopen">
            {{ busy ? 'Reabrindo…' : 'Reabrir pedido' }}
          </button>
          <p class="op-hint">
            Reabrir libera a edição. A ficha é gerada de novo na próxima
            confirmação.
          </p>
        </div>
      </template>
    </div>

    <dialog
      v-if="confirmOpen"
      ref="dialog"
      class="op-dialog"
      aria-labelledby="generate-title"
      aria-describedby="generate-description"
      @cancel.prevent="closeDialog"
    >
      <h2 id="generate-title">Gerar o pedido {{ order.number }}?</h2>
      <p id="generate-description">
        O pedido é confirmado, a data do pedido passa a ser hoje e a ficha em
        PDF fica pronta para imprimir. Para mudar algo depois, reabra o pedido.
      </p>
      <dl>
        <div>
          <dt>Cliente</dt>
          <dd>{{ order.ficha?.summary?.cliente || '—' }}</dd>
        </div>
        <div>
          <dt>Itens</dt>
          <dd class="op-num">{{ itemsHeadline }}</dd>
        </div>
        <div>
          <dt>Entrega prometida</dt>
          <dd class="op-num">
            {{ dateBR(order.ficha?.summary?.data_entrega_confirmada) }}
          </dd>
        </div>
        <div>
          <dt>Valor e pagamento</dt>
          <dd class="op-num">
            R$ {{ amountText.trim() }} ·
            {{ paymentConditionLabel(paymentCondition) }}
          </dd>
        </div>
      </dl>
      <div class="op-dialog-actions">
        <button type="button" :disabled="busy" @click="closeDialog">
          Voltar
        </button>
        <button
          type="button"
          class="primary op-generate"
          :disabled="busy"
          @click="generate"
        >
          <OrderIcon name="ficha" />
          {{ busy ? 'Gerando…' : 'Confirmar e gerar ficha' }}
        </button>
      </div>
    </dialog>
  </section>
</template>
