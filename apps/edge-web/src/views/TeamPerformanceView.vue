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
import DashboardTeamSummary from '../components/DashboardTeamSummary.vue';
import DashboardTeamTable from '../components/DashboardTeamTable.vue';
import { useLatestRead } from '../lib/dashboard-read.js';
import { shortDay } from '../lib/dashboard-format.js';
import {
  performanceCount,
  performanceMoney,
} from '../lib/dashboard-actions.js';
import {
  businessHoursLabel,
  salesReconciliation,
} from '../lib/dashboard-metrics.js';
import {
  lossTable,
  sellerTable,
  serviceTable,
} from '../lib/team-performance.js';

// PERF-01..08 and MET-01..08 (ADR 059 / ADR 061): the team's numbers for 7
// or 30 days, in three views instead of one wide table (design.md §19). Each
// read fails in its own region with retry (ACT-09); a value from another
// period or a failed read is "—", never zero. No presence or "R$ por hora":
// MET-09..11 stay in the backlog.
const PERIODS = Object.freeze([
  Object.freeze({ days: 1, label: 'Hoje' }),
  Object.freeze({ days: 7, label: '7 dias' }),
  Object.freeze({ days: 0, label: 'Mês' }),
  Object.freeze({ days: 30, label: '30 dias' }),
]);
const VIEWS = Object.freeze([
  Object.freeze({ key: 'vendas', label: 'Vendas' }),
  Object.freeze({ key: 'atendimento', label: 'Atendimento' }),
  Object.freeze({ key: 'perdas', label: 'Perdas' }),
]);
const SEARCH_FROM = 8;

const route = useRoute();
const liveEvent = inject('liveEvent', ref(null));
const heading = ref(null);
const tableHeading = ref(null);
const reasonsHeading = ref(null);
const router = useRouter();
const period = computed(() =>
  ['hoje', '7dias', 'mes', '30dias'].includes(String(route.query.periodo))
    ? String(route.query.periodo)
    : Number(route.query.dias) === 30
      ? '30dias'
      : '7dias',
);
const days = computed(
  () => ({ hoje: 1, mes: 0, '7dias': 7, '30dias': 30 })[period.value],
);
const sellerId = computed(() =>
  typeof route.query.vendedor === 'string' ? route.query.vendedor : '',
);
const view = ref(
  VIEWS.some((option) => option.key === route.query.visao)
    ? String(route.query.visao)
    : 'vendas',
);
const search = ref('');
const announcement = ref('');
let refreshTimer = 0;

const sales = useLatestRead({
  unavailable: 'Não foi possível consultar as vendas da equipe agora.',
  stale: 'Não foi possível atualizar as vendas da equipe.',
});
const service = useLatestRead({
  unavailable: 'Não foi possível consultar os tempos de atendimento agora.',
  stale: 'Não foi possível atualizar os tempos de atendimento.',
});
const cohorts = useLatestRead({
  unavailable: 'Não foi possível consultar a conversão e a resposta no prazo.',
  stale:
    'A última leitura de conversão e resposta no prazo pode estar desatualizada.',
});
const losses = useLatestRead({
  unavailable: 'Não foi possível consultar as perdas agora.',
  stale: 'Não foi possível atualizar as perdas.',
});

/**
 * Show only reads for the selected window, including during replacement requests.
 *
 * @param {ReturnType<typeof useLatestRead>} read
 */
function current(read) {
  const data = read.data.value;
  if (!data) return null;
  if (data.period) return data.period === period.value ? data : null;
  return (days.value === 7 || days.value === 30) &&
    Number(data.days) === days.value
    ? data
    : null;
}
const performance = computed(() => current(sales));
const serviceData = computed(() => current(service));
const lossData = computed(() => current(losses));
const busy = computed(
  () => sales.loading.value || service.loading.value || losses.loading.value,
);

