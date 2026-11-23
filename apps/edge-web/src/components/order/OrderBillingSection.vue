<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  watch,
} from 'vue';
import { request } from '../../lib/api-client.js';
import { billingError, billingReason } from '../../lib/order-billing.js';
import {
  KIND,
  deriveBillingView,
  messageText,
  nextCharge,
  sendFlash,
  sendProgress,
  sendSteps,
  timeOf,
} from '../../lib/order-billing-view.js';
import {
  billingIntent,
  copyText,
  uncertainFailure,
} from '../../lib/order-billing-command.js';
import { CHANNEL_LABELS } from '../../lib/format.js';
import OrderIcon from './OrderIcon.vue';
import BillingAmountDialog from './billing/BillingAmountDialog.vue';
import BillingBadge from './billing/BillingBadge.vue';
import BillingCancelDialog from './billing/BillingCancelDialog.vue';
import BillingExternalDialog from './billing/BillingExternalDialog.vue';
import BillingMovements from './billing/BillingMovements.vue';
import BillingNextStep from './billing/BillingNextStep.vue';
import BillingConfirmDialog from './billing/BillingConfirmDialog.vue';
import BillingReceiptDialog from './billing/BillingReceiptDialog.vue';
import BillingReconcileDialog from './billing/BillingReconcileDialog.vue';
import BillingRefundDialog from './billing/BillingRefundDialog.vue';
import BillingReverseDialog from './billing/BillingReverseDialog.vue';
import BillingSendDialog from './billing/BillingSendDialog.vue';
import BillingSituation from './billing/BillingSituation.vue';
import BillingVerifyDialog from './billing/BillingVerifyDialog.vue';

/*
 * RFC 074 (LPC-09), "Cobranças e recebimentos": Situação, Próximo passo and
 * Movimentações, with the same name and badge in the section, the rail and
 * the Inbox. Only the owner or an administrator operates; another seller
 * reads numbers, badge and rows, and a locked line instead of the next step.
 *
 * The section owns the reads (GET billing, send-intent progress) and the
 * write runner; every dialog reaches them through `orderBillingContext`.
 * Writes carry `expectedVersion`/`expectedBillingVersion` and an
 * Idempotency-Key; an uncertain answer freezes the whole intent and a retry
 * repeats it (billingIntent).
 */
const props = defineProps({ order: { type: Object, required: true } });
const emit = defineEmits(['state', 'changed']);
const editing = /** @type {any} */ (inject('orderEditing', null));

/** @type {import('vue').Ref<any>} */
const billing = ref(null);
const loading = ref(false);
const reading = ref(false);
const unavailable = ref(false);
const error = ref('');
const pick = ref(/** @type {0|50|100} */ (50));
const changingTerms = ref(false);
/** @type {import('vue').Ref<any>} */
const sending = ref(null);
const busy = ref('');
/** @type {import('vue').Ref<{text: string, tone: string}|null>} */
const status = ref(null);
const liveMessage = ref('');
/** @type {import('vue').Ref<any>} */
const uncertain = ref(null);
const dialogOpen = ref(0);
/** @type {import('vue').Ref<HTMLElement|null>} */
const sectionRoot = ref(null);
/** @type {Record<string, import('vue').Ref<any>>} */
const dialogs = {
  send: ref(null),
  amount: ref(null),
  cancel: ref(null),
  external: ref(null),
  verify: ref(null),
  reconcile: ref(null),
  refund: ref(null),
  reverse: ref(null),
  receipt: ref(null),
  confirm: ref(null),
};
let controller = /** @type {AbortController|null} */ (null);
let timer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
let intentTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (
  undefined
);
let disposed = false;
/** @type {{id: string, from: string}|null} */
let confirming = null;
let conversationCache = /** @type {any} */ (null);

