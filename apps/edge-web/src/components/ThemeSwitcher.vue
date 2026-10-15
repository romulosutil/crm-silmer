<script setup>
import { onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

const options = [
  { icon: 'sun', label: 'Claro', value: 'light' },
  { icon: 'moon', label: 'Escuro', value: 'dark' },
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
      :title="`Tema ${option.label.toLocaleLowerCase('pt-BR')}`"
      @click="selectTheme(option.value)"
    >
      <AppIcon :name="option.icon" />
      <span class="sr-only">{{ option.label }}</span>
    </button>
  </fieldset>
</template>
