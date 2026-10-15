<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import { request } from '../lib/api-client.js';
import {
  PERIODS,
  assistantIndicator,
  dueSoonIndicator,
  longDay,
  mineIndicator,
  myOrdersIndicator,
  overdueIndicator,
  pendingIndicator,
  replyIndicator,
  soldIndicator,
  waitingIndicator,
} from '../lib/dashboard-format.js';
import { storeNoticeText } from '../lib/order-format.js';

// Pesquisa de UX de 15/10/2026, achado 2: o Painel responde às perguntas de
// cada papel. O gestor vê o dia (vendas do período, entregas, quem espera
// uma pessoa e a saúde do assistente); a atendente vê a própria fila
// primeiro. Cada indicador é um link para a lista já filtrada.
const ADMIN_CAPABILITY = 'COMMERCIAL_ADMIN';

const heading = ref(null);
const liveEvent = inject('liveEvent', ref(null));
const sessionUser = inject(
  'sessionUser',
  computed(() => ({})),
);
// LOJ-32: the menu shows the same number; the shell does not read it again
// while the Dashboard is open.
const menuStoreCount = inject('storeNewCount', ref(0));
const loading = ref(true);
const hasLoaded = ref(false);
const error = ref('');
const queueError = ref('');
const period = ref('hoje');
const periodAnnouncement = ref('');
/** @type {import('vue').Ref<Record<string, any>>} */
const summary = ref({});
/** @type {import('vue').Ref<Record<string, any>|null>} */
const queue = ref(null);
let controller;
let refreshTimer = 0;

const isManager = computed(() =>
  (sessionUser.value?.capabilities ?? []).includes(ADMIN_CAPABILITY),
);

// LOJ-31 (ADR 031): paid site orders whose ficha nobody printed yet. The
// notice is one link to the list filtered on "Loja do site"; it disappears
// with the last first print, which reaches here as `inbox.order.changed`.
const storeNotice = computed(() =>
  storeNoticeText(
    summary.value.storeNewCount,
    summary.value.storeNewOldestPaidAt,
  ),
);

const today = computed(() => longDay(summary.value.today));
const intro = computed(() => {
  const context = isManager.value
    ? 'vendas, entregas e quem espera atendimento'
    : 'sua fila e as entregas';
  return today.value ? `${today.value}: ${context}.` : `Hoje: ${context}.`;
});
const soldLabel = computed(
  () => PERIODS.find((option) => option.key === period.value)?.sold ?? '',
);

const now = computed(() => queue.value?.generatedAt);
const cards = computed(() => ({
  assistant: {
    ...assistantIndicator(queue.value?.assistant, now.value),
    label: 'Assistente',
    to: { path: '/inbox', query: { situacao: 'agente' } },
  },
  dueSoon: {
    ...dueSoonIndicator(summary.value.deliveries),
    label: 'Próximas entregas',
    to: { path: '/pedidos', query: { entrega: 'proxima' } },
  },
  mine: {
    ...mineIndicator(queue.value?.mine, now.value),
    label: 'Minhas conversas',
    to: { path: '/inbox', query: { fila: 'minhas' } },
  },
  myOrders: {
    ...myOrdersIndicator(queue.value?.mine?.pendingOrderCount),
    label: 'Meus pedidos pendentes',
    to: { path: '/pedidos', query: { status: 'pendente', vendedor: 'eu' } },
  },
  reply: {
    ...replyIndicator(queue.value?.mine, now.value),
    label: 'Responder agora',
    to: { path: '/inbox', query: { fila: 'minhas' } },
  },
  overdue: {
    ...overdueIndicator(summary.value.deliveries),
    label: 'Entregas atrasadas',
    to: { path: '/pedidos', query: { entrega: 'atrasada' } },
  },
  pending: {
    ...pendingIndicator(summary.value.pendingCount),
    label: 'Pedidos a confirmar',
    to: { path: '/pedidos', query: { status: 'pendente' } },
  },
  sold: {
    ...soldIndicator(summary.value.period),
    label: soldLabel.value,
    to: { path: '/pedidos', query: { status: 'confirmado' } },
  },
  waiting: {
    ...waitingIndicator(queue.value?.waitingHandoff, now.value),
    label: 'Esperando vendedor',
    to: { path: '/inbox', query: { situacao: 'aguardando' } },
  },
}));

// Mobile-first (PO, 15/10/2026): the seller works from the phone, so their
// home is "Minha fila" — what to answer now, what is stalled waiting for a
// seller and their own pending orders — then the deliveries. The manager
// reads the day first: sales of the period, deliveries, then attendance.
const sections = computed(() =>
  isManager.value
    ? [
        {
          cards: ['sold', 'pending', 'overdue', 'dueSoon'],
          id: 'orders',
          period: true,
          title: 'Vendas e entregas',
        },
        {
          cards: ['waiting', 'assistant', 'mine'],
          id: 'attendance',
          queue: true,
          title: 'Atendimento',
        },
      ]
    : [
        {
          cards: ['reply', 'waiting', 'myOrders'],
          id: 'attendance',
          queue: true,
          title: 'Minha fila',
        },
        { cards: ['overdue', 'dueSoon'], id: 'orders', title: 'Entregas' },
      ],
);

