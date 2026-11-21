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
import {
  RouterLink,
  onBeforeRouteLeave,
  useRoute,
  useRouter,
} from 'vue-router';
import DashboardCommercialResult from './DashboardCommercialResult.vue';
import DashboardLiveCenter from './DashboardLiveCenter.vue';
import DashboardStoreNotice from './DashboardStoreNotice.vue';
import DashboardTeamSummary from './DashboardTeamSummary.vue';
import DashboardYesterday from './DashboardYesterday.vue';
import { PERIODS, plural } from '../lib/dashboard-format.js';
import { useLatestRead } from '../lib/dashboard-read.js';
import { minutesLabel } from '../lib/dashboard-metrics.js';
import { storeNoticeText } from '../lib/order-format.js';
import { performanceTitle } from '../lib/assistant-performance.js';

const panel = ref(null);
const route = useRoute();
const router = useRouter();
const period = computed(
  () =>
    PERIODS.find((option) => option.key === route.query.periodo)?.key ?? 'mes',
);
const central = computed(() => route.query.visao === 'central');
const views = [
  { key: 'resultado', label: 'Resultado comercial' },
  { key: 'central', label: 'Central ao vivo' },
];
const liveEvent = inject('liveEvent', ref(null));
const connection = inject('liveConnection', ref('conectando'));
const menuCount = inject('storeNewCount', ref(0));
const revision = ref(0);
const store = useLatestRead({
  unavailable: 'A consulta dos pedidos novos da loja falhou.',
  stale: 'O aviso da loja usa a última leitura disponível.',
});
const notice = computed(() =>
  storeNoticeText(
    store.data.value?.storeNewCount,
    store.data.value?.storeNewOldestPaidAt,
  ),
);
const heading = ref(null);
const urgencyHeading = ref(null);

const liveHeading = ref(null);
const queue = useLatestRead({
  unavailable: 'Não foi possível consultar a fila.',
  stale:
    'Não foi possível atualizar a fila. Confira o horário da última leitura.',
});
const urgency = computed(() => {
  const data = queue.data.value;
  if (!data) return null;
  if (data.unclaimed > 0)
    return {
      filter: 'sem-responsavel',
      label: plural(
        data.unclaimed,
        'conversa espera vendedor',
        'conversas esperam vendedor',
      ),
    };
  if (data.late > 0)
    return {
      filter: 'atrasada',
      label: plural(
        data.late,
        'conversa espera resposta há mais de 15 minutos úteis',
        'conversas esperam resposta há mais de 15 minutos úteis',
      ),
    };
  if (data.waiting > 0)
    return {
      filter: 'resposta',
      label: plural(
        data.waiting,
        'conversa aguarda resposta',
        'conversas aguardam resposta',
      ),
    };
  return { filter: 'todas', label: 'Fila sem esperas' };
});
const queueTime = computed(() => {
  const stamp = Date.parse(queue.data.value?.generatedAt ?? '');
  return Number.isFinite(stamp)
    ? new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }).format(stamp)
    : '';
});
let eventTimer = 0;
let ageTimer = 0;

async function readStoreNotice() {
  if (
    !central.value &&
    (await store.load('/api/v1/orders/summary?period=hoje'))
  ) {
    menuCount.value = store.data.value?.storeNewCount ?? 0;
  }
}

/** @param {string} key */
function chooseView(key) {
  /** @type {import('vue-router').LocationQueryRaw} */
  const query = { ...route.query, visao: key };
  if (key !== 'central') {
    delete query.fila;
    delete query.pagina;
    delete query.antes;
  }
  void router.replace({ query });
}

/** @param {string} value */
function choosePeriod(value) {
  void router.replace({ query: { ...route.query, periodo: value } });
}

function readUrgency() {
  if (!central.value && document.visibilityState === 'visible')
    return queue.load('/api/v1/dashboard/live?region=queue');
  return Promise.resolve(false);
}

async function retryUrgency() {
  if (await readUrgency()) {
    await nextTick();
    urgencyHeading.value?.focus();
  }
}

async function openQueue() {
  if (!urgency.value) return;
  await router.push({
    query: { ...route.query, visao: 'central', fila: urgency.value.filter },
  });
  await nextTick();
  liveHeading.value?.focus();
}

function resume() {
  if (document.visibilityState !== 'visible' || central.value) return;
  revision.value += 1;
  void readStoreNotice();
  void readUrgency();
}

