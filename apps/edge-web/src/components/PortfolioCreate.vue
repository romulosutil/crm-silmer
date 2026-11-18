<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { commandKey, request } from '../lib/api-client.js';

const emit = defineEmits(['created']);
const open = ref(false);
const name = ref('');
const phone = ref('');
const email = ref('');
const busy = ref(false);
const error = ref('');
const nameInput = ref(null);
const trigger = ref(null);
let controller;
let attempt = { fingerprint: '', key: '' };

async function show() {
  open.value = true;
  error.value = '';
  await nextTick();
  nameInput.value?.focus();
}
async function close() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
  open.value = false;
  name.value = phone.value = email.value = '';
  error.value = '';
  attempt = { fingerprint: '', key: '' };
  await nextTick();
  trigger.value?.focus();
}
async function save() {
  if (busy.value) return;
  const body = {
    displayName: name.value.trim(),
    phone: phone.value.trim(),
    email: email.value.trim() || null,
  };
  const fingerprint = JSON.stringify(body);
  if (attempt.fingerprint !== fingerprint)
    attempt = { fingerprint, key: commandKey() };
  const current = new AbortController();
  controller = current;
  busy.value = true;
  error.value = '';
  try {
    const response = await request('/api/v1/me/clients', {
      body,
      method: 'POST',
      idempotencyKey: attempt.key,
      signal: current.signal,
    });
    if (controller !== current) return;
    const id = response.data.contact.id;
    await close();
    emit('created', id);
  } catch (cause) {
    if (controller !== current || cause?.name === 'AbortError') return;
    if ([400, 409].includes(Number(cause?.status)))
      attempt = { fingerprint: '', key: '' };
    error.value =
      cause?.code === 'CONTACT_PHONE_MATCH'
        ? 'Não foi possível criar com este telefone. Busque um cliente existente ao qual você tenha acesso.'
        : cause?.status === 400
          ? 'Confira o nome, o telefone e o e-mail informados.'
          : 'Não foi possível salvar agora. Os dados digitados foram mantidos.';
  } finally {
    if (controller === current) busy.value = false;
  }
}
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <div>
    <button v-if="!open" ref="trigger" type="button" @click="show">
      Novo cliente
    </button>
    <form v-else class="surface" @submit.prevent="save">
      <h2>Novo cliente</h2>
      <p>O cadastro entra na sua carteira sem criar conversa ou pedido.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <label for="portfolio-name">Nome</label>
      <input
        id="portfolio-name"
        ref="nameInput"
        v-model="name"
        required
        maxlength="120"
        autocomplete="name"
      />
      <label for="portfolio-phone">Telefone</label>
      <input
        id="portfolio-phone"
        v-model="phone"
        required
        type="tel"
        autocomplete="tel"
      />
      <label for="portfolio-email">E-mail (opcional)</label>
      <input
        id="portfolio-email"
        v-model="email"
        type="email"
        autocomplete="email"
      />
      <div class="inline-actions">
        <button type="submit" class="primary" :disabled="busy">
          {{ busy ? 'Salvando…' : 'Salvar cliente' }}
        </button>
        <button type="button" :disabled="busy" @click="close">Cancelar</button>
      </div>
    </form>
  </div>
</template>
