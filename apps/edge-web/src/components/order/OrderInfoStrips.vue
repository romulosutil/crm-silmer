<script setup>
import { computed, ref } from 'vue';
import OrderIcon from './OrderIcon.vue';

// The 14 production fields of `ficha-canonical-v2`, which reach the shop
// floor blank and are filled by hand there. The CRM never writes them.
const PRODUCTION_FIELD_COUNT = 14;

/**
 * D11: what the agent collected that has no place on the printed ficha.
 * A key this screen does not know is shown as it came, so a new briefing
 * field appears instead of disappearing.
 */
const SERVICE_LABELS = Object.freeze({
  // ADR 020: what the customer said of the art when it did not name a place,
  // who makes it or a technique; the seller decides on the order.
  artwork_locations: 'Onde vai a estampa',
  artwork_status: 'Arte informada',
  artwork_technique: 'Técnica informada',
  // ADR 025: a split by audience that did not read without doubt.
  audiences: 'Divisão informada',
  city_or_postal_code: 'Cidade ou CEP',
  // ADR 016: the seven points land on the item; they show here only when
  // left to the seller or sent in a shape the order does not read.
  collar: 'Gola informada',
  colors: 'Cores informadas',
  customer_name: 'Nome do cliente informado',
  customizations: 'Personalizações',
  delivery_address: 'Endereço de entrega',
  delivery_mode: 'Forma de entrega',
  // ADR 025 (D5): the fabric is "Modelo de malha" at Silmer.
  fabrics: 'Modelo de malha informado',
  needed_by: 'Data desejada',
  notes: 'Anotações do atendimento',
  numbers: 'Numeração',
  order_name: 'Nome do pedido informado',
  pickup_location: 'Local de retirada',
  product_model: 'Tipo de roupa informado',
  // ADR 020: one name for the garment, whichever field the bot used.
  product_type: 'Tipo de roupa informado',
  purchase_profile: 'Perfil de compra',
  purpose: 'Finalidade',
  quantity: 'Quantidade informada',
  segment: 'Segmento',
  // PIT-08: sizes that did not read without doubt.
  sizes: 'Tamanhos informados',
  sponsors: 'Patrocinadores',
});

const props = defineProps({
  order: { type: Object, required: true },
});

const serviceOpen = ref(false);

const serviceEntries = computed(() =>
  Object.entries(props.order.ficha.serviceData ?? {}).map(([key, value]) => ({
    key,
    label:
      SERVICE_LABELS[/** @type {keyof typeof SERVICE_LABELS} */ (key)] ?? key,
    value: Array.isArray(value) ? value.join(', ') : String(value),
  })),
);
</script>

<template>
  <section class="op-strip" aria-labelledby="order-production-title">
    <div class="op-strip-text">
      <h2 id="order-production-title">Controle de produção</h2>
      <p>
        Arremate · Conferência e embalagem · Cores da arte —
        {{ PRODUCTION_FIELD_COUNT }} campos que saem em branco na página 2 da
        ficha e são preenchidos à mão na fábrica.
      </p>
    </div>
  </section>

  <section class="op-sheet" aria-labelledby="order-service-title">
    <div class="op-sheet-head">
      <h2 id="order-service-title">Dados do atendimento</h2>
      <span class="op-quiet-tag">não sai na ficha</span>
      <button
        type="button"
        class="op-edit op-disclosure"
        aria-controls="order-service-body"
        :aria-expanded="serviceOpen"
        @click="serviceOpen = !serviceOpen"
      >
        {{ serviceOpen ? 'Ocultar' : 'Ver' }}
        <OrderIcon name="chevron" />
      </button>
    </div>
    <div id="order-service-body" class="op-sheet-body">
      <p class="op-hint">
        Arte, locais, logística, finalidade e perfil de compra, e o que o
        cliente disse sem virar campo do pedido — ficam no CRM e não saem na
        ficha impressa.
      </p>
      <dl v-if="serviceOpen && serviceEntries.length" class="op-service">
        <div v-for="entry in serviceEntries" :key="entry.key">
          <dt>{{ entry.label }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
      </dl>
      <p v-else-if="serviceOpen" class="op-empty">
        A conversa ainda não trouxe dados de atendimento.
      </p>
    </div>
  </section>
</template>
