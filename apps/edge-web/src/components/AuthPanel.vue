<script setup>
import { ref } from 'vue';
import { ApiError, request } from '../lib/api-client.js';

const emit = defineEmits(['authenticated', 'error']);
const busy = ref(false);
const loginHeading = ref(null);

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
    <h2 id="access-title" ref="loginHeading" tabindex="-1">
      Boas-vindas de volta
    </h2>
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
        required
      />
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? 'Verificando…' : 'Entrar com segurança' }}
      </button>
    </form>
    <p class="field-help auth-footnote">
      Sua conta é criada por um administrador. Perdeu o acesso? Fale com quem
      administra o CRM.
    </p>
  </section>
</template>
