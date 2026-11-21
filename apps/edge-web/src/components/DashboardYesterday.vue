<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { money } from '../lib/dashboard-format.js';
import { dayLabel } from '../lib/order-format.js';
import {
  liveTime,
  useDashboardRegion,
  checkpointDeliveryLabels,
} from '../lib/dashboard-live.js';

const { data, error, loading, load } = useDashboardRegion();
let timer;
function refresh() {
  if (document.visibilityState !== 'hidden')
    void load('/api/v1/dashboard/checkpoint');
}
onMounted(() => {
  refresh();
  timer = globalThis.setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  globalThis.clearInterval(timer);
  document.removeEventListener('visibilitychange', refresh);
});
</script>
<template>
  <section
    class="dashboard-section yesterday"
    aria-labelledby="dashboard-yesterday-title"
  >
    <div class="dashboard-section-head">
      <h2 id="dashboard-yesterday-title">Resumo automático de ontem</h2>
      <button
        type="button"
        class="secondary"
        :aria-disabled="loading"
        @click="!loading && refresh()"
      >
        Atualizar resumo
      </button>
    </div>
    <p v-if="error">{{ error }} Consulte o resumo novamente.</p>
    <p v-if="!data && loading">Consultando o resumo de ontem…</p>
    <template v-if="data">
      <p>
        <strong>{{
          data.snapshot ? 'Registro preparado' : 'Prévia dinâmica'
        }}</strong>
        · {{ dayLabel(data.day) }}
      </p>
      <p>
        {{ data.enabled ? 'Automação ativada' : 'Automação desativada' }} ·
        {{
          data.configured
            ? 'Destinos configurados'
            : 'Configuração de envio pendente'
        }}
        · previsão diária às {{ data.scheduledAt }} (São Paulo).
      </p>
      <p>
        {{ data.snapshot ? 'Preparado' : 'Calculada' }} em
        {{ liveTime(data.generatedAt) }} (São Paulo).
      </p>
      <dl class="yesterday-values">
        <div>
          <dt>Vendido</dt>
          <dd>{{ money(data.totals.soldAmountCents) }}</dd>
        </div>
        <div>
          <dt>Pedidos confirmados</dt>
          <dd>{{ data.totals.confirmedCount }}</dd>
        </div>
        <div>
          <dt>Ticket médio</dt>
          <dd>
            {{
              data.totals.confirmedCount
                ? money(
                    Math.round(
                      data.totals.soldAmountCents / data.totals.confirmedCount,
                    ),
                  )
                : '—'
            }}
          </dd>
        </div>
      </dl>
      <details>
        <summary>Conferir o texto do resumo</summary>
        <p class="yesterday-text">{{ data.previewText }}</p>
      </details>
      <h3>Destinos autorizados</h3>
      <ul v-if="data.recipients.length">
        <li v-for="recipient in data.recipients" :key="recipient.id">
          {{ recipient.label }} ·
          {{
            checkpointDeliveryLabels[recipient.status] ??
            'Situação indisponível'
          }}<span v-if="recipient.updatedAt">
            · {{ liveTime(recipient.updatedAt) }}</span
          >
        </li>
      </ul>
      <p v-else>Nenhum destino configurado.</p>
    </template>
  </section>
</template>
<style scoped>
.yesterday {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
.yesterday-values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
}
.yesterday-values dd {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
}
.yesterday-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.yesterday summary {
  cursor: pointer;
}
</style>
