<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import BrandMark from '../BrandMark.vue';
import { brand } from '../../brand/index.js';
import { downloadPdf } from '../../lib/order-pdf.js';
import {
  getOrderReceipt,
  getOrderReceiptPdf,
  receiptFilename,
} from '../../lib/order-receipt.js';
import { amountLabel } from '../../lib/order-format.js';

const props = defineProps({
  orders: { type: Array, default: () => [] },
  fallbackFocus: { type: Function, default: () => null },
});
const liveEvent = inject('liveEvent', ref(null));
/** @type {import('vue').Ref<HTMLDialogElement|null>} */
const dialog = ref(null);
/** @type {import('vue').Ref<HTMLButtonElement|null>} */
const closeButton = ref(null);
/** @type {import('vue').Ref<import('../../lib/order-receipt.js').OrderReceipt|null>} */
const receipt = ref(null);
/** @type {import('vue').Ref<{id:string,number:string,version:number}|null>} */
const target = ref(null);
const shown = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const stale = ref(false);
const denied = ref(false);
const pdfFailed = ref(false);
const notice = ref('');
let fingerprint = '';
let generation = 0;
let disposed = false;
/** @type {AbortController|undefined} */
let controller;
/** @type {HTMLElement|null} */
let opener = null;
/** @type {Array<{element:HTMLElement,left:number,top:number}>} */
let scrollPositions = [];
let pagePosition = { left: 0, top: 0 };

const title = computed(() => `Recibo do pedido ${target.value?.number ?? ''}`);
const stateText = computed(() => {
  if (receipt.value?.status === 'cancelado')
    return 'Pedido cancelado · documento histórico.';
  if (receipt.value?.status === 'pendente')
    return 'Pedido pendente · resumo provisório, sujeito a alterações.';
  return 'Pedido confirmado';
});

/** @param {string|null} value */
function dateLabel(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? value.split('-').reverse().join('/')
    : 'Não informado';
}
const issuedOn = computed(() => {
  if (!receipt.value?.issuedAt) return 'Não informado';
  const instant = new Date(receipt.value.issuedAt);
  return Number.isNaN(instant.getTime())
    ? 'Não informado'
    : new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
      }).format(instant);
});
/** @param {number|null} value */
const money = (value) => (value === null ? 'A definir' : amountLabel(value));

function abort() {
  generation += 1;
  controller?.abort();
  controller = undefined;
  loading.value = false;
  busy.value = false;
}
function clearDocument() {
  receipt.value = null;
  fingerprint = '';
  notice.value = '';
}
/** @param {boolean} [accessLost] */
function invalidate(accessLost = false) {
  if (!shown.value) return;
  abort();
  clearDocument();
  denied.value = accessLost;
  stale.value = !accessLost;
  pdfFailed.value = false;
  error.value = accessLost
    ? 'Seu acesso a este recibo mudou. Feche a prévia e atualize os pedidos.'
    : 'O pedido mudou. Atualize a prévia antes de baixar o recibo.';
}
/** @param {unknown} cause @param {boolean} downloading */
function describeError(cause, downloading) {
  const failure = /** @type {any} */ (cause);
  const status = Number(failure?.status);
  if ([401, 403, 404].includes(status)) {
    invalidate(true);
  } else if (status === 409 || failure?.code === 'RECEIPT_STALE') {
    invalidate();
  } else {
    error.value = downloading
      ? 'Não foi possível gerar o recibo. Tente novamente.'
      : 'Não foi possível carregar o recibo. Tente novamente.';
    pdfFailed.value = downloading;
  }
}

async function loadPreview() {
  if (!shown.value || !target.value || denied.value) return;
  abort();
  const active = generation;
  const id = target.value.id;
  controller = new AbortController();
  const signal = controller.signal;
  clearDocument();
  error.value = '';
  stale.value = false;
  pdfFailed.value = false;
  loading.value = true;
  try {
    const data = await getOrderReceipt(id, signal);
    if (
      disposed ||
      !shown.value ||
      active !== generation ||
      target.value?.id !== id
    )
      return;
    receipt.value = data.receipt;
    fingerprint = data.fingerprint;
    target.value.version = data.receipt.version;
  } catch (cause) {
    if (active === generation && !signal.aborted) describeError(cause, false);
  } finally {
    if (active === generation) loading.value = false;
  }
}

