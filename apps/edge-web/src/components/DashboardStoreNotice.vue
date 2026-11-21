<script setup>
import { RouterLink } from 'vue-router';
defineProps({ notice: { type: Object, default: null } });
</script>
<template>
  <!-- LOJ-31: the region exists from the first paint so the arrival of a
         new site order is announced; the link is the whole notice. -->
  <div class="store-notice-region" aria-live="polite">
    <RouterLink
      v-if="notice"
      class="store-notice"
      :to="{
        path: '/pedidos',
        query: { origem: 'loja', impressao: 'pendente' },
      }"
    >
      <span class="store-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"
          />
        </svg>
      </span>
      <span class="store-notice-text">
        <strong>{{ notice.title }}</strong>
        <span>{{ notice.detail }}</span>
      </span>
      <span class="store-notice-action">
        Ver pedidos
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="m9 6 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6Z" />
        </svg>
      </span>
    </RouterLink>
  </div>
</template>
