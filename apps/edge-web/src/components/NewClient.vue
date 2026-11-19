<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { ApiError, commandKey, request } from '../lib/api-client.js';

const emit = defineEmits(['created']);
const dialog = ref(null);
const nameField = ref(null);
const errorAlert = ref(null);
const name = ref('');
const phone = ref('');
const email = ref('');
const error = ref('');
const saving = ref(false);
let controller;
let attempt;

function open() {
  name.value = '';
  phone.value = '';
  email.value = '';
  error.value = '';
  attempt = null;
  dialog.value?.showModal();
  nameField.value?.focus();
}

/** @param {Event} event */
function cancel(event) {
  if (saving.value) event.preventDefault();
}

/** @param {unknown} cause */
function describeError(cause) {
  if (cause instanceof ApiError) {
    if (cause.status === 403)
      return 'Você não tem permissão para criar clientes.';
    switch (cause.code) {
      case 'INVALID_DISPLAY_NAME':
        return 'Informe um nome com até 120 caracteres.';
      case 'INVALID_PHONE':
        return 'Confira o telefone. Inclua o DDD.';
      case 'INVALID_EMAIL':
        return 'Confira o e-mail informado.';
      case 'CONTACT_PHONE_MATCH':
        return 'Não foi possível cadastrar com esse telefone. Confira os dados ou busque o cliente em Clientes.';
      case 'CONTACT_CONFLICT':
        return 'O cadastro mudou. Feche o formulário e procure o cliente na lista.';
    }
  }
  return 'Não foi possível criar o cliente. Tente novamente.';
}

async function save() {
  if (saving.value) return;
  const displayName = name.value.trim();
  if (!displayName) {
    error.value = 'Informe o nome do cliente.';
    nameField.value?.focus();
    return;
  }
  const body = {
    displayName,
    ...(phone.value.trim() ? { phone: phone.value.trim() } : {}),
    ...(email.value.trim() ? { email: email.value.trim() } : {}),
  };
  const payload = JSON.stringify(body);
  if (attempt?.payload !== payload) attempt = { payload, key: commandKey() };
  const current = new AbortController();
  controller = current;
  saving.value = true;
  error.value = '';
  try {
    const response = await request('/api/v1/contacts', {
      body,
      idempotencyKey: attempt.key,
      method: 'POST',
      signal: current.signal,
    });
    if (current.signal.aborted) return;
    dialog.value?.close();
    emit('created', response.data.contact.id);
  } catch (cause) {
    if (!current.signal.aborted) error.value = describeError(cause);
  } finally {
    saving.value = false;
    controller = undefined;
  }
  if (error.value) {
    await nextTick();
    errorAlert.value?.focus();
  }
}

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <button type="button" class="primary" @click="open">Novo cliente</button>
  <dialog
    ref="dialog"
    class="op-dialog new-client-dialog"
    aria-labelledby="new-client-title"
    @cancel="cancel"
  >
    <h2 id="new-client-title">Novo cliente</h2>
    <form @submit.prevent="save">
      <fieldset :disabled="saving" class="new-client-fields">
        <div>
          <label for="new-client-name">Nome (obrigatório)</label>
          <input
            id="new-client-name"
            ref="nameField"
            v-model="name"
            type="text"
            autocomplete="name"
            maxlength="120"
            required
          />
        </div>
        <div>
          <label for="new-client-phone">Telefone (opcional)</label>
          <input
            id="new-client-phone"
            v-model="phone"
            type="tel"
            autocomplete="tel"
            maxlength="24"
          />
        </div>
        <div>
          <label for="new-client-email">E-mail (opcional)</label>
          <input
            id="new-client-email"
            v-model="email"
            type="email"
            autocomplete="email"
            maxlength="254"
          />
        </div>
      </fieldset>
      <p
        v-if="error"
        ref="errorAlert"
        class="new-client-error"
        role="alert"
        tabindex="-1"
      >
        {{ error }}
      </p>
      <div class="op-dialog-actions">
        <button type="button" :disabled="saving" @click="dialog?.close()">
          Cancelar
        </button>
        <button type="submit" class="primary" :disabled="saving">
          {{ saving ? 'Criando…' : 'Criar cliente' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.new-client-dialog {
  max-block-size: calc(100dvh - 2rem);
  overflow-y: auto;
}

.new-client-fields {
  display: grid;
  min-inline-size: 0;
  gap: var(--space-3);
  margin: var(--space-4) 0;
  padding: 0;
  border: 0;
}

.new-client-fields label {
  display: block;
  margin-block-end: var(--space-1);
}

.new-client-fields input {
  inline-size: 100%;
  min-block-size: 44px;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.new-client-error {
  margin-block: var(--space-3);
  color: var(--status-error-text);
}
</style>
