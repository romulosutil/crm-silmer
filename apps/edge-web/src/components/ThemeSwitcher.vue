<script setup>
import { onMounted, ref } from 'vue';

const options = [
  { label: 'Claro', shortLabel: 'C', value: 'light' },
  { label: 'Escuro', shortLabel: 'E', value: 'dark' },
];
const theme = ref(readStoredTheme());

onMounted(applyTheme);

function readStoredTheme() {
  const stored = globalThis.localStorage.getItem('silmer-theme');
  return options.some((option) => option.value === stored) ? stored : 'light';
}

/** @param {'light' | 'dark'} value */
function selectTheme(value) {
  theme.value = value;
  globalThis.localStorage.setItem('silmer-theme', value);
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
}
</script>

<template>
  <fieldset class="theme-switcher">
    <legend class="sr-only">Aparência</legend>
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="theme === option.value"
      :data-short-label="option.shortLabel"
      @click="selectTheme(option.value)"
    >
      {{ option.label }}
    </button>
  </fieldset>
</template>
