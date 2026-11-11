<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { amountLabel } from '../../lib/order-format.js';
import { dateTimeBR } from '../../lib/format.js';
import OrderShippingEstimate from '../order/OrderShippingEstimate.vue';
import AppHint from '../AppHint.vue';
import AppIcon from '../AppIcon.vue';
import JourneyDialog from '../JourneyDialog.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
  subjects: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  hasDraft: { type: Boolean, default: false },
  revision: { type: Number, default: 0 },
});
const emit = defineEmits(['draft']);
const journey = ref(null);
const subjectId = ref('');
const order = ref(null);
const quote = ref(null);
const busy = ref(false);
const loadingOrder = ref(false);
const error = ref('');
const notice = ref('');
const resultsHeading = ref(null);
const draftButton = ref(null);
const errorNotice = ref(null);
const estimateRevision = ref(0);
const fields = reactive({
  fromPostalCode: '',
  toPostalCode: '',
  weightGrams: '',
  widthCm: '',
  heightCm: '',
  lengthCm: '',
  insuranceValue: '0,00',
});
let controller;
let orderController;
let calculateKey;
const selectionKeys = new Map();
const targets = computed(() =>
  props.subjects.filter((subject) => subject.orderId),
);
const target = computed(() =>
  targets.value.find((subject) => subject.id === subjectId.value),
);
const selected = computed(() =>
  quote.value?.services?.find(
    (service) => service.id === quote.value.selectedServiceId,
  ),
);
const fieldDefinitions = [
  { key: 'weightGrams', label: 'Peso total (g)', max: 300000 },
  { key: 'widthCm', label: 'Largura (cm)', max: 300 },
  { key: 'heightCm', label: 'Altura (cm)', max: 300 },
  { key: 'lengthCm', label: 'Comprimento (cm)', max: 300 },
];

