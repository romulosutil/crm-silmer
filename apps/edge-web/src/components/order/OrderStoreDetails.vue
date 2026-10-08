<script setup>
import { computed } from 'vue';
import { formatPhoneNumber } from '../../lib/format.js';
import {
  amountLabel,
  audienceLabel,
  dayLabel,
  paymentConditionLabel,
  STORE_ORIGIN_LABEL,
  storePaymentLabel,
} from '../../lib/order-format.js';

/**
 * ADR 027 (LOJ-08): what a site shop order holds, read only. The order is
 * born confirmed and locked, so there is nothing to edit: the page shows the
 * same standard fields the simplified ficha prints.
 */
const props = defineProps({
  order: { type: Object, required: true },
});

const entries = computed(() => {
  const ficha = props.order.ficha ?? {};
  const loja = ficha.loja ?? {};
  const item = Array.isArray(ficha.items) ? (ficha.items[0] ?? {}) : {};
  const grade = Array.isArray(item.grade) ? item.grade : [];
  return [
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
      key: 'data',
      label: 'Data do pedido',
      value: dayLabel(props.order.orderDate),
    },
    { key: 'retirada', label: 'Retirada na loja', value: loja.retirada },
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
        O cliente pagou o Pix estático do site e informou o pagamento. O Pix não
        identifica o pedido: confira o valor no extrato do Sicredi antes de
        entregar o kit.
      </p>
      <dl class="op-service">
        <div v-for="entry in entries" :key="entry.key">
          <dt>{{ entry.label }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