const base = computed(
  () => `/api/v1/orders/${encodeURIComponent(props.order.id)}/billing`,
);
const isPhone = computed(() => Boolean(editing?.isPhone?.value));
const open = computed(() => editing?.isSectionOpen?.('billing') ?? true);
const toggleBlocked = computed(
  () => isPhone.value && (editing?.editingSection?.value ?? '') !== '',
);
const visible = computed(
  () =>
    !unavailable.value &&
    (props.order.status === 'confirmado' || Boolean(billing.value?.managed)),
);
const cancelled = computed(
  () =>
    Boolean(props.order.cancelledAt) ||
    billing.value?.blockedReason === 'ORDER_CANCELLED',
);
const conv = computed(() =>
  Boolean(
    billing.value?.chatSendEnabled &&
    props.order.conversationId &&
    props.order.status === 'confirmado',
  ),
);
const readOnly = computed(() => {
  if (cancelled.value) return billingReason('ORDER_CANCELLED');
  if (billing.value && billing.value.enabled === false)
    return billingReason('BILLING_DISABLED');
  if (uncertain.value)
    return 'A última operação não teve resposta confirmada. Repita a mesma operação antes de iniciar outra.';
  return '';
});
const orderNumber = computed(() => String(props.order.number ?? ''));
const orderTitle = computed(() => {
  const summary = props.order.ficha?.summary ?? {};
  return [summary.cliente, summary.nome].filter(Boolean).join(' — ');
});
const view = computed(() =>
  deriveBillingView(billing.value ?? {}, {
    conv: conv.value,
    pick: pick.value,
    sending: sending.value,
    busy: busy.value,
    orderNumber: orderNumber.value,
    destination: conversationCache?.label ?? 'a conversa vinculada',
    changingTerms: changingTerms.value,
    readOnly: readOnly.value,
  }),
);

function currentState(ready = true) {
  emit('state', {
    orderId: props.order.id,
    ready,
    loading: loading.value,
    refreshing: reading.value,
    error: error.value,
    unavailable: unavailable.value,
    data: billing.value,
    refresh: () => load(false),
    managed: Boolean(billing.value?.managed),
    available:
      Boolean(billing.value) &&
      !unavailable.value &&
      (props.order.status === 'confirmado' || Boolean(billing.value?.managed)),
  });
}

/** @param {any} value */
function applyBilling(value) {
  const previous = billing.value ? view.value : null;
  billing.value = value;
  const next = view.value;
  if (previous && previous.announce !== next.announce && !sending.value)
    liveMessage.value = next.announce;
  if (confirming) {
    const link = next.links.find((l) => l.id === confirming?.id);
    if (link && link.status !== 'unknown') {
      flash(
        link.status === 'paying'
          ? `Resultado confirmado: a InfinitePay abriu o pagamento às ${timeOf(link.clickedAt)}. Nenhum pagamento novo foi criado.`
          : link.status === 'paid'
            ? 'Resultado confirmado: o pagamento foi recebido.'
            : 'Resultado confirmado: a InfinitePay não abriu o pagamento. O link voltou a aguardar o cliente; nada foi cobrado.',
      );
      confirming = null;
    }
  }
  currentState();
  if (Number(value?.orderVersion) > Number(props.order.version))
    emit('changed');
}

/** @param {boolean} [silent] */
async function load(silent = false) {
  controller?.abort();
  globalThis.clearTimeout(timer);
  const own = new AbortController();
  controller = own;
  const orderId = props.order.id;
  reading.value = true;
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  currentState(Boolean(billing.value) && !error.value);
  try {
    const response = await request(base.value, { signal: own.signal });
    if (own.signal.aborted || props.order.id !== orderId) return;
    unavailable.value = false;
    error.value = '';
    applyBilling(response.data.billing);
  } catch (cause) {
    if (own.signal.aborted) return;
    if (Number(/** @type {any} */ (cause)?.status) === 404) {
      unavailable.value = true;
      billing.value = null;
    } else
      error.value =
        'Não foi possível consultar as cobranças. Os valores anteriores foram preservados.';
  } finally {
    if (own === controller) {
      loading.value = false;
      reading.value = false;
      currentState(!error.value);
      schedule();
    }
  }
}
/** Open links change without the seller: read again while any is open. */
function schedule() {
  globalThis.clearTimeout(timer);
  if (disposed || unavailable.value || !billing.value) return;
  const v = view.value;
  const watching =
    v.groups.open.length > 0 ||
    v.links.some((l) => l.verifying) ||
    Boolean(confirming);
  if (!watching) return;
  timer = globalThis.setTimeout(() => {
    if (
      globalThis.document?.visibilityState === 'visible' &&
      !dialogOpen.value &&
      !sending.value
    )
      void load(true);
    else schedule();
  }, 10000);
}

