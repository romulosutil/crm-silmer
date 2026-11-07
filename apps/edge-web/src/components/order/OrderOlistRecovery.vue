<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { olistStateLabel } from '../../lib/olist-order-feedback.js';
import {
  olistReadStatus,
  olistRecoveryDate,
  olistRecoveryFailure,
  olistRemoteNumber,
  olistSaleNumber,
  olistResourceLabel,
  olistStageLabel,
} from '../../lib/olist-recovery-feedback.js';

// OLIST-T13: administrative recovery never grants generation or commercial
// editing. Every remote operation here is an inspection, not a creation.
const props = defineProps({
  orderId: { type: String, required: true },
  revision: { type: Number, default: null },
  blocked: { type: Boolean, default: false },
  cancelled: { type: Boolean, default: false },
  refreshKey: { type: Number, default: 0 },
});
const emit = defineEmits(['changed', 'busy']);
const user = inject('sessionUser', ref({}));
const liveEvent = inject('liveEvent', ref(null));
const allowed = computed(() =>
  (user.value?.capabilities ?? []).includes('COMMERCIAL_ADMIN'),
);
const opened = ref(false);
const denied = ref(false);
const busy = ref(false);
const stale = ref(false);
const diagnostic = ref(null);
const review = ref(null);
const saleId = ref('');
const linkReason = ref('');
const reconcileReason = ref('');
const targetId = ref('sale');
const error = ref('');
const message = ref('');
const notice = ref(null);
const progressHeading = ref(null);
const saleReviewHeading = ref(null);
let controller;
let disposed = false;
let expiryTimer;
const base = computed(
  () => `/api/v1/orders/${encodeURIComponent(props.orderId)}/olist`,
);
const locked = computed(() => busy.value || props.blocked || denied.value);
const targets = computed(() =>
  diagnostic.value?.operation
    ? [
        {
          id: 'sale',
          stage: 'sale',
          resourceId: null,
          version: diagnostic.value.operation.version,
          label: 'Venda',
        },
        ...(diagnostic.value.resources ?? []).map((resource, index) => ({
          id: resource.id,
          stage: resource.kind,
          resourceId: resource.id,
          version: resource.version,
          label: `${olistStageLabel(resource.kind)} ${index + 1} · ${resource.id}`,
        })),
      ]
    : [],
);
const canLink = computed(
  () =>
    diagnostic.value &&
    !stale.value &&
    !props.cancelled &&
    !['reserved', 'uncertain', 'confirmed', 'linked', 'invalidated'].includes(
      diagnostic.value.operation?.state,
    ) &&
    !(diagnostic.value.attempts ?? []).some(
      (attempt) => attempt.stage === 'sale',
    ),
);

