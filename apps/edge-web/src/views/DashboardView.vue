<script setup>
import { computed, inject, ref } from 'vue';
import DashboardManager from '../components/DashboardManager.vue';
import DashboardSeller from '../components/DashboardSeller.vue';

const user = inject('sessionUser', ref(null));
const manager = computed(() =>
  user.value?.capabilities?.includes('COMMERCIAL_ADMIN'),
);
</script>

<template>
  <DashboardManager
    v-if="manager"
    :key="user.id + ':' + !!user.canReadAllPersonalWhatsApp"
  />
  <DashboardSeller v-else :key="user?.id" />
</template>
