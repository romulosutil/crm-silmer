<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import {
  olistIssueLabels,
  olistIssueCorrectionHint,
  olistFailure,
  olistOperationReason,
} from '../../lib/olist-feedback.js';
import {
  OLIST_FOLLOW_DELAYS_MS,
  canResumeOperation,
  isAdminInvalidated,
  isOperationFailedSafe,
  isOperationUncertain,
  olistOrderDetailStatus,
  shouldPollOperation,
} from '../../lib/olist-progress.js';
import OrderOlistProgress from './OrderOlistProgress.vue';
import OrderOlistRecovery from './OrderOlistRecovery.vue';

const props = defineProps({
  order: { type: Object, required: true },
  orderId: { type: String, required: true },
  revision: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
  /** Pedido cancelado localmente: a geração, a conferência e o vínculo param. */
  cancelled: { type: Boolean, default: false },
});

const emit = defineEmits(['operation']);

const user = inject('sessionUser', ref({}));
const liveEvent = inject('liveEvent', ref(null));
const canOperate = computed(() => user.value?.olistEnabled === true);
// A administração Olist segue a capacidade de Admin, não o checkbox; a API
// revalida cada leitura e comando.
const isAdmin = computed(() =>
  (user.value?.capabilities ?? []).includes('COMMERCIAL_ADMIN'),
);

const projection = ref(/** @type {any} */ (null));
const administration = ref(/** @type {any} */ (null));
const loadStamp = ref(0);
const progressRef = ref(null);
const generateButton = ref(null);
const notice = ref(null);
const paymentDueField = ref(null);
const paymentDueOn = ref('');
const paymentDueInvalid = ref(false);
const busy = ref(false);
const message = ref('');
const error = ref('');
const lastReadFailed = ref(false);
const denied = ref(false);
const exportState = ref('idle');

const UNCERTAIN_MESSAGE =
  'A solicitação pode ter sido recebida. Não repita a geração; atualize a situação ou peça a conferência administrativa da operação.';
const CONNECTION_CODES = new Set([
  'OLIST_CREATION_DISABLED',
  'OLIST_NOT_CONFIGURED',
  'OLIST_RECONNECT_REQUIRED',
  'OLIST_AUTH',
]);
const INEXACT_CODES = new Set([
  'OLIST_EXACT_CENT_REQUIRED',
  'OLIST_SALE_EXACT_CENT_REQUIRED',
  'OLIST_SIZE_PRICE_INEXACT',
  'OLIST_FRACTIONAL_CENT_UNIT',
]);
const PRE_EFFECT_REFUSALS = new Set([
  'OLIST_SALE_EXACT_CENT_REQUIRED',
  'OLIST_EXACT_CENT_REQUIRED',
  'OLIST_FRACTIONAL_CENT_UNIT',
  'ORDER_NOT_CONFIRMED',
  'ORDER_CANCELLED',
  'OLIST_CUSTOMER_INVALID',
  'OLIST_ORDER_INCOMPLETE',
  'OLIST_PAYMENT_DUE_REQUIRED',
  'OLIST_FREIGHT_INVALID',
  'OLIST_TOTAL_MISMATCH',
  'OLIST_NOT_CONFIGURED',
  'OLIST_CREATION_DISABLED',
  'OLIST_RECONNECT_REQUIRED',
  'OLIST_AUTH',
  'OLIST_LEGACY_REVIEW_REQUIRED',
  'OLIST_PREVIEW_STALE',
  'OLIST_RATE_LIMITED',
]);

let controller;
let disposed = false;
let attemptOrderId = '';
let followTimer = 0;
let followAttempt = 0;
let followController;

const base = computed(
  () => `/api/v1/orders/${encodeURIComponent(props.orderId)}/olist`,
);
const isConfirmed = computed(() => props.order?.status === 'confirmado');
const isPending = computed(() => props.order?.status === 'pendente');

// A projeção pode trazer a geração invalidada por um administrador (a mais
// recente). Ela segue visível no progresso, mas não é uma operação ativa: o
// Pedido volta a poder gerar novamente (ADR 069).
const showOperation = computed(() => Boolean(projection.value?.operation));
const hasOperation = computed(
  () => showOperation.value && !isAdminInvalidated(projection.value.operation),
);

const rawPendingFields = computed(() => {
  if (!isConfirmed.value) return [];
  const list = projection.value?.pendingFields;
  return Array.isArray(list) ? list : [];
});

