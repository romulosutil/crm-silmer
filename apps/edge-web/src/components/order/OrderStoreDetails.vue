<script setup>
import { computed } from 'vue';
import { formatPhoneNumber } from '../../lib/format.js';
import {
  leadTimeLabel,
  storeProductLabel,
  storeReceiptUrl,
} from '../../lib/order-format.js';

/**
 * ADRs 027, 028 and 031 (LOJ-35): what a site shop order holds, read only.
 * The order is born confirmed and locked after InfinitePay confirms the Pix,
 * so there is nothing to edit: the sheet shows only what production and the
 * contact with the customer use. Amount, payment and confirmation are in the
 * "Fechamento e pagamento" panel beside it, as on any confirmed order.
 */
const props = defineProps({
  order: { type: Object, required: true },
});

const receiptUrl = computed(() => storeReceiptUrl(props.order));

/** `10` → `10 peças`. @param {unknown} pieces */
function piecesLabel(pieces) {
  const total = Number(pieces);
  if (!Number.isSafeInteger(total) || total <= 0) return '';
  return total === 1 ? '1 peça' : `${total} peças`;
}

const entries = computed(() => {
  const ficha = props.order.ficha ?? {};
  const loja = ficha.loja ?? {};
  const item = Array.isArray(ficha.items) ? (ficha.items[0] ?? {}) : {};
  const grade = Array.isArray(item.grade) ? item.grade : [];
  return [
    { key: 'produto', label: 'Produto', value: storeProductLabel(props.order) },
    { key: 'cor', label: 'Cor', value: item.cor },
    {
      key: 'tamanho',
      label: 'Tamanho',
      value: grade
        .map((line) => line.tamanho)
        .filter(Boolean)
        .join(' / '),
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      value: piecesLabel(props.order.totalPieces),
    },
    {
      key: 'prazo',
      label: 'Prazo da cor',
      value: leadTimeLabel(props.order.leadTimeBusinessDays),
    },
    { key: 'cliente', label: 'Cliente', value: ficha.summary?.cliente },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      value: loja.telefone ? formatPhoneNumber(loja.telefone) : '',
    },
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
        A InfinitePay confirmou o Pix e o pedido entrou pelo checkout do site já
        confirmado. Retirada na loja é o padrão; se o cliente quiser receber, a
        equipe combina o frete pelo WhatsApp abaixo.
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