/** @param {any} order @param {EventTarget|null} trigger */
async function open(order, trigger) {
  if (disposed || shown.value || order?.receiptAvailable !== true) return;
  abort();
  target.value = { id: order.id, number: order.number, version: order.version };
  opener = trigger instanceof HTMLElement ? trigger : null;
  pagePosition = { left: globalThis.scrollX, top: globalThis.scrollY };
  scrollPositions = [];
  for (
    let element = opener?.parentElement;
    element;
    element = element.parentElement
  ) {
    if (
      element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth
    )
      scrollPositions.push({
        element,
        left: element.scrollLeft,
        top: element.scrollTop,
      });
  }
  clearDocument();
  error.value = '';
  denied.value = false;
  stale.value = false;
  shown.value = true;
  await nextTick();
  if (disposed || !shown.value || !dialog.value) return;
  dialog.value.showModal();
  closeButton.value?.focus();
  void loadPreview();
}

function close() {
  abort();
  clearDocument();
  shown.value = false;
  dialog.value?.close();
}
function restoreOrigin() {
  if (disposed) return;
  const trigger = opener?.isConnected ? opener : props.fallbackFocus();
  opener = null;
  if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
  for (const position of scrollPositions) {
    if (position.element.isConnected)
      position.element.scrollTo(position.left, position.top);
  }
  globalThis.scrollTo(pagePosition.left, pagePosition.top);
  scrollPositions = [];
}

/** Keep both tab boundaries inside the native modal, including Chromium's backwards boundary. @param {KeyboardEvent} event */
function trapTab(event) {
  if (event.key !== 'Tab' || !dialog.value) return;
  const controls = [
    ...dialog.value.querySelectorAll('button:not([disabled])'),
  ].filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (
    event.shiftKey &&
    globalThis.document.activeElement === first &&
    last instanceof HTMLElement
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    globalThis.document.activeElement === last &&
    first instanceof HTMLElement
  ) {
    event.preventDefault();
    first.focus();
  }
}

async function download() {
  if (
    !shown.value ||
    !receipt.value ||
    loading.value ||
    busy.value ||
    stale.value ||
    denied.value
  )
    return;
  const document = receipt.value;
  const active = generation;
  const controllerForDownload = new AbortController();
  controller?.abort();
  controller = controllerForDownload;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const bytes = await getOrderReceiptPdf(
      document,
      fingerprint,
      controllerForDownload.signal,
    );
    if (
      disposed ||
      !shown.value ||
      active !== generation ||
      receipt.value !== document
    )
      return;
    downloadPdf(
      new File([bytes], receiptFilename(document), { type: 'application/pdf' }),
    );
    notice.value = 'Recibo preparado. Download solicitado ao navegador.';
    pdfFailed.value = false;
  } catch (cause) {
    if (active === generation && !controllerForDownload.signal.aborted)
      describeError(cause, true);
  } finally {
    if (active === generation) busy.value = false;
  }
}

watch(
  () => {
    const current = props.orders.find(
      (/** @type {any} */ order) => order?.id === target.value?.id,
    );
    return current
      ? [current.id, current.version, current.receiptAvailable].join('|')
      : '';
  },
  () => {
    if (!shown.value || !target.value) return;
    const current = /** @type {any} */ (
      props.orders.find(
        (/** @type {any} */ order) => order?.id === target.value?.id,
      )
    );
    if (!current) invalidate();
    else if (current.receiptAvailable !== true) invalidate(true);
    else if (current.version !== target.value.version) invalidate();
  },
);
watch(liveEvent, (event) => {
  if (!shown.value) return;
  if (
    event?.reset ||
    [
      'inbox.order.changed',
      'inbox.contact.changed',
      'inbox.conversation.changed',
      'identity.user.changed',
    ].includes(event?.type)
  ) {
    if (
      event?.type === 'inbox.order.changed' &&
      event.payload?.orderId &&
      event.payload.orderId !== target.value?.id
    )
      return;
    const source = /** @type {any} */ (
      props.orders.find(
        (/** @type {any} */ order) => order?.id === target.value?.id,
      )
    );
    if (
      event?.type === 'inbox.conversation.changed' &&
      event.payload?.conversationId &&
      source?.conversationId &&
      event.payload.conversationId !== source.conversationId
    )
      return;
    if (
      event?.type === 'inbox.contact.changed' &&
      event.payload?.contactId &&
      source?.contactId &&
      event.payload.contactId !== source.contactId
    )
      return;
    invalidate();
  }
});
onBeforeUnmount(() => {
  disposed = true;
  abort();
  dialog.value?.close();
});
defineExpose({ open, invalidate });
</script>

