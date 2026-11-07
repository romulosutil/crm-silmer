<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { brand } from '../../brand/index.js';
import { dateTimeBR } from '../../lib/format.js';
import { openDialog } from '../../lib/ui.js';
import {
  fichaPrintedLabel,
  isItemGap,
  isPageGap,
  isStoreOrder,
  joinPt,
  missingFieldLabels,
  nextOrderStep,
  PAYMENT_CONDITION_OPTIONS,
  paymentConditionLabel,
  storeConfirmationLabel,
} from '../../lib/order-format.js';
import OrderIcon from './OrderIcon.vue';
import { subtotalLabel } from '../../lib/order-money.js';

// PCL-05: what each blocker outside the items means to the seller when the
// server refuses it; the item points are named one by one (PIT-06).
const BLOCKER_MESSAGES = Object.freeze({
  artwork: 'Marque quem faz a arte em Arte do pedido.',
  finalAmount: 'Revise os subtotais por tamanho antes de confirmar.',
  paymentCondition: 'Escolha a forma de pagamento.',
  'summary.data_entrega_confirmada':
    'Informe a entrega prometida no Resumo do pedido.',
});
const AMOUNT_FORMAT_MESSAGE =
  'Revise os subtotais por tamanho antes de confirmar.';
// OLIST-T12: the dialog reviews the calculated total and records only the
// payment condition. A reserved/exported composition keeps that condition.
const ASKED_WHEN_GENERATING =
  'O valor vem dos subtotais revisados. Escolha a forma de pagamento ao gerar.';
const OFFLINE_MESSAGE =
  'Sem conexão com o servidor. O pedido não foi gerado; tente de novo.';
// ADR 020, PFI-20 (ADR 035): who makes the art, in the words of the Arte do
// pedido section; the company's name comes from the brand.
const ARTWORK_LABELS = Object.freeze([
  Object.freeze({ key: 'feito_pelo_cliente', label: 'O cliente envia a arte' }),
  Object.freeze({
    key: 'feito_pela_silmer',
    label: `A ${brand.companyName} cria a arte`,
  }),
  Object.freeze({ key: 'sem_estampa', label: 'Sem estampa' }),
]);

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const notify = inject('notify', () => {});
const dialog = ref(null);
const dialogAlert = ref(null);
const reopenDialog = ref(null);
const reopenOpen = ref(false);
const closingTitle = ref(null);
const paymentCondition = ref(props.order.paymentCondition ?? '');
const busy = ref(false);
const confirmOpen = ref(false);
const justGenerated = ref(false);
// The rail's alert (a failed reopening) and the dialog's own alert.
const errorMessage = ref('');
const dialogMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const fieldErrors = ref({});
/** @type {import('vue').Ref<{field: string, message: string}[]>} */
const blockerNotes = ref([]);
/**
 * Who opened the dialog — "Gerar pedido" in the rail or in the phone's
 * footer — so Esc and "Voltar" give the focus back to it.
 *
 * @type {HTMLElement|null}
 */
let opener = null;

