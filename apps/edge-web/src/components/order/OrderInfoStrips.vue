<script setup>
import { computed, ref } from 'vue';

// The 14 production fields of `ficha-canonical-v2`, which reach the shop
// floor blank and are filled by hand there. The CRM never writes them.
const PRODUCTION_FIELD_COUNT = 14;

/**
 * D11: what the agent collected that has no place on the printed ficha.
 * A key this screen does not know is shown as it came, so a new briefing
 * field appears instead of disappearing.
 */
const SERVICE_LABELS = Object.freeze({
  artwork_locations: 'Locais da arte',
  artwork_status: 'Arte',
  city_or_postal_code: 'Cidade ou CEP',
  colors: 'Cores informadas',
  customizations: 'Personalizações',
  delivery_address: 'Endereço de entrega',
  delivery_mode: 'Forma de entrega',
  needed_by: 'Data desejada',
  notes: 'Anotações',
  numbers: 'Numeração',
  pickup_location: 'Local de retirada',
  purchase_profile: 'Perfil de compra',
  purpose: 'Finalidade',
  quantity: 'Quantidade informada',
  segment: 'Segmento',
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
  <section
    class="surface section-gap order-strip"
    aria-labelledby="order-production-title"
  >
    <div class="panel-head">
      <h2 id="order-production-title">Controle de produção</h2>
    </div>
    <p>
      Arremate · Conferência e embalagem · Cores e arte —
      {{ PRODUCTION_FIELD_COUNT }} campos que saem em branco na página 2 da
      ficha e são preenchidos à mão na fábrica.
    </p>
  </section>

  <section
    class="surface section-gap order-strip"
    aria-labelledby="order-service-title"
  >
    <div class="panel-head">
      <h2 id="order-service-title">Dados do atendimento</h2>
      <button
        type="button"
        :aria-expanded="serviceOpen"
        @click="serviceOpen = !serviceOpen"
      >
        {{ serviceOpen ? 'Ocultar' : 'Ver' }}
      </button>
    </div>
    <p>
      Arte, locais, logística, finalidade e perfil de compra — ficam no CRM e
      não saem na ficha impressa.
    </p>
    <dl v-if="serviceOpen && serviceEntries.length" class="client-facts">
      <div v-for="entry in serviceEntries" :key="entry.key">
        <dt>{{ entry.label }}</dt>
        <dd>{{ entry.value }}</dd>
      </div>
    </dl>
    <p v-else-if="serviceOpen" class="empty-list">
      A conversa ainda não trouxe dados de atendimento.
    </p>
  </section>
</template>
