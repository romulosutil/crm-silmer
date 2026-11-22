<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppIcon from './AppIcon.vue';
import { useLatestRead } from '../lib/dashboard-read.js';
import {
  compactReais,
  longDay,
  money,
  plural,
  shortDay,
} from '../lib/dashboard-format.js';

const props = defineProps({
  period: { type: String, required: true },
  revision: { type: Number, default: 0 },
});
const { data, loading, error, load } = useLatestRead({
  unavailable: 'Não foi possível consultar as vendas.',
  stale: 'Falha ao atualizar. Os valores são da última leitura deste período.',
});
const selectedDay = ref('');
const report = computed(() =>
  data.value?.period.key === props.period ? data.value : null,
);
const day = computed(
  () =>
    report.value?.daily.find((row) => row.day === selectedDay.value) ??
    report.value?.daily.at(-1),
);
const metrics = [
  { key: 'soldAmountCents', label: 'Vendido' },
  { key: 'confirmedCount', label: 'Pedidos' },
  { key: 'averageTicketCents', label: 'Ticket médio' },
];
const sources = {
  equipe: 'Equipe',
  loja: 'Loja',
  'sem-atribuicao': 'Sem atribuição',
};
const sides = ['current', 'previous'];
function refresh() {
  return load(
    '/api/v1/orders/commercial-result?period=' +
      encodeURIComponent(props.period),
  );
}
watch(
  () => props.period,
  () => {
    data.value = null;
    error.value = '';
    selectedDay.value = '';
    refresh();
  },
  { immediate: true },
);
watch(() => props.revision, refresh);

