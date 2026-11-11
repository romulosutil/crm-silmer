<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import OrderSheetHead from '../../apps/edge-web/src/components/order/OrderSheetHead.vue';
import {
  operationalDay,
  dayLabel,
} from '../../apps/edge-web/src/lib/order-format.js';

// DTL-P02: isolated visual snapshot; no financial commands or production imports.
const editing = inject('orderEditing');
const open = computed(() => editing?.isSectionOpen?.('milestones') ?? true);
const scenario = ref('full');
const deliveries = ref({});
const delivery = computed(() => deliveries.value[scenario.value] ?? null);
const deliveryDialog = ref(null);
const deliveryTrigger = ref(null);
const deliveryResult = ref(null);
const cancelDelivery = ref(null);
const pendingDelivery = ref(null);
const deliveryNotice = ref('');

async function askDelivery() {
  const instant = new Date();
  pendingDelivery.value = {
    day: operationalDay(instant),
    instant: instant.toISOString(),
  };
  deliveryDialog.value.showModal();
  await nextTick();
  cancelDelivery.value?.focus();
}
function confirmDelivery() {
  if (!delivery.value) {
    const instant = new Date();
    deliveries.value[scenario.value] = {
      day: operationalDay(instant),
      instant: instant.toISOString(),
    };
  }
  deliveryNotice.value = `Entrega confirmada em ${dayLabel(delivery.value.day)}. Somente neste protótipo.`;
  deliveryDialog.value.close();
}
async function restoreDeliveryFocus() {
  await nextTick();
  (delivery.value ? deliveryResult.value : deliveryTrigger.value)?.focus();
}
const full = computed(() => scenario.value === 'full');
const legacy = computed(() => scenario.value === 'legacy');
const failed = computed(() => scenario.value === 'error');
const reversed = computed(() => scenario.value === 'reverse');
const paid = computed(() =>
  full.value || legacy.value ? '10/11/2026' : 'Ainda não quitado',
);
const received = computed(() =>
  failed.value
    ? 'Indisponível'
    : legacy.value
      ? 'Sem detalhamento'
      : full.value
        ? 'R$ 1.200,00'
        : 'R$ 360,00',
);
const balance = computed(() =>
  failed.value
    ? 'Indisponível'
    : legacy.value
      ? 'Sem detalhamento'
      : full.value
        ? 'R$ 0,00'
        : 'R$ 840,00',
);
const paymentEvents = computed(() => {
  const rows = [
    {
      id: 'contact',
      day: '06 nov',
      date: '2026-11-06',
      title: 'Primeiro contato',
      subtitle: 'Conversa iniciada',
    },
    {
      id: 'confirmed',
      day: '08 nov',
      date: '2026-11-08',
      title: 'Confirmação atual do pedido',
      subtitle: 'Valor final: R$ 1.200,00',
    },
  ];
  if (failed.value) return rows;
  if (legacy.value)
    return [
      ...rows,
      {
        id: 'legacy',
        day: '10 nov',
        date: '2026-11-10',
        title: 'Quitação registrada',
        subtitle: 'Sem detalhamento de recebimentos',
        badge: 'Histórico legado',
      },
    ];
  rows.push({
    id: 'signal',
    day: '09 nov',
    date: '2026-11-09',
    title: 'Sinal confirmado',
    subtitle: 'InfinitePay · Pix',
    amount: 'R$ 360,00',
    badge: 'Confirmado pela InfinitePay',
    type: 'receipt',
    detail:
      'Confirmação no CRM: 09/11/2026 às 14:32 (São Paulo). O horário efetivo da transação no provedor não está disponível.',
  });
  if (full.value || reversed.value)
    rows.push({
      id: 'manual',
      day: '10 nov',
      date: '2026-11-10',
      title: 'Saldo recebido',
      subtitle: 'Registro manual · Transferência bancária',
      amount: 'R$ 840,00',
      badge: reversed.value
        ? 'Revertido · não compõe o saldo'
        : 'Recebimento confirmado',
      type: 'receipt',
      detail:
        'Recebido em 10/11/2026. Registrado por Vendedor de demonstração em 11/11/2026 às 09:15 (São Paulo).',
    });
  if (reversed.value)
    rows.push({
      id: 'reversal',
      day: '11 nov',
      date: '2026-11-11',
      title: 'Registro manual revertido',
      subtitle: 'Correção do lançamento · sem devolução pelo CRM',
      amount: '− R$ 840,00',
      badge: 'Correção registrada',
      type: 'correction',
      detail:
        'Reversão registrada em 11/11/2026 às 11:05, vinculada ao recebimento manual de 10/11. O lançamento original permanece no histórico.',
    });
  return rows;
});
const events = computed(() => {
  if (!delivery.value) return paymentEvents.value;
  const day = delivery.value.day;
  const stamp = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(delivery.value.instant));
  return [
    ...paymentEvents.value,
    {
      id: 'delivered',
      day: new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(delivery.value.instant)),
      year: day.slice(0, 4),
      date: day,
      title: 'Pedido entregue',
      subtitle: 'Entrega confirmada pelo responsável',
      detail: `Confirmada por Marina — demonstração em ${stamp} (São Paulo). Esta confirmação é fictícia.`,
      detailLabel: 'Ver detalhes da entrega',
    },
  ];
});
</script>

