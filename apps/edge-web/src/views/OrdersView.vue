<script setup>
import { onMounted, ref } from 'vue';

const heading = ref(null);

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Carteira</p>
        <h1 ref="heading" tabindex="-1">Pedidos</h1>
        <p>
          Confirmados já podem ser impressos. Pendentes são pedidos não
          concluídos — qualquer vendedor pode retomar de onde parou.
        </p>
      </div>
    </header>
  </div>
</template>