function versions() {
  return {
    expectedVersion: billing.value?.orderVersion ?? props.order.version,
    expectedBillingVersion: billing.value?.version ?? 0,
  };
}
/** @param {{path: string, body: Record<string, unknown>, key: string}} record */
async function run(record) {
  let response;
  try {
    response = await request(
      `/api/v1/orders/${encodeURIComponent(props.order.id)}/billing/${record.path}`,
      { method: 'POST', body: record.body, idempotencyKey: record.key },
    );
  } catch (cause) {
    if (uncertainFailure(cause)) uncertain.value = record;
    else if (uncertain.value?.key === record.key) uncertain.value = null;
    if (Number(/** @type {any} */ (cause)?.status) === 409) await load(true);
    throw cause;
  }
  if (uncertain.value?.key === record.key) uncertain.value = null;
  if (response.data?.billing) applyBilling(response.data.billing);
  else await load(true);
  emit('changed');
  return response;
}
async function retryUncertain() {
  const record = uncertain.value;
  if (!record || busy.value) return;
  busy.value = 'retry';
  try {
    await run(record);
    flash('Operação confirmada.');
  } catch (cause) {
    if (!uncertainFailure(cause)) flash(billingError(cause), 'error');
  } finally {
    busy.value = '';
  }
}

async function conversation() {
  const id = props.order.conversationId;
  if (!id) throw new Error('NO_CONVERSATION');
  const response = await request(
    `/api/v1/inbox/conversations/${encodeURIComponent(id)}`,
  );
  const data = response.data?.conversation ?? {};
  const inner = data.conversation ?? data;
  const name = inner.contact?.label || data.contact?.label || 'Cliente';
  const channel =
    CHANNEL_LABELS[
      /** @type {keyof typeof CHANNEL_LABELS} */ (inner.channel ?? data.channel)
    ] ?? 'conversa';
  conversationCache = {
    id,
    version: Number(data.version ?? inner.version ?? 0),
    label: `${name} (${channel})`,
  };
  return conversationCache;
}

/** @param {string} text @param {string} [tone] */
function flash(text, tone = 'success') {
  status.value = { text, tone };
}

const generateIntent = billingIntent(run);
const planIntent = billingIntent(run);
const sendIntent = billingIntent(run);

/**
 * Generates a link, or sends one through the conversation. Resolves once the
 * server accepted the command; the send progress continues in Próximo passo.
 *
 * @param {{mode: 'send'|'generate', kind: any, amountCents: number, linkId?: string, percent?: number}} payload
 */
async function startSend(payload) {
  status.value = null;
  const percent = payload.percent;
  if (
    percent !== undefined &&
    changingTerms.value &&
    (billing.value?.condition?.percent ?? null) !== null
  ) {
    await planIntent.send(() => ({
      path: 'plan',
      body: { ...versions(), percent },
    }));
  }
  const withPercent =
    percent !== undefined && !changingTerms.value ? { percent } : {};
  if (payload.mode === 'generate') {
    sending.value = {
      mode: 'generate',
      kind: payload.kind,
      amountCents: payload.amountCents,
      steps: sendSteps('generate', false),
      index: 0,
    };
    try {
      await generateIntent.send(() => ({
        path: 'links',
        body: {
          ...versions(),
          amountCents: payload.amountCents,
          ...withPercent,
        },
      }));
    } catch (cause) {
      sending.value = null;
      throw cause;
    }
    changingTerms.value = false;
    sending.value = { ...sending.value, index: 1, done: true };
    sending.value = null;
    flash(sendFlash('generate', payload.kind, null));
    await focusNextIfLost();
    return;
  }
  const target = conversationCache ?? (await conversation());
  const steps = sendSteps('send', Boolean(payload.linkId));
  const response = await sendIntent.send(() => ({
    path: 'send-intents',
    body: {
      ...versions(),
      action: payload.linkId ? 'send_link' : 'issue_link',
      conversationId: target.id,
      expectedConversationVersion: target.version,
      ...(payload.linkId
        ? { linkId: payload.linkId }
        : { amountCents: payload.amountCents, ...withPercent }),
    },
  }));
  changingTerms.value = false;
  const intent = response.data ?? {};
  sending.value = {
    mode: 'send',
    kind: payload.kind,
    amountCents: payload.amountCents,
    linkId: payload.linkId ?? intent.linkId ?? null,
    steps,
    index: sendProgress(steps, intent.state).index,
    intentId: intent.id,
  };
  followIntent(intent.id, intent.state, 0);
}

