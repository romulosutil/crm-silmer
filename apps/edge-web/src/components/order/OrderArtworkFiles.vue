<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request, upload } from '../../lib/api-client.js';
import {
  ACCEPT,
  FORMATS_LABEL,
  MAX_REFERENCES,
  extensionOf,
  fileErrorMessage,
  filesUrl,
  formatBytes,
  kindOf,
  refusalFor,
  thumbnailFor,
  uploadErrorMessage,
  uploadedAtLabel,
} from '../../lib/order-files.js';
import OrderIcon from './OrderIcon.vue';

// ADR 021: up to five art files plus the final art, sent and downloaded by
// hand. Each upload goes on its own, one after the other, so the five-file
// limit and the replaced final art are decided by the API in order.

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');

/** @type {import('vue').Ref<{final: any, references: any[]}>} */
const files = ref({ final: null, references: [] });
/** @type {import('vue').Ref<'loading'|'ready'|'failed'>} */
const loadState = ref('loading');
const loadError = ref('');
/**
 * @typedef {{
 *   key: string, slot: 'reference'|'final', file: File, name: string,
 *   extension: string, size: number, preview: string, progress: number,
 *   state: 'queued'|'uploading'|'failed', message: string,
 *   idempotencyKey: string, controller: AbortController|null,
 * }} PendingUpload
 */
/** @type {import('vue').Ref<PendingUpload[]>} */
const uploads = ref([]);
/** @type {import('vue').Ref<string[]>} */
const refusals = ref([]);
const announcement = ref('');
const confirmingId = ref('');
const removingId = ref('');
const dragging = ref(false);
const picker = ref(null);
const finalPicker = ref(null);
const addButton = ref(null);
const addTile = ref(null);
const finalButton = ref(null);
/** @type {Map<string, HTMLElement>} */
const tileFocus = new Map();
let draining = false;
let disposed = false;

const canChange = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const references = computed(() => files.value.references);
const final = computed(() => files.value.final);
const referenceUploads = computed(() =>
  uploads.value.filter((entry) => entry.slot === 'reference'),
);
const finalUpload = computed(
  () => uploads.value.find((entry) => entry.slot === 'final') ?? null,
);
const usedSlots = computed(
  () =>
    references.value.length +
    referenceUploads.value.filter((entry) => entry.state !== 'failed').length,
);
const freeSlots = computed(() => Math.max(0, MAX_REFERENCES - usedSlots.value));
const full = computed(() => canChange.value && freeSlots.value === 0);
const countLabel = computed(() =>
  canChange.value
    ? `${references.value.length} de ${MAX_REFERENCES}`
    : String(references.value.length),
);
const showDropzone = computed(
  () =>
    canChange.value &&
    references.value.length === 0 &&
    referenceUploads.value.length === 0,
);

/** @param {string} fileId */
function contentUrl(fileId) {
  return `${filesUrl(props.order.id, fileId)}/content`;
}

/** @param {string} fileId */
function thumbnailUrl(fileId) {
  return `${filesUrl(props.order.id, fileId)}/thumbnail`;
}

/** @param {any} file */
function sizeLabel(file) {
  return `${String(file.extension).toUpperCase()} · ${formatBytes(file.sizeBytes)}`;
}

async function load() {
  loadState.value = 'loading';
  try {
    const response = await request(filesUrl(props.order.id));
    files.value = response.data;
    loadState.value = 'ready';
  } catch (cause) {
    loadError.value =
      Number(/** @type {any} */ (cause)?.status) >= 500
        ? 'Arquivos indisponíveis no momento.'
        : 'Não foi possível carregar os arquivos.';
    loadState.value = 'failed';
  }
}

watch(
  () => props.order.id,
  () => {
    confirmingId.value = '';
    void load();
  },
  { immediate: true },
);

/** @param {'reference'|'final'} slot */
function choose(slot) {
  refusals.value = [];
  (slot === 'final' ? finalPicker : picker).value?.click();
}

/**
 * Keeps what can go and says why the rest cannot: wrong format, over 10 MB
 * or beyond the free slots.
 *
 * @param {File[]} chosen @param {'reference'|'final'} slot
 */
