<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useLatestRead } from '../lib/dashboard-read.js';
import { longDay, money, plural, shortDay } from '../lib/dashboard-format.js';

const props = defineProps({
  period: { type: String, required: true },
  revision: { type: Number, default: 0 },
});
const { data, loading, error, load } = useLatestRead({
  unavailable: 'Não foi possível consultar as vendas.',
  stale: 'Falha ao atualizar. Os valores são da última leitura deste período.',
});
const seriesMode = ref('Gráfico');
const comparisonMode = ref('Gráfico');
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
    <p v-if="error" role="status">
      {{ error }}
      <button class="soft" type="button" @click="refresh">
        Tentar novamente
      </button>
    </p>
    <p v-if="!report && loading">Consultando vendas…</p>
    <template v-if="report">
      <div class="surface sales-summary">
        <h2>Vendido</h2>
        <p>{{ dates(report.period) }} · São Paulo</p>
        <dl class="sales-kpis">
          <div v-for="metric in metrics" :key="metric.key">
            <dt>{{ metric.label }}</dt>
            <dd>{{ format(metric.key, report.period[metric.key]) }}</dd>
          </div>
        </dl>
        <RouterLink class="sales-action" :to="orders(report.period)"
          >Conferir pedidos</RouterLink
        >
      </div>
      <section
        v-if="props.period === 'hoje'"
        class="surface sales-summary"
        aria-labelledby="commercial-composition"
      >
        <h3 id="commercial-composition">Composição de hoje</h3>
        <dl class="sales-kpis">
          <div v-for="row in report.composition" :key="row.source">
            <dt>{{ sources[row.source] }}</dt>
            <dd>{{ money(row.soldAmountCents) }}</dd>
            <dd>{{ plural(row.confirmedCount, 'pedido', 'pedidos') }}</dd>
          </div>
        </dl>
      </section>
      <section
        v-else
        class="surface sales-summary"
        aria-labelledby="commercial-series"
      >
        <div class="dashboard-section-head">
          <h3 id="commercial-series">Vendas por dia</h3>
          <div role="group" aria-label="Exibição das vendas por dia">
            <button
              v-for="mode in ['Gráfico', 'Tabela']"
              :key="mode"
              type="button"
              class="soft"
              :aria-pressed="seriesMode === mode"
              @click="seriesMode = mode"
            >
              {{ mode }}
            </button>
          </div>
        </div>
        <div v-if="seriesMode === 'Gráfico'" class="daily-scroll">
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
                  :style="{
                    blockSize:
                      (maxDay ? (row.soldAmountCents / maxDay) * 100 : 0) + '%',
                  }"
                ></span></span
              ><span>{{ shortDay(row.day) }}</span>
            </button>
          </div>
        </div>
        <table v-else>
          <caption class="sr-only">
            Vendas por dia
          </caption>
          <thead>
            <tr>
              <th>Dia</th>
              <th>Vendido</th>
              <th>Pedidos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.daily" :key="row.day">
              <th scope="row">
                <RouterLink
                  :to="orders({ from: row.day, to: row.day })"
                  :aria-label="'Conferir pedidos de ' + longDay(row.day)"
                  >{{ shortDay(row.day) }}</RouterLink
                >
              </th>
              <td>{{ money(row.soldAmountCents) }}</td>
              <td>{{ row.confirmedCount }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="seriesMode === 'Gráfico' && day"
          ><p aria-live="polite">
            {{ longDay(day.day) }} · {{ money(day.soldAmountCents) }} ·
            {{ plural(day.confirmedCount, 'pedido', 'pedidos') }}
          </p>
          <RouterLink
            class="sales-action"
            :to="orders({ from: day.day, to: day.day })"
            >Conferir pedidos do dia</RouterLink
          ></template
        >
      </section>
      <section
        class="surface sales-summary"
        aria-labelledby="commercial-comparison"
      >
        <div class="dashboard-section-head">
          <h3 id="commercial-comparison">Comparação de vendas</h3>
          <div
            v-if="report.comparison"
            role="group"
            aria-label="Exibição da comparação"
          >
            <button
              v-for="mode in ['Gráfico', 'Tabela']"
              :key="mode"
              type="button"
              class="soft"
              :aria-pressed="comparisonMode === mode"
              @click="comparisonMode = mode"
            >
              {{ mode }}
            </button>
          </div>
        </div>
        <p v-if="!report.comparison">
          Primeiro dia do mês. A comparação estará disponível após o primeiro
          dia completo.
        </p>
        <template v-else>
          <p v-if="report.comparison.partial">
            Hoje, parcial · Ontem, dia completo
          </p>
          <p v-else>Dias completos equivalentes</p>
          <p v-for="side in sides" :key="side">
            <RouterLink :to="orders(report.comparison[side])"
              >Conferir pedidos
              {{
                side === 'current'
                  ? 'do intervalo atual'
                  : 'do intervalo anterior'
              }}
              · {{ dates(report.comparison[side]) }}</RouterLink
            >
          </p>
          <dl v-if="comparisonMode === 'Gráfico'" class="pairs">
            <div v-for="metric in metrics" :key="metric.key">
              <dt>{{ metric.label }}</dt>
              <dd v-for="side in sides" :key="side">
                <span
                  >{{ side === 'current' ? 'Atual' : 'Anterior' }} ·
                  {{
                    format(metric.key, report.comparison[side][metric.key])
                  }}</span
                ><span class="pair-track" aria-hidden="true"
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
              <dd v-if="!report.comparison.partial">
                Diferença · {{ difference(metric.key) }}
              </dd>
            </div>
          </dl>
          <div v-else class="daily-scroll">
            <table>
              <caption class="sr-only">
                Comparação de vendas
              </caption>
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Atual</th>
                  <th>Anterior</th>
                  <th v-if="!report.comparison.partial">Diferença</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="metric in metrics" :key="metric.key">
                  <th scope="row">{{ metric.label }}</th>
                  <td v-for="side in sides" :key="side">
                    {{
                      format(metric.key, report.comparison[side][metric.key])
                    }}
                  </td>
                  <td v-if="!report.comparison.partial">
                    {{ difference(metric.key) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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
  padding: var(--space-4);
  min-inline-size: 0;
}
.sales-summary h2,
.sales-summary h3 {
  margin-block: 0 var(--space-2);
}
.sales-kpis,
.pairs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}
.sales-kpis dd,
.pairs dd {
  margin: 0;
}
.sales-kpis dd:first-of-type {
  font-weight: 700;
  font-size: var(--text-lg);
}
.sales-action {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--target-min);
  padding-inline: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-accent-solid);
  color: var(--color-on-accent);
  font-weight: 600;
  text-decoration: underline;
}
.sales-action:hover {
  text-decoration-thickness: 0.14em;
}
.sales-action:focus-visible,
.day-bar:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: 2px;
}
.sales-action:active {
  text-decoration-style: double;
}
.sales-summary [aria-pressed='true'] {
  outline: 2px solid var(--color-accent-solid);
  outline-offset: -2px;
}
.daily-scroll {
  overflow-x: auto;
}
.daily-bars {
  display: flex;
  gap: var(--space-1);
  min-inline-size: max-content;
}
.day-bar {
  display: grid;
  align-items: end;
  justify-items: center;
  background: var(--color-surface);
  color: inherit;
  border: 0;
  min-inline-size: var(--target-min);
  padding: var(--space-1);
  cursor: pointer;
}
.day-track {
  height: 6rem;
  width: 60%;
  display: flex;
  align-items: end;
  border-bottom: 1px solid var(--color-border);
}
.day-track > span,
.pair-track > span {
  display: block;
  background: var(--color-accent-solid);
  width: 100%;
}
.pairs > div {
  flex: 1 1 12rem;
  min-inline-size: 0;
}
.pairs dt {
  font-weight: 700;
}
.pair-track {
  display: block;
  background: var(--color-border);
  margin-block: var(--space-1);
  height: 0.5rem;
}
.pair-track > span {
  height: 100%;
}
.pair-track > .previous {
  background: var(--color-text-muted);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  padding: var(--space-2);
  text-align: start;
  border-bottom: 1px solid var(--color-border);
}
</style>
