<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  operationalDay,
  orderMilestones,
  dayLabel,
} from '../../lib/order-format.js';
import { commandKey } from '../../lib/api-client.js';
import { billingMoney } from '../../lib/order-billing.js';
import { orderTimeline } from '../../lib/order-timeline.js';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

const SECTION = 'milestones';
const FUTURE_DAY_MESSAGE = 'Use uma data até hoje.';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const billingState = inject('orderBillingState', null);
const billingReadonly = computed(() =>
  Boolean(
    billingState && (!billingState.value.ready || billingState.value.managed),
  ),
);
const firstField = ref(null);
const draft = ref({ deliveredOn: '', paidOn: '' });
const paymentReviewed = ref(false);
/** @type {import('vue').Ref<Record<string, string>>} */
const fieldErrors = ref({});
const saving = ref(false);
const errorMessage = ref('');
const today = ref('');

const isEditing = computed(() => editing.editingSection.value === SECTION);
const isManual = computed(
  () => props.order.origin === 'atendimento' && !props.order.conversationId,
);
// ADR 008: unlike the ficha sections, the trail stays open after the order
// is generated — payment and delivery usually come later — and never needs a
// reopen.
const canEdit = computed(
  () =>
    (editing.canEditMilestones ?? editing.canEdit).value &&
    !(isManual.value && billingReadonly.value),
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);
const steps = computed(() => orderMilestones(props.order));
const recordedCount = computed(
  () => steps.value.filter((step) => step.recorded).length,
);
const financialState = computed(() =>
  billingState?.value?.orderId === props.order.id ? billingState.value : null,
);
const snapshot = computed(() => financialState.value?.data ?? null);
const events = computed(() =>
  orderTimeline(
    props.order,
    snapshot.value ??
      (financialState.value?.ready && financialState.value?.unavailable
        ? null
        : { managed: true, pendingDetails: true }),
  ),
);
const pendingRead = computed(
  () =>
    !financialState.value ||
    (financialState.value.refreshing && !snapshot.value),
);
const stale = computed(() =>
  Boolean(
    snapshot.value &&
    (financialState.value?.error ||
      Number(snapshot.value.orderVersion) !== Number(props.order.version)),
  ),
);
const showSummary = computed(
  () =>
    snapshot.value?.canManage &&
    !financialState.value?.unavailable &&
    (snapshot.value.managed || !props.order.paidOn),
);
const deliveryAllowed = computed(
  () =>
    Boolean((editing.canEditMilestones ?? editing.canEdit).value) &&
    props.order.origin === 'atendimento' &&
    props.order.status === 'confirmado' &&
    !props.order.isTest &&
    !props.order.cancelledAt &&
    !props.order.deliveredOn &&
    typeof editing.confirmDelivery === 'function',
);
const deliveryDialog = ref(null);
const deliveryTrigger = ref(null);
const deliveryResult = ref(null);
const deliveryCancel = ref(null);
const deliveryContext = ref(null);
const deliveryBusy = ref(false);
const deliveryError = ref('');
const deliveryNotice = ref('');
const deliveryUncertain = ref(false);
const deliveryNeedsReview = ref(false);
let deliveryCompleted = false;
const canSubmitDelivery = computed(
  () =>
    deliveryAllowed.value &&
    !deliveryBusy.value &&
    !deliveryUncertain.value &&
    !deliveryNeedsReview.value &&
    deliveryContext.value?.orderId === props.order.id &&
    deliveryContext.value?.expectedVersion === props.order.version,
);

