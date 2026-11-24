<script setup>
import { billingMoney } from '../../../lib/order-billing.js';
import BillingBadge from './BillingBadge.vue';
import BillingMeter from './BillingMeter.vue';

/*
 * RFC 074, Situação: "Falta receber" first, then "Recebido X de Y · N%" with
 * the meter tied to that sentence, the open-links legend only when links
 * reserve money, and the agreed condition. The words come from
 * `view.summary` (situationSummary): a link A conferir is never counted as
 * aberto, a cancelled order owes nothing, and nothing is "livre para cobrar"
 * during conferência.
 *
 * Props
 * - `view`: the result of `deriveBillingView` (figures, terms, heldHint, badge).
 * - `compact`: the Inbox variant — a visible "Situação" heading with the badge
 *   and a single-column layout.
 * - `headingId`: id of the heading (unique per page).
 */
defineProps({
  view: { type: Object, required: true },
  compact: { type: Boolean, default: false },
  headingId: { type: String, default: 'order-billing-situation' },
});
</script>

<template>
  <section
    class="bl-situation"
    :class="{ 'bl-compact': compact }"
    :aria-labelledby="headingId"
  >
    <div v-if="compact" class="bl-compact-head">
      <h3 :id="headingId">Situação</h3>
      <BillingBadge :badge="view.badge" />
    </div>
    <h3 v-else :id="headingId" class="sr-only">Situação</h3>
    <div class="bl-figures">
      <p class="bl-due">
        <span class="bl-due-label">{{ view.summary.due.label }}</span
        ><strong class="bl-due-value">{{ view.summary.due.value }}</strong>
      </p>
      <div class="bl-progress">
        <p class="bl-progress-line">
          Recebido <strong>{{ billingMoney(view.figures.received) }}</strong> de
          <strong>{{ billingMoney(view.figures.total) }}</strong
          ><span class="bl-progress-pct"> · {{ view.figures.pct }}%</span>
        </p>
        <BillingMeter :figures="view.figures" />
        <p v-if="view.summary.legend" class="bl-progress-legend">
          <span class="bl-swatch" aria-hidden="true"></span
          ><template v-for="(part, at) in view.summary.legend" :key="at"
            ><strong v-if="typeof part === 'object'">{{ part.strong }}</strong
            ><template v-else>{{ part }}</template></template
          >
        </p>
      </div>
    </div>
    <p class="bl-terms">
      Condição: <strong>{{ view.terms.strong }}</strong
      ><template v-if="view.terms.after"> · {{ view.terms.after }}</template>
    </p>
    <p v-if="view.heldHint" class="op-hint">{{ view.heldHint }}</p>
  </section>
</template>
