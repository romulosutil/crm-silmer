<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { commandKey, request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  conversationLabel,
  dateTimeBR,
  formatPhoneNumber,
  messageText,
} from '../lib/format.js';
import { openDialog } from '../lib/ui.js';

const ADMIN_CAPABILITY = 'COMMERCIAL_ADMIN';
const LIVE_REFRESH_DELAY_MS = 250;
const DELIVERY_NOTICES = Object.freeze({
  failed: 'Falha no envio',
  outcome_unknown: 'Envio aguardando confirmação',
});
const INBOX_STATES = Object.freeze([
  ['all', 'Todas'],
  ['nova', 'Novas'],
  ['em_analise', 'Em análise'],
  ['em_atendimento', 'Em atendimento'],
  ['requer_atencao', 'Requer atenção'],
  ['convertida_em_lead', 'Convertidas em lead'],
  ['sem_lead', 'Sem lead'],
]);
const QUEUE_FILTERS = Object.freeze([
  { label: 'Todas as conversas', value: 'all', visualLabel: 'Todas' },
  { label: 'Minhas conversas', value: 'mine', visualLabel: 'Minhas' },
  {
    label: 'Aguardando atendimento',
    value: 'unassignedHumanHandoff',
    visualLabel: 'Sem responsável',
  },
]);

const liveEvent = inject('liveEvent', ref(null));
const sessionUser = inject(
  'sessionUser',
  computed(() => ({})),
);

const heading = ref(null);
const searchInput = ref(null);
const replyInput = ref(null);
const nameInput = ref(null);
const archiveConfirmationDialog = ref(null);
const stateFilterMenu = ref(null);
const query = ref('');
const showArchived = ref(false);
const stateFilter = ref('all');
const queueFilter = ref('all');
const loading = ref(true);
const detailLoading = ref(false);
const busy = ref(false);
const error = ref('');
const actionMessage = ref('');
const conversations = ref([]);
const totalCount = ref(0);
const activeId = ref('');
const detail = ref(null);
const reply = ref('');
const renaming = ref(false);
const draftName = ref('');
const transferring = ref(false);
const transferTarget = ref('');
const assignableUsers = ref([]);
let listController;
let detailController;
let refreshTimer = 0;

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('pt-BR');
  if (!needle) return conversations.value;
  return conversations.value.filter((conversation) =>
    `${conversation.contact.label} ${conversation.contact.externalId} ${messageText(conversation.lastMessage)}`
      .toLocaleLowerCase('pt-BR')
      .includes(needle),
  );
});
const active = computed(() => detail.value?.conversation ?? null);
const isTerminal = computed(() =>
  ['convertida_em_lead', 'sem_lead'].includes(active.value?.state),
);
const currentUserId = computed(() => sessionUser.value?.id ?? '');
const isAdmin = computed(() =>
  (sessionUser.value?.capabilities ?? []).includes(ADMIN_CAPABILITY),
);
const owner = computed(() => active.value?.assignedUser ?? null);
const ownedByMe = computed(
  () => !owner.value || owner.value.id === currentUserId.value,
);
/**
 * A conversation belongs to whoever took it over. Another seller sees it but
 * cannot act on it; only an administrator overrides that.
 */
const canAct = computed(
  () => !isTerminal.value && (ownedByMe.value || isAdmin.value),
);
const ownerLabel = computed(() => {
  if (!owner.value) return 'Sem responsável';
  if (owner.value.id === currentUserId.value) return 'Você';
  return (
    assignableUsers.value.find((user) => user.id === owner.value.id)?.name ??
    'Outro vendedor'
  );
});
const transferOptions = computed(() =>
  assignableUsers.value.filter((user) => user.id !== currentUserId.value),
);
const canReply = computed(
  () =>
    canAct.value &&
    !pendingHandoff.value &&
    active.value?.automationState === 'human',
);
const pendingHandoff = computed(
  () => active.value?.handoff?.status === 'pending',
);
const canTransfer = computed(
  () =>
    canAct.value &&
    active.value?.automationState === 'human' &&
    Boolean(active.value?.assignedUser),
);
const canArchive = computed(
  () =>
    !isTerminal.value &&
    (isAdmin.value || owner.value?.id === currentUserId.value),
);
const canUnarchive = computed(
  () => canArchive.value && Boolean(active.value?.archivedAt),
);
const selectedStateLabel = computed(
  () =>
    INBOX_STATES.find(([value]) => value === stateFilter.value)?.[1] ??
    'Todas',
);

