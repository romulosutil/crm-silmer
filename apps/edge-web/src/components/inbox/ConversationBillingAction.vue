<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { request } from '../../lib/api-client.js';
import { CHANNEL_LABELS, dayMonthBR } from '../../lib/format.js';
import {
  billingError,
  billingMoney,
  billingReason,
} from '../../lib/order-billing.js';
import {
  KIND,
  TERMS,
  deriveBillingView,
  messageText,
  nextCharge,
  sendProgress,
  sendSteps,
  termsPicker,
  valueSub,
} from '../../lib/order-billing-view.js';
import {
  billingIntent,
  copyText,
  focusInDialog,
  uncertainFailure,
} from '../../lib/order-billing-command.js';
import AppIcon from '../AppIcon.vue';
import JourneyDialog from '../JourneyDialog.vue';
import OrderIcon from '../order/OrderIcon.vue';
import BillingCancelBody from '../order/billing/BillingCancelBody.vue';
import BillingNextStep from '../order/billing/BillingNextStep.vue';
import BillingSendReview from '../order/billing/BillingSendReview.vue';
import BillingSendSteps from '../order/billing/BillingSendSteps.vue';
import BillingSituation from '../order/billing/BillingSituation.vue';
import BillingTermsPicker from '../order/billing/BillingTermsPicker.vue';

/*
 * RFC 074 (LPC-09), Inbox: ONE journey dialog "Cobranças e recebimentos" for
 * the order of the conversation — compact Situação, the Próximo passo
 * sentence without its actions, and the actions in the footer. Sending goes
 * through "Revisar envio" and follows the send intent until "Entregue";
 * "Cancelar link" and its race refusal stay in the same dialog. Everything
 * else lives on the order page ("Ver tudo no pedido").
 *
 * The numbers, badge and next step come from lib/order-billing-view.js, the
 * same derivation as the order section. Only the owner of the order or an
 * administrator operates (`billing.canOperate`); anyone else reads a locked
 * panel. Writes carry the versions and a frozen Idempotency-Key; an uncertain
 * answer is repeated as the very same request (billingIntent). Only the CRM
 * link actions are sent (`issue_link`, `send_link`).
 */
const props = defineProps({
  conversationId: { type: String, required: true },
  conversationVersion: { type: Number, required: true },
  /** Contact name, e.g. "Escola Aurora". */
  destinationLabel: { type: String, default: '' },
  /** Conversation channel (`whatsapp`, `instagram`, …). */
  channel: { type: String, default: '' },
  /** The conversation's owner when it is not the signed-in person; '' otherwise. */
  ownerName: { type: String, default: '' },
  subjects: { type: Array, default: () => [] },
  linkedOrder: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
  revision: { type: Number, default: 0 },
});
const emit = defineEmits(['sent']);

/** Footer actions the Inbox carries; the others live on the order page. */
const INBOX_ACTS = ['copy-link', 'copy-message', 'cancel-link'];
const SEND_ACTS = ['send', 'send-existing'];

const router = useRouter();
const dlg = ref(/** @type {any} */ (null));
/** @type {import('vue').Ref<Array<{id: string, number: string, title: string, name: string, confirmedAt: string|null, order: any}>>} */
const candidates = ref([]);
const listing = ref(false);
const listError = ref('');
const orderId = ref('');
/** @type {import('vue').Ref<any>} */
const billing = ref(null);
const loading = ref(false);
const error = ref('');
/** @type {import('vue').Ref<'overview'|'review'|'result'|'cancel'>} */
const screen = ref('overview');
const switching = ref(false);
const pick = ref(/** @type {50|100} */ (50));
/** @type {import('vue').Ref<any>} */
const plan = ref(null);
/** @type {import('vue').Ref<any>} */
const sending = ref(null);
/** @type {import('vue').Ref<any>} */
const cancelTarget = ref(null);
/** @type {import('vue').Ref<any>} */
const cancelFigures = ref(null);
/** @type {import('vue').Ref<any>} */
const refusal = ref(null);
const busy = ref('');
const problem = ref('');
/** @type {import('vue').Ref<{text: string, tone: string}|null>} */
const status = ref(null);
/** @type {import('vue').Ref<any>} */
const uncertain = ref(null);
let readController = /** @type {AbortController|null} */ (null);
let listController = /** @type {AbortController|null} */ (null);
let pollTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (
  undefined
);
let intentTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (
  undefined
);
let announced = '';
let disposed = false;

