<script setup>
import { computed, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import OrderCutMapHistory from './OrderCutMapHistory.vue';
import { amountLabel } from '../../lib/order-format.js';

const props = defineProps({
  overview: Object,
  error: Boolean,
  active: String,
  cutting: Boolean,
  cutEnabled: Boolean,
});
defineEmits(['filter', 'cut', 'retry']);

const expanded = ref(false);
const historyOpen = ref(false);
const fmt = new Intl.NumberFormat('pt-BR');
const month = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  timeZone: 'UTC',
});
const options = [
  { value: 'late', label: 'Atrasados', icon: 'alert' },
  { value: 'risk', label: 'Em risco', icon: 'clock' },
  { value: 'arte', label: 'Na arte', icon: 'brush' },
  { value: 'producao', label: 'Na produção', icon: 'scissors' },
  { value: 'pronto', label: 'Prontos', icon: 'package' },
];
const title = computed(() => {
  const day = props.overview?.sales?.to;
  if (!day) return 'Vendas no mês';
  const name = month.format(new Date(day));
  return `${name[0].toUpperCase()}${name.slice(1)} até hoje`;
});

const metrics = computed(() => {
  const sales = props.overview?.sales;
  if (!sales) return [];
  return [
    ['Vendido', 'soldAmountCents', amountLabel],
    ['Pedidos', 'confirmedCount', fmt.format],
    ['Peças', 'pieces', fmt.format],
    ['Ticket médio', 'averageTicketCents', amountLabel],
  ].map(([label, key, formatter]) => {
    const current = sales.current[key];
    const previous = sales.previous[key];
    const variation =
      current !== null && previous > 0
        ? Math.round(((current - previous) * 100) / previous)
        : null;
    return {
      label,
      value: current === null ? '—' : formatter(current),
      variation,
    };
  });
});
</script>

<template>
  <section
    class="portfolio-sales"
    aria-labelledby="portfolio-sales-title"
    :data-expanded="expanded"
  >
    <div class="portfolio-sales-head">
      <h2 id="portfolio-sales-title">{{ title }}</h2>
      <button
        v-if="metrics.length"
        type="button"
        class="portfolio-sales-toggle"
        :aria-expanded="expanded"
        aria-controls="portfolio-sales-panel"
        @click="expanded = !expanded"
      >
        <template v-if="expanded">Recolher</template>
        <template v-else
          >Vendido <strong>{{ metrics[0].value }}</strong></template
        >
        <AppIcon name="chevron" />
      </button>
    </div>
    <div id="portfolio-sales-panel" class="portfolio-sales-panel">
      <dl v-if="metrics.length" class="portfolio-metrics">
        <div v-for="metric in metrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
          <dd
            class="portfolio-variation"
            :data-change="Math.sign(metric.variation ?? 0)"
          >
            <template v-if="metric.variation !== null"
              >{{ metric.variation > 0 ? '+' : '' }}{{ metric.variation }}%
              <span>ante mês anterior</span></template
            >
            <template v-else>Sem base de comparação</template>
          </dd>
        </div>
      </dl>
      <p v-else-if="!error" role="status">Carregando números do mês…</p>
    </div>
    <div v-if="error && !overview" class="portfolio-overview-error">
      <p role="status">Não foi possível carregar os números da carteira.</p>
      <button type="button" class="quiet" @click="$emit('retry')">
        Tentar novamente
      </button>
    </div>
  </section>

  <section
    class="portfolio-production"
    aria-labelledby="portfolio-production-title"
    :data-show-cut-action="historyOpen || cutting"
  >
    <header class="portfolio-production-head">
      <h2 id="portfolio-production-title">Produção</h2>
      <div class="portfolio-production-actions">
        <button
          v-if="!cutting"
          type="button"
          class="quiet portfolio-mobile-cut-maps"
          :aria-expanded="historyOpen"
          aria-controls="cut-map-history"
          @click="historyOpen = !historyOpen"
        >
          <AppIcon name="scissors" /> Mapas de corte
        </button>
        <button
          type="button"
          class="soft portfolio-cut-new"
          :disabled="!cutEnabled && !cutting"
          :aria-expanded="cutting"
          aria-label="Novo mapa de corte"
          aria-controls="cut-selection"
          @click="$emit('cut', $event)"
        >
          <AppIcon name="scissors" />
          <span
            >Novo mapa<span class="portfolio-production-action-detail">
              de corte</span
            ></span
          >
        </button>
        <button
          v-if="!cutting"
          type="button"
          class="quiet portfolio-desktop-cut-history"
          :aria-expanded="historyOpen"
          aria-controls="cut-map-history"
          @click="historyOpen = !historyOpen"
        >
          Histórico de mapas de corte
        </button>
      </div>
    </header>
    <div id="cut-map-history" :hidden="!historyOpen || cutting">
      <OrderCutMapHistory v-if="historyOpen && !cutting" />
    </div>
    <div
      v-if="!cutting"
      class="chip-row"
      role="group"
      aria-label="Filtrar produção"
    >
      <button
        v-for="option in options"
        :key="option.value"
        class="chip"
        type="button"
        :aria-pressed="active === option.value"
        @click="$emit('filter', active === option.value ? '' : option.value)"
      >
        <AppIcon :name="option.icon" /> {{ option.label }}
        <span v-if="overview" class="portfolio-chip-count">{{
          overview.production[option.value]
        }}</span>
      </button>
    </div>
  </section>
</template>
