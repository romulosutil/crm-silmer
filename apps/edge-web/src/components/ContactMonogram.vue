<script setup>
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({ name: { type: String, required: true } });
const initials = computed(() =>
  (props.name.match(/\p{L}+/gu) ?? [])
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase('pt-BR'),
);
</script>

<template>
  <span aria-hidden="true">
    <template v-if="initials">{{ initials }}</template>
    <AppIcon v-else name="account" />
  </span>
</template>
