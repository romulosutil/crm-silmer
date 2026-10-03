<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { request } from '../lib/api-client.js';

const props = defineProps({
  session: { type: Object, required: true },
});
const liveEvent = inject('liveEvent', ref(null));
const liveConnection = inject('liveConnection', ref('indisponível'));
const heading = ref(null);
const currentSession = ref(props.session);
const user = computed(() => currentSession.value.user ?? currentSession.value);
const capabilities = computed(() => {
  const values = currentSession.value.capabilities ?? user.value.capabilities;
  return Array.isArray(values) ? values : [];
});
const functionName = computed(() =>
  capabilities.value.includes('COMMERCIAL_ADMIN')
    ? 'Administrador'
    : 'Vendedor',
);

let fallbackTimer = 0;
let controller;

async function refreshSession() {
  controller?.abort();
  controller = new AbortController();
  try {
    const response = await request('/api/v1/sessions/current', {
      signal: controller.signal,
    });
    currentSession.value = response.data;
  } catch {
    // Keep the last authorized session while the event stream reconnects.
  }
}

watch(
  () => props.session,
  (session) => {
    currentSession.value = session;
  },
);
watch(liveEvent, (event) => {
  if (event?.reset || event?.type === 'identity.user.changed')
    void refreshSession();
});
onMounted(() => {
  heading.value?.focus();
  fallbackTimer = globalThis.setInterval(() => {
    if (
      liveConnection.value !== 'conectado' &&
      globalThis.document.visibilityState === 'visible'
    )
      void refreshSession();
  }, 30_000);
});
onBeforeUnmount(() => {
  controller?.abort();
  if (fallbackTimer) globalThis.clearInterval(fallbackTimer);
});
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
          <dt>Nome</dt>
          <dd>{{ user.name ?? 'não informado' }}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>{{ user.email ?? 'não informado' }}</dd>
        </div>
        <div>
          <dt>Função</dt>
          <dd>{{ functionName }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
