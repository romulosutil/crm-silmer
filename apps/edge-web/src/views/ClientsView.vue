<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  CONVERSATION_LABELS,
  STAGE_LABELS,
  dateTimeBR,
} from '../lib/format.js';

const props = defineProps({ selectedId: { type: String, default: '' } });
const heading = ref(null);
const searchInput = ref(null);
const query = ref('');
const loading = ref(true);
const detailLoading = ref(false);
const error = ref('');
const contacts = ref([]);
const totalCount = ref(0);
const detail = ref(null);
let listController;
let detailController;

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('pt-BR');
  if (!needle) return contacts.value;
  return contacts.value.filter((contact) =>
    `${contact.label} ${contact.identities.map((identity) => identity.externalId).join(' ')}`
      .toLocaleLowerCase('pt-BR')
      .includes(needle),
  );
});
const selected = computed(() => detail.value?.contact ?? null);

async function loadContacts() {
  listController?.abort();
  listController = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const response = await request('/api/v1/contacts?limit=100', {
      signal: listController.signal,
    });
    contacts.value = response.data.items;
    totalCount.value = response.data.totalCount;
    const id = props.selectedId || contacts.value[0]?.id;
    if (id) await loadContact(id);
    else detail.value = null;
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os contatos.';
    }
  } finally {
    loading.value = false;
  }
}

async function loadContact(id) {
  if (!id) return;
  detailController?.abort();
  detailController = new AbortController();
  detailLoading.value = true;
  error.value = '';
  try {
    const response = await request(
      `/api/v1/contacts/${encodeURIComponent(id)}`,
      {
        signal: detailController.signal,
      },
    );
    detail.value = response.data;
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar o contato selecionado.';
      detail.value = null;
    }
  } finally {
    detailLoading.value = false;
  }
}

function clearSearch() {
  query.value = '';
  void nextTick(() => searchInput.value?.focus());
}

watch(
  () => props.selectedId,
  (id) => {
    if (id && id !== selected.value?.id) void loadContact(id);
  },
);
onMounted(() => {
  heading.value?.focus();
  void loadContacts();
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
        <p class="eyebrow">Relacionamento</p>
        <h1 ref="heading" tabindex="-1">Clientes</h1>
        <p>
          Contatos canônicos, identidades por canal e histórico operacional
          persistido.
        </p>
      </div>
      <button type="button" :disabled="loading" @click="loadContacts">
        Atualizar
      </button>
    </header>

    <div class="filter-bar">
      <div class="search-control">
        <label for="client-search">Buscar contato ou identificador</label>
        <div class="search-field">
          <input
            id="client-search"
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
        {{ filtered.length }} exibidos · {{ totalCount }} contatos
      </p>
    </div>

    <p v-if="error" role="alert" class="audit-note">{{ error }}</p>
    <div v-if="loading" class="loading-state" role="status">
      Carregando contatos…
    </div>
    <div v-else class="clients-layout">
      <section class="surface" aria-labelledby="portfolio-title">
        <div class="panel-head">
          <h2 id="portfolio-title">Contatos</h2>
          <p>Ordenados pela atualização cadastral</p>
        </div>
        <div v-if="filtered.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Contato</th>
                <th scope="col">Canais</th>
                <th scope="col" class="num">Negócios ativos</th>
                <th scope="col">Situação</th>
                <th scope="col">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="contact in filtered"
                :key="contact.id"
                :data-selected="selected?.id === contact.id"
              >
                <td>
                  <RouterLink class="row-link" :to="`/clientes/${contact.id}`">
                    {{ contact.label }}
                  </RouterLink>
                  <span class="table-detail">{{ contact.id }}</span>
                </td>
                <td>
                  {{
                    contact.identities
                      .map((identity) => CHANNEL_LABELS[identity.channel])
                      .join(', ') || 'Sem canal'
                  }}
                </td>
                <td class="num">{{ contact.activeDealCount }}</td>
                <td>{{ contact.provisional ? 'Provisório' : 'Canônico' }}</td>
                <td>{{ dateTimeBR(contact.latestActivityAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-list">
          <h3>Nenhum contato encontrado</h3>
          <p>Revise a busca informada.</p>
        </div>
      </section>

      <section
        v-if="selected"
        class="surface"
        :aria-labelledby="`client-${selected.id}`"
      >
        <div class="client-head">
          <p class="section-kicker">Ficha do contato</p>
          <h2 :id="`client-${selected.id}`">{{ selected.label }}</h2>
          <p>
            {{
              selected.provisional ? 'Cadastro provisório' : 'Cadastro canônico'
            }}
          </p>
        </div>
        <div v-if="detailLoading" class="loading-state" role="status">
          Carregando histórico…
        </div>
        <template v-else>
          <dl class="client-facts">
            <div>
              <dt>Identidades</dt>
              <dd>{{ detail.identities.length }}</dd>
            </div>
            <div>
              <dt>Negócios ativos</dt>
              <dd>{{ detail.activeDealCount }}</dd>
            </div>
            <div>
              <dt>Conversas</dt>
              <dd>{{ detail.conversations.length }}</dd>
            </div>
            <div>
              <dt>Cadastrado em</dt>
              <dd>{{ dateTimeBR(selected.createdAt) }}</dd>
            </div>
          </dl>

          <div class="panel-head subsection-heading">
            <h3>Identidades por canal</h3>
          </div>
          <ul class="history-list">
            <li v-for="identity in detail.identities" :key="identity.id">
              <strong>{{
                CHANNEL_LABELS[identity.channel] ?? identity.channel
              }}</strong>
              <span>{{ identity.displayHandle ?? identity.externalId }}</span>
              <small v-if="identity.phoneStatus"
                >Telefone: {{ identity.phoneStatus }}</small
              >
            </li>
          </ul>

          <div class="panel-head subsection-heading">
            <h3>Negócios</h3>
            <p>{{ detail.activeDealCount }} ativo(s)</p>
          </div>
          <ul v-if="detail.deals.length" class="history-list">
            <li v-for="deal in detail.deals" :key="deal.id">
              <RouterLink :to="`/negocios/${deal.id}`"
                >Negócio {{ deal.id }}</RouterLink
              >
              <span
                >{{ STAGE_LABELS[deal.stage] ?? deal.stage }} ·
                {{ deal.status }}</span
              >
              <small>Atualizado em {{ dateTimeBR(deal.updatedAt) }}</small>
            </li>
          </ul>
          <p v-else class="empty-list">Nenhum negócio associado.</p>

          <div class="panel-head subsection-heading">
            <h3>Conversas</h3>
          </div>
          <ul v-if="detail.conversations.length" class="history-list">
            <li
              v-for="conversation in detail.conversations"
              :key="conversation.id"
            >
              <RouterLink to="/inbox">{{
                CHANNEL_LABELS[conversation.channel]
              }}</RouterLink>
              <span>{{
                CONVERSATION_LABELS[conversation.state] ?? conversation.state
              }}</span>
              <small
                >Última mensagem em
                {{ dateTimeBR(conversation.lastMessageAt) }}</small
              >
            </li>
          </ul>
          <p v-else class="empty-list">Nenhuma conversa associada.</p>
        </template>
      </section>
      <section v-else class="surface empty-list" aria-live="polite">
        <h2>Selecione um contato</h2>
        <p>Identidades, negócios e conversas aparecerão aqui.</p>
      </section>
    </div>
  </div>
</template>
