<script setup>
// One stroke family for the order page, drawn at 24×24 and sized by CSS.
const PATHS = Object.freeze({
  check: ['M20 6 9 17l-5-5'],
  chevron: ['m6 9 6 6 6-6'],
  clock: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v4l2.5 2'],
  copy: [
    'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
    'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  ],
  ficha: [
    'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z',
    'M14 3v6h6',
    'm9 15 2 2 4-4',
  ],
  lock: [
    'M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
    'M8 11V7a4 4 0 0 1 8 0v4',
  ],
  minus: ['M5 12h14'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  printer: [
    'M6 9V3h12v6',
    'M6 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1',
    'M6 14h12v7H6z',
  ],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'm6 6 1 14h10l1-14'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
});

defineProps({
  name: { type: String, required: true },
});
</script>

<template>
  <svg class="op-icon" aria-hidden="true" viewBox="0 0 24 24">
    <path v-for="path in PATHS[name] ?? []" :key="path" :d="path" />
  </svg>
</template>
