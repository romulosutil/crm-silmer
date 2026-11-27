<script setup>
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppIcon from '../AppIcon.vue';
import { request } from '../../lib/api-client.js';
import { downloadPdf } from '../../lib/order-pdf.js';
import { openDialog } from '../../lib/ui.js';

const emit = defineEmits(['orders-mapped', 'closed']);
const liveEvent = inject('liveEvent', ref(null));
const dialog = ref(null);
const title = ref(null);
const back = ref(null);
const map = ref(null);
const error = ref('');
const fieldProblem = ref(null);
const loading = ref(false);
const busy = ref(false);
const generatedNumber = ref(null);
const selectionChanged = ref(false);
const number = new Intl.NumberFormat('pt-BR');
const audienceLabel = {
  unissex: 'Unissex',
  masculino: 'Masculino',
  feminino: 'Feminino',
  infantil: 'Infantil',
};
const fieldLabel = {
  tipo: 'modelo',
  cor: 'cor',
  publico: 'público',
  malhas: 'malha',
  grade: 'grade de tamanhos',
};
let ids = [];
let fingerprint = '';
let controller;

function abort() {
  controller?.abort();
  controller = undefined;
  loading.value = false;
  busy.value = false;
}

function explain(cause, downloading) {
  fieldProblem.value = null;
  if (cause?.code === 'CUT_MAP_INCOMPLETE') {
    fieldProblem.value = cause.problem;
    error.value = 'Revise as informações do item antes de gerar o mapa.';
  } else if (cause?.code === 'CUT_MAP_NOT_ELIGIBLE') {
    error.value =
      'Um pedido saiu da fila de corte. Volte à seleção e confira os pedidos.';
  } else if ([401, 403, 404].includes(cause?.status)) {
    error.value =
      'Um pedido da seleção ficou indisponível. Atualize a seleção.';
  } else if (cause?.code === 'CUT_MAP_ALREADY_GENERATED') {
    error.value =
      'Há pedidos desta seleção que já pertencem a outro mapa. Volte à seleção para continuar.';
    selectionChanged.value = true;
    emit('orders-mapped', cause.problem.orderIds ?? []);
  } else if (cause?.code === 'CUT_MAP_STALE') {
    error.value = 'Um pedido mudou. Atualize a prévia para conferir o mapa.';
  } else if (cause?.code === 'CUT_MAP_PDF_TOO_LARGE') {
    error.value =
      'O PDF excede o limite de 5 MB. Volte à seleção e escolha menos pedidos.';
    selectionChanged.value = true;
  } else {
    error.value = downloading
      ? 'Não foi possível gerar o PDF. Tente novamente.'
      : 'Não foi possível carregar o mapa. Tente novamente.';
    return;
  }
  map.value = null;
  generatedNumber.value = null;
  fingerprint = '';
}

function query() {
  return new URLSearchParams({ orders: ids.join(',') });
}

async function load() {
  if (!dialog.value?.open) return;
  abort();
  const current = new AbortController();
  controller = current;
  map.value = null;
  generatedNumber.value = null;
  selectionChanged.value = false;
  fingerprint = '';
  error.value = '';
  fieldProblem.value = null;
  loading.value = true;
  try {
    const { data } = await request(`/api/v1/orders/cut-map?${query()}`, {
      signal: current.signal,
    });
    if (current.signal.aborted) return;
    map.value = data.map;
    fingerprint = data.fingerprint;
  } catch (cause) {
    if (!current.signal.aborted) explain(cause, false);
  } finally {
    if (controller === current) loading.value = false;
  }
}

async function open(selection, trigger) {
  if (!selection.length || !dialog.value || dialog.value.open) return;
  ids = [...selection];
  openDialog(dialog.value, trigger);
  await nextTick();
  if (!dialog.value?.open) return;
  title.value?.focus();
  await load();
}

async function download() {
  if (busy.value || loading.value || !map.value || !fingerprint) return;
  abort();
  const current = new AbortController();
  controller = current;
  busy.value = true;
  error.value = '';
  try {
    const { data, headers } = await request('/api/v1/orders/cut-map/pdf', {
      method: 'POST',
      body: { orders: ids, fingerprint },
      responseType: 'pdf',
      signal: current.signal,
    });
    if (!current.signal.aborted) {
      const number = headers?.get('x-cut-map-number');
      if (!number || !/^\d+$/u.test(number))
        throw new Error('PDF_INVALID_RESPONSE');
      generatedNumber.value = number;
      fingerprint = '';
      emit('orders-mapped', ids);
      downloadPdf(
        new File([data], `mapa-de-corte-${number}.pdf`, {
          type: 'application/pdf',
        }),
      );
      await nextTick();
      back.value?.focus();
    }
  } catch (cause) {
    if (!current.signal.aborted) explain(cause, true);
  } finally {
    if (controller === current) busy.value = false;
  }
}

