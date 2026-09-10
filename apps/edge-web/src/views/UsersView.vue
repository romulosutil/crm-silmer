<script setup>
import { computed, onMounted, ref } from 'vue';
import { ApiError, commandKey, request } from '../lib/api-client.js';

const props = defineProps({
  announce: { type: Function, required: true },
  session: { type: Object, required: true },
  showError: { type: Function, required: true },
});

const CREATE_REASON = 'Conta criada pelo administrador comercial';
const UPDATE_REASON = 'Conta atualizada pelo administrador comercial';

const heading = ref(null);
const users = ref([]);
const loading = ref(true);
const busy = ref(false);
/** Credentials of the account just created, kept only until the panel closes. */
const handover = ref(null);
const editing = ref(null);
const copied = ref(false);

const currentUser = computed(() => props.session.user ?? props.session);
const isAdmin = computed(() =>
  (currentUser.value.capabilities ?? []).includes('COMMERCIAL_ADMIN'),
);
const activeCount = computed(
  () => users.value.filter((user) => !user.disabledAt).length,
);

const markdown = computed(() => {
  if (!handover.value) return '';
  return [
    '**Acesso ao CRM Silmer**',
    '',
    `- Nome: ${handover.value.name}`,
    `- E-mail: ${handover.value.email}`,
    `- Senha: ${handover.value.password}`,
    `- Entrar em: ${globalThis.location.origin}`,
  ].join('\n');
});

onMounted(async () => {
  heading.value?.focus();
  await load();
});

async function load() {
  loading.value = true;
  try {
    const response = await request('/api/v1/users');
    users.value = response.data.users ?? [];
  } catch (error) {
    props.showError(publicMessage(error));
  } finally {
    loading.value = false;
  }
}

/** @param {SubmitEvent} event */
async function submitCreate(event) {
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const values = formValues(form);
  props.showError('');
  busy.value = true;
  try {
    await request('/api/v1/users', {
      method: 'POST',
      idempotencyKey: commandKey(),
      body: {
        email: values.email,
        name: values.name,
        password: values.password,
        reason: CREATE_REASON,
      },
    });
    // The password never comes back from the API, so the block is built from
    // what the administrator typed, before the form is cleared.
    handover.value = {
      email: values.email,
      name: values.name,
      password: values.password,
    };
    copied.value = false;
    form.reset();
    await load();
    props.announce(`Conta de ${values.name} criada.`);
  } catch (error) {
    props.showError(publicMessage(error));
  } finally {
    busy.value = false;
  }
}