function enqueue(chosen, slot) {
  /** @type {string[]} */
  const refused = [];
  /** @type {File[]} */
  const accepted = [];
  for (const file of chosen) {
    const reason = refusalFor(file);
    if (reason) refused.push(reason);
    else accepted.push(file);
  }
  let kept = accepted;
  if (slot === 'final') {
    kept = accepted.slice(0, 1);
  } else if (accepted.length > freeSlots.value) {
    kept = accepted.slice(0, freeSlots.value);
    const left = accepted
      .slice(freeSlots.value)
      .map((file) => `“${file.name}”`);
    refused.push(
      `Limite de 5 arquivos: ${left.join(', ')} ${left.length === 1 ? 'ficou' : 'ficaram'} de fora.`,
    );
  }
  refusals.value = refused;
  for (const file of kept) {
    uploads.value.push({
      controller: null,
      extension: extensionOf(file.name),
      file,
      idempotencyKey: commandKey(),
      key: commandKey(),
      message: '',
      name: file.name,
      preview: '',
      progress: 0,
      size: file.size,
      slot,
      state: 'queued',
    });
  }
  void drain();
}

/** @param {Event} event @param {'reference'|'final'} slot */
function picked(event, slot) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  enqueue([...(input.files ?? [])], slot);
  input.value = '';
}

/** @param {DragEvent} event */
function dropped(event) {
  dragging.value = false;
  if (!canChange.value) return;
  enqueue([...(event.dataTransfer?.files ?? [])], 'reference');
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    let next;
    while (
      !disposed &&
      (next = uploads.value.find((entry) => entry.state === 'queued'))
    ) {
      await send(next);
    }
  } finally {
    draining = false;
  }
}

/** @param {PendingUpload} entry */
async function send(entry) {
  entry.state = 'uploading';
  entry.progress = 0;
  entry.message = '';
  entry.controller = new AbortController();
  const thumbnail = await thumbnailFor(entry.file);
  if (thumbnail && !entry.preview) {
    entry.preview = globalThis.URL.createObjectURL(thumbnail);
  }
  const form = new globalThis.FormData();
  form.append('slot', entry.slot);
  form.append('file', entry.file, entry.name);
  if (thumbnail) form.append('thumbnail', thumbnail, 'thumbnail.webp');
  try {
    const response = await upload(filesUrl(props.order.id), form, {
      idempotencyKey: entry.idempotencyKey,
      onProgress: (fraction) => {
        entry.progress = Math.round(fraction * 100);
      },
      signal: entry.controller.signal,
    });
    files.value = response.data;
    forget(entry);
    announcement.value =
      entry.slot === 'final'
        ? `Arte final “${entry.name}” enviada.`
        : `“${entry.name}” enviado.`;
  } catch (cause) {
    if (/** @type {any} */ (cause)?.code === 'UPLOAD_CANCELLED') {
      forget(entry);
      announcement.value = `Envio de “${entry.name}” cancelado.`;
      return;
    }
    entry.state = 'failed';
    entry.message = uploadErrorMessage(cause, entry.name);
    entry.controller = null;
    // A refusal the API decided for good is not worth a retry.
    if (
      [
        'FILE_TOO_LARGE',
        'FILE_TYPE_NOT_ALLOWED',
        'FILE_CONTENT_MISMATCH',
      ].includes(String(/** @type {any} */ (cause)?.code))
    ) {
      refusals.value = [...refusals.value, entry.message];
      forget(entry);
    }
  }
}

/** @param {PendingUpload} entry */
function forget(entry) {
  if (entry.preview) globalThis.URL.revokeObjectURL(entry.preview);
  uploads.value = uploads.value.filter((candidate) => candidate !== entry);
}

/** @param {PendingUpload} entry */
function cancel(entry) {
  if (entry.state === 'uploading') entry.controller?.abort();
  else forget(entry);
}

/** The same Idempotency-Key: a retry never stores the file twice. @param {PendingUpload} entry */
function retry(entry) {
  entry.state = 'queued';
  void drain();
}

/** @param {any} file */
async function askRemove(file) {
  confirmingId.value = file.id;
  await nextTick();
  tileFocus.get(`cancel:${file.id}`)?.focus();
}

/** @param {any} file */
async function closeConfirm(file) {
  confirmingId.value = '';
  await nextTick();
  tileFocus.get(`remove:${file.id}`)?.focus();
}

/**
 * After a removal the focus goes to the next file, else to the action that
 * adds one, so the keyboard never lands on the page body.
 *
 * @param {any} file
 */
