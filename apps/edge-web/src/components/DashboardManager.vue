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
import AppIcon from './AppIcon.vue';
import DashboardCommercialResult from './DashboardCommercialResult.vue';
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
// The Inbox owns the queue: unclaimed conversations open the owner scope,
// everything else opens Responder for everyone (inboxStateFromRoute, D1).
const queueLink = computed(() =>
  urgency.value?.filter === 'sem-responsavel'
    ? { path: '/inbox', query: { fila: 'sem-responsavel' } }
    : { path: '/inbox', query: { situacao: 'atender' } },
);
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
const oldestWaitLabel = computed(() => {
  if (!urgency.value) return '';
  const minutes =
    queue.data.value?.oldestMinutesByFilter?.[urgency.value.filter];
  return minutes != null ? minutesLabel(minutes) : '';
});
const urgencyState = computed(() => {
  if (queue.error.value && !urgency.value) return 'error';
  if (!urgency.value) return 'loading';
  return urgency.value.filter === 'todas' ? 'calm' : 'urgent';
});
const urgencyIcon = computed(() => {
  if (urgencyState.value === 'calm') return 'check';
  if (urgencyState.value === 'loading') return 'clock';
  return 'alert';
});
let eventTimer = 0;
let ageTimer = 0;

async function readStoreNotice() {
  if (await store.load('/api/v1/orders/summary?period=hoje')) {
    menuCount.value = store.data.value?.storeNewCount ?? 0;
  }
}

/** @param {string} value */
function choosePeriod(value) {
  void router.replace({ query: { ...route.query, periodo: value } });
}

function readUrgency() {
  if (document.visibilityState === 'visible')
    return queue.load('/api/v1/dashboard/live?region=queue');
  return Promise.resolve(false);
}

async function retryUrgency() {
  if (await readUrgency()) {
    await nextTick();
    urgencyHeading.value?.focus();
  }
}

function resume() {
  if (document.visibilityState !== 'visible') return;
  revision.value += 1;
  void readStoreNotice();
  void readUrgency();
}

void readUrgency();
void readStoreNotice();
watch(liveEvent, (event) => {
  if (
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
    <header class="page-heading dashboard-manager-head">
      <div>
        <h1 ref="heading" tabindex="-1">Dashboard</h1>
        <p>Resultado comercial e situação da fila.</p>
      </div>
      <fieldset class="dashboard-options">
        <legend class="sr-only">Período do resultado comercial</legend>
        <label v-for="option in PERIODS" :key="option.key"
          ><input
            type="radio"
            name="dashboard-period"
            :value="option.key"
            :checked="period === option.key"
            @change="choosePeriod(option.key)"
          /><span>{{ option.label }}</span></label
        >
      </fieldset>
    </header>
    <section
      class="next-step"
      aria-labelledby="dashboard-urgency"
      :data-state="urgencyState"
    >
      <div class="next-step-main">
        <span class="next-step-icon" aria-hidden="true">
          <AppIcon :name="urgencyIcon" />
        </span>
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
          <p v-else-if="queue.error.value" class="next-step-text">
            {{ queue.error.value }}
          </p>
          <p v-else class="next-step-text">Consultando fila…</p>
          <p v-if="queueTime || oldestWaitLabel" class="next-step-meta">
            <span v-if="queueTime" class="next-step-meta-item">
              <AppIcon name="clock" />
              {{
                ['reconectando', 'indisponível'].includes(connection)
                  ? 'Sem conexão ao vivo · última leitura às'
                  : 'Leitura às'
              }}
              {{ queueTime }} (São Paulo)
            </span>
            <span
              v-if="oldestWaitLabel"
              class="next-step-meta-item next-step-meta-wait"
            >
              Maior espera: {{ oldestWaitLabel }} de expediente
            </span>
          </p>
          <p v-if="urgency && queue.error.value" class="next-step-error">
            {{ queue.error.value }}
          </p>
        </div>
      </div>
      <div class="next-step-actions">
        <button
          v-if="queue.error.value"
          type="button"
          class="next-step-link"
          @click="retryUrgency"
        >
          Tentar novamente
        </button>
        <RouterLink v-if="urgency" class="next-step-link" :to="queueLink"
          >Abrir fila<AppIcon name="arrow-right"
        /></RouterLink>
      </div>
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
    <div class="dashboard-agent-footer">
      <RouterLink class="dashboard-agent-link" to="/dashboard/agente">
        <span class="dashboard-agent-icon" aria-hidden="true">
          <AppIcon name="bot" />
        </span>
        <span class="dashboard-agent-copy">
          Ver {{ performanceTitle().toLocaleLowerCase('pt-BR') }}
        </span>
        <AppIcon name="chevron" class="dashboard-agent-go" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.dashboard-manager-head {
  align-items: center;
  flex-wrap: wrap;
}
.dashboard-options {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.125rem;
  padding: 0.1875rem;
  margin: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.dashboard-options label {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: calc(var(--control-height) - 0.375rem);
  padding-inline: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: 1.2;
  white-space: nowrap;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--easing-standard),
    color var(--duration-fast) var(--easing-standard);
}
.dashboard-options label:hover {
  color: var(--color-text);
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
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-raised);
}
.dashboard-options label:has(:focus-visible) {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: 2px;
}
@media (max-width: 768px) {
  .dashboard-options {
    inline-size: 100%;
  }
  .dashboard-options label {
    flex: 1 1 0;
    min-block-size: var(--target-min);
  }
}
@media (pointer: coarse) {
  .dashboard-options label {
    min-block-size: var(--target-min);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dashboard-options label {
    transition: none;
  }
}
</style>
