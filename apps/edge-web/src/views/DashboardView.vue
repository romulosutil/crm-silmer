<script setup>
import { computed, onMounted, ref } from 'vue';
import DemoNotice from '../components/DemoNotice.vue';
import {
  STAGES,
  brl,
  brlExato,
  canais,
  canaisSaude,
  dataBR,
  deals,
  dias,
  pendencias,
  perdidos,
  porVendedor,
  totalVendido,
  vendas,
} from '../data/demo-crm.js';

const heading = ref(null);
const periodo = ref('30 dias');
const maxDia = Math.max(...dias.map((day) => day.valor));
const maxCanal = Math.max(...canais.map((channel) => channel.conversas));
const maxEtapa = Math.max(
  ...STAGES.map(([key]) => deals.filter((deal) => deal.stage === key).length),
);
const ticket = totalVendido / vendas.length;
const leads = canais.reduce((sum, channel) => sum + channel.leads, 0);
const conversationCount = canais.reduce(
  (sum, channel) => sum + channel.conversas,
  0,
);
const lostTotal = perdidos.reduce((sum, deal) => sum + deal.valor, 0);
const conversion = Math.round((leads / conversationCount) * 100);
const periodDescription = computed(
  () =>
    `Valor vendido, oportunidades em aberto e pendências operacionais dos últimos ${periodo.value}.`,
);

function stageSummary(key) {
  const stageDeals = deals.filter((deal) => deal.stage === key);
  return {
    blockers: stageDeals.reduce((sum, deal) => sum + deal.blockerCount, 0),
    count: stageDeals.length,
  };
}

