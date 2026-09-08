<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import DemoNotice from '../components/DemoNotice.vue';
import { brl, brlExato, clientes, dataBR } from '../data/demo-crm.js';

const props = defineProps({ selectedId: { type: String, default: '' } });
const heading = ref(null);
const profile = ref('Todos');
const query = ref('');
const filtered = computed(() => {
  const needle = query.value.toLocaleLowerCase('pt-BR');
  return clientes.filter(
    (client) =>
      (profile.value === 'Todos' || client.perfil === profile.value) &&
      (!needle ||
        `${client.nome} ${client.contato} ${client.identificador}`
          .toLocaleLowerCase('pt-BR')
          .includes(needle)),
  );
});
const selected = computed(
  () =>
    clientes.find((client) => client.id === props.selectedId) ??
    filtered.value[0] ??
    null,
);
const portfolio = clientes.reduce((sum, client) => sum + client.total, 0);

function clearFilters() {
  profile.value = 'Todos';
  query.value = '';
  void nextTick(() => document.querySelector('#client-search')?.focus());
}

function clearSearch() {
  query.value = '';
  void nextTick(() => document.querySelector('#client-search')?.focus());
}

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Relacionamento</p>
        <h1 ref="heading" tabindex="-1">Clientes</h1>
        <p>
          Contatos recorrentes mantêm um cadastro e vários negócios, sem perder
          o histórico de pedidos e conversas.
        </p>
      </div>
      <button type="button" disabled>Exportar carteira</button>
    </header>

    <DemoNotice />

    <div class="filter-bar">
      <div class="search-control">
        <label for="client-search">Buscar cliente, contato ou telefone</label>
        <div class="search-field">
          <input id="client-search" v-model="query" type="search" />
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
      <span class="filter-label">Perfil de compra</span>
      <div class="chip-row">
        <button
          v-for="option in ['Todos', 'Uso próprio', 'Revenda / atacado']"
          :key="option"
          type="button"
          class="chip"
          :aria-pressed="profile === option"
          @click="profile = option"
        >
          {{ option }}
        </button>
      </div>
      <p class="filter-summary">
        {{ filtered.length }} de {{ clientes.length }} clientes ·
        {{ brl(portfolio) }} em pedidos concluídos
      </p>
    </div>

    <div class="clients-layout">
      <section class="surface" aria-labelledby="portfolio-title">
        <div class="panel-head">
          <h2 id="portfolio-title">Carteira</h2>
          <p>Ordenada pelo último pedido</p>
        </div>
        <div v-if="filtered.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Canal</th>
                <th scope="col">Responsável</th>
                <th scope="col" class="num">Pedidos</th>
                <th scope="col" class="num">Total</th>
                <th scope="col">Último</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="client in filtered"
                :key="client.id"
                :data-selected="selected?.id === client.id"
              >
                <td>
                  <RouterLink class="row-link" :to="`/clientes/${client.id}`">
                    {{ client.nome }}
                  </RouterLink>
                  <span class="table-detail">
                    {{ client.contato }} · {{ client.cidade }}
                  </span>
                </td>
                <td>{{ client.canal }}</td>
                <td>{{ client.responsavel }}</td>
                <td class="num">{{ client.pedidos }}</td>
                <td class="num">{{ brl(client.total) }}</td>
                <td>{{ dataBR(client.ultimo) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-list">
          <h3>Nenhum cliente encontrado</h3>
          <p>Revise a busca ou volte ao filtro de todos os perfis.</p>
          <button type="button" @click="clearFilters">Limpar filtros</button>
        </div>
      </section>

      <section
        v-if="selected"
        class="surface"
        :aria-labelledby="`client-${selected.id}`"
      >
        <div class="client-head">
          <p class="section-kicker">Ficha do cliente</p>
          <h2 :id="`client-${selected.id}`">{{ selected.nome }}</h2>
          <p>
            {{ selected.contato }} · {{ selected.canal }} ·
            {{ selected.identificador }}
          </p>
        </div>
        <dl class="client-facts">
          <div>
            <dt>Cidade</dt>
            <dd>{{ selected.cidade }}</dd>
          </div>
          <div>
            <dt>Perfil de compra</dt>
            <dd>{{ selected.perfil }}</dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>{{ selected.responsavel }}</dd>
          </div>
          <div>
            <dt>Cliente desde</dt>
            <dd>{{ selected.desde }}</dd>
          </div>
          <div>
            <dt>Pedidos concluídos</dt>
            <dd>{{ selected.pedidos }}</dd>
          </div>
          <div>
            <dt>Total comprado</dt>
            <dd>{{ brlExato(selected.total) }}</dd>
          </div>
        </dl>
        <div class="inline-actions client-actions">
          <button type="button" disabled class="primary">Abrir conversa</button>
          <button type="button" disabled>Criar novo negócio</button>
        </div>
        <div class="panel-head">
          <h3>Histórico</h3>
          <p>
            <span v-if="selected.abertos" class="badge" data-tone="info">
              {{ selected.abertos }} negócio(s) em aberto
            </span>
            <span v-else class="badge">Sem negócio em aberto</span>
          </p>
        </div>
        <ul class="history-list">
          <li
            v-for="(entry, index) in selected.historico"
            :key="`${selected.id}-${index}`"
            :data-kind="entry.tipo"
          >
            <span>{{ entry.quando }}</span>
            <strong>{{ entry.titulo }}</strong>
            <p>{{ entry.detalhe }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