function listUrl() {
  const params = new URLSearchParams({
    archived: String(showArchived.value),
    limit: '100',
  });
  if (stateFilter.value !== 'all') params.set('state', stateFilter.value);
  if (queueFilter.value === 'mine' && currentUserId.value) {
    params.set('assignedUserId', currentUserId.value);
  }
  if (queueFilter.value === 'unassignedHumanHandoff') {
    params.set('unassignedHumanHandoff', 'true');
  }
  return `/api/v1/inbox/conversations?${params.toString()}`;
}

/** @param {string} value */
function selectState(value) {
  stateFilter.value = value;
  stateFilterMenu.value?.removeAttribute('open');
}

function toggleArchived() {
  showArchived.value = !showArchived.value;
  stateFilterMenu.value?.removeAttribute('open');
}

async function archiveConversation() {
  await runCommand(
    'archive',
    {
      expectedVersion: active.value.version,
      reason: 'Conversa arquivada na Caixa de Entrada',
    },
    'Conversa arquivada. Uma nova mensagem do cliente a exibirá novamente.',
  );
}

async function unarchiveConversation() {
  const restored = await runCommand(
    'unarchive',
    {
      expectedVersion: active.value.version,
      reason: 'Conversa desarquivada na Caixa de Entrada',
    },
    'Conversa desarquivada e restaurada à Caixa de Entrada.',
  );
  if (restored) {
    showArchived.value = false;
    await loadInbox(true);
  }
}

/** @param {MouseEvent} event */
function requestArchiveConfirmation(event) {
  const dialog = archiveConfirmationDialog.value;
  const trigger = event.currentTarget;
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(trigger instanceof HTMLElement)
  ) {
    return;
  }
  openDialog(dialog, trigger);
}

