<script setup>
// WAP-22/23/24/32 (WAP-T04-04): optional, individual first message from
// Meus clientes. "Iniciar conversa" only reads a preview; nothing is sent
// until "Enviar primeira mensagem". The parent keys this component by
// contact, so a context change unmounts it, aborting reads and the command.
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, commandKey, request } from '../lib/api-client.js';

const MAX_LENGTH = 2000;
const TEXT = {
  disabled:
    'O primeiro envio pelo CRM não está habilitado para você. O atendimento continua quando o cliente procurar seu WhatsApp.',
  stale: 'O cadastro, o vínculo ou sua linha mudaram. Confira de novo.',
  unavailable: 'Este cliente não está disponível para o primeiro envio.',
  offline:
    'Seu WhatsApp não está disponível agora. Nada foi enviado e o rascunho foi mantido.',
  destination:
    'O telefone do cliente não é um WhatsApp válido. Corrija o cadastro do cliente; o rascunho foi mantido.',
  invalid: 'Confira a mensagem: escreva de 1 a 2000 caracteres.',
  blank: 'Escreva a mensagem antes de enviar.',
  busy: 'Há muitos envios em sequência. Aguarde um pouco e tente de novo: a mesma tentativa não gera outra mensagem.',
  uncertain:
    'Não conseguimos confirmar o envio. Tente de novo: a mesma tentativa não gera outra mensagem.',
  preview:
    'Não foi possível conferir o cliente e sua linha agora. Confira de novo.',
};
/** Restrictions are shown in plain words, never with server details. */
const RESTRICTIONS = /** @type {Record<string, string>} */ ({
  line_not_configured:
    'Seu WhatsApp ainda não está conectado. Conecte em Minha conta para enviar.',
  line_unavailable:
    'Seu WhatsApp está desconectado. Conecte em Minha conta para enviar.',
  destination_invalid:
    'O telefone do cliente está ausente ou não é um WhatsApp válido. Corrija o cadastro do cliente para enviar.',
  identity_conflict:
    'Não é possível iniciar esta conversa pelo CRM. O atendimento continua quando o cliente procurar seu WhatsApp.',
  conversation_unavailable:
    'Não é possível iniciar esta conversa pelo CRM. O atendimento continua quando o cliente procurar seu WhatsApp.',
});
const LINE_RESTRICTIONS = new Set(['line_not_configured', 'line_unavailable']);

const props = defineProps({
  contact: { type: Object, required: true },
  // Owned by ClientsView: contactId -> {text, attempt, uncertain}; memory only.
  drafts: { type: Map, required: true },
});
const notify = inject('notify', () => {});
const router = useRouter();
const open = ref(false);
const loading = ref(false);
const preview = ref(null);
const previewFailed = ref(false);
const disabledFeature = ref(false);
const text = ref('');
const sending = ref(false);
const error = ref('');
const recheck = ref(false);
const uncertain = ref(false);
const invalidText = ref(false);
const trigger = ref(null);
const textarea = ref(null);
const recheckButton = ref(null);
/** @type {AbortController|undefined} */
let previewController;
/** @type {AbortController|undefined} */
let sendController;
/** @type {{contactId: string}|undefined} */
let inflight;
let disposed = false;

const ids = computed(() => {
  const base = `first-message-${props.contact.id}`;
  return {
    title: `${base}-title`,
    field: `${base}-text`,
    hint: `${base}-hint`,
    help: `${base}-help`,
    error: `${base}-error`,
  };
});
const restriction = computed(() =>
  preview.value && !preview.value.available
    ? (RESTRICTIONS[preview.value.restriction] ??
      RESTRICTIONS.identity_conflict)
    : '',
);
const lineRestricted = computed(() =>
  LINE_RESTRICTIONS.has(preview.value?.restriction),
);
/** Why sending is unavailable now; '' when it is available. */
const blockedReason = computed(() => {
  if (disabledFeature.value) return TEXT.disabled;
  // An uncertain attempt is always retried with its own key and body.
  if (uncertain.value) return '';
  if (recheck.value || previewFailed.value) return error.value || TEXT.preview;
  if (loading.value || !preview.value) return 'Conferindo cliente e linha…';
  return restriction.value;
});
const showHelp = computed(
  () => Boolean(blockedReason.value) && !error.value && !loading.value,
);
const sendDescribedBy = computed(
  () =>
    [showHelp.value ? ids.value.help : '', error.value ? ids.value.error : '']
      .filter(Boolean)
      .join(' ') || undefined,
);

function entry() {
  return props.drafts.get(props.contact.id) ?? {};
}
/** @param {string} contactId @param {Record<string, unknown>} patch */
function remember(contactId, patch) {
  const next = { ...(props.drafts.get(contactId) ?? {}), ...patch };
  if (!next.text && !next.attempt) props.drafts.delete(contactId);
  else props.drafts.set(contactId, next);
}
function dropAttempt(contactId = props.contact.id) {
  uncertain.value = false;
  remember(contactId, { attempt: undefined, uncertain: false });
}

