<script setup>
import { nextTick, ref } from 'vue';
import { ApiError, request } from '../lib/api-client.js';

const emit = defineEmits(['announce', 'authenticated', 'error']);
const selected = ref('login');
const busy = ref(false);
const loginHeading = ref(null);
const inviteHeading = ref(null);

/** @param {'login'|'invite'} value @param {boolean} [focusTab] */
async function selectTab(value, focusTab = false) {
  selected.value = value;
  await nextTick();
  if (focusTab) document.querySelector(`#${value}-tab`)?.focus();
}

/** @param {KeyboardEvent} event */
function handleTabKey(event) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const target =
    event.key === 'Home'
      ? 'login'
      : event.key === 'End'
        ? 'invite'
        : selected.value === 'login'
          ? 'invite'
          : 'login';
  void selectTab(target, true);
}

/** @param {SubmitEvent} event */
async function submitLogin(event) {
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = formValues(form);
  emit('error', '');
  busy.value = true;
  try {
    const response = await request('/api/v1/sessions', {
      method: 'POST',
      body: compact({
        email: data.email,
        password: data.password,
      }),
    });
    form.reset();
    emit('authenticated', response.data);
  } catch (error) {
    emit('error', publicMessage(error));
  } finally {
    busy.value = false;
  }
}

/** @param {SubmitEvent} event */
async function submitInvite(event) {
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = formValues(form);
  emit('error', '');
  busy.value = true;
  try {
    await request('/api/v1/invitations/accept', {
      method: 'POST',
      body: { password: data.password, token: data.token },
    });
    form.reset();
    await selectTab('login');
    loginHeading.value?.focus();
    emit('announce', 'Conta ativada. Entre com seu e-mail e a senha criada.');
  } catch (error) {
    emit('error', publicMessage(error));
  } finally {
    busy.value = false;
  }
}

function focusHeading() {
  loginHeading.value?.focus();
}

/** @param {unknown} error */
function publicMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS')
      return 'Não foi possível entrar com os dados informados.';
    if (error.status === 403)
      return 'Você não tem permissão para concluir esta ação.';
  }
  return 'Não foi possível concluir. Revise os dados e tente novamente.';
}

/** @param {HTMLFormElement} form */
function formValues(form) {
  return Object.fromEntries(
    [...new globalThis.FormData(form).entries()].map(([key, value]) => [
      key,
      String(value),
    ]),
  );
}

/** @param {Record<string,unknown>} value */
function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== '' && item !== undefined,
    ),
  );
}

defineExpose({ focusHeading });
</script>

<template>
  <section class="surface auth-panel" aria-labelledby="access-title">
    <h2 id="access-title" class="sr-only">Acessar o CRM</h2>
    <div class="tabs" role="tablist" aria-label="Opções de acesso">
      <button
        id="login-tab"
        type="button"
        role="tab"
        aria-controls="login-panel"
        :aria-selected="selected === 'login'"
        :tabindex="selected === 'login' ? 0 : -1"
        @click="selectTab('login')"
        @keydown="handleTabKey"
      >
        Entrar
      </button>
      <button
        id="invite-tab"
        type="button"
        role="tab"
        aria-controls="invite-panel"
        :aria-selected="selected === 'invite'"
        :tabindex="selected === 'invite' ? 0 : -1"
        @click="selectTab('invite')"
        @keydown="handleTabKey"
      >
        Aceitar convite
      </button>
    </div>

    <section
      v-show="selected === 'login'"
      id="login-panel"
      role="tabpanel"
      aria-labelledby="login-tab"
    >
      <h2 ref="loginHeading" tabindex="-1">Boas-vindas de volta</h2>
      <form @submit.prevent="submitLogin">
        <label for="login-email">E-mail</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autocomplete="username"
          required
        />
        <label for="login-password">Senha</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autocomplete="current-password"
          minlength="12"
          required
        />
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? 'Verificando…' : 'Entrar com segurança' }}
        </button>
      </form>
    </section>

    <section
      v-show="selected === 'invite'"
      id="invite-panel"
      role="tabpanel"
      aria-labelledby="invite-tab"
    >
      <h2 ref="inviteHeading" tabindex="-1">Ativar conta convidada</h2>
      <form @submit.prevent="submitInvite">
        <label for="invite-token">Código do convite</label>
        <input id="invite-token" name="token" autocomplete="off" required />
        <label for="new-password">Crie uma senha</label>
        <input
          id="new-password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required
        />
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? 'Ativando…' : 'Ativar minha conta' }}
        </button>
      </form>
    </section>
  </section>
</template>
