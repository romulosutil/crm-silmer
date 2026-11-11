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

    <div id="order-milestones-body" class="op-sheet-body" :hidden="!open">
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
