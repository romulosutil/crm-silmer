<script setup>
import { computed } from 'vue';
import { formatPhoneNumber } from '../../lib/format.js';
import {
  amountLabel,
  audienceLabel,
  dayLabel,
  leadTimeLabel,
  paymentConditionLabel,
  STORE_ORIGIN_LABEL,
  storePaymentLabel,
  storeReceiptUrl,
} from '../../lib/order-format.js';

/**
 * ADRs 027 and 028 (LOJ-22): what a site shop order holds, read only. The
 * order is born confirmed and locked after InfinitePay confirms the Pix, so
 * there is nothing to edit: the page shows the same standard fields the
 * simplified ficha prints, and the receipt link when the gateway gave one.
 */
const props = defineProps({
  order: { type: Object, required: true },
});

const receiptUrl = computed(() => storeReceiptUrl(props.order));

const entries = computed(() => {
  const ficha = props.order.ficha ?? {};
  const loja = ficha.loja ?? {};
  const payment = props.order.gatewayPayment ?? {};
  const item = Array.isArray(ficha.items) ? (ficha.items[0] ?? {}) : {};
  const grade = Array.isArray(item.grade) ? item.grade : [];
  return [
    {
      key: 'numero-loja',
      label: 'Número da loja',
      value: props.order.storeNumber,
    },
    { key: 'cliente', label: 'Cliente', value: ficha.summary?.cliente },
    {
      key: 'telefone',
      label: 'Telefone',
      value: loja.telefone ? formatPhoneNumber(loja.telefone) : '',
    },
    { key: 'produto', label: 'Produto', value: loja.produto?.nome },
    { key: 'tipo', label: 'Tipo', value: item.tipo },
    { key: 'publico', label: 'Público', value: audienceLabel(item.publico) },
    { key: 'cor', label: 'Cor', value: item.cor },
    {
      key: 'malha',
      label: 'Malha',
      value: Array.isArray(item.malhas) ? item.malhas.join(' / ') : '',
    },
    { key: 'gola', label: 'Gola', value: item.gola },
    {
      key: 'tamanho',
      label: 'Tamanho',
      value: grade.map((line) => line.tamanho).join(' / '),
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      value: String(props.order.totalPieces ?? ''),
    },
    {
      key: 'prazo',
      label: 'Prazo',
      value: leadTimeLabel(props.order.leadTimeBusinessDays),
    },
    {
      key: 'valor',
      label: 'Valor',
      value: amountLabel(props.order.finalAmountCents),
    },
    {
      key: 'pagamento',
      label: 'Pagamento',
      value: `${paymentConditionLabel(props.order.paymentCondition)} · ${storePaymentLabel(props.order)}`,
    },
    {
      key: 'valor-pago',
      label: 'Valor pago',
      value: amountLabel(payment.paidAmountCents),
    },
    {
      key: 'nsu',
      label: 'Transação InfinitePay (NSU)',
      value: payment.transactionNsu,
    },
    {
      key: 'data',
      label: 'Data do pedido',
      value: dayLabel(props.order.orderDate),
    },
    { key: 'origem', label: 'Origem', value: STORE_ORIGIN_LABEL },
  ].filter((entry) => typeof entry.value === 'string' && entry.value !== '');
});
</script>

<template>
  <section class="op-sheet op-store" aria-labelledby="order-store-title">
    <div class="op-sheet-head">
      <h2 id="order-store-title">Pedido da loja do site</h2>
      <span class="op-quiet-tag">travado</span>
    </div>
    <div class="op-sheet-body">
      <p class="op-hint">
        A InfinitePay confirmou o Pix e o pedido entrou pelo checkout do site. O
        atendimento depois da compra segue pelo WhatsApp do vendedor.
      </p>
      <dl class="op-service">
        <div v-for="entry in entries" :key="entry.key">
          <dt>{{ entry.label }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
        <div v-if="receiptUrl">
          <dt>Comprovante</dt>
          <dd>
            <a :href="receiptUrl" target="_blank" rel="noopener noreferrer"
              >Comprovante InfinitePay<span class="sr-only">
                (abre em nova aba)</span
              ></a
            >
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>