onMounted(() => heading.value?.focus());
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Visão comercial</p>
        <h1 ref="heading" tabindex="-1">Dashboard</h1>
        <p>{{ periodDescription }}</p>
      </div>
      <button type="button" disabled title="A exportação aguarda a API">
        Exportar período
      </button>
    </header>

    <DemoNotice />

    <div class="filter-bar" aria-label="Filtros do Dashboard">
      <span class="filter-label">Período</span>
      <div class="chip-row">
        <button
          v-for="option in ['7 dias', '30 dias', '90 dias']"
          :key="option"
          type="button"
          class="chip"
          :aria-pressed="periodo === option"
          @click="periodo = option"
        >
          {{ option }}
        </button>
      </div>
      <span class="filter-label filter-label-spaced">Vendedor</span>
      <div class="chip-row" aria-label="Vendedor selecionado">
        <span class="chip chip-static">Todos</span>
      </div>
    </div>

    <dl class="kpi-grid">
      <div class="kpi kpi--accent">
        <dt>Valor vendido</dt>
        <dd class="kpi-value">{{ brl(totalVendido) }}</dd>
        <dd class="kpi-meta">
          {{ periodo }} · uma venda entra uma única vez, em aprovado aguardando
          PIX
        </dd>
      </div>
      <div class="kpi">
        <dt>Vendas fechadas</dt>
        <dd class="kpi-value">{{ vendas.length }}</dd>
        <dd class="kpi-meta">Pedidos de 01-CRM a 12-CRM</dd>
      </div>
      <div class="kpi">
        <dt>Ticket médio</dt>
        <dd class="kpi-value">{{ brlExato(ticket) }}</dd>
        <dd class="kpi-meta">Valor vendido dividido pela quantidade</dd>
      </div>
      <div class="kpi">
        <dt>Leads criados</dt>
        <dd class="kpi-value">{{ leads }}</dd>
        <dd class="kpi-meta">
          {{ conversationCount }} conversas · {{ conversion }}% viraram negócio
        </dd>
      </div>
      <div class="kpi">
        <dt>Negócios em aberto</dt>
        <dd class="kpi-value">{{ deals.length }}</dd>
        <dd class="kpi-meta">Distribuídos nas 5 etapas do Kanban</dd>
      </div>
      <div class="kpi">
        <dt>Perdidos no período</dt>
        <dd class="kpi-value">{{ perdidos.length }}</dd>
        <dd class="kpi-meta">
          {{ brl(lostTotal) }} em valor proposto · todos com motivo
        </dd>
      </div>
    </dl>

    <div class="dash-grid section-gap">
      <section class="surface" aria-labelledby="sales-chart-title">
        <div class="panel-head">
          <h2 id="sales-chart-title">Valor vendido por dia</h2>
          <p>09/08 a 07/09/2026 · valores em reais</p>
        </div>
        <div
          class="bar-chart"
          role="img"
          :aria-label="`Vendas diárias de 09/08 a 07/09/2026. Total de ${brlExato(totalVendido)} em ${vendas.length} vendas.`"
        >
          <div
            v-for="day in dias"
            :key="day.iso"
            :title="`${day.label} · ${brlExato(day.valor)}`"
          >
            <span
              :data-has-value="day.valor > 0 ? 'sim' : 'nao'"
              :style="{
                '--bar-size':
                  day.valor > 0
                    ? `${Math.round((day.valor / maxDia) * 100)}%`
                    : '2px',
              }"
            ></span>
          </div>
        </div>
        <div class="bar-axis" aria-hidden="true">
          <span>09/08</span><span>23/08</span><span>07/09</span>
        </div>
        <details class="exact">
          <summary>Ver valores exatos das 12 vendas</summary>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Data</th>
                  <th scope="col">Vendedor</th>
                  <th scope="col" class="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sale in vendas" :key="sale.pedido">
                  <td>{{ sale.pedido }}</td>
                  <td>{{ sale.cliente }}</td>
                  <td>{{ dataBR(sale.data) }}</td>
                  <td>{{ sale.vendedor }}</td>
                  <td class="num">{{ brlExato(sale.valor) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="surface" aria-labelledby="operations-title">
        <div class="panel-head">
          <h2 id="operations-title">Pendências operacionais</h2>
          <p>Nada aqui é resolvido automaticamente</p>
        </div>
        <ul class="pend-list">
          <li v-for="pending in pendencias" :key="pending.texto">
            <div>
              <strong>{{ pending.texto }}</strong>
              <p>{{ pending.detalhe }}</p>
            </div>
            <button type="button" disabled>{{ pending.acao }}</button>
          </li>
        </ul>
        <div class="panel-head subsection-heading">
          <h3>Saúde dos canais</h3>
        </div>
        <ul class="health-list">
          <li v-for="channel in canaisSaude" :key="channel.canal">
            <span class="status" :data-tone="channel.estado">
              {{ channel.canal }}
            </span>
            <span>{{ channel.evento }}</span>
          </li>
        </ul>
      </section>
    </div>

    <div class="dash-grid">
      <section class="surface" aria-labelledby="pipeline-title">
        <div class="panel-head">
          <h2 id="pipeline-title">Funil por etapa</h2>
          <p>Negócios abertos · backlog não é coluna do Kanban</p>
        </div>
        <dl class="rank">
          <div v-for="[key, label] in STAGES" :key="key" class="rank-row">
            <dt>{{ label }}</dt>
            <dd>
              <span class="rank-track">
                <span
                  class="rank-fill"
                  :style="{
                    '--rank-size': `${Math.round((stageSummary(key).count / maxEtapa) * 100)}%`,
                  }"
                ></span>
              </span>
            </dd>
            <dd class="rank-value">
              {{ stageSummary(key).count }}
              <span
                v-if="stageSummary(key).blockers"
                class="badge"
                data-tone="error"
              >
                {{ stageSummary(key).blockers }} bloqueio(s)
              </span>
            </dd>
          </div>
        </dl>
        <details class="exact">
          <summary>Ver vendas por vendedor</summary>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Vendedor</th>
                  <th scope="col" class="num">Vendas</th>
                  <th scope="col" class="num">Valor vendido</th>
                  <th scope="col" class="num">Ticket médio</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="seller in porVendedor" :key="seller.nome">
                  <td>{{ seller.nome }}</td>
                  <td class="num">{{ seller.quantidade }}</td>
                  <td class="num">{{ brlExato(seller.total) }}</td>
                  <td class="num">
                    {{ brlExato(seller.total / seller.quantidade) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="surface" aria-labelledby="channels-title">
        <div class="panel-head">
          <h2 id="channels-title">Origem das conversas</h2>
          <p>{{ periodo }} · mesmo fluxo nos dois canais</p>
        </div>
        <dl class="rank">
          <div v-for="channel in canais" :key="channel.canal" class="rank-row">
            <dt>{{ channel.canal }}</dt>
            <dd>
              <span class="rank-track">
                <span
                  class="rank-fill"
                  :style="{
                    '--rank-size': `${Math.round((channel.conversas / maxCanal) * 100)}%`,
                  }"
                ></span>
              </span>
            </dd>
            <dd class="rank-value">
              {{ channel.conversas }} · {{ channel.leads }} leads
            </dd>
          </div>
        </dl>
        <div class="panel-head subsection-heading">
          <h3>Motivos de perda</h3>
        </div>
        <ul class="pend-list">
          <li v-for="lost in perdidos" :key="lost.negocio">
            <div>
              <strong>{{ lost.negocio }}</strong>
              <p>{{ lost.motivo }} · saiu em {{ lost.etapa }}</p>
            </div>
            <span class="rank-value">{{ brl(lost.valor) }}</span>
          </li>
        </ul>
        <p class="footnote">
          Cancelamentos e perdas permanecem no histórico.
          <RouterLink to="/kanban">Abrir o Kanban comercial</RouterLink>.
        </p>
      </section>
    </div>
  </div>
</template>