watch(text, (value) => {
  if (open.value) remember(props.contact.id, { text: value });
  if (invalidText.value && value.trim()) {
    invalidText.value = false;
    if (error.value === TEXT.blank) error.value = '';
  }
});

async function start() {
  if (open.value) return;
  const saved = entry();
  text.value = saved.text ?? '';
  uncertain.value = Boolean(saved.uncertain && saved.attempt);
  error.value = uncertain.value ? TEXT.uncertain : '';
  recheck.value = false;
  invalidText.value = false;
  open.value = true;
  await nextTick();
  textarea.value?.focus();
  await loadPreview();
}

async function loadPreview() {
  const contactId = props.contact.id;
  previewController?.abort();
  const controller = new AbortController();
  previewController = controller;
  loading.value = true;
  preview.value = null;
  previewFailed.value = false;
  disabledFeature.value = false;
  try {
    const { data } = await request(
      `/api/v1/contacts/${encodeURIComponent(contactId)}/whatsapp/first-message-preview`,
      { signal: controller.signal },
    );
    if (
      previewController !== controller ||
      disposed ||
      contactId !== props.contact.id
    )
      return;
    preview.value = data.preview;
  } catch (cause) {
    if (
      previewController !== controller ||
      disposed ||
      cause?.name === 'AbortError'
    )
      return;
    if (cause?.code === 'SELLER_WHATSAPP_FIRST_SEND_DISABLED')
      disabledFeature.value = true;
    else {
      previewFailed.value = true;
      if (!uncertain.value)
        error.value = [403, 404].includes(Number(cause?.status))
          ? TEXT.unavailable
          : TEXT.preview;
    }
  } finally {
    if (previewController === controller) {
      previewController = undefined;
      loading.value = false;
    }
  }
}

async function confirmAgain() {
  recheck.value = false;
  if (!uncertain.value) error.value = '';
  await loadPreview();
  await nextTick();
  if (!disposed) textarea.value?.focus();
}

/** Aborting an accepted command leaves its outcome unknown: keep its key. */
function abortSend() {
  if (!sendController) return;
  sendController.abort();
  sendController = undefined;
  if (inflight) remember(inflight.contactId, { uncertain: true });
  inflight = undefined;
  sending.value = false;
}

async function cancel() {
  previewController?.abort();
  previewController = undefined;
  abortSend();
  open.value = false;
  loading.value = false;
  preview.value = null;
  previewFailed.value = false;
  error.value = '';
  recheck.value = false;
  uncertain.value = false;
  invalidText.value = false;
  await nextTick();
  trigger.value?.focus();
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void send();
  }
}

/** @param {any} p @param {string} contactId @param {string} message */
function newAttempt(p, contactId, message) {
  const body = {
    text: message,
    expectedContactVersion: p.contact.version,
    expectedLinkVersion: p.link.version,
    expectedLineVersion: p.line.version,
    expectedGeneration: p.line.generation,
  };
  const fingerprint = `${contactId}:${body.expectedContactVersion}:${body.expectedLinkVersion}:${body.expectedLineVersion}:${body.expectedGeneration}:${message}`;
  const saved = entry().attempt;
  return saved?.fingerprint === fingerprint
    ? saved
    : { fingerprint, key: commandKey(), body };
}

async function send() {
  if (sending.value || blockedReason.value) return;
  const contactId = props.contact.id;
  const saved = entry();
  let attempt = uncertain.value ? saved.attempt : null;
  if (!attempt) {
    const message = text.value.trim();
    if (!message) {
      invalidText.value = true;
      error.value = TEXT.blank;
      textarea.value?.focus();
      return;
    }
    attempt = newAttempt(preview.value, contactId, message);
  }
  remember(contactId, { attempt });
  sendController?.abort();
  const controller = new AbortController();
  sendController = controller;
  inflight = { contactId };
  sending.value = true;
  error.value = '';
  invalidText.value = false;
  try {
    const { data } = await request(
      `/api/v1/contacts/${encodeURIComponent(contactId)}/whatsapp/conversations`,
      {
        method: 'POST',
        body: attempt.body,
        idempotencyKey: attempt.key,
        signal: controller.signal,
      },
    );
    if (sendController !== controller || disposed) return;
    sendController = undefined;
    inflight = undefined;
    sending.value = false;
    props.drafts.delete(contactId);
    open.value = false;
    notify(
      data.conversation.reused
        ? 'Primeira mensagem enviada para a fila no atendimento ativo.'
        : 'Primeira mensagem enviada para a fila em um novo atendimento.',
    );
    await router.push(`/inbox/${encodeURIComponent(data.conversation.id)}`);
  } catch (cause) {
    if (
      sendController !== controller ||
      disposed ||
      cause?.name === 'AbortError'
    )
      return;
    fail(cause, contactId);
  } finally {
    if (sendController === controller) {
      sendController = undefined;
      inflight = undefined;
      sending.value = false;
    }
  }
}

/** Refusals keep the draft and drop the key; anything else stays uncertain.
 * @param {unknown} cause @param {string} contactId */
