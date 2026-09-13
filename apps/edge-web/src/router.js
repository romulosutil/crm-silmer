import { h } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import AccountView from './views/AccountView.vue';
import ClientsView from './views/ClientsView.vue';
import DashboardView from './views/DashboardView.vue';
import InboxView from './views/InboxView.vue';
import OrdersView from './views/OrdersView.vue';
import OrderView from './views/OrderView.vue';
import UsersView from './views/UsersView.vue';

const PublicRoute = { name: 'PublicRoute', render: () => h('span') };

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: PublicRoute, meta: { title: 'Acesso' } },
    {
      path: '/dashboard',
      component: DashboardView,
      meta: { title: 'Dashboard' },
    },
    {
      path: '/inbox',
      component: InboxView,
      meta: { title: 'Caixa de Entrada' },
    },
    {
      path: '/handoffs',
      redirect: '/inbox',
    },
    {
      path: '/pedidos',
      component: OrdersView,
      meta: { title: 'Pedidos' },
    },
    {
      // PGE-01: two ways in — the list and the conversation drawer. The
      // drawer passes the conversation it came from so the trail can name it.
      path: '/pedidos/:orderId',
      component: OrderView,
      props: (route) => ({
        fromConversationId: String(route.query.conversa ?? ''),
        orderId: String(route.params.orderId ?? ''),
      }),
      meta: { title: 'Pedido' },
    },
    {
      path: '/clientes/:clientId?',
      component: ClientsView,
      props: (route) => ({ selectedId: String(route.params.clientId ?? '') }),
      meta: { title: 'Clientes' },
    },
    {
      path: '/usuarios',
      component: UsersView,
      meta: { requiresAdmin: true, title: 'Vendedores' },
    },
    { path: '/conta', component: AccountView, meta: { title: 'Conta' } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
});
