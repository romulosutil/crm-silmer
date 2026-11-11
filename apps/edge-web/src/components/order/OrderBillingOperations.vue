<script setup>
import { computed } from 'vue';
import { billingOperations } from '../../lib/order-billing-operations.js';
import { billingMoney, billingUrl } from '../../lib/order-billing.js';
import { dateTimeBR } from '../../lib/format.js';
import OrderIcon from './OrderIcon.vue';

const props = defineProps({
  billing: { type: Object, required: true },
  history: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: false },
  mutable: { type: Boolean, default: false },
  privateReadable: { type: Boolean, default: false },
  now: { type: Number, default: () => Date.now() },
});
const emit = defineEmits(['check', 'reverse', 'send', 'retry', 'load-more']);
const operations = computed(() =>
  billingOperations(props.billing, props.history),
);
const methods = {
  cash: 'Dinheiro',
  pix: 'Pix',
  pix_external: 'Pix fora da InfinitePay',
  bank_transfer: 'Transferência bancária',
  credit_card: 'Cartão',
  card_external: 'Cartão em outra maquininha',
};
const labels = {
  queued: 'Na fila',
  creating: 'Gerando link',
  waiting: 'Aguardando pagamento',
  unknown: 'Resultado a conferir',
  paid: 'Recebido',
  review: 'Precisa de conferência',
  closed: 'Encerrada sem pagamento',
};
const eventLabels = {
  charge: 'Cobrança criada',
  receipt: 'Pagamento registrado',
  intent: 'Envio da cobrança',
  correction: 'Correção da cobrança',
  refund: 'Devolução registrada',
  external_receipt: 'Recebimento externo registrado',
  external_reversal: 'Estorno do registro externo',
  payment_check: 'Conferência de pagamento',
};
const eventStates = {
  waiting_link: 'Aguardando o link',
  queued: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregue',
  failed: 'Falhou',
  unknown: 'Resultado a conferir',
  blocked: 'Bloqueado',
  not_paid: 'Pagamento ainda não confirmado',
  paid: 'Pagamento confirmado',
  review: 'Precisa de conferência',
};
function title(row) {
  return row.external
    ? 'Recebimento manual'
    : row.charge
      ? row.charge.kind === 'signal'
        ? 'Sinal do pedido'
        : row.charge.kind === 'balance'
          ? 'Saldo do pedido'
          : 'Pagamento integral'
      : row.payments.length
        ? 'Recebimento InfinitePay'
        : 'Registro anterior';
}
function day(value) {
  return value ? String(value).slice(0, 10).split('-').reverse().join('/') : '';
}
function method(payment) {
  return `${methods[payment?.method] ?? ''}${payment?.installments > 1 ? ` em ${payment.installments}x` : ''}`;
}
function status(row) {
  if (row.external?.reversedAt) return 'Registro estornado';
  if (
    row.external?.applicationValid === false ||
    row.payments.some(
      (payment) => payment.active === false && !payment.refundedAmountCents,
    )
  )
    return 'Precisa de conferência';
  if (row.charge?.refundedAmountCents)
    return row.charge.refundedAmountCents >= row.charge.amountCents
      ? 'Devolvido'
      : 'Devolução parcial';
  if (
    row.charge?.status === 'waiting' &&
    Date.parse(row.charge.validUntil) <= props.now
  )
    return 'Link vencido';
  return row.charge
    ? (labels[row.charge.status] ?? 'Precisa de conferência')
    : row.external || row.payments.length
      ? 'Recebido'
      : 'Registro histórico';
}
function reusable(row) {
  const charge = row.charge;
  return (
    props.mutable &&
    props.billing.chatSendEnabled &&
    !props.billing.reviewRequired &&
    props.billing.balanceAmountCents > 0 &&
    charge?.status === 'waiting' &&
    charge.amountCents <= props.billing.balanceAmountCents &&
    Date.parse(charge.validUntil) > props.now &&
    Boolean(billingUrl(charge.checkoutUrl))
  );
}
function canSend(row) {
  return (
    reusable(row) &&
    !props.hasMore &&
    !row.events.some(
      (item) => item.intentId || ['intent', 'correction'].includes(item.kind),
    )
  );
}
function retryIntent(row) {
  const intent = row.events.find((item) => item.intentId);
  return reusable(row) && intent?.status === 'failed' ? intent : null;
}
function eventState(item) {
  // A charge row carries its CURRENT status at created_at, not a payment event.
  return ['intent', 'correction', 'payment_check'].includes(item.kind)
    ? (eventStates[item.status] ?? '')
    : '';
}
</script>