const actionableIssues = computed(() =>
  rawPendingFields.value.filter(
    (entry) => !CONNECTION_CODES.has(String(entry?.code ?? '')),
  ),
);

const integrationUnavailable = computed(() => {
  if (!isConfirmed.value || !projection.value || hasOperation.value)
    return false;
  if (projection.value.creationEnabled === false) return true;
  return rawPendingFields.value.some((entry) =>
    CONNECTION_CODES.has(String(entry?.code ?? '')),
  );
});

const hasInexactSubtotal = computed(() =>
  actionableIssues.value.some((entry) => {
    const code = String(entry?.code ?? '');
    return /FRACTION|INEXACT/u.test(code) || INEXACT_CODES.has(code);
  }),
);

const issueLabels = computed(() =>
  olistIssueLabels(
    actionableIssues.value,
    props.order?.ficha?.sizePricing ?? [],
  ),
);

const correctionHint = computed(() =>
  olistIssueCorrectionHint({
    isStore: props.order?.origin === 'loja',
    hasSizePricing: Boolean(props.order?.ficha?.sizePricing),
    issues: actionableIssues.value,
  }),
);

const orderDetailStatusText = computed(() =>
  olistOrderDetailStatus(projection.value?.operation),
);

const operationReason = computed(() => {
  const op = projection.value?.operation;
  if (!op || isAdminInvalidated(op)) return '';
  if (
    !isOperationFailedSafe(op) &&
    !isOperationUncertain(op) &&
    !['rejected', 'invalidated'].includes(String(op.state ?? ''))
  )
    return '';
  return olistOperationReason(
    op.errorCode ?? op.lastErrorCode,
    String(op.state ?? ''),
  );
});

const queryFailed = computed(
  () =>
    isConfirmed.value &&
    !denied.value &&
    lastReadFailed.value &&
    Boolean(error.value),
);

const canResume = computed(() => {
  if (!isConfirmed.value || !canOperate.value || denied.value) return false;
  if (props.cancelled || props.disabled || lastReadFailed.value) return false;
  if (exportState.value !== 'idle') return false;
  if (actionableIssues.value.length > 0) return false;
  if (projection.value?.creationEnabled === false) return false;
  return canResumeOperation(projection.value?.operation);
});

const canDirectGenerate = computed(() => {
  if (!isConfirmed.value || !canOperate.value || denied.value) return false;
  if (props.cancelled || props.disabled || lastReadFailed.value) return false;
  if (exportState.value !== 'idle' || hasOperation.value) return false;
  if (actionableIssues.value.length > 0) return false;
  return projection.value?.creationEnabled === true;
});

const showDueInput = computed(
  () =>
    (canDirectGenerate.value || canResume.value) &&
    projection.value?.paymentDuePolicy === 'per_order',
);

const showRefreshButton = computed(
  () =>
    isConfirmed.value &&
    !denied.value &&
    (queryFailed.value ||
      Boolean(error.value) ||
      exportState.value !== 'idle' ||
      (hasOperation.value &&
        !['confirmed', 'linked', 'succeeded'].includes(
          String(projection.value?.operation?.state ?? ''),
        ))),
);

const headerSubtitle = computed(() => {
  const number = props.order?.number ?? projection.value?.number;
  if (!number) return '';
  const stateLabel = props.cancelled
    ? 'Cancelado'
    : isConfirmed.value
      ? 'Confirmado'
      : 'Pendente';
  return `Pedido ${number} · ${stateLabel}`;
});

/** @param {unknown} value */
function validCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function focusNotice() {
  await nextTick();
  if (!disposed) notice.value?.focus();
}

function markUncertain() {
  exportState.value = 'uncertain';
  error.value = UNCERTAIN_MESSAGE;
  if (attemptOrderId === props.orderId)
    emit('operation', { unavailable: true });
}

function abortRequests() {
  if (exportState.value === 'submitting') markUncertain();
  controller?.abort();
  controller = undefined;
  busy.value = false;
}

function stopFollow() {
  if (followTimer) globalThis.clearTimeout(followTimer);
  followTimer = 0;
  followController?.abort();
  followController = undefined;
}

