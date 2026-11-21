<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { RouterLink } from 'vue-router';
import DashboardStoreNotice from './DashboardStoreNotice.vue';
import AppIcon from './AppIcon.vue';
import DashboardActions from './DashboardActions.vue';
import DashboardPerformance from './DashboardPerformance.vue';
import { request } from '../lib/api-client.js';
import {
  dueSoonIndicator,
  longDay,
  myOrdersIndicator,
  nextStep,
  overdueIndicator,
  replyIndicator,
  unavailableIndicator,
  waitingIndicator,
} from '../lib/dashboard-format.js';
import { storeNoticeText } from '../lib/order-format.js';

const heading = ref(null);
const ordersRetry = ref(null);
const liveEvent = inject('liveEvent', ref(null));
// LOJ-32: the menu shows the same number; the shell does not read it again
// while the Dashboard is open.
const menuStoreCount = inject('storeNewCount', ref(0));
const loading = ref(true);
const summaryLoaded = ref(false);
const hasLoaded = computed(() => summaryLoaded.value || Boolean(queue.value));
const error = ref('');
const queueError = ref('');
const dashboardRevision = ref(0);
/** @type {import('vue').Ref<Record<string, any>>} */
const summary = ref({});
/** @type {import('vue').Ref<Record<string, any>|null>} */
const queue = ref(null);
let controller;
let refreshTimer = 0;

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
const intro = computed(() =>
  today.value
    ? `${today.value}: sua fila e as entregas.`
    : 'Hoje: sua fila e as entregas.',
);

// PNL-01: one next step for the reader's role, from the same summaries.
const step = computed(() =>
  error.value
    ? {
        key: 'orders-unavailable',
        label: 'Os pedidos não responderam; tente de novo mais abaixo.',
        action: '',
        to: null,
      }
    : nextStep({
        isManager: false,
        queue: queue.value,
        queueError: queueError.value,
        summary: summary.value,
      }),
);

const now = computed(() => queue.value?.generatedAt);
// PNL-03: without any queue answer the queue cards read "—", never "0". A
// queue read earlier keeps its numbers, flagged as possibly outdated.
/** @param {() => import('../lib/dashboard-format.js').Indicator} indicator */
const fromQueue = (indicator) =>
  queue.value ? indicator() : unavailableIndicator();
// FIN-02 / T130: a failed first sales read must not look like zero sales.
/** @param {() => import('../lib/dashboard-format.js').Indicator} indicator */
const fromSummary = (indicator) =>
  summaryLoaded.value
    ? indicator()
    : {
        ...unavailableIndicator(),
        detail: 'Sem dados de vendas e entregas agora',
      };
const cards = computed(() => ({
  dueSoon: {
    ...fromSummary(() => dueSoonIndicator(summary.value.deliveries)),
    label: 'Próximas entregas',
    to: { path: '/pedidos', query: { entrega: 'proxima' } },
  },
  myOrders: {
    ...fromQueue(() => myOrdersIndicator(queue.value?.mine?.pendingOrderCount)),
    label: 'Meus pedidos pendentes',
    to: { path: '/pedidos', query: { status: 'pendente', vendedor: 'eu' } },
  },
  reply: {
    ...fromQueue(() => replyIndicator(queue.value?.mine, now.value)),
    label: 'Responder agora',
    to: { path: '/inbox', query: { fila: 'minhas' } },
  },
  overdue: {
    ...fromSummary(() => overdueIndicator(summary.value.deliveries)),
    label: 'Entregas atrasadas',
    to: { path: '/pedidos', query: { entrega: 'atrasada' } },
  },
  waiting: {
    ...fromQueue(() =>
      waitingIndicator(queue.value?.waitingHandoff, now.value),
    ),
    label: 'Esperando vendedor',
    to: { path: '/inbox', query: { situacao: 'aguardando' } },
  },
}));

const sections = [
  {
    cards: ['reply', 'waiting', 'myOrders'],
    id: 'attendance',
    queue: true,
    title: 'Minha fila',
  },
  { cards: ['overdue', 'dueSoon'], id: 'orders', title: 'Entregas' },
];