<template>
  <section
    class="billing-operations"
    aria-labelledby="billing-operations-title"
  >
    <h3 id="billing-operations-title">
      Cobranças e recebimentos <span>{{ operations.length }}</span>
    </h3>
    <p v-if="!operations.length" class="op-hint">
      Nenhuma cobrança ou recebimento registrado.
    </p>
    <ol v-else class="billing-operation-list">
      <li v-for="row in operations" :key="row.id">
        <details
          class="billing-operation"
          :open="
            Boolean(
              row.charge &&
              ['queued', 'creating', 'waiting', 'unknown', 'review'].includes(
                row.charge.status,
              ),
            )
          "
        >
          <summary :data-operation-id="row.id">
            <OrderIcon
              :name="
                row.external?.reversedAt
                  ? 'swap'
                  : status(row) === 'Recebido'
                    ? 'check'
                    : 'clock'
              "
            />
            <span class="billing-operation-info"
              ><strong>{{ title(row) }}</strong
              ><span
                >{{
                  row.external
                    ? 'Registro manual'
                    : row.charge || row.payments.length
                      ? 'InfinitePay'
                      : 'Movimentação preservada'
                }}<template
                  v-if="method(row.external ?? row.payments[0] ?? row.charge)"
                >
                  ·
                  {{
                    method(row.external ?? row.payments[0] ?? row.charge)
                  }}</template
                ><template v-if="row.date">
                  ·
                  {{
                    row.external || (!row.charge && row.payments.length)
                      ? `Recebido em ${day(row.date)}`
                      : `${row.charge ? 'Criada em' : 'Registrado em'} ${dateTimeBR(row.date)}`
                  }}</template
                ></span
              ></span
            >
            <span class="billing-operation-value"
              ><strong>{{ billingMoney(row.amountCents) }}</strong
              ><span :data-success="status(row) === 'Recebido' || undefined">{{
                status(row)
              }}</span></span
            >
            <span class="billing-operation-toggle"
              >Detalhes <OrderIcon name="chevron"
            /></span>
          </summary>
          <div class="billing-operation-body">
            <template v-if="row.charge">
              <p v-if="row.charge.validUntil" class="op-hint">
                {{
                  Date.parse(row.charge.validUntil) <= now
                    ? 'Validade encerrada'
                    : 'Válido até'
                }}
                · {{ dateTimeBR(row.charge.validUntil) }}
              </p>
              <p v-if="row.charge.refundedAmountCents" class="op-hint">
                Devolução conciliada:
                {{ billingMoney(row.charge.refundedAmountCents) }}. O pagamento
                original foi preservado.
              </p>
              <div class="billing-operation-actions">
                <button
                  v-if="canSend(row)"
                  type="button"
                  @click="emit('send', $event, row.charge)"
                >
                  Enviar cobrança
                </button>
                <button
                  v-if="retryIntent(row)"
                  type="button"
                  @click="emit('retry', $event, retryIntent(row))"
                >
                  Revisar nova tentativa
                </button>
                <p v-if="reusable(row) && hasMore" class="op-hint">
                  Carregue as movimentações anteriores para conferir os envios
                  desta cobrança.
                </p>
                <button
                  v-if="
                    billing.canManage &&
                    billing.paymentCheckEnabled &&
                    ['waiting', 'unknown', 'review'].includes(row.charge.status)
                  "
                  type="button"
                  :disabled="!mutable"
                  @click="emit('check', $event, row.charge)"
                >
                  Conferir pagamento
                </button>
                <slot
                  name="charge-actions"
                  :charge="row.charge"
                  :blocked="!mutable || !privateReadable"
                  :readable="privateReadable"
                />
              </div>
            </template>
            <div
              v-for="payment in row.payments"
              :key="payment.id"
              class="billing-operation-payment"
            >
              <p>
                {{ billingMoney(payment.amountCents) }} · {{ method(payment)
                }}<template v-if="payment.receivedOn">
                  ·
                  {{
                    payment.source === 'external'
                      ? 'Recebido em'
                      : 'Confirmado no CRM em'
                  }}
                  {{
                    payment.source !== 'external' && payment.recordedAt
                      ? dateTimeBR(payment.recordedAt)
                      : day(payment.receivedOn)
                  }}</template
                >
              </p>
              <p
                v-if="payment.active === false && !row.external?.reversedAt"
                class="op-hint"
              >
                Recebimento pendente de conferência, devolvido ou sem crédito
                aplicado.
              </p>
              <a
                v-if="privateReadable && billingUrl(payment.receiptUrl)"
                :href="billingUrl(payment.receiptUrl)"
                target="_blank"
                rel="noopener noreferrer"
                referrerpolicy="no-referrer"
                >Comprovante InfinitePay</a
              >
            </div>
            <template v-if="row.external">
              <p
                v-if="privateReadable && row.external.recordedByName"
                class="op-hint"
              >
                Registrado por {{ row.external.recordedByName
                }}<template v-if="row.external.recordedAt">
                  em {{ dateTimeBR(row.external.recordedAt) }}</template
                >.
              </p>
              <p v-if="privateReadable && row.external.note">
                Observação: {{ row.external.note }}
              </p>
              <p v-if="row.external.reversedAt" class="op-hint">
                Registro estornado em {{ dateTimeBR(row.external.reversedAt)
                }}<template
                  v-if="privateReadable && row.external.reversedByName"
                >
                  por {{ row.external.reversedByName }}</template
                >.<template
                  v-if="privateReadable && row.external.reversalReason"
                >
                  Motivo: {{ row.external.reversalReason }}</template
                >
              </p>
              <button
                v-else-if="billing.canManage"
                type="button"
                :disabled="!mutable"
                @click="emit('reverse', $event, row.external)"
              >
                Estornar registro
              </button>
            </template>
            <template v-if="row.events.length">
              <h4>Movimentações desta operação</h4>
              <ol class="billing-operation-events">
                <li v-for="item in row.events" :key="item.id">
                  <span>{{ dateTimeBR(item.occurredAt) }}</span
                  ><span
                    >{{ eventLabels[item.kind] ?? 'Atualização do pagamento'
                    }}<template v-if="eventState(item)">
                      · {{ eventState(item) }}</template
                    ><template v-if="item.supersedesChargeId">
                      · Correção de cobrança anterior</template
                    ><template v-if="item.retryOfIntentId">
                      · Nova tentativa vinculada ao envio anterior</template
                    ></span
                  >
                </li>
              </ol>
            </template>
            <p v-else class="op-hint">
              {{
                hasMore
                  ? 'Carregue as movimentações anteriores para consultar outros registros.'
                  : 'Não há outras movimentações disponíveis nesta consulta.'
              }}
            </p>
          </div>
        </details>
      </li>
    </ol>
    <button
      v-if="hasMore"
      type="button"
      :disabled="loading"
      @click="emit('load-more')"
    >
      Carregar movimentações anteriores
    </button>
  </section>
