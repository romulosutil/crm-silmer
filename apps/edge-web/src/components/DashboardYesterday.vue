<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import AppIcon from './AppIcon.vue';
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
/** @param {string} status */
function recipientTone(status) {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'outcome_unknown') return 'error';
  if (status === 'pending' || status === 'reserved') return 'info';
  return undefined;
}
/** @param {string} status */
function recipientIcon(status) {
  if (status === 'sent') return 'check';
  if (status === 'failed' || status === 'outcome_unknown') return 'alert';
  return 'clock';
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
      <div class="yesterday-head-copy">
        <h2 id="dashboard-yesterday-title">Resumo automático de ontem</h2>
        <div v-if="data" class="yesterday-badges">
          <span class="badge" :data-tone="data.snapshot ? 'success' : 'info'">
            <AppIcon :name="data.snapshot ? 'check' : 'info'" />
            {{ data.snapshot ? 'Registro preparado' : 'Prévia dinâmica' }}
          </span>
          <span class="yesterday-day">{{ dayLabel(data.day) }}</span>
        </div>
      </div>
      <button
        type="button"
        class="secondary yesterday-refresh"
        :aria-disabled="loading"
        @click="!loading && refresh()"
      >
        <AppIcon name="reset" />Atualizar resumo
      </button>
    </div>
    <div v-if="error" class="audit-note yesterday-error" role="alert">
      <p>{{ error }} Consulte o resumo novamente.</p>
    </div>
    <p v-if="!data && loading" class="dashboard-data-loading" role="status">
      Consultando o resumo de ontem…
    </p>
    <template v-if="data">
      <div class="yesterday-meta">
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
      </div>
      <dl class="yesterday-values">
        <div class="yesterday-tile">
          <dt>Vendido</dt>
          <dd>{{ money(data.totals.soldAmountCents) }}</dd>
        </div>
        <div class="yesterday-tile">
          <dt>Pedidos confirmados</dt>
          <dd>{{ data.totals.confirmedCount }}</dd>
        </div>
        <div class="yesterday-tile">
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
      <details class="yesterday-preview">
        <summary>Conferir o texto do resumo</summary>
        <p class="yesterday-text">{{ data.previewText }}</p>
      </details>
      <div class="yesterday-recipients-block">
        <h3>Destinos autorizados</h3>
        <ul v-if="data.recipients.length" class="yesterday-recipients">
          <li v-for="recipient in data.recipients" :key="recipient.id">
            <span class="yesterday-recipient-name">{{ recipient.label }}</span>
            <span class="yesterday-recipient-state">
              <span class="badge" :data-tone="recipientTone(recipient.status)">
                <AppIcon :name="recipientIcon(recipient.status)" />
                {{
                  checkpointDeliveryLabels[recipient.status] ??
                  'Situação indisponível'
                }}
              </span>
              <span v-if="recipient.updatedAt" class="yesterday-recipient-time">
                {{ liveTime(recipient.updatedAt) }}
              </span>
            </span>
          </li>
        </ul>
        <p v-else class="yesterday-empty">Nenhum destino configurado.</p>
      </div>
    </template>
  </section>
</template>
<style scoped>
.yesterday {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
.yesterday .dashboard-section-head {
  margin-block-end: 0;
}
.yesterday-head-copy {
  display: grid;
  gap: var(--space-2);
}
.yesterday-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.yesterday-badges .badge,
.yesterday-recipient-state .badge {
  gap: var(--space-1);
}
.yesterday-badges .app-icon,
.yesterday-recipient-state .app-icon {
  inline-size: 0.875rem;
  block-size: 0.875rem;
  flex: none;
}
.yesterday-day {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.yesterday-refresh {
  min-block-size: var(--target-min);
}
.yesterday-meta {
  display: grid;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.yesterday-meta p {
  margin: 0;
}
.yesterday-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.yesterday-tile {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 0;
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.yesterday-tile dt {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.yesterday-tile dd {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.yesterday-preview {
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.yesterday-preview summary {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  cursor: pointer;
}
.yesterday-text {
  margin: 0;
  padding: 0 var(--space-4) var(--space-4);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  color: var(--color-text);
}
.yesterday-recipients-block h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.yesterday-recipients {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.yesterday-recipients li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  padding-block: var(--space-2);
  border-block-end: 1px solid var(--color-border-subtle);
}
.yesterday-recipients li:last-child {
  border-block-end: 0;
  padding-block-end: 0;
}
.yesterday-recipient-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}
.yesterday-recipient-state {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.yesterday-recipient-time,
.yesterday-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.yesterday-error {
  margin: 0;
}
@media (max-width: 600px) {
  .yesterday {
    padding: var(--space-4);
  }
  .yesterday-values {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .yesterday-tile:first-child {
    grid-column: 1 / -1;
  }
  .yesterday-refresh {
    inline-size: 100%;
  }
}
</style>
