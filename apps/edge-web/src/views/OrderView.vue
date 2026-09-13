<script setup>
import { onMounted, ref } from 'vue';

defineProps({
  orderId: { type: String, required: true },
  fromConversationId: { type: String, default: '' },
});

const heading = ref(null);

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Pedido</p>
        <h1 ref="heading" tabindex="-1">Pedido</h1>
      </div>
    </header>
  </div>
</template>