/** @param {SubmitEvent} event */
async function submitEdit(event) {
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const values = formValues(form);
  const target = editing.value;
  props.showError('');
  busy.value = true;
  try {
    /** @type {Record<string, string>} */
    const body = { reason: UPDATE_REASON };
    if (values.name !== target.name) body.name = values.name;
    if (values.email !== target.email) body.email = values.email;
    if (values.password !== '') body.password = values.password;
    if (Object.keys(body).length === 1) {
      editing.value = null;
      return;
    }
    await request(`/api/v1/users/${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      idempotencyKey: commandKey(),
      body,
    });
    editing.value = null;
    await load();
    props.announce(`Conta de ${values.name} atualizada.`);
  } catch (error) {
    props.showError(publicMessage(error));
  } finally {
    busy.value = false;
  }
}

/** @param {Record<string, any>} user @param {boolean} disabled */
async function changeDisabled(user, disabled) {
  props.showError('');
  busy.value = true;
  try {
    await request(
      `/api/v1/users/${encodeURIComponent(user.id)}/${
        disabled ? 'disable' : 'enable'
      }`,
      {
        method: 'POST',
        idempotencyKey: commandKey(),
        body: { reason: UPDATE_REASON },
      },
    );
    editing.value = null;
    await load();
    props.announce(
      disabled
        ? `Conta de ${user.name} desativada.`
        : `Conta de ${user.name} reativada.`,
    );
  } catch (error) {
    props.showError(publicMessage(error));
  } finally {
    busy.value = false;
  }
}

async function copyMarkdown() {
  try {
    await globalThis.navigator.clipboard.writeText(markdown.value);
    copied.value = true;
    props.announce('Bloco copiado.');
  } catch {
    copied.value = false;
    props.showError('Não foi possível copiar. Selecione o texto manualmente.');
  }
}

/** @param {Record<string, any>} user */
function startEdit(user) {
  props.showError('');
  editing.value = user;
}

/** @param {string | null} value */
function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(value));
}

/** @param {string} name */
function initials(name) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** @param {Record<string, any>} user */
function isAdminUser(user) {
  return (user.capabilities ?? []).includes('COMMERCIAL_ADMIN');
}

/** @param {unknown} error */
function publicMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === 'EMAIL_ALREADY_REGISTERED')
      return 'Esse e-mail já pertence a outra conta.';
    if (error.status === 403)
      return 'Você não tem permissão para concluir esta ação.';
    if (error.status === 404) return 'Essa conta não existe mais.';
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
</script>

<template>
  <div class="page users-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Administração</p>
        <h1 ref="heading" tabindex="-1">Usuários</h1>
        <p>
          Crie e mantenha as contas de vendedores que acessam o CRM. Só
          administradores enxergam esta tela.
        </p>
      </div>
    </header>

    <p v-if="!isAdmin" class="surface" role="status">
      Esta área é exclusiva de administradores comerciais.
    </p>

    <div v-else class="users-layout">
      <section class="surface" aria-labelledby="users-overview">
        <div class="count-line">
          <div>
            <p class="section-kicker">Visão geral</p>
            <h2 id="users-overview">Contas do CRM</h2>
          </div>
          <p v-if="!loading">
            {{ users.length }} contas · {{ activeCount }} ativas ·
            {{ users.length - activeCount }} desativadas
          </p>
        </div>

        <p v-if="loading" role="status">Carregando contas…</p>
        <div v-else class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Usuário</th>
                <th scope="col">Acesso</th>
                <th scope="col">Situação</th>
                <th scope="col">Criado em</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="user in users"
                :key="user.id"
                :data-disabled="Boolean(user.disabledAt)"
              >
                <td>
                  <div class="user-cell">
                    <span class="avatar" aria-hidden="true">
                      {{ initials(user.name) }}
                    </span>
                    <div>
                      <div class="user-name">{{ user.name }}</div>
                      <div class="user-email">{{ user.email }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span
                    class="badge"
                    :data-tone="isAdminUser(user) ? 'info' : undefined"
                  >
                    {{ isAdminUser(user) ? 'Administrador' : 'Vendedor' }}
                  </span>
                </td>
                <td>
                  <span
                    class="badge"
                    :data-tone="user.disabledAt ? 'warning' : 'success'"
                  >
                    {{ user.disabledAt ? 'Desativado' : 'Ativo' }}
                  </span>
                </td>
                <td>{{ formatDate(user.createdAt) }}</td>
                <td>
                  <div class="row-actions">
                    <button
                      class="small"
                      type="button"
                      @click="startEdit(user)"
                    >
                      Editar
                    </button>
                    <button
                      v-if="user.id !== currentUser.id"
                      class="small quiet"
                      type="button"
                      :disabled="busy"
                      @click="changeDisabled(user, !user.disabledAt)"
                    >
                      {{ user.disabledAt ? 'Reativar' : 'Desativar' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="handover"
        class="surface handover-panel"
        aria-labelledby="handover-title"
      >
        <p class="section-kicker">Conta criada</p>
        <h2 id="handover-title">{{ handover.name }}</h2>
        <p class="field-help">
          Copie o bloco abaixo e entregue à pessoa. A senha não volta a ser
          exibida depois que você sair desta tela.
        </p>
        <div class="markdown-head">
          <span class="markdown-label">Markdown</span>
          <button class="small" type="button" @click="copyMarkdown">
            {{ copied ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <pre class="markdown-block"><code>{{ markdown }}</code></pre>
        <div class="button-row">
          <button class="quiet" type="button" @click="handover = null">
            Fechar
          </button>
        </div>
      </section>

      <section v-else class="surface" aria-labelledby="create-user">
        <p class="section-kicker">Nova conta</p>
        <h2 id="create-user">Criar vendedor</h2>
        <form @submit.prevent="submitCreate">
          <label for="new-name">Nome</label>
          <input id="new-name" name="name" type="text" required />
          <label for="new-email">E-mail</label>
          <input id="new-email" name="email" type="email" required />
          <label for="new-password">Senha</label>
          <input
            id="new-password"
            name="password"
            type="text"
            autocomplete="off"
            required
          />
          <p class="field-help">
            Você define a senha. Ela aparece uma única vez, no bloco pronto para
            copiar.
          </p>
          <div class="button-row">
            <button class="primary" type="submit" :disabled="busy">
              {{ busy ? 'Criando…' : 'Criar vendedor' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <p class="section-kicker">Editar usuário</p>
        <h2 id="edit-title">{{ editing.name }}</h2>
        <form @submit.prevent="submitEdit">
          <label for="edit-name">Nome</label>
          <input
            id="edit-name"
            name="name"
            type="text"
            :value="editing.name"
            required
          />
          <label for="edit-email">E-mail</label>
          <input
            id="edit-email"
            name="email"
            type="email"
            :value="editing.email"
            required
          />
          <label for="edit-password">Nova senha</label>
          <input
            id="edit-password"
            name="password"
            type="text"
            autocomplete="off"
            placeholder="Deixe em branco para manter a atual"
          />
          <p class="field-help">
            Trocar a senha não derruba as sessões abertas: ela vale a partir do
            próximo login.
          </p>
          <div class="dialog-footer">
            <button
              v-if="editing.id !== currentUser.id && !editing.disabledAt"
              class="danger"
              type="button"
              :disabled="busy"
              @click="changeDisabled(editing, true)"
            >
              Desativar conta
            </button>
            <span v-else></span>
            <div class="button-row">
              <button class="quiet" type="button" @click="editing = null">
                Cancelar
              </button>
              <button class="primary" type="submit" :disabled="busy">
                {{ busy ? 'Salvando…' : 'Salvar alterações' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
