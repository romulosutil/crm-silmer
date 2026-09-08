<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import AuthPanel from './components/AuthPanel.vue';
import ThemeSwitcher from './components/ThemeSwitcher.vue';
import { ApiError, request } from './lib/api-client.js';
import { KanbanEventStream } from './lib/event-stream.js';

const router = useRouter();
const route = useRoute();
const phase = ref('restoring');
const session = shallowRef(null);
const activeView = shallowRef(null);
const authPanel = ref(null);
const errorMessage = ref('');
const errorSummary = ref(null);
const runtimeStatus = ref('Verificando sua sessão…');
const connection = ref('conectando');
const mobileOpen = ref(false);
const logoutBusy = ref(false);
let lastAnnouncement = '';

const user = computed(() => session.value?.user ?? session.value ?? {});
const sessionSummary = computed(
  () =>
    session.value?.functionName ??
    user.value.functionName ??
    'Conta autenticada',
);
const connectionLabel = computed(() => {
  if (connection.value === 'conectado') return 'Ao vivo';
  if (connection.value === 'reconectando') return 'Reconectando…';
  if (connection.value === 'indisponível') return 'Sem tempo real';
  return 'Conectando…';
});

const stream = new KanbanEventStream({
  onChange(event) {
    activeView.value?.refreshFromEvent(event);
  },
  onReset() {
    activeView.value?.reset();
    announce('A conexão foi ressincronizada.');
  },
  onState(value) {
    connection.value = value;
  },
});

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
    clearError();
  },
);

void restoreSession();
onBeforeUnmount(() => stream.close());

async function restoreSession() {
  phase.value = 'restoring';
  clearError();
  try {
    const response = await request('/api/v1/sessions/current');
    await showSession(response.data, false);
    announce('Sessão restaurada.');
  } catch (error) {
    if (error instanceof ApiError && [401, 404].includes(error.status)) {
      await showSignedOut(false);
      announce('Entre para continuar.');
      return;
    }
    phase.value = 'unavailable';
    announce('Não foi possível verificar sua sessão.');
  }
}

/** @param {Record<string, any>} value @param {boolean} [announceLogin] */
async function showSession(value, announceLogin = true) {
  session.value = value;
  phase.value = 'authenticated';
  if (route.path === '/') await router.replace('/kanban');
  stream.start();
  if (announceLogin) announce('Sessão iniciada com segurança.');
}

/** @param {boolean} [focus] */
async function showSignedOut(focus = true) {
  session.value = null;
  phase.value = 'signed-out';
  stream.close();
  activeView.value?.dispose();
  activeView.value = null;
  if (route.path !== '/') await router.replace('/');
  clearError();
  if (focus) {
    await nextTick();
    authPanel.value?.focusHeading();
  }
}

async function logout() {
  logoutBusy.value = true;
  let serverConfirmed = true;
  try {
    await request('/api/v1/sessions/current', { method: 'DELETE' });
  } catch {
    serverConfirmed = false;
  } finally {
    logoutBusy.value = false;
    await showSignedOut();
    announce(
      serverConfirmed
        ? 'Sessão encerrada.'
        : 'Acesso local encerrado. A confirmação do servidor falhou.',
    );
  }
}

/** @param {KeyboardEvent} event */
function handleShellKey(event) {
  if (event.key !== 'Escape' || !mobileOpen.value) return;
  mobileOpen.value = false;
  document.querySelector('#nav-toggle')?.focus();
}

/** @param {string} message */
function announce(message) {
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  runtimeStatus.value = '';
  globalThis.setTimeout(() => {
    runtimeStatus.value = message;
  }, 20);
}

/** @param {string} message @param {boolean} [focus] */
async function showError(message, focus = true) {
  errorMessage.value = message;
  if (!message || !focus) return;
  await nextTick();
  errorSummary.value?.focus();
}

function clearError() {
  errorMessage.value = '';
}

/** @param {string} cursor */
function onCursor(cursor) {
  if (cursor && !stream.cursor) stream.cursor = cursor;
}
</script>