async function loadDashboard({ announce = false } = {}) {
  controller?.abort();
  const currentController = new AbortController();
  controller = currentController;
  loading.value = true;
  const signal = currentController.signal;
  const [orders, inbox] = await Promise.allSettled([
    request(
      `/api/v1/orders/summary?period=${encodeURIComponent(period.value)}`,
      {
        signal,
      },
    ),
    request('/api/v1/inbox/summary', { signal }),
  ]);
  if (controller !== currentController) return;
  loading.value = false;
  if (orders.status === 'fulfilled') {
    summary.value = orders.value.data ?? {};
    const storeCount = Number(summary.value.storeNewCount ?? 0);
    menuStoreCount.value =
      Number.isSafeInteger(storeCount) && storeCount > 0 ? storeCount : 0;
    hasLoaded.value = true;
    error.value = '';
    if (announce) periodAnnouncement.value = `${soldLabel.value} atualizado.`;
  } else if (orders.reason?.name !== 'AbortError') {
    error.value = hasLoaded.value
      ? 'Não foi possível atualizar os indicadores. Os dados exibidos podem estar desatualizados.'
      : 'Não foi possível carregar os indicadores.';
  }
  if (inbox.status === 'fulfilled') {
    queue.value = inbox.value.data ?? null;
    queueError.value = '';
  } else if (inbox.reason?.name !== 'AbortError') {
    queueError.value = queue.value
      ? 'A fila não foi atualizada agora. Os números podem estar desatualizados.'
      : 'Não foi possível consultar a fila agora.';
  }
}

/** @param {string} key */
function choosePeriod(key) {
  if (period.value === key) return;
  period.value = key;
  periodAnnouncement.value = '';
  void loadDashboard({ announce: true });
}

function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void loadDashboard();
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
  <div class="page dashboard-page">
    <header class="page-heading">
      <div>
        <h1 ref="heading" tabindex="-1">Dashboard</h1>
        <p>{{ intro }}</p>
      </div>
    </header>

    <!-- LOJ-31: the region exists from the first paint so the arrival of a
         new site order is announced; the link is the whole notice. -->
    <div class="store-notice-region" aria-live="polite">
      <RouterLink
        v-if="storeNotice"
        class="store-notice"
        :to="{ path: '/pedidos', query: { origem: 'loja' } }"
      >
        <span class="store-notice-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path
              d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"
            />
          </svg>
        </span>
        <span class="store-notice-text">
          <strong>{{ storeNotice.title }}</strong>
          <span>{{ storeNotice.detail }}</span>
        </span>
        <span class="store-notice-action">
          Ver pedidos
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="m9 6 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6Z" />
          </svg>
        </span>
      </RouterLink>
    </div>

    <div v-if="loading && !hasLoaded" class="loading-state" role="status">
      Carregando indicadores…
    </div>
    <div v-else-if="error && !hasLoaded" class="empty-state" role="alert">
      <h2>Dashboard indisponível</h2>
      <p>{{ error }}</p>
      <button type="button" @click="loadDashboard()">Tentar novamente</button>
    </div>
    <template v-else>
      <div v-if="error" class="audit-note" role="alert">
        <p>{{ error }}</p>
        <button type="button" :disabled="loading" @click="loadDashboard()">
          {{ loading ? 'Consultando…' : 'Tentar novamente' }}
        </button>
      </div>
      <p v-if="periodAnnouncement" class="sr-only" role="status">
        {{ periodAnnouncement }}
      </p>

      <section
        v-for="section in sections"
        :key="section.id"
        class="dashboard-section"
        :aria-labelledby="`dashboard-${section.id}-title`"
      >
        <div class="dashboard-section-head">
          <h2 :id="`dashboard-${section.id}-title`">{{ section.title }}</h2>
          <div
            v-if="section.period"
            class="segmented-options"
            role="group"
            aria-label="Período das vendas"
          >
            <button
              v-for="option in PERIODS"
              :key="option.key"
              type="button"
              :aria-pressed="period === option.key"
              @click="choosePeriod(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div v-if="section.queue && queueError" class="audit-note" role="alert">
          <p>{{ queueError }}</p>
          <button type="button" :disabled="loading" @click="loadDashboard()">
            {{ loading ? 'Consultando…' : 'Tentar novamente' }}
          </button>
        </div>
        <ul v-if="!section.queue || queue" class="metric-grid" role="list">
          <li v-for="key in section.cards" :key="key">
            <RouterLink
              class="metric-card"
              :to="cards[key].to"
              :data-tone="cards[key].tone || undefined"
            >
              <span class="metric-head">
                <span class="metric-label">{{ cards[key].label }}</span>
                <AppIcon name="chevron" class="metric-go" />
              </span>
              <span class="metric-value">{{ cards[key].value }}</span>
              <span class="metric-detail">
                <span
                  v-if="cards[key].badge"
                  class="badge"
                  :data-tone="cards[key].tone"
                  >{{ cards[key].badge }}</span
                >
                {{ cards[key].detail }}
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