async function confirmArchive() {
  archiveConfirmationDialog.value?.close();
  await archiveConversation();
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageFrom(message) {
  if (message.authorKind === 'contact') return 'cliente';
  if (message.authorKind === 'assistant') return 'agente';
  if (message.authorKind === 'human') return 'humano';
  return message.direction === 'inbound' ? 'cliente' : 'agente';
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageAuthorLabel(message) {
  const from = messageFrom(message);
  if (from === 'cliente') return active.value?.contact.label ?? 'Cliente';
  if (from === 'humano') return 'Vendedor';
  return 'Assistente Silmer';
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageRoleLabel(message) {
  const from = messageFrom(message);
  if (from === 'cliente') return 'Cliente';
  if (from === 'humano') return 'Vendedor';
  return 'IA';
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageInitials(message) {
  const from = messageFrom(message);
  if (from === 'cliente') return 'C';
  if (from === 'humano') return 'V';
  return 'IA';
}

/** @param {{deliveryStatus?: unknown}} message */
function deliveryNotice(message) {
  return (
    DELIVERY_NOTICES[
      /** @type {keyof typeof DELIVERY_NOTICES} */ (message.deliveryStatus)
    ] ?? null
  );
}

/** @param {unknown} cause */
function describeError(cause) {
  const status = Number(/** @type {any} */ (cause)?.status);
  const requestId = /** @type {any} */ (cause)?.problem?.request_id;
  const suffix = requestId ? ` (id ${requestId})` : '';
  if (status === 403) {
    return `Sem permissão para esta ação. A conversa pode estar com outro vendedor.${suffix}`;
  }
  if (status === 409) {
    return `A conversa mudou enquanto você trabalhava. Os dados foram recarregados.${suffix}`;
  }
  if (status === 429) {
    return `Muitas ações seguidas. Aguarde um instante.${suffix}`;
  }
  if (status >= 500) return `Serviço indisponível no momento.${suffix}`;
  return `Não foi possível concluir a ação.${suffix}`;
}

/** @param {boolean} [silent] */
async function loadInbox(silent = false) {
  listController?.abort();
  listController = new AbortController();
  if (!silent) loading.value = true;
  try {
    const response = await request(listUrl(), {
      signal: listController.signal,
    });
    conversations.value = response.data.items;
    totalCount.value = response.data.totalCount;
    if (!silent) error.value = '';
    await selectVisibleConversation();
  } catch (cause) {
    if (/** @type {any} */ (cause)?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar a Caixa de Entrada.';
    }
  } finally {
    loading.value = false;
  }
}

/** @param {boolean} [silent] */
async function refreshInbox(silent = false) {
  await loadInbox(silent);
}

/**
 * Keeps the detail pane on a conversation the list actually shows. Without
 * this, searching leaves the reader looking at a conversation that has been
 * filtered out of the list beside it.
 *
 * @param {boolean} [refreshActive] refetch even when the selection is unchanged
 */
async function selectVisibleConversation(refreshActive = true) {
  const visible = filtered.value;
  const stillVisible = visible.some((item) => item.id === activeId.value);
  const nextId = stillVisible ? activeId.value : (visible[0]?.id ?? '');
  if (!nextId) {
    activeId.value = '';
    detail.value = null;
    return;
  }
  // Typing in the search box must not refetch the open conversation on every
  // keystroke; only a data refresh or a changed selection needs the request.
  if (stillVisible && !refreshActive && detail.value) return;
  await selectConversation(nextId, stillVisible);
}

/** @param {string} id @param {boolean} [silent] */
async function selectConversation(id, silent = false) {
  if (!id) return;
  detailController?.abort();
  detailController = new AbortController();
  if (activeId.value !== id) {
    detail.value = null;
    renaming.value = false;
    transferring.value = false;
  }
  activeId.value = id;
  if (!silent) detailLoading.value = true;
  try {
    const response = await request(
      `/api/v1/inbox/conversations/${encodeURIComponent(id)}`,
      { signal: detailController.signal },
    );
    detail.value = response.data;
  } catch (cause) {
    if (/** @type {any} */ (cause)?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar a conversa selecionada.';
      detail.value = null;
    }
  } finally {
    detailLoading.value = false;
  }
}

/** @param {string} path @param {Record<string, unknown>} body @param {string} successMessage */
async function runCommand(path, body, successMessage) {
  if (!active.value || busy.value) return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(
      `/api/v1/conversations/${encodeURIComponent(active.value.id)}/${path}`,
      {
        body,
        idempotencyKey: commandKey(),
        method: 'POST',
      },
    );
    actionMessage.value = successMessage;
    await loadInbox(true);
    return true;
  } catch (cause) {
    error.value = describeError(cause);
    if (/** @type {any} */ (cause)?.status === 409) await loadInbox(true);
    return false;
  } finally {
    busy.value = false;
  }
}

/** @param {string} path @param {string} successMessage */
async function changeAutomation(path, successMessage) {
  await runCommand(
    path,
    {
      expectedVersion: active.value.version,
      reason: 'Ação manual na Caixa de Entrada',
    },
    successMessage,
  );
}

async function sendReply() {
  const text = reply.value.trim();
  if (!text || !active.value) return;
  await runCommand(
    'messages',
    {
      content: { text },
      expectedVersion: active.value.version,
      messageType: 'text',
      reason: 'Resposta humana na Caixa de Entrada',
    },
    'Mensagem aceita para envio.',
  );
  if (!error.value) {
    reply.value = '';
    await nextTick();
    replyInput.value?.focus();
  }
}

async function loadAssignableUsers() {
  if (assignableUsers.value.length) return;
  try {
    const response = await request('/api/v1/users/assignable');
    assignableUsers.value = response.data.users ?? [];
  } catch {
    assignableUsers.value = [];
  }
}

async function openTransfer() {
  if (!canTransfer.value) return;
  await loadAssignableUsers();
  transferTarget.value = transferOptions.value[0]?.id ?? '';
  transferring.value = true;
}

async function confirmTransfer() {
  if (!transferTarget.value) return;
  const targetName =
    transferOptions.value.find((user) => user.id === transferTarget.value)
      ?.name ?? 'outro vendedor';
  await runCommand(
    'transfer',
    {
      expectedVersion: active.value.version,
      reason: 'Repasse de atendimento na Caixa de Entrada',
      targetUserId: transferTarget.value,
    },
    `Atendimento repassado para ${targetName}.`,
  );
  if (!error.value) transferring.value = false;
}

async function claimHandoff() {
  const conversation = active.value;
  const handoff = conversation?.handoff;
  if (!conversation || handoff?.status !== 'pending' || busy.value) return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(`/api/v1/handoffs/${encodeURIComponent(handoff.id)}/claim`, {
      body: {
        expectedConversationVersion: conversation.version,
        expectedHandoffVersion: handoff.version,
        reasonCode: 'handoff_claimed',
      },
      idempotencyKey: commandKey(),
      method: 'POST',
    });
    actionMessage.value = `Atendimento de ${conversation.contact.label} assumido.`;
    await loadInbox(true);
    await selectConversation(conversation.id);
  } catch (cause) {
    if (/** @type {any} */ (cause)?.status === 409) {
      error.value =
        'Este handoff já foi assumido ou mudou. A Caixa de Entrada foi atualizada.';
      await refreshInbox(true);
    } else {
      error.value = describeError(cause);
    }
  } finally {
    busy.value = false;
  }
}

async function openRename() {
  draftName.value = active.value?.contact.displayName ?? '';
  renaming.value = true;
  await nextTick();
  nameInput.value?.focus();
}

async function saveName() {
  if (!active.value || busy.value) return;
  const contact = active.value.contact;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(`/api/v1/contacts/${encodeURIComponent(contact.id)}/name`, {
      body: {
        displayName: draftName.value.trim(),
        expectedVersion: contact.version,
        reason: 'Nome do contato ajustado na Caixa de Entrada',
      },
      method: 'POST',
    });
    actionMessage.value = 'Nome do contato atualizado.';
    renaming.value = false;
    await loadInbox(true);
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    busy.value = false;
  }
}

function clearSearch() {
  query.value = '';
  void nextTick(() => searchInput.value?.focus());
}

/**
 * Live events arrive in bursts (a takeover bumps the conversation and queues a
 * message). Collapse them into a single silent refresh so the panel never
 * flickers or stampedes the read model.
 */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void refreshInbox(true);
  }, LIVE_REFRESH_DELAY_MS);
}

