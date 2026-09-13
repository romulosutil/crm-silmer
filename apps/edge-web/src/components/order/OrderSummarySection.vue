<script setup>
import { computed, inject, nextTick, ref } from 'vue';

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
  <section class="surface section-gap" aria-labelledby="order-summary-title">
    <div class="panel-head">
      <h2 id="order-summary-title">Resumo do pedido</h2>
      <button
        v-if="canEdit && !isEditing"
        type="button"
        :disabled="otherSectionOpen"
        @click="startEditing"
      >
        Editar
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="audit-note">
      {{ errorMessage }}
    </p>

    <form v-if="isEditing" class="order-form" @submit.prevent="save">
      <div class="field-list">
        <label for="summary-cliente">Cliente</label>
        <input
          id="summary-cliente"
          :value="summary.cliente"
          type="text"
          disabled
        />
        <p class="footnote">Vem da conversa e não muda no pedido.</p>

        <label for="summary-entrega">Entrega confirmada</label>
        <input
          id="summary-entrega"
          ref="firstField"
          v-model="draft.data_entrega_confirmada"
          type="date"
        />

        <label for="summary-aplicacao">Aplicação</label>
        <input id="summary-aplicacao" v-model="draft.aplicacao" type="text" />

        <label for="summary-nome">Evento / Nome</label>
        <input id="summary-nome" v-model="draft.nome" type="text" />
      </div>
      <div class="inline-actions">
        <!-- PFI-13: "Confirmar pedido" is the only primary button here. -->
        <button type="submit" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar' }}
        </button>
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
      </div>
    </form>

    <dl v-else class="client-facts">
      <div>
        <dt>Cliente</dt>
        <dd>
          {{ summary.cliente || '—' }}
          <span class="badge" data-tone="info">vem da conversa</span>
        </dd>
      </div>
      <div>
        <dt>Entrega confirmada</dt>
        <dd>{{ dateBR(summary.data_entrega_confirmada) || '—' }}</dd>
      </div>
      <div>
        <dt>Total de peças</dt>
        <dd>{{ order.totalPieces }}</dd>
      </div>
      <div>
        <dt>Aplicação</dt>
        <dd>{{ summary.aplicacao || '—' }}</dd>
      </div>
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
        <dd>{{ dateBR(order.orderDate) || 'definida na confirmação' }}</dd>
      </div>
      <div>
        <dt>FAB</dt>
        <dd>{{ order.fabCode }}</dd>
      </div>
    </dl>

    <p class="footnote">
      Total de peças é somado a partir da grade dos itens e não é digitado. O
      número do pedido já existe desde a criação; só a data do pedido é definida
      na confirmação.
    </p>
  </section>
</template>
