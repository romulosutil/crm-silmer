<script setup>
import { computed, onMounted, ref } from 'vue';

const props = defineProps({
  session: { type: Object, required: true },
});
const heading = ref(null);
const user = computed(() => props.session.user ?? props.session);
const capabilities = computed(() => {
  const values = props.session.capabilities ?? user.value.capabilities;
  return Array.isArray(values) ? values : [];
});
const functionName = computed(
  () =>
    props.session.functionName ?? user.value.functionName ?? 'não informada',
);

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page account-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Preferências</p>
        <h1 ref="heading" tabindex="-1">Conta e segurança</h1>
        <p>Gerencie sua sessão e as proteções da conta.</p>
      </div>
    </header>
    <section class="surface">
      <p class="section-kicker">Acesso atual</p>
      <h2>Sessão ativa</h2>
      <dl class="account-facts">
        <div>
          <dt>Função</dt>
          <dd>{{ functionName }}</dd>
        </div>
        <div>
          <dt>Capacidades</dt>
          <dd>
            {{
              capabilities.length
                ? capabilities.join(', ')
                : 'Sem capacidades administrativas.'
            }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