/** @param {string} id */
const base = (id) => `/api/v1/orders/${encodeURIComponent(id)}/billing`;
const current = computed(
  () => candidates.value.find((c) => c.id === orderId.value) ?? null,
);
const orderNumber = computed(() => current.value?.number ?? '');
const destination = computed(
  () =>
    `${props.destinationLabel || 'Cliente'} (${
      CHANNEL_LABELS[
        /** @type {keyof typeof CHANNEL_LABELS} */ (props.channel)
      ] ?? 'conversa'
    })`,
);
const conv = computed(() =>
  Boolean(
    billing.value?.chatSendEnabled &&
    current.value?.order?.status === 'confirmado',
  ),
);
const readOnly = computed(() => {
  if (
    current.value?.order?.cancelledAt ||
    billing.value?.blockedReason === 'ORDER_CANCELLED'
  )
    return billingReason('ORDER_CANCELLED');
  if (billing.value && billing.value.enabled === false)
    return billingReason('BILLING_DISABLED');
  if (uncertain.value)
    return 'A última operação não teve resposta confirmada. Repita a mesma operação antes de iniciar outra.';
  return '';
});
const view = computed(() =>
  deriveBillingView(billing.value ?? {}, {
    conv: conv.value,
    pick: pick.value,
    busy: busy.value,
    orderNumber: orderNumber.value,
    destination: destination.value,
    readOnly: readOnly.value,
    // Its footer carries only copy/cancel: no "outro link" slot here.
    inbox: true,
    cancelled: Boolean(
      current.value?.order?.cancelledAt ||
      billing.value?.blockedReason === 'ORDER_CANCELLED',
    ),
  }),
);
const locked = computed(() => Boolean(billing.value) && !view.value.canOperate);
/** No condition and nothing charged yet: the condition is asked here once. */
const choosing = computed(
  () =>
    Boolean(billing.value) &&
    view.value.canOperate &&
    !readOnly.value &&
    conv.value &&
    view.value.condition === null &&
    !view.value.links.length &&
    !view.value.receipts.length &&
    view.value.figures.received === 0,
);
const pickCharge = computed(() => nextCharge(view.value, pick.value));
const pickTerms = computed(() =>
  termsPicker(view.value.figures, [50, 100], pick.value),
);
const step = computed(() =>
  choosing.value
    ? {
        tone: 'normal',
        title: 'Próximo passo',
        body: [
          {
            parts: ['Escolha a condição combinada para enviar o link.'],
            tone: '',
          },
        ],
        primary: null,
        secondary: [],
        after: [],
        quiet: null,
        lock: '',
        terms: null,
        sending: null,
      }
    : view.value.next,
);
/** The footer of the overview: the copy/cancel secondaries and one primary. */
const footer = computed(() => {
  if (choosing.value)
    return {
      secondary: [],
      primary: {
        label: `Enviar link de ${billingMoney(pickCharge.value.amountCents)} na conversa`,
        act: 'send',
        icon: '',
      },
    };
  const next = step.value;
  if (next.lock)
    return {
      secondary: [],
      primary: uncertain.value
        ? { label: 'Repetir a mesma operação', act: 'retry', icon: '' }
        : null,
    };
  const p = /** @type {any} */ (next.primary);
  return {
    secondary: next.secondary.filter((/** @type {any} */ a) =>
      INBOX_ACTS.includes(a.act),
    ),
    primary:
      p &&
      !p.disabled &&
      !p.busy &&
      (SEND_ACTS.includes(p.act) || INBOX_ACTS.includes(p.act))
        ? p
        : null,
  };
});
const resultLink = computed(() =>
  sending.value
    ? (view.value.links.find((l) => l.id === sending.value.linkId) ?? null)
    : null,
);
const resultKind = computed(
  () =>
    KIND[/** @type {keyof typeof KIND} */ (sending.value?.kind ?? 'part')] ??
    KIND.part,
);
const liveStep = computed(() => {
  const s = sending.value;
  if (!s || s.failed) return '';
  if (s.done) return 'Entregue.';
  const name = s.steps[s.index] ?? '';
  return s.finished ? `${name}.` : name;
});
const canCancelResult = computed(
  () =>
    Boolean(sending.value?.finished) && resultLink.value?.status === 'waiting',
);
const planCondition = computed(() =>
  plan.value?.fromPick
    ? TERMS[/** @type {0|50|100} */ (plan.value.condition)]
    : null,
);