<template>
  <section class="op-sheet" aria-labelledby="dates-preview-title">
    <OrderSheetHead
      title-id="dates-preview-title"
      title="Datas do pedido"
      state="Protótipo"
      :can-edit="false"
      section="milestones"
      body-id="dates-preview-body"
    />
    <div
      id="dates-preview-body"
      class="op-sheet-body dates-preview"
      :hidden="!open"
    >
      <div class="preview-toolbar">
        <p class="op-hint">
          Prévia visual com dados fictícios. Os exemplos abaixo não alteram o
          pedido.
        </p>
        <div class="op-field">
          <label for="dates-preview-scenario">Exemplo</label>
          <select
            id="dates-preview-scenario"
            v-model="scenario"
            @change="deliveryNotice = ''"
          >
            <option value="full">Pagamento misto · quitado</option>
            <option value="partial">InfinitePay · sinal recebido</option>
            <option value="reverse">Manual · registro revertido</option>
            <option value="legacy">Pagamento legado</option>
            <option value="error">Falha ao consultar histórico</option>
          </select>
        </div>
      </div>
      <dl class="preview-milestones">
        <div>
          <dt>Primeiro contato</dt>
          <dd>06/11/2026</dd>
        </div>
        <div>
          <dt>Pago em</dt>
          <dd>{{ paid }}</dd>
          <span class="op-hint">Quitação integral</span>
        </div>
        <div>
          <dt>Entregue em</dt>
          <dd ref="deliveryResult" tabindex="-1">
            {{ delivery ? dayLabel(delivery.day) : 'Ainda não entregue' }}
          </dd>
          <button
            v-if="!delivery"
            ref="deliveryTrigger"
            type="button"
            class="preview-delivery-button"
            @click="askDelivery"
          >
            Confirmar entrega
          </button>
          <span v-else class="op-hint">Entrega confirmada</span>
        </div>
      </dl>
      <h3>Linha do tempo</h3>
      <p v-if="failed" role="status" class="op-alert">
        Não foi possível carregar os recebimentos. As datas do pedido continuam
        disponíveis.
      </p>
      <p v-if="legacy" class="op-hint">
        A data foi preservada. A origem e os valores dos recebimentos não estão
        disponíveis.
      </p>
      <ol
        class="preview-timeline"
        aria-label="Acontecimentos de demonstração do pedido"
      >
        <li v-for="event in events" :key="event.id" :data-kind="event.type">
          <time :datetime="event.date"
            >{{ event.day }}<span>{{ event.year ?? '2026' }}</span></time
          >
          <span class="preview-track" aria-hidden="true"
            ><span class="preview-dot"></span
          ></span>
          <div class="preview-entry">
            <div class="preview-entry-head">
              <strong>{{ event.title }}</strong
              ><strong v-if="event.amount" class="op-num">{{
                event.amount
              }}</strong>
            </div>
            <p class="op-hint">{{ event.subtitle }}</p>
            <span v-if="event.badge" class="preview-badge">{{
              event.badge
            }}</span>
            <details v-if="event.detail">
              <summary>
                {{ event.detailLabel ?? 'Ver detalhes do recebimento' }}
              </summary>
              <p class="op-hint">{{ event.detail }}</p>
            </details>
          </div>
        </li>
      </ol>
      <div class="preview-totals">
        <span
          >Recebido: <strong>{{ received }}</strong></span
        ><span
          >Falta receber: <strong>{{ balance }}</strong></span
        >
      </div>
      <p class="sr-only" aria-live="polite">
        {{ paid }}. Recebido: {{ received }}. Falta receber: {{ balance }}.
      </p>
      <p v-if="deliveryNotice" role="status" class="op-hint">
        {{ deliveryNotice }}
      </p>
    </div>
    <Teleport to="body">
      <dialog
        ref="deliveryDialog"
        class="command-dialog preview-delivery-dialog"
        aria-labelledby="delivery-preview-title"
        aria-describedby="delivery-preview-description"
        @close="restoreDeliveryFocus"
      >
        <form @submit.prevent="confirmDelivery">
          <h2 id="delivery-preview-title">Confirmar entrega</h2>
          <p id="delivery-preview-description">
            Confirma que o cliente recebeu este pedido?
          </p>
          <p>
            Entregue em:
            <strong>{{
              pendingDelivery ? dayLabel(pendingDelivery.day) : ''
            }}</strong>
            <span class="op-hint"> · hoje, em São Paulo</span>
          </p>
          <p class="op-hint">
            A data de entrega não altera o pagamento do pedido. Esta ação é uma
            simulação do protótipo.
          </p>
          <div class="op-form-actions">
            <button
              ref="cancelDelivery"
              type="button"
              @click="deliveryDialog.close()"
            >
              Cancelar
            </button>
            <button type="submit" class="op-save">
              Sim, confirmar entrega
            </button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.preview-toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
