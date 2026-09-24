<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { fabLabel } from '../../lib/order-format.js';
import OrderIcon from './OrderIcon.vue';

const SECTION = 'summary';

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const firstField = ref(null);
const draft = ref({ aplicacao: '', data_entrega_confirmada: '', nome: '' });
const saving = ref(false);
const errorMessage = ref('');

const isEditing = computed(() => editing.editingSection.value === SECTION);
// PFI-10: a confirmed order is read-only; to change it the seller reopens it.
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const summary = computed(() => props.order.ficha.summary);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);

/** The stored value is an ISO day; the operation reads dd/mm/yyyy. */
/** @param {unknown} value */
function dateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

async function startEditing() {
  draft.value = {
    aplicacao: summary.value.aplicacao ?? '',
    data_entrega_confirmada: summary.value.data_entrega_confirmada ?? '',
    nome: summary.value.nome ?? '',
  };
  errorMessage.value = '';
  editing.start(SECTION);
  await nextTick();
  firstField.value?.focus();
}

function cancel() {
  errorMessage.value = '';
  editing.stop();
}

/** PFI-06: the whole section travels in one write. */
async function save() {
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(SECTION, {
    aplicacao: draft.value.aplicacao.trim() || null,
    data_entrega_confirmada: draft.value.data_entrega_confirmada.trim() || null,
    nome: draft.value.nome.trim() || null,
  });
  saving.value = false;
  if (result.ok) {
    editing.stop();
    return;
  }
  errorMessage.value = result.message;
}
</script>

<template>
  <section
    class="op-sheet"
    :data-editing="isEditing || undefined"
    aria-labelledby="order-summary-title"
  >
    <div class="op-sheet-head">
      <h2 id="order-summary-title">Resumo do pedido</h2>
      <span v-if="isEditing" class="op-editing-tag">Editando</span>
      <button
        v-if="canEdit && !isEditing"
        type="button"
        class="op-edit"
        :disabled="otherSectionOpen"
        @click="startEditing"
      >
        <OrderIcon name="pencil" />Editar
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="op-alert">
      {{ errorMessage }}
    </p>

    <form v-if="isEditing" class="op-form" @submit.prevent="save">
      <div class="op-form-grid">
        <div class="op-field">
          <label for="summary-cliente">Cliente</label>
          <div class="op-input-lock">
            <input
              id="summary-cliente"
              :value="summary.cliente"
              type="text"
              disabled
              aria-describedby="summary-cliente-hint"
            />
            <OrderIcon name="lock" />
          </div>
          <p id="summary-cliente-hint" class="op-hint">
            Vem da conversa e não muda no pedido.
          </p>
        </div>

        <div class="op-field">
          <label for="summary-entrega">Entrega confirmada</label>
          <input
            id="summary-entrega"
            ref="firstField"
            v-model="draft.data_entrega_confirmada"
            type="date"
            aria-describedby="summary-entrega-hint"
          />
          <p id="summary-entrega-hint" class="op-hint">
            A data combinada com o cliente, não a desejada.
          </p>
        </div>

        <div class="op-field">
          <label for="summary-aplicacao">Aplicação</label>
          <div class="op-combo">
            <input
              id="summary-aplicacao"
              v-model="draft.aplicacao"
              type="text"
              list="catalog-applications"
              autocomplete="off"
              autocapitalize="characters"
            />
            <OrderIcon name="chevron" />
          </div>
        </div>

        <div class="op-field">
          <label for="summary-nome">Evento / Nome</label>
          <input
            id="summary-nome"
            v-model="draft.nome"
            type="text"
            autocomplete="off"
          />
        </div>
      </div>

      <p class="op-locked-note">
        <OrderIcon name="lock" />
        Calculados pelo sistema: total de peças ({{ order.totalPieces }}),
        vendedor, data do pedido e FAB.
      </p>

      <div class="op-form-actions">
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <!-- PFI-13: "Gerar pedido" is the only primary button here. -->
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar resumo' }}
        </button>
      </div>
    </form>

    <div v-else class="op-sheet-body">
      <dl class="op-summary-main">
        <div>
          <dt>Cliente</dt>
          <dd>
            {{ summary.cliente || '—' }}
            <span class="op-origin-note">vem da conversa</span>
          </dd>
        </div>
        <div>
          <dt>Entrega confirmada</dt>
          <dd class="op-num">
            {{ dateBR(summary.data_entrega_confirmada) || '—' }}
          </dd>
        </div>
        <div>
          <dt>Total de peças</dt>
          <dd class="op-num op-pieces">{{ order.totalPieces }}</dd>
        </div>
        <div>
          <dt>Aplicação</dt>
          <dd>{{ summary.aplicacao || '—' }}</dd>
        </div>
      </dl>
      <dl class="op-summary-meta">
        <div>
          <dt>Evento / Nome</dt>
          <dd>{{ summary.nome || '—' }}</dd>
        </div>
        <div>
          <dt>Vendedor</dt>
          <dd>{{ order.seller?.name || 'sem vendedor' }}</dd>
        </div>
        <div>
          <dt>Data do pedido</dt>
          <dd class="op-num" :data-muted="!order.orderDate || undefined">
            {{ dateBR(order.orderDate) || 'definida ao gerar' }}
          </dd>
        </div>
        <div>
          <dt>FAB</dt>
          <dd>{{ fabLabel(order.fabCode) }}</dd>
        </div>
      </dl>
      <p class="op-hint">
        Total de peças é somado a partir da grade dos itens. O número do pedido
        já existe desde a criação; a data do pedido é definida ao gerar.
      </p>
    </div>
  </section>
</template>
