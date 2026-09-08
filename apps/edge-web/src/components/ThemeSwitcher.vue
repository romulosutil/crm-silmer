<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const options = [
  { label: 'Sistema', shortLabel: 'S', value: 'system' },
  { label: 'Claro', shortLabel: 'C', value: 'light' },
  { label: 'Escuro', shortLabel: 'E', value: 'dark' },
];
const theme = ref(readStoredTheme());
const mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');

onMounted(() => {
  applyTheme();
  mediaQuery.addEventListener('change', applyTheme);
});

onBeforeUnmount(() => mediaQuery.removeEventListener('change', applyTheme));

function readStoredTheme() {
  const stored = globalThis.localStorage.getItem('silmer-theme');
  return options.some((option) => option.value === stored) ? stored : 'light';
}

/** @param {'system' | 'light' | 'dark'} value */
function selectTheme(value) {
  theme.value = value;
  globalThis.localStorage.setItem('silmer-theme', value);
  applyTheme();
}

function applyTheme() {
  const resolved =
    theme.value === 'system'
      ? mediaQuery.matches
        ? 'dark'
        : 'light'
      : theme.value;
  document.documentElement.dataset.theme = resolved;
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
