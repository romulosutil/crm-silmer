<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import OrderIcon from './OrderIcon.vue';

const SECTION = 'artwork';
// ADR 020: who makes the art of the whole order. The customer and Silmer may
// both be marked; "Sem estampa" stands alone. One mark is needed to generate.
const ORIGINS = Object.freeze([
  Object.freeze({ key: 'feito_pelo_cliente', label: 'O cliente envia a arte' }),
  Object.freeze({ key: 'feito_pela_silmer', label: 'A Silmer cria a arte' }),
  Object.freeze({ key: 'sem_estampa', label: 'Sem estampa' }),
]);
const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const firstField = ref(null);
const draft = ref({
  feito_pela_silmer: false,
  feito_pelo_cliente: false,
  sem_estampa: false,
});
const saving = ref(false);
const errorMessage = ref('');
const artwork = computed(() => props.order.ficha?.artwork ?? {});
const folderName = computed(() =>
  String(props.order.number ?? '').toLowerCase(),
);
const isEditing = computed(() => editing.editingSection.value === SECTION);
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
const sources = computed(
  () =>
    ORIGINS.filter((origin) => artwork.value[origin.key] === true)
      .map((origin) => origin.label)
      .join(' · ') || 'Falta marcar quem faz a arte.',
);
const files = computed(() =>
  Array.isArray(artwork.value.files) ? artwork.value.files : [],
);

async function startEditing() {
  draft.value = {
    feito_pela_silmer: artwork.value.feito_pela_silmer === true,
    feito_pelo_cliente: artwork.value.feito_pelo_cliente === true,
    sem_estampa: artwork.value.sem_estampa === true,
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

/**
 * "Sem estampa" clears the two origins, and an origin clears "Sem estampa",
 * so the form never holds a pair the server refuses.
 *
 * @param {string} key @param {boolean} checked
 */
function mark(key, checked) {
  const next = { ...draft.value, [key]: checked };
  if (checked && key === 'sem_estampa') {
    next.feito_pela_silmer = false;
    next.feito_pelo_cliente = false;
  } else if (checked) {
    next.sem_estampa = false;
  }
  draft.value = next;
}

// "Informar em Estampa e arquivos" from "Gerar pedido" opens this editor;
// with another section open, it only brings the section into view.
const heading = ref(null);
watch(
  () => editing.editRequest?.value,
  (request) => {
    if (request?.section !== SECTION || isEditing.value) return;
    if (canEdit.value && !otherSectionOpen.value) {
      void startEditing();
      return;
    }
    heading.value?.scrollIntoView?.({ block: 'start' });
  },
);

async function save() {
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(SECTION, {
    feito_pela_silmer: draft.value.feito_pela_silmer,
    feito_pelo_cliente: draft.value.feito_pelo_cliente,
    sem_estampa: draft.value.sem_estampa,
  });
  saving.value = false;
  if (result.ok) editing.stop();
  else errorMessage.value = result.message;
}
</script>

<template>
  <section class="op-sheet" aria-labelledby="order-artwork-title">
    <div class="op-sheet-head">
      <h2 id="order-artwork-title" ref="heading">Estampa e arquivos</h2>
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
      <fieldset
        class="op-artwork-source"
        aria-describedby="order-artwork-source-hint"
      >
        <legend>Quem faz a arte?</legend>
        <p id="order-artwork-source-hint" class="op-hint">
          Obrigatório para gerar. O cliente e a Silmer podem ser marcados
          juntos; “Sem estampa” vale sozinho.
        </p>
        <label
          v-for="(origin, index) in ORIGINS"
          :key="origin.key"
          class="op-check"
        >
          <input
            :ref="
              (element) => {
                if (index === 0) firstField = element;
              }
            "
            type="checkbox"
            :checked="draft[origin.key]"
            @change="mark(origin.key, $event.target.checked)"
          />
          <span>{{ origin.label }}</span>
        </label>
      </fieldset>
      <div class="op-form-actions">
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar arte' }}
        </button>
      </div>
    </form>

    <div v-else class="op-sheet-body">
      <p>{{ sources }}</p>
    </div>

    <div class="op-artwork-upload">
      <label for="order-artwork-files">Adicionar arquivos da arte</label>
      <input
        id="order-artwork-files"
        type="file"
        multiple
        disabled
        accept=".png,.jpg,.jpeg,.cdr,.pdf,.svg,.ai,.eps,.psd,.tif,.tiff,.webp,.zip,.rar"
        aria-describedby="order-artwork-upload-hint"
      />
      <p id="order-artwork-upload-hint" class="op-hint">
        Envio disponível após ativar o Dropbox em produção. Formatos previstos:
        PNG, JPEG, CDR, PDF, SVG, AI, EPS, PSD, TIFF, WebP, ZIP e RAR.
      </p>
      <p class="op-hint">
        Destino dos arquivos: <code>CRM/{{ folderName }}/</code>. A pasta do
        pedido será criada no primeiro envio.
      </p>
      <ul v-if="files.length" class="op-observations">
        <li v-for="(file, index) in files" :key="index">
          {{ file.name || 'Arquivo sem nome' }}
        </li>
      </ul>
      <p v-else class="op-empty">Nenhum arquivo anexado.</p>
    </div>
  </section>
</template>
