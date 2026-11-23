<script setup>
import OrderIcon from '../OrderIcon.vue';

/*
 * Send progress: Gerando link → Enviando → Enviado → Entregue. Only the
 * transport (the send intent) moves it; nothing is claimed ahead of it.
 *
 * Props
 * - `steps`: step names, e.g. `sendSteps('send', false)`.
 * - `index`: the current step.
 * - `done`: every step finished.
 */
defineProps({
  steps: { type: Array, required: true },
  index: { type: Number, default: 0 },
  done: { type: Boolean, default: false },
});
</script>

<template>
  <ol class="bl-send" aria-label="Estado do envio">
    <li
      v-for="(step, at) in steps"
      :key="String(step)"
      :data-done="done || at < index ? '' : undefined"
      :aria-current="!done && at === index ? 'step' : undefined"
    >
      <OrderIcon v-if="done || at < index" name="check" /><span
        v-else-if="at === index"
        class="bl-dot"
        aria-hidden="true"
      ></span
      ><span v-else class="bl-pending-dot" aria-hidden="true"></span>{{ step }}
    </li>
  </ol>
</template>