.preview-toolbar > p {
  max-inline-size: 40ch;
}
.preview-toolbar label {
  min-inline-size: 0;
}
.preview-toolbar select {
  max-inline-size: 100%;
}
.preview-milestones {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  padding-block: var(--space-4);
  border-block: 1px solid var(--color-border);
  margin: 0 0 var(--space-6);
}
dt,
time {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
dd {
  margin: var(--space-1) 0 0;
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}
h3 {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  margin: 0 0 var(--space-5);
}
.preview-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.preview-timeline li {
  display: grid;
  grid-template-columns: 5rem 1rem minmax(0, 1fr);
  gap: var(--space-3);
}
time span {
  display: block;
}
.preview-track {
  display: flex;
  justify-content: center;
  position: relative;
}
.preview-track::after {
  content: '';
  position: absolute;
  inset-block: var(--space-4) 0;
  inline-size: 1px;
  background: var(--color-border);
}
li:last-child .preview-track::after {
  display: none;
}
.preview-dot {
  inline-size: var(--space-2);
  block-size: var(--space-2);
  margin-top: var(--space-2);
  background: var(--color-text-muted);
  border-radius: var(--radius-pill);
}
[data-kind='receipt'] .preview-dot {
  background: var(--status-success-text);
}
[data-kind='correction'] .preview-dot {
  background: var(--status-error-text);
  border-radius: 0;
}
.preview-entry {
  padding-bottom: var(--space-6);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.preview-entry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.preview-entry-head strong {
  font-weight: var(--weight-medium);
}
.preview-badge {
  display: inline-block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  margin-top: var(--space-2);
}
details {
  margin-top: var(--space-2);
}
summary {
  color: var(--color-link);
  font-size: var(--text-sm);
  padding-block: var(--space-2);
  cursor: pointer;
}
summary:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
.preview-totals {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-4);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 480px) {
  .preview-timeline li {
    grid-template-columns: 3.5rem 0.75rem minmax(0, 1fr);
    gap: var(--space-2);
  }
  .preview-milestones {
    gap: var(--space-2);
  }
  .preview-milestones dd {
    font-size: var(--text-sm);
  }
}
.preview-delivery-button {
  margin-top: var(--space-2);
  white-space: normal;
}
.preview-delivery-dialog form {
  display: grid;
  gap: var(--space-4);
}
.preview-delivery-dialog h2 {
  margin: 0;
  font-size: var(--text-xl);
}
.preview-delivery-dialog p {
  margin: 0;
}
.preview-delivery-dialog button {
  min-block-size: var(--target-min);
}
</style>
