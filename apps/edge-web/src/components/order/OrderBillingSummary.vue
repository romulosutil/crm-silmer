<script setup>
import { computed, inject } from 'vue';
import { billingMoney } from '../../lib/order-billing.js';
import { deriveBillingView } from '../../lib/order-billing-view.js';
import BillingBadge from './billing/BillingBadge.vue';
import BillingMeter from './billing/BillingMeter.vue';

/*
 * PED-RD-07 item 2 (ADR 086) and RFC 074: the rail repeats the chapter's name,
 * badge and two-segment meter — what was received of the total and what open
 * links reserve — and "Ver cobranças" takes the seller to the chapter. The
 * numbers are the ones the chapter read and emitted as `orderBillingState`;
 * this block makes no request of its own.
 */
const emit = defineEmits(['show']);

const state = /** @type {any} */ (inject('orderBillingState', null));
const data = computed(() => state?.value?.data ?? null);
const view = computed(() => deriveBillingView(data.value ?? {}));
// The same conditions that draw the chapter, plus the flag: a disabled
// billing has no summary to give.
const shown = computed(
  () =>
    state?.value?.available === true &&
    data.value?.enabled !== false &&
    view.value.figures.total > 0,
);
</script>

<template>
  <div
    v-if="shown"
    class="op-sheet op-billing-summary"
    role="group"
    aria-labelledby="order-billing-summary-title"
  >
    <div class="op-sheet-head">
      <h2 id="order-billing-summary-title">Cobranças e recebimentos</h2>
    </div>
    <div class="op-sheet-body op-billing-summary-body">
      <div><BillingBadge :badge="view.badge" /></div>
      <p class="op-billing-summary-line op-num">
        Recebido <strong>{{ billingMoney(view.figures.received) }}</strong> de
        <strong>{{ billingMoney(view.figures.total) }}</strong>
      </p>
      <BillingMeter :figures="view.figures" />
      <p
        v-if="view.figures.reserved > 0"
        class="op-billing-summary-line op-billing-summary-sub op-num"
      >
        <span class="bl-swatch" aria-hidden="true"></span>Em links abertos
        <strong>{{ billingMoney(view.figures.reserved) }}</strong>
      </p>
      <button
        type="button"
        class="link-button bl-link-target op-billing-summary-go"
        @click="emit('show')"
      >
        Ver cobranças
      </button>
    </div>
  </div>
</template>