async function askDelivery() {
  if (
    !deliveryAllowed.value ||
    otherSectionOpen.value ||
    isEditing.value ||
    deliveryBusy.value
  )
    return;
  deliveryCompleted = false;
  deliveryNotice.value = '';
  if (!deliveryUncertain.value) {
    deliveryContext.value = {
      orderId: props.order.id,
      expectedVersion: props.order.version,
      idempotencyKey: commandKey(),
    };
    deliveryError.value = '';
    deliveryNeedsReview.value = false;
  }
  if (!open.value) editing.toggleSection?.(SECTION);
  await nextTick();
  deliveryDialog.value?.showModal();
  deliveryCancel.value?.focus();
}
async function confirmDelivery() {
  if (!canSubmitDelivery.value) return;
  const context = deliveryContext.value;
  deliveryBusy.value = true;
  deliveryError.value = '';
  const result = await editing.confirmDelivery(context);
  deliveryBusy.value = false;
  if (props.order.id !== context.orderId) return;
  if (result.ok && result.order?.deliveredOn) {
    deliveryCompleted = true;
    deliveryUncertain.value = false;
    deliveryContext.value = null;
    deliveryNotice.value = `Entrega confirmada em ${dayLabel(result.order.deliveredOn)}.`;
    deliveryDialog.value?.close();
    return;
  }
  deliveryUncertain.value = !result.status || result.status >= 500;
  deliveryNeedsReview.value = true;
  deliveryError.value =
    result.message ||
    'Não foi possível confirmar o resultado. Atualize o pedido antes de continuar.';
}
async function refreshDelivery() {
  if (deliveryBusy.value) return;
  deliveryBusy.value = true;
  const context = deliveryContext.value;
  const result = await editing.refresh();
  deliveryBusy.value = false;
  if (context?.orderId !== props.order.id) return;
  if (!result.ok) {
    deliveryError.value =
      'Não foi possível atualizar o pedido. A entrega ainda precisa de conferência.';
    return;
  }
  if (result.order?.deliveredOn) {
    deliveryCompleted = true;
    deliveryUncertain.value = false;
    deliveryNotice.value = `Entrega registrada em ${dayLabel(result.order.deliveredOn)}.`;
    deliveryContext.value = null;
    deliveryDialog.value?.close();
    return;
  }
  deliveryUncertain.value = false;
  deliveryNeedsReview.value = context.expectedVersion !== result.order?.version;
  deliveryError.value = deliveryNeedsReview.value
    ? 'O pedido mudou. Feche esta confirmação e revise o pedido atualizado.'
    : 'Pedido atualizado sem entrega registrada. Revise e confirme novamente para tentar com a mesma solicitação.';
}
async function afterDeliveryClose() {
  await nextTick();
  const target = deliveryCompleted
    ? deliveryResult.value
    : deliveryTrigger.value;
  target?.focus();
}
function setDeliveryResult(element) {
  deliveryResult.value = element;
}
function cancelDelivery(event) {
  if (deliveryBusy.value) event.preventDefault();
}
watch(
  () => props.order.id,
  () => {
    deliveryDialog.value?.close();
    deliveryContext.value = null;
    deliveryError.value = '';
    deliveryNotice.value = '';
    deliveryUncertain.value = false;
    deliveryNeedsReview.value = false;
  },
);
watch(
  () => props.order.version,
  () => {
    if (
      deliveryContext.value &&
      !deliveryBusy.value &&
      deliveryContext.value.expectedVersion !== props.order.version
    ) {
      deliveryNeedsReview.value = true;
      deliveryError.value =
        'O pedido mudou. Atualize os dados e revise a entrega antes de continuar.';
    }
  },
);
onBeforeUnmount(() => deliveryDialog.value?.close());

async function startEditing() {
  if (!canEdit.value) return;
  paymentReviewed.value = false;
  draft.value = {
    deliveredOn: props.order.deliveredOn ?? '',
    paidOn: props.order.paidOn ?? '',
  };
  today.value = operationalDay(new Date());
  fieldErrors.value = {};
  errorMessage.value = '';
  editing.start(SECTION);
  await nextTick();
  firstField.value?.focus();
}

function cancel() {
  fieldErrors.value = {};
  errorMessage.value = '';
  editing.stop();
}

/**
 * PLA-05: a day after today is caught here, next to the field; the server
 * checks it again on São Paulo time and answers 422 INVALID_DATE.
 */
