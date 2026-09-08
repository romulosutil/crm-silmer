<script setup>
import {
  computed,
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

const heading = ref(null);
const searchInput = ref(null);
const replyInput = ref(null);
const query = ref('');
const state = ref('');
const channel = ref('');
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
let listController;
let detailController;

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

function listUrl() {
  const params = new URLSearchParams({ limit: '100' });
  if (state.value) params.set('state', state.value);
  if (channel.value) params.set('channel', channel.value);
  return `/api/v1/inbox/conversations?${params}`;
}

async function loadInbox() {
  listController?.abort();
  listController = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const response = await request(listUrl(), {
      signal: listController.signal,
    });
    conversations.value = response.data.items;
    totalCount.value = response.data.totalCount;
    const nextId = conversations.value.some(
      (item) => item.id === activeId.value,
    )
      ? activeId.value
      : (conversations.value[0]?.id ?? '');
    if (nextId) await selectConversation(nextId);
    else {
      activeId.value = '';
      detail.value = null;
    }
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar a Caixa de Entrada.';
    }
  } finally {
    loading.value = false;
  }
}

async function selectConversation(id) {
  if (!id) return;
  detailController?.abort();
  detailController = new AbortController();
  if (activeId.value !== id) detail.value = null;
  activeId.value = id;
  detailLoading.value = true;
  try {
    const response = await request(
      `/api/v1/inbox/conversations/${encodeURIComponent(id)}`,
      { signal: detailController.signal },
    );
    detail.value = response.data;
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar a conversa selecionada.';
      detail.value = null;
    }
  } finally {
    detailLoading.value = false;
  }
}

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
    await loadInbox();
  } catch (cause) {
    error.value =
      'A ação não foi concluída. Atualize a conversa e tente novamente.';
    if (/** @type {any} */ (cause)?.status === 409) await loadInbox();
  } finally {
    busy.value = false;
  }
}

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

function clearSearch() {
  query.value = '';
  void nextTick(() => searchInput.value?.focus());
}

watch([state, channel], () => void loadInbox());
onMounted(() => {
  heading.value?.focus();
  void loadInbox();
});
onBeforeUnmount(() => {
  listController?.abort();
  detailController?.abort();
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Backlog de conversas</p>
        <h1 ref="heading" tabindex="-1">Caixa de Entrada</h1>
        <p>
          Conversas persistidas dos canais oficiais, com controle humano da IA.
        </p>
      </div>
      <button type="button" :disabled="loading" @click="loadInbox">
        Atualizar
      </button>
    </header>

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
      <label>
        Estado
        <select v-model="state">
          <option value="">Todos</option>
          <option
            v-for="(label, value) in CONVERSATION_LABELS"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select>
      </label>
      <label>
        Canal
        <select v-model="channel">
          <option value="">Todos</option>
          <option
            v-for="(label, value) in CHANNEL_LABELS"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select>
      </label>
      <p class="filter-summary">
        {{ filtered.length }} exibidas · {{ totalCount }} no filtro
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
            </span>
          </button>
        </li>
        <li v-if="!filtered.length" class="empty-list">
          <h2>Nenhuma conversa encontrada</h2>
          <p>Revise a busca ou os filtros selecionados.</p>
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
            <h2 :id="`conversation-${active.id}`">
              {{ active.contact.label }}
            </h2>
            <p class="conv-identity">
              {{ active.contact.externalId }} ·
              {{ CONVERSATION_LABELS[active.state] ?? active.state }}
            </p>
          </div>
          <div class="conv-actions">
            <button
              v-if="active.automationState === 'assistant'"
              type="button"
              class="primary"
              :disabled="busy || isTerminal"
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
              :disabled="busy || isTerminal"
              @click="
                changeAutomation('return-to-ai', 'Atendimento devolvido à IA.')
              "
            >
              Devolver à IA
            </button>
            <RouterLink
              v-if="active.deal"
              class="button-link quiet-link"
              :to="`/negocios/${active.deal.id}`"
            >
              Abrir negócio
            </RouterLink>
            <RouterLink
              class="button-link quiet-link"
              :to="`/clientes/${active.contact.id}`"
            >
              Ver contato
            </RouterLink>
          </div>
        </div>

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
            :disabled="busy || isTerminal || active.automationState !== 'human'"
            :aria-describedby="
              active.automationState !== 'human' ? 'reply-help' : undefined
            "
          ></textarea>
          <div class="composer-row">
            <p id="reply-help">
              <template v-if="isTerminal">A conversa está encerrada.</template>
              <template v-else-if="active.automationState !== 'human'"
                >Assuma o atendimento antes de responder.</template
              >
              <template v-else
                >A mensagem será registrada antes do envio ao canal.</template
              >
            </p>
            <div class="inline-actions">
              <button
                v-if="!isTerminal"
                type="button"
                :disabled="busy"
                @click="
                  changeAutomation('close', 'Conversa encerrada sem negócio.')
                "
              >
                Encerrar sem negócio
              </button>
              <button
                type="submit"
                class="primary"
                :disabled="
                  busy ||
                  isTerminal ||
                  active.automationState !== 'human' ||
                  !reply.trim()
                "
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
