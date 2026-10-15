<script setup>
import { computed } from 'vue';
import { brand } from '../brand/index.js';

const props = defineProps({
  /** `logo` para o logotipo inteiro, `monogram` para o rail recolhido. */
  variant: { type: String, default: 'logo' },
});

const mark = computed(() =>
  props.variant === 'monogram' ? brand.monogram : brand.logo,
);
</script>

<template>
  <svg
    class="brand-mark"
    :data-variant="variant"
    :viewBox="mark.viewBox"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="mark.path" />
  </svg>
</template>