async function remove(file) {
  removingId.value = file.id;
  const isFinal = file.slot === 'final';
  const position = references.value.findIndex(
    (candidate) => candidate.id === file.id,
  );
  try {
    const response = await request(filesUrl(props.order.id, file.id), {
      idempotencyKey: commandKey(),
      method: 'DELETE',
    });
    files.value = response.data;
    confirmingId.value = '';
    announcement.value = `“${file.name}” removido.`;
    await nextTick();
    const next = isFinal
      ? null
      : references.value[Math.min(position, references.value.length - 1)];
    // On a phone the heading button is hidden and the grid tile adds.
    const adder = addButton.value?.offsetParent
      ? addButton.value
      : addTile.value;
    (next
      ? tileFocus.get(`download:${next.id}`)
      : isFinal
        ? finalButton.value
        : adder
    )?.focus();
  } catch (cause) {
    confirmingId.value = '';
    refusals.value = [fileErrorMessage(cause)];
    if (/** @type {any} */ (cause)?.code === 'FILE_NOT_FOUND') void load();
  } finally {
    removingId.value = '';
  }
}

/** @param {string} key @returns {(element: any) => void} */
function focusRef(key) {
  return (element) => {
    if (element) tileFocus.set(key, element);
    else tileFocus.delete(key);
  };
}

onBeforeUnmount(() => {
  disposed = true;
  for (const entry of uploads.value) {
    entry.controller?.abort();
    if (entry.preview) globalThis.URL.revokeObjectURL(entry.preview);
  }
});
</script>