async function save() {
  errorMessage.value = '';
  /** @type {Record<string, string>} */
  const errors = {};
  const fields = isManual.value ? ['paidOn'] : ['paidOn', 'deliveredOn'];
  for (const field of fields) {
    if (draft.value[field] !== '' && draft.value[field] > today.value) {
      errors[field] = FUTURE_DAY_MESSAGE;
    }
  }
  if (
    props.order.paymentReviewRequired &&
    paymentReviewed.value &&
    !draft.value.paidOn
  )
    errors.paidOn = 'Informe a data em que o valor integral foi recebido.';
  fieldErrors.value = errors;
  if (Object.keys(errors).length > 0) return;

  saving.value = true;
  const result = await editing.saveMilestones({
    ...(isManual.value ? {} : { deliveredOn: draft.value.deliveredOn || null }),
    paidOn: billingReadonly.value
      ? (props.order.paidOn ?? null)
      : draft.value.paidOn || null,
    ...(props.order.paymentReviewRequired &&
    paymentReviewed.value &&
    !billingReadonly.value
      ? { paymentReviewed: true }
      : {}),
  });
  saving.value = false;
  if (result.ok) {
    editing.stop();
    return;
  }
  if (result.code === 'INVALID_DATE') {
    fieldErrors.value = Object.fromEntries(
      result.fields.map((/** @type {string} */ field) => [
        field,
        FUTURE_DAY_MESSAGE,
      ]),
    );
    return;
  }
  errorMessage.value = result.message;
}
</script>