/** "Pedido 07-CRM · Jogos 2026 · confirmado em 22/11". @param {any} c */
function optionLabel(c) {
  return [
    `Pedido ${c.number}`,
    c.name,
    c.confirmedAt ? `confirmado em ${dayMonthBR(c.confirmedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Confirmed orders of this conversation: the linked one first. */
const targets = computed(() => {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @param {unknown} id @param {unknown} state */
  const add = (id, state) => {
    if (typeof id !== 'string' || !id || ids.has(id)) return;
    if (state && state !== 'confirmado') return;
    ids.add(id);
  };
  add(props.linkedOrder?.id, props.linkedOrder?.status);
  const subjects = [.../** @type {any[]} */ (props.subjects)].sort(
    (a, b) => Number(Boolean(b.isCurrent)) - Number(Boolean(a.isCurrent)),
  );
  for (const subject of subjects) add(subject.orderId, subject.orderStatus);
  return [...ids];
});

const LIST_ERROR =
  'Não foi possível carregar os pedidos desta conversa. Feche e abra de novo para tentar.';
async function loadCandidates() {
  listController?.abort();
  const own = new AbortController();
  listController = own;
  listing.value = true;
  listError.value = '';
  try {
    const orders = await Promise.all(
      targets.value.map(async (id) => {
        try {
          const response = await request(
            `/api/v1/orders/${encodeURIComponent(id)}`,
            { signal: own.signal },
          );
          return response.data?.order ?? null;
        } catch (cause) {
          if (own.signal.aborted) throw cause;
          return null;
        }
      }),
    );
    if (own.signal.aborted) return;
    candidates.value = orders
      .filter(
        (order) =>
          order && order.status === 'confirmado' && order.origin !== 'loja',
      )
      .map((order) => {
        const summary = order.ficha?.summary ?? {};
        return {
          id: String(order.id),
          number: String(order.number ?? ''),
          title: [summary.cliente, summary.nome].filter(Boolean).join(' — '),
          name: String(summary.nome ?? ''),
          confirmedAt: order.confirmedAt ?? null,
          order,
        };
      });
    if (!candidates.value.length && orders.includes(null))
      listError.value = LIST_ERROR;
    if (candidates.value.some((c) => c.id === orderId.value))
      void loadBilling(Boolean(billing.value));
    else orderId.value = candidates.value[0]?.id ?? '';
  } catch {
    if (!own.signal.aborted) listError.value = LIST_ERROR;
  } finally {
    if (own === listController) listing.value = false;
  }
}

/** @param {boolean} [silent] */
async function loadBilling(silent = false) {
  readController?.abort();
  globalThis.clearTimeout(pollTimer);
  const id = orderId.value;
  if (!id) return;
  const own = new AbortController();
  readController = own;
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const response = await request(base(id), { signal: own.signal });
    if (own.signal.aborted || orderId.value !== id) return;
    billing.value = response.data?.billing ?? null;
    error.value = '';
  } catch {
    if (own.signal.aborted) return;
    error.value = billing.value
      ? 'Não foi possível consultar as cobranças. Os valores anteriores foram preservados.'
      : 'Não foi possível consultar as cobranças.';
  } finally {
    if (own === readController) {
      loading.value = false;
      schedule();
    }
  }
}
/** Open links change without the seller: read again while any is open. */
function schedule() {
  globalThis.clearTimeout(pollTimer);
  if (disposed || !billing.value || !dlg.value?.element?.open) return;
  if (!view.value.groups.open.length) return;
  pollTimer = globalThis.setTimeout(() => {
    if (
      globalThis.document?.visibilityState === 'visible' &&
      screen.value === 'overview' &&
      !busy.value
    )
      void loadBilling(true);
    else schedule();
  }, 10000);
}

function versions() {
  return {
    expectedVersion:
      billing.value?.orderVersion ?? current.value?.order?.version ?? 0,
    expectedBillingVersion: billing.value?.version ?? 0,
  };
}
/** @param {{path: string, body: Record<string, unknown>, key: string}} record */
async function run(record) {
  let response;
  try {
    response = await request(`${base(orderId.value)}/${record.path}`, {
      method: 'POST',
      body: record.body,
      idempotencyKey: record.key,
    });
  } catch (cause) {
    if (uncertainFailure(cause)) uncertain.value = record;
    else if (uncertain.value?.key === record.key) uncertain.value = null;
    if (Number(/** @type {any} */ (cause)?.status) === 409)
      await loadBilling(true);
    throw cause;
  }
  if (uncertain.value?.key === record.key) uncertain.value = null;
  if (response.data?.billing) billing.value = response.data.billing;
  else await loadBilling(true);
  return response;
}
const sendIntent = billingIntent(run);
const cancelIntent = billingIntent(run);

/** Status line of the overview, filled one frame later so it is announced. @param {string} text @param {string} [tone] */
async function say(text, tone = 'success') {
  status.value = null;
  await nextTick();
  const frame =
    globalThis.requestAnimationFrame ??
    ((/** @type {() => void} */ fn) => globalThis.setTimeout(fn));
  frame(() => {
    status.value = { text, tone };
  });
}

/** Moves to a screen and puts the focus on its name. @param {'overview'|'review'|'result'|'cancel'} next */
async function go(next) {
  screen.value = next;
  if (next !== 'overview') status.value = null;
  await nextTick();
  const element = dlg.value?.element;
  if (next === 'overview') focusInDialog(element);
  else
    /** @type {HTMLElement|null} */ (
      element?.querySelector('[data-billing-step]')
    )?.focus();
}
async function focusProblem() {
  await nextTick();
  /** @type {HTMLElement|null} */ (
    dlg.value?.element?.querySelector('.bl-warn[tabindex]')
  )?.focus();
}

/** @param {string} id */
const linkById = (id) => view.value.links.find((l) => l.id === id) ?? null;

/** Footer actions. @param {any} action */
async function act(action) {
  const link = action.id ? linkById(action.id) : null;
  switch (action.act) {
    case 'send':
      plan.value = { ...nextCharge(view.value, pick.value) };
      problem.value = '';
      return go('review');
    case 'send-existing':
      if (!link) return;
      plan.value = {
        kind: link.kind,
        amountCents: link.amountCents,
        linkId: link.id,
        url: link.url,
        fromPick: false,
      };
      problem.value = '';
      return go('review');
    case 'copy-link':
    case 'copy-message': {
      const target = link ?? view.value.groups.waiting[0];
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
      return say(
        copied
          ? action.act === 'copy-link'
            ? 'Link copiado.'
            : 'Mensagem copiada.'
          : 'Não foi possível copiar. Selecione o texto e copie pelo menu do aparelho.',
        copied ? 'success' : 'error',
      );
    }
    case 'cancel-link':
      if (link) return openCancel(link);
      return;
    case 'retry':
      problem.value = '';
      if (uncertain.value?.path === 'send-intents' && plan.value)
        return go('review');
      if (cancelTarget.value) return go('cancel');
      return;
  }
}

/** @param {any} link */
function openCancel(link) {
  if (!link) return;
  cancelTarget.value = link;
  cancelFigures.value = view.value.figures;
  refusal.value = null;
  problem.value = '';
  if (!uncertain.value) cancelIntent.reset();
  return go('cancel');
}

async function confirmSend() {
  if (busy.value || !plan.value) return;
  busy.value = 'send';
  problem.value = '';
  const p = plan.value;
  try {
    const response = await sendIntent.send(() => ({
      path: 'send-intents',
      body: {
        ...versions(),
        action: p.linkId ? 'send_link' : 'issue_link',
        conversationId: props.conversationId,
        expectedConversationVersion: props.conversationVersion,
        ...(p.linkId
          ? { linkId: p.linkId }
          : {
              amountCents: p.amountCents,
              ...(p.fromPick ? { percent: p.condition } : {}),
            }),
      },
    }));
    busy.value = '';
    const intent = response.data ?? {};
    const steps = sendSteps('send', Boolean(p.linkId));
    sending.value = {
      orderId: orderId.value,
      kind: p.kind,
      amountCents: p.amountCents,
      linkId: p.linkId ?? intent.linkId ?? null,
      steps,
      index: sendProgress(steps, intent.state).index,
      intentId: intent.id,
      done: false,
      finished: false,
      failed: '',
    };
    announced = '';
    await go('result');
    followIntent(intent.id, intent.state, 0);
  } catch (cause) {
    busy.value = '';
    problem.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o envio. Os valores ficam preservados: Enviar de novo repete o mesmo pedido, sem duplicar o link.'
      : billingError(cause);
    await focusProblem();
  }
}

/** The thread shows the outgoing message once the transport sent it. @param {string} id */
function notifySent(id) {
  if (announced === id) return;
  announced = id;
  emit('sent');
}

/**
 * Follows a send intent until "Entregue", a failure, or a quiet "Enviado".
 * @param {string} id @param {string} state @param {number} polls
 */
function followIntent(id, state, polls) {
  const cur = sending.value;
  if (!cur || cur.intentId !== id || disposed) return;
  const progress = sendProgress(cur.steps, state);
  if (progress.failed) {
    sending.value = { ...cur, finished: true, failed: progress.failed };
    problem.value =
      progress.failed === 'blocked'
        ? 'O envio foi bloqueado pela conversa. O cliente não recebeu a mensagem; o link pode ser cancelado ou enviado de novo.'
        : 'Não foi possível confirmar o envio na conversa. Confira a conversa antes de enviar de novo.';
    void loadBilling(true);
    void focusProblem();
    return;
  }
  if (progress.done || (state === 'sent' && polls >= 20) || polls >= 90) {
    void finishSend(cur, progress.done);
    return;
  }
  if (progress.index !== cur.index) {
    sending.value = { ...cur, index: progress.index };
    if (state === 'sent') {
      void loadBilling(true);
      notifySent(id);
    }
  }
  intentTimer = globalThis.setTimeout(async () => {
    try {
      const response = await request(
        `${base(cur.orderId)}/send-intents/${encodeURIComponent(id)}`,
      );
      followIntent(id, response.data?.state ?? state, polls + 1);
    } catch {
      followIntent(id, state, polls + 1);
    }
  }, 1000);
}
/** @param {any} cur @param {boolean} delivered */
async function finishSend(cur, delivered) {
  await loadBilling(true);
  if (sending.value?.intentId !== cur.intentId) return;
  sending.value = {
    ...sending.value,
    index: delivered ? cur.steps.length - 1 : sending.value.index,
    done: delivered,
    finished: true,
  };
  notifySent(cur.intentId);
}

async function confirmCancel() {
  const target = cancelTarget.value;
  if (busy.value || refusal.value || !target) return;
  busy.value = 'cancel';
  problem.value = '';
  try {
    await cancelIntent.send(() => ({
      path: `links/${encodeURIComponent(target.id)}/cancel`,
      body: { ...versions() },
    }));
    busy.value = '';
    sending.value = null;
    await go('overview');
    void say(
      `Link de ${billingMoney(target.amountCents)} cancelado. Quem abrir o link verá que ele foi cancelado.`,
    );
  } catch (cause) {
    busy.value = '';
    const answer = /** @type {any} */ (cause)?.problem ?? {};
    if (/** @type {any} */ (cause)?.code === 'BILLING_LINK_NOT_OPEN') {
      // run() already read the view again on a 409.
      const fresh = linkById(target.id);
      const state = String(answer.state ?? fresh?.state ?? '');
      refusal.value = {
        state: state === 'cancelled' || state === 'paid' ? state : 'paying',
        clickedAt: answer.clickedAt ?? fresh?.clickedAt ?? null,
        providerValidUntil: fresh?.providerValidUntil ?? null,
      };
      if (fresh) cancelTarget.value = fresh;
      await nextTick();
      /** @type {HTMLElement|null} */ (
        dlg.value?.element?.querySelector('#inbox-billing-cancel-refusal')
      )?.focus();
      return;
    }
    problem.value = uncertainFailure(cause)
      ? 'Não foi possível confirmar o cancelamento. Cancelar de novo repete o mesmo pedido.'
      : billingError(cause);
    await focusProblem();
  }
}

/**
 * Once the order page has announced its heading, the focus moves to the
 * billing chapter's title (its toggle on a phone).
 */
function focusBillingOnArrival() {
  const doc = globalThis.document;
  if (!doc) return;
  const frame =
    globalThis.requestAnimationFrame ??
    ((/** @type {() => void} */ fn) => globalThis.setTimeout(fn, 16));
  const deadline = Date.now() + 10000;
  const tick = () => {
    if (Date.now() > deadline) return;
    const chapter = doc.querySelector('section.billing-section');
    if (chapter && doc.activeElement?.tagName === 'H1') {
      const target = /** @type {HTMLElement|null} */ (
        chapter.querySelector('.op-sheet-toggle') ??
          chapter.querySelector('#order-billing-title')
      );
      if (target) {
        target.scrollIntoView?.({ block: 'start' });
        target.focus({ preventScroll: true });
        return;
      }
    }
    frame(tick);
  };
  frame(tick);
}
/** "Ver tudo no pedido": closes and opens the order on its billing chapter. */
async function toOrder() {
  const id = orderId.value;
  if (!id) return;
  dlg.value?.close();
  focusBillingOnArrival();
  await router.push(
    `/pedidos/${encodeURIComponent(id)}?conversa=${encodeURIComponent(props.conversationId)}#cobrancas`,
  );
}

