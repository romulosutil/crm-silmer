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
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { liveTime, useDashboardRegion } from '../lib/dashboard-live.js';
import { minutesLabel } from '../lib/dashboard-metrics.js';

const route = useRoute();
const router = useRouter();
const connection = inject('liveConnection', ref('indisponível'));
const liveEvent = inject('liveEvent', ref(null));
const storeCount = inject('storeNewCount', ref(0));
const queueRegion = useDashboardRegion(),
  ordersRegion = useDashboardRegion(),
  factsRegion = useDashboardRegion();
const { data: queue, error: queueError, readAt: queueRead } = queueRegion;
const { data: orders, error: ordersError, readAt: ordersRead } = ordersRegion;
const { data: history, error: factsError, readAt: factsRead } = factsRegion;
const gap = ref(true);
const center = ref(null);
let returnTarget;
function rememberLink(event) {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  const link = event.target.closest('a');
  if (!link || !center.value?.contains(link)) return;
  const section = link.closest('section');
  globalThis.history.replaceState(
    {
      ...globalThis.history.state,
      dashboardLiveFocus: {
        path: route.fullPath,
        href: link.getAttribute('href'),
        section: section?.getAttribute('aria-labelledby'),
      },
    },
    '',
  );
}
function restoreFocus() {
  if (!returnTarget || returnTarget.path !== route.fullPath || !center.value)
    return;
  const saved = returnTarget;
  returnTarget = null;
  globalThis.history.replaceState(
    { ...globalThis.history.state, dashboardLiveFocus: null },
    '',
  );
  const active = document.activeElement;
  if (active && active !== document.body && !active.matches('h1,h2,[role=tab]'))
    return;
  const link = Array.from(center.value.querySelectorAll('a')).find(
    (item) => item.getAttribute('href') === saved.href,
  );
  (link ?? document.getElementById(saved.section))?.focus();
}
async function retryRegion(event, load) {
  const button = event.currentTarget;
  const heading = button.closest('section')?.querySelector('h2');
  if (await load()) {
    await nextTick();
    if (document.activeElement === document.body) heading?.focus();
  }
}
const options = [
  { id: 'todas', label: 'Todas as esperas', key: 'total' },
  { id: 'sem-responsavel', label: 'Sem responsável', key: 'unclaimed' },
  { id: 'resposta', label: 'Aguardando resposta humana', key: 'waiting' },
  { id: 'atrasada', label: 'Acima de 15 min úteis', key: 'late' },
];
const filter = computed(
  () => options.find((o) => o.id === route.query.fila)?.id ?? 'todas',
);
const page = computed(() =>
  /^[1-9]\d{0,5}$/u.test(String(route.query.pagina))
    ? Number(route.query.pagina)
    : 1,
);
const before = computed(() =>
  /^[1-9]\d{0,17}$/u.test(String(route.query.antes))
    ? String(route.query.antes)
    : '',
);
const queueUrl = computed(
  () =>
    `/api/v1/dashboard/live?region=queue&filter=${filter.value}&page=${page.value}`,
);
const factsUrl = computed(
  () =>
    '/api/v1/dashboard/live?region=facts' +
    (before.value ? '&before=' + before.value : ''),
);
const factLabels = {
  claimed: 'Atendimento assumido',
  printed: 'Primeira impressão da loja',
  confirmed: 'Pedido confirmado',
  delivery: 'Entrega registrada',
};
const bars = computed(() =>
  orders.value
    ? [
        {
          label: 'Pedidos a confirmar',
          count: orders.value.pendingCount,
          to: '/pedidos?status=pendente',
        },
        {
          label: 'Entregas atrasadas',
          count: orders.value.deliveries.overdueCount,
          to: '/pedidos?entrega=atrasada',
        },
        {
          label: 'Próximas entregas · 7 dias',
          count: orders.value.deliveries.dueSoonCount,
          to: '/pedidos?entrega=proxima',
        },
        {
          label: 'Primeira impressão da loja',
          count: orders.value.storeNewCount,
          to: '/pedidos?origem=loja&impressao=pendente',
        },
      ]
    : [],
);
const maximum = computed(() =>
  Math.max(1, ...bars.value.map((row) => row.count)),
);
const status = computed(() =>
  connection.value !== 'conectado'
    ? 'Sem conexão ao vivo'
    : gap.value || queueError.value || ordersError.value || factsError.value
      ? 'Sincronização pendente'
      : 'Ao vivo',
);
let timer,
  coast,
  reading = false,
  pending = false,
  disposed = false,
  revision = 0,
  lastCursor = '';
