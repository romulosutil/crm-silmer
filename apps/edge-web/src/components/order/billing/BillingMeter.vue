<script setup>
/*
 * Two-segment meter: received (full colour) and reserved in open links (the
 * same colour, lighter). The figures are always said in text beside it, so
 * the bar itself is decorative.
 *
 * Props
 * - `figures`: `{pct, pctRes}` from lib/order-billing-view.js.
 */
defineProps({
  figures: { type: Object, required: true },
});
</script>

<template>
  <span class="op-meter bl-meter" aria-hidden="true"
    ><span
      class="bl-meter-got"
      :style="{ inlineSize: `${figures.pct}%` }"
    ></span
    ><span
      v-if="figures.pctRes"
      class="bl-meter-held"
      :data-gap="figures.pct ? '' : undefined"
      :style="{ inlineSize: `${figures.pctRes}%` }"
    ></span
  ></span>
</template>