function clearReview() {
  globalThis.clearTimeout(expiryTimer);
  review.value = null;
}
function abort() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
  emit('busy', false);
}
function invalidate(keepMessage = false) {
  abort();
  clearReview();
  stale.value = true;
  if (!keepMessage) message.value = '';
}
function clear() {
  invalidate();
  diagnostic.value = null;
  saleId.value = '';
  linkReason.value = '';
  reconcileReason.value = '';
  targetId.value = 'sale';
  error.value = '';
}
/** @param {import('vue').Ref<any>} target */
async function focus(target) {
  await nextTick();
  if (!disposed) target.value?.focus();
}
/** @param {string} kind @param {any} [entry] */
async function run(kind, entry) {
  if (!allowed.value || !opened.value || locked.value) return;
  if (kind !== 'read' && stale.value) return;
  if (props.cancelled && ['preview', 'link', 'reconcile'].includes(kind))
    return;
  if (kind === 'preview' && !canLink.value) return;
  if (kind === 'link' && (!canLink.value || !review.value)) return;
  const target = targets.value.find((item) => item.id === targetId.value);
  if (kind === 'reconcile' && !target) return;
  const reason =
    kind === 'link' ? linkReason.value.trim() : reconcileReason.value.trim();
  if (
    ['link', 'reconcile'].includes(kind) &&
    (!reason || reason.length > 1000 || /[\u0000-\u001f\u007f]/u.test(reason))
  ) {
    error.value =
      'Informe um motivo de até 1.000 caracteres, sem quebras de linha.';
    await focus(notice);
    return;
  }
  const id = saleId.value.trim();
  if (
    kind === 'preview' &&
    (!/^[1-9][0-9]{0,15}$/u.test(id) || !Number.isSafeInteger(Number(id)))
  ) {
    error.value = 'Informe o ID numérico da venda existente no Olist.';
    await focus(notice);
    return;
  }
  if (kind === 'link' && Date.parse(review.value.expiresAt) <= Date.now()) {
    clearReview();
    error.value = 'A conferência expirou. Confira a venda existente novamente.';
    await focus(notice);
    return;
  }
  const token = review.value?.previewToken;
  if (kind === 'read' || kind === 'preview') clearReview();
  const own = new AbortController();
  controller = own;
  busy.value = true;
  emit('busy', true);
  error.value = '';
  message.value = '';
  const current = () =>
    !disposed && !own.signal.aborted && controller === own && allowed.value;
  const path =
    kind === 'read'
      ? '/administration'
      : kind === 'preview'
        ? '/existing/previews'
        : kind === 'link'
          ? '/links'
          : kind === 'result'
            ? `/reconciliations/${encodeURIComponent(entry.id)}`
            : '/reconcile';
  const body =
    kind === 'preview'
      ? { saleId: id }
      : kind === 'link'
        ? { previewToken: token, reason }
        : kind === 'reconcile'
          ? {
              stage: target.stage,
              resourceId: target.resourceId,
              expectedVersion: target.version,
              reason,
            }
          : undefined;
  try {
    const response = await request(base.value + path, {
      signal: own.signal,
      ...(body === undefined
        ? {}
        : { method: 'POST', body, idempotencyKey: commandKey() }),
    });
    if (!current()) return;
    const data = response.data;
    if (kind === 'read') {
      if (
        !data ||
        !Object.hasOwn(data, 'operation') ||
        !Array.isArray(data.resources) ||
        !Array.isArray(data.attempts) ||
        !Array.isArray(data.requests)
      )
        throw new Error('INVALID_DIAGNOSTIC');
      diagnostic.value = data;
      stale.value = false;
      targetId.value = 'sale';
      await focus(progressHeading);
    } else if (kind === 'preview') {
      const remaining = Date.parse(data?.expiresAt ?? '') - Date.now();
      if (
        data?.orderId !== props.orderId ||
        data?.eligible !== true ||
        typeof data.previewToken !== 'string' ||
        !data.previewToken ||
        !Number.isFinite(remaining) ||
        remaining <= 0 ||
        remaining > 900000
      )
        throw new Error('INVALID_REVIEW');
      review.value = data;
      expiryTimer = globalThis.setTimeout(() => {
        clearReview();
        message.value =
          'A conferência expirou. Confira a venda existente novamente.';
      }, remaining);
      await focus(saleReviewHeading);
    } else if (kind === 'result') {
      if (data?.id !== entry.id) throw new Error('INVALID_READ_RESULT');
      diagnostic.value.requests = diagnostic.value.requests.map((item) =>
        item.id === entry.id ? { ...item, ...data } : item,
      );
      clearReview();
      stale.value = true;
      message.value = `${olistReadStatus(data.status)}. Atualize o acompanhamento para conferir as versões atuais.`;
      busy.value = false;
      emit('busy', false);
      emit('changed');
      await focus(notice);
    } else {
      clearReview();
      stale.value = true;
      message.value =
        kind === 'link'
          ? 'Venda existente vinculada. Atualize o acompanhamento para ver o registro persistido.'
          : 'Reconciliação solicitada. A consulta só lê o Olist; atualize o acompanhamento para ver o resultado.';
      if (kind === 'reconcile' && data?.id && diagnostic.value)
        diagnostic.value.requests = [
          data,
          ...diagnostic.value.requests.filter((item) => item.id !== data.id),
        ];
      busy.value = false;
      emit('busy', false);
      emit('changed');
      await focus(notice);
    }
  } catch (cause) {
    if (!current()) return;
    clearReview();
    error.value = olistRecoveryFailure(cause);
    if (['link', 'reconcile'].includes(kind)) {
      stale.value = true;
      error.value +=
        ' Atualize o acompanhamento antes de qualquer outro comando.';
    }
    if ([401, 403].includes(Number(cause?.status))) {
      diagnostic.value = null;
      denied.value = true;
    }
    if (kind === 'read') {
      diagnostic.value = null;
      stale.value = true;
    }
    await focus(notice);
  } finally {
    if (controller === own && !disposed) {
      busy.value = false;
      emit('busy', false);
    }
  }
}
/** @param {Event} event */
function toggle(event) {
  opened.value = /** @type {HTMLDetailsElement} */ (event.target).open;
  if (opened.value && !diagnostic.value && !denied.value) void run('read');
  if (!opened.value) invalidate();
}
watch(saleId, clearReview, { flush: 'sync' });
watch(
  () => [
    props.orderId,
    props.revision,
    props.cancelled,
    user.value?.id,
    user.value?.olistAuthorizationVersion,
    allowed.value,
  ],
  () => {
    clear();
    denied.value = false;
  },
  { flush: 'sync' },
);
watch(
  () => props.refreshKey,
  () => invalidate(true),
  { flush: 'sync' },
);
watch(
  () => props.blocked,
  (blocked) => {
    if (blocked) invalidate(true);
  },
  { flush: 'sync' },
);
watch(liveEvent, (event) => {
  if (!event || !allowed.value) return;
  invalidate();
  message.value =
    'Os dados podem ter mudado. Atualize o acompanhamento antes de continuar.';
});
onBeforeUnmount(() => {
  disposed = true;
  clear();
});
</script>

