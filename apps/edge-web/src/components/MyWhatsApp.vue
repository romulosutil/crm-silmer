<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { commandKey, request } from '../lib/api-client.js';

const liveEvent = inject('liveEvent', ref(null));
const state = ref(null);
const number = ref('');
const busy = ref(false);
const requestingChallenge = ref(false);
const error = ref('');
const secret = ref(null);
const challengeTrigger = ref(null);
const challengeId = ref('');
const uncertain = ref(false);
let readController;
let commandController;
let expiryTimer = 0;
let pollTimer = 0;
let epoch = 0;
const labels = {
  not_configured: 'Não configurado',
  preparing: 'Preparando',
  awaiting_pairing: 'Aguardando pareamento',
  validating: 'Validando',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  disconnecting: 'Desconectando',
  blocked: 'Bloqueado',
  unknown: 'Aguardando reconciliação',
};
const line = computed(() => state.value?.line);
const operation = computed(
  () => state.value?.operation ?? line.value?.operation,
);

function clearSecret() {
  epoch++;
  commandController?.abort();
  commandController = undefined;
  busy.value = false;
  requestingChallenge.value = false;
  secret.value = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = 0;
}
function cancelChallenge() {
  if (busy.value) uncertain.value = true;
  clearSecret();
}
function closeChallenge() {
  clearSecret();
  void nextTick(() => challengeTrigger.value?.focus());
}
function onVisibilityChange() {
  if (document.visibilityState !== 'visible') cancelChallenge();
  else void refresh();
}
async function refresh() {
  readController?.abort();
  const controller = new AbortController();
  readController = controller;
  try {
    const result = await request('/api/v1/me/whatsapp', {
      signal: controller.signal,
    });
    if (readController !== controller) return;
    const previous = line.value;
    const next = result.data?.line;
    if (
      !next ||
      result.data?.available !== true ||
      next.state !== 'awaiting_pairing' ||
      (previous &&
        (previous.generation !== next.generation ||
          previous.id !== next.id ||
          (secret.value && previous.version !== next.version)))
    )
      clearSecret();
    state.value = result.data;
    error.value = '';
  } catch (cause) {
    if (readController !== controller || cause?.name === 'AbortError') return;
    clearSecret();
    state.value = null;
    error.value = 'Não foi possível consultar seu WhatsApp agora.';
  }
}
async function control(action) {
  if (!line.value || busy.value) return;
  clearSecret();
  challengeId.value = '';
  uncertain.value = false;
  const current = new AbortController();
  commandController = current;
  busy.value = true;
  const body =
    action === 'connect'
      ? {
          expectedNumber: number.value.trim(),
          expectedVersion: line.value.version,
        }
      : {
          expectedVersion: line.value.version,
          expectedGeneration: line.value.generation,
        };
  try {
    await request(`/api/v1/me/whatsapp/${action}`, {
      method: 'POST',
      body,
      idempotencyKey: commandKey(),
      signal: current.signal,
    });
    if (commandController !== current) return;
    number.value = '';
    await refresh();
  } catch (cause) {
    if (commandController !== current || cause?.name === 'AbortError') return;
    uncertain.value = true;
    await refresh();
    error.value =
      'Não foi possível confirmar o comando. Consulte o estado antes de tentar novamente.';
  } finally {
    if (commandController === current) busy.value = false;
  }
}
async function challenge(mode) {
  if (busy.value || uncertain.value) return;
  busy.value = true;
  requestingChallenge.value = true;
  await refresh();
  if (
    !requestingChallenge.value ||
    line.value?.state !== 'awaiting_pairing' ||
    !operation.value?.id
  ) {
    busy.value = false;
    requestingChallenge.value = false;
    return;
  }
  clearSecret();
  const currentEpoch = epoch;
  const current = new AbortController();
  commandController = current;
  busy.value = true;
  requestingChallenge.value = true;
  const body = {
    operationId: operation.value.id,
    expectedVersion: line.value.version,
    generation: line.value.generation,
    mode,
    ...(challengeId.value ? { renewChallengeId: challengeId.value } : {}),
  };
  try {
    const response = await request('/api/v1/me/whatsapp/pairing-challenge', {
      method: 'POST',
      body,
      idempotencyKey: commandKey(),
      signal: current.signal,
    });
    if (currentEpoch !== epoch || commandController !== current) return;
    const value = response.data;
    const expires = Date.parse(value.expiresAt);
    if (
      value.mode !== mode ||
      !Number.isFinite(expires) ||
      expires <= Date.now() ||
      value.generation !== body.generation ||
      value.operationId !== body.operationId ||
      (mode === 'qr' &&
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(value.value)) ||
      (mode === 'code' && !/^[A-Za-z0-9-]{8,32}$/u.test(value.value))
    )
      throw new Error('invalid challenge');
    challengeId.value = value.challengeId;
    if (Number.isSafeInteger(value.version) && state.value?.line)
      state.value = {
        ...state.value,
        line: { ...state.value.line, version: value.version },
      };
    secret.value = { mode, value: value.value };
    expiryTimer = setTimeout(clearSecret, Math.max(0, expires - Date.now()));
  } catch (cause) {
    if (currentEpoch !== epoch || cause?.name === 'AbortError') return;
    uncertain.value = true;
    error.value =
      'Não foi possível confirmar o desafio. Consulte o estado; não solicite outro enquanto o resultado estiver incerto.';
  } finally {
    if (commandController === current) {
      busy.value = false;
      requestingChallenge.value = false;
    }
  }
}
watch(liveEvent, (event) => {
  if (event?.reset || event?.type === 'identity.user.changed') {
    if (busy.value) uncertain.value = true;
    clearSecret();
    challengeId.value = '';
    void refresh();
  }
});
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  void refresh();
  pollTimer = setInterval(() => {
    if (!busy.value && document.visibilityState === 'visible') void refresh();
  }, 10000);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  clearSecret();
  readController?.abort();
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <section class="surface" aria-labelledby="my-whatsapp-title">
    <h2 id="my-whatsapp-title">Meu WhatsApp</h2>
    <p>
      Conecte sua linha para atender seus clientes. Você pode continuar usando o
      CRM sem conectá-la.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="uncertain" role="status">
      Há uma operação com resultado incerto. Aguarde a reconciliação antes de
      solicitar outro desafio.
    </p>
    <template v-if="line">
      <p role="status">
        {{ labels[line.state] ?? 'Estado indisponível'
        }}<span v-if="line.maskedNumber"> · {{ line.maskedNumber }}</span>
      </p>
      <p v-if="!state.available">
        A conexão pessoal não está disponível para sua conta.
      </p>
      <form
        v-if="
          state.available &&
          ['not_configured', 'disconnected'].includes(line.state)
        "
        @submit.prevent="control('connect')"
      >
        <label for="personal-whatsapp-number">Número com código do país</label>
        <input
          id="personal-whatsapp-number"
          v-model="number"
          type="tel"
          autocomplete="tel"
          required
          pattern="\+?[1-9][0-9]{7,14}"
        />
        <button type="submit" :disabled="busy || uncertain">
          Conectar WhatsApp
        </button>
      </form>
      <template v-if="state.available && line.state === 'awaiting_pairing'">
        <p>Peça um desafio somente quando estiver pronto para conectar.</p>
        <div class="inline-actions">
          <button
            ref="challengeTrigger"
            type="button"
            :disabled="busy || uncertain"
            @click="challenge('qr')"
          >
            Mostrar QR
          </button>
          <button
            type="button"
            :disabled="busy || uncertain"
            @click="challenge('code')"
          >
            Mostrar código
          </button>
        </div>
        <p>O código no mesmo celular ainda não foi homologado em uso real.</p>
        <button
          v-if="requestingChallenge"
          type="button"
          @click="cancelChallenge"
        >
          Cancelar desafio
        </button>
        <div v-if="secret" aria-live="polite">
          <img
            v-if="secret.mode === 'qr'"
            :src="secret.value"
            alt="QR para conectar seu WhatsApp"
          />
          <p v-else>
            Código: <strong>{{ secret.value }}</strong>
          </p>
          <button type="button" @click="closeChallenge">Fechar desafio</button>
        </div>
      </template>
      <button
        v-if="
          state.available &&
          ['connected', 'awaiting_pairing'].includes(line.state)
        "
        type="button"
        :disabled="busy"
        @click="control('disconnect')"
      >
        Desconectar
      </button>
    </template>
    <button type="button" :disabled="busy" @click="refresh">
      Atualizar estado
    </button>
  </section>
</template>