/**
 * Follows a send intent until "Entregue", a failure, or a quiet "Enviado".
 * @param {string} id @param {string} state @param {number} polls
 */
function followIntent(id, state, polls) {
  const current = sending.value;
  if (!current || current.intentId !== id || disposed) return;
  const progress = sendProgress(current.steps, state);
  if (progress.failed) {
    sending.value = null;
    flash(
      progress.failed === 'blocked'
        ? 'O envio foi bloqueado pela conversa. O cliente não recebeu a mensagem; o link pode ser cancelado ou enviado de novo.'
        : 'Não foi possível confirmar o envio na conversa. Confira a conversa antes de enviar de novo.',
      'error',
    );
    void load(true);
    return;
  }
  if (progress.done || (state === 'sent' && polls >= 20) || polls >= 90) {
    void finishSend(current, progress.done);
    return;
  }
  if (progress.index !== current.index) {
    sending.value = { ...current, index: progress.index };
    if (state === 'sent') void load(true);
  }
  intentTimer = globalThis.setTimeout(async () => {
    try {
      const response = await request(
        `${base.value}/send-intents/${encodeURIComponent(id)}`,
      );
      followIntent(id, response.data?.state ?? state, polls + 1);
    } catch {
      followIntent(id, state, polls + 1);
    }
  }, 1000);
}
/** @param {any} current @param {boolean} delivered */
async function finishSend(current, delivered) {
  await load(true);
  const link =
    view.value.links.find((l) => l.id === current.linkId) ??
    [...view.value.links]
      .filter((l) => l.amountCents === current.amountCents)
      .at(-1);
  sending.value = null;
  flash(
    sendFlash(
      'send',
      current.kind,
      delivered ? (link?.deliveredAt ?? new Date().toISOString()) : null,
    ),
  );
  await focusNextIfLost();
}

async function focusNextIfLost() {
  await nextTick();
  const active = globalThis.document?.activeElement;
  if (!active || active === globalThis.document.body || !active.isConnected)
    /** @type {HTMLElement|null} */ (
      globalThis.document?.getElementById('order-billing-next-title')
    )?.focus();
}
function dialogClosed() {
  dialogOpen.value = Math.max(0, dialogOpen.value - 1);
  void focusNextIfLost();
  schedule();
}
/** @param {string} name @param {HTMLElement} trigger @param {...any} args */
function openDialog(name, trigger, ...args) {
  dialogOpen.value += 1;
  status.value = null;
  void dialogs[name].value?.open(trigger, ...args);
}

/** @param {string} id */
const linkById = (id) => view.value.links.find((l) => l.id === id);

/**
 * Próximo passo actions.
 * @param {any} action @param {Event} event
 */
