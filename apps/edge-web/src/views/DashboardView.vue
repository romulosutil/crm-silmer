<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  conversationLabel,
  dateTimeBR,
  messageText,
} from '../lib/format.js';

const heading = ref(null);
const loading = ref(true);
const error = ref('');
const inbox = ref({ items: [], totalCount: 0 });
let controller;

const attentionCount = computed(
  () => inbox.value.items.filter((item) => item.requiresAttention).length,
);
const unassignedCount = computed(
  () => inbox.value.items.filter((item) => !item.assignedUser).length,
);
const channelCounts = computed(() =>
  Object.entries(CHANNEL_LABELS).map(([channel, label]) => ({
    channel,
    count: inbox.value.items.filter((item) => item.channel === channel).length,
    label,
  })),
);
const maxChannel = computed(() =>
  Math.max(1, ...channelCounts.value.map((channel) => channel.count)),
);

async function loadDashboard() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const inboxResponse = await request('/api/v1/inbox/conversations?limit=100', {
      signal: controller.signal,
    });
    inbox.value = inboxResponse.data;
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os indicadores operacionais.';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  heading.value?.focus();
  void loadDashboard();
});
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Visão operacional</p>
        <h1 ref="heading" tabindex="-1">Dashboard</h1>
        <p>
          Retrato atual do funil e das conversas, calculado somente com dados
          persistidos no CRM.
        </p>
      </div>
      <button type="button" :disabled="loading" @click="loadDashboard">
        Atualizar
      </button>
    </header>

    <div v-if="loading" class="loading-state" role="status">
      Carregando indicadores…
    </div>
    <div v-else-if="error" class="empty-state" role="alert">
      <h2>Dashboard indisponível</h2>
      <p>{{ error }}</p>
      <button type="button" @click="loadDashboard">Tentar novamente</button>
    </div>
    <template v-else>
      <dl class="kpi-grid">
        <div class="kpi">
          <dt>Conversas</dt>
          <dd class="kpi-value">{{ inbox.totalCount }}</dd>
          <dd class="kpi-meta">WhatsApp na Caixa de Entrada</dd>
        </div>
        <div class="kpi">
          <dt>Requerem atenção</dt>
          <dd class="kpi-value">{{ attentionCount }}</dd>
          <dd class="kpi-meta">Nas 100 conversas mais recentes</dd>
        </div>
        <div class="kpi">
          <dt>Sem responsável</dt>
          <dd class="kpi-value">{{ unassignedCount }}</dd>
          <dd class="kpi-meta">Nas 100 conversas mais recentes</dd>
        </div>
      </dl>

      <div class="dash-grid section-gap">
        <section class="surface" aria-labelledby="channels-title">
          <div class="panel-head">
            <h2 id="channels-title">Conversas por canal</h2>
            <p>Até 100 conversas mais recentes</p>
          </div>
          <dl class="rank">
            <div
              v-for="channel in channelCounts"
              :key="channel.channel"
              class="rank-row"
            >
              <dt>{{ channel.label }}</dt>
              <dd>
                <span class="rank-track">
                  <span
                    class="rank-fill"
                    :style="{
                      '--rank-size': `${Math.round((channel.count / maxChannel) * 100)}%`,
                    }"
                  ></span>
                </span>
              </dd>
              <dd class="rank-value">{{ channel.count }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="surface section-gap" aria-labelledby="recent-title">
        <div class="panel-head">
          <h2 id="recent-title">Conversas recentes</h2>
          <p>Conteúdo mínimo necessário à operação</p>
        </div>
        <ul v-if="inbox.items.length" class="pend-list">
          <li
            v-for="conversation in inbox.items.slice(0, 6)"
            :key="conversation.id"
          >
            <div>
              <strong>{{ conversation.contact.label }}</strong>
              <p>
                {{
                  CHANNEL_LABELS[conversation.channel] ?? conversation.channel
                }}
                · {{ messageText(conversation.lastMessage) }}
              </p>
            </div>
            <div>
              <span
                class="badge"
                :data-tone="conversation.requiresAttention ? 'error' : 'info'"
              >
                {{
                  conversationLabel(conversation)
                }}
              </span>
              <p>{{ dateTimeBR(conversation.updatedAt) }}</p>
            </div>
          </li>
        </ul>
        <div v-else class="empty-list">
          <h3>Nenhuma conversa recebida</h3>
          <p>A Caixa de Entrada será preenchida pelos canais conectados.</p>
        </div>
      </section>
    </template>
  </div>
</template>