function clear() {
  abort();
  map.value = null;
  generatedNumber.value = null;
  selectionChanged.value = false;
  fingerprint = '';
  error.value = '';
  fieldProblem.value = null;
  ids = [];
  emit('closed');
}

watch(liveEvent, (event) => {
  if (
    !dialog.value?.open ||
    generatedNumber.value ||
    (!event?.reset &&
      (event?.type !== 'inbox.order.changed' || !ids.includes(event.orderId)))
  )
    return;
  abort();
  map.value = null;
  selectionChanged.value = false;
  fingerprint = '';
  fieldProblem.value = null;
  error.value =
    'A seleção pode ter mudado. Atualize a prévia antes de baixar o PDF.';
});

onBeforeUnmount(abort);
defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="op-dialog cut-map-dialog"
    aria-labelledby="cut-map-title"
    @close="clear"
  >
    <div class="cut-map-header">
      <h2 id="cut-map-title" ref="title" tabindex="-1">
        Conferir mapa de corte
      </h2>
      <button
        type="button"
        class="quiet icon-button"
        aria-label="Fechar prévia"
        @click="dialog?.close()"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <div class="cut-map-body">
      <p v-if="loading" role="status">Carregando mapa de corte…</p>
      <p v-if="generatedNumber" class="cut-map-notice" role="status">
        Mapa de corte {{ generatedNumber }} gerado.
      </p>
      <div v-if="error" class="op-alert" role="alert">
        <p>{{ error }}</p>
        <p v-if="fieldProblem?.orderId">
          <RouterLink :to="`/pedidos/${fieldProblem.orderId}`"
            >Pedido {{ fieldProblem.orderNumber }}</RouterLink
          >
          <template v-if="fieldProblem.itemIndex !== undefined">
            · item {{ fieldProblem.itemIndex + 1 }}</template
          >
          <template v-if="fieldProblem.fields?.length">
            ·
            {{
              fieldProblem.fields.map((field) => fieldLabel[field]).join(', ')
            }}</template
          >
        </p>
      </div>
      <template v-if="map">
        <div class="cut-map-summary">
          <strong
            >{{ number.format(map.total) }}
            {{ map.total === 1 ? 'peça a cortar' : 'peças a cortar' }}</strong
          >
          <p>
            {{ map.orders.length }}
            {{ map.orders.length === 1 ? 'pedido' : 'pedidos' }} ·
            {{ map.orders.map(({ number }) => number).join(', ') }}
          </p>
        </div>
        <section
          v-for="(lot, index) in map.groups"
          :key="index"
          class="cut-map-lot"
        >
          <div class="cut-map-lot-head">
            <h3>{{ lot.model }} · {{ lot.color }}</h3>
            <p>
              <strong>{{ audienceLabel[lot.audience] }}</strong> ·
              {{ lot.fabrics.join(', ') }}
            </p>
          </div>
          <p v-if="lot.details.length">
            {{
              lot.details
                .map(({ label, value }) => `${label} ${value}`)
                .join(' · ')
            }}
          </p>
          <dl class="cut-map-grade" aria-label="Peças por tamanho">
            <div v-for="{ size, quantity } in lot.grade" :key="size">
              <dt>{{ size }}</dt>
              <dd>{{ number.format(quantity) }}</dd>
            </div>
            <div class="cut-map-grade-total">
              <dt>Total</dt>
              <dd>{{ number.format(lot.total) }}</dd>
            </div>
          </dl>
          <p>
            {{ lot.orders.length === 1 ? 'Pedido' : 'Pedidos' }}
            {{ lot.orders.join(', ') }}
          </p>
        </section>
      </template>
    </div>
    <div class="op-dialog-actions">
      <button ref="back" type="button" @click="dialog?.close()">
        Voltar à seleção
      </button>
      <button
        v-if="!map && error && !fieldProblem && !selectionChanged"
        type="button"
        class="soft"
        @click="load"
      >
        Atualizar prévia
      </button>
      <button
        v-if="map && !generatedNumber"
        type="button"
        class="primary"
        :aria-disabled="busy || undefined"
        @click="download"
      >
        {{ busy ? 'Gerando PDF…' : 'Gerar mapa e baixar PDF' }}
      </button>
    </div>
  </dialog>
</template>