</template>

<style scoped>
.billing-operations {
  margin-top: var(--space-5);
}
.billing-operations h3 {
  display: flex;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
}
.billing-operations h3 > span {
  color: var(--color-text-muted);
  font-weight: 400;
}
.billing-operation-list,
.billing-operation-events {
  padding: 0;
  margin: 0;
  list-style: none;
}
.billing-operation {
  border-block-start: 1px solid var(--color-border-subtle);
}
.billing-operation-list > li:last-child {
  border-block-end: 1px solid var(--color-border-subtle);
}
.billing-operation > summary {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  padding-block: var(--space-4);
  list-style: none;
  cursor: pointer;
}
.billing-operation > summary::-webkit-details-marker {
  display: none;
}
.billing-operation > summary:hover {
  background: var(--color-surface-muted);
}
.billing-operation > summary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}
.billing-operation-info,
.billing-operation-value {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.billing-operation-info > span,
.billing-operation-value > span {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.billing-operation-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.billing-operation-value > span[data-success] {
  color: var(--status-success-text);
}
.billing-operation-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: var(--space-3);
  color: var(--color-link);
  font-size: var(--text-sm);
}
.billing-operation-toggle .op-icon {
  width: 16px;
  height: 16px;
}
.billing-operation[open] .billing-operation-toggle .op-icon {
  transform: rotate(180deg);
}
.billing-operation-body {
  padding: 0 0 var(--space-4) 36px;
  overflow-wrap: anywhere;
}
.billing-operation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3);
}
.billing-operation-actions:empty {
  display: none;
}
.billing-operation-body button,
.billing-operation-body a {
  min-height: 44px;
}
.billing-operation-body h4 {
  margin: var(--space-4) 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
}
.billing-operation-events {
  display: grid;
  gap: var(--space-2);
}
.billing-operation-events li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
}
.billing-operation-events li > span:first-child {
  color: var(--color-text-muted);
  min-width: 135px;
}
@media (max-width: 600px) {
  .billing-operation > summary {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: var(--space-2);
  }
  .billing-operation-info {
    grid-column: 2 / -1;
  }
  .billing-operation-value {
    grid-column: 2;
    text-align: left;
  }
  .billing-operation-toggle {
    grid-column: 3;
    grid-row: 2;
    margin: 0;
    font-size: var(--text-xs);
  }
  .billing-operation-body {
    padding-inline-start: 28px;
  }
}
</style>