function invalidate() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
  quote.value = null;
  calculateKey = undefined;
  selectionKeys.clear();
  error.value = '';
  notice.value = '';
}
function close() {
  journey.value?.close();
}
function focusError() {
  errorNotice.value?.$el?.focus();
}
/** @param {HTMLElement} trigger @param {string} [postalCode] */
async function open(trigger, postalCode = '') {
  if (props.disabled) return;
  if (postalCode) fields.toPostalCode = postalCode;
  if (target.value) void loadOrder();
  estimateRevision.value += 1;
  journey.value?.open(trigger);
  await nextTick();
  journey.value?.element?.querySelector('select')?.focus();
}
function closeWork() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
}
let pendingDraft = '';
// The shell emits `close` after the trigger got its focus back, so the
// composer focus requested by a draft is the last one to win.
function onClose() {
  closeWork();
  if (!pendingDraft) return;
  const text = pendingDraft;
  pendingDraft = '';
  emit('draft', text);
}
/** @param {any} cause */
function failure(cause) {
  if (cause?.status === 403)
    return 'Somente o vendedor responsável ou administrador pode cotar neste atendimento. Assuma o atendimento antes de cotar.';
  if (cause?.status === 409)
    return 'O pedido, o assunto ou a conexão mudou. Selecione o pedido novamente e refaça a cotação.';
  if (cause?.status === 429)
    return 'Aguarde um momento antes de consultar novamente.';
  if (cause?.status === 400 || cause?.status === 422)
    return 'Confira o pedido, os CEPs, o peso, as medidas e o valor segurado.';
  return 'Não foi possível consultar o Melhor Envio. Tente novamente; se continuar, peça ao administrador para conferir a conexão.';
}
async function loadOrder() {
  orderController?.abort();
  orderController = undefined;
  invalidate();
  order.value = null;
  if (!target.value) {
    loadingOrder.value = false;
    return;
  }
  const own = new AbortController();
  orderController = own;
  loadingOrder.value = true;
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(target.value.orderId)}`,
      { signal: own.signal },
    );
    if (!own.signal.aborted && own === orderController)
      order.value = response.data.order;
  } catch (cause) {
    if (!own.signal.aborted && own === orderController)
      error.value =
        'Não foi possível carregar o pedido. Selecione-o novamente para tentar.';
  } finally {
    if (own === orderController) loadingOrder.value = false;
  }
}
async function calculate() {
  if (
    busy.value ||
    loadingOrder.value ||
    props.disabled ||
    !target.value ||
    !order.value
  )
    return;
  const amount = fields.insuranceValue.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/u.test(amount)) {
    error.value =
      'Informe o valor segurado em reais, com até duas casas decimais.';
    await nextTick();
    focusError();
    return;
  }
  controller?.abort();
  const own = new AbortController();
  controller = own;
  busy.value = true;
  error.value = '';
  notice.value = '';
  quote.value = null;
  calculateKey ??= commandKey();
  try {
    const response = await request(
      `/api/v1/conversations/${encodeURIComponent(props.conversationId)}/shipping-quotes`,
      {
        method: 'POST',
        signal: own.signal,
        idempotencyKey: calculateKey,
        body: {
          subjectId: target.value.id,
          orderId: order.value.id,
          orderVersion: order.value.version,
          fromPostalCode: fields.fromPostalCode,
          toPostalCode: fields.toPostalCode,
          weightGrams: Number(fields.weightGrams),
          widthCm: Number(fields.widthCm),
          heightCm: Number(fields.heightCm),
          lengthCm: Number(fields.lengthCm),
          insuranceValueCents: Math.round(Number(amount) * 100),
        },
      },
    );
    if (own !== controller) return;
    quote.value = response.data.quote;
    calculateKey = undefined;
    await nextTick();
    resultsHeading.value?.focus();
    resultsHeading.value?.scrollIntoView({ block: 'start' });
  } catch (cause) {
    if (!own.signal.aborted && own === controller) {
      error.value = failure(cause);
      if (
        /** @type {any} */ (cause)?.status >= 400 &&
        /** @type {any} */ (cause)?.status < 500
      )
        calculateKey = undefined;
      await nextTick();
      focusError();
    }
  } finally {
    if (own === controller) busy.value = false;
  }
}
/** @param {number} serviceId */
async function selectService(serviceId) {
  if (
    busy.value ||
    props.disabled ||
    !quote.value ||
    quote.value.stale ||
    !target.value ||
    !order.value
  )
    return;
  const own = new AbortController();
  controller?.abort();
  controller = own;
  busy.value = true;
  error.value = '';
  notice.value = '';
  if (!selectionKeys.has(serviceId)) selectionKeys.set(serviceId, commandKey());
  try {
    const response = await request(
      `/api/v1/conversations/${encodeURIComponent(props.conversationId)}/shipping-quotes/${encodeURIComponent(quote.value.id)}/select`,
      {
        method: 'POST',
        signal: own.signal,
        idempotencyKey: selectionKeys.get(serviceId),
        body: {
          subjectId: target.value.id,
          orderId: order.value.id,
          orderVersion: order.value.version,
          serviceId,
        },
      },
    );
    if (own !== controller) return;
    quote.value = response.data.quote;
    // A disabled button cannot take focus: release the busy state first.
    busy.value = false;
    estimateRevision.value += 1;
    notice.value =
      'Frete estimado vinculado ao pedido. O valor final permanece igual.';
    await nextTick();
    draftButton.value?.focus();
  } catch (cause) {
    if (!own.signal.aborted && own === controller) {
      error.value = failure(cause);
      await nextTick();
      focusError();
    }
  } finally {
    if (own === controller) busy.value = false;
  }
}
function draft() {
  if (!selected.value || !quote.value || quote.value.stale || props.disabled)
    return;
  const service = selected.value;
  const testLabel =
    quote.value.environment === 'sandbox' ? 'Cotação de teste — Sandbox. ' : '';
  const text = `${testLabel}Frete estimado para ${quote.value.totalPieces} peças: ${service.company} ${service.name}, ${amountLabel(service.priceCents)}, prazo previsto de ${service.deliveryDays} dias úteis. Cotação de ${dateTimeBR(quote.value.createdAt)}, sujeita a nova consulta.`;
  pendingDraft = text;
  close();
}
watch(fields, invalidate, { flush: 'sync' });
watch(() => [subjectId.value, target.value?.orderId], loadOrder);
watch(
  () => props.revision,
  () => {
    if (target.value) void loadOrder();
  },
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      close();
      invalidate();
    }
  },
);
watch(
  () => props.conversationId,
  () => {
    close();
    invalidate();
    orderController?.abort();
    subjectId.value = '';
    order.value = null;
  },
);
onBeforeUnmount(() => {
  controller?.abort();
  orderController?.abort();
});
defineExpose({ open });
</script>

<template>
  <div class="conversation-shipping-action">
    <button
      type="button"
      class="quiet"
      title="Cotar frete"
      aria-label="Cotar frete"
      :disabled="disabled"
      @click="open($event.currentTarget)"
    >
      <AppIcon name="truck" /><span class="composer-label">Cotar frete</span>
    </button>
    <!-- The composer styles every button inside it; the dialog lives on <body>. -->
    <Teleport to="body">
      <JourneyDialog
        ref="journey"
        class="conversation-shipping-dialog"
        title="Cotar frete para o pedido"
        close-label="Fechar cotação"
        @close="onClose"
      >
        <p id="conversation-shipping-help" class="quote-help">
          Escolha o pedido e informe o peso total e as medidas da embalagem
          fechada. A estimativa fica separada do valor final.
        </p>
        <p v-if="!targets.length" role="status">
          Vincule um pedido a um assunto deste atendimento para cotar o frete.
        </p>
        <form
          v-else
          id="conversation-shipping-form"
          class="quote-form"
          :aria-busy="busy || loadingOrder"
          aria-describedby="conversation-shipping-help"
          @submit.prevent="calculate"
        >
          <div class="quote-group">
            <div class="quote-field">
              <label for="shipping-target">Pedido deste atendimento</label>
              <select id="shipping-target" v-model="subjectId" required>
                <option value="">Escolha o pedido</option>
                <option
                  v-for="subject in targets"
                  :key="subject.id"
                  :value="subject.id"
                >
                  Pedido {{ subject.orderNumber }} ·
                  {{ subject.label || subject.title || 'Assunto do pedido' }}
                </option>
              </select>
            </div>
            <p v-if="loadingOrder" role="status">Carregando pedido…</p>
            <button
              v-if="target && !order && !loadingOrder"
              type="button"
              class="quote-reload"
              @click="loadOrder"
            >
              Carregar pedido novamente
            </button>
            <OrderShippingEstimate
              v-if="order"
              :order-id="order.id"
              :revision="estimateRevision + revision"
              show-empty
            />
          </div>
          <fieldset
            class="quote-fields"
            :disabled="!order || loadingOrder || disabled"
          >
            <legend>Embalagem para a cotação</legend>
            <div class="quote-row">
              <div
                v-for="field in [
                  { key: 'fromPostalCode', label: 'CEP de origem' },
                  { key: 'toPostalCode', label: 'CEP de destino' },
                ]"
                :key="field.key"
                class="quote-field"
              >
                <label :for="`conversation-shipping-${field.key}`">{{
                  field.label
                }}</label>
                <input
                  :id="`conversation-shipping-${field.key}`"
                  v-model="fields[field.key]"
                  inputmode="numeric"
                  autocomplete="off"
                  pattern="[0-9]{5}-?[0-9]{3}"
                  maxlength="9"
                  required
                />
              </div>
            </div>
            <div class="quote-row" data-cols="4">
              <div
                v-for="field in fieldDefinitions"
                :key="field.key"
                class="quote-field"
              >
                <label :for="`conversation-shipping-${field.key}`">{{
                  field.label
                }}</label>
                <input
                  :id="`conversation-shipping-${field.key}`"
                  v-model="fields[field.key]"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  :max="field.max"
                  step="1"
                  required
                />
              </div>
            </div>
            <div class="quote-row">
              <div class="quote-field">
                <label for="conversation-shipping-insurance"
                  >Valor segurado (R$)</label
                >
                <input
                  id="conversation-shipping-insurance"
                  v-model="fields.insuranceValue"
                  inputmode="decimal"
                  maxlength="12"
                  required
                />
              </div>
            </div>
          </fieldset>
        </form>
        <AppHint
          v-if="error"
          ref="errorNotice"
          tone="error"
          class="quote-alert"
          role="alert"
          tabindex="-1"
        >
          {{ error }}
        </AppHint>
        <AppHint v-if="notice" tone="success" class="quote-hint" role="status">
          {{ notice }}
        </AppHint>
        <section
          v-if="quote"
          class="quote-group"
          aria-labelledby="conversation-shipping-results"
        >
          <h3
            id="conversation-shipping-results"
            ref="resultsHeading"
            tabindex="-1"
          >
            Opções de frete
          </h3>
          <AppHint
            v-if="quote.environment === 'sandbox'"
            tone="info"
            class="quote-hint"
          >
            Cotação de teste — Sandbox
          </AppHint>
          <p class="quote-meta">
            {{ quote.totalPieces }} peças · {{ dateTimeBR(quote.createdAt) }}
          </p>
          <AppHint
            v-if="quote.stale"
            tone="warning"
            class="quote-hint"
            role="status"
          >
            Cotação desatualizada. Consulte novamente antes de vincular o frete.
          </AppHint>
          <p v-if="!quote.services.length" class="quote-meta">
            Nenhum serviço disponível para esta embalagem e estes CEPs.
          </p>
          <ul v-if="quote.services.length" class="quote-services">
            <li v-for="service in quote.services" :key="service.id">
              <div class="quote-service-main">
                <strong>{{ service.company }} · {{ service.name }}</strong>
                <span class="quote-meta"
                  >{{ service.deliveryDays }} dias úteis previstos</span
                >
              </div>
              <span class="quote-price">{{
                amountLabel(service.priceCents)
              }}</span>
              <span
                v-if="quote.selectedServiceId === service.id"
                class="quote-linked"
                ><AppIcon name="check" />Frete vinculado</span
              >
              <button
                v-else
                type="button"
                class="quote-link"
                :disabled="busy || disabled || quote.stale"
                @click="selectService(service.id)"
              >
                Vincular {{ service.name }} ao pedido
              </button>
            </li>
          </ul>
          <p
            v-for="service in quote.unavailable"
            :key="service.id"
            class="quote-meta"
          >
            {{ service.name }}: {{ service.message }}
          </p>
        </section>
        <template v-if="targets.length" #footer>
          <button
            type="submit"
            form="conversation-shipping-form"
            :class="{ primary: !selected }"
            :disabled="busy || loadingOrder || !order || disabled"
          >
            {{ busy ? 'Consultando ou salvando…' : 'Consultar frete' }}
          </button>
          <button
            v-if="selected"
            ref="draftButton"
            type="button"
            class="primary"
            :disabled="busy || disabled || quote.stale"
            @click="draft"
          >
            {{
              hasDraft
                ? 'Acrescentar resposta com o frete'
                : 'Escrever resposta com o frete'
            }}
          </button>
        </template>
      </JourneyDialog>
    </Teleport>
  </div>
</template>

<style scoped>
.conversation-shipping-action {
  display: contents;
}
.quote-help,
.quote-meta {
  margin: 0;
}
.quote-help {
  max-inline-size: 70ch;
}
.quote-meta {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.quote-form {
  gap: var(--space-5);
}
.quote-group {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-inline-size: 0;
}
.quote-group > h3 {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
}
.quote-reload {
  justify-self: start;
}
.quote-fields {
  display: grid;
  gap: var(--space-3);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.quote-fields > legend {
  margin-block-end: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.quote-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: var(--space-3);
}
.quote-row[data-cols='4'] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.quote-field {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 0;
}
.quote-field > label {
  margin: 0;
}
.quote-alert {
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--status-error-surface);
  border-radius: var(--radius-md);
}
.quote-alert,
.quote-hint {
  font-size: var(--text-sm);
}
.quote-services {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.quote-services > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  padding-block: var(--space-3);
  border-block-start: 1px solid var(--color-border-subtle);
}
.quote-service-main {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 0;
}
.quote-service-main > strong {
  font-weight: var(--weight-semibold);
}
.quote-price {
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
}
.quote-linked {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-block-size: var(--control-height);
  padding-inline: var(--space-3);
  color: var(--status-success-text);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  background: var(--status-success-surface);
  border-radius: var(--radius-pill);
}
.quote-linked > .app-icon {
  inline-size: 1rem;
  block-size: 1rem;
}
p {
  overflow-wrap: anywhere;
}
@media (width < 48rem) {
  .quote-row[data-cols='4'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .quote-services > li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .quote-link,
  .quote-linked {
    grid-column: 1 / -1;
  }
  .quote-link {
    min-block-size: var(--target-min);
  }
  .quote-linked {
    justify-self: start;
  }
  .quote-reload {
    min-block-size: var(--target-min);
  }
}
</style>
