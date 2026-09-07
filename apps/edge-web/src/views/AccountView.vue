<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { request } from '../lib/api-client.js';

const props = defineProps({
  session: { type: Object, required: true },
  announce: { type: Function, required: true },
  showError: { type: Function, required: true },
});
const heading = ref(null);
const reason = ref('Proteger acesso privilegiado');
const busy = ref(false);
const enrollment = ref(null);
const result = ref(null);
let enrollmentIdempotencyKey = globalThis.crypto.randomUUID();
const user = computed(() => props.session.user ?? props.session);
const capabilities = computed(() => {
  const values = props.session.capabilities ?? user.value.capabilities;
  return Array.isArray(values) ? values : [];
});
const functionName = computed(
  () =>
    props.session.functionName ?? user.value.functionName ?? 'não informada',
);

onMounted(() => heading.value?.focus());

async function enroll() {
  props.showError('', false);
  busy.value = true;
  try {
    const response = await request('/api/v1/mfa/enrollments', {
      method: 'POST',
      idempotencyKey: enrollmentIdempotencyKey,
      body: { reason: reason.value },
    });
    enrollment.value = response.data;
    enrollmentIdempotencyKey = globalThis.crypto.randomUUID();
    await nextTick();
    result.value?.focus();
    props.announce(
      'Autenticador cadastrado. Guarde os códigos de recuperação.',
    );
  } catch {
    props.showError(
      'Não foi possível cadastrar o autenticador. Tente novamente.',
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page account-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Preferências</p>
        <h1 ref="heading" tabindex="-1">Conta e segurança</h1>
        <p>Gerencie sua sessão e as proteções da conta.</p>
      </div>
    </header>
    <section class="surface">
      <p class="section-kicker">Acesso atual</p>
      <h2>Sessão ativa</h2>
      <dl class="account-facts">
        <div>
          <dt>Função</dt>
          <dd>{{ functionName }}</dd>
        </div>
        <div>
          <dt>Capacidades</dt>
          <dd>
            {{
              capabilities.length
                ? capabilities.join(', ')
                : 'Sem capacidades administrativas.'
            }}
          </dd>
        </div>
      </dl>
    </section>
    <section class="surface">
      <p class="section-kicker">Camada adicional</p>
      <h2>Verificação em duas etapas</h2>
      <p>Proteja ações privilegiadas com um autenticador TOTP.</p>
      <form @submit.prevent="enroll">
        <label for="mfa-reason">Motivo do cadastro</label>
        <input id="mfa-reason" v-model="reason" name="reason" required />
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? 'Cadastrando…' : 'Cadastrar autenticador' }}
        </button>
      </form>
      <div v-if="enrollment" ref="result" class="one-time" tabindex="-1">
        <h3>Guarde estas informações agora</h3>
        <p>Segredo: {{ enrollment.secret ?? '' }}</p>
        <ul>
          <li v-for="code in enrollment.recoveryCodes ?? []" :key="code">
            {{ code }}
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
