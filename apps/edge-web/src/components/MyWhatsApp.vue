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
const root = ref(null);
const title = ref(null);
const qrTrigger = ref(null);
const codeTrigger = ref(null);
const lastMode = ref('qr');
// Fallback only for a server that does not report challenge metadata.
const challengeId = ref('');
// '' | 'challenge' | 'control': a command whose outcome this tab cannot know.
const uncertain = ref('');
let readController;
let commandController;
let expiryTimer = 0;
let pollTimer = 0;
let followUpTimer = 0;
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
// Challenge states the server has not confirmed by a read yet (WAP-03).
const UNCONFIRMED = ['reserved', 'dispatching', 'delivered', 'unknown'];
const line = computed(() => state.value?.line);
// WAP-E12: an existing line keeps its number on the server (encrypted), so a
// disconnected line reconnects it without retyping; only the first connection
// asks for the number.
const reconnecting = computed(
  () =>
    line.value?.state === 'disconnected' && Boolean(line.value.maskedNumber),
);
const operation = computed(
  () => state.value?.operation ?? line.value?.operation,
);
const reportsChallenge = computed(() =>
  Boolean(state.value && 'challenge' in state.value),
);
const unconfirmedOnServer = computed(() =>
  UNCONFIRMED.includes(state.value?.challenge?.state),
);
const challengeLocked = computed(
  () => busy.value || Boolean(uncertain.value) || unconfirmedOnServer.value,
);
const waitingMessage = computed(() => {
  if (uncertain.value === 'control')
    return 'Aguardando a confirmação da operação anterior. Consulte o estado antes de tentar novamente.';
  if (
    !secret.value &&
    !busy.value &&
    (uncertain.value === 'challenge' ||
      (unconfirmedOnServer.value && line.value?.state === 'awaiting_pairing'))
  )
    return 'Aguardando confirmação do desafio anterior. Isso leva alguns segundos; depois você poderá pedir outro QR ou código.';
  return '';
});