async function act(action, event) {
  const trigger = /** @type {HTMLElement} */ (event.currentTarget);
  const v = view.value;
  const link = action.id ? linkById(action.id) : null;
  switch (action.act) {
    case 'send': {
      const nc = nextCharge(v, pick.value);
      return openDialog('send', trigger, { ...nc });
    }
    case 'send-existing':
      if (!link) return;
      return openDialog('send', trigger, {
        kind: link.kind,
        amountCents: link.amountCents,
        linkId: link.id,
        url: link.url,
      });
    case 'send-amount':
    case 'send-another':
      return openDialog('amount', trigger);
    case 'generate': {
      const nc = nextCharge(v, pick.value);
      try {
        await startSend({
          mode: 'generate',
          kind: nc.kind,
          amountCents: nc.amountCents,
          percent:
            nc.fromPick || changingTerms.value ? nc.condition : undefined,
        });
      } catch (cause) {
        flash(billingError(cause), 'error');
      }
      return;
    }
    case 'save-zero':
      busy.value = 'save';
      try {
        await planIntent.send(() => ({
          path: 'plan',
          body: { ...versions(), percent: 0 },
        }));
        changingTerms.value = false;
        flash('Condição salva: sem entrada. Nenhum link foi gerado.');
      } catch (cause) {
        flash(billingError(cause), 'error');
      } finally {
        busy.value = '';
      }
      return focusNextIfLost();
    case 'change-terms':
      changingTerms.value = true;
      pick.value = 50;
      status.value = null;
      await nextTick();
      /** @type {HTMLElement|null} */ (
        sectionRoot.value?.querySelector('input[name="order-billing-terms"]')
      )?.focus();
      return;
    case 'copy-link':
    case 'copy-message': {
      const target = link ?? v.groups.waiting[0];
      if (!target?.url) return;
      const copied = await copyText(
        action.act === 'copy-link'
          ? target.url
          : messageText(
              orderNumber.value,
              target.kind,
              target.amountCents,
              target.url,
            ),
      );
      if (!copied)
        flash(
          'Não foi possível copiar. Selecione o texto e copie pelo menu do aparelho.',
          'error',
        );
      else
        flash(
          action.act === 'copy-link'
            ? 'Link copiado.'
            : 'Mensagem copiada. Cole na conversa com o cliente.',
        );
      return;
    }
    case 'cancel-link':
      if (link) openDialog('cancel', trigger, link);
      return;
    case 'external':
      return openDialog('external', trigger);
    case 'verify':
      if (link) openDialog('verify', trigger, link);
      return;
    case 'reconcile':
      return openDialog('reconcile', trigger);
    case 'confirm-unknown': {
      const target = link ?? v.groups.unknown[0];
      if (target) openDialog('confirm', trigger, target);
      return;
    }
  }
}
/**
 * Row menu actions.
 * @param {string} name @param {any} row @param {HTMLElement} button
 */