watch(query, () => void selectVisibleConversation(false));
watch(showArchived, () => void refreshInbox());
watch([stateFilter, queueFilter], () => void refreshInbox());
watch(liveEvent, (event) => {
  if (event) scheduleLiveRefresh();
});
onMounted(() => {
  heading.value?.focus();
  void refreshInbox();
  void loadAssignableUsers();
});
onBeforeUnmount(() => {
  listController?.abort();
  detailController?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Atendimentos</p>
        <h1 ref="heading" tabindex="-1">Caixa de Entrada</h1>
        <p>
          Acompanhe as conversas recebidas pelos canais de atendimento,
          atualizadas em tempo real.
        </p>
      </div>
    </header>

    <div class="filter-bar inbox-filter-bar">
      <div class="search-control">
        <label for="inbox-search">Buscar contato ou mensagem</label>
        <div class="search-field">
          <input
            id="inbox-search"
            ref="searchInput"
            v-model="query"
            type="search"
          />
          <button
            v-if="query"
            type="button"
            aria-label="Limpar busca"
            @click="clearSearch"
          >
            Limpar
          </button>
        </div>
      </div>
      <fieldset class="inbox-queue-switcher">
        <legend>Fila de trabalho</legend>
        <div class="inbox-queue-options">
          <button
            v-for="filter in QUEUE_FILTERS"
            :key="filter.value"
            type="button"
            :aria-label="filter.label"
            :aria-pressed="queueFilter === filter.value"
            @click="queueFilter = filter.value"
          >
            {{ filter.visualLabel }}
          </button>
        </div>
      </fieldset>
      <div class="inbox-toolbar-actions">
        <details ref="stateFilterMenu" class="inbox-state-menu">
          <summary>
            <span>Situação</span>
            <strong>{{ selectedStateLabel }}</strong>
          </summary>
          <div class="inbox-state-panel">
            <div class="inbox-state-options" aria-label="Filtrar por situação">
              <button
                v-for="[value, label] in INBOX_STATES"
                :key="value"
                type="button"
                :aria-pressed="stateFilter === value"
                @click="selectState(value)"
              >
                {{ label }}
              </button>
            </div>
            <div class="inbox-state-utility">
              <button
                type="button"
                :aria-pressed="showArchived"
                @click="toggleArchived"
              >
                {{ showArchived ? 'Ver caixa de entrada' : 'Ver arquivadas' }}
              </button>
            </div>
          </div>
        </details>
        <p class="filter-summary" role="status">
          {{ filtered.length }} exibidas · {{ totalCount }} no total
        </p>
      </div>
    </div>

    <p v-if="error" role="alert" class="audit-note">{{ error }}</p>
    <p v-if="actionMessage" role="status" class="audit-note">
      {{ actionMessage }}
    </p>
    <div v-if="loading" class="loading-state" role="status">
      Carregando conversas…
    </div>
    <div v-else class="inbox">
      <ul class="inbox-list" aria-label="Conversas">
        <li v-for="conversation in filtered" :key="conversation.id">
          <button
            type="button"
            class="conversation-row"
            :aria-current="activeId === conversation.id ? 'true' : undefined"
            @click="selectConversation(conversation.id)"
          >
            <span class="conv-top">
              <span class="conv-name">{{ conversation.contact.label }}</span>
              <span class="conv-time">{{
                dateTimeBR(conversation.updatedAt)
              }}</span>
            </span>
            <span class="conv-snippet">{{
              messageText(conversation.lastMessage)
            }}</span>
            <span class="conv-meta">
              <span class="conv-channel">{{
                CHANNEL_LABELS[conversation.channel]
              }}</span>
              <span
                class="badge"
                :data-tone="conversation.requiresAttention ? 'error' : 'info'"
              >
                {{ conversationLabel(conversation) }}
              </span>
              <span
                v-if="conversation.handoff?.status === 'pending'"
                class="badge"
                data-tone="error"
                >Aguardando vendedor</span
              >
              <span
                v-if="
                  conversation.assignedUser &&
                  conversation.assignedUser.id !== currentUserId
                "
                class="badge"
                data-tone="info"
                >Outro vendedor</span
              >
            </span>
          </button>
        </li>
        <li v-if="!filtered.length" class="empty-list">
          <h2>Nenhuma conversa encontrada</h2>
          <p>Revise a busca informada.</p>
        </li>
      </ul>

      <section
        v-if="active"
        class="surface"
        :aria-labelledby="`conversation-${active.id}`"
      >
        <div class="conv-head">
          <div>
            <p class="section-kicker">{{ CHANNEL_LABELS[active.channel] }}</p>
            <form
              v-if="renaming"
              class="rename-form"
              @submit.prevent="saveName"
            >
              <label :for="`name-${active.id}`">Nome do contato</label>
              <input
                :id="`name-${active.id}`"
                ref="nameInput"
                v-model="draftName"
                type="text"
                maxlength="120"
                placeholder="Sem nome definido"
              />
              <div class="inline-actions">
                <button type="submit" class="primary" :disabled="busy">
                  Salvar nome
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  @click="renaming = false"
                >
                  Cancelar
                </button>
              </div>
            </form>
            <template v-else>
              <h2 :id="`conversation-${active.id}`">
                {{ active.contact.label }}
              </h2>
              <p class="conv-identity">
                {{ formatPhoneNumber(active.contact.externalId) }} ·
                {{ conversationLabel(active) }}
                <template v-if="active.automationState === 'human'">
                  · {{ ownerLabel }}
                </template>
              </p>
              <button type="button" class="link-button" @click="openRename">
                Editar nome
              </button>
            </template>
          </div>
          <div class="conv-actions">
            <button
              v-if="pendingHandoff"
              type="button"
              class="primary"
              :disabled="busy || !canAct"
              @click="claimHandoff"
            >
              Assumir atendimento
            </button>
            <button
              v-else-if="active.automationState === 'assistant'"
              type="button"
              class="primary"
              :disabled="busy || !canAct"
              @click="
                changeAutomation(
                  'takeover',
                  'Atendimento assumido por uma pessoa.',
                )
              "
            >
              Assumir atendimento
            </button>
            <button
              v-else
              type="button"
              :disabled="busy || !canAct"
              @click="
                changeAutomation('return-to-ai', 'Atendimento devolvido à IA.')
              "
            >
              Devolver à IA
            </button>
            <button
              v-if="canTransfer"
              type="button"
              :disabled="busy"
              @click="openTransfer"
            >
              Repassar atendimento
            </button>
            <button
              v-if="canArchive && !showArchived"
              type="button"
              :disabled="busy"
              @click="requestArchiveConfirmation"
            >
              Arquivar conversa
            </button>
            <button
              v-if="canUnarchive && showArchived"
              type="button"
              :disabled="busy"
              @click="unarchiveConversation"
            >
              Desarquivar conversa
            </button>
            <RouterLink
              class="button-link quiet-link"
              :to="`/clientes/${active.contact.id}`"
            >
              Ver contato
            </RouterLink>
          </div>
        </div>

        <p v-if="!canAct && !isTerminal" class="audit-note">
          Esta conversa está sob responsabilidade de outro vendedor. Só quem
          atende ou um administrador pode agir.
        </p>

        <form
          v-if="transferring"
          class="transfer-form"
          @submit.prevent="confirmTransfer"
        >
          <label :for="`transfer-${active.id}`">Repassar venda para</label>
          <select :id="`transfer-${active.id}`" v-model="transferTarget">
            <option
              v-for="user in transferOptions"
              :key="user.id"
              :value="user.id"
            >
              {{ user.name }}
            </option>
          </select>
          <div class="inline-actions">
            <button
              type="submit"
              class="primary"
              :disabled="busy || !transferTarget"
            >
              Confirmar repasse
            </button>
            <button
              type="button"
              :disabled="busy"
              @click="transferring = false"
            >
              Cancelar
            </button>
          </div>
          <p v-if="!transferOptions.length">
            Nenhum outro vendedor disponível para receber a venda.
          </p>
        </form>

        <div v-if="detailLoading" class="loading-state" role="status">
          Carregando histórico…
        </div>
        <ol v-else class="thread" aria-label="Histórico da conversa">
          <li
            v-for="message in detail.messages"
            :key="message.id"
            class="message"
            :data-from="messageFrom(message)"
            :data-side="message.direction === 'outbound' ? 'out' : 'in'"
          >
            <div class="msg-head">
              <span class="msg-sender">
                <span class="message-avatar" aria-hidden="true">{{
                  messageInitials(message)
                }}</span>
                <span>
                  <strong>{{ messageAuthorLabel(message) }}</strong>
                  <span class="msg-role">{{ messageRoleLabel(message) }}</span>
                </span>
              </span>
              <span>{{ dateTimeBR(message.occurredAt) }}</span>
            </div>
            <p>{{ message.preview }}</p>
            <small v-if="deliveryNotice(message)">{{
              deliveryNotice(message)
            }}</small>
          </li>
          <li v-if="!detail.messages.length" class="empty-list">
            Sem mensagens persistidas.
          </li>
        </ol>

        <div v-if="detail.suggestion" class="suggestion">
          <strong>Sugestão pendente da IA</strong>
          <p>{{ detail.suggestion.question }}</p>
        </div>

        <form class="composer" @submit.prevent="sendReply">
          <label for="reply">Responder</label>
          <textarea
            id="reply"
            ref="replyInput"
            v-model="reply"
            rows="3"
            maxlength="2000"
            :disabled="busy || !canReply"
            aria-describedby="reply-help"
          ></textarea>
          <div class="composer-row">
            <p id="reply-help">
              <template v-if="isTerminal">A conversa está encerrada.</template>
              <template v-else-if="!canAct"
                >Somente o vendedor responsável pode responder.</template
              >
              <template v-else-if="pendingHandoff"
                >Assuma o atendimento antes de responder.</template
              >
              <template v-else-if="active.automationState !== 'human'"
                >Assuma o atendimento antes de responder.</template
              >
              <template v-else
                >A mensagem será registrada antes do envio ao canal.</template
              >
            </p>
            <div class="inline-actions">
              <button
                type="submit"
                class="primary"
                :disabled="busy || !canReply || !reply.trim()"
              >
                Enviar resposta
              </button>
            </div>
          </div>
        </form>
      </section>
      <section v-else class="surface empty-list" aria-live="polite">
        <h2>Selecione uma conversa</h2>
        <p>O histórico e as ações aparecerão aqui.</p>
      </section>
    </div>
    <dialog
      ref="archiveConfirmationDialog"
      class="command-dialog"
      aria-labelledby="archive-confirmation-title"
      aria-describedby="archive-confirmation-description"
    >
      <form @submit.prevent="confirmArchive">
        <h2 id="archive-confirmation-title">Arquivar conversa?</h2>
        <p id="archive-confirmation-description">
          A conversa sairá da Caixa de Entrada, mas não será apagada. Se o
          cliente enviar uma nova mensagem, ela voltará a aparecer.
        </p>
        <div class="inline-actions">
          <button type="button" @click="archiveConfirmationDialog?.close()">
            Cancelar
          </button>
          <button type="submit" class="primary" :disabled="busy">
            Arquivar conversa
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
