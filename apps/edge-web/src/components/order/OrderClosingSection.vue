<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { dateTimeBR } from '../../lib/format.js';
import {
  amountLabel,
  fichaPrintedLabel,
  formatBrl,
  isItemGap,
  isPageGap,
  isStoreOrder,
  joinPt,
  missingFieldLabels,
  nextOrderStep,
  parseBrl,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
  storeConfirmationLabel,
} from '../../lib/order-format.js';
import OrderIcon from './OrderIcon.vue';

// PCL-05: what each blocker outside the items means to the seller when the
// server refuses it; the item points are named one by one (PIT-06).
const BLOCKER_MESSAGES = Object.freeze({
  artwork: 'Marque quem faz a arte em Estampa e arquivos.',
  finalAmount: 'Informe o valor final aprovado pelo cliente.',
  paymentCondition: 'Escolha a forma de pagamento.',
  'summary.data_entrega_confirmada':
    'Informe a entrega prometida no Resumo do pedido.',
});
const AMOUNT_FORMAT_MESSAGE = 'Use o formato 4.820,00.';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const notify = inject('notify', () => {});
const dialog = ref(null);
const reopenDialog = ref(null);
const reopenOpen = ref(false);
const closingTitle = ref(null);
const section = ref(null);
const amountText = ref(formatBrl(props.order.finalAmountCents));
const paymentCondition = ref(props.order.paymentCondition ?? '');
const busy = ref(false);
const confirmOpen = ref(false);
const justGenerated = ref(false);
const errorMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const fieldErrors = ref({});

