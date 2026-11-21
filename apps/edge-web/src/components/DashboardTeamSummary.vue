<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import DashboardTeamTable from './DashboardTeamTable.vue';
import { useLatestRead } from '../lib/dashboard-read.js';
import { PERIODS, shortDay } from '../lib/dashboard-format.js';
import { reasonBreakdown } from '../lib/dashboard-metrics.js';
import { sellerTable } from '../lib/team-performance.js';

const props = defineProps({
  period: { type: String, default: '7dias' },
  revision: { type: Number, default: 0 },
  sellerId: { type: String, default: '' },
});
const liveEvent = inject('liveEvent', ref(null));
const heading = ref(null);
const metric = ref('sold');
const mode = ref('grafico');
const metrics = [
  { key: 'sold', label: 'Vendido' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'attended', label: 'Atendeu' },
  { key: 'conversion', label: 'Conversão' },
  { key: 'onTime', label: 'Resposta no prazo' },
];
const columns = [
  ...metrics,
  { key: 'ticket', label: 'Ticket médio' },
  { key: 'firstResponse', label: '1ª resposta' },
].map((column) => ({ ...column, sortable: true }));
const detailFields = [
  ...columns,
  { key: 'assumed', label: 'Assumiu' },
  { key: 'closed', label: 'Encerrou' },
  { key: 'claim', label: 'Tempo para assumir' },
  { key: 'unanswered', label: 'Episódios sem resposta' },
  { key: 'lost', label: 'Perdas declaradas' },
];
const reads = [
  { name: 'vendas', path: 'performance' },
  { name: 'tempos de atendimento', path: 'metrics/service' },
  { name: 'conversão e resposta no prazo', path: 'metrics/cohorts' },
  { name: 'perdas', path: 'metrics/losses' },
].map((region) => ({
  ...region,
  read: useLatestRead({
    unavailable: `Não foi possível consultar ${region.name}.`,
    stale: `A consulta de ${region.name} falhou. Confira a última leitura.`,
  }),
}));
const activeReads = computed(() =>
  props.sellerId ? reads : reads.slice(0, 3),
);
const query = computed(() =>
  props.period === '30dias'
    ? 'days=30'
    : 'period=' + encodeURIComponent(props.period),
);
const periodLabel = computed(
  () => PERIODS.find((p) => p.key === props.period)?.label ?? '30 dias',
);
const sources = computed(() =>
  reads.map(({ read, path }) => {
    const data = read.data.value;
    if (path === 'metrics/cohorts' && (data?.seller || '') !== props.sellerId)
      return null;
    return data &&
      (data.period === props.period ||
        (props.period === '30dias' && data.days === 30))
      ? data
      : null;
  }),
);
const table = computed(() => sellerTable(...sources.value));
const selected = computed(() =>
  table.value.rows.find((row) => row.id === props.sellerId),
);
const range = computed(() => sources.value.find(Boolean));
const ready = computed(() => sources.value.some(Boolean));
const loading = computed(() =>
  activeReads.value.some((r) => r.read.loading.value),
);
const peak = computed(() =>
  ['conversion', 'onTime'].includes(metric.value)
    ? 100
    : Math.max(
        0,
        ...table.value.rows.map((row) => row.cells[metric.value]?.value ?? 0),
      ),
);
const metricLabel = computed(
  () => metrics.find((m) => m.key === metric.value)?.label,
);
const ordered = computed(() =>
  [...table.value.rows].sort(
    (a, b) =>
      (b.cells[metric.value]?.value ?? -1) -
        (a.cells[metric.value]?.value ?? -1) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  ),
);
function memberLink(seller) {
  return {
    path: '/dashboard/equipe',
    query: { periodo: props.period, vendedor: seller },
  };
}
function ordersLink(seller) {
  return {
    path: '/pedidos',
    query: {
      status: 'confirmado',
      de: range.value?.from,
      ate: range.value?.to,
      credito: seller,
    },
  };
}
function regionUrl(region) {
  return (
    '/api/v1/dashboard/' +
    region.path +
    '?' +
    query.value +
    (region.path === 'metrics/cohorts' && props.sellerId
      ? '&seller=' + encodeURIComponent(props.sellerId)
      : '')
  );
}
async function retry(region) {
  if (await region.read.load(regionUrl(region))) {
    await nextTick();
    heading.value?.focus();
  }
}
function reload() {
  for (const region of activeReads.value)
    void region.read.load(regionUrl(region));
}
watch([query, () => props.sellerId], reload, { immediate: true });
let timer;
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(reload, 250);
}
watch(() => props.revision, refresh);
watch(liveEvent, (event) => {
  if (
    event?.reset ||
    [
      'inbox.order.changed',
      'inbox.conversation.changed',
      'inbox.message.changed',
    ].includes(event?.type)
  )
    refresh();
});
onBeforeUnmount(() => clearTimeout(timer));
</script>
<template>
  <section
    class="dashboard-panel dashboard-team-summary"
    aria-labelledby="dashboard-team-title"
    :aria-busy="loading"
  >
    <div class="dashboard-panel-head">
      <div>
        <h2 id="dashboard-team-title" ref="heading" tabindex="-1">
          {{
            sellerId ? selected?.name || 'Detalhe do vendedor' : 'Vendedores'
          }}
        </h2>
        <p>
          {{ periodLabel
          }}<template v-if="range">
            · {{ shortDay(range.from) }} a {{ shortDay(range.to) }}</template
          ><template v-if="selected?.note"> · {{ selected.note }}</template>
        </p>
      </div>
      <RouterLink
        v-if="!sellerId"
        class="dashboard-panel-link"
        :to="{ path: '/dashboard/equipe', query: { periodo: period } }"
        >Ver desempenho da equipe</RouterLink
      >
    </div>
    <template v-for="region in activeReads" :key="region.path"
      ><div v-if="region.read.error.value" class="audit-note" role="alert">
        <p>{{ region.read.error.value }}</p>
        <button type="button" @click="retry(region)">
          Consultar {{ region.name }} novamente
        </button>
      </div></template
    >
    <p v-if="loading && !ready" role="status">Consultando a equipe…</p>
    <template v-if="sellerId && selected">
      <dl class="seller-detail">
        <div v-for="field in detailFields" :key="field.key">
          <dt>{{ field.label }}</dt>
          <dd>
            {{ selected.cells[field.key]?.text }}
            <small>{{ selected.cells[field.key]?.note }}</small>
          </dd>
        </div>
      </dl>
      <RouterLink
        v-if="sources[0]"
        class="dashboard-panel-link"
        :to="ordersLink(sellerId)"
        >Conferir pedidos de {{ selected.name }}</RouterLink
      >
      <details v-if="sources[2]">
        <summary>Como foi calculada a conversão</summary>
        <p>
          {{ selected.cells.conversion.note }} com janela completa de 30 dias
          civis. {{ selected.cohort?.observing ?? 0 }} em observação. Cada ciclo
          conta uma vez quando há pedido confirmado durante sua janela com
          crédito para quem assumiu.
        </p>
        <ul>
          <li v-for="cycle in selected.cohort?.conversion" :key="cycle.cycleId">
            Ciclo {{ cycle.cycleId }} · {{ cycle.from }} a {{ cycle.to }} ·
            <template v-if="cycle.orders.length"
              ><RouterLink
                v-for="o in cycle.orders"
                :key="o.id"
                :to="'/pedidos/' + encodeURIComponent(o.id)"
                >{{ o.number }}
              </RouterLink></template
            ><template v-else>Sem pedido elegível</template>
          </li>
        </ul>
      </details>
      <details v-if="sources[2]">
        <summary>Como foi calculada a resposta no prazo</summary>
        <p>
          {{ selected.cells.onTime.note }} tiveram primeira resposta humana em
          até 15 minutos de expediente.
          {{ selected.cohort?.openLate ?? 0 }} esperas vencidas continuam
          abertas. A taxa aparece a partir de dez ciclos com prazo vencido no
          período.
        </p>
        <ul>
          <li v-for="cycle in selected.cohort?.service" :key="cycle.cycleId">
            Ciclo {{ cycle.cycleId }}
            <template v-if="typeof cycle.replyMinutes === 'number'"
              >· {{ cycle.replyMinutes }} min úteis </template
            >·
            {{
              cycle.onTime
                ? 'No prazo'
                : cycle.open
                  ? 'Espera em aberto'
                  : 'Fora do prazo'
            }}
          </li>
        </ul>
      </details>
      <div v-if="sources[3]">
        <h3>Perdas por motivo</h3>
        <ul v-if="selected.loss?.lostCount">
          <li
            v-for="r in reasonBreakdown(selected.loss.byReason)"
            :key="r.code"
          >
            {{ r.label }} · {{ r.count }}
          </li>
        </ul>
        <p v-else>Nenhuma perda declarada.</p>
      </div>
    </template>
    <p v-else-if="sellerId && !loading && ready">
      Vendedor sem atividade visível neste período.
    </p>
    <template v-if="!sellerId && ready">
      <div
        class="segmented-options"
        role="group"
        aria-label="Apresentação dos vendedores"
      >
        <button
          v-for="option in [
            { key: 'grafico', label: 'Gráfico' },
            { key: 'tabela', label: 'Tabela' },
          ]"
          :key="option.key"
          type="button"
          :aria-pressed="mode === option.key"
          @click="mode = option.key"
        >
          {{ option.label }}
        </button>
      </div>
      <template v-if="mode === 'grafico'">
        <div
          class="segmented-options seller-options"
          role="group"
          aria-label="Indicador por vendedor"
        >
          <button
            v-for="m in metrics"
            :key="m.key"
            type="button"
            :aria-pressed="metric === m.key"
            @click="metric = m.key"
          >
            {{ m.label }}
          </button>
        </div>
        <ul class="seller-bars">
          <li v-for="row in ordered" :key="row.id">
            <RouterLink :to="memberLink(row.id)">
              <span
                ><strong>{{ row.name }}</strong>
                <small>{{ row.note }}</small></span
              >
              <span>{{ metricLabel }} · {{ row.cells[metric].text }}</span>
              <span class="dashboard-meter" aria-hidden="true"
                ><span
                  :style="{
                    inlineSize:
                      (peak
                        ? ((row.cells[metric].value || 0) * 100) / peak
                        : 0) + '%',
                  }"
                ></span
              ></span>
              <small v-if="metric === 'sold'"
                >{{ row.cells.orders.text }} pedidos · Conversão
                {{ row.cells.conversion.text }} · Resposta no prazo
                {{ row.cells.onTime.text }}</small
              >
            </RouterLink>
          </li>
        </ul>
        <p v-if="!ordered.length">Nenhuma pessoa com atividade visível.</p>
        <p v-if="table.totalRow" class="dashboard-performance-note">
          <template v-for="row in table.extraRows" :key="row.id"
            >{{ row.name }} {{ row.cells.sold.text }} · </template
          >Total {{ table.totalRow.cells.sold.text }}
        </p>
      </template>
      <DashboardTeamTable
        v-else
        id-prefix="dashboard-vendedores"
        caption="Indicadores de vendedores no período"
        :columns="columns"
        :rows="table.rows"
        :extra-rows="table.extraRows"
        :total-row="table.totalRow"
        sorted-by="sold"
        sortable
      >
        <template #person="{ row, kind }"
          ><RouterLink v-if="kind === 'person'" :to="memberLink(row.id)">{{
            row.name
          }}</RouterLink
          ><span v-else>{{ row.name }}</span></template
        >
      </DashboardTeamTable>
    </template>
  </section>
</template>
<style scoped>
.seller-options {
  flex-wrap: wrap;
  margin-block: var(--space-3);
}
.seller-bars {
  display: grid;
  gap: var(--space-2);
  list-style: none;
  padding: 0;
}
.seller-bars a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3);
  color: var(--color-text);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  text-decoration: none;
}
.seller-bars a:hover,
.seller-bars a:focus-visible {
  background: var(--color-surface-muted);
}
.seller-bars .dashboard-meter,
.seller-bars small:last-child {
  grid-column: 1 / -1;
}
.seller-bars .dashboard-meter {
  inline-size: 100%;
  max-inline-size: none;
}
.seller-detail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--space-3);
}
.seller-detail dd {
  margin: 0;
}
.seller-detail small {
  display: block;
}
details {
  margin-block: var(--space-4);
  overflow-wrap: anywhere;
}
</style>
