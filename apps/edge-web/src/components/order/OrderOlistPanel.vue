<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { amountLabel } from '../../lib/order-format.js';
import {
  olistIssueLabel,
  olistIssueLocation,
  olistOrderFailure,
  olistStateLabel,
  registrationActionLabel,
} from '../../lib/olist-order-feedback.js';

const props = defineProps({
  orderId: { type: String, required: true },
  revision: { type: Number, default: null },
  blocked: { type: Boolean, default: false },
  readOnlyAllowed: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(['operation']);
const user = inject('sessionUser', ref({}));
const liveEvent = inject('liveEvent', ref(null));
const allowed = computed(() => user.value?.olistEnabled === true);
const readable = computed(() => allowed.value || props.readOnlyAllowed);
const projection = ref(null);
const preview = ref(null);
const busy = ref(false);
const error = ref('');
const message = ref('');
const denied = ref(false);
const notice = ref(null);
const reviewHeading = ref(null);
let controller;
let disposed = false;
let expiryTimer;
const base = computed(
  () => `/api/v1/orders/${encodeURIComponent(props.orderId)}/olist`,
);
const operation = computed(() => projection.value?.operation ?? null);
const expiresLabel = computed(() =>
  preview.value?.expiresAt
    ? new Intl.DateTimeFormat('pt-BR', {
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(preview.value.expiresAt))
    : '',
);

function invalidate() {
  controller?.abort();
  controller = undefined;
  globalThis.clearTimeout(expiryTimer);
  preview.value = null;
  busy.value = false;
  message.value = '';
}
function clear() {
  invalidate();
  projection.value = null;
  error.value = '';
}
/** @param {import('vue').Ref<any>} target */
async function focus(target) {
  await nextTick();
  if (!disposed) target.value?.focus();
}
/** Every response belongs to this order, current permission and one request. */
async function run(kind, moveFocus = true) {
  if (
    !readable.value ||
    (kind !== 'read' && !allowed.value) ||
    denied.value ||
    busy.value ||
    props.blocked
  )
    return;
  const token = preview.value?.previewToken;
  if (
    kind === 'check' &&
    (!token || !preview.value?.eligible || operation.value)
  )
    return;
  const own = new AbortController();
  controller?.abort();
  controller = own;
  busy.value = true;
  error.value = '';
  message.value = '';
  if (kind !== 'check') preview.value = null;
  if (kind === 'read') emit('operation', { state: 'checking' });
  const current = () =>
    !disposed &&
    !own.signal.aborted &&
    controller === own &&
    readable.value &&
    (kind === 'read' || allowed.value);
  try {
    const response = await request(
      base.value +
        (kind === 'preview'
          ? '/preview'
          : kind === 'check'
            ? '/preview/check'
            : ''),
      {
        signal: own.signal,
        ...(kind === 'read'
          ? {}
          : {
              method: 'POST',
              body: kind === 'check' ? { previewToken: token } : {},
              idempotencyKey: commandKey(),
            }),
      },
    );
    if (!current()) return;
    if (kind === 'read') {
      if (
        response.data?.orderId !== props.orderId ||
        !Object.hasOwn(response.data, 'operation')
      )
        throw new Error('INVALID_PROJECTION');
      projection.value = response.data;
      emit('operation', response.data.operation);
    } else if (kind === 'preview') {
      preview.value = response.data;
      const remaining = Date.parse(response.data.expiresAt ?? '') - Date.now();
      globalThis.clearTimeout(expiryTimer);
      if (
        response.data.eligible &&
        (!Number.isFinite(remaining) || remaining <= 0)
      ) {
        preview.value = null;
        message.value = 'A prévia expirou. Confira uma nova prévia.';
      } else if (response.data.eligible) {
        expiryTimer = globalThis.setTimeout(
          () => {
            preview.value = null;
            message.value = 'A prévia expirou. Confira uma nova prévia.';
          },
          Math.min(remaining, 900000),
        );
      }
      await focus(reviewHeading);
    } else {
      message.value =
        'Prévia conferida nas versões atuais. A geração real continua desligada.';
      await focus(notice);
    }
  } catch (cause) {
    if (!current()) return;
    if (kind === 'read') emit('operation', { state: 'unavailable' });
    preview.value = null;
    error.value = olistOrderFailure(cause);
    if ([401, 403].includes(Number(cause?.status))) {
      projection.value = null;
      denied.value = true;
    }
    if (moveFocus) await focus(notice);
  } finally {
    if (controller === own && !disposed) busy.value = false;
  }
}
watch(
  () => [props.orderId, props.revision, allowed.value, props.readOnlyAllowed],
  () => {
    clear();
    denied.value = false;
    if (readable.value && !props.blocked) void run('read', false);
  },
  { immediate: true },
);
watch(
  () => props.blocked,
  (blocked) => {
    invalidate();
    if (!blocked && readable.value && !denied.value) void run('read', false);
  },
);
watch(liveEvent, (event) => {
  if (!event || !readable.value) return;
  // No remote polling. Local events invalidate review, including changes from
  // another tab, buyer/configuration or authorization revisions.
  invalidate();
  message.value =
    'Os dados podem ter mudado. Atualize o estado antes de continuar.';
});
onBeforeUnmount(() => {
  disposed = true;
  clear();
});
</script>

<template>
  <section
    v-if="readable"
    class="op-sheet order-olist"
    :class="{
      'order-olist--embedded': embedded,
      'order-olist--readonly': !allowed,
    }"
    aria-labelledby="order-olist-title"
    :aria-busy="busy"
  >
    <div class="op-sheet-body">
      <h2 id="order-olist-title">Pedido no Olist</h2>
      <p v-if="allowed" class="field-help">
        Confira cliente, produtos e tamanhos antes de gerar. A geração real
        continua desligada; esta conferência não cria cadastros nem vendas.
      </p>
      <p v-if="blocked && allowed" class="field-help">
        Salve ou cancele a seção em edição antes de conferir o Olist.
      </p>
      <p v-if="projection && allowed">
        Pedido {{ projection.number }} ·
        {{ projection.status === 'confirmado' ? 'Confirmado' : 'Pendente' }}
      </p>
      <p v-if="operation">
        {{ olistStateLabel(operation.state)
        }}<span v-if="operation.number"> · Venda {{ operation.number }}</span>
      </p>
      <div class="form-actions">
        <button
          type="button"
          :disabled="busy || blocked || denied"
          @click="run('read')"
        >
          Atualizar estado Olist
        </button>
        <button
          v-if="allowed && !operation"
          type="button"
          :disabled="busy || blocked || denied"
          @click="run('preview')"
        >
          {{ busy ? 'Consultando…' : 'Conferir prévia Olist' }}
        </button>
      </div>
      <p v-if="busy" role="status">Conferindo o pedido…</p>
      <p
        v-if="error || message"
        ref="notice"
        tabindex="-1"
        :role="error ? 'alert' : 'status'"
        :class="error ? 'inline-error' : 'field-help'"
      >
        {{ error || message }}
      </p>
      <div v-if="preview" class="order-olist-review">
        <h3 ref="reviewHeading" tabindex="-1">
          {{
            preview.eligible
              ? 'Prévia pronta para conferência'
              : 'Pendências para o Olist'
          }}
        </h3>
        <ul v-if="preview.issues?.length">
          <li v-for="(issue, index) in preview.issues" :key="index">
            <strong>{{ olistIssueLocation(issue.field) }}:</strong>
            {{ olistIssueLabel(issue.code) }}
          </li>
        </ul>
        <p v-if="!preview.eligible" class="field-help">
          Corrija os dados na origem com uma pessoa autorizada e confira uma
          nova prévia. A habilitação Olist não concede edição do pedido ou
          cadastro.
        </p>
        <template v-if="preview.eligible">
          <p v-if="preview.customer">
            Comprador: {{ preview.customer.name }} · documento com final
            {{ preview.customer.documentSuffix }}
          </p>
          <p v-if="preview.registrations?.customer">
            Cliente:
            {{ registrationActionLabel(preview.registrations.customer.action) }}
          </p>
          <div
            v-for="(group, index) in preview.commercial?.groups"
            :key="group.groupId"
            class="order-olist-group"
          >
            <h4>
              Grupo {{ index + 1 }} · {{ group.attributes?.garment }} ·
              {{ group.attributes?.color }}
            </h4>
            <p>
              {{
                registrationActionLabel(
                  preview.registrations?.groups?.find(
                    (entry) => entry.groupId === group.groupId,
                  )?.action,
                )
              }}
            </p>
            <ul>
              <li v-for="line in group.lines" :key="line.lineId">
                <strong>Tamanho {{ line.size }}</strong> ·
                {{ line.quantity }} peças · Subtotal
                {{ amountLabel(line.subtotalCents) }}
                <span class="field-help">{{
                  registrationActionLabel(
                    preview.registrations?.groups
                      ?.find((entry) => entry.groupId === group.groupId)
                      ?.lines?.find((entry) => entry.lineId === line.lineId)
                      ?.action,
                  )
                }}</span>
              </li>
            </ul>
          </div>
          <p>
            <strong
              >Total do pedido:
              {{ amountLabel(preview.commercial?.totalCents) }}</strong
            >
          </p>
          <p class="field-help">
            Cada subtotal corresponde ao conjunto de peças daquele tamanho. O
            preço unitário do Olist é derivado pelo servidor.
          </p>
          <p class="field-help">
            Conferência válida até {{ expiresLabel }} (São Paulo). Mudanças
            exigem uma nova prévia.
          </p>
          <div class="form-actions">
            <button
              type="button"
              :disabled="busy || blocked || denied || !!operation"
              @click="run('check')"
            >
              Validar prévia atual
            </button>
            <button
              type="button"
              disabled
              aria-describedby="order-olist-disabled"
            >
              Gerar no Olist
            </button>
          </div>
        </template>
      </div>
      <p v-if="allowed" id="order-olist-disabled" class="field-help">
        Geração no Olist indisponível nesta fase. Nenhum clique nesta tela envia
        um comando de criação.
      </p>
    </div>
  </section>
</template>

<style scoped>
.order-olist {
  margin-top: var(--space-4);
}
.order-olist--embedded {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.order-olist--embedded > .op-sheet-body {
  padding: 0;
}
.order-olist--readonly > .op-sheet-body {
  padding-block: var(--space-3);
}
.order-olist h2,
.order-olist h3,
.order-olist h4 {
  margin-bottom: var(--space-3);
}
.order-olist--readonly h2 {
  margin-bottom: 0;
}
.order-olist p + p,
.order-olist .form-actions {
  margin-top: var(--space-3);
}
.order-olist--readonly .form-actions {
  margin-top: 0;
}
.order-olist-review {
  margin-top: var(--space-5);
}
.order-olist-group {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-4);
  margin-top: var(--space-4);
}
.order-olist-group ul {
  padding-left: var(--space-5);
}
.order-olist-group li {
  margin-block: var(--space-3);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.order-olist-group .field-help {
  display: block;
}
.order-olist .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.order-olist button {
  min-height: var(--control-height);
}
@media (max-width: 768px) {
  .order-olist .form-actions {
    flex-direction: column;
  }
}
</style>