/** @param {{interactive?:boolean, preserveError?:boolean}} [options] */
async function load({ interactive = false, preserveError = false } = {}) {
  if (props.disabled || denied.value || busy.value) return null;
  const own = new AbortController();
  controller?.abort();
  controller = own;
  const id = props.orderId;
  busy.value = true;
  if (!preserveError) {
    error.value = '';
    message.value = '';
  }
  lastReadFailed.value = false;
  try {
    const response = await request(base.value, { signal: own.signal });
    if (
      disposed ||
      own.signal.aborted ||
      controller !== own ||
      props.orderId !== id
    )
      return null;
    const data = response.data;
    projection.value = data;
    loadStamp.value += 1;
    if (
      data?.operation &&
      (exportState.value === 'uncertain' ||
        (exportState.value === 'accepted' &&
          !shouldPollOperation(data.operation)))
    ) {
      exportState.value = 'idle';
      if (!preserveError) {
        error.value = '';
        message.value = '';
      }
    }
    emit(
      'operation',
      data?.operation ??
        (['accepted', 'uncertain'].includes(exportState.value)
          ? { unavailable: true }
          : null),
    );
    return data;
  } catch (cause) {
    if (disposed || own.signal.aborted || controller !== own) return null;
    lastReadFailed.value = true;
    if ([401, 403].includes(Number(cause?.status))) {
      denied.value = true;
      projection.value = null;
      emit('operation', { unavailable: true });
    }
    if (!preserveError) {
      error.value = olistFailure(cause, { direct: true });
    }
    if (interactive) await focusNotice();
    return null;
  } finally {
    if (controller === own && !disposed) busy.value = false;
  }
}

async function pollOperation() {
  if (
    disposed ||
    busy.value ||
    props.disabled ||
    denied.value ||
    !shouldPollOperation(projection.value?.operation)
  )
    return;
  const own = new AbortController();
  followController?.abort();
  followController = own;
  const id = props.orderId;
  try {
    const response = await request(base.value, { signal: own.signal });
    if (
      disposed ||
      own.signal.aborted ||
      busy.value ||
      props.orderId !== id ||
      !response.data?.operation
    )
      return false;
    const current = projection.value?.operation;
    const next = response.data.operation;
    const unchanged = [
      'state',
      'stage',
      'number',
      'errorCode',
      'retrySafe',
    ].every((key) => current?.[key] === next[key]);
    if (!unchanged) {
      projection.value = response.data;
      if (
        exportState.value === 'uncertain' ||
        (exportState.value === 'accepted' && !shouldPollOperation(next))
      ) {
        exportState.value = 'idle';
        error.value = '';
        message.value = '';
      }
      emit('operation', next);
    }
    if (!unchanged || isAdmin.value) loadStamp.value += 1;
    return !unchanged;
  } catch (cause) {
    if (disposed || own.signal.aborted) return false;
    if ([401, 403].includes(Number(cause?.status))) {
      denied.value = true;
      projection.value = null;
      emit('operation', { unavailable: true });
      error.value = olistFailure(cause, { direct: true });
      stopFollow();
    }
    return false;
  }
}

function scheduleFollow() {
  if (followTimer) globalThis.clearTimeout(followTimer);
  followTimer = 0;
  if (
    disposed ||
    followAttempt >= OLIST_FOLLOW_DELAYS_MS.length ||
    !shouldPollOperation(projection.value?.operation)
  )
    return;
  followTimer = globalThis.setTimeout(async () => {
    followTimer = 0;
    const changed = await pollOperation();
    if (!changed) {
      followAttempt += 1;
      scheduleFollow();
    }
  }, OLIST_FOLLOW_DELAYS_MS[followAttempt]);
}

