<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';

const props = defineProps({
  conversationId: { type: String, required: true },
  expectedVersion: { type: Number, required: true },
  disabled: { type: Boolean, default: false },
  recording: { type: Object, default: null },
});
const emit = defineEmits(['sent', 'sending-change']);
const inputId = useId(),
  captionId = useId(),
  statusId = useId();
const fileInput = ref(null),
  prepareButton = ref(null),
  sendButton = ref(null);
const file = ref(/** @type {File|null} */ (null)),
  preview = ref(''),
  kind = ref(''),
  caption = ref('');
const state = ref('empty'),
  error = ref(''),
  mediaId = ref('');
const fileOrigin = ref('attachment');
/** @type {{conversationId:string,expectedVersion:number,uploadKey:string}|null} */ let context =
  null;
/** @type {{key:string,body:Record<string,any>}|null} */ let sendAttempt = null;
/** @type {AbortController|null} */ let controller = null;
let generation = 0;
const captionLength = computed(() => Array.from(caption.value).length);
const busy = computed(() =>
  ['uploading', 'processing', 'sending'].includes(state.value),
);
watch(
  () => state.value === 'sending',
  (sending) => emit('sending-change', sending),
  { immediate: true },
);
const sendAllowed = computed(
  () =>
    !props.disabled &&
    !busy.value &&
    state.value === 'ready' &&
    Boolean(mediaId.value) &&
    (kind.value === 'audio' || captionLength.value <= 1024),
);
const status = computed(
  () =>
    ({
      empty: 'Selecione um arquivo para revisar.',
      selected: 'Revise a prévia e prepare o arquivo.',
      uploading: 'Preparando arquivo…',
      processing: 'Validando arquivo…',
      ready: 'Arquivo pronto. Revise e envie quando quiser.',
      sending: 'Enviando anexo…',
      rejected: 'Arquivo rejeitado. Remova e escolha outro.',
      error: 'Não foi possível concluir. A prévia foi preservada.',
    })[state.value],
);
const mimeHints = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'video/mp4': 'video',
});
const extensionHints = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
});
/** @param {File} candidate */
function hint(candidate) {
  const normalized = ['audio/m4a', 'audio/x-m4a'].includes(candidate.type)
    ? 'audio/mp4'
    : candidate.type;
  const mime = Object.hasOwn(mimeHints, normalized)
    ? normalized
    : extensionHints[candidate.name.split('.').at(-1)?.toLowerCase()];
  return mime ? { mime, kind: mimeHints[mime] } : null;
}
function cancel() {
  generation++;
  controller?.abort();
  controller = null;
}
function clear() {
  cancel();
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
  file.value = null;
  kind.value = '';
  caption.value = '';
  mediaId.value = '';
  fileOrigin.value = 'attachment';
  error.value = '';
  state.value = 'empty';
  context = null;
  sendAttempt = null;
  if (fileInput.value) fileInput.value.value = '';
}
async function remove() {
  clear();
  await nextTick();
  fileInput.value?.focus();
}
/** @param {Event} event */
async function selectFile(event) {
  const files = Array.from(
    /** @type {HTMLInputElement} */ (event.target).files ?? [],
  );
  clear();
  if (!files?.length) return;
  if (files.length !== 1) {
    error.value = 'Selecione apenas um arquivo.';
    return;
  }
  await selectCandidate(files[0]);
}
/** @param {File} selected @param {string} [origin] */
async function selectCandidate(selected, origin = 'attachment') {
  const actualMime = selected.type.split(';')[0].trim().toLowerCase();
  const declaration =
    origin === 'recording' &&
    ['audio/webm', 'audio/ogg', 'audio/mp4'].includes(actualMime)
      ? { mime: selected.type, kind: 'audio' }
      : hint(selected);
  if (!declaration) {
    error.value = 'Escolha JPEG, PNG, MP3, OGG, M4A ou MP4.';
    return;
  }
  const limit = (declaration.kind === 'image' ? 5 : 16) * 1024 * 1024;
  if (selected.size < 1 || selected.size > limit) {
    error.value = `O arquivo deve ter até ${declaration.kind === 'image' ? 5 : 16} MiB e não pode estar vazio.`;
    return;
  }
  // Browser MIME/extension is only a declaration hint. The worker validates
  // actual bytes, format and codecs before this draft can ever be sent.
  file.value =
    selected.type === declaration.mime
      ? selected
      : new File([selected], selected.name, {
          type: declaration.mime,
          lastModified: selected.lastModified,
        });
  kind.value = declaration.kind;
  fileOrigin.value = origin;
  preview.value = URL.createObjectURL(file.value);
  context = {
    conversationId: props.conversationId,
    expectedVersion: props.expectedVersion,
    uploadKey: commandKey(),
  };
  state.value = 'selected';
  await nextTick();
  prepareButton.value?.focus();
}
/** @param {number} token */
function current(token) {
  return (
    token === generation &&
    !props.disabled &&
    context?.conversationId === props.conversationId
  );
}
/** @param {AbortSignal} signal */
function delay(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Cancelado', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve(undefined);
    }, 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** @param {number} token @param {AbortSignal} signal @param {string} conversationId */
