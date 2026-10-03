<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import OrderIcon from './OrderIcon.vue';

const SECTION = 'artwork';
const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const firstField = ref(null);
const draft = ref({ feito_pelo_cliente: false, feito_pela_silmer: false });
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
const sources = computed(() => {
  const selected = [];
  if (artwork.value.feito_pelo_cliente) selected.push('Feito pelo cliente');
  if (artwork.value.feito_pela_silmer) selected.push('Feito pela Silmer');
  return selected.join(' · ') || 'Origem ainda não informada';
});
const files = computed(() =>
  Array.isArray(artwork.value.files) ? artwork.value.files : [],
);

async function startEditing() {
  draft.value = {
    feito_pelo_cliente: artwork.value.feito_pelo_cliente === true,
    feito_pela_silmer: artwork.value.feito_pela_silmer === true,
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

async function save() {
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(SECTION, {
    feito_pelo_cliente: draft.value.feito_pelo_cliente,
    feito_pela_silmer: draft.value.feito_pela_silmer,
  });
  saving.value = false;
  if (result.ok) editing.stop();
  else errorMessage.value = result.message;
}
</script>

<template>
  <section class="op-sheet" aria-labelledby="order-artwork-title">
    <div class="op-sheet-head">
      <h2 id="order-artwork-title">Estampa e arquivos</h2>
      <span v-if="isEditing" class="op-editing-tag">Editando</span>
      <button
        v-if="canEdit && !isEditing"
        type="button"
        class="op-edit"
        :disabled="otherSectionOpen"
        @click="startEditing"
      >
        <OrderIcon name="pencil" />Editar origem
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="op-alert">
      {{ errorMessage }}
    </p>

    <form v-if="isEditing" class="op-form" @submit.prevent="save">
      <fieldset class="op-artwork-source">
        <legend>Quem fez a arte?</legend>
        <p class="op-hint">
          O vendedor marca as origens confirmadas. É possível marcar as duas.
        </p>
        <label class="op-check">
          <input
            ref="firstField"
            v-model="draft.feito_pelo_cliente"
            type="checkbox"
          />
          <span>Feito pelo cliente</span>
        </label>
        <label class="op-check">
          <input v-model="draft.feito_pela_silmer" type="checkbox" />
          <span>Feito pela Silmer</span>
        </label>
      </fieldset>
      <div class="op-form-actions">
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar origem da arte' }}
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