async function directGenerate() {
  if (
    busy.value ||
    !canOperate.value ||
    denied.value ||
    props.cancelled ||
    props.disabled ||
    exportState.value === 'submitting' ||
    (!canDirectGenerate.value && !canResume.value)
  )
    return;
  paymentDueInvalid.value = false;
  if (showDueInput.value && !validCalendarDay(paymentDueOn.value)) {
    paymentDueInvalid.value = true;
    error.value =
      'Informe um vencimento válido para este pedido antes de gerar no Olist.';
    await nextTick();
    paymentDueField.value?.focus();
    return;
  }
  const own = new AbortController();
  controller?.abort();
  controller = own;
  const id = props.orderId;
  const number = projection.value?.number ?? props.order?.number;
  const includeDue = showDueInput.value;
  attemptOrderId = id;
  exportState.value = 'submitting';
  busy.value = true;
  error.value = '';
  message.value = '';
  lastReadFailed.value = false;
  let refreshAfter = false;
  let preserveErrorOnRefresh = false;
  try {
    /** @type {Record<string, any>} */
    const body = {};
    if (includeDue) body.paymentDueOn = paymentDueOn.value;
    const response = await request(`${base.value}/export`, {
      method: 'POST',
      body,
      idempotencyKey: commandKey(),
      signal: own.signal,
    });
    if (
      disposed ||
      own.signal.aborted ||
      controller !== own ||
      props.orderId !== id
    )
      return;
    const data = response.data;
    if (
      data?.orderId !== id ||
      data?.number !== number ||
      typeof data?.operationId !== 'string' ||
      !data.operationId ||
      typeof data?.state !== 'string' ||
      typeof data?.stage !== 'string'
    ) {
      markUncertain();
    } else {
      exportState.value = 'accepted';
      projection.value = {
        ...projection.value,
        operation: { state: data.state, stage: data.stage, number: null },
      };
      emit('operation', projection.value.operation);
      message.value = `Solicitação registrada para o pedido ${number}. Acompanhe a operação sem repetir o envio.`;
      followAttempt = 0;
      scheduleFollow();
    }
  } catch (cause) {
    if (
      disposed ||
      own.signal.aborted ||
      controller !== own ||
      props.orderId !== id
    )
      return;
    const status = Number(cause?.status);
    const code = String(cause?.code ?? '');
    if ([401, 403].includes(status)) {
      denied.value = true;
      projection.value = null;
      exportState.value = 'idle';
      emit('operation', { unavailable: true });
      error.value = olistFailure(cause, { direct: true });
    } else if (PRE_EFFECT_REFUSALS.has(code)) {
      exportState.value = 'idle';
      error.value = olistFailure(cause, { direct: true });
      refreshAfter = true;
      preserveErrorOnRefresh = true;
    } else {
      markUncertain();
      if (code === 'OLIST_EXPORT_CONFLICT') {
        refreshAfter = true;
        preserveErrorOnRefresh = true;
      }
    }
  } finally {
    if (controller === own && !disposed) {
      busy.value = false;
      await focusNotice();
      if (refreshAfter && !denied.value) {
        void load({
          interactive: false,
          preserveError: preserveErrorOnRefresh,
        });
      }
    }
  }
}

/** Recuperação administrativa mudou algo: reler a projeção e ajustar foco quando pedido. */
async function recoveryChanged(change) {
  await load({ interactive: false });
  if (change?.focus) {
    await nextTick();
    if (disposed) return;
    (!hasOperation.value && generateButton.value
      ? generateButton.value
      : progressRef.value
    )?.focus();
  }
}

watch(
  () => [props.orderId, props.revision],
  (next, previous) => {
    abortRequests();
    stopFollow();
    if (!previous || next[0] !== previous[0]) {
      paymentDueOn.value = '';
      paymentDueInvalid.value = false;
      exportState.value = 'idle';
      administration.value = null;
      projection.value = null;
      loadStamp.value = 0;
      error.value = '';
      message.value = '';
      lastReadFailed.value = false;
    }
    denied.value = false;
    void load({ interactive: false });
  },
  { immediate: true },
);

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      if (exportState.value !== 'submitting') {
        controller?.abort();
        controller = undefined;
        busy.value = false;
      }
      return;
    }
    void load({ interactive: false });
  },
);

watch(
  () =>
    [
      user.value?.id,
      user.value?.olistEnabled === true,
      user.value?.olistAuthorizationVersion,
      isAdmin.value,
    ].join('|'),
  () => {
    abortRequests();
    stopFollow();
    denied.value = false;
    void load({ interactive: false });
  },
);

watch(liveEvent, (event) => {
  const relevant =
    event?.reset ||
    (event?.type === 'inbox.order.changed' &&
      (!event.orderId || event.orderId === props.orderId)) ||
    ['inbox.contact.changed', 'identity.user.changed'].includes(event?.type);
  if (!relevant) return;
  if (exportState.value === 'submitting') {
    abortRequests();
    return;
  }
  if (hasOperation.value) {
    if (
      (event?.reset || event?.orderId === props.orderId) &&
      !denied.value &&
      !props.disabled
    ) {
      abortRequests();
      void load({ interactive: false });
    }
    return;
  }
  if (!denied.value && !props.disabled) {
    abortRequests();
    void load({ interactive: false });
  }
});

