<script setup>
/**
 * RFC 074 (LPC-02/LPC-09): the customer's payment page, outside the CRM.
 * Shows only the order number, the charge line and its amount; no session,
 * no shell, no customer data. Prototype: cobrancas-recebimentos.html,
 * scenario 12 "Página do cliente".
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import BrandMark from '../components/BrandMark.vue';
import { brand } from '../brand/index.js';
import {
  OPENING_LABEL,
  PAYMENT_NOTES,
  PUBLIC_PAYMENT_KINDS,
  callPaymentLink,
  formatPaymentAmount,
  isPublicPaymentToken,
  mergePaymentLink,
  paymentHeading,
  paymentStateView,
  waitForCheckout,
} from '../lib/public-payment.js';
import '../styles/screens/80-public-payment.css';

const props = defineProps({
  token: { type: String, default: '' },
});

/** @typedef {import('../lib/public-payment.js').PublicPaymentLink} PublicPaymentLink */

const link = shallowRef(/** @type {PublicPaymentLink|null} */ (null));
const loadFailed = ref(false);
const busy = ref('');
const note = ref('');
const heading = ref(/** @type {HTMLElement|null} */ (null));
const actionButton = ref(/** @type {HTMLButtonElement|null} */ (null));
const controller = new AbortController();

const title = computed(() => paymentHeading(link.value, brand.companyName));
const view = computed(() =>
  link.value
    ? paymentStateView(link.value, {
        companyName: brand.companyName,
        loadFailed: loadFailed.value,
      })
    : null,
);
const kindLabel = computed(() => {
  const kind = link.value?.kind;
  return kind ? (PUBLIC_PAYMENT_KINDS[kind] ?? '') : '';
});
const amount = computed(() =>
  link.value?.amountCents ? formatPaymentAmount(link.value.amountCents) : '',
);

// The page is reached only by the link sent to the customer: keep it out of
// search engines and never hand the token to the next site as a Referer.
const head = globalThis.document.head;
const previousTitle = globalThis.document.title;
const headMeta = [
  ['robots', 'noindex, nofollow'],
  ['referrer', 'no-referrer'],
].map(([name, content]) => {
  const meta = globalThis.document.createElement('meta');
  meta.name = name;
  meta.content = content;
  meta.dataset.publicPayment = '';
  head.append(meta);
  return meta;
});
globalThis.document.title = `Pagamento · ${brand.companyName}`;

/** @param {PageTransitionEvent} event */
function onPageShow(event) {
  // Back from the InfinitePay page (bfcache): read the link again.
  if (!event.persisted) return;
  busy.value = '';
  void load();
}
globalThis.addEventListener('pageshow', onPageShow);

onBeforeUnmount(() => {
  controller.abort();
  globalThis.removeEventListener('pageshow', onPageShow);
  for (const meta of headMeta) meta.remove();
  globalThis.document.title = previousTitle;
});

void load();

async function load() {
  const signal = controller.signal;
  if (!isPublicPaymentToken(props.token)) {
    link.value = { state: 'unavailable' };
    return;
  }
  try {
    link.value = await callPaymentLink(props.token, { signal });
    loadFailed.value = false;
    note.value = '';
  } catch (error) {
    if (signal.aborted) return;
    loadFailed.value = true;
    link.value = mergePaymentLink(link.value, { state: 'failed' });
    note.value = noteFor(error);
  }
}

/** @param {unknown} error */
function noteFor(error) {
  const code = /** @type {{code?: string}} */ (error)?.code;
  if (code === 'rate_limited') return PAYMENT_NOTES.rateLimited;
  if (code === 'network') return PAYMENT_NOTES.offline;
  return '';
}

/** @param {string} url */
function openCheckout(url) {
  busy.value = OPENING_LABEL;
  // The same tab: the customer comes back with the browser's Back button.
  globalThis.location.assign(url);
}

/**
 * One reading while waiting. Errors (429 included) go up to waitForCheckout,
 * which honours Retry-After and keeps polling within its budget.
 * @param {AbortSignal} [signal]
 */
function readWhileWaiting(signal) {
  return callPaymentLink(props.token, { signal });
}

async function act() {
  const action = view.value?.action;
  if (!action || busy.value || !link.value) return;
  if (action.kind === 'continue' && link.value.checkoutUrl) {
    openCheckout(link.value.checkoutUrl);
    return;
  }
  busy.value = action.kind === 'reload' ? 'Carregando…' : OPENING_LABEL;
  note.value = '';
  if (action.kind === 'reload') {
    await load();
  } else {
    const done = await requestCheckout(action.kind);
    if (done) return;
  }
  busy.value = '';
  await nextTick();
  (actionButton.value ?? heading.value)?.focus();
}

/**
 * POST once (idempotent on the server), then wait for the InfinitePay
 * address. Returns true when the page is leaving for the checkout.
 * @param {string} kind
 */
async function requestCheckout(kind) {
  const signal = controller.signal;
  try {
    let next = mergePaymentLink(
      link.value,
      await callPaymentLink(props.token, { checkout: true, signal }),
    );
    if (next.state === 'in_progress' && !next.checkoutUrl) {
      next = mergePaymentLink(
        next,
        await waitForCheckout(readWhileWaiting, { signal }),
      );
    }
    link.value = next;
    loadFailed.value = false;
    if (next.state === 'in_progress' && next.checkoutUrl) {
      openCheckout(next.checkoutUrl);
      return true;
    }
    if (next.timedOut) note.value = PAYMENT_NOTES.timedOut;
    else if (next.state === 'failed' && kind === 'retry')
      note.value = PAYMENT_NOTES.stillFailed;
  } catch (error) {
    if (signal.aborted) return true;
    note.value = noteFor(error);
    if (note.value !== PAYMENT_NOTES.rateLimited)
      link.value = mergePaymentLink(link.value, { state: 'failed' });
  }
  return false;
}
</script>

<template>
  <main class="cp" aria-labelledby="cp-title">
    <header class="cp-head">
      <span class="cp-monogram" aria-hidden="true">
        <BrandMark variant="monogram" />
      </span>
      <h1 id="cp-title" ref="heading" tabindex="-1">{{ title }}</h1>
    </header>

    <p v-if="!view" class="cp-loading" role="status">Carregando o pagamento…</p>
    <section
      v-else
      class="cp-card"
      :aria-labelledby="kindLabel ? 'cp-kind' : undefined"
      :data-state="link?.state"
    >
      <div v-if="kindLabel || amount" class="cp-figure">
        <p v-if="kindLabel" id="cp-kind" class="cp-kind">{{ kindLabel }}</p>
        <p v-if="amount" class="cp-amount">{{ amount }}</p>
      </div>
      <div class="cp-state">
        <span
          class="badge cp-badge"
          :data-tone="view.tone === 'neutral' ? undefined : view.tone"
        >
          <AppIcon :name="view.icon" />{{ view.label }}
        </span>
        <p class="cp-msg">
          <strong v-if="view.strong">{{ view.strong }}</strong>
          {{ view.text }}
        </p>
      </div>
      <button
        v-if="view.action"
        ref="actionButton"
        type="button"
        class="primary cp-button"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-busy="busy ? 'true' : undefined"
        @click="act"
      >
        {{ busy || view.action.label }}
      </button>
      <p class="cp-live" role="status">{{ note }}</p>
    </section>

    <p class="cp-foot">
      O pagamento é feito na InfinitePay, com Pix ou cartão. Dúvidas sobre o
      pedido? Fale com a {{ brand.companyName }} pelo WhatsApp.
    </p>
  </main>
</template>
