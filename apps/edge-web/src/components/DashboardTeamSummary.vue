<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppIcon from './AppIcon.vue';
import ContactMonogram from './ContactMonogram.vue';
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
const metrics = [
  { key: 'sold', label: 'Vendido' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'attended', label: 'Atendeu' },
  { key: 'conversion', label: 'Conversão' },
  { key: 'onTime', label: 'Resposta no prazo' },
];
const detailFields = [
  ...metrics,
  { key: 'ticket', label: 'Ticket médio' },
  { key: 'firstResponse', label: '1ª resposta' },
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
      <div v-if="!sellerId" class="team-head-actions">
        <RouterLink
          class="button-link quiet-link team-full-link"
          :to="{ path: '/dashboard/equipe', query: { periodo: period } }"
          >Ver desempenho da equipe<AppIcon name="chevron"
        /></RouterLink>
      </div>
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
        <div
          v-for="field in detailFields"
          :key="field.key"
          class="seller-detail-tile"
        >
          <dt>{{ field.label }}</dt>
          <dd>
            <strong>{{ selected.cells[field.key]?.text }}</strong>
            <small v-if="selected.cells[field.key]?.note">{{
              selected.cells[field.key]?.note
            }}</small>
          </dd>
        </div>
      </dl>
      <RouterLink
        v-if="sources[0]"
        class="button-link seller-orders-link"
        :to="ordersLink(sellerId)"
        >Conferir pedidos de {{ selected.name }}<AppIcon name="chevron"
      /></RouterLink>
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
      <div v-if="sources[3]" class="seller-losses">
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
        class="chip-row seller-options"
        role="group"
        aria-label="Indicador por vendedor"
      >
        <button
          v-for="m in metrics"
          :key="m.key"
          type="button"
          class="chip"
          :aria-pressed="metric === m.key"
          @click="metric = m.key"
        >
          {{ m.label }}
        </button>
      </div>
      <ul class="seller-bars">
        <li v-for="row in ordered" :key="row.id">
          <RouterLink class="seller-row" :to="memberLink(row.id)">
            <ContactMonogram class="seller-avatar" :name="row.name" />
            <span class="seller-row-body">
              <span class="seller-row-top">
                <span class="seller-identity">
                  <strong class="seller-name">{{ row.name }}</strong>
                  <span v-if="row.note" class="badge seller-status-badge">{{
                    row.note
                  }}</span>
                </span>
                <span class="seller-value-col">
                  <span class="seller-metric-label">{{ metricLabel }}</span>
                  <strong class="seller-metric-value">{{
                    row.cells[metric].text
                  }}</strong>
                  <AppIcon name="chevron" class="seller-go" />
                </span>
              </span>
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
              <small v-if="metric === 'sold'" class="seller-row-sub"
                >{{ row.cells.orders.text }} pedidos · Conversão
                {{ row.cells.conversion.text }} · Resposta no prazo
                {{ row.cells.onTime.text }}</small
              >
            </span>
          </RouterLink>
        </li>
      </ul>
      <p v-if="!ordered.length" class="dashboard-performance-note">
        Nenhuma pessoa com atividade visível.
      </p>
      <div v-if="table.totalRow" class="team-reconciliation">
        <span
          v-for="row in table.extraRows"
          :key="row.id"
          class="team-reconciliation-item"
        >
          <span class="team-reconciliation-label">{{ row.name }}</span>
          <strong class="team-reconciliation-value">{{
            row.cells.sold.text
          }}</strong>
        </span>
        <span class="team-reconciliation-item team-reconciliation-total">
          <span class="team-reconciliation-label">Total</span>
          <strong class="team-reconciliation-value">{{
            table.totalRow.cells.sold.text
          }}</strong>
        </span>
      </div>
    </template>
  </section>
</template>
<style scoped>
.team-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.team-full-link {
  min-block-size: var(--target-min);
  padding-inline: var(--space-2);
  color: var(--color-link);
  font-weight: var(--weight-semibold);
}
.seller-options {
  gap: var(--space-2);
  margin-block: var(--space-1) var(--space-2);
}
.seller-bars {
  display: grid;
  gap: var(--space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.seller-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  color: var(--color-text);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition:
    background-color var(--duration-fast) var(--easing-standard),
    border-color var(--duration-fast) var(--easing-standard);
}
.seller-row:hover {
  background: var(--color-surface-raised);
  border-color: var(--color-border);
}
.seller-row:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: 2px;
}
.seller-avatar {
  display: grid;
  place-items: center;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  margin-block-start: 0.125rem;
  color: var(--color-text);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  background: var(--color-surface-active);
  border-radius: var(--radius-pill);
}
.seller-row-body {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
}
.seller-row-top {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}
.seller-identity {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-inline-size: 0;
}
.seller-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.seller-status-badge {
  line-height: 1.3;
}
.seller-value-col {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.seller-metric-label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.seller-metric-value {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}
.seller-go {
  inline-size: 1rem;
  block-size: 1rem;
  color: var(--color-text-muted);
  flex: none;
}
.seller-row:hover .seller-go {
  color: var(--color-link);
}
.seller-row .dashboard-meter {
  margin-block-end: 0;
}
.seller-row .dashboard-meter > span {
  background: var(--color-chart-bar-selected);
}
.seller-row-sub {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.team-reconciliation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-5);
  padding-block-start: var(--space-3);
  border-block-start: 1px solid var(--color-border-subtle);
  font-size: var(--text-xs);
}
.team-reconciliation-item {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
}
.team-reconciliation-label {
  color: var(--color-text-muted);
}
.team-reconciliation-value {
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-medium);
}
.team-reconciliation-total {
  margin-inline-start: auto;
  font-size: var(--text-sm);
}
.team-reconciliation-total .team-reconciliation-value {
  font-weight: var(--weight-semibold);
}
.seller-detail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(10.5rem, 100%), 1fr));
  gap: var(--space-3);
  margin: 0;
}
.seller-detail-tile {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.seller-detail-tile dt {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.seller-detail-tile dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.seller-detail-tile dd strong {
  font-size: var(--text-base);
}
.seller-detail-tile small {
  display: block;
  margin-block-start: 2px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.seller-orders-link {
  justify-self: start;
}
.seller-losses h3 {
  margin: 0 0 var(--space-2);
}
details {
  margin-block: var(--space-2);
  overflow-wrap: anywhere;
}
@media (max-width: 768px) {
  .seller-options .chip {
    min-block-size: var(--target-min);
  }
  .team-head-actions {
    inline-size: 100%;
    justify-content: space-between;
  }
}
@media (max-width: 480px) {
  .seller-row {
    padding: var(--space-3);
  }
  .seller-avatar {
    display: none;
  }
  .team-reconciliation-total {
    margin-inline-start: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .seller-row {
    transition: none;
  }
}
</style>