/** @param {any} period */
function orders(period) {
  return {
    path: '/pedidos',
    query: { status: 'confirmado', de: period.from, ate: period.to },
  };
}
/** @param {any} period */
function dates(period) {
  return [period.from, period.to]
    .filter((d, i, a) => a.indexOf(d) === i)
    .map((d) => d.split('-').reverse().join('/'))
    .join(' a ');
}
/** @param {string} key @param {number|null} value */
function format(key, value) {
  return value == null
    ? '—'
    : key === 'confirmedCount'
      ? String(value)
      : money(value);
}
/** @param {string} key */
function difference(key) {
  const comparison = report.value.comparison;
  const a = comparison.current[key],
    b = comparison.previous[key];
  if (comparison.partial || a == null || b == null) return '—';
  const delta = a - b;
  const amount = (delta > 0 ? '+' : '') + format(key, delta);
  return b === 0
    ? amount + ' · base anterior zero'
    : amount +
        ' (' +
        new Intl.NumberFormat('pt-BR', {
          style: 'percent',
          maximumFractionDigits: 1,
          signDisplay: 'exceptZero',
        }).format(delta / b) +
        ')';
}
/** @param {string} key */
function deltaDirection(key) {
  const comparison = report.value?.comparison;
  if (!comparison || comparison.partial) return 'flat';
  const a = comparison.current?.[key];
  const b = comparison.previous?.[key];
  if (a == null || b == null || a === b) return 'flat';
  return a > b ? 'up' : 'down';
}
/** @param {string} key */
function deltaTone(key) {
  const direction = deltaDirection(key);
  if (direction === 'up') return 'success';
  if (direction === 'down') return 'warning';
  return undefined;
}
/** @param {number} index @param {KeyboardEvent} event */
function moveDay(index, event) {
  const days = report.value.daily;
  const direction = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[
    event.key
  ];
  if (!direction && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? days.length - 1
        : Math.max(0, Math.min(days.length - 1, index + direction));
  selectedDay.value = days[next].day;
  event.currentTarget.parentElement.querySelectorAll('button')[next].focus();
}
/** @param {number} value @param {number} max */
function width(value, max) {
  return { inlineSize: (max > 0 ? (value / max) * 100 : 0) + '%' };
}
const maxDay = computed(() =>
  Math.max(0, ...(report.value?.daily ?? []).map((row) => row.soldAmountCents)),
);
</script>

<template>
  <section
    class="commercial-result dashboard-section"
    aria-label="Vendas do período"
    :aria-busy="loading"
  >
    <div v-if="error" class="audit-note commercial-error" role="status">
      <div class="commercial-error-copy">
        <AppIcon name="alert" />
        <p>{{ error }}</p>
      </div>
      <button type="button" @click="refresh">Tentar novamente</button>
    </div>
    <div
      v-if="!report && loading"
      class="surface sales-summary commercial-skeleton"
    >
      <p class="sr-only" role="status">Consultando vendas…</p>
      <div class="skeleton-line skeleton-title" aria-hidden="true"></div>
      <div class="skeleton-kpis" aria-hidden="true">
        <span class="skeleton-box"></span>
        <span class="skeleton-box"></span>
        <span class="skeleton-box"></span>
      </div>
      <div class="skeleton-chart" aria-hidden="true"></div>
    </div>
    <template v-if="report">
      <div class="surface sales-summary">
        <div class="commercial-card-head">
          <div>
            <h2>Vendido</h2>
            <p class="commercial-subtitle">
              <AppIcon name="calendar" />{{ dates(report.period) }} · São Paulo
            </p>
          </div>
          <RouterLink
            class="button-link commercial-link"
            :to="orders(report.period)"
            >Conferir pedidos<AppIcon name="chevron"
          /></RouterLink>
        </div>
        <dl class="sales-kpis">
          <div
            v-for="metric in metrics"
            :key="metric.key"
            class="sales-kpi"
            :data-featured="
              metric.key === 'soldAmountCents' ? 'true' : undefined
            "
          >
            <dt>{{ metric.label }}</dt>
            <dd>{{ format(metric.key, report.period[metric.key]) }}</dd>
          </div>
        </dl>
      </div>
      <section
        v-if="props.period === 'hoje'"
        class="surface sales-summary"
        aria-labelledby="commercial-composition"
      >
        <div class="commercial-card-head">
          <div>
            <h3 id="commercial-composition">Composição de hoje</h3>
            <p class="commercial-subtitle">
              Distribuição por origem dos pedidos confirmados
            </p>
          </div>
        </div>
        <div
          v-if="report.period.soldAmountCents > 0"
          class="composition-stack"
          aria-hidden="true"
        >
          <span
            v-for="row in report.composition.filter(
              (item) => item.soldAmountCents > 0,
            )"
            :key="row.source"
            class="composition-seg"
            :data-source="row.source"
            :style="{ flexGrow: row.soldAmountCents }"
          ></span>
        </div>
        <dl class="composition-grid">
          <div
            v-for="row in report.composition"
            :key="row.source"
            class="composition-tile"
            :data-source="row.source"
          >
            <dt>
              <span class="legend-swatch" aria-hidden="true"></span
              >{{ sources[row.source] }}
            </dt>
            <dd class="composition-amount">{{ money(row.soldAmountCents) }}</dd>
            <dd class="composition-count">
              {{ plural(row.confirmedCount, 'pedido', 'pedidos') }}
            </dd>
          </div>
        </dl>
      </section>
      <section
        v-else
        class="surface sales-summary"
        aria-labelledby="commercial-series"
      >
        <div class="dashboard-section-head">
          <div>
            <h3 id="commercial-series">Vendas por dia</h3>
            <p class="commercial-subtitle">
              Clique ou use as setas para inspecionar um dia
            </p>
          </div>
        </div>
        <div class="daily-chart-frame">
          <div v-if="maxDay > 0" class="daily-y-axis" aria-hidden="true">
            <span>{{ compactReais(maxDay) }}</span>
            <span>{{ compactReais(Math.round(maxDay / 2)) }}</span>
            <span>0</span>
          </div>
          <div class="daily-scroll">
            <div
              class="daily-bars"
              role="group"
              aria-label="Selecionar dia da venda"
            >
              <button
                v-for="(row, index) in report.daily"
                :key="row.day"
                class="day-bar"
                type="button"
                :aria-label="
                  longDay(row.day) +
                  ', ' +
                  money(row.soldAmountCents) +
                  ', ' +
                  plural(row.confirmedCount, 'pedido', 'pedidos')
                "
                :aria-pressed="day.day === row.day"
                :tabindex="day.day === row.day ? 0 : -1"
                @click="selectedDay = row.day"
                @keydown="moveDay(index, $event)"
              >
                <span class="day-track" aria-hidden="true"
                  ><span
                    class="day-fill"
                    :data-zero="row.soldAmountCents === 0 ? 'true' : undefined"
                    :style="
                      row.soldAmountCents > 0
                        ? {
                            blockSize:
                              (maxDay
                                ? (row.soldAmountCents / maxDay) * 100
                                : 0) + '%',
                          }
                        : undefined
                    "
                  ></span></span
                ><span class="day-label">{{ shortDay(row.day) }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="day" class="day-inspector">
          <p class="day-inspector-copy" aria-live="polite">
            <strong>{{ longDay(day.day) }}</strong> ·
            <span class="tabular">{{ money(day.soldAmountCents) }}</span> ·
            {{ plural(day.confirmedCount, 'pedido', 'pedidos') }}
          </p>
          <RouterLink
            class="button-link"
            :to="orders({ from: day.day, to: day.day })"
            >Conferir pedidos do dia<AppIcon name="chevron"
          /></RouterLink>
        </div>
      </section>
      <section
        class="surface sales-summary"
        aria-labelledby="commercial-comparison"
      >
        <div class="dashboard-section-head">
          <div>
            <h3 id="commercial-comparison">Comparação de vendas</h3>
            <p v-if="report.comparison?.partial" class="commercial-subtitle">
              Hoje, parcial · Ontem, dia completo
            </p>
            <p v-else-if="report.comparison" class="commercial-subtitle">
              Dias completos equivalentes
            </p>
          </div>
        </div>
        <p v-if="!report.comparison" class="commercial-empty">
          Primeiro dia do mês. A comparação estará disponível após o primeiro
          dia completo.
        </p>
        <template v-else>
          <div class="comparison-intervals">
            <div v-for="side in sides" :key="side" class="comparison-interval">
              <span
                class="legend-swatch"
                :data-side="side"
                aria-hidden="true"
              ></span>
              <RouterLink
                class="comparison-interval-link"
                :to="orders(report.comparison[side])"
                >Conferir pedidos
                {{
                  side === 'current'
                    ? 'do intervalo atual'
                    : 'do intervalo anterior'
                }}
                · {{ dates(report.comparison[side]) }}</RouterLink
              >
            </div>
          </div>
          <dl class="pairs">
            <div v-for="metric in metrics" :key="metric.key" class="pair-card">
              <dt class="pair-title">{{ metric.label }}</dt>
              <dd v-for="side in sides" :key="side" class="pair-row">
                <span class="pair-row-head">
                  <span class="pair-side-label">{{
                    side === 'current' ? 'Atual' : 'Anterior'
                  }}</span>
                  <strong class="pair-side-value" :data-side="side">{{
                    format(metric.key, report.comparison[side][metric.key])
                  }}</strong>
                </span>
                <span class="pair-track" aria-hidden="true"
                  ><span
                    :class="{ previous: side === 'previous' }"
                    :style="
                      width(
                        report.comparison[side][metric.key],
                        Math.max(
                          report.comparison.current[metric.key],
                          report.comparison.previous[metric.key],
                        ),
                      )
                    "
                  ></span
                ></span>
              </dd>
              <dd v-if="!report.comparison.partial" class="pair-delta">
                <span
                  class="badge pair-delta-badge"
                  :data-tone="deltaTone(metric.key)"
                >
                  <AppIcon
                    v-if="deltaDirection(metric.key) !== 'flat'"
                    :name="
                      deltaDirection(metric.key) === 'up'
                        ? 'trending-up'
                        : 'trending-down'
                    "
                  />
                  Diferença · {{ difference(metric.key) }}
                </span>
              </dd>
            </div>
          </dl>
        </template>
      </section>
    </template>
  </section>
</template>
<style scoped>
.commercial-result {
  display: grid;
  gap: var(--space-4);
  min-inline-size: 0;
}
.sales-summary {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  min-inline-size: 0;
}
.sales-summary h2,
.sales-summary h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}
.commercial-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.commercial-subtitle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.commercial-subtitle .app-icon {
  inline-size: 0.875rem;
  block-size: 0.875rem;
  flex: none;
}
.commercial-link,
.day-inspector .button-link {
  min-block-size: var(--target-min);
}
.sales-summary .dashboard-section-head {
  margin-block-end: 0;
}
.sales-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.sales-kpi {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
  min-inline-size: 0;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.sales-kpi[data-featured='true'] {
  background: var(--color-selected);
  border-color: color-mix(in srgb, var(--color-focus) 22%, transparent);
}
.sales-kpi dt {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.sales-kpi dd {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.sales-kpi[data-featured='true'] dd {
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  letter-spacing: -0.025em;
}
.composition-stack {
  display: flex;
  gap: 2px;
  block-size: 0.5rem;
  overflow: hidden;
  background: var(--color-surface-active);
  border-radius: var(--radius-pill);
}
.composition-seg {
  min-inline-size: 0.375rem;
  block-size: 100%;
  border-radius: var(--radius-pill);
}
.composition-seg[data-source='equipe'],
.composition-tile[data-source='equipe'] .legend-swatch {
  background: var(--color-chart-bar-selected);
}
.composition-seg[data-source='loja'],
.composition-tile[data-source='loja'] .legend-swatch {
  background: var(--color-chart-bar);
}
.composition-seg[data-source='sem-atribuicao'],
.composition-tile[data-source='sem-atribuicao'] .legend-swatch {
  background: var(--color-chart-bar-previous);
}
.composition-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.composition-tile {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
  min-inline-size: 0;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.composition-tile dt {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.composition-tile dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.composition-amount {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}
.composition-count {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.legend-swatch {
  flex: none;
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 3px;
}
.legend-swatch[data-side='current'] {
  background: var(--color-chart-bar-selected);
}
.legend-swatch[data-side='previous'] {
  background: var(--color-chart-bar-previous);
}
.daily-chart-frame {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
}
.daily-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  margin-block-start: calc(var(--space-2) + 2px - 0.5em);
  block-size: calc(9rem + 1em);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.daily-scroll {
  overflow-x: auto;
  padding: 2px;
}
.daily-bars {
  position: relative;
  display: flex;
  gap: var(--space-1);
  inline-size: 100%;
  min-inline-size: max-content;
}
.daily-bars::before {
  position: absolute;
  inset-inline: 0;
  inset-block-start: var(--space-2);
  block-size: 9rem;
  content: '';
  pointer-events: none;
  background-image: linear-gradient(
    to bottom,
    var(--color-chart-grid) 1px,
    transparent 1px
  );
  background-size: 100% 4.5rem;
}
.day-bar {
  position: relative;
  z-index: 1;
  flex: 1 1 2.75rem;
  display: grid;
  align-items: end;
  justify-items: center;
  gap: var(--space-2);
  min-inline-size: var(--target-min);
  padding: var(--space-2) var(--space-1);
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  box-shadow: none;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--easing-standard);
}
.day-bar:hover {
  background: var(--color-surface-muted);
}
.day-bar[aria-pressed='true'] {
  background: var(--color-selected);
}
.day-bar:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: 2px;
}
.day-track {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  inline-size: 100%;
  max-inline-size: 2rem;
  block-size: 9rem;
  border-block-end: 1px solid var(--color-chart-baseline);
}
.day-fill {
  display: block;
  inline-size: 100%;
  min-block-size: 4px;
  background: var(--color-chart-bar);
  border-radius: var(--radius-sm) var(--radius-sm) 2px 2px;
  transition: background-color var(--duration-fast) var(--easing-standard);
}
.day-fill[data-zero='true'] {
  min-block-size: 2px;
  block-size: 2px;
  background: var(--color-border);
  border-radius: var(--radius-pill);
}
.day-bar[aria-pressed='true'] .day-fill:not([data-zero='true']) {
  background: var(--color-chart-bar-selected);
}
.day-label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.day-bar[aria-pressed='true'] .day-label {
  color: var(--color-text);
  font-weight: var(--weight-semibold);
}
.day-inspector {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.day-inspector-copy {
  margin: 0;
  font-size: var(--text-sm);
}
.tabular {
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-semibold);
}
.comparison-intervals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
}
.comparison-interval {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
}
.comparison-interval-link {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--target-min);
}
.pairs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15.5rem, 100%), 1fr));
  gap: var(--space-3);
  margin: 0;
}
.pair-card {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-inline-size: 0;
  padding: var(--space-4);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.pair-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.pair-row,
.pair-delta {
  margin: 0;
}
.pair-row {
  display: grid;
  gap: var(--space-1);
}
.pair-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.pair-side-label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.pair-side-value {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-medium);
}
.pair-side-value[data-side='current'] {
  font-weight: var(--weight-semibold);
}
.pair-track {
  display: block;
  block-size: 0.5rem;
  overflow: hidden;
  background: var(--color-surface-active);
  border-radius: var(--radius-pill);
}
.pair-track > span {
  display: block;
  block-size: 100%;
  background: var(--color-chart-bar-selected);
  border-radius: inherit;
}
.pair-track > .previous {
  background: var(--color-chart-bar-previous);
}
.pair-delta-badge {
  justify-self: start;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
  text-align: start;
  white-space: normal;
  border-radius: var(--radius-sm);
}
.pair-delta-badge .app-icon {
  inline-size: 0.875rem;
  block-size: 0.875rem;
  margin-block-start: 2px;
  flex: none;
}
.commercial-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.commercial-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
}
.commercial-error-copy {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.commercial-error-copy .app-icon {
  inline-size: 1rem;
  block-size: 1rem;
  flex: none;
  color: var(--status-warning-text);
}
.commercial-error-copy p {
  margin: 0;
}
.commercial-error button {
  min-block-size: var(--target-min);
}
.commercial-skeleton {
  gap: var(--space-4);
}
.skeleton-line {
  inline-size: 10rem;
  block-size: 1.25rem;
  background: var(--color-surface-raised);
  border-radius: var(--radius-sm);
}
.skeleton-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}
.skeleton-box {
  block-size: 5rem;
  background: var(--color-surface-raised);
  border-radius: var(--radius-md);
}
.skeleton-chart {
  block-size: 10rem;
  background: var(--color-surface-raised);
  border-radius: var(--radius-md);
}
@media (max-width: 600px) {
  .sales-summary {
    padding: var(--space-4);
  }
  .sales-kpis,
  .composition-grid,
  .skeleton-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .sales-kpi[data-featured='true'],
  .composition-tile:last-child {
    grid-column: 1 / -1;
  }
  .commercial-link,
  .day-inspector .button-link {
    inline-size: 100%;
    justify-content: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .day-bar,
  .day-fill {
    transition: none;
  }
}
</style>