watch(
  () => {
    const op = projection.value?.operation;
    return op
      ? `${op.state}:${op.stage}:${op.errorCode ?? ''}:${op.retrySafe === true ? '1' : '0'}`
      : '';
  },
  () => {
    followAttempt = 0;
    scheduleFollow();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  stopFollow();
  abortRequests();
});
</script>

<template>
  <section
    class="op-sheet olist-preparation"
    :data-pending="isPending || undefined"
    :aria-labelledby="`olist-preparation-${orderId}`"
    :aria-busy="busy || undefined"
  >
    <div class="op-sheet-head">
      <h2 :id="`olist-preparation-${orderId}`">Envio para Olist</h2>
      <p v-if="headerSubtitle && !isPending">{{ headerSubtitle }}</p>
    </div>

    <div class="op-sheet-body">
      <p v-if="denied" ref="notice" tabindex="-1" role="alert" class="op-alert">
        {{ error }}
      </p>

      <p v-else-if="cancelled" class="field-help">
        Pedido cancelado. A geração está bloqueada.
      </p>

      <template v-else-if="isPending">
        <p class="field-help">Disponível após confirmar o pedido</p>
      </template>

      <template v-else-if="isConfirmed">
        <div
          v-if="queryFailed"
          ref="notice"
          tabindex="-1"
          class="olist-query-failure"
          role="alert"
        >
          <h3>Não foi possível consultar a integração</h3>
          <p class="inline-error">{{ error }}</p>
        </div>

        <template v-else-if="exportState === 'uncertain'">
          <div ref="notice" tabindex="-1" class="olist-order-detail-status">
            <h3>Conferência necessária</h3>
            <p role="alert" class="op-alert">{{ error }}</p>
          </div>
        </template>

        <template v-else-if="hasOperation && orderDetailStatusText">
          <div class="olist-order-detail-status" role="status">
            <h3>{{ orderDetailStatusText }}</h3>
            <p v-if="operationReason" class="field-help">
              {{ operationReason }}
            </p>
          </div>
          <div
            v-if="
              actionableIssues.length > 0 &&
              isOperationFailedSafe(projection?.operation)
            "
            class="olist-detail-gaps"
          >
            <ul class="order-source-issues">
              <li v-for="label in issueLabels" :key="label">{{ label }}</li>
            </ul>
            <p class="field-help">{{ correctionHint }}</p>
          </div>
        </template>

        <div v-else-if="hasInexactSubtotal" class="olist-detail-gaps">
          <h3>Valor do tamanho não representável no Olist</h3>
          <ul class="order-source-issues">
            <li v-for="label in issueLabels" :key="label">{{ label }}</li>
          </ul>
          <p class="field-help">{{ correctionHint }}</p>
          <p v-if="integrationUnavailable" class="field-help">
            Integração Olist indisponível.
          </p>
        </div>

        <div v-else-if="issueLabels.length > 0" class="olist-detail-gaps">
          <h3>Complete os dados para gerar no Olist</h3>
          <ul class="order-source-issues">
            <li v-for="label in issueLabels" :key="label">{{ label }}</li>
          </ul>
          <p class="field-help">{{ correctionHint }}</p>
          <p v-if="integrationUnavailable" class="field-help">
            Integração Olist indisponível no momento.
          </p>
        </div>

        <div v-else-if="integrationUnavailable" class="olist-detail-gaps">
          <h3>Integração Olist indisponível</h3>
          <p v-if="canOperate" class="field-help">
            A integração com o Olist está desativada ou sem conexão configurada
            no momento.
          </p>
        </div>

        <p v-else-if="projection" class="field-help" role="status">
          Ainda não gerado no Olist
        </p>

        <div v-if="showDueInput" class="olist-payment-due">
          <label :for="`olist-due-${orderId}`">Vencimento deste pedido</label>
          <input
            :id="`olist-due-${orderId}`"
            ref="paymentDueField"
            v-model="paymentDueOn"
            type="date"
            required
            :disabled="busy || disabled"
            :aria-invalid="paymentDueInvalid || undefined"
            :aria-describedby="`olist-due-help-${orderId}`"
            @input="paymentDueInvalid = false"
          />
          <p :id="`olist-due-help-${orderId}`" class="field-help">
            Informe a data combinada com o cliente antes de gerar no Olist.
          </p>
        </div>

        <p v-if="busy" role="status" class="field-help">
          {{
            exportState === 'submitting'
              ? 'Solicitando geração no Olist…'
              : 'Consultando situação no Olist…'
          }}
        </p>
        <div
          v-if="
            (error || message) &&
            !queryFailed &&
            !denied &&
            exportState !== 'uncertain'
          "
          ref="notice"
          tabindex="-1"
        >
          <p v-if="error" role="alert" class="op-alert">{{ error }}</p>
          <p v-if="message" role="status" class="field-help">{{ message }}</p>
        </div>
      </template>

      <p
        v-if="
          !canOperate &&
          !denied &&
          !cancelled &&
          !queryFailed &&
          (!isPending || showOperation)
        "
        class="field-help"
      >
        Seu usuário não está habilitado para enviar pedidos ao Olist.
      </p>

      <OrderOlistProgress
        v-if="showOperation && !denied"
        ref="progressRef"
        :order-id="orderId"
        :crm-number="order?.number || projection?.number || ''"
        :operation="projection.operation"
        :resources="isAdmin ? (administration?.resources ?? null) : null"
      />

      <OrderOlistRecovery
        v-if="isAdmin && !denied && projection"
        :order-id="orderId"
        :refresh-signal="loadStamp"
        :disabled="disabled"
        :cancelled="cancelled"
        @administration="administration = $event"
        @refresh="recoveryChanged"
      />

      <div
        v-if="canResume || canDirectGenerate || showRefreshButton"
        class="form-actions"
      >
        <button
          v-if="canResume"
          ref="generateButton"
          type="button"
          class="primary"
          :disabled="busy || disabled"
          :aria-busy="busy || undefined"
          @click="directGenerate"
        >
          {{ busy ? 'Retomando…' : 'Retomar geração' }}
        </button>
        <button
          v-else-if="canDirectGenerate"
          ref="generateButton"
          type="button"
          class="primary"
          :disabled="busy || disabled"
          :aria-busy="busy || undefined"
          @click="directGenerate"
        >
          {{ busy ? 'Gerando…' : 'Gerar no Olist' }}
        </button>
        <button
          v-if="showRefreshButton"
          type="button"
          :disabled="busy || disabled || denied"
          @click="load({ interactive: true })"
        >
          Atualizar situação
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.olist-preparation {
  margin-block: var(--space-6);
  min-inline-size: 0;
}