<template>
  <dialog
    ref="dialog"
    class="op-dialog order-receipt-dialog"
    aria-modal="true"
    aria-labelledby="receipt-title"
    aria-describedby="receipt-description"
    @cancel.prevent="close"
    @close="restoreOrigin"
    @keydown="trapTab"
  >
    <template v-if="shown">
      <header class="receipt-dialog-head">
        <h2 id="receipt-title">{{ title }}</h2>
        <button ref="closeButton" type="button" @click="close">Fechar</button>
      </header>
      <p id="receipt-description" class="op-hint">
        Confira o resumo comercial com os dados salvos do pedido.
      </p>
      <div class="receipt-actions">
        <button
          v-if="receipt"
          type="button"
          class="primary"
          :disabled="busy || loading"
          @click="download"
        >
          {{
            busy
              ? 'Gerando PDF…'
              : pdfFailed
                ? 'Tentar novamente'
                : 'Baixar PDF'
          }}
        </button>
        <button
          v-else-if="!denied && !loading && error"
          type="button"
          @click="loadPreview"
        >
          {{ stale ? 'Atualizar prévia' : 'Tentar novamente' }}
        </button>
        <p v-if="loading" role="status">Carregando recibo…</p>
        <p v-if="notice" role="status">{{ notice }}</p>
      </div>
      <p v-if="error" role="alert" class="op-alert">{{ error }}</p>
      <article
        v-if="receipt"
        class="receipt-paper"
        aria-label="Documento do recibo"
      >
        <header class="receipt-paper-head">
          <div class="receipt-brand">
            <BrandMark /><span class="sr-only">{{ brand.companyName }}</span>
            <p>Camisetas, abadás e uniformes esportivos</p>
          </div>
          <div class="receipt-identity">
            <h3>Recibo do pedido</h3>
            <strong>{{ receipt.number }}</strong>
            <p>Pedido de {{ dateLabel(receipt.orderDate) }}</p>
          </div>
        </header>
        <p class="receipt-state">{{ stateText }}</p>
        <p v-if="receipt.isTest" class="receipt-state">
          Pedido de teste · não produzir nem entregar.
        </p>
        <dl class="receipt-client">
          <dt>Cliente</dt>
          <dd>
            <strong>{{ receipt.customerName || 'Não informado' }}</strong>
          </dd>
          <dd v-if="receipt.orderName">{{ receipt.orderName }}</dd>
        </dl>
        <table class="receipt-table" aria-label="Itens e valores do recibo">
          <thead>
            <tr>
              <th scope="col" class="receipt-quantity">Qtd.</th>
              <th scope="col">Descrição</th>
              <th scope="col" class="receipt-unit">Unitário</th>
              <th scope="col" class="receipt-amount">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in receipt.items" :key="index">
              <td>{{ item.quantity ?? 'Não informado' }}</td>
              <td>
                {{ item.description
                }}<small v-if="item.details.length">{{
                  item.details.join(' · ')
                }}</small
                ><small v-if="item.sizes">{{ item.sizes }}</small
                ><small class="receipt-inline-unit"
                  >Unitário: {{ money(item.unitCents) }}</small
                >
              </td>
              <td class="receipt-unit">{{ money(item.unitCents) }}</td>
              <td class="receipt-amount">{{ money(item.subtotalCents) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!receipt.items.length" class="receipt-empty">
          Itens não informados.
        </p>
        <dl v-if="receipt.freightCents > 0" class="receipt-freight">
          <div>
            <dt>Subtotal das peças</dt>
            <dd>{{ money(receipt.piecesCents) }}</dd>
          </div>
          <div>
            <dt>Frete</dt>
            <dd>{{ money(receipt.freightCents) }}</dd>
          </div>
        </dl>
        <div class="receipt-total">
          <span>Total do pedido</span
          ><strong>{{ money(receipt.totalCents) }}</strong>
        </div>
        <dl class="receipt-facts">
          <div>
            <dt>Previsão de entrega</dt>
            <dd>{{ dateLabel(receipt.deliveryOn) }}</dd>
          </div>
          <div>
            <dt>Condição de pagamento</dt>
            <dd>{{ receipt.paymentCondition || 'A definir' }}</dd>
          </div>
          <div>
            <dt>Vendedor</dt>
            <dd>{{ receipt.sellerName || 'Não informado' }}</dd>
          </div>
        </dl>
        <footer class="receipt-footer">
          <p>Sem valor fiscal. Este resumo não comprova pagamento.</p>
          <p>
            Emitido em {{ issuedOn }} · Versão {{ receipt.version }} do pedido
          </p>
        </footer>
      </article>
    </template>
  </dialog>
</template>

<style scoped>
.order-receipt-dialog {
  inline-size: min(56rem, calc(100vw - var(--space-8)));
  max-block-size: calc(100dvh - var(--space-8));
  overflow: auto;
}
.receipt-dialog-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-4);
}
.receipt-dialog-head h2 {
  margin: 0;
}
.receipt-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-block: var(--space-4);
}
.receipt-actions p {
  margin: 0;
}
.receipt-paper {
  color-scheme: light;
  color: var(--color-document-text);
  background: var(--color-document-surface);
  border: 1px solid var(--color-document-border);
  border-block-start: var(--space-1) solid var(--color-document-accent);
  padding: var(--space-8);
  overflow-wrap: anywhere;
}
.receipt-paper-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
}
.receipt-brand {
  max-inline-size: 10rem;
}
.receipt-brand .brand-mark {
  inline-size: 7.5rem;
  block-size: auto;
  color: var(--color-document-text);
  fill: currentColor;
}
.receipt-brand p {
  margin-block-start: var(--space-2);
  color: var(--color-document-muted);
  font-size: var(--text-xs);
}
.receipt-identity {
  text-align: end;
}
.receipt-identity h3 {
  margin: 0;
  color: var(--color-document-text);
  font-size: var(--text-lg);
}
.receipt-identity strong {
  display: block;
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
}
.receipt-identity p {
  margin-block-start: var(--space-1);
  font-size: var(--text-xs);
}
.receipt-state {
  color: var(--color-document-text);
  margin-block-start: var(--space-4);
  padding-block-end: var(--space-4);
  border-block-end: 1px solid var(--color-document-border);
}
.receipt-paper dl {
  padding: 0;
  border: 0;
  border-radius: 0;
}
.receipt-paper dl > div {
  display: block;
  padding: 0;
  border: 0;
}
.receipt-paper .receipt-client {
  margin-block: var(--space-5);
}
.receipt-paper dt {
  color: var(--color-document-muted);
  font-size: var(--text-xs);
}
.receipt-paper dd {
  margin: var(--space-1) 0 0;
  color: var(--color-document-text);
  font-weight: var(--weight-regular);
  text-align: start;
}
.receipt-client strong {
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
}
.receipt-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  color: var(--color-document-text);
  background: var(--color-document-surface);
  font-size: var(--text-sm);
}
.receipt-table th {
  text-align: start;
  color: var(--color-document-muted);
  background: var(--color-document-surface);
  padding: var(--space-2) var(--space-1);
  border-block: 1px solid var(--color-document-border);
  font-weight: var(--weight-medium);
}
.receipt-table td {
  color: var(--color-document-text);
  background: var(--color-document-surface);
  padding: var(--space-4) var(--space-1);
  vertical-align: top;
  border-block-end: 1px solid var(--color-document-border);
}
.receipt-table small {
  display: block;
  margin-block-start: var(--space-1);
  color: var(--color-document-muted);
  font-size: var(--text-xs);
}
.receipt-quantity {
  width: 12%;
}
.receipt-table .receipt-unit {
  width: 20%;
  text-align: end;
}
.receipt-table .receipt-amount {
  width: 24%;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.receipt-table .receipt-inline-unit {
  display: none;
}
.receipt-freight {
  margin-block-start: var(--space-4);
}
.receipt-paper .receipt-freight > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
}
.receipt-total {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: baseline;
  gap: var(--space-5);
  margin-block: var(--space-6);
}
.receipt-total strong {
  color: var(--color-document-text);
  font-size: var(--text-2xl);
  font-variant-numeric: tabular-nums;
}
.receipt-paper .receipt-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  border-block: 1px solid var(--color-document-border);
  padding-block: var(--space-4);
}
.receipt-footer {
  margin-block-start: var(--space-5);
  color: var(--color-document-muted);
  font-size: var(--text-xs);
}
.receipt-footer p + p {
  margin-block-start: var(--space-1);
}
.receipt-empty {
  color: var(--color-document-muted);
  margin-block: var(--space-4);
}
@media (max-width: 30rem) {
  .order-receipt-dialog {
    padding: var(--space-4);
    inline-size: calc(100vw - var(--space-4));
    max-block-size: calc(100dvh - var(--space-4));
  }
  .receipt-paper {
    padding: var(--space-3);
  }
  .receipt-paper-head {
    gap: var(--space-3);
  }
  .receipt-brand {
    max-inline-size: 6rem;
  }
  .receipt-brand .brand-mark {
    inline-size: 5rem;
  }
  .receipt-identity h3 {
    font-size: var(--text-sm);
  }
  .receipt-identity strong {
    font-size: var(--text-xl);
  }
  .receipt-table .receipt-unit {
    display: none;
  }
  .receipt-table .receipt-inline-unit {
    display: block;
  }
  .receipt-quantity {
    width: 17%;
  }
  .receipt-table .receipt-amount {
    width: 33%;
  }
  .receipt-paper .receipt-facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
