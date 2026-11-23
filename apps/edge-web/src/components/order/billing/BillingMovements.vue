<script setup>
import { ref } from 'vue';
import { billingMoney } from '../../../lib/order-billing.js';
import OrderIcon from '../OrderIcon.vue';
import BillingBadge from './BillingBadge.vue';
import BillingRowMenu from './BillingRowMenu.vue';

/*
 * RFC 074, Movimentações: always visible, one row per link or outside
 * receipt, oldest first. Rare actions live in each row's "Mais ações"; the
 * row's history opens and closes with the right label.
 *
 * Props
 * - `rows`: `view.rows` from lib/order-billing-view.js.
 * - `sheet`: row menus open as bottom sheets (phone).
 * - `headingId`: id of the "Movimentações" heading.
 * Events
 * - `act(act, row, button)`: a row menu action.
 */
defineProps({
  rows: { type: Array, required: true },
  sheet: { type: Boolean, default: false },
  headingId: { type: String, default: 'order-billing-moves-title' },
});
const emit = defineEmits(['act']);
/** @type {import('vue').Ref<Record<string, boolean>>} */
const opened = ref({});
/** @param {string} id */
function toggle(id) {
  opened.value = { ...opened.value, [id]: !opened.value[id] };
}
</script>

<template>
  <section class="bl-moves" :aria-labelledby="headingId">
    <div class="bl-moves-head">
      <h3 :id="headingId">Movimentações</h3>
      <p v-if="rows.length" class="op-hint">
        {{ rows.length }}
        {{ rows.length === 1 ? 'movimentação' : 'movimentações' }} · da mais
        antiga para a mais recente
      </p>
    </div>
    <ul v-if="rows.length" class="bl-moves-list">
      <li v-for="row in rows" :key="row.id" class="bl-move">
        <span class="bl-move-icon" aria-hidden="true"
          ><OrderIcon :name="row.icon"
        /></span>
        <div class="bl-move-main">
          <p class="bl-move-title">{{ row.title }}</p>
          <p class="bl-move-meta">{{ row.meta }}</p>
          <button
            type="button"
            class="bl-history-toggle"
            :aria-expanded="opened[row.id] ? 'true' : 'false'"
            :aria-controls="`order-billing-history-${row.id}`"
            @click="toggle(row.id)"
          >
            <OrderIcon name="chevron" /><span>{{
              opened[row.id] ? 'Ocultar histórico' : `Histórico ${row.noun}`
            }}</span>
          </button>
          <ol
            :id="`order-billing-history-${row.id}`"
            class="bl-history"
            :hidden="!opened[row.id]"
            :aria-label="`Histórico ${row.noun}: ${row.title}`"
          >
            <li v-for="(event, at) in row.events" :key="at">
              <time>{{ event.at }}</time
              ><span>{{ event.label }}</span>
            </li>
          </ol>
        </div>
        <div class="bl-move-side">
          <BillingBadge :badge="row.badge" /><span
            class="bl-move-amount"
            :data-struck="row.struck ? '' : undefined"
            >{{ billingMoney(row.amountCents) }}</span
          ><span v-if="row.sub" class="bl-move-sub">{{ row.sub }}</span>
        </div>
        <BillingRowMenu
          v-if="row.menu.length"
          :items="row.menu"
          :row-title="row.title"
          :noun="row.noun"
          :sheet="sheet"
          @select="(act, button) => emit('act', act, row, button)"
        />
        <span v-else class="bl-move-more-spacer" aria-hidden="true"></span>
      </li>
    </ul>
    <p v-else class="op-hint">Nenhuma cobrança ou recebimento ainda.</p>
  </section>
</template>