.olist-preparation[data-pending='true'] {
  margin-block: var(--space-2);
}

.olist-preparation[data-pending='true'] .op-sheet-head {
  min-block-size: auto;
  padding: var(--space-2) var(--space-4);
  border-block-end: 0;
}

.olist-preparation[data-pending='true'] .op-sheet-head h2 {
  font-size: var(--text-base);
}

.olist-preparation[data-pending='true'] .op-sheet-body {
  padding: 0 var(--space-4) var(--space-3);
  gap: var(--space-2);
}

.olist-preparation .op-sheet-body {
  display: grid;
  gap: var(--space-4);
}

.olist-preparation p {
  margin: 0;
  overflow-wrap: anywhere;
}

.olist-preparation h3 {
  font-size: var(--text-base);
  margin: 0;
}

.olist-order-detail-status,
.olist-detail-gaps,
.olist-query-failure {
  display: grid;
  gap: var(--space-2);
}

.olist-query-failure {
  padding: var(--space-3) var(--space-4);
  background: var(--status-error-surface);
  border-radius: var(--radius-md);
}

.olist-query-failure h3,
.inline-error {
  color: var(--status-error-text);
}

.order-source-issues {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding-inline-start: var(--space-5);
}

.olist-payment-due {
  display: grid;
  gap: var(--space-2);
}

.olist-preparation .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.olist-preparation button {
  min-block-size: var(--target-min);
}

:deep(.olist-step[data-status='failed_safe'] .olist-step-mark) {
  border-color: var(--status-warning-text);
  background: var(--status-warning-surface);
  color: var(--status-warning-text);
}

:deep(.olist-step[data-status='failed_safe'] .olist-step-status) {
  color: var(--status-warning-text);
  font-weight: 600;
}

@media (width <= 30rem) {
  .olist-preparation .form-actions {
    display: grid;
  }
}
</style>
