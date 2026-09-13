<script setup>
import { computed, inject, nextTick, ref } from 'vue';

const SECTION = 'observations';
// PFI-05: zero to five lines, the same ceiling the ficha prints.
const MAX_OBSERVATIONS = 5;

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const form = ref(null);
const draft = ref([]);
const saving = ref(false);
const errorMessage = ref('');

const isEditing = computed(() => editing.editingSection.value === SECTION);
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
const observations = computed(() => props.order.ficha.observations);
const headline = computed(
  () => `${observations.value.length} de ${MAX_OBSERVATIONS} linhas`,
);
const canAddLine = computed(() => draft.value.length < MAX_OBSERVATIONS);

async function startEditing() {
  draft.value = [...observations.value];
  errorMessage.value = '';
  editing.start(SECTION);
  await nextTick();
  form.value?.querySelector('input')?.focus();
}

function cancel() {
  errorMessage.value = '';
  editing.stop();
}

function addLine() {
  if (!canAddLine.value) return;
  draft.value.push('');
}

/** @param {number} index */
function removeLine(index) {
  draft.value.splice(index, 1);
}

async function save() {
  saving.value = true;
  errorMessage.value = '';
  // A line left blank is not an observation; it would print as an empty
  // bullet on the ficha, so it never reaches the request.
  const result = await editing.save(
    SECTION,
    draft.value
      .map((line) => String(line).trim())
      .filter((line) => line !== ''),
  );
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
    class="surface section-gap"
    aria-labelledby="order-observations-title"
  >
    <div class="panel-head">
      <h2 id="order-observations-title">Observações do pedido</h2>
      <p>{{ headline }}</p>
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

    <form
      v-if="isEditing"
      ref="form"
      class="order-form"
      novalidate
      @submit.prevent="save"
    >
      <div v-for="(line, index) in draft" :key="index" class="inline-actions">
        <input
          v-model="draft[index]"
          type="text"
          maxlength="200"
          :aria-label="`Observação ${index + 1}`"
        />
        <button type="button" @click="removeLine(index)">
          Remover observação {{ index + 1 }}
        </button>
      </div>
      <div class="inline-actions">
        <button type="button" :disabled="!canAddLine" @click="addLine">
          Adicionar observação
        </button>
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

    <template v-else>
      <ol v-if="observations.length" class="order-observations">
        <li v-for="(line, index) in observations" :key="index">{{ line }}</li>
      </ol>
      <p v-else class="empty-list">Nenhuma observação no pedido.</p>
    </template>
  </section>
</template>
