<script setup>
import OrderIcon from '../OrderIcon.vue';

/*
 * RFC 074: the state of a charge or of the whole section, in words with an
 * icon and a tone (never colour alone). The same badge is used in the
 * section head, the rail, the rows and the Inbox.
 *
 * Props
 * - `badge`: `{label, tone, icon}` from lib/order-billing-view.js.
 */
defineProps({
  badge: { type: Object, required: true },
});
</script>

<template>
  <span
    class="badge bl-badge"
    :data-tone="badge.tone !== 'neutral' ? badge.tone : undefined"
    ><OrderIcon v-if="badge.icon" :name="badge.icon" />{{ badge.label }}</span
  >
</template>