<template>
  <a class="skip-link" href="#main-content">Pular para o conteúdo</a>

  <div v-if="phase !== 'authenticated'" class="public-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="CRM Silmer, início">
        <span class="brand-word" aria-hidden="true">SILMER<span>.</span></span>
        <span class="product-label">CRM</span>
      </a>
      <p class="environment">
        <span aria-hidden="true">●</span> Ambiente seguro
      </p>
    </header>
    <main id="main-content" class="public-content" tabindex="-1">
      <div class="intro">
        <p class="eyebrow">Acesso à operação</p>
        <h1>O comercial inteiro,<br /><em>em movimento.</em></h1>
        <p>
          Acompanhe negociações, resolva pendências e mantenha cada pedido no
          ritmo certo.
        </p>
      </div>
      <p v-if="phase === 'restoring'" class="loading-state" role="status">
        Verificando sua sessão…
      </p>
      <section
        v-else-if="phase === 'unavailable'"
        class="surface unavailable-state"
        aria-labelledby="unavailable-title"
      >
        <p class="section-kicker">Conexão indisponível</p>
        <h2 id="unavailable-title">Não foi possível verificar sua sessão</h2>
        <p>
          Seus dados não foram enviados. Confira a conexão e tente novamente.
        </p>
        <button class="primary" type="button" @click="restoreSession">
          Tentar novamente
        </button>
      </section>
      <AuthPanel
        v-else
        ref="authPanel"
        @announce="announce"
        @authenticated="showSession"
        @error="showError"
      />
    </main>
  </div>

  <div v-else class="app-shell" @keydown="handleShellKey">
    <aside class="app-sidebar" aria-label="Navegação principal">
      <RouterLink
        class="brand app-brand"
        to="/kanban"
        aria-label="CRM Silmer, Kanban"
      >
        <span class="brand-word" aria-hidden="true">SILMER<span>.</span></span>
        <span class="product-label brand-label">CRM</span>
      </RouterLink>
      <nav>
        <RouterLink
          to="/kanban"
          :aria-current="
            route.path.startsWith('/negocios/') ? 'page' : undefined
          "
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 5h4v14H4zm6 0h4v9h-4zm6 0h4v11h-4z" />
          </svg>
          <span class="nav-label">Kanban</span>
        </RouterLink>
        <RouterLink to="/conta">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0Z"
            />
          </svg>
          <span class="nav-label">Conta</span>
        </RouterLink>
      </nav>
      <button
        class="quiet sidebar-logout"
        type="button"
        :disabled="logoutBusy"
        @click="logout"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M10 4H4v16h6v-2H6V6h4zm5 3-1.4 1.4 2.6 2.6H9v2h7.2l-2.6 2.6L15 17l5-5z"
          />
        </svg>
        <span class="nav-label">{{ logoutBusy ? 'Saindo…' : 'Sair' }}</span>
      </button>
    </aside>
    <div class="app-frame">
      <header class="app-topbar">
        <button
          id="nav-toggle"
          class="icon-button"
          type="button"
          :aria-expanded="mobileOpen"
          aria-controls="mobile-nav"
          @click="mobileOpen = !mobileOpen"
        >
          Menu
        </button>
        <p>{{ sessionSummary }}</p>
        <span class="connection-state" :data-state="connection">
          {{ connectionLabel }}
        </span>
        <ThemeSwitcher />
      </header>
      <nav
        id="mobile-nav"
        class="mobile-nav"
        aria-label="Navegação móvel"
        :hidden="!mobileOpen"
      >
        <RouterLink to="/kanban">Kanban</RouterLink>
        <RouterLink to="/conta">Conta</RouterLink>
      </nav>
      <main id="main-content" tabindex="-1">
        <RouterView v-slot="{ Component }">
          <component
            :is="Component"
            :key="route.fullPath"
            :session="session"
            :announce="announce"
            :show-error="showError"
            :on-cursor="onCursor"
            @active-view="activeView = $event"
          />
        </RouterView>
      </main>
    </div>
  </div>

  <p class="sr-only" role="status" aria-live="polite">{{ runtimeStatus }}</p>
  <div
    v-if="errorMessage"
    ref="errorSummary"
    class="error toast"
    role="alert"
    tabindex="-1"
  >
    {{ errorMessage }}
  </div>
</template>