/** @param {any} data */
function settled(data) {
  const next = data?.line;
  const op = data?.operation ?? next?.operation;
  return (
    Boolean(next) &&
    next.state !== 'unknown' &&
    !['pending', 'dispatching', 'unknown'].includes(op?.state) &&
    !UNCONFIRMED.includes(data.challenge?.state)
  );
}
function scheduleFollowUp() {
  if (followUpTimer) clearTimeout(followUpTimer);
  followUpTimer = 0;
  if (!uncertain.value && !unconfirmedOnServer.value) return;
  // The worker confirms a delivered challenge within seconds; poll faster
  // than the regular interval so the wait clears by itself.
  followUpTimer = setTimeout(() => {
    followUpTimer = 0;
    if (!busy.value && document.visibilityState === 'visible') void refresh();
  }, 3000);
}
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
  if (busy.value) uncertain.value = 'challenge';
  clearSecret();
  scheduleFollowUp();
}
function closeChallenge() {
  const mode = secret.value?.mode ?? lastMode.value;
  clearSecret();
  void nextTick(() =>
    (mode === 'code' ? codeTrigger.value : qrTrigger.value)?.focus(),
  );
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
    const previousOperation = operation.value?.id;
    const data = result.data;
    const next = data?.line;
    const nextOperation = (data?.operation ?? next?.operation)?.id;
    // A read started before the challenge POST may return after it.
    if (
      previous?.id &&
      previous.id === next?.id &&
      next.version < previous.version
    )
      return;
    // The latest challenge ID changes when another tab renews it. A version
    // bump on its own can be a reconciliation of the same challenge.
    if (
      !next ||
      data?.available !== true ||
      next.state !== 'awaiting_pairing' ||
      (previous &&
        (previous.generation !== next.generation ||
          previous.id !== next.id ||
          previousOperation !== nextOperation)) ||
      (secret.value &&
        'challenge' in data &&
        (data.challenge?.id !== challengeId.value ||
          data.challenge?.state === 'revoked'))
    )
      clearSecret();
    state.value = data;
    error.value = '';
    // Only a server that reports challenge metadata can prove the earlier
    // outcome was reconciled; then the wait clears without a new command.
    if (uncertain.value && reportsChallenge.value && settled(data))
      uncertain.value = '';
    scheduleFollowUp();
  } catch (cause) {
    if (readController !== controller || cause?.name === 'AbortError') return;
    clearSecret();
    state.value = null;
    error.value = 'Não foi possível consultar seu WhatsApp agora.';
  }
}
/** @param {'connect'|'disconnect'} action */
async function control(action) {
  if (!line.value || busy.value) return;
  if (action === 'connect' && uncertain.value) return;
  clearSecret();
  challengeId.value = '';
  uncertain.value = '';
  const current = new AbortController();
  commandController = current;
  busy.value = true;
  const body =
    action === 'connect'
      ? reconnecting.value
        ? { expectedVersion: line.value.version }
        : {
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
    uncertain.value = 'control';
    await refresh();
    error.value =
      'Não foi possível confirmar o comando. Consulte o estado antes de tentar novamente.';
  } finally {
    if (commandController === current) busy.value = false;
  }
}
/** @param {'qr'|'code'} mode */
async function challenge(mode) {
  if (challengeLocked.value) return;
  lastMode.value = mode;
  busy.value = true;
  requestingChallenge.value = true;
  await refresh();
  if (
    !requestingChallenge.value ||
    line.value?.state !== 'awaiting_pairing' ||
    !operation.value?.id ||
    unconfirmedOnServer.value
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
  // After a reload/new tab the id of the latest challenge comes from the GET.
  const renewChallengeId = reportsChallenge.value
    ? state.value.challenge?.id
    : challengeId.value;
  const body = {
    operationId: operation.value.id,
    expectedVersion: line.value.version,
    generation: line.value.generation,
    mode,
    ...(renewChallengeId ? { renewChallengeId } : {}),
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
    // Prefer the HTTP clock for both validation and the in-memory TTL.
    const referenceTime =
      response.serverTime === null ? Date.now() : response.serverTime + 1000;
    if (
      value.mode !== mode ||
      !Number.isFinite(expires) ||
      expires <= referenceTime ||
      value.generation !== body.generation ||
      value.operationId !== body.operationId ||
      (mode === 'qr' &&
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(value.value)) ||
      (mode === 'code' && !/^[A-Za-z0-9-]{8,32}$/u.test(value.value))
    )
      throw new Error('invalid challenge');
    const latestChallenge = state.value?.challenge;
    if (
      reportsChallenge.value &&
      ((line.value.version > value.version &&
        latestChallenge?.id !== value.challengeId) ||
        (latestChallenge?.state === 'revoked' &&
          latestChallenge.id === value.challengeId))
    )
      return;
    challengeId.value = value.challengeId;
    if (state.value?.line)
      state.value = {
        ...state.value,
        line:
          Number.isSafeInteger(value.version) &&
          value.version > line.value.version
            ? { ...state.value.line, version: value.version }
            : state.value.line,
        // Metadata only; the server confirms it by a read in a few seconds.
        ...(reportsChallenge.value && latestChallenge?.id !== value.challengeId
          ? {
              challenge: {
                id: value.challengeId,
                state: 'delivered',
                expiresAt: value.expiresAt,
              },
            }
          : {}),
      };
    secret.value = { mode, value: value.value };
    scheduleFollowUp();
    // Bound the in-memory lifetime even without a server clock.
    expiryTimer = setTimeout(
      clearSecret,
      Math.min(120_000, Math.max(0, expires - referenceTime)),
    );
  } catch (cause) {
    if (currentEpoch !== epoch || cause?.name === 'AbortError') return;
    uncertain.value = 'challenge';
    await refresh();
    if (currentEpoch !== epoch) return;
    error.value = 'Não foi possível confirmar o desafio agora.';
  } finally {
    if (commandController === current) {
      busy.value = false;
      requestingChallenge.value = false;
    }
  }
}
// Keyboard focus never falls to <body> when the control it was on goes away
// (challenge closed or expired, cancel, state change after a command).
watch(
  [secret, requestingChallenge, () => line.value?.state],
  () => {
    if (!root.value?.contains(document.activeElement)) return;
    void nextTick(() => {
      if (root.value?.contains(document.activeElement)) return;
      const trigger =
        lastMode.value === 'code' ? codeTrigger.value : qrTrigger.value;
      (trigger ?? title.value)?.focus();
    });
  },
  { flush: 'pre' },
);
watch(liveEvent, (event) => {
  if (event?.type === 'identity.user.changed') {
    if (busy.value)
      uncertain.value = requestingChallenge.value ? 'challenge' : 'control';
    clearSecret();
    challengeId.value = '';
    void refresh();
  } else if (event?.reset) {
    // A reset only means the stream lost events this reader may not see
    // (often another seller's activity). Re-read and apply the same rules.
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
  if (followUpTimer) clearTimeout(followUpTimer);
});
</script>

<template>
  <section
    ref="root"
    class="surface my-whatsapp"
    aria-labelledby="my-whatsapp-title"
  >
    <h2 id="my-whatsapp-title" ref="title" tabindex="-1">Meu WhatsApp</h2>
    <p>
      Conecte sua linha para atender seus clientes. Você pode continuar usando o
      CRM sem conectá-la.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="waitingMessage" role="status">{{ waitingMessage }}</p>
    <template v-if="line">
      <p role="status">
        {{ labels[line.state] ?? 'Estado indisponível'
        }}<span v-if="line.maskedNumber"> · {{ line.maskedNumber }}</span>
      </p>
      <p v-if="!state.available">
        A conexão pessoal não está disponível para sua conta.
      </p>
      <p v-if="state.available && line.state === 'blocked'">
        O número conectado não é o cadastrado. Desconecte e reconecte pelo
        celular com o número cadastrado.
      </p>
      <form
        v-if="
          state.available &&
          ['not_configured', 'disconnected'].includes(line.state)
        "
        @submit.prevent="control('connect')"
      >
        <p v-if="reconnecting" id="personal-whatsapp-reconnect">
          Reconectar o número {{ line.maskedNumber }}
        </p>
        <template v-else>
          <label for="personal-whatsapp-number"
            >Número com código do país</label
          >
          <input
            id="personal-whatsapp-number"
            v-model="number"
            type="tel"
            autocomplete="tel"
            required
            pattern="\+?[1-9][0-9]{7,14}"
          />
        </template>
        <button
          type="submit"
          :aria-describedby="
            reconnecting ? 'personal-whatsapp-reconnect' : undefined
          "
          :aria-disabled="busy || Boolean(uncertain) ? 'true' : undefined"
        >
          {{ reconnecting ? 'Reconectar WhatsApp' : 'Conectar WhatsApp' }}
        </button>
      </form>
      <template v-if="state.available && line.state === 'awaiting_pairing'">
        <p>Peça um desafio somente quando estiver pronto para conectar.</p>
        <div class="inline-actions" :aria-busy="busy ? 'true' : undefined">
          <button
            ref="qrTrigger"
            type="button"
            :aria-disabled="challengeLocked ? 'true' : undefined"
            @click="challenge('qr')"
          >
            Mostrar QR
          </button>
          <button
            ref="codeTrigger"
            type="button"
            :aria-disabled="challengeLocked ? 'true' : undefined"
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
          ['connected', 'awaiting_pairing', 'blocked'].includes(line.state)
        "
        type="button"
        :aria-disabled="busy ? 'true' : undefined"
        @click="control('disconnect')"
      >
        Desconectar
      </button>
    </template>
    <button
      type="button"
      :aria-disabled="busy ? 'true' : undefined"
      @click="!busy && refresh()"
    >
      Atualizar estado
    </button>
  </section>
</template>

<style scoped>
.my-whatsapp h2:focus {
  outline: none;
}
.my-whatsapp h2:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.my-whatsapp button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}
</style>
