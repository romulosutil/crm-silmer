<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { request } from '../../lib/api-client.js';
import { amountLabel, isStoreOrder } from '../../lib/order-format.js';
import {
  freightErrorMessage,
  freightFieldText,
  freightOriginLabel,
  parseFreightInput,
} from '../../lib/order-freight.js';
import OrderIcon from './OrderIcon.vue';

// PED-RD-06 items 6-9 (ADR 080, OLC-05): "Valor do pedido" as Peças + Frete =
// Total. Peças and Total come from the server; only the freight is typed, by
// the responsible seller, in place (design.md §20, §22).
const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const sessionUser = inject('sessionUser', ref({}));
const input = ref(null);
const draft = ref(/** @type {string|null} */ (null));
const busy = ref(false);
const saveState = ref('');
const error = ref(
  /** @type {{message: string, reload?: boolean}|null} */ (null),
);
const quote = ref(/** @type {any} */ (null));
let again = false;
let controller;

const uid = `freight-${String(props.order.id).slice(0, 8)}`;
const amounts = computed(() => props.order.amounts ?? {});
const freight = computed(() => props.order.freight ?? {});
const freightCents = computed(() => Number(amounts.value.freightCents ?? 0));
const isPending = computed(() => props.order.status === 'pendente');
// The server's rule (ADR 080 item 3): the responsible seller on a pending,
// size-priced order. The payload names the seller, not a permission, so the
// API's 403 stays the authority and is shown inline.
const canEditFreight = computed(
  () =>
    isPending.value &&
    !isStoreOrder(props.order) &&
    !props.order.cancelledAt &&
    props.order.ficha?.sizePricing != null &&
    Boolean(props.order.seller?.id) &&
    props.order.seller.id === sessionUser.value?.id &&
    Boolean((editing.canConfirm ?? editing.canEdit).value),
);
const selected = computed(() =>
  quote.value?.services?.find(
    (service) => service.id === quote.value.selectedServiceId,
  ),
);
const quoteApplied = computed(
  () =>
    freight.value.source === 'quote' &&
    freight.value.quoteId === quote.value?.id &&
    freight.value.serviceId === selected.value?.id &&
    freightCents.value === selected.value?.priceCents,
);
const canUseQuote = computed(
  () =>
    canEditFreight.value &&
    Boolean(selected.value) &&
    quote.value?.stale !== true &&
    !quoteApplied.value,
);
// ADR 080 item 6: a warning, never a block.
const notice = computed(() => {
  if (!isPending.value) return '';
  if (
    canEditFreight.value &&
    selected.value &&
    quote.value?.stale === true &&
    !quoteApplied.value
  )
    return 'A cotação do frete está desatualizada. Consulte o frete de novo antes de usá-la.';
  if (freight.value.quoteNotice === 'stale')
    return 'A cotação aplicada ficou desatualizada. O frete gravado continua valendo.';
  if (freight.value.quoteNotice === 'divergent')
    return 'A cotação atual tem preço diferente do frete gravado.';
  return '';
});
const origin = computed(() => freightOriginLabel(freight.value, quote.value));
const text = computed(
  () =>
    draft.value ?? freightFieldText(freightCents.value, freight.value.source),
);
const readOnlyFreight = computed(() =>
  freightCents.value === 0 ? 'R$ 0,00' : amountLabel(freightCents.value),
);
const describedBy = computed(() =>
  [
    `${uid}-origin`,
    error.value ? `${uid}-error` : '',
    notice.value ? `${uid}-notice` : '',
  ]
    .filter(Boolean)
    .join(' '),
);

async function loadQuote() {
  controller?.abort();
  controller = undefined;
  if (!props.order.id) return;
  if (!canEditFreight.value && freight.value.source !== 'quote') {
    quote.value = null;
    return;
  }
  const own = new AbortController();
  controller = own;
  try {
    const response = await request(
      `/api/v1/orders/${encodeURIComponent(props.order.id)}/shipping-quote`,
      { signal: own.signal },
    );
    if (!own.signal.aborted && own === controller)
      quote.value = response.data?.quote ?? null;
  } catch {
    // Without the estimate the slot still works; only the button is absent.
    if (!own.signal.aborted && own === controller) quote.value = null;
  }
}
watch(
  () => [props.order.id, props.order.version, canEditFreight.value],
  () => void loadQuote(),
  { immediate: true },
);
onBeforeUnmount(() => controller?.abort());