async function poll(token, signal, conversationId) {
  // Local processing permits 340 seconds plus storage/database I/O. Bound the
  // complete polling attempt while preserving the media ID for a later refresh.
  const deadline = Date.now() + 600000;
  const polling = new AbortController();
  const abort = () => polling.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(
    () => polling.abort(new Error('MEDIA_PROCESSING_TIMEOUT')),
    600000,
  );
  try {
    while (current(token)) {
      if (Date.now() > deadline) throw new Error('MEDIA_PROCESSING_TIMEOUT');
      const { data } = await request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(mediaId.value)}`,
        { signal: polling.signal },
      );
      if (!current(token)) return;
      if (data.state === 'ready') {
        state.value = 'ready';
        await nextTick();
        sendButton.value?.focus();
        return;
      }
      if (['rejected', 'unavailable', 'lost', 'expired'].includes(data.state)) {
        state.value = 'rejected';
        error.value =
          data.reason === 'invalid_format'
            ? 'Formato inválido. Escolha outro arquivo.'
            : 'Arquivo indisponível. Escolha outro arquivo.';
        return;
      }
      if (data.state !== 'processing') throw new Error('MEDIA_INVALID_STATE');
      state.value = 'processing';
      await delay(polling.signal);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
async function prepare() {
  if (props.disabled || busy.value || !file.value || !context) return;
  cancel();
  const token = generation;
  controller = new AbortController();
  const signal = controller.signal;
  const captured = context;
  error.value = '';
  state.value = 'uploading';
  try {
    if (!mediaId.value) {
      const form = new FormData();
      form.set('kind', kind.value);
      form.set('origin', fileOrigin.value);
      form.set('expectedVersion', String(captured.expectedVersion));
      form.set('file', file.value, file.value.name);
      const { data } = await request(
        `/api/v1/conversations/${encodeURIComponent(captured.conversationId)}/media`,
        {
          method: 'POST',
          body: form,
          idempotencyKey: captured.uploadKey,
          signal,
        },
      );
      if (!current(token)) return;
      if (typeof data.mediaId !== 'string' || !data.mediaId)
        throw new Error('MEDIA_INVALID_RESPONSE');
      mediaId.value = data.mediaId;
    }
    await poll(token, signal, captured.conversationId);
  } catch (cause) {
    if (!current(token) || cause?.name === 'AbortError') return;
    state.value = 'error';
    error.value = 'Não foi possível preparar o arquivo. Tente novamente.';
  } finally {
    if (token === generation) controller = null;
  }
}
async function send() {
  if (!sendAllowed.value || !context) return;
  sendAttempt ??= {
    key: commandKey(),
    body: {
      expectedVersion: context.expectedVersion,
      messageType: kind.value,
      content:
        kind.value === 'audio'
          ? { mediaId: mediaId.value }
          : { mediaId: mediaId.value, caption: caption.value },
      reason: 'Envio humano de anexo',
    },
  };
  cancel();
  const token = generation;
  controller = new AbortController();
  const captured = context,
    attempt = sendAttempt;
  state.value = 'sending';
  error.value = '';
  try {
    const { data } = await request(
      `/api/v1/conversations/${encodeURIComponent(captured.conversationId)}/messages`,
      {
        method: 'POST',
        body: attempt.body,
        idempotencyKey: attempt.key,
        signal: controller.signal,
      },
    );
    if (!current(token)) return;
    clear();
    emit('sent', data);
    await nextTick();
    fileInput.value?.focus();
  } catch (cause) {
    if (!current(token) || cause?.name === 'AbortError') return;
    state.value = 'ready';
    error.value =
      'Não foi possível confirmar o envio. Tente novamente para consultar o mesmo envio.';
  } finally {
    if (token === generation) controller = null;
  }
}
watch(
  () => [props.conversationId, props.expectedVersion],
  () => clear(),
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      cancel();
      if (busy.value) {
        // An aborted message request can already have committed. Keep its
        // immutable attempt eligible for an explicit idempotent retry.
        state.value = sendAttempt
          ? 'ready'
          : mediaId.value
            ? 'error'
            : 'selected';
        error.value = 'Envio indisponível nesta conversa.';
      }
    }
  },
);
onBeforeUnmount(() => clear());
watch(
  () => props.recording,
  async (recording) => {
    clear();
    if (recording instanceof File)
      await selectCandidate(recording, 'recording');
  },
);
</script>

<template>
  <section class="media-composer" aria-label="Anexar mídia" :aria-busy="busy">
    <label :for="inputId">Arquivo para anexar</label>
    <input
      :id="inputId"
      ref="fileInput"
      type="file"
      accept=".jpg,.jpeg,.png,.mp3,.ogg,.m4a,.mp4,image/jpeg,image/png,audio/mpeg,audio/ogg,audio/mp4,video/mp4"
      :disabled="disabled || busy"
      :aria-describedby="statusId"
      @change="selectFile"
    />
    <div v-if="file" class="media-composer__review">
      <p>{{ file.name }}</p>
      <img v-if="kind === 'image'" :src="preview" alt="Prévia do anexo" />
      <audio
        v-else-if="kind === 'audio'"
        :src="preview"
        controls
        preload="metadata"
        aria-label="Prévia do áudio"
      ></audio>
      <video
        v-else
        :src="preview"
        controls
        preload="metadata"
        aria-label="Prévia do vídeo"
      ></video>
      <template v-if="kind !== 'audio'">
        <label :for="captionId">Legenda</label>
        <textarea
          :id="captionId"
          v-model="caption"
          :disabled="disabled || busy || Boolean(sendAttempt)"
          :aria-invalid="captionLength > 1024"
          :aria-describedby="`${captionId}-count`"
        ></textarea>
        <p :id="`${captionId}-count`">{{ captionLength }}/1024 caracteres</p>
      </template>
      <div class="button-row">
        <button
          ref="prepareButton"
          type="button"
          :disabled="
            disabled ||
            busy ||
            ['ready', 'rejected'].includes(state) ||
            Boolean(sendAttempt)
          "
          @click="prepare"
        >
          {{
            mediaId && state === 'error'
              ? 'Atualizar validação'
              : state === 'error'
                ? 'Tentar preparar novamente'
                : 'Preparar arquivo'
          }}
        </button>
        <button
          ref="sendButton"
          type="button"
          :disabled="!sendAllowed"
          @click="send"
        >
          {{ sendAttempt ? 'Tentar enviar novamente' : 'Enviar anexo' }}
        </button>
        <button type="button" :disabled="state === 'sending'" @click="remove">
          Remover anexo
        </button>
      </div>
    </div>
    <p :id="statusId" role="status" aria-live="polite">{{ status }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.media-composer {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.media-composer__review {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.media-composer__review p {
  overflow-wrap: anywhere;
}
img,
video {
  max-width: 100%;
  max-height: 20rem;
  object-fit: contain;
}
audio,
textarea {
  width: 100%;
}
textarea {
  min-height: 5rem;
  resize: vertical;
}
.button-row {
  flex-wrap: wrap;
}
</style>
