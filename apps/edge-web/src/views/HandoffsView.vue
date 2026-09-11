<script setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { commandKey, request } from '../lib/api-client.js';
import { dateTimeBR } from '../lib/format.js';

const LIVE_REFRESH_DELAY_MS = 250;

const heading = ref(null);
const liveEvent = inject('liveEvent', ref(null));
const loading = ref(true);
const claimingId = ref('');
const error = ref('');
const message = ref('');
const handoffs = ref([]);
const totalCount = ref(0);
let controller;
let refreshTimer = 0;

async function loadHandoffs(silent = false) {
  controller?.abort();
  controller = new AbortController();
  if (!silent) loading.value = true;
  try {
    const response = await request('/api/v1/inbox/handoffs?limit=100', {
      signal: controller.signal,
    });
    handoffs.value = response.data.items ?? [];
    totalCount.value = Number(response.data.totalCount ?? 0);
    if (!silent) error.value = '';
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os handoffs pendentes.';
    }
  } finally {
    loading.value = false;
  }
}

async function claim(handoff) {
  if (claimingId.value) return;
  claimingId.value = handoff.id;
  error.value = '';
  message.value = '';
  try {
    await request(`/api/v1/handoffs/${encodeURIComponent(handoff.id)}/claim`, {
      body: {
        expectedConversationVersion: handoff.conversationVersion,
        expectedHandoffVersion: handoff.version,
        reasonCode: 'handoff_claimed',
      },
      idempotencyKey: commandKey(),
      method: 'POST',
    });
    message.value = `Handoff de ${handoff.contact.label} assumido.`;
    await loadHandoffs(true);
  } catch (cause) {
    if (Number(cause?.status) === 409) {
      error.value =
        'Este handoff já foi assumido ou mudou. A fila foi atualizada.';
      await loadHandoffs(true);
    } else if (Number(cause?.status) === 403) {
      error.value = 'Sem permissão para assumir este handoff.';
    } else {
      error.value = 'Não foi possível assumir o handoff agora.';
    }
  } finally {
    claimingId.value = '';
  }
}

function scheduleRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void loadHandoffs(true);
  }, LIVE_REFRESH_DELAY_MS);
}

watch(liveEvent, (event) => {
  if (event) scheduleRefresh();
});
onMounted(() => {
  heading.value?.focus();
  void loadHandoffs();
});
onBeforeUnmount(() => {
  controller?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Atendimento humano</p>
        <h1 ref="heading" tabindex="-1">Fila de handoffs</h1>
        <p>
          Solicitações pendentes encaminhadas pela IA. O primeiro operador que
          assumir passa a ser o responsável pela conversa.
        </p>
      </div>
      <p class="count" :aria-label="`${totalCount} handoffs pendentes`">
        {{ totalCount }}
      </p>
    </header>

    <p v-if="error" class="audit-note" role="alert">{{ error }}</p>
    <p v-if="message" class="audit-note" role="status">{{ message }}</p>
    <div v-if="loading" class="loading-state" role="status">
      Carregando handoffs…
    </div>
    <section v-else-if="!handoffs.length" class="surface empty-list">
      <h2>Nenhum handoff pendente</h2>
      <p>As solicitações de atendimento humano aparecerão aqui.</p>
    </section>
    <ul v-else class="handoff-list" aria-label="Handoffs pendentes">
      <li v-for="handoff in handoffs" :key="handoff.id" class="surface">
        <div class="handoff-head">
          <div>
            <h2>{{ handoff.contact.label }}</h2>
            <p>{{ handoff.contact.externalId }} · {{ handoff.targetRole }}</p>
          </div>
          <span class="badge" data-tone="error">Pendente</span>
        </div>
        <dl class="card-facts">
          <div>
            <dt>Motivo</dt>
            <dd>{{ handoff.reasonCode }}</dd>
          </div>
          <div>
            <dt>Recebido</dt>
            <dd>{{ dateTimeBR(handoff.createdAt) }}</dd>
          </div>
          <div>
            <dt>Prazo</dt>
            <dd>{{ dateTimeBR(handoff.dueAt) }}</dd>
          </div>
        </dl>
        <p class="handoff-summary">{{ handoff.summary }}</p>
        <div class="inline-actions">
          <button
            type="button"
            class="primary"
            :disabled="Boolean(claimingId)"
            @click="claim(handoff)"
          >
            {{
              claimingId === handoff.id ? 'Assumindo…' : 'Assumir atendimento'
            }}
          </button>
          <RouterLink class="button-link quiet-link" to="/inbox">
            Abrir Caixa de Entrada
          </RouterLink>
        </div>
      </li>
    </ul>
  </div>
</template>