function fail(cause, contactId) {
  const refusal = cause instanceof ApiError ? cause : null;
  const status = refusal?.status ?? 0;
  const code = refusal?.code ?? '';
  if (code === 'SELLER_WHATSAPP_FIRST_SEND_DISABLED') {
    dropAttempt(contactId);
    disabledFeature.value = true;
    return;
  }
  // Version, generation, identity or conversation changed, or access ended.
  if ([403, 404, 409].includes(status)) {
    dropAttempt(contactId);
    recheck.value = true;
    error.value = status === 409 ? TEXT.stale : TEXT.unavailable;
    void nextTick(() => recheckButton.value?.focus());
    return;
  }
  const refused = {
    WHATSAPP_SEND_UNAVAILABLE: TEXT.offline,
    WHATSAPP_DESTINATION_INVALID: TEXT.destination,
  }[code];
  if (refused || status === 400 || status === 422) {
    dropAttempt(contactId);
    error.value = refused ?? (status === 422 ? TEXT.destination : TEXT.invalid);
    if (status === 400) invalidText.value = true;
    return;
  }
  if (status === 429) {
    error.value = TEXT.busy;
    return;
  }
  // Network failure, timeout or other server failure: the command may exist.
  uncertain.value = true;
  remember(contactId, { uncertain: true });
  error.value = TEXT.uncertain;
}

onBeforeUnmount(() => {
  disposed = true;
  previewController?.abort();
  abortSend();
});
</script>

<template>
  <section class="first-message" :aria-labelledby="ids.title">
    <div class="panel-head subsection-heading">
      <h3 :id="ids.title">Primeira mensagem pelo WhatsApp</h3>
    </div>
    <p>
      Opcional. O atendimento continua quando o cliente procurar seu WhatsApp;
      nada é enviado sem você confirmar.
    </p>
    <button v-if="!open" ref="trigger" type="button" @click="start">
      Iniciar conversa
    </button>
    <form
      v-else
      class="first-message__composer"
      novalidate
      @submit.prevent="send"
    >
      <div role="status" class="first-message__status">
        <p v-if="loading">Conferindo cliente e linha…</p>
        <p v-else-if="sending">Enviando primeira mensagem…</p>
      </div>
      <dl v-if="preview" class="client-facts first-message__facts">
        <div>
          <dt>Cliente</dt>
          <dd>{{ preview.contact.name }}</dd>
        </div>
        <div>
          <dt>WhatsApp do cliente</dt>
          <dd>
            {{ preview.recipient?.maskedNumber ?? 'Sem WhatsApp válido' }}
          </dd>
        </div>
        <div>
          <dt>Sua linha</dt>
          <dd>{{ preview.line?.maskedNumber ?? 'Sem linha conectada' }}</dd>
        </div>
        <div>
          <dt>Atendimento</dt>
          <dd>
            {{
              preview.conversation
                ? 'Continua o atendimento ativo'
                : 'Abre um novo atendimento'
            }}
          </dd>
        </div>
      </dl>
      <p v-if="showHelp" :id="ids.help" class="audit-note first-message__help">
        {{ blockedReason }}
        <RouterLink v-if="lineRestricted" to="/conta#my-whatsapp-title"
          >Abrir Minha conta</RouterLink
        >
      </p>
      <label :for="ids.field">Mensagem para o cliente</label>
      <textarea
        :id="ids.field"
        ref="textarea"
        v-model="text"
        rows="4"
        :maxlength="MAX_LENGTH"
        required
        :readonly="uncertain"
        :aria-invalid="invalidText || undefined"
        :aria-describedby="`${ids.hint}${error ? ` ${ids.error}` : ''}`"
        @keydown="onKeydown"
      ></textarea>
      <p :id="ids.hint" class="first-message__hint">
        {{ text.length }} de {{ MAX_LENGTH }} caracteres. Enter quebra a linha;
        Ctrl+Enter envia.
        <template v-if="uncertain">
          O texto fica travado até confirmarmos esta tentativa.</template
        >
      </p>
      <div
        v-if="error"
        :id="ids.error"
        role="alert"
        class="op-alert first-message__alert"
      >
        <p>{{ error }}</p>
        <button
          v-if="recheck || previewFailed"
          ref="recheckButton"
          type="button"
          @click="confirmAgain"
        >
          Conferir de novo
        </button>
      </div>
      <div class="inline-actions">
        <button
          type="submit"
          class="primary"
          :aria-disabled="sending || Boolean(blockedReason) || undefined"
          :aria-describedby="sendDescribedBy"
        >
          {{ uncertain ? 'Verificar e reenviar' : 'Enviar primeira mensagem' }}
        </button>
        <button type="button" @click="cancel">Cancelar</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.first-message__composer {
  display: grid;
  gap: 0.5rem;
  max-inline-size: 40rem;
}

.first-message__facts {
  margin-block: 0.25rem;
}

.first-message__status p,
.first-message__alert p {
  margin: 0;
}

.first-message__help {
  margin-block-start: 0;
}

.first-message__alert {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
}

.first-message__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.first-message textarea {
  resize: vertical;
}

.first-message textarea[readonly] {
  background: var(--color-surface-muted);
}

.first-message button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.7;
}
</style>