function changeQuery(query) {
  void router.push({ path: route.path, query: { ...route.query, ...query } });
}
async function readOrders() {
  const ok = await ordersRegion.load('/api/v1/orders/summary?period=hoje');
  if (ok && Number.isSafeInteger(orders.value?.storeNewCount))
    storeCount.value = orders.value.storeNewCount;
  return ok;
}
async function refresh() {
  if (disposed || document.visibilityState === 'hidden') return;
  if (reading) {
    pending = true;
    return;
  }
  reading = true;
  const version = revision;
  try {
    const result = await Promise.all([
      queueRegion.load(queueUrl.value),
      factsRegion.load(factsUrl.value),
      readOrders(),
    ]);
    if (!disposed && version === revision) {
      gap.value = !result.every(Boolean);
      if (returnTarget) {
        await nextTick();
        restoreFocus();
      }
    }
  } finally {
    reading = false;
    if (pending) {
      pending = false;
      schedule();
    }
  }
}
// A burst gets one trailing read even if another request is in flight.
// Preserve the DOM and focus for records that survive the new snapshot.
function schedule() {
  if (!coast)
    coast = globalThis.setTimeout(() => {
      coast = 0;
      void refresh();
    }, 180);
}
function reset() {
  revision++;
  gap.value = true;
  lastCursor = '';
  schedule();
}
watch(connection, (state) => {
  if (state === 'conectado') reset();
});
watch(liveEvent, (event) => {
  if (!event) return;
  if (event.reset) {
    reset();
    return;
  }
  if (
    ![
      'inbox.order.changed',
      'inbox.conversation.changed',
      'identity.user.changed',
    ].includes(event.type)
  )
    return;
  if (event.cursor && String(event.cursor) === lastCursor) return;
  lastCursor = String(event.cursor ?? '');
  schedule();
});
watch(queueUrl, (url) => {
  void queueRegion.load(url);
});
watch(factsUrl, (url) => {
  void factsRegion.load(url);
});
function visible() {
  if (document.visibilityState === 'visible') reset();
}
onMounted(() => {
  returnTarget = globalThis.history.state?.dashboardLiveFocus;
  void refresh();
  timer = globalThis.setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', visible);
});
onBeforeUnmount(() => {
  disposed = true;
  globalThis.clearTimeout(coast);
  globalThis.clearInterval(timer);
  document.removeEventListener('visibilitychange', visible);
});
</script>
<template>
  <div ref="center" class="live-center" @click.capture="rememberLink">
    <div class="dashboard-section-head">
      <p>
        <strong>{{ status }}</strong
        ><template v-if="queueRead">
          · Fila lida em {{ liveTime(queueRead) }} (São Paulo)</template
        >
      </p>
      <button type="button" class="secondary" @click="refresh">
        Reler filas e histórico
      </button>
    </div>
    <section aria-labelledby="live-queue-title" class="live-panel">
      <h2 tabindex="-1" id="live-queue-title">Fila de atenção</h2>
      <div
        role="group"
        aria-label="Filtro da fila de atenção"
        class="live-filters"
      >
        <button
          v-for="option in options"
          :key="option.id"
          class="chip"
          type="button"
          :aria-pressed="filter === option.id"
          @click="changeQuery({ fila: option.id, pagina: undefined })"
        >
          {{ option.label
          }}<span v-if="queue && option.id !== 'todas'">
            · {{ queue[option.key] }}</span
          >
        </button>
      </div>
      <p v-if="queueError">
        {{ queueError }}
        <button
          type="button"
          class="secondary"
          @click="retryRegion($event, () => queueRegion.load(queueUrl))"
        >
          Tentar ler a fila
        </button>
      </p>
      <template v-if="queue">
        <p>
          {{ queue.total }}
          {{ queue.total === 1 ? 'atendimento' : 'atendimentos' }} · Maior
          espera útil:
          {{
            queue.oldestMinutes === null
              ? '—'
              : minutesLabel(queue.oldestMinutes)
          }}.
        </p>
        <ul v-if="queue.rows.length" class="live-list">
          <li v-for="row in queue.rows" :key="row.id">
            <RouterLink :to="'/inbox/' + encodeURIComponent(row.id)">
              <strong>{{
                row.kind === 'resposta'
                  ? 'Aguardando resposta humana'
                  : 'Sem responsável'
              }}</strong>
              <span
                >Atendimento {{ row.id.slice(-8) }} ·
                {{ minutesLabel(row.minutes) }} úteis</span
              >
            </RouterLink>
          </li>
        </ul>
        <p v-else>Nenhum atendimento nesta fila.</p>
        <div
          v-if="page > 1 || page * queue.pageSize < queue.total"
          class="live-filters"
        >
          <button
            v-if="page > 1"
            class="secondary"
            type="button"
            @click="changeQuery({ pagina: String(page - 1) })"
          >
            Atendimentos anteriores
          </button>
          <button
            v-if="page * queue.pageSize < queue.total"
            class="secondary"
            type="button"
            @click="changeQuery({ pagina: String(page + 1) })"
          >
            Próximos atendimentos
          </button>
        </div>
      </template>
      <p v-else-if="!queueError">Consultando fila…</p>
      <RouterLink to="/inbox?situacao=agente"
        >Conversas com o agente<span v-if="queue">
          · {{ queue.withAgent }}</span
        ></RouterLink
      >
    </section>
    <section aria-labelledby="live-orders-title" class="live-panel">
      <h2 tabindex="-1" id="live-orders-title">Pedidos e entregas</h2>
      <p v-if="ordersRead">
        Leitura de {{ liveTime(ordersRead) }} (São Paulo).
      </p>
      <p v-if="ordersError">
        {{ ordersError }}
        <button
          type="button"
          class="secondary"
          @click="retryRegion($event, readOrders)"
        >
          Tentar ler pedidos e entregas
        </button>
      </p>
      <template v-if="orders">
        <RouterLink
          v-for="row in bars"
          :key="row.to"
          :to="row.to"
          class="order-queue-link"
        >
          <span>{{ row.label }}</span
          ><span class="queue-track" aria-hidden="true"
            ><i :style="{ width: (100 * row.count) / maximum + '%' }"></i
          ></span>
          <strong
            >{{ row.count }}
            {{ row.count === 1 ? 'pedido' : 'pedidos' }}</strong
          >
        </RouterLink>
        <small
          >Escala comum de 0 a {{ maximum }}
          {{ maximum === 1 ? 'pedido' : 'pedidos' }}.</small
        >
      </template>
      <p v-else-if="!ordersError">Consultando pedidos e entregas…</p>
    </section>
    <section aria-labelledby="live-history-title" class="live-panel">
      <h2 tabindex="-1" id="live-history-title">Atividade recente</h2>
      <p v-if="factsRead">Leitura de {{ liveTime(factsRead) }} (São Paulo).</p>
      <p v-if="factsError">
        {{ factsError }}
        <button
          type="button"
          class="secondary"
          @click="retryRegion($event, () => factsRegion.load(factsUrl))"
        >
          Tentar ler o histórico
        </button>
      </p>
      <template v-if="history">
        <ul v-if="history.facts.length" class="live-list">
          <li v-for="fact in history.facts" :key="fact.cursor">
            <RouterLink
              :to="
                (fact.kind === 'claimed' ? '/inbox/' : '/pedidos/') +
                encodeURIComponent(fact.recordId)
              "
            >
              <strong>{{ factLabels[fact.kind] }}</strong
              ><span
                >{{
                  fact.reference || 'Atendimento ' + fact.recordId.slice(-8)
                }}
                · <time :datetime="fact.at">{{ liveTime(fact.at) }}</time></span
              >
            </RouterLink>
          </li>
        </ul>
        <p v-else>Nenhuma atividade recente neste recorte.</p>
        <div class="live-filters">
          <button
            v-if="history.nextCursor"
            type="button"
            class="secondary"
            @click="changeQuery({ antes: history.nextCursor })"
          >
            Ver fatos anteriores
          </button>
          <button
            v-if="before"
            type="button"
            class="secondary"
            @click="changeQuery({ antes: undefined })"
          >
            Ver fatos mais recentes
          </button>
        </div>
      </template>
      <p v-else-if="!factsError">Consultando histórico…</p>
    </section>
  </div>
</template>
<style scoped>
.live-center {
  display: grid;
  gap: var(--space-4);
  min-inline-size: 0;
}
.live-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  min-inline-size: 0;
}
.live-panel h2 {
  margin-block: 0 var(--space-3);
  font-size: var(--text-lg);
}
.live-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.live-filters button[aria-pressed='true'] {
  border: 2px solid currentColor;
  font-weight: var(--weight-semibold);
}
.live-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.live-list a,
.order-queue-link {
  display: grid;
  align-items: center;
  gap: var(--space-2);
  padding-block: var(--space-2);
  min-block-size: var(--target-min);
  color: var(--color-text);
  border-block-end: 1px solid var(--color-border);
  overflow-wrap: anywhere;
}
.live-list a {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
}
.order-queue-link {
  grid-template-columns: minmax(0, 1.7fr) minmax(1rem, 1fr) auto;
  text-decoration: none;
}
.live-list a:hover,
.order-queue-link:hover {
  text-decoration: underline;
}
.queue-track {
  display: block;
  background: var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  height: 0.6rem;
}
.queue-track i {
  display: block;
  height: 100%;
  background: var(--color-accent-solid);
}
</style>
