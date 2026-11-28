<script setup>
import { computed } from 'vue';

const props = defineProps({
  deadline: { type: Object, required: true },
});

const tone = computed(() =>
  props.deadline.overdue
    ? 'error'
    : props.deadline.days !== null
      ? 'success'
      : undefined,
);
const detail = computed(() =>
  tone.value === 'success'
    ? `No prazo · ${props.deadline.relative}`
    : props.deadline.relative,
);
</script>

<template>
  <span
    class="order-due-date num"
    :data-tone="tone"
    :title="detail || undefined"
  >
    {{ deadline.date }}
  </span>
  <span v-if="detail" class="sr-only"> · {{ detail }}</span>
</template>