const isPending = computed(() => props.order.status === 'pendente');
// LOJ-34 (ADR 031): a site order shows this panel confirmed, like an order
// generated here, with what the site confirmed and no reopening.
const isStore = computed(() => isStoreOrder(props.order));
const fichaPrinted = computed(() => fichaPrintedLabel(props.order));
const canCommand = computed(() => editing.canEdit.value && !isStore.value);
const sectionOpenElsewhere = computed(
  () => editing.editingSection.value !== '',
);
const missing = computed(() => (props.order.missingFields ?? []).map(String));
const amountValid = computed(() => parseBrl(amountText.value) !== null);
const items = computed(() => props.order.ficha?.items ?? []);
const itemsHeadline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${props.order.totalPieces} peças`;
});
// PFI-15/PFI-16 (RFC 024): the progress at the top of the page replaced the
// checklist that lived here. While a step is missing or a section is open,
// "Gerar pedido" stays focusable but unavailable (aria-disabled); activating
// it leads to the step instead of sending the confirmation.
const nextStep = computed(() => nextOrderStep(props.order));
const generateBlocked = computed(
  () => nextStep.value !== null || sectionOpenElsewhere.value,
);
// PIT-06: "Falta para gerar" names every point, item by item, then who makes
// the art, the promised delivery, the amount and the payment method.
const pendingLabels = computed(() => [
  ...missingFieldLabels(missing.value.filter(isPageGap)),
  ...(amountValid.value ? [] : ['valor final']),
  ...(paymentCondition.value === '' ? ['forma de pagamento'] : []),
]);
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
 * One message per blocker: the item points together, the rest each on its
 * own, next to the field when it has one.
 *
 * @param {string[]} fields
 * @returns {Record<string, string>}
 */
function blockerErrors(fields) {
  /** @type {Record<string, string>} */
  const errors = {};
  const gaps = fields.filter(isItemGap);
  if (gaps.length > 0) errors.items = itemsMessage(gaps);
  for (const field of fields.filter((name) => !isItemGap(name))) {
    errors[field] =
      BLOCKER_MESSAGES[/** @type {keyof typeof BLOCKER_MESSAGES} */ (field)] ??
      field;
  }
  return errors;
}

/**
 * PFI-11: a malformed amount is caught here so the message lands under the
 * field; the server parses the same text again and would answer 422.
 * PFI-16: while a step is missing, "Gerar pedido" leads to it and never sends
 * the confirmation; with a section open it waits for Salvar or Cancelar, as
 * #closing-readiness says.
 *
 * @returns {Promise<'busy'|'section'|'step'|'fields'|'dialog'>}
 */
async function requestGenerate() {
  if (busy.value) return 'busy';
  if (sectionOpenElsewhere.value) return 'section';
  if (nextStep.value) {
    void editing.goToSection(nextStep.value.section);
    return 'step';
  }
  fieldErrors.value = {};
  errorMessage.value = '';
  justGenerated.value = false;
  if (!amountValid.value) {
    fieldErrors.value = { finalAmount: AMOUNT_FORMAT_MESSAGE };
    return 'fields';
  }
  if (paymentCondition.value === '') {
    fieldErrors.value = { paymentCondition: BLOCKER_MESSAGES.paymentCondition };
    return 'fields';
  }
  const pageGaps = missing.value.filter(isPageGap);
  if (pageGaps.length > 0) {
    fieldErrors.value = blockerErrors(pageGaps);
    return 'fields';
  }
  confirmOpen.value = true;
  await nextTick();
  dialog.value?.showModal?.();
  return 'dialog';
}

/**
 * Mobile first: "Gerar pedido" also lives in the page's fixed footer, far
 * from this form. When something is missing the focus comes here, to the
 * field to fix, instead of leaving the error out of sight.
 */
async function generateFromFooter() {
  if ((await requestGenerate()) !== 'fields') return;
  await nextTick();
  const errors = fieldErrors.value;
  /** @type {HTMLElement|null|undefined} */
  const target = errors.finalAmount
    ? section.value?.querySelector('#closing-amount')
    : errors.paymentCondition
      ? section.value?.querySelector('input[name="payment-condition"]')
      : closingTitle.value;
  target?.focus();
}

defineExpose({ generateFromFooter });

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
    fieldErrors.value = blockerErrors((result.fields ?? []).map(String));
    return;
  }
  if (result.code === 'INVALID_AMOUNT') {
    fieldErrors.value = { finalAmount: AMOUNT_FORMAT_MESSAGE };
    return;
  }
  errorMessage.value = result.message;
}

/**
 * Pesquisa UX 2026-10-15, achado 6: reopening blocks the print the shop
 * floor may already be using, so it asks first and says what happens.
 */
async function requestReopen() {
  errorMessage.value = '';
  justGenerated.value = false;
  reopenOpen.value = true;
  await nextTick();
  reopenDialog.value?.showModal?.();
}

function closeReopen() {
  reopenDialog.value?.close?.();
  reopenOpen.value = false;
}

async function reopen() {
  const number = props.order.number;
  busy.value = true;
  const result = await editing.command('reopen', {});
  busy.value = false;
  closeReopen();
  if (!result.ok) {
    errorMessage.value = result.message;
    return;
  }
  notify(
    `Pedido ${number} reaberto. A ficha só volta a ser impressa depois de gerar de novo.`,
  );
  // The button is gone with the confirmed view; the panel's title keeps the
  // focus where the seller was working.
  await nextTick();
  closingTitle.value?.focus();
}

const blockerNotes = computed(() =>
  Object.entries(fieldErrors.value)
    .filter(([field]) => !['finalAmount', 'paymentCondition'].includes(field))
    .map(([field, message]) => ({ field, message })),
);
</script>

<template>
  <section
    ref="section"
    class="op-sheet op-closing"
    aria-labelledby="order-closing-title"
  >
    <div class="op-sheet-head">
      <h2 id="order-closing-title" ref="closingTitle" tabindex="-1">
        Fechamento e pagamento
      </h2>
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

          <!-- PFI-13: the only primary button of the page once every step is
               done; until then the next step is (PFI-16). -->
          <button
            class="op-generate op-generate--inline"
            :class="{ primary: nextStep === null }"
            type="submit"
            :disabled="busy"
            :aria-disabled="generateBlocked || undefined"
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
          <div v-if="isStore">
            <dt>Confirmação</dt>
            <dd>{{ storeConfirmationLabel(order) }}</dd>
          </div>
          <div v-else-if="order.confirmedAt">
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
            <span v-if="isStore">1 página · pedido da loja</span>
            <span v-else>2 páginas · pedido e controle de produção</span>
          </span>
          <!-- LOJ-34: whether the site order already left the notice. -->
          <p
            v-if="isStore"
            class="op-ficha-status"
            :data-tone="fichaPrinted ? 'success' : 'warning'"
          >
            {{
              fichaPrinted ||
              (order.isTest
                ? 'Ainda não impressa.'
                : 'Ainda não impressa. Ao imprimir, o pedido sai do aviso do Dashboard.')
            }}
          </p>
          <button type="button" class="op-save" @click="editing.print">
            Abrir ficha
          </button>
        </div>

        <p v-if="isStore" class="op-hint">
          Pedido da loja não é reaberto: valor e itens vieram do pagamento.
        </p>

        <div v-if="!isPending && canCommand" class="op-reopen">
          <button type="button" :disabled="busy" @click="requestReopen">
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
        O pedido é confirmado, a data do pedido passa a ser hoje e a ficha para
        impressão fica disponível no navegador. Para mudar algo depois, reabra o
        pedido.
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

    <dialog
      v-if="reopenOpen"
      ref="reopenDialog"
      class="op-dialog"
      aria-labelledby="reopen-title"
      aria-describedby="reopen-description"
      @cancel.prevent="closeReopen"
    >
      <h2 id="reopen-title">Reabrir o pedido {{ order.number }}?</h2>
      <p id="reopen-description">
        O pedido volta a Pendente e a ficha deixa de poder ser impressa até ser
        gerada de novo. Se a produção já recebeu a ficha, avise antes. O número,
        o valor e a forma de pagamento continuam registrados, e a reabertura
        fica no histórico com o seu nome.
      </p>
      <div class="op-dialog-actions">
        <button type="button" :disabled="busy" @click="closeReopen">
          Manter confirmado
        </button>
        <button type="button" class="danger" :disabled="busy" @click="reopen">
          {{ busy ? 'Reabrindo…' : `Reabrir pedido ${order.number}` }}
        </button>
      </div>
    </dialog>
  </section>
</template>