const windowLabel = computed(() => {
  const source = performance.value ?? serviceData.value ?? lossData.value;
  const from = shortDay(source?.from);
  const to = shortDay(source?.to);
  return from && to
    ? `${from} a ${to}`
    : (PERIODS.find((p) => p.days === days.value)?.label ?? '');
});
const hoursLabel = computed(() =>
  businessHoursLabel(serviceData.value?.businessHours),
);

const salesView = computed(() =>
  sellerTable(
    performance.value,
    serviceData.value,
    current(cohorts),
    lossData.value,
  ),
);
const serviceView = computed(() =>
  serviceTable(performance.value, serviceData.value),
);
const lossView = computed(() => lossTable(lossData.value));
const reconciliation = computed(() =>
  performance.value ? salesReconciliation(performance.value) : null,
);

const COLUMNS = Object.freeze({
  vendas: [
    { key: 'sold', label: 'Vendido', sortable: true, meter: true },
    { key: 'orders', label: 'Pedidos', sortable: true },
    { key: 'ticket', label: 'Ticket médio', sortable: true },
    { key: 'withSale', label: 'Com venda', sortable: true },
    { key: 'conversion', label: 'Conversão', sortable: true },
    { key: 'onTime', label: 'Resposta no prazo', sortable: true },
  ],
  atendimento: [
    { key: 'attended', label: 'Atendeu', sortable: true },
    { key: 'assumed', label: 'Assumiu', sortable: true },
    { key: 'closed', label: 'Encerrou', sortable: true },
    { key: 'firstResponse', label: '1ª resposta', sortable: true },
    { key: 'claim', label: 'Para assumir', sortable: true },
    { key: 'unanswered', label: 'Sem resposta', sortable: true },
  ],
  perdas: [
    { key: 'lost', label: 'Perdidos', sortable: true },
    { key: 'reopened', label: 'Reabertos pelo cliente', sortable: true },
    { key: 'reason', label: 'Motivo mais comum' },
  ],
});
const SORTED_BY = Object.freeze({
  vendas: 'sold',
  atendimento: 'attended',
  perdas: 'lost',
});
const NOTES = Object.freeze({
  vendas:
    'Loja do site e sem atribuição têm linhas próprias; o total fecha com a soma.',
  atendimento:
    'Tempos são a mediana em minutos de expediente. Uma conversa pode contar para duas pessoas, por isso esta visão não tem total.',
  perdas:
    'Só conta o que a pessoa marcou como perdido, com motivo. Perda reaberta pelo cliente continua contando.',
});

const table = computed(() => {
  if (view.value === 'atendimento')
    return {
      rows: serviceView.value.rows,
      extraRows: [],
      totalRow: null,
      ready: Boolean(performance.value || serviceData.value),
    };
  if (view.value === 'perdas')
    return {
      rows: lossView.value.rows,
      extraRows: [],
      totalRow: lossView.value.totalRow,
      ready: Boolean(lossData.value),
    };
  return { ...salesView.value, ready: Boolean(performance.value) };
});
const tableReads = computed(() =>
  view.value === 'atendimento'
    ? [sales, service]
    : view.value === 'perdas'
      ? [losses]
      : [sales, cohorts],
);
const tableErrors = computed(() =>
  tableReads.value.map((read) => read.error.value).filter(Boolean),
);
const tableLoading = computed(() =>
  tableReads.value.some((read) => read.loading.value),
);

/** @param {string} value */
function fold(value) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
}
const showSearch = computed(() => table.value.rows.length >= SEARCH_FROM);
const visibleRows = computed(() => {
  const term = fold(search.value.trim());
  if (!showSearch.value || !term) return table.value.rows;
  return table.value.rows.filter((row) => fold(row.name).includes(term));
});
const searchStatus = computed(() =>
  showSearch.value && search.value.trim()
    ? `${visibleRows.value.length} de ${table.value.rows.length} pessoas`
    : '',
);

