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
  CONVERSATION_LABELS,
  dateTimeBR,
  messageText,
} from '../lib/format.js';

const ADMIN_CAPABILITY = 'COMMERCIAL_ADMIN';
const LIVE_REFRESH_DELAY_MS = 250;

const liveEvent = inject('liveEvent', ref(null));
const sessionUser = inject(
  'sessionUser',
  computed(() => ({})),
);

const heading = ref(null);
const searchInput = ref(null);
const replyInput = ref(null);
const nameInput = ref(null);
const query = ref('');
const loading = ref(true);
const detailLoading = ref(false);
const busy = ref(false);
const error = ref('');
const actionMessage = ref('');
const conversations = ref([]);
const handoffs = ref([]);
const handoffLoading = ref(true);
const claimingHandoffId = ref('');
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
let handoffController;
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
  () => canAct.value && active.value?.automationState === 'human',
);

function listUrl() {
  return '/api/v1/inbox/conversations?limit=100';
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
async function loadOpenHandoffs(silent = false) {
  handoffController?.abort();
  handoffController = new AbortController();
  if (!silent) handoffLoading.value = true;
  try {
    const response = await request('/api/v1/inbox/handoffs?limit=100', {
      signal: handoffController.signal,
    });
    handoffs.value = response.data.items ?? [];
  } catch (cause) {
    if (/** @type {any} */ (cause)?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os handoffs pendentes.';
    }
  } finally {
    handoffLoading.value = false;
  }
}

/** @param {boolean} [silent] */
async function refreshInbox(silent = false) {
  await Promise.all([loadInbox(silent), loadOpenHandoffs(silent)]);
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
  } catch (cause) {
    error.value = describeError(cause);
    if (/** @type {any} */ (cause)?.status === 409) await loadInbox(true);
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

/** @param {any} handoff */
async function claimHandoff(handoff) {
  if (busy.value || claimingHandoffId.value) return;
  busy.value = true;
  claimingHandoffId.value = handoff.id;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(`/api/v1/handoffs/${encodeURIComponent(handoff.id)}/claim`, {
      body: {
        expectedConversationVersion: handoff.conversationVersion,
        expectedHandoffVersion: handoff.version,
        reasonCode: 'handoff_claimed',
      },
      idempotencyKey: commandKey(),
      method: 'POST',
    });
    actionMessage.value = `Handoff de ${handoff.contact.label} assumido.`;
    await refreshInbox(true);
    await selectConversation(handoff.conversationId);
  } catch (cause) {
    if (/** @type {any} */ (cause)?.status === 409) {
      error.value =
        'Este handoff já foi assumido ou mudou. A Caixa de Entrada foi atualizada.';
      await refreshInbox(true);
    } else {
      error.value = describeError(cause);
    }
  } finally {
    claimingHandoffId.value = '';
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
  handoffController?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Backlog de conversas</p>
        <h1 ref="heading" tabindex="-1">Caixa de Entrada</h1>
        <p>
          Conversas persistidas dos canais oficiais, atualizadas em tempo real.
        </p>
      </div>
    </header>

    <section class="handoff-section" aria-labelledby="handoffs-title">
      <div class="handoff-head">
        <div>
          <p class="section-kicker">Atendimento humano</p>
          <h2 id="handoffs-title">Handoffs pendentes</h2>
          <p>Solicitações que aguardam um vendedor assumir a conversa.</p>
        </div>
        <p class="count" :aria-label="`${handoffs.length} handoffs pendentes`">
          {{ handoffs.length }}
        </p>
      </div>
      <p v-if="handoffLoading" class="loading-state" role="status">
        Carregando handoffs…
      </p>
      <p v-else-if="!handoffs.length" class="handoff-empty">
        Nenhum handoff pendente.
      </p>
      <ul v-else class="handoff-list" aria-label="Handoffs pendentes">
        <li v-for="handoff in handoffs" :key="handoff.id" class="surface">
          <div class="handoff-head">
            <div>
              <h3>{{ handoff.contact.label }}</h3>
              <p>{{ handoff.contact.externalId }} · {{ handoff.targetRole }}</p>
            </div>
            <span class="badge" data-tone="error">Pendente</span>
          </div>
          <dl class="card-facts">
            <div>
              <dt>Motivo</dt>
              <dd>{{ handoff.reasonCode }}</dd>
            </div>
            <div>
              <dt>Recebido</dt>
              <dd>{{ dateTimeBR(handoff.createdAt) }}</dd>
            </div>
            <div>
              <dt>Prazo</dt>
              <dd>{{ dateTimeBR(handoff.dueAt) }}</dd>
            </div>
          </dl>
          <p class="handoff-summary">{{ handoff.summary }}</p>
          <div class="inline-actions">
            <button
              type="button"
              class="primary"
              :disabled="busy || Boolean(claimingHandoffId)"
              @click="claimHandoff(handoff)"
            >
              {{
                claimingHandoffId === handoff.id
                  ? 'Assumindo…'
                  : 'Assumir atendimento'
              }}
            </button>
            <button
              type="button"
              :disabled="busy"
              @click="selectConversation(handoff.conversationId)"
            >
              Abrir conversa
            </button>
          </div>
        </li>
      </ul>
    </section>

    <div class="filter-bar">
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
      <p class="filter-summary">
        {{ filtered.length }} exibidas · {{ totalCount }} no total
      </p>
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
                {{
                  CONVERSATION_LABELS[conversation.state] ?? conversation.state
                }}
              </span>
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
                {{ active.contact.externalId }} ·
                {{ CONVERSATION_LABELS[active.state] ?? active.state }} ·
                {{ ownerLabel }}
              </p>
              <button type="button" class="link-button" @click="openRename">
                Editar nome
              </button>
            </template>
          </div>
          <div class="conv-actions">
            <button
              v-if="active.automationState === 'assistant'"
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
              type="button"
              :disabled="busy || !canAct"
              @click="openTransfer"
            >
              Repassar atendimento
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
            :data-side="message.direction === 'outbound' ? 'out' : 'in'"
          >
            <div class="msg-head">
              <strong>{{
                message.direction === 'outbound'
                  ? 'Silmer'
                  : active.contact.label
              }}</strong>
              <span>{{ dateTimeBR(message.occurredAt) }}</span>
            </div>
            <p>{{ message.preview }}</p>
            <small v-if="message.deliveryStatus"
              >Entrega: {{ message.deliveryStatus }}</small
            >
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
  </div>
</template>