watch(
  central,
  () => {
    void readUrgency();
    void readStoreNotice();
  },
  { immediate: true },
);
watch(liveEvent, (event) => {
  if (
    central.value ||
    !event ||
    (!event.reset &&
      ![
        'inbox.order.changed',
        'inbox.conversation.changed',
        'inbox.contact.changed',
      ].includes(event.type))
  )
    return;
  if (eventTimer) return;
  eventTimer = globalThis.setTimeout(() => {
    eventTimer = 0;
    resume();
  }, 250);
});
// Keep the return destination on its own history entry. If a filtered row
// disappeared, the heading remains the fallback. A user moving focus wins.
let focusObserver;
let focusTimer = 0;
function stopRestoringFocus() {
  focusObserver?.disconnect();
  globalThis.clearTimeout(focusTimer);
}
onBeforeRouteLeave(() => {
  if (central.value) return;
  const active = document.activeElement;
  if (active instanceof HTMLAnchorElement && panel.value?.contains(active))
    history.replaceState(
      { ...history.state, dashboardReturnHref: active.getAttribute('href') },
      '',
    );
});
function restoreFocus() {
  const href = history.state?.dashboardReturnHref;
  if (typeof href !== 'string') return;
  history.replaceState({ ...history.state, dashboardReturnHref: null }, '');
  function findLink() {
    if (document.activeElement !== heading.value) {
      stopRestoringFocus();
      return true;
    }
    const link = Array.from(panel.value.querySelectorAll('a[href]')).find(
      (node) => node.getAttribute('href') === href,
    );
    if (!(link instanceof HTMLElement)) return false;
    stopRestoringFocus();
    link.focus();
    return true;
  }
  if (!findLink()) {
    focusObserver = new MutationObserver(findLink);
    focusObserver.observe(panel.value, { childList: true, subtree: true });
    focusTimer = globalThis.setTimeout(stopRestoringFocus, 5000);
  }
}
onMounted(() => {
  heading.value?.focus();
  restoreFocus();
  ageTimer = globalThis.setInterval(readUrgency, 30000);
  document.addEventListener('visibilitychange', resume);
});
onBeforeUnmount(() => {
  stopRestoringFocus();
  globalThis.clearTimeout(eventTimer);
  globalThis.clearInterval(ageTimer);
  document.removeEventListener('visibilitychange', resume);
});
</script>

<template>
  <div ref="panel" class="page dashboard-page commercial-dashboard">
    <header class="page-heading">
      <h1 ref="heading" tabindex="-1">Dashboard</h1>
    </header>
    <fieldset class="dashboard-options">
      <legend class="sr-only">Visão do painel</legend>
      <label v-for="view in views" :key="view.key"
        ><input
          type="radio"
          name="dashboard-view"
          :value="view.key"
          :checked="view.key === (central ? 'central' : 'resultado')"
          @change="chooseView(view.key)"
        />{{ view.label }}</label
      >
    </fieldset>
    <template v-if="central">
      <h2 ref="liveHeading" class="sr-only" tabindex="-1">
        Fila da Central ao vivo
      </h2>
      <DashboardLiveCenter />
      <RouterLink class="metric-more" to="/dashboard/agente"
        >Ver {{ performanceTitle().toLocaleLowerCase('pt-BR') }}</RouterLink
      >
    </template>
    <template v-else>
      <fieldset class="dashboard-options">
        <legend>Período do resultado comercial</legend>
        <label v-for="option in PERIODS" :key="option.key"
          ><input
            type="radio"
            name="dashboard-period"
            :value="option.key"
            :checked="period === option.key"
            @change="choosePeriod(option.key)"
          />{{ option.label }}</label
        >
      </fieldset>
      <section class="next-step" aria-labelledby="dashboard-urgency">
        <div class="next-step-body">
          <h2
            id="dashboard-urgency"
            ref="urgencyHeading"
            class="next-step-label"
            tabindex="-1"
          >
            Urgência da fila
          </h2>
          <p v-if="urgency" class="next-step-text">{{ urgency.label }}</p>
          <span v-if="queueTime"
            >{{
              ['reconectando', 'indisponível'].includes(connection)
                ? 'Sem conexão ao vivo · última leitura às'
                : 'Leitura às'
            }}
            {{ queueTime }} (São Paulo)</span
          >
          <span
            v-if="
              urgency &&
              queue.data.value?.oldestMinutesByFilter?.[urgency.filter] != null
            "
          >
            · Maior espera:
            {{
              minutesLabel(
                queue.data.value.oldestMinutesByFilter[urgency.filter],
              )
            }}
            de expediente</span
          >
          <p v-if="queue.error.value">{{ queue.error.value }}</p>
          <p v-else-if="!urgency">Consultando fila…</p>
        </div>
        <button
          v-if="queue.error.value"
          type="button"
          class="next-step-link"
          @click="retryUrgency"
        >
          Tentar novamente
        </button>
        <button
          v-if="urgency"
          type="button"
          class="next-step-link"
          @click="openQueue"
        >
          Abrir fila
        </button>
      </section>
      <DashboardCommercialResult :period="period" :revision="revision" />
      <DashboardStoreNotice :notice="notice" />
      <div v-if="store.error.value" class="audit-note">
        <p>{{ store.error.value }}</p>
        <button type="button" @click="readStoreNotice">
          Atualizar aviso da loja
        </button>
      </div>
      <DashboardTeamSummary :period="period" :revision="revision" />
      <DashboardYesterday />
    </template>
  </div>
</template>

<style scoped>
.dashboard-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  border: 0;
  padding: 0;
  margin: 0 0 var(--space-3);
}
.dashboard-options legend {
  margin-block-end: var(--space-2);
  color: var(--color-text-muted);
  font-weight: var(--weight-medium);
}
.dashboard-options label {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding-inline: var(--space-3);
  cursor: pointer;
}
.dashboard-options input {
  position: absolute;
  opacity: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}
.dashboard-options label:has(:checked) {
  background: var(--color-emphasis-surface);
  color: var(--color-emphasis-text);
  font-weight: var(--weight-semibold);
}
.dashboard-options label:has(:focus-visible) {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
</style>
