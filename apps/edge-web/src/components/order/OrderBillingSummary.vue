<script setup>
import { computed, inject } from 'vue';
import { billingMoney } from '../../lib/order-billing.js';

/*
 * PED-RD-07 item 2 (ADR 086, design.md §22): the rail only summarises the
 * charges of a confirmed order — what was received of the total, a Meter and
 * "Ver cobranças", which takes the seller to the chapter. The interior of the
 * charges (plan, links, refunds) stays in OrderBillingSection. The numbers are
 * the ones that chapter already read and emitted as `orderBillingState`; this
 * block makes no request of its own.
 */
const emit = defineEmits(['show']);

const state = inject('orderBillingState', null);
const data = computed(() => state?.value?.data ?? null);
const total = computed(() => Number(data.value?.totalAmountCents));
const received = computed(() => {
  const value = Number(data.value?.receivedAmountCents ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
// The same conditions that draw the chapter, plus the flag: a disabled
// billing has no summary to give.
const shown = computed(
  () =>
    state?.value?.available === true &&
    data.value?.enabled !== false &&
    Number.isSafeInteger(total.value) &&
    total.value > 0,
);
const percent = computed(() =>
  Math.min(100, Math.round((received.value / total.value) * 100)),
);
const summary = computed(
  () => `${billingMoney(received.value)} de ${billingMoney(total.value)}`,
);
// Words beside the Meter, never colour alone (§14).
const status = computed(() => {
  if (received.value >= total.value) return 'Quitado';
  return received.value > 0 ? 'Pago parcialmente' : 'A receber';
});
</script>

<template>
  <div
    v-if="shown"
    class="op-sheet op-billing-summary"
    role="group"
    aria-labelledby="order-billing-summary-title"
  >
    <div class="op-sheet-head">
      <h2 id="order-billing-summary-title">Cobranças</h2>
      <p class="op-sheet-state op-num">{{ status }}</p>
    </div>
    <div class="op-sheet-body op-billing-summary-body">
      <p class="op-billing-summary-line op-num">
        Recebido <strong>{{ summary }}</strong>
      </p>
      <span
        class="op-meter"
        role="meter"
        aria-label="Recebido do pedido"
        aria-valuemin="0"
        :aria-valuemax="total"
        :aria-valuenow="Math.min(received, total)"
        :aria-valuetext="`Recebido ${summary}, ${percent}%`"
      >
        <span :style="{ inlineSize: `${percent}%` }"></span>
      </span>
      <p class="op-hint op-num">{{ percent }}% recebido</p>
      <button
        type="button"
        class="quiet op-billing-summary-go"
        @click="emit('show')"
      >
        Ver cobranças
      </button>
    </div>
  </div>
</template>
