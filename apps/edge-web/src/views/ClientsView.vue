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
import { request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  conversationLabel,
  dateTimeBR,
} from '../lib/format.js';

const LIVE_REFRESH_DELAY_MS = 250;

const props = defineProps({ selectedId: { type: String, default: '' } });
const liveEvent = inject('liveEvent', ref(null));
const heading = ref(null);
const searchInput = ref(null);
const query = ref('');
const loading = ref(true);
const detailLoading = ref(false);
const error = ref('');
const contacts = ref([]);
const totalCount = ref(0);
const detail = ref(null);
const busy = ref(false);
const renaming = ref(false);
const draftName = ref('');
const actionMessage = ref('');
const nameInput = ref(null);
let listController;
let detailController;
let refreshTimer = 0;

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

/** @param {unknown} value */
function formatPhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/gu, '');
  const national = digits.startsWith('55') ? digits.slice(2) : digits;
  if (national.length === 11) {
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return String(value ?? 'Não informado');
}

/** @param {unknown} cause */
function describeError(cause) {
  const status = Number(/** @type {any} */ (cause)?.status);
  if (status === 403) return 'Sem permissão para renomear este contato.';
  if (status === 409) {
    return 'O contato mudou enquanto você editava. Os dados foram recarregados.';
  }
  if (status === 400) return 'Informe um nome com até 120 caracteres.';
  if (status >= 500) return 'Serviço indisponível no momento.';
  return 'Não foi possível salvar o nome.';
}

/** @param {boolean} [silent] */
async function loadContacts(silent = false) {
  listController?.abort();
  listController = new AbortController();
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const response = await request('/api/v1/contacts?limit=100', {
      signal: listController.signal,
    });
    contacts.value = response.data.items;
    totalCount.value = response.data.totalCount;
    const id = props.selectedId || selected.value?.id || contacts.value[0]?.id;
    if (id) await loadContact(id, silent);
    else detail.value = null;
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = 'Não foi possível carregar os contatos.';
    }
  } finally {
    loading.value = false;
  }
}

/** @param {string} id @param {boolean} [silent] */
async function loadContact(id, silent = false) {
  if (!id) return;
  detailController?.abort();
  detailController = new AbortController();
  if (!silent) {
    detailLoading.value = true;
    error.value = '';
  }
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

async function openRename() {
  draftName.value = selected.value?.displayName ?? '';
  renaming.value = true;
  await nextTick();
  nameInput.value?.focus();
}

async function saveName() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(
      `/api/v1/contacts/${encodeURIComponent(selected.value.id)}/name`,
      {
        body: {
          displayName: draftName.value.trim(),
          expectedVersion: selected.value.version,
          reason: 'Nome do contato ajustado na ficha do cliente',
        },
        method: 'POST',
      },
    );
    actionMessage.value = 'Nome do contato atualizado.';
    renaming.value = false;
    await loadContacts(true);
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    busy.value = false;
  }
}

/** Collapses bursts of live events into one silent refresh. */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void loadContacts(true);
  }, LIVE_REFRESH_DELAY_MS);
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
watch(liveEvent, (event) => {
  if (event) scheduleLiveRefresh();
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
        <p class="eyebrow">Relacionamento</p>
        <h1 ref="heading" tabindex="-1">Clientes</h1>
        <p>
          Contatos canônicos, canais e histórico operacional, atualizados em
          tempo real.
        </p>
      </div>
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
    <p v-if="actionMessage" role="status" class="audit-note">
      {{ actionMessage }}
    </p>
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
                </td>
                <td>
                  {{
                    contact.identities
                      .map((identity) => CHANNEL_LABELS[identity.channel])
                      .join(', ') || 'Sem canal'
                  }}
                </td>
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
          <form v-if="renaming" class="rename-form" @submit.prevent="saveName">
            <label :for="`client-name-${selected.id}`">Nome do contato</label>
            <input
              :id="`client-name-${selected.id}`"
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
              <button type="button" :disabled="busy" @click="renaming = false">
                Cancelar
              </button>
            </div>
          </form>
          <template v-else>
            <div class="client-title-row">
              <h2 :id="`client-${selected.id}`">{{ selected.label }}</h2>
              <button type="button" class="link-button" @click="openRename">
                Editar nome
              </button>
            </div>
          </template>
        </div>
        <div v-if="detailLoading" class="loading-state" role="status">
          Carregando histórico…
        </div>
        <template v-else>
          <dl class="client-facts client-facts--single">
            <div>
              <dt>Cadastrado em</dt>
              <dd>{{ dateTimeBR(selected.createdAt) }}</dd>
            </div>
          </dl>

          <div class="panel-head subsection-heading">
            <h3>Canais de contato</h3>
          </div>
          <ul class="history-list contact-channels">
            <li v-for="identity in detail.identities" :key="identity.id">
              <template v-if="identity.kind !== 'phone'">
                <strong>{{
                  CHANNEL_LABELS[identity.channel] ?? identity.channel
                }}</strong>
                <span>{{ identity.displayHandle ?? identity.externalId }}</span>
              </template>
              <label
                v-if="identity.kind === 'phone'"
                class="contact-phone"
                :for="`contact-phone-${identity.id}`"
              >
                <span>Telefone</span>
                <input
                  :id="`contact-phone-${identity.id}`"
                  type="tel"
                  readonly
                  :value="formatPhoneNumber(identity.externalId)"
                />
              </label>
            </li>
          </ul>

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
                conversationLabel(conversation)
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
        <p>Identidades e conversas aparecerão aqui.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.client-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}

.client-title-row .link-button {
  flex: none;
}

.client-facts--single {
  grid-template-columns: minmax(0, 1fr);
}

.contact-phone {
  display: grid;
  gap: 0.25rem;
  margin-block-start: 0.35rem;
}

.contact-phone > span {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.contact-phone input {
  max-inline-size: 18rem;
}

.contact-channels li {
  padding-inline-start: 0;
  border-inline-start: 0;
}
</style>