const totals = computed(() => {
  const unavailable = 'Indisponível agora';
  const sold = performance.value?.totals;
  const lost = lossData.value?.totals;
  const episodes = serviceData.value ? serviceView.value.episodes : null;
  return [
    {
      key: 'sold',
      label: 'Vendido no período',
      value: sold ? performanceMoney(sold.soldAmountCents) : '—',
      detail: sold
        ? `${performanceCount(sold.confirmedCount)} pedidos · loja e sem atribuição incluídas`
        : unavailable,
    },
    {
      key: 'unanswered',
      label: 'Sem resposta no período',
      value: episodes === null ? '—' : performanceCount(episodes),
      detail:
        episodes === null
          ? unavailable
          : 'Esperas que passaram de 15 min no expediente',
      tone: episodes ? 'warning' : undefined,
    },
    {
      key: 'lost',
      label: 'Leads perdidos',
      value: lost ? performanceCount(lost.lostCount) : '—',
      detail: lost
        ? `${performanceCount(lost.reopenedByCustomerCount)} reabertos pelo cliente`
        : unavailable,
    },
  ];
});

function urls() {
  const filter =
    days.value === 7 || days.value === 30
      ? 'days=' + days.value
      : 'period=' + period.value;
  return {
    sales: `/api/v1/dashboard/performance?${filter}`,
    service: `/api/v1/dashboard/metrics/service?${filter}`,
    losses: `/api/v1/dashboard/metrics/losses?${filter}`,
    cohorts: `/api/v1/dashboard/metrics/cohorts?${filter}`,
  };
}

async function load({ announce = false } = {}) {
  if (sellerId.value) return;
  const target = urls();
  const chosen = days.value;
  const results = await Promise.all([
    sales.load(target.sales),
    service.load(target.service),
    losses.load(target.losses),
    cohorts.load(target.cohorts),
  ]);
  if (announce && chosen === days.value && results.some(Boolean))
    announcement.value = `Desempenho da equipe carregado para ${PERIODS.find((p) => p.days === chosen)?.label}.`;
}

/**
 * @param {ReturnType<typeof useLatestRead>[]} reads
 * @param {'table'|'reasons'} region the heading that receives the focus
 */
async function retry(reads, region) {
  if (reads.some((read) => read.loading.value)) return;
  if (sellerId.value) return;
  const target = urls();
  const map = new Map([
    [sales, target.sales],
    [service, target.service],
    [losses, target.losses],
  ]);
  await Promise.all(
    reads
      .filter((read) => read.error.value || !current(read))
      .map((read) => read.load(String(map.get(read)))),
  );
  if (reads.every((read) => !read.error.value)) {
    await nextTick();
    (region === 'table' ? tableHeading : reasonsHeading).value?.focus();
  }
}

/** @param {number} value */
function choosePeriod(value) {
  if (days.value === value) return;
  const key = { 1: 'hoje', 0: 'mes', 7: '7dias', 30: '30dias' }[value];
  void router.push({ query: { ...route.query, periodo: key } });
}
watch([period, sellerId], async () => {
  announcement.value = '';
  await nextTick();
  heading.value?.focus();
  void load({ announce: true });
});

/** @param {string} key */
function chooseView(key) {
  view.value = key;
  search.value = '';
}

function refresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void load();
  }, 250);
}
watch(liveEvent, (event) => {
  if (
    event?.reset ||
    ['inbox.order.changed', 'inbox.conversation.changed'].includes(event?.type)
  )
    refresh();
});
onMounted(() => {
  heading.value?.focus();
  void load();
});
onBeforeUnmount(() => {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page dashboard-page team-performance-page">
    <nav class="dashboard-trail" aria-label="Rastro">
      <RouterLink
        :to="{
          path: '/dashboard',
          query: { periodo: period === '30dias' ? '7dias' : period },
        }"
        >← Dashboard</RouterLink
      >
    </nav>
    <header class="page-heading">
      <div>
        <h1 ref="heading" tabindex="-1">
          {{ sellerId ? 'Desempenho do vendedor' : 'Desempenho da equipe' }}
        </h1>
        <p v-if="!sellerId">
          A venda conta para quem era responsável quando o pedido foi
          confirmado. {{ windowLabel }}; tempos e esperas contados
          {{ hoursLabel }}.
        </p>
      </div>
    </header>

    <div class="dashboard-period team-performance-period">
      <p id="team-period-label" class="dashboard-period-scope">Período</p>
      <div
        class="segmented-options"
        role="group"
        aria-labelledby="team-period-label"
      >
        <button
          v-for="option in PERIODS"
          :key="option.days"
          type="button"
          :aria-pressed="days === option.days"
          @click="choosePeriod(option.days)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <p class="sr-only" role="status">{{ announcement }}</p>

    <DashboardTeamSummary
      v-if="sellerId"
      :period="period"
      :seller-id="sellerId"
    />
    <template v-else
      ><section
        class="dashboard-section"
        aria-label="Totais da equipe"
        :aria-busy="busy ? 'true' : undefined"
      >
        <ul class="metric-grid" role="list">
          <li v-for="card in totals" :key="card.key">
            <div
              class="metric-card metric-card-static"
              :data-tone="card.tone || undefined"
            >
              <span class="metric-label">{{ card.label }}</span
              >{{ ' ' }}<span class="metric-value">{{ card.value }}</span
              >{{ ' ' }}<span class="metric-detail">{{ card.detail }}</span>
            </div>
          </li>
        </ul>
      </section>

      <section
        class="dashboard-panel"
        aria-labelledby="team-table-title"
        :aria-busy="tableLoading ? 'true' : undefined"
      >
        <div class="dashboard-panel-head">
          <h2 id="team-table-title" ref="tableHeading" tabindex="-1">
            Por vendedor
          </h2>
          <div
            class="segmented-options team-performance-views"
            role="group"
            aria-label="Visão da tabela"
          >
            <button
              v-for="option in VIEWS"
              :key="option.key"
              type="button"
              :aria-pressed="view === option.key"
              @click="chooseView(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <p class="dashboard-panel-note">{{ NOTES[view] }}</p>
        <div v-if="tableErrors.length" class="audit-note" role="alert">
          <p v-for="message in tableErrors" :key="message">
            {{ message }}
            {{ table.ready ? '' : 'Os valores aparecem como "—".' }}
          </p>
          <button
            type="button"
            :aria-disabled="tableLoading ? 'true' : undefined"
            @click="retry(tableReads, 'table')"
          >
            {{ tableLoading ? 'Consultando…' : 'Tentar novamente' }}
          </button>
        </div>
        <p
          v-if="tableLoading && !table.ready"
          class="dashboard-data-loading"
          role="status"
        >
          Carregando a equipe…
        </p>
        <div v-if="showSearch" class="team-performance-search">
          <label for="team-search">Buscar vendedor</label>
          <input
            id="team-search"
            v-model="search"
            type="search"
            autocomplete="off"
            aria-describedby="team-search-status"
          />
          <p id="team-search-status" class="sr-only" aria-live="polite">
            {{ searchStatus }}
          </p>
        </div>
        <DashboardTeamTable
          v-if="table.ready"
          :key="view"
          id-prefix="team"
          :caption="`${VIEWS.find((option) => option.key === view)?.label} por vendedor, ${windowLabel}`"
          :columns="COLUMNS[view]"
          :rows="visibleRows"
          :extra-rows="table.extraRows"
          :total-row="table.totalRow"
          :sorted-by="SORTED_BY[view]"
          sortable
          :empty-text="
            search.trim()
              ? 'Ninguém com esse nome na equipe.'
              : view === 'perdas'
                ? 'Nenhum lead marcado como perdido no período.'
                : 'Nenhuma atividade de vendedores no período.'
          "
          ><template #person="{ row, kind }"
            ><RouterLink
              v-if="kind === 'person'"
              :to="{
                path: '/dashboard/equipe',
                query: { periodo: period, vendedor: row.id },
              }"
              >{{ row.name }}</RouterLink
            ><span v-else>{{ row.name }}</span></template
          ></DashboardTeamTable
        >
        <p
          v-if="
            view === 'vendas' &&
            reconciliation &&
            reconciliation.difference !== 0
          "
          class="dashboard-performance-note"
        >
          A soma das linhas difere do total em
          {{ performanceMoney(Math.abs(reconciliation.difference)) }}. Avise o
          suporte: a atribuição precisa ser conferida.
        </p>
        <p
          v-if="
            view === 'atendimento' &&
            serviceData?.team?.unclaimedHandoffs?.count > 0
          "
          class="dashboard-performance-note"
        >
          Pedidos de atendimento ainda sem tomada agora:
          {{ serviceData.team.unclaimedHandoffs.count }}. Eles entram em "Para
          assumir" quando alguém assume.
        </p>
      </section>

      <section
        class="dashboard-panel"
        aria-labelledby="team-reasons-title"
        :aria-busy="losses.loading.value ? 'true' : undefined"
      >
        <div class="dashboard-panel-head">
          <h2 id="team-reasons-title" ref="reasonsHeading" tabindex="-1">
            Por que perdemos
          </h2>
        </div>
        <div v-if="losses.error.value" class="audit-note" role="alert">
          <p>{{ losses.error.value }}</p>
          <button
            type="button"
            :aria-disabled="losses.loading.value ? 'true' : undefined"
            @click="retry([losses], 'reasons')"
          >
            {{ losses.loading.value ? 'Consultando…' : 'Atualizar perdas' }}
          </button>
        </div>
        <template v-if="lossData">
          <p class="dashboard-panel-note">
            {{ performanceCount(lossData.totals?.lostCount) }} leads marcados
            como perdidos, sempre com motivo.
          </p>
          <ul
            v-if="lossView.reasons.length"
            class="dashboard-reasons"
            role="list"
          >
            <li v-for="reason in lossView.reasons" :key="reason.code">
              <span class="dashboard-reason-head"
                ><span>{{ reason.label }}</span
                ><strong>{{ performanceCount(reason.count) }}</strong></span
              >
              <span class="dashboard-meter" aria-hidden="true"
                ><span :style="{ inlineSize: `${reason.share}%` }"></span
              ></span>
            </li>
          </ul>
          <p v-else class="dashboard-performance-note">
            Nenhum lead marcado como perdido no período.
          </p>
        </template>
      </section>

      <section class="dashboard-measure" aria-labelledby="team-measure-title">
        <h2 id="team-measure-title">Como medimos</h2>
        <dl>
          <div>
            <dt>Vendido:</dt>
            <dd>
              pedidos confirmados, sem teste, pela data comercial. Conta para
              quem era responsável na confirmação; histórico sem essa informação
              fica em "Sem atribuição".
            </dd>
          </div>
          <div>
            <dt>Atendeu:</dt>
            <dd>
              conversas com resposta humana enviada de fato; assistente, avisos
              e falhas de envio não contam.
            </dd>
          </div>
          <div>
            <dt>Assumiu e encerrou:</dt>
            <dd>conversas que a pessoa assumiu e atendimentos que encerrou.</dd>
          </div>
          <div>
            <dt>Com venda:</dt>
            <dd>conversas atendidas que tiveram pedido confirmado.</dd>
          </div>
          <div>
            <dt>1ª resposta e para assumir:</dt>
            <dd>
              mediana em minutos de expediente ({{ hoursLabel }}), creditada a
              quem assumiu. Sem amostra aparece "—".
            </dd>
          </div>
          <div>
            <dt>Sem resposta:</dt>
            <dd>
              cada espera do cliente que passou de 15 minutos de expediente sem
              resposta humana, contada uma vez.
            </dd>
          </div>
          <div>
            <dt>Perdido:</dt>
            <dd>
              só quando a pessoa marca e escolhe o motivo; nada é inferido. Se o
              cliente volta a escrever, a conversa reabre.
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