<template>
  <details v-if="allowed" class="olist-recovery" @toggle="toggle">
    <summary>Progresso, vínculo e histórico Olist</summary>
    <p class="field-help">
      Acompanhamento administrativo. Reconciliação consulta o Olist sem criar ou
      cancelar cadastros ou vendas.
    </p>
    <button type="button" :disabled="locked" @click="run('read')">
      Atualizar acompanhamento
    </button>
    <p v-if="busy" role="status">Consultando o acompanhamento…</p>
    <p v-if="blocked" class="field-help">
      Salve ou cancele a edição do pedido antes de continuar.
    </p>
    <p
      v-if="error || message"
      ref="notice"
      tabindex="-1"
      :role="error ? 'alert' : 'status'"
      :class="error ? 'inline-error' : 'field-help'"
    >
      {{ error || message }}
    </p>
    <template v-if="diagnostic">
      <h3 ref="progressHeading" tabindex="-1">Progresso por etapa</h3>
      <p v-if="stale" class="field-help">
        Leitura anterior. Atualize o acompanhamento para conferir as versões
        atuais.
      </p>
      <p v-if="!diagnostic.operation">
        Nenhuma operação Olist registrada para este pedido.
      </p>
      <template v-else>
        <p>
          {{ olistStateLabel(diagnostic.operation.state) }} ·
          {{ olistStageLabel(diagnostic.operation.stage) }}
        </p>
        <p v-if="diagnostic.operation.number">
          Venda {{ olistSaleNumber(diagnostic.operation.number) }}
        </p>
        <ol class="olist-recovery-list">
          <li v-for="resource in diagnostic.resources" :key="resource.id">
            <strong>{{ olistStageLabel(resource.kind) }}</strong> ·
            {{ olistResourceLabel(resource.state) }}
            <span class="field-help"
              >Recurso CRM: {{ resource.id }} · Versão
              {{ resource.version }}</span
            >
            <span v-if="resource.parentId" class="field-help"
              >Produto pai CRM: {{ resource.parentId }}</span
            >
            <span class="field-help"
              >ID no Olist: {{ olistRemoteNumber(resource.remoteId) }}</span
            >
          </li>
          <li>
            <strong>Venda</strong> ·
            {{ olistStateLabel(diagnostic.operation.state) }}
          </li>
        </ol>
        <p class="field-help">
          Resultado incerto não autoriza repetir a criação. Uma consulta vazia
          ou divergente exige análise e mantém as travas.
        </p>
        <details v-if="!cancelled" class="olist-recovery-subsection">
          <summary>Solicitar reconciliação por leitura</summary>
          <form class="olist-recovery-form" @submit.prevent="run('reconcile')">
            <label for="olist-reconcile-target">Etapa a conferir</label>
            <select
              id="olist-reconcile-target"
              v-model="targetId"
              :disabled="locked || stale"
            >
              <option
                v-for="target in targets"
                :key="target.id"
                :value="target.id"
              >
                {{ target.label }}
              </option>
            </select>
            <label for="olist-reconcile-reason">Motivo da reconciliação</label>
            <input
              id="olist-reconcile-reason"
              v-model="reconcileReason"
              type="text"
              maxlength="1000"
              required
              autocomplete="off"
              :disabled="locked || stale"
            />
            <button type="submit" :disabled="locked || stale">
              Solicitar reconciliação
            </button>
          </form>
        </details>
      </template>
      <details v-if="canLink" class="olist-recovery-subsection">
        <summary>Vincular venda já existente</summary>
        <p class="field-help">
          Use o ID da venda na conta Olist conectada. O servidor confere
          comprador, produtos, tamanhos, quantidades e cada subtotal antes do
          vínculo.
        </p>
        <form class="olist-recovery-form" @submit.prevent="run('preview')">
          <label for="olist-existing-sale"
            >ID da venda existente no Olist</label
          >
          <input
            id="olist-existing-sale"
            v-model="saleId"
            type="text"
            inputmode="numeric"
            maxlength="16"
            autocomplete="off"
            required
            :disabled="locked"
          />
          <button type="submit" :disabled="locked">
            Conferir venda existente
          </button>
        </form>
        <form
          v-if="review"
          class="olist-recovery-form"
          @submit.prevent="run('link')"
        >
          <h4 ref="saleReviewHeading" tabindex="-1">
            Venda existente conferida
          </h4>
          <p>
            Venda {{ olistSaleNumber(review.sale?.number) }} · ID
            {{ olistRemoteNumber(review.sale?.id) }}
          </p>
          <p class="field-help">
            Conferência válida até
            {{ olistRecoveryDate(review.expiresAt) }} (São Paulo). O vínculo
            será conferido novamente pelo servidor.
          </p>
          <label for="olist-existing-reason">Motivo do vínculo</label>
          <input
            id="olist-existing-reason"
            v-model="linkReason"
            type="text"
            maxlength="1000"
            required
            autocomplete="off"
            :disabled="locked"
          />
          <button type="submit" :disabled="locked">
            Confirmar vínculo existente
          </button>
        </form>
      </details>
      <details class="olist-recovery-subsection">
        <summary>Histórico de operações e consultas</summary>
        <template v-if="diagnostic.operation">
          <p class="field-help">
            Operação: {{ diagnostic.operation.id }} · Versão
            {{ diagnostic.operation.version }} · Ator CRM:
            {{ diagnostic.operation.actorId }}
          </p>
          <p v-if="diagnostic.operation.errorCode" class="field-help">
            {{ olistRecoveryFailure({ code: diagnostic.operation.errorCode }) }}
          </p>
        </template>
        <h4>Tentativas registradas</h4>
        <p v-if="!diagnostic.attempts.length">
          Nenhuma tentativa de efeito registrada.
        </p>
        <ol v-else class="olist-recovery-list">
          <li v-for="attempt in diagnostic.attempts" :key="attempt.id">
            <strong>{{ olistStageLabel(attempt.stage) }}</strong> ·
            {{ olistResourceLabel(attempt.outcome) }}
            <span class="field-help"
              >{{ olistRecoveryDate(attempt.createdAt) }} (São Paulo) ·
              Tentativa {{ attempt.id }}</span
            >
            <span v-if="attempt.finishedAt" class="field-help"
              >Concluída em {{ olistRecoveryDate(attempt.finishedAt) }} (São
              Paulo)</span
            >
            <span v-if="attempt.resourceId" class="field-help"
              >Recurso CRM: {{ attempt.resourceId }}</span
            >
            <span v-if="attempt.observedRemoteId" class="field-help"
              >ID observado no Olist:
              {{ olistRemoteNumber(attempt.observedRemoteId) }}</span
            >
          </li>
        </ol>
        <p v-if="diagnostic.attemptHistoryTruncated" class="field-help">
          Exibindo as 100 tentativas mais recentes. O histórico anterior
          permanece preservado.
        </p>
        <h4>Reconciliações</h4>
        <p v-if="!diagnostic.requests.length">
          Nenhuma reconciliação solicitada.
        </p>
        <ol v-else class="olist-recovery-list">
          <li v-for="entry in diagnostic.requests" :key="entry.id">
            <strong>{{ olistStageLabel(entry.stage) }}</strong> ·
            {{ olistReadStatus(entry.status) }}
            <span class="field-help"
              >Consulta {{ entry.id }} · Versão {{ entry.version }}</span
            >
            <span v-if="entry.actorId" class="field-help"
              >Ator CRM: {{ entry.actorId }}</span
            >
            <span v-if="entry.resourceId" class="field-help"
              >Recurso CRM: {{ entry.resourceId }}</span
            >
            <button
              type="button"
              :disabled="locked || stale"
              :aria-label="`Consultar resultado da reconciliação ${entry.id}`"
              @click="run('result', entry)"
            >
              Consultar resultado
            </button>
          </li>
        </ol>
        <p v-if="diagnostic.requests.length >= 100" class="field-help">
          Exibindo até 100 consultas recentes. O histórico anterior permanece
          preservado.
        </p>
      </details>
    </template>
  </details>
