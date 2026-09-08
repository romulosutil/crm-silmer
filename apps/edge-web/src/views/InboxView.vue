<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import DemoNotice from '../components/DemoNotice.vue';
import { conversas } from '../data/demo-crm.js';

const STATES = [
  'Todas',
  'Nova',
  'Em análise',
  'Em atendimento',
  'Requer atenção',
  'Convertida em lead',
  'Encerrada sem lead',
];
const heading = ref(null);
const activeId = ref('k1');
const query = ref('');
const state = ref('Todas');
const filtered = computed(() => {
  const needle = query.value.toLocaleLowerCase('pt-BR');
  return conversas.filter(
    (conversation) =>
      (state.value === 'Todas' || conversation.estado === state.value) &&
      (!needle ||
        `${conversation.nome} ${conversation.empresa ?? ''} ${conversation.resumo}`
          .toLocaleLowerCase('pt-BR')
          .includes(needle)),
  );
});
const activeConversation = computed(
  () =>
    filtered.value.find((conversation) => conversation.id === activeId.value) ??
    filtered.value[0] ??
    null,
);
const isConvertible = computed(
  () =>
    activeConversation.value &&
    !['Convertida em lead', 'Encerrada sem lead'].includes(
      activeConversation.value.estado,
    ),
);

function selectConversation(id) {
  activeId.value = id;
}

function clearFilters() {
  state.value = 'Todas';
  query.value = '';
  void nextTick(() => document.querySelector('#inbox-search')?.focus());
}

function clearSearch() {
  query.value = '';
  void nextTick(() => document.querySelector('#inbox-search')?.focus());
}

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Backlog de conversas</p>
        <h1 ref="heading" tabindex="-1">Caixa de Entrada</h1>
        <p>
          Toda conversa recebida entra aqui. Ela só vira negócio quando existe
          intenção comercial reconhecida.
        </p>
      </div>
      <button type="button" disabled>Abrir fila de reconciliação</button>
    </header>

    <DemoNotice />

    <div class="filter-bar">
      <div class="search-control">
        <label for="inbox-search">Buscar conversa</label>
        <div class="search-field">
          <input id="inbox-search" v-model="query" type="search" />
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
      <div class="chip-row" aria-label="Filtrar por estado">
        <button
          v-for="option in STATES"
          :key="option"
          type="button"
          class="chip"
          :aria-pressed="state === option"
          @click="state = option"
        >
          {{ option }}
        </button>
      </div>
    </div>

    <div class="inbox">
      <ul class="inbox-list" aria-label="Conversas">
        <template v-if="filtered.length">
          <li v-for="conversation in filtered" :key="conversation.id">
            <button
              type="button"
              class="conversation-row"
              :aria-current="
                activeConversation?.id === conversation.id ? 'true' : undefined
              "
              @click="selectConversation(conversation.id)"
            >
              <span class="conv-top">
                <span class="conv-name">
                  {{ conversation.empresa || conversation.nome }}
                </span>
                <span class="conv-time">{{ conversation.hora }}</span>
              </span>
              <span class="conv-snippet">{{ conversation.resumo }}</span>
              <span class="conv-meta">
                <span class="conv-channel">{{ conversation.canal }}</span>
                <span class="badge" :data-tone="conversation.tom">
                  {{ conversation.estado }}
                </span>
                <span
                  v-if="conversation.naoLidas"
                  class="badge"
                  data-tone="error"
                >
                  {{ conversation.naoLidas }} não lida(s)
                </span>
              </span>
            </button>
          </li>
        </template>
        <li v-else class="empty-list">
          <h2>Nenhuma conversa neste filtro</h2>
          <p>Ajuste o estado ou limpe a busca para ver o backlog completo.</p>
          <button type="button" @click="clearFilters">Limpar filtros</button>
        </li>
      </ul>

      <section
        v-if="activeConversation"
        class="surface"
        :aria-labelledby="`conversation-${activeConversation.id}`"
      >
        <div class="conv-head">
          <div>
            <h2 :id="`conversation-${activeConversation.id}`">
              {{ activeConversation.empresa || activeConversation.nome }}
            </h2>
            <p class="conv-identity">
              {{ activeConversation.nome }} · {{ activeConversation.canal }} ·
              {{ activeConversation.identificador }}
            </p>
            <dl>
              <div>
                <dt>Estado</dt>
                <dd>{{ activeConversation.estado }}</dd>
              </div>
              <div>
                <dt>Responsável</dt>
                <dd>{{ activeConversation.responsavel }}</dd>
              </div>
              <div>
                <dt>Negócio</dt>
                <dd>{{ activeConversation.negocio || 'Nenhum' }}</dd>
              </div>
            </dl>
          </div>
          <div class="conv-actions">
            <button v-if="isConvertible" type="button" disabled class="primary">
              Transformar em lead
            </button>
            <RouterLink v-else class="button-link" to="/kanban">
              Abrir negócio no Kanban
            </RouterLink>
            <button type="button" disabled>Assumir atendimento</button>
            <RouterLink
              v-if="activeConversation.clienteId"
              class="button-link quiet-link"
              :to="`/clientes/${activeConversation.clienteId}`"
            >
              Ver cliente
            </RouterLink>
            <button v-if="isConvertible" type="button" disabled>
              Encerrar sem lead
            </button>
          </div>
        </div>

        <ol class="thread" aria-label="Histórico da conversa">
          <li
            v-for="(message, index) in activeConversation.mensagens"
            :key="`${activeConversation.id}-${index}`"
            class="message"
            :data-from="message.de"
          >
            <div class="msg-head">
              <span>
                {{ message.autor }}
                <template v-if="message.de === 'agente'"> · IA</template>
                <template v-else-if="message.de === 'humano'">
                  · Silmer</template
                >
              </span>
              <span>{{ message.hora }}</span>
            </div>
            <p>{{ message.texto }}</p>
          </li>
        </ol>

        <div v-if="activeConversation.sugestao" class="suggestion">
          <strong>
            Sugestão do Vendedor Silmer · aguardando confirmação humana
          </strong>
          <p>
            {{ activeConversation.sugestao.titulo }}:
            {{ activeConversation.sugestao.motivo }}
          </p>
          <div class="inline-actions">
            <button type="button" disabled class="primary">
              {{ activeConversation.sugestao.acao }}
            </button>
            <button type="button" disabled>Descartar sugestão</button>
          </div>
        </div>

        <p class="audit-note">{{ activeConversation.nota }}</p>

        <form class="composer" @submit.prevent>
          <label for="response">
            Responder como
            {{
              activeConversation.responsavel === 'Não atribuído'
                ? 'Ana Duarte'
                : activeConversation.responsavel
            }}
          </label>
          <textarea
            id="response"
            disabled
            placeholder="O envio será habilitado com a API da Inbox"
          ></textarea>
          <div class="composer-row">
            <p>O envio pausa o Vendedor Silmer e registra a tomada humana.</p>
            <div class="inline-actions">
              <button type="button" disabled>Anexar arquivo</button>
              <button type="submit" disabled class="primary">
                Enviar resposta
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