async function rowAct(name, row, button) {
  const item = row.item;
  switch (name) {
    case 'copy-link': {
      const copied = await copyText(item.url);
      flash(
        copied
          ? `Link ${KIND[/** @type {keyof typeof KIND} */ (item.kind)].of} copiado.`
          : 'Não foi possível copiar. Selecione o texto e copie pelo menu do aparelho.',
        copied ? 'success' : 'error',
      );
      return;
    }
    case 'provider': {
      const url = view.value.providerUrl(item);
      if (url) globalThis.open?.(url, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'cancel-link':
      return openDialog('cancel', button, item);
    case 'verify':
      return openDialog('verify', button, item);
    case 'confirm-unknown':
      return openDialog('confirm', button, item);
    case 'receipt-view':
      return openDialog('receipt', button, item);
    case 'refund':
      return openDialog('refund', button, item);
    case 'reverse':
      return openDialog('reverse', button, item);
  }
}

/** @param {0|50|100} value */
function choose(value) {
  pick.value = value;
  status.value = null;
}

async function toggle() {
  if (toggleBlocked.value) return;
  editing?.toggleSection?.('billing');
}

provide('orderBillingContext', {
  view,
  conv,
  orderNumber,
  orderTitle,
  versions,
  run,
  startSend,
  conversation,
  flash,
  reload: () => load(true),
  /** Announce the outcome of 'Confirmar resultado' when it arrives. @param {string} id */
  track: (id) => {
    confirming = { id, from: 'unknown' };
    schedule();
  },
});

watch(
  () => [props.order.id, props.order.version],
  (next, previous) => {
    if (!previous || next[0] !== previous[0]) {
      billing.value = null;
      unavailable.value = false;
      sending.value = null;
      status.value = null;
      uncertain.value = null;
      changingTerms.value = false;
      conversationCache = null;
      confirming = null;
      currentState(false);
    }
    void load(Boolean(billing.value));
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  globalThis.clearTimeout(timer);
  globalThis.clearTimeout(intentTimer);
});
</script>

<template>
  <section
    v-if="visible"
    ref="sectionRoot"
    class="op-sheet billing-section bl-section"
    aria-labelledby="order-billing-title"
  >
    <div
      v-if="isPhone"
      class="op-sheet-head"
      data-accordion
      :data-collapsed="!open || undefined"
    >
      <h2 class="op-sheet-title">
        <button
          type="button"
          class="op-sheet-toggle"
          :aria-expanded="open ? 'true' : 'false'"
          aria-controls="order-billing-body"
          :aria-disabled="toggleBlocked || undefined"
          :aria-describedby="
            toggleBlocked ? 'order-billing-toggle-reason' : undefined
          "
          @click="toggle"
        >
          <span class="op-sheet-toggle-text">
            <span id="order-billing-title" class="op-sheet-toggle-title"
              >Cobranças e recebimentos</span
            >
            <span v-if="billing" class="op-visually-hidden">, </span>
            <span v-if="billing" class="op-sheet-state"
              ><BillingBadge :badge="view.badge"
            /></span>
          </span>
          <OrderIcon name="chevron" class="op-sheet-chevron" />
        </button>
      </h2>
      <p
        v-if="toggleBlocked"
        id="order-billing-toggle-reason"
        class="op-visually-hidden"
      >
        Salve ou cancele a edição aberta.
      </p>
    </div>
    <div v-else class="op-sheet-head">
      <h2 id="order-billing-title" tabindex="-1">Cobranças e recebimentos</h2>
      <BillingBadge v-if="billing" class="bl-head-state" :badge="view.badge" />
    </div>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ liveMessage }}
    </p>
    <div id="order-billing-body" class="op-sheet-body bl-body" :hidden="!open">
      <p v-if="loading && !billing" role="status">Consultando cobranças…</p>
      <div v-if="error" class="op-alert bl-alert" role="alert">
        <p>{{ error }}</p>
        <button type="button" @click="load()">Atualizar cobranças</button>
      </div>
      <template v-if="billing">
        <div v-if="uncertain" class="bl-warn bl-uncertain" role="alert">
          <OrderIcon name="alert" />
          <div>
            <p>
              A última operação não teve resposta confirmada. Repetir envia
              exatamente o mesmo pedido, sem duplicar.
            </p>
            <button
              type="button"
              :aria-busy="busy === 'retry' ? 'true' : undefined"
              @click="retryUncertain"
            >
              Repetir a mesma operação
            </button>
          </div>
        </div>
        <BillingSituation :view="view" />
        <BillingNextStep
          :step="view.next"
          :status="status"
          @act="act"
          @pick="choose"
        />
        <BillingMovements :rows="view.rows" :sheet="isPhone" @act="rowAct" />
      </template>
    </div>
    <BillingSendDialog :ref="dialogs.send" @close="dialogClosed" />
    <BillingAmountDialog :ref="dialogs.amount" @close="dialogClosed" />
    <BillingCancelDialog :ref="dialogs.cancel" @close="dialogClosed" />
    <BillingExternalDialog :ref="dialogs.external" @close="dialogClosed" />
    <BillingVerifyDialog :ref="dialogs.verify" @close="dialogClosed" />
    <BillingReconcileDialog :ref="dialogs.reconcile" @close="dialogClosed" />
    <BillingRefundDialog :ref="dialogs.refund" @close="dialogClosed" />
    <BillingReverseDialog :ref="dialogs.reverse" @close="dialogClosed" />
    <BillingReceiptDialog :ref="dialogs.receipt" @close="dialogClosed" />
    <BillingConfirmDialog :ref="dialogs.confirm" @close="dialogClosed" />
  </section>
</template>
