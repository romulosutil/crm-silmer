<script setup>
import OrderIcon from '../OrderIcon.vue';

/*
 * Paragraphs of the next step: plain text and `{strong}` parts, never HTML.
 * Tones: 'muted' (secondary sentence), 'message' (the customer's message,
 * ready to copy) and 'busy' (a waiting line with a clock).
 *
 * Props
 * - `paragraphs`: `Array<{parts: Array<string|{strong: string}>, tone: string}>`.
 */
defineProps({
  paragraphs: { type: Array, required: true },
});
</script>

<template>
  <p
    v-for="(paragraph, index) in paragraphs"
    :key="index"
    :class="{
      'bl-next-muted': paragraph.tone === 'muted',
      'bl-message': paragraph.tone === 'message',
      'bl-busy-line': paragraph.tone === 'busy',
    }"
  >
    <OrderIcon v-if="paragraph.tone === 'busy'" name="clock" /><template
      v-for="(part, at) in paragraph.parts"
      :key="at"
      ><strong v-if="typeof part === 'object'">{{ part.strong }}</strong
      ><template v-else>{{ part }}</template></template
    >
  </p>
</template>