/** @param {Event} event */
function onInput(event) {
  draft.value = /** @type {HTMLInputElement} */ (event.target).value;
  if (saveState.value === 'saved') saveState.value = '';
}

async function commit() {
  if (!canEditFreight.value || draft.value === null) return;
  if (busy.value) {
    again = true;
    return;
  }
  const typed = draft.value;
  const parsed = parseFreightInput(typed);
  if (!parsed.ok) {
    error.value = { message: parsed.message };
    return;
  }
  if (parsed.cents === freightCents.value) {
    draft.value = null;
    error.value = null;
    return;
  }
  await send({ freightCents: parsed.cents }, typed);
}

async function useQuote() {
  if (!canUseQuote.value || busy.value) return;
  await send({
    quote: { quoteId: quote.value.id, serviceId: selected.value.id },
  });
  await nextTick();
  input.value?.focus();
}

/** @param {Record<string, unknown>} body @param {string} [typed] */
async function send(body, typed) {
  busy.value = true;
  saveState.value = 'saving';
  error.value = null;
  const result = await editing.command('freight', body);
  busy.value = false;
  if (result.ok) {
    if (typed === undefined || draft.value === typed) draft.value = null;
    saveState.value = 'saved';
  } else {
    saveState.value = '';
    error.value = freightErrorMessage(result);
  }
  if (again) {
    again = false;
    void commit();
  }
}

async function reloadOrder() {
  draft.value = null;
  error.value = null;
  await editing.reload?.();
  await nextTick();
  input.value?.focus();
}

/** @param {KeyboardEvent} event */
function onEnter(event) {
  event.preventDefault();
  void commit();
}
</script>

<template>
  <div class="op-value" role="group" :aria-labelledby="`${uid}-title`">
    <p :id="`${uid}-title`" class="op-value-title">Valor do pedido</p>
    <dl class="op-deal op-deal--breakdown">
      <div>
        <dt>Peças</dt>
        <dd class="op-num">{{ amountLabel(amounts.piecesCents) }}</dd>
      </div>
      <div class="op-freight-row">
        <dt>
          <label :for="canEditFreight ? `${uid}-input` : undefined"
            >Frete</label
          >
          <span :id="`${uid}-origin`" class="op-freight-origin">{{
            origin
          }}</span>
        </dt>
        <dd v-if="canEditFreight" class="op-freight-control">
          <span class="op-freight-prefix" aria-hidden="true">R$</span>
          <input
            :id="`${uid}-input`"
            ref="input"
            class="op-freight-input op-num"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="0,00"
            :value="text"
            :aria-invalid="error ? 'true' : undefined"
            :aria-describedby="describedBy"
            :aria-busy="busy || undefined"
            @input="onInput"
            @blur="commit"
            @keydown.enter="onEnter"
          />
        </dd>
        <dd v-else class="op-num">{{ readOnlyFreight }}</dd>
      </div>
      <div class="op-deal-total">
        <dt>Total</dt>
        <dd class="op-num">{{ amountLabel(amounts.totalCents) }}</dd>
      </div>
    </dl>
    <p v-if="amounts.totalCents == null" class="op-hint op-value-missing">
      O total aparece quando todos os subtotais estiverem preenchidos.
    </p>

    <p
      v-if="saveState !== ''"
      class="op-freight-status"
      role="status"
      :data-save-status="saveState"
    >
      <template v-if="saveState === 'saving'">Salvando frete…</template>
      <template v-else-if="saveState === 'saved'"
        ><OrderIcon name="check" />Frete salvo</template
      >
    </p>
    <p v-if="error" :id="`${uid}-error`" class="op-field-error" role="alert">
      <span>{{ error.message }}</span>
      <button
        v-if="error.reload"
        type="button"
        class="link-button"
        @click="reloadOrder"
      >
        Recarregar pedido
      </button>
    </p>
    <p
      v-if="notice"
      :id="`${uid}-notice`"
      class="op-freight-notice"
      role="status"
    >
      <OrderIcon name="alert" /><span>{{ notice }}</span>
    </p>
    <button
      v-if="canUseQuote"
      type="button"
      class="quiet op-freight-quote"
      :disabled="busy"
      @click="useQuote"
    >
      Usar cotação: {{ amountLabel(selected.priceCents) }} ·
      {{ selected.company }} {{ selected.name }}
    </button>
  </div>
</template>
