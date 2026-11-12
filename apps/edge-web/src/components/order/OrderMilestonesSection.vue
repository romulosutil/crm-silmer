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
import OrderSheetHead from './OrderSheetHead.vue';

const SECTION = 'milestones';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const billingState = inject('orderBillingState', null);
const otherSectionOpen = computed(() => editing.editingSection.value !== '');
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
// PED-RD-04: the state of each dot comes from the data already read: a
// recorded date is done, the first date still ahead is next, later ones are
// upcoming. The accessible name carries the state (never colour alone).
const STATE_LABEL = Object.freeze({
  done: 'Concluído',
  next: 'Próximo',
  upcoming: 'Futuro',
});
const timelineEvents = computed(() => {
  const todayDay = operationalDay(new Date());
  let nextTaken = false;
  return events.value.map((event) => {
    let state = 'done';
    if (event.day > todayDay) {
      state = nextTaken ? 'upcoming' : 'next';
      nextTaken = true;
    }
    return { ...event, state, stateLabel: STATE_LABEL[state] };
  });
});
const detailDialog = ref(null);
const detailClose = ref(null);
const timelineRegion = ref(null);
const selectedEventId = ref('');
const selectedEvent = computed(() =>
  events.value.find((event) => event.id === selectedEventId.value),
);
let detailTrigger = null;
let detailOrderId = '';
async function showEventDetails(event, trigger) {
  selectedEventId.value = event.id;
  detailTrigger = trigger;
  detailOrderId = props.order.id;
  const orderId = props.order.id;
  await nextTick();
  if (
    props.order.id !== orderId ||
    selectedEvent.value?.id !== event.id ||
    detailTrigger !== trigger ||
    !trigger?.isConnected
  )
    return;
  detailDialog.value?.showModal();
  detailClose.value?.focus();
}
async function afterDetailClose() {
  const trigger = detailTrigger;
  const orderId = detailOrderId;
  selectedEventId.value = '';
  await nextTick();
  if (orderId === props.order.id) {
    if (trigger?.isConnected) trigger.focus();
    else timelineRegion.value?.focus();
  }
  detailTrigger = null;
}
watch(selectedEvent, (event) => {
  if (!event) detailDialog.value?.close();
});
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
const deliveryEditable = computed(
  () =>
    Boolean((editing.canEditMilestones ?? editing.canEdit).value) &&
    props.order.origin === 'atendimento' &&
    props.order.status === 'confirmado' &&
    !props.order.isTest &&
    !props.order.cancelledAt &&
    typeof editing.confirmDelivery === 'function',
);
const deliveryMode = ref('confirm');
const deliveryDay = ref('');
const deliveryDayInput = ref(null);
const today = ref('');
const deliveryTitle = computed(() =>
  deliveryMode.value === 'change'
    ? 'Alterar data de entrega'
    : 'Confirmar entrega',
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
const deliveryFrozen = ref(false);
const deliveryNeedsReview = ref(false);
let deliveryCompleted = false;
const canSubmitDelivery = computed(
  () =>
    deliveryEditable.value &&
    !deliveryBusy.value &&
    !deliveryUncertain.value &&
    !deliveryNeedsReview.value &&
    deliveryContext.value?.orderId === props.order.id &&
    deliveryContext.value?.expectedVersion === props.order.version &&
    (deliveryMode.value !== 'change' ||
      Boolean(
        deliveryDay.value && deliveryDay.value !== props.order.deliveredOn,
      )),
);

async function askDelivery() {
  if (!deliveryEditable.value || otherSectionOpen.value || deliveryBusy.value)
    return;
  deliveryCompleted = false;
  deliveryNotice.value = '';
  if (!deliveryUncertain.value) {
    deliveryFrozen.value = false;
    deliveryMode.value = props.order.deliveredOn ? 'change' : 'confirm';
    deliveryDay.value = props.order.deliveredOn ?? '';
    today.value = operationalDay(new Date());
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
  (deliveryMode.value === 'change'
    ? deliveryDayInput.value
    : deliveryCancel.value
  )?.focus();
}
async function confirmDelivery() {
  if (!canSubmitDelivery.value) return;
  if (deliveryMode.value === 'change') {
    if (!deliveryDay.value || deliveryDay.value > operationalDay(new Date())) {
      deliveryError.value = 'Informe uma data de entrega até hoje.';
      deliveryDayInput.value?.focus();
      return;
    }
    deliveryContext.value = {
      ...deliveryContext.value,
      deliveredOn: deliveryDay.value,
    };
  }
  const context = deliveryContext.value;
  deliveryFrozen.value = true;
  deliveryBusy.value = true;
  deliveryError.value = '';
  const result = await editing.confirmDelivery(context);
  deliveryBusy.value = false;
  if (props.order.id !== context.orderId) return;
  if (
    result.ok &&
    result.order?.deliveredOn &&
    (!context.deliveredOn || result.order.deliveredOn === context.deliveredOn)
  ) {
    deliveryCompleted = true;
    deliveryUncertain.value = false;
    deliveryContext.value = null;
    deliveryNotice.value = `Entrega ${deliveryMode.value === 'change' ? 'alterada para' : 'confirmada em'} ${dayLabel(result.order.deliveredOn)}.`;
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
  if (
    result.order?.deliveredOn &&
    (!context.deliveredOn || result.order.deliveredOn === context.deliveredOn)
  ) {
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
    : 'A alteração solicitada ainda não foi registrada. Revise e confirme novamente para tentar com a mesma solicitação.';
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
    detailDialog.value?.close();
    selectedEventId.value = '';
    detailTrigger = null;
    detailOrderId = '';
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
onBeforeUnmount(() => {
  detailTrigger = null;
  detailOrderId = '';
  detailDialog.value?.close();
  deliveryDialog.value?.close();
});
</script>

<template>
  <section class="op-sheet" aria-labelledby="order-milestones-title">
    <!-- PFI-17, PLA-07: the dates never block "Gerar" (PLA-06), so their
         state is a plain count. PFI-20: "Datas do pedido" on the screen; the
         printed ficha keeps "Lastro do pedido". -->
    <OrderSheetHead
      title-id="order-milestones-title"
      title="Datas do pedido"
      :state="`${recordedCount} de ${steps.length} datas`"
      section="milestones"
      body-id="order-milestones-body"
    >
      <template #actions>
        <button
          v-if="deliveryEditable"
          ref="deliveryTrigger"
          type="button"
          :disabled="deliveryBusy || otherSectionOpen"
          @click="askDelivery"
        >
          {{
            order.deliveredOn ? 'Alterar data de entrega' : 'Confirmar entrega'
          }}
        </button>
      </template>
    </OrderSheetHead>

    <div
      id="order-milestones-body"
      class="op-sheet-body milestones-body"
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
        ref="timelineRegion"
        class="order-timeline-region"
        role="region"
        aria-label="Cronologia do pedido"
        tabindex="-1"
      >
        <ol class="order-timeline">
          <li
            v-for="event in timelineEvents"
            :key="event.id"
            :data-event-id="event.id"
            :data-kind="event.kind"
            :data-state="event.state"
          >
            <time :datetime="event.day"
              ><span class="timeline-sr">{{ event.stateLabel }}, </span
              ><span v-if="event.basisLabel" class="timeline-basis">{{
                event.basisLabel
              }}</span
              ><span>{{ event.dateLabel }}</span></time
            >
            <span class="timeline-track" aria-hidden="true"
              ><span class="timeline-dot"></span
            ></span>
            <div class="timeline-entry">
              <button
                :ref="event.kind === 'delivery' ? setDeliveryResult : undefined"
                type="button"
                class="timeline-title"
                aria-haspopup="dialog"
                :title="event.detailLabel"
                @click="showEventDetails(event, $event.currentTarget)"
              >
                {{ event.title }}
              </button>
              <strong v-if="event.amountLabel" class="op-num timeline-amount">{{
                event.amountLabel
              }}</strong>
              <p class="op-hint">{{ event.subtitle }}</p>
              <span
                v-if="
                  event.statusLabel &&
                  event.statusLabel !== 'Registro revertido'
                "
                class="timeline-state"
                >{{ event.statusLabel }}</span
              >
            </div>
          </li>
        </ol>
      </div>
      <p v-if="!events.length" class="op-hint">
        Nenhuma data registrada neste pedido.
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
    </div>
    <Teleport to="body">
      <dialog
        ref="detailDialog"
        class="command-dialog timeline-detail-dialog"
        aria-labelledby="timeline-detail-title"
        @close="afterDetailClose"
      >
        <div v-if="selectedEvent" class="timeline-detail-content">
          <h2 id="timeline-detail-title">{{ selectedEvent.title }}</h2>
          <p class="op-hint">
            {{ selectedEvent.basisLabel || 'Data do pedido' }} ·
            <time :datetime="selectedEvent.day">{{
              selectedEvent.dateLabel
            }}</time>
          </p>
          <p v-if="selectedEvent.amountLabel" class="op-num">
            {{ selectedEvent.amountLabel }}
          </p>
          <p>{{ selectedEvent.subtitle }}</p>
          <p v-for="line in selectedEvent.detailLines" :key="line">
            {{ line }}
          </p>
          <div class="op-form-actions">
            <button
              ref="detailClose"
              type="button"
              @click="detailDialog.close()"
            >
              Fechar
            </button>
          </div>
        </div>
      </dialog>
      <dialog
        ref="deliveryDialog"
        class="command-dialog order-delivery-dialog"
        aria-labelledby="order-delivery-title"
        aria-describedby="order-delivery-description"
        @cancel="cancelDelivery"
        @close="afterDeliveryClose"
      >
        <form @submit.prevent="confirmDelivery">
          <h2 id="order-delivery-title">{{ deliveryTitle }}</h2>
          <p id="order-delivery-description">
            {{
              deliveryMode === 'change'
                ? `Informe a data em que o cliente recebeu o pedido ${order.number}.`
                : `Confirma que o cliente recebeu o pedido ${order.number}?`
            }}
          </p>
          <div v-if="deliveryMode === 'change'" class="op-field">
            <label for="delivery-day">Entregue em</label>
            <input
              id="delivery-day"
              ref="deliveryDayInput"
              v-model="deliveryDay"
              type="date"
              :max="today"
              required
              :disabled="deliveryBusy || deliveryFrozen"
            />
            <p class="op-hint">Use a data real da entrega, até hoje.</p>
          </div>
          <p v-else>
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
              {{
                deliveryBusy
                  ? 'Salvando…'
                  : deliveryMode === 'change'
                    ? 'Salvar data de entrega'
                    : 'Sim, confirmar entrega'
              }}
            </button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
/* PED-RD-04/14: the body is the size container; the track reads its width,
   not the viewport. No horizontal scroll at any width. */
.milestones-body {
  container-type: inline-size;
  inline-size: 100%;
  min-inline-size: 0;
}
.order-timeline-region:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
.order-timeline {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  list-style: none;
  padding: 0;
  margin: 0;
  padding-block: var(--space-2) var(--space-4);
}
.order-timeline > li {
  display: grid;
  grid-template-rows: 3.5rem var(--space-6) 1fr;
  align-content: start;
  min-inline-size: 0;
}
time {
  display: flex;
  flex-direction: column;
  justify-content: end;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.timeline-basis {
  display: block;
}
.timeline-sr {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.timeline-track {
  display: flex;
  align-items: center;
  position: relative;
}
.timeline-track::after {
  content: '';
  position: absolute;
  inset-block-start: calc(50% - 0.5px);
  inset-inline: var(--space-3) 0;
  block-size: 1px;
  background: var(--color-border);
}
li:last-child .timeline-track::after {
  display: none;
}
li[data-state='done'] .timeline-track::after {
  background: var(--status-success-text);
}
.timeline-dot {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  background: var(--color-surface);
  border: 2px solid var(--color-border-strong);
  border-radius: var(--radius-pill);
}
li[data-state='done'] .timeline-dot {
  background: var(--status-success-text);
  border-color: var(--status-success-text);
}
li[data-state='next'] .timeline-dot {
  border-color: var(--color-text);
}
[data-kind='external_reversal'] .timeline-dot,
[data-kind='refund'] .timeline-dot {
  background: var(--status-error-text);
  border-color: var(--status-error-text);
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
  font-variant-numeric: tabular-nums;
}
.timeline-state {
  display: block;
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.timeline-title {
  display: block;
  max-inline-size: 100%;
  min-block-size: var(--target-min);
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
  font-weight: var(--weight-medium);
  text-align: start;
  text-decoration: underline dotted;
  text-underline-offset: var(--space-1);
  cursor: pointer;
}
.timeline-title:hover {
  color: var(--color-link);
  background: transparent;
  text-decoration-style: solid;
}
.timeline-title:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
/* Narrow container (30rem, about the phone): the same timeline turns
   vertical, line on the left. From the 1366 px notebook up it stays
   horizontal, with columns that share the width and never scroll. */
@container (max-width: 30rem) {
  .order-timeline {
    grid-auto-flow: row;
    grid-auto-columns: minmax(0, 1fr);
    padding-block: 0;
  }
  .order-timeline > li {
    grid-template-columns: var(--space-3) minmax(0, 1fr);
    grid-template-rows: auto auto;
    grid-template-areas:
      'line date'
      'line entry';
    column-gap: var(--space-4);
  }
  time {
    grid-area: date;
    justify-content: flex-start;
  }
  .timeline-track {
    grid-area: line;
    align-items: flex-start;
    justify-content: center;
    padding-block-start: var(--space-1);
  }
  .timeline-track::after {
    inset-block: var(--space-5) 0;
    inset-inline: calc(50% - 0.5px) auto;
    inline-size: 1px;
    block-size: auto;
  }
  .timeline-entry {
    grid-area: entry;
    padding-block-end: var(--space-4);
  }
  li:last-child .timeline-entry {
    padding-block-end: 0;
  }
}
.timeline-detail-content {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-6);
}
.timeline-detail-content h2,
.timeline-detail-content p {
  margin: 0;
}
.timeline-detail-content h2 {
  font-size: var(--text-xl);
}
.timeline-detail-dialog time {
  display: inline;
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
</style>
