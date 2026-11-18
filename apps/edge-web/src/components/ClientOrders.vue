<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { request } from '../lib/api-client.js';

const props = defineProps({ contact: { type: Object, required: true } });
const liveEvent = inject('liveEvent', ref(null));
const orders = ref([]);
const cursor = ref(null);
const loading = ref(false);
const error = ref('');
const section = ref(null);
const heading = ref(null);
const more = computed(() => cursor.value !== null);
let readController;

async function load(reset = false) {
  if (loading.value) return;
  const controller = new AbortController();
  readController = controller;
  loading.value = true;
  error.value = '';
  try {
    const next = reset ? null : cursor.value;
    const response = await request(
      `/api/v1/orders?owner=me&cancellation=all&limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
      { signal: controller.signal },
    );
    if (readController !== controller) return;
    const matches = response.data.items.filter(
      (order) => order.contactId === props.contact.id,
    );
    orders.value = reset ? matches : [...orders.value, ...matches];
    cursor.value = response.data.nextCursor ?? null;
  } catch (cause) {
    if (readController === controller && cause?.name !== 'AbortError')
      error.value = 'Não foi possível consultar seus pedidos deste cliente.';
  } finally {
    if (readController === controller) loading.value = false;
  }
}
onMounted(() => void load(true));
watch(
  liveEvent,
  (event) => {
    if (
      event?.reset ||
      [
        'inbox.order.changed',
        'inbox.conversation.changed',
        'inbox.contact.changed',
      ].includes(event?.type)
    ) {
      const focused = document.activeElement;
      const focusWasInside = section.value?.contains(focused);
      readController?.abort();
      readController = undefined;
      orders.value = [];
      cursor.value = null;
      loading.value = false;
      void load(true);
      void nextTick(() => {
        if (
          focusWasInside &&
          !focused?.isConnected &&
          document.activeElement === document.body
        )
          heading.value?.focus();
      });
    }
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => readController?.abort());
</script>

<template>
  <section ref="section" aria-labelledby="client-orders-title">
    <div class="panel-head subsection-heading">
      <h3 id="client-orders-title" ref="heading" tabindex="-1">
        Meus pedidos deste cliente
      </h3>
    </div>
    <p>
      São exibidos seus pedidos; outros pedidos mantêm suas permissões
      comerciais.
    </p>
    <p v-if="error" role="alert">
      {{ error }}
      <button type="button" @click="load(true)">Tentar novamente</button>
    </p>
    <p v-if="loading" role="status">Consultando pedidos…</p>
    <ul v-if="orders.length" class="history-list">
      <li v-for="order in orders" :key="order.id">
        <RouterLink
          :to="`/pedidos/${encodeURIComponent(order.id)}?cliente=${encodeURIComponent(contact.id)}`"
          >Pedido {{ order.number }}</RouterLink
        >
        <span>{{
          order.effectiveStatus === 'cancelado'
            ? 'Cancelado'
            : order.status === 'confirmado'
              ? 'Confirmado'
              : 'Pendente'
        }}</span>
      </li>
    </ul>
    <p v-else-if="!loading && !error">
      Nenhum pedido encontrado nesta parte da lista.
    </p>
    <button v-if="more" type="button" :disabled="loading" @click="load()">
      Buscar mais pedidos
    </button>
    <p>
      Para criar um pedido de atendimento, abra a conversa e escolha o assunto.
    </p>
  </section>
</template>
