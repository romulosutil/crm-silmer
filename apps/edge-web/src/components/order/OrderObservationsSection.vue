<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import OrderIcon from './OrderIcon.vue';
import OrderSheetHead from './OrderSheetHead.vue';

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
// PFI-18: on a phone the body is shown only while the accordion opens it.
const open = computed(() => editing.isSectionOpen?.(SECTION) ?? true);
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
    class="op-sheet"
    :data-editing="isEditing || undefined"
    aria-labelledby="order-observations-title"
  >
    <!-- PFI-17: observations never block "Gerar"; the state is the count. -->
    <OrderSheetHead
      title-id="order-observations-title"
      title="Observações do pedido"
      :state="headline"
      edit-label="Editar observações"
      :can-edit="canEdit"
      :blocked="otherSectionOpen"
      :editing="isEditing"
      section="observations"
      body-id="order-observations-body"
      @edit="startEditing"
    />

    <p v-if="errorMessage" role="alert" class="op-alert" :hidden="!open">
      {{ errorMessage }}
    </p>

    <form
      v-if="isEditing"
      id="order-observations-body"
      ref="form"
      class="op-form"
      novalidate
      :hidden="!open"
      @submit.prevent="save"
    >
      <ol class="op-sheet-body op-observation-lines">
        <li v-for="(line, index) in draft" :key="index" class="op-input-row">
          <span class="op-line-number op-num" aria-hidden="true"
            >{{ index + 1 }}.</span
          >
          <input
            v-model="draft[index]"
            type="text"
            maxlength="200"
            :aria-label="`Observação ${index + 1}`"
          />
          <button
            type="button"
            class="op-icon-button"
            @click="removeLine(index)"
          >
            <OrderIcon name="x" />
            <span class="op-visually-hidden">{{
              `Remover observação ${index + 1}`
            }}</span>
          </button>
        </li>
      </ol>
      <div class="op-sheet-body op-sheet-body--tight">
        <button
          type="button"
          class="op-add-inline"
          :disabled="!canAddLine"
          @click="addLine"
        >
          <OrderIcon name="plus" />Adicionar observação
        </button>
      </div>
      <div class="op-form-actions">
        <p>Até 5 linhas de 200 caracteres. Saem numeradas na ficha.</p>
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <!-- PFI-13: "Gerar pedido" is the only primary button here. -->
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar observações' }}
        </button>
      </div>
    </form>

    <div
      v-else
      id="order-observations-body"
      class="op-sheet-body"
      :hidden="!open"
    >
      <ol v-if="observations.length" class="op-observations">
        <li v-for="(line, index) in observations" :key="index">{{ line }}</li>
      </ol>
      <p v-else class="op-empty">Nenhuma observação no pedido.</p>
    </div>
  </section>
</template>
