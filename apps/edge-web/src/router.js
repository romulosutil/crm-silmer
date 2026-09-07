import { h } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import LegacyViewHost from './components/LegacyViewHost.vue';
import AccountView from './views/AccountView.vue';

const PublicRoute = { name: 'PublicRoute', render: () => h('span') };

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: PublicRoute },
    {
      path: '/kanban',
      component: LegacyViewHost,
      props: { kind: 'kanban' },
    },
    {
      path: '/negocios/:dealId',
      component: LegacyViewHost,
      props: (route) => ({ dealId: String(route.params.dealId), kind: 'deal' }),
    },
    { path: '/conta', component: AccountView },
    { path: '/:pathMatch(.*)*', redirect: '/kanban' },
  ],
});