/** @param {MouseEvent} event */
async function open(event) {
  if (props.disabled) return;
  screen.value = 'overview';
  switching.value = false;
  status.value = null;
  problem.value = '';
  dlg.value?.open(/** @type {HTMLElement} */ (event.currentTarget));
  await nextTick();
  focusInDialog(dlg.value?.element);
  await loadCandidates();
}
function closed() {
  globalThis.clearTimeout(pollTimer);
  globalThis.clearTimeout(intentTimer);
  listController?.abort();
  sending.value = null;
  screen.value = 'overview';
  switching.value = false;
  status.value = null;
  problem.value = '';
  busy.value = '';
}

/** @param {string} id */
function chooseOrder(id) {
  orderId.value = id;
}

watch(orderId, (id, previous) => {
  if (id === previous) return;
  billing.value = null;
  error.value = '';
  uncertain.value = null;
  plan.value = null;
  cancelTarget.value = null;
  status.value = null;
  pick.value = 50;
  sendIntent.reset();
  cancelIntent.reset();
  if (id) void loadBilling();
});
watch(
  () => props.revision,
  () => {
    if (orderId.value && dlg.value?.element?.open) void loadBilling(true);
  },
);
watch(
  () => props.conversationId,
  () => {
    dlg.value?.close();
    candidates.value = [];
    orderId.value = '';
  },
);
watch(
  () => props.disabled,
  (value) => {
    if (value) dlg.value?.close();
  },
);
onBeforeUnmount(() => {
  disposed = true;
  readController?.abort();
  listController?.abort();
  globalThis.clearTimeout(pollTimer);
  globalThis.clearTimeout(intentTimer);
  dlg.value?.close();
});
</script>

