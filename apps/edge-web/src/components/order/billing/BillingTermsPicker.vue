<script setup>
import { billingMoney } from '../../../lib/order-billing.js';

/*
 * The condition is chosen once, on the order, and only suggests the first
 * link (the signal). Radio cards with what is charged now and later.
 *
 * Props
 * - `terms`: `termsPicker(...)` from lib/order-billing-view.js.
 * - `name`: radio group name.
 * Events
 * - `pick(value)`: 0 · 50 · 100.
 */
defineProps({
  terms: { type: Object, required: true },
  name: { type: String, default: 'order-billing-terms' },
});
const emit = defineEmits(['pick']);
</script>

<template>
  <fieldset class="bl-terms-pick">
    <legend>Condição de pagamento</legend>
    <div class="bl-cards" :data-count="terms.cards.length">
      <label v-for="card in terms.cards" :key="card.value" class="bl-card"
        ><input
          type="radio"
          :name="name"
          :value="card.value"
          :checked="terms.pick === card.value"
          @change="emit('pick', card.value)"
        /><span class="bl-card-title">{{ card.title }}</span
        ><span class="bl-card-detail">{{ card.detail }}</span></label
      >
    </div>
  </fieldset>
  <p class="bl-preview">
    Cobrar agora <strong>{{ billingMoney(terms.now) }}</strong> · Depois
    <strong>{{ billingMoney(terms.later) }}</strong>
  </p>
</template>