<template>
  <section
    class="op-sheet"
    :data-editing="isEditing || undefined"
    aria-labelledby="order-milestones-title"
  >
    <!-- PFI-17, PLA-07: the dates never block "Gerar" (PLA-06), so their
         state is a plain count. PFI-20: "Datas do pedido" on the screen; the
         printed ficha keeps "Lastro do pedido". -->
    <OrderSheetHead
      title-id="order-milestones-title"
      title="Datas do pedido"
      :state="`${recordedCount} de ${steps.length} datas`"
      edit-label="Editar datas"
      :can-edit="canEdit"
      :blocked="otherSectionOpen"
      :editing="isEditing"
      section="milestones"
      body-id="order-milestones-body"
      @edit="startEditing"
    >
      <template #actions>
        <button
          v-if="deliveryAllowed && !isEditing"
          ref="deliveryTrigger"
          type="button"
          :disabled="deliveryBusy || otherSectionOpen"
          @click="askDelivery"
        >
          Confirmar entrega
        </button>
      </template>
    </OrderSheetHead>

    <p v-if="errorMessage" role="alert" class="op-alert" :hidden="!open">
      {{ errorMessage }}
    </p>

    <form
      v-if="isEditing"
      id="order-milestones-body"
      class="op-form"
      novalidate
      :hidden="!open"
      @submit.prevent="save"
    >
      <div class="op-form-grid">
        <div class="op-field">
          <label for="milestone-paid">Pago em</label>
          <input
            id="milestone-paid"
            ref="firstField"
            v-model="draft.paidOn"
            type="date"
            :disabled="billingReadonly"
            :max="today"
            :aria-invalid="Boolean(fieldErrors.paidOn) || undefined"
            :aria-describedby="
              fieldErrors.paidOn
                ? 'milestone-paid-error'
                : 'milestone-paid-hint'
            "
          />
          <p
            v-if="fieldErrors.paidOn"
            id="milestone-paid-error"
            role="alert"
            class="op-field-error"
          >
            {{ fieldErrors.paidOn }}
          </p>
          <p v-else id="milestone-paid-hint" class="op-hint">
            {{
              billingReadonly
                ? 'A quitação é calculada pelos recebimentos registrados.'
                : 'O dia em que o valor integral do pagamento entrou.'
            }}
          </p>
          <p v-if="order.paymentReviewRequired" class="op-hint">
            Confirme o recebimento integral e salve a data de pagamento.
          </p>
          <label
            v-if="order.paymentReviewRequired && !billingReadonly"
            class="op-check"
          >
            <input
              v-model="paymentReviewed"
              type="checkbox"
              :disabled="saving"
            />
            <span>Confirmo que o valor integral foi recebido</span>
          </label>
        </div>

        <div v-if="!isManual" class="op-field">
          <label for="milestone-delivered">Entregue em</label>
          <input
            id="milestone-delivered"
            v-model="draft.deliveredOn"
            type="date"
            :max="today"
            :aria-invalid="Boolean(fieldErrors.deliveredOn) || undefined"
            :aria-describedby="
              fieldErrors.deliveredOn
                ? 'milestone-delivered-error'
                : 'milestone-delivered-hint'
            "
          />
          <p
            v-if="fieldErrors.deliveredOn"
            id="milestone-delivered-error"
            role="alert"
            class="op-field-error"
          >
            {{ fieldErrors.deliveredOn }}
          </p>
          <p v-else id="milestone-delivered-hint" class="op-hint">
            O dia em que o cliente recebeu o pedido.
          </p>
        </div>
      </div>

      <p class="op-locked-note">
        <OrderIcon name="lock" />
        {{
          isManual
            ? 'Primeiro contato é preenchido na criação. Confirme a entrega nos seus afazeres do Dashboard.'
            : 'Primeiro contato vem da conversa.'
        }}
        Data do pedido e previsão de entrega ficam no Resumo do pedido.
      </p>

      <div class="op-form-actions">
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar datas' }}
        </button>
      </div>
    </form>

    <div
      v-else
      id="order-milestones-body"
      class="op-sheet-body"
      :hidden="!open"
    >
      <p v-if="pendingRead" role="status" class="op-hint">
        Consultando recebimentos…
      </p>
      <div v-if="financialState?.error" class="timeline-read-error">
        <p role="alert" class="op-alert">
          Não foi possível consultar os recebimentos. As datas do pedido foram
          preservadas.
        </p>
        <button
          type="button"
          :disabled="financialState.refreshing"
          @click="financialState.refresh?.()"
        >
          Atualizar recebimentos
        </button>
      </div>
      <p v-if="stale" class="op-hint">
        O histórico exibido pode estar desatualizado. Aguardando atualização dos
        recebimentos.
      </p>
      <div
        class="order-timeline-scroll"
        role="region"
        aria-label="Cronologia do pedido"
        tabindex="0"
      >
        <ol class="order-timeline">
          <li
            v-for="event in events"
            :key="event.id"
            :data-event-id="event.id"
            :data-kind="event.kind"
          >
            <time :datetime="event.day"
              ><span v-if="event.basisLabel" class="timeline-basis">{{
                event.basisLabel
              }}</span
              ><span>{{ event.dateLabel }}</span></time
            >
            <span class="timeline-track" aria-hidden="true"
              ><span class="timeline-dot"></span
            ></span>
            <div class="timeline-entry">
              <strong
                :ref="event.kind === 'delivery' ? setDeliveryResult : undefined"
                :tabindex="event.kind === 'delivery' ? -1 : undefined"
                >{{ event.title }}</strong
              >
              <strong v-if="event.amountLabel" class="op-num timeline-amount">{{
                event.amountLabel
              }}</strong>
              <p class="op-hint">{{ event.subtitle }}</p>
              <span v-if="event.statusLabel" class="timeline-state">{{
                event.statusLabel
              }}</span>
              <details v-if="event.detailLines.length">
                <summary :aria-label="event.detailLabel">Detalhes</summary>
                <p
                  v-for="line in event.detailLines"
                  :key="line"
                  class="op-hint"
                >
                  {{ line }}
                </p>
              </details>
            </div>
          </li>
        </ol>
      </div>
      <p v-if="!events.length" class="op-hint">
        Nenhuma data registrada neste pedido.
      </p>
      <p class="op-hint timeline-scroll-hint">
        Deslize para ver os próximos eventos.
      </p>
      <div v-if="showSummary" class="timeline-totals">
        <span
          >Recebido:
          <strong>{{
            billingMoney(snapshot.receivedAmountCents)
          }}</strong></span
        ><span
          >Falta receber:
          <strong>{{ billingMoney(snapshot.balanceAmountCents) }}</strong></span
        >
      </div>
      <p v-if="deliveryNotice" role="status" class="op-hint">
        {{ deliveryNotice }}
      </p>
      <p v-if="order.paymentReviewRequired && !billingReadonly" class="op-hint">
        Confirme o recebimento integral e salve a data de pagamento.
      </p>
      <p class="op-hint">
        {{
          billingReadonly
            ? 'Pago em é calculado pelos recebimentos registrados; receber um sinal não registra quitação integral.'
            : isManual
              ? 'Pago em é informado aqui. Confirme a entrega no cabeçalho desta seção ou nos afazeres do Dashboard.'
              : 'Pago em e Entregue em são informados no pedido.'
        }}
        Essas datas não mudam o status nem a ficha já gerada.
      </p>
    </div>
    <Teleport to="body">
      <dialog
        ref="deliveryDialog"
        class="command-dialog order-delivery-dialog"
        aria-labelledby="order-delivery-title"
        aria-describedby="order-delivery-description"
        @cancel="cancelDelivery"
        @close="afterDeliveryClose"
      >
        <form @submit.prevent="confirmDelivery">
          <h2 id="order-delivery-title">Confirmar entrega</h2>
          <p id="order-delivery-description">
            Confirma que o cliente recebeu o pedido {{ order.number }}?
          </p>
          <p>
            A entrega será registrada com o dia atual de São Paulo. O pagamento
            e o saldo permanecem iguais.
          </p>
          <p v-if="deliveryError" role="alert" class="op-alert">
            {{ deliveryError }}
          </p>
          <button
            v-if="deliveryNeedsReview || deliveryUncertain"
            type="button"
            :disabled="deliveryBusy"
            @click="refreshDelivery"
          >
            Atualizar pedido
          </button>
          <div class="op-form-actions">
            <button
              ref="deliveryCancel"
              type="button"
              :disabled="deliveryBusy"
              @click="deliveryDialog.close()"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="op-save"
              :disabled="!canSubmitDelivery"
            >
              {{ deliveryBusy ? 'Confirmando…' : 'Sim, confirmar entrega' }}
            </button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.order-timeline-scroll {
  max-inline-size: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  padding-block: var(--space-2) var(--space-4);
}
.order-timeline-scroll:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
.order-timeline {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0;
}
.order-timeline > li {
  display: grid;
  flex: 1 0 8.5rem;
  min-inline-size: 0;
  grid-template-rows: 3.5rem var(--space-6) 1fr;
  align-content: start;
}
time {
  display: flex;
  flex-direction: column;
  justify-content: end;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.timeline-basis {
  display: block;
}
.timeline-track {
  display: flex;
  align-items: center;
  position: relative;
}
.timeline-track::after {
  content: '';
  position: absolute;
  inset-inline: var(--space-2) 0;
  block-size: 1px;
  background: var(--color-border);
}
li:last-child .timeline-track::after {
  display: none;
}
.timeline-dot {
  inline-size: var(--space-2);
  block-size: var(--space-2);
  background: var(--color-text-muted);
  border-radius: var(--radius-pill);
}
[data-kind='receipt'] .timeline-dot,
[data-kind='delivery'] .timeline-dot {
  background: var(--status-success-text);
}
[data-kind='external_reversal'] .timeline-dot,
[data-kind='refund'] .timeline-dot {
  background: var(--status-error-text);
  border-radius: 0;
}
.timeline-entry {
  min-inline-size: 0;
  padding-inline-end: var(--space-4);
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}
.timeline-entry > strong {
  display: block;
  font-weight: var(--weight-medium);
}
.timeline-amount {
  margin-top: var(--space-1);
}
.timeline-state {
  display: block;
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.timeline-entry details {
  margin-top: var(--space-1);
  padding: 0;
  border: 0;
  background: transparent;
}
summary {
  color: var(--color-link);
  padding-block: var(--space-2);
  cursor: pointer;
  min-block-size: var(--target-min);
}
summary:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
.timeline-totals {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.timeline-scroll-hint {
  display: none;
}
.order-delivery-dialog form {
  display: grid;
  gap: var(--space-4);
}
.order-delivery-dialog h2 {
  margin: 0;
  font-size: var(--text-xl);
}
.order-delivery-dialog p {
  margin: 0;
}
.order-delivery-dialog button {
  min-block-size: var(--target-min);
}
@media (max-width: 767px) {
  .timeline-scroll-hint {
    display: block;
  }
}
</style>