<template>
  <div class="conversation-billing-action">
    <button
      type="button"
      class="quiet"
      title="Cobranças e recebimentos"
      aria-label="Cobranças e recebimentos"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="open"
    >
      <AppIcon name="credit-card" /><span class="composer-label"
        >Cobranças e recebimentos</span
      >
    </button>
    <Teleport to="body">
      <JourneyDialog
        ref="dlg"
        class="bl-dialog inbox-billing-dialog"
        title="Cobranças e recebimentos"
        close-label="Fechar cobranças e recebimentos"
        @close="closed"
      >
        <!-- Overview: the order, Situação and Próximo passo. -->
        <template v-if="screen === 'overview'">
          <p v-if="listing && !candidates.length" role="status">
            Carregando os pedidos desta conversa…
          </p>
          <p v-else-if="listError" class="bl-warn" role="alert">
            <OrderIcon name="alert" /><span>{{ listError }}</span>
          </p>
          <p v-else-if="!candidates.length" role="status">
            Vincule um pedido confirmado a um assunto deste atendimento para
            consultar as cobranças.
          </p>
          <template v-else-if="current">
            <div v-if="locked" class="inbox-billing-locked">
              <OrderIcon name="lock" />
              <p>
                <strong>{{
                  ownerName
                    ? `Esta conversa é de ${ownerName}.`
                    : view.next.lock
                }}</strong>
              </p>
              <p>
                {{
                  ownerName
                    ? 'Outro vendedor vê só as próprias conversas e as sem responsável. As cobranças deste pedido continuam visíveis em leitura na página do pedido.'
                    : 'As cobranças deste pedido continuam visíveis em leitura na página do pedido.'
                }}
              </p>
              <button
                type="button"
                class="link-button bl-link-target"
                @click="toOrder"
              >
                Abrir o pedido {{ current.number }}
              </button>
            </div>
            <template v-else>
              <div class="inbox-billing-order">
                <p>
                  Pedido
                  <strong
                    >{{ current.number
                    }}<template v-if="current.title">
                      · {{ current.title }}</template
                    ></strong
                  >
                </p>
                <button
                  v-if="candidates.length > 1"
                  type="button"
                  class="link-button bl-link-target"
                  :aria-expanded="switching ? 'true' : 'false'"
                  aria-controls="inbox-billing-orders"
                  @click="switching = !switching"
                >
                  Trocar pedido
                </button>
              </div>
              <fieldset
                v-if="candidates.length > 1"
                v-show="switching"
                id="inbox-billing-orders"
                class="inbox-billing-orders"
              >
                <legend>Pedidos confirmados desta conversa</legend>
                <label
                  v-for="candidate in candidates"
                  :key="candidate.id"
                  class="inbox-billing-option"
                  ><input
                    type="radio"
                    name="inbox-billing-order"
                    :value="candidate.id"
                    :checked="candidate.id === orderId"
                    @change="chooseOrder(candidate.id)"
                  />{{ optionLabel(candidate) }}</label
                >
              </fieldset>
              <p v-if="loading && !billing" role="status">
                Consultando cobranças…
              </p>
              <div
                v-if="error"
                class="bl-warn inbox-billing-error"
                role="alert"
              >
                <OrderIcon name="alert" />
                <div>
                  <p>{{ error }}</p>
                  <button type="button" @click="loadBilling()">
                    Atualizar cobranças
                  </button>
                </div>
              </div>
              <template v-if="billing">
                <BillingSituation
                  :view="view"
                  compact
                  heading-id="inbox-billing-situation"
                />
                <BillingNextStep
                  :step="step"
                  title-id="inbox-billing-next-title"
                  no-actions
                  status-id=""
                >
                  <template v-if="choosing">
                    <BillingTermsPicker
                      :terms="pickTerms"
                      name="inbox-billing-terms"
                      @pick="pick = $event"
                    />
                    <p class="op-hint">
                      Sem entrada?
                      <button
                        type="button"
                        class="link-button bl-link-target"
                        @click="toOrder"
                      >
                        Defina no pedido.
                      </button>
                    </p>
                  </template>
                </BillingNextStep>
                <p
                  id="inbox-billing-status"
                  class="bl-next-status"
                  role="status"
                  :data-tone="status?.tone || undefined"
                >
                  <template v-if="status"
                    ><OrderIcon
                      :name="status.tone === 'error' ? 'alert' : 'check'"
                    /><span>{{ status.text }}</span></template
                  >
                </p>
              </template>
            </template>
          </template>
        </template>

        <!-- Revisar envio: what leaves, to whom and the message. -->
        <template v-else-if="screen === 'review' && plan">
          <p class="bl-step" tabindex="-1" data-billing-step>
            Revisar envio · Pedido {{ orderNumber }}
          </p>
          <p v-if="problem" class="bl-warn" role="alert" tabindex="-1">
            <OrderIcon name="alert" /><span>{{ problem }}</span>
          </p>
          <BillingSendReview
            :order-number="orderNumber"
            :order-title="current?.title ?? ''"
            :destination="destination"
            :kind="plan.kind"
            :amount-cents="plan.amountCents"
            :value-sub="valueSub(plan.kind, view.figures)"
            :condition="planCondition"
            :url="plan.url || ''"
            :existing="Boolean(plan.linkId)"
          />
        </template>

        <!-- Envio na conversa: the transport's progress. -->
        <template v-else-if="screen === 'result' && sending">
          <p class="bl-step" tabindex="-1" data-billing-step>
            Envio na conversa · Pedido {{ orderNumber }}
          </p>
          <p v-if="problem" class="bl-warn" role="alert" tabindex="-1">
            <OrderIcon name="alert" /><span>{{ problem }}</span>
          </p>
          <BillingSendSteps
            :steps="sending.steps"
            :index="sending.index"
            :done="sending.done"
          />
          <p class="sr-only" role="status">{{ liveStep }}</p>
          <p>
            Link {{ resultKind.of }} de
            <strong>{{ billingMoney(sending.amountCents) }}</strong> para
            {{ destination }}.
          </p>
          <p class="bl-note">
            <OrderIcon name="info" /><span
              >Enviar não confirma o pagamento. Você pode cancelar o link
              enquanto o cliente não clicar em Pagar. Quando a InfinitePay
              confirmar, {{ resultKind.art }} {{ resultKind.noun }} aparece como
              Recebido no pedido.</span
            >
          </p>
        </template>

        <!-- Cancelar link, with the race refusal in place. -->
        <template v-else-if="screen === 'cancel' && cancelTarget">
          <p class="bl-step" tabindex="-1" data-billing-step>
            Cancelar link · Pedido {{ orderNumber }}
          </p>
          <p v-if="problem" class="bl-warn" role="alert" tabindex="-1">
            <OrderIcon name="alert" /><span>{{ problem }}</span>
          </p>
          <BillingCancelBody
            :link="cancelTarget"
            :figures="cancelFigures ?? view.figures"
            :refusal="refusal"
            refusal-id="inbox-billing-cancel-refusal"
          />
        </template>

        <template #footer>
          <template v-if="screen === 'review'">
            <button type="button" @click="go('overview')">Voltar</button>
            <button
              type="button"
              class="primary"
              :aria-disabled="busy ? 'true' : undefined"
              :aria-busy="busy === 'send' ? 'true' : undefined"
              @click="confirmSend"
            >
              {{
                busy === 'send'
                  ? 'Enviando…'
                  : `Enviar link de ${billingMoney(plan?.amountCents ?? 0)}`
              }}
            </button>
          </template>
          <template v-else-if="screen === 'result'">
            <button
              type="button"
              class="link-button bl-link-target inbox-billing-foot-start"
              @click="toOrder"
            >
              Ver tudo no pedido
            </button>
            <button
              v-if="canCancelResult"
              type="button"
              @click="openCancel(resultLink)"
            >
              Cancelar link
            </button>
            <button type="button" @click="dlg?.close()">Fechar</button>
          </template>
          <template v-else-if="screen === 'cancel'">
            <template v-if="refusal">
              <button
                type="button"
                class="link-button bl-link-target inbox-billing-foot-start"
                @click="toOrder"
              >
                Ver tudo no pedido
              </button>
              <button type="button" @click="go('overview')">Voltar</button>
            </template>
            <template v-else>
              <button type="button" @click="go('overview')">Voltar</button>
              <button
                type="button"
                class="primary"
                :aria-disabled="busy ? 'true' : undefined"
                :aria-busy="busy === 'cancel' ? 'true' : undefined"
                @click="confirmCancel"
              >
                {{ busy === 'cancel' ? 'Cancelando…' : 'Cancelar link' }}
              </button>
            </template>
          </template>
          <template v-else>
            <button
              v-if="current && billing && !locked"
              type="button"
              class="link-button bl-link-target inbox-billing-foot-start"
              @click="toOrder"
            >
              Ver tudo no pedido
            </button>
            <template v-if="billing && !locked">
              <button
                v-for="action in footer.secondary"
                :key="action.act"
                type="button"
                @click="act(action)"
              >
                <OrderIcon v-if="action.icon" :name="action.icon" />{{
                  action.label
                }}
              </button>
            </template>
            <button
              v-if="billing && !locked && footer.primary"
              type="button"
              class="primary"
              @click="act(footer.primary)"
            >
              <OrderIcon
                v-if="footer.primary.icon"
                :name="footer.primary.icon"
              />{{ footer.primary.label }}
            </button>
            <button v-else type="button" @click="dlg?.close()">Fechar</button>
          </template>
        </template>
      </JourneyDialog>
    </Teleport>
  </div>
</template>

<style scoped>
.conversation-billing-action {
  display: contents;
}
</style>