const isPending = computed(() => props.order.status === 'pendente');
// LOJ-34 (ADR 031): a site order shows this panel confirmed, like an order
// generated here, with what the site confirmed and no reopening.
const isStore = computed(() => isStoreOrder(props.order));
const fichaPrinted = computed(() => fichaPrintedLabel(props.order));
const canCommand = computed(
  () =>
    (isPending.value
      ? (editing.canConfirm?.value ?? editing.canEdit.value)
      : editing.canEdit.value) && !isStore.value,
);
const sectionOpenElsewhere = computed(
  () => editing.editingSection.value !== '',
);
const missing = computed(() => (props.order.missingFields ?? []).map(String));
const pricingMissing = computed(() =>
  missing.value.some(
    (field) => field === 'sizePricing' || field.startsWith('sizePricing.'),
  ),
);
const items = computed(() => props.order.ficha?.items ?? []);
const itemsHeadline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${props.order.totalPieces} peças`;
});
const artworkHeadline = computed(() => {
  const artwork = props.order.ficha?.artwork ?? {};
  const marked = ARTWORK_LABELS.filter(({ key }) => artwork[key] === true);
  return marked.length > 0 ? marked.map(({ label }) => label).join(' · ') : '—';
});
// PFI-15/PFI-16 (RFC 024): the progress at the top of the page replaced the
// checklist that lived here. While a step is missing or a section is open,
// "Gerar pedido" stays focusable but unavailable (aria-disabled); activating
// it leads to the step instead of opening the dialog.
const nextStep = computed(() => nextOrderStep(props.order));
const generateBlocked = computed(
  () =>
    nextStep.value !== null ||
    sectionOpenElsewhere.value ||
    pricingMissing.value,
);
// PIT-06: "Falta para gerar" names every point of the page, item by item,
// then who makes the art and the promised delivery. The payment condition
// is chosen in the dialog; the total comes from the reviewed subtotals.
const pendingLabels = computed(() =>
  missingFieldLabels(missing.value.filter(isPageGap)),
);
const readiness = computed(() => {
  if (pricingMissing.value)
    return 'Revise os subtotais por tamanho em Itens e especificações antes de gerar.';
  if (pendingLabels.value.length > 0) {
    return `Falta para gerar: ${joinPt(pendingLabels.value)}. ${ASKED_WHEN_GENERATING}`;
  }
  if (sectionOpenElsewhere.value) {
    return 'Salve ou cancele a seção em edição antes de gerar.';
  }
  return `Tudo pronto. ${ASKED_WHEN_GENERATING}`;
});

/** @param {unknown} value */
function dateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

watch(
  () => props.order.paymentCondition,
  (condition) => {
    paymentCondition.value = condition ?? '';
  },
);

watch(
  () => editing.canEdit.value,
  (allowed) => {
    if (!allowed) paymentCondition.value = props.order.paymentCondition ?? '';
  },
);

watch(canCommand, async (allowed) => {
  if (allowed || !confirmOpen.value || !dialog.value?.open || busy.value)
    return;
  await closeDialog({ restoreFocus: false });
  await nextTick();
  closingTitle.value?.focus();
});

// A condition picked after the warning clears the warning.
watch(paymentCondition, (value) => {
  if (value === '' || !fieldErrors.value.paymentCondition) return;
  const { paymentCondition: _cleared, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
});

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
 * PFI-16/PFI-19: while a step is missing, "Gerar pedido" leads to it and
 * never opens the dialog nor sends the confirmation; with a section open it
 * waits for Salvar or Cancelar, as #closing-readiness says. Once the three
 * steps are done it opens the dialog "Gerar o pedido" to review the total
 * and choose the payment condition.
 *
 * @param {EventTarget|null} [trigger] the button that asked for it
 * @returns {Promise<'busy'|'section'|'step'|'dialog'>}
 */
async function requestGenerate(trigger) {
  if (busy.value || !canCommand.value || !isPending.value) return 'busy';
  if (sectionOpenElsewhere.value) return 'section';
  if (pricingMissing.value) {
    void editing.goToSection('items');
    return 'step';
  }
  if (nextStep.value) {
    void editing.goToSection(nextStep.value.section);
    return 'step';
  }
  fieldErrors.value = {};
  blockerNotes.value = [];
  dialogMessage.value = '';
  errorMessage.value = '';
  justGenerated.value = false;
  opener = trigger instanceof globalThis.HTMLElement ? trigger : null;
  confirmOpen.value = true;
  await nextTick();
  if (!dialog.value) return 'dialog';
  if (opener) openDialog(dialog.value, opener);
  else dialog.value.showModal?.();
  // The first field of the dialog, whatever the helper focused.
  dialog.value?.querySelector('input[name="payment-condition"]')?.focus();
  return 'dialog';
}

/**
 * Mobile first: "Gerar pedido" also lives in the page's fixed footer, far
 * from this panel. It opens the same dialog and the focus comes back to it.
 *
 * @param {EventTarget|null} [trigger]
 */
function generateFromFooter(trigger) {
  return requestGenerate(trigger ?? null);
}

defineExpose({ generateFromFooter });

/**
 * Closes the dialog without writing anything. Esc and "Voltar" give the
 * focus back to whoever opened it (the helper does it again on `close`,
 * harmlessly). The outcomes of the confirmation move the focus themselves,
 * once the `close` event — and the helper's own return of the focus — has
 * passed, so the last word on the focus is theirs.
 *
 * @param {{restoreFocus?: boolean}} [options]
 * @returns {Promise<void>}
 */
function closeDialog({ restoreFocus = true } = {}) {
  /** @type {HTMLDialogElement|null} */
  const element = dialog.value;
  const closed = element?.open
    ? new Promise((resolve) => {
        element.addEventListener('close', () => resolve(undefined), {
          once: true,
        });
      })
    : Promise.resolve();
  element?.close?.();
  if (restoreFocus && opener?.isConnected) opener.focus();
  opener = null;
  // The element leaves the page after its `close` event, unless the dialog
  // was opened again in between.
  return closed.then(() => {
    if (!element?.open) confirmOpen.value = false;
  });
}

// Esc waits for the answer of a confirmation already sent.
function cancelDialog() {
  if (busy.value) return;
  closeDialog();
}

/** The first field the seller has to fix, in the order of the dialog. */
async function focusFirstError() {
  await nextTick();
  const errors = fieldErrors.value;
  /** @type {HTMLElement|null|undefined} */
  const target = errors.finalAmount
    ? dialog.value?.querySelector('#closing-amount-error')
    : errors.paymentCondition
      ? dialog.value?.querySelector('input[name="payment-condition"]')
      : null;
  target?.focus();
}

/**
 * OLIST-T12/PFI-12: an incomplete calculated total or a missing payment
 * condition stops before the request. A second Enter and a revoked action
 * cannot submit; the API revalidates the current commercial lock as well.
 */
async function submitGenerate() {
  if (busy.value || !canCommand.value || !isPending.value) return;
  if (!editing.canEdit.value)
    paymentCondition.value = props.order.paymentCondition ?? '';
  dialogMessage.value = '';
  /** @type {Record<string, string>} */
  const errors = {};
  if (
    !Number.isSafeInteger(props.order.finalAmountCents) ||
    props.order.finalAmountCents <= 0
  )
    errors.finalAmount = 'Revise os subtotais por tamanho antes de confirmar.';
  if (paymentCondition.value === '') {
    errors.paymentCondition = BLOCKER_MESSAGES.paymentCondition;
  }
  fieldErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    await focusFirstError();
    return;
  }
  await generate();
}

/** PCL-04: the human transition that dates the order and frees the ficha. */
async function generate() {
  if (busy.value || !canCommand.value || !isPending.value) return;
  busy.value = true;
  const result = await editing.command('confirm', {
    paymentCondition: editing.canEdit.value
      ? paymentCondition.value
      : (props.order.paymentCondition ?? ''),
  });
  busy.value = false;
  if (result.ok) {
    justGenerated.value = true;
    await closeDialog({ restoreFocus: false });
    // The button is gone with the confirmed view; the panel's title keeps
    // the focus next to the confirmation and the ficha.
    await nextTick();
    closingTitle.value?.focus();
    return;
  }
  const fields = (result.fields ?? []).map(String);
  if (result.code === 'ORDER_NOT_CONFIRMABLE' && fields.some(isPageGap)) {
    // PFI-19: a blocker outside the dialog closes it; the rail names every
    // blocker the server listed, the progress is read again and the focus
    // goes to the next step. The order stays pending (PCL-05).
    blockerNotes.value = Object.entries(blockerErrors(fields)).map(
      ([field, message]) => ({ field, message }),
    );
    await closeDialog({ restoreFocus: false });
    await editing.revisitNextStep();
    return;
  }
  if (
    result.code === 'ORDER_NOT_CONFIRMABLE' ||
    result.code === 'INVALID_AMOUNT'
  ) {
    fieldErrors.value =
      result.code === 'INVALID_AMOUNT'
        ? { finalAmount: AMOUNT_FORMAT_MESSAGE }
        : blockerErrors(fields);
    if (Object.keys(fieldErrors.value).length > 0) {
      await focusFirstError();
      return;
    }
  }
  // 409, 403, the server down or the connection lost: the dialog stays open
  // with what happened, nothing recorded, and the focus on the message.
  dialogMessage.value = result.status === 0 ? OFFLINE_MESSAGE : result.message;
  await nextTick();
  dialogAlert.value?.focus();
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
</script>

<template>
  <section class="op-sheet op-closing" aria-labelledby="order-closing-title">
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

      <!-- PFI-19: one editing model. The amount and the payment method are
           typed only in the dialog; the rail keeps what is missing and the
           action that opens it. -->
      <div v-if="isPending && canCommand" class="op-closing-action">
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
          type="button"
          :aria-disabled="generateBlocked || undefined"
          aria-describedby="closing-readiness"
          @click="requestGenerate($event.currentTarget)"
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
      </div>

      <template v-else>
        <dl class="op-deal">
          <div>
            <dt>Valor final</dt>
            <dd class="op-num">{{ subtotalLabel(order.finalAmountCents) }}</dd>
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
                ? 'PDF ainda não gerado.'
                : 'PDF ainda não gerado. Ao gerar, o pedido sai do aviso do Dashboard.')
            }}
          </p>
          <button type="button" class="op-save" @click="editing.print">
            Baixar ficha em PDF
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

    <!-- PFI-19: review what is generated, then the amount and the payment
         method; one primary action. -->
    <dialog
      v-if="confirmOpen"
      ref="dialog"
      class="op-dialog op-generate-dialog"
      aria-modal="true"
      aria-labelledby="generate-title"
      aria-describedby="generate-description"
      @cancel.prevent="cancelDialog"
    >
      <h2 id="generate-title">Gerar o pedido {{ order.number }}?</h2>
      <p id="generate-description">
        O pedido é confirmado, a data do pedido passa a ser hoje e o PDF da
        ficha fica disponível. Para mudar algo depois, reabra o pedido.
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
          <dt>Arte do pedido</dt>
          <dd>{{ artworkHeadline }}</dd>
        </div>
      </dl>

      <form class="op-closing-form" novalidate @submit.prevent="submitGenerate">
        <p
          v-if="dialogMessage"
          ref="dialogAlert"
          role="alert"
          tabindex="-1"
          class="op-alert"
        >
          {{ dialogMessage }}
        </p>

        <div class="op-field">
          <span class="op-label">Valor final calculado</span>
          <p class="op-num">{{ subtotalLabel(order.finalAmountCents) }}</p>
          <p
            v-if="fieldErrors.finalAmount"
            id="closing-amount-error"
            role="alert"
            tabindex="-1"
            class="op-field-error"
          >
            {{ fieldErrors.finalAmount }}
          </p>
          <p v-else id="closing-amount-hint" class="op-hint">
            Soma dos subtotais por tamanho revisados. Para alterar o valor,
            revise os subtotais nos itens.
          </p>
        </div>

        <fieldset
          class="op-conditions"
          :disabled="busy || !editing.canEdit.value"
        >
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
                :aria-invalid="
                  Boolean(fieldErrors.paymentCondition) || undefined
                "
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
            Fica no CRM. A ficha impressa não mostra preço e nenhuma cobrança é
            enviada.
          </p>
        </fieldset>

        <div class="op-dialog-actions">
          <button type="button" :disabled="busy" @click="closeDialog()">
            Voltar
          </button>
          <button
            type="submit"
            class="primary op-generate"
            :aria-disabled="busy || !canCommand || !isPending || undefined"
            :aria-busy="busy || undefined"
          >
            <OrderIcon name="ficha" />
            {{ busy ? 'Gerando…' : 'Confirmar e gerar ficha' }}
          </button>
        </div>
      </form>
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