async function loadDashboard() {
  controller?.abort();
  const currentController = new AbortController();
  controller = currentController;
  loading.value = true;
  const signal = currentController.signal;
  const [orders, inbox] = await Promise.allSettled([
    request('/api/v1/orders/summary?period=hoje', { signal }),
    request('/api/v1/inbox/summary', { signal }),
  ]);
  if (controller !== currentController) return;
  loading.value = false;
  if (orders.status === 'fulfilled') {
    summary.value = orders.value.data ?? {};
    const storeCount = Number(summary.value.storeNewCount ?? 0);
    menuStoreCount.value =
      Number.isSafeInteger(storeCount) && storeCount > 0 ? storeCount : 0;
    summaryLoaded.value = true;
    error.value = '';
  } else if (orders.reason?.name !== 'AbortError') {
    error.value = summaryLoaded.value
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

/** @type {HTMLElement|null} */
let queueHeading = null;
/** @param {any} element */
function setQueueHeading(element) {
  queueHeading = element instanceof HTMLElement ? element : null;
}

// PNL-03: the queue retry stays focusable while it runs (aria-disabled); when
// the queue answers, the button leaves and focus goes to the section title.
async function retryQueue() {
  if (loading.value) return;
  await loadDashboard();
  if (queueError.value) return;
  await nextTick();
  queueHeading?.focus();
}

async function retryOrders() {
  if (loading.value) return;
  await loadDashboard();
  await nextTick();
  if (error.value) ordersRetry.value?.focus();
  else heading.value?.focus();
}

function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void loadDashboard();
  }, 250);
}

function dashboardChanged() {
  dashboardRevision.value += 1;
  void loadDashboard();
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

    <DashboardStoreNotice :notice="storeNotice" />

    <DashboardActions @changed="dashboardChanged">
      <template #summary>
        <DashboardPerformance :revision="dashboardRevision" />
      </template>
    </DashboardActions>

    <details class="dashboard-secondary-sources">
      <summary>Outras filas e entregas</summary>
      <div
        v-if="loading && !hasLoaded && !error"
        class="loading-state"
        role="status"
      >
        Carregando indicadores…
      </div>
      <div v-else-if="error && !hasLoaded" class="empty-state" role="alert">
        <h2>Dashboard indisponível</h2>
        <p>{{ error }}</p>
        <button
          ref="ordersRetry"
          type="button"
          :aria-disabled="loading ? 'true' : undefined"
          @click="retryOrders()"
        >
          {{ loading ? 'Consultando…' : 'Tentar novamente' }}
        </button>
      </div>
      <template v-else>
        <!-- PNL-01: one next step for the role, no heading of its own (the
           section titles stay the page outline); one button-like link at
           most, after the sentence it acts on. -->
        <section class="next-step" aria-labelledby="dashboard-next-step-label">
          <div class="next-step-body">
            <p id="dashboard-next-step-label" class="next-step-label">
              Próximo passo
            </p>
            <p class="next-step-text">{{ step.label }}</p>
          </div>
          <RouterLink v-if="step.to" class="next-step-link" :to="step.to">
            {{ step.action || 'Ver' }}
          </RouterLink>
        </section>

        <div v-if="error" class="audit-note" role="alert">
          <p>{{ error }}</p>
          <button
            ref="ordersRetry"
            type="button"
            :aria-disabled="loading ? 'true' : undefined"
            @click="retryOrders()"
          >
            {{ loading ? 'Consultando…' : 'Tentar novamente' }}
          </button>
        </div>
        <section
          v-for="section in sections"
          :key="section.id"
          class="dashboard-section"
          :aria-labelledby="`dashboard-${section.id}-title`"
        >
          <div class="dashboard-section-head">
            <h2
              :id="`dashboard-${section.id}-title`"
              :ref="section.queue ? setQueueHeading : undefined"
              :tabindex="section.queue ? -1 : undefined"
            >
              {{ section.title }}
            </h2>
          </div>
          <!-- PNL-03: the section never disappears when the queue fails. -->
          <div
            v-if="section.queue && queueError"
            class="audit-note"
            role="alert"
          >
            <p>{{ queueError }}</p>
            <button
              type="button"
              :aria-disabled="loading ? 'true' : undefined"
              @click="retryQueue()"
            >
              {{ loading ? 'Consultando…' : 'Tentar novamente' }}
            </button>
          </div>
          <ul class="metric-grid" role="list">
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
    </details>
  </div>
</template>
