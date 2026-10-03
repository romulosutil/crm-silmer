<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  conversationLabel,
  dateTimeBR,
  messageText,
} from '../lib/format.js';

const heading = ref(null);
const liveEvent = inject('liveEvent', ref(null));
const loading = ref(true);
const error = ref('');
const inbox = ref({ items: [], totalCount: 0 });
const summary = ref({
  confirmedCount: 0,
  soldAmountCents: 0,
  averageTicketCents: 0,
  pendingCount: 0,
  totalPiecesSold: 0,
});
let controller;
let refreshTimer = 0;

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const money = (cents) => moneyFormatter.format(Number(cents || 0) / 100);
const piecesPerSale = computed(() =>
  summary.value.confirmedCount
    ? (
        summary.value.totalPiecesSold / summary.value.confirmedCount
      ).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    : '—',
);

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

async function loadDashboard(silent = false) {
  controller?.abort();
  controller = new AbortController();
  if (!silent) loading.value = true;
  try {
    const [inboxResponse, summaryResponse] = await Promise.all([
      request('/api/v1/inbox/conversations?limit=100', {
        signal: controller.signal,
      }),
      request('/api/v1/orders/summary', { signal: controller.signal }),
    ]);
    inbox.value = inboxResponse.data;
    summary.value = summaryResponse.data;
    error.value = '';
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os indicadores.';
    }
  } finally {
    loading.value = false;
  }
}

function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void loadDashboard(true);
  }, 250);
}

watch(liveEvent, (event) => {
  if (
    event?.reset ||
    [
      'inbox.order.changed',
      'inbox.conversation.changed',
      'inbox.contact.changed',
    ].includes(event?.type)
  ) {
    scheduleLiveRefresh();
  }
});

onMounted(() => {
  heading.value?.focus();
  void loadDashboard();
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
        <p class="eyebrow">Visão do negócio</p>
        <h1 ref="heading" tabindex="-1">Dashboard</h1>
        <p>Vendas confirmadas e trabalho que pede atenção, com dados do CRM.</p>
      </div>
    </header>

    <div v-if="loading" class="loading-state" role="status">
      Carregando indicadores…
    </div>
    <div v-else-if="error" class="empty-state" role="alert">
      <h2>Dashboard indisponível</h2>
      <p>{{ error }}</p>
      <button type="button" @click="loadDashboard()">Tentar novamente</button>
    </div>
    <template v-else>
      <dl class="kpi-grid">
        <div class="kpi kpi--accent">
          <dt>Valor vendido</dt>
          <dd class="kpi-value">{{ money(summary.soldAmountCents) }}</dd>
          <dd class="kpi-meta">Total histórico dos pedidos confirmados</dd>
        </div>
        <div class="kpi">
          <dt>Vendas</dt>
          <dd class="kpi-value">{{ summary.confirmedCount }}</dd>
          <dd class="kpi-meta">Pedidos confirmados</dd>
        </div>
        <div class="kpi">
          <dt>Ticket médio</dt>
          <dd class="kpi-value">{{ money(summary.averageTicketCents) }}</dd>
          <dd class="kpi-meta">Valor vendido dividido pelas vendas</dd>
        </div>
        <div class="kpi">
          <dt>Pedidos pendentes</dt>
          <dd class="kpi-value">{{ summary.pendingCount }}</dd>
          <dd class="kpi-meta">
            <RouterLink to="/pedidos">Ver carteira de pedidos</RouterLink>
          </dd>
        </div>
      </dl>

      <div class="dash-grid section-gap">
        <section class="surface" aria-labelledby="sales-reading-title">
          <div class="panel-head">
            <h2 id="sales-reading-title">Leitura das vendas</h2>
            <p>Somente pedidos confirmados</p>
          </div>
          <dl class="rank">
            <div class="rank-row metric-row">
              <dt>Peças vendidas</dt>
              <dd class="rank-value">{{ summary.totalPiecesSold }}</dd>
            </div>
            <div class="rank-row metric-row">
              <dt>Peças por venda</dt>
              <dd class="rank-value">{{ piecesPerSale }}</dd>
            </div>
          </dl>
          <p><RouterLink to="/pedidos">Analisar pedidos</RouterLink></p>
        </section>
        <section class="surface" aria-labelledby="attention-title">
          <div class="panel-head">
            <h2 id="attention-title">Atendimento agora</h2>
            <p>Nas 100 conversas mais recentes</p>
          </div>
          <dl class="rank">
            <div class="rank-row metric-row">
              <dt>Pedem atenção</dt>
              <dd class="rank-value">{{ attentionCount }}</dd>
            </div>
            <div class="rank-row metric-row">
              <dt>Sem responsável</dt>
              <dd class="rank-value">{{ unassignedCount }}</dd>
            </div>
          </dl>
          <p><RouterLink to="/inbox">Abrir Caixa de Entrada</RouterLink></p>
        </section>
      </div>

      <div class="section-gap">
        <section class="surface" aria-labelledby="channels-title">
          <div class="panel-head">
            <h2 id="channels-title">Conversas por canal</h2>
            <p>Até 100 conversas mais recentes</p>
          </div>
          <dl class="rank">
            <div
              v-for="channel in channelCounts"
              :key="channel.channel"
              class="rank-row channel-row"
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
                {{ conversationLabel(conversation) }}
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

<style scoped>
.metric-row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.metric-row .rank-value {
  grid-column: auto;
}
@media (max-width: 480px) {
  .channel-row {
    grid-template-columns: minmax(5rem, 7rem) minmax(0, 1fr) auto;
    gap: 0.5rem;
  }
  .channel-row .rank-value {
    grid-column: auto;
  }
}
</style>