</template>

<style scoped>
.olist-recovery,
.olist-recovery-subsection {
  margin-block-start: var(--space-4);
  padding-block-start: var(--space-4);
  border-block-start: 1px solid var(--color-border-subtle);
}
.olist-recovery summary {
  cursor: pointer;
  min-block-size: var(--target-min);
  align-content: center;
  font-weight: 600;
}
.olist-recovery p,
.olist-recovery h3,
.olist-recovery h4 {
  margin-block: var(--space-3);
  overflow-wrap: anywhere;
}
.olist-recovery-form {
  display: grid;
  gap: var(--space-3);
  margin-block: var(--space-4);
  max-inline-size: 48rem;
}
.olist-recovery-form label {
  margin: 0;
}
.olist-recovery-form input,
.olist-recovery-form select {
  min-inline-size: 0;
  inline-size: 100%;
}
.olist-recovery button {
  min-block-size: var(--target-min);
}
.olist-recovery-list {
  margin: 0;
  padding-inline-start: var(--space-5);
}
.olist-recovery-list li {
  padding-block: var(--space-3);
  overflow-wrap: anywhere;
}
.olist-recovery-list .field-help {
  display: block;
}
.olist-recovery-list button {
  margin-block-start: var(--space-3);
}
@media (width >= 48rem) {
  .olist-recovery-form button {
    justify-self: start;
  }
}
</style>