<template>
  <div class="op-files">
    <p class="sr-only" role="status">{{ announcement }}</p>

    <div v-if="loadState === 'loading'" class="op-files-block">
      <p class="op-empty">Carregando arquivos…</p>
    </div>

    <div v-else-if="loadState === 'failed'" class="op-files-block">
      <p class="op-files-alert" data-tone="error" role="alert">
        <OrderIcon name="alert" />{{ loadError }}
      </p>
      <button type="button" class="op-files-button" @click="load">
        Tentar de novo
      </button>
    </div>

    <template v-else>
      <section class="op-files-block" aria-labelledby="order-final-art-title">
        <div class="op-files-head">
          <h3 id="order-final-art-title">Arte final</h3>
          <span class="op-files-tag" :data-tone="final ? 'success' : 'warning'">
            <OrderIcon v-if="final" name="check" />{{
              final ? 'Enviada' : 'Pendente'
            }}
          </span>
        </div>

        <div v-if="finalUpload" class="op-final" data-state="busy">
          <div class="op-file-thumb">
            <img v-if="finalUpload.preview" :src="finalUpload.preview" alt="" />
            <span
              v-else
              class="op-file-ext"
              :data-kind="kindOf(finalUpload.extension)"
              aria-hidden="true"
              ><span>{{ finalUpload.extension.toUpperCase() }}</span></span
            >
          </div>
          <div class="op-final-info">
            <span class="op-file-name">{{ finalUpload.name }}</span>
            <template v-if="finalUpload.state === 'failed'">
              <p class="op-file-error" role="alert">
                {{ finalUpload.message }}
              </p>
              <div class="op-final-actions">
                <button
                  type="button"
                  class="op-files-button"
                  @click="retry(finalUpload)"
                >
                  Tentar de novo
                </button>
                <button
                  type="button"
                  class="op-files-quiet"
                  @click="cancel(finalUpload)"
                >
                  Descartar
                </button>
              </div>
            </template>
            <template v-else>
              <progress
                class="op-file-progress"
                max="100"
                :value="finalUpload.progress"
                :aria-label="`Enviando ${finalUpload.name}`"
              />
              <span class="op-file-meta"
                >Enviando… {{ finalUpload.progress }}%</span
              >
              <div class="op-final-actions">
                <button
                  type="button"
                  class="op-files-quiet"
                  @click="cancel(finalUpload)"
                >
                  Cancelar envio
                </button>
              </div>
            </template>
          </div>
        </div>

        <div v-else-if="final" class="op-final">
          <div class="op-file-thumb">
            <img
              v-if="final.thumbnail"
              :src="thumbnailUrl(final.id)"
              alt=""
              loading="lazy"
            />
            <span
              v-else
              class="op-file-ext"
              :data-kind="kindOf(final.extension)"
              aria-hidden="true"
              ><span>{{ final.extension.toUpperCase() }}</span></span
            >
          </div>
          <div class="op-final-info">
            <span class="op-file-name">{{ final.name }}</span>
            <span class="op-file-meta">
              {{ sizeLabel(final) }}
              <template v-if="final.uploadedBy?.name">
                · enviada por {{ final.uploadedBy.name }} em
                {{ uploadedAtLabel(final.uploadedAt) }}</template
              >
            </span>
            <div
              v-if="confirmingId === final.id"
              class="op-file-confirm"
              role="group"
              :aria-label="`Remover ${final.name}?`"
              @keydown.esc="closeConfirm(final)"
            >
              <p>Remover a arte final “{{ final.name }}”?</p>
              <div>
                <button
                  :ref="focusRef(`cancel:${final.id}`)"
                  type="button"
                  :disabled="removingId === final.id"
                  @click="closeConfirm(final)"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="danger"
                  :disabled="removingId === final.id"
                  @click="remove(final)"
                >
                  {{ removingId === final.id ? 'Removendo…' : 'Remover' }}
                </button>
              </div>
            </div>
            <div v-else class="op-final-actions">
              <a
                class="op-files-button"
                :href="contentUrl(final.id)"
                download
                :aria-label="`Baixar arte final ${final.name}`"
                ><OrderIcon name="download" />Baixar</a
              >
              <template v-if="canChange">
                <button
                  ref="finalButton"
                  type="button"
                  class="op-files-quiet"
                  @click="choose('final')"
                >
                  <OrderIcon name="swap" />Substituir
                </button>
                <button
                  :ref="focusRef(`remove:${final.id}`)"
                  type="button"
                  class="op-file-icon"
                  data-danger
                  :aria-label="`Remover arte final ${final.name}`"
                  @click="askRemove(final)"
                >
                  <OrderIcon name="trash" />
                </button>
              </template>
            </div>
          </div>
        </div>

        <div v-else class="op-final-empty">
          <p>
            <strong>Nenhuma arte final enviada</strong>
            <template v-if="canChange"
              >A versão aprovada que vai para a produção. Um arquivo, até 10 MB;
              não conta nos 5 arquivos da arte.</template
            >
          </p>
          <button
            v-if="canChange"
            ref="finalButton"
            type="button"
            class="op-files-button"
            @click="choose('final')"
          >
            <OrderIcon name="upload" />Enviar arte final
          </button>
        </div>
      </section>

      <section
        class="op-files-block"
        aria-labelledby="order-artwork-files-title"
        aria-describedby="order-artwork-files-hint"
        @dragover.prevent="dragging = canChange"
        @dragleave="dragging = false"
        @drop.prevent="dropped"
      >
        <div class="op-files-head">
          <h3 id="order-artwork-files-title">Arquivos da arte</h3>
          <span class="op-files-count" :data-full="full || undefined">{{
            countLabel
          }}</span>
          <button
            v-if="canChange && !showDropzone"
            ref="addButton"
            type="button"
            class="op-files-button op-files-add-head"
            :disabled="full"
            @click="choose('reference')"
          >
            <OrderIcon name="plus" />Adicionar arquivos da arte
          </button>
        </div>
        <p id="order-artwork-files-hint" class="op-hint">
          Até 5 arquivos, 10 MB cada · {{ FORMATS_LABEL }}.
        </p>

        <p v-if="full" class="op-files-alert" data-tone="warning">
          <OrderIcon name="alert" />Limite de 5 arquivos atingido. Remova um
          para enviar outro. A arte final continua liberada.
        </p>
        <p
          v-for="message in refusals"
          :key="message"
          class="op-files-alert"
          data-tone="error"
          role="alert"
        >
          <OrderIcon name="alert" />{{ message }}
        </p>

        <div
          v-if="showDropzone"
          class="op-files-drop"
          :data-over="dragging || undefined"
        >
          <OrderIcon name="upload" />
          <p><strong>Arraste os arquivos para cá</strong> ou</p>
          <button
            ref="addButton"
            type="button"
            class="op-save"
            @click="choose('reference')"
          >
            <OrderIcon name="plus" />Adicionar arquivos da arte
          </button>
        </div>

        <p v-else-if="!canChange && references.length === 0" class="op-empty">
          Nenhum arquivo anexado.
        </p>

        <ul
          v-if="references.length || referenceUploads.length"
          class="op-files-grid"
          :data-over="dragging || undefined"
        >
          <li
            v-for="file in references"
            :key="file.id"
            class="op-file"
            :data-state="confirmingId === file.id ? 'confirm' : undefined"
          >
            <div class="op-file-thumb">
              <img
                v-if="file.thumbnail"
                :src="thumbnailUrl(file.id)"
                alt=""
                loading="lazy"
              />
              <span
                v-else
                class="op-file-ext"
                :data-kind="kindOf(file.extension)"
                aria-hidden="true"
                ><span>{{ file.extension.toUpperCase() }}</span></span
              >
            </div>
            <div class="op-file-body">
              <span class="op-file-name" :title="file.name">{{
                file.name
              }}</span>
              <span class="op-file-meta">{{ sizeLabel(file) }}</span>
            </div>
            <div class="op-file-actions">
              <a
                :ref="focusRef(`download:${file.id}`)"
                class="op-file-icon"
                :href="contentUrl(file.id)"
                download
                :aria-label="`Baixar ${file.name}`"
                ><OrderIcon name="download"
              /></a>
              <button
                v-if="canChange"
                :ref="focusRef(`remove:${file.id}`)"
                type="button"
                class="op-file-icon"
                data-danger
                :aria-label="`Remover ${file.name}`"
                @click="askRemove(file)"
              >
                <OrderIcon name="trash" />
              </button>
            </div>
            <div
              v-if="confirmingId === file.id"
              class="op-file-confirm"
              role="group"
              :aria-label="`Remover ${file.name}?`"
              @keydown.esc="closeConfirm(file)"
            >
              <p>Remover “{{ file.name }}”?</p>
              <div>
                <button
                  :ref="focusRef(`cancel:${file.id}`)"
                  type="button"
                  :disabled="removingId === file.id"
                  @click="closeConfirm(file)"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="danger"
                  :disabled="removingId === file.id"
                  @click="remove(file)"
                >
                  {{ removingId === file.id ? 'Removendo…' : 'Remover' }}
                </button>
              </div>
            </div>
          </li>

          <li
            v-for="entry in referenceUploads"
            :key="entry.key"
            class="op-file"
            :data-state="entry.state === 'failed' ? 'failed' : 'busy'"
            :aria-busy="entry.state !== 'failed'"
          >
            <div class="op-file-thumb">
              <img v-if="entry.preview" :src="entry.preview" alt="" />
              <span
                v-else
                class="op-file-ext"
                :data-kind="kindOf(entry.extension)"
                aria-hidden="true"
                ><span>{{ entry.extension.toUpperCase() }}</span></span
              >
              <progress
                v-if="entry.state !== 'failed'"
                class="op-file-progress"
                max="100"
                :value="entry.progress"
                :aria-label="`Enviando ${entry.name}`"
              />
            </div>
            <div class="op-file-body">
              <span class="op-file-name" :title="entry.name">{{
                entry.name
              }}</span>
              <span v-if="entry.state === 'failed'" class="op-file-error">{{
                entry.message
              }}</span>
              <span v-else class="op-file-meta">{{
                entry.state === 'queued'
                  ? 'Na fila…'
                  : `Enviando… ${entry.progress}%`
              }}</span>
            </div>
            <div class="op-file-actions">
              <button
                v-if="entry.state === 'failed'"
                type="button"
                class="op-file-icon"
                :aria-label="`Tentar enviar ${entry.name} de novo`"
                @click="retry(entry)"
              >
                <OrderIcon name="upload" />
              </button>
              <button
                type="button"
                class="op-file-icon"
                :aria-label="
                  entry.state === 'failed'
                    ? `Descartar ${entry.name}`
                    : `Cancelar envio de ${entry.name}`
                "
                @click="cancel(entry)"
              >
                <OrderIcon name="x" />
              </button>
            </div>
          </li>

          <li v-if="canChange && freeSlots > 0" class="op-files-add-tile">
            <button ref="addTile" type="button" @click="choose('reference')">
              <OrderIcon name="plus" />Adicionar
              <small
                >{{ freeSlots }} {{ freeSlots === 1 ? 'vaga' : 'vagas' }} · 10
                MB cada</small
              >
            </button>
          </li>
        </ul>
      </section>
    </template>

    <input
      ref="picker"
      class="sr-only"
      type="file"
      multiple
      tabindex="-1"
      aria-hidden="true"
      :accept="ACCEPT"
      @change="picked($event, 'reference')"
    />
    <input
      ref="finalPicker"
      class="sr-only"
      type="file"
      tabindex="-1"
      aria-hidden="true"
      :accept="ACCEPT"
      @change="picked($event, 'final')"
    />
  </div>
</template>
