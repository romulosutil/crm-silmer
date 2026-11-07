<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { commandKey, request } from '../../lib/api-client.js';
import { formatBrl, parseBrl } from '../../lib/order-format.js';

const props = defineProps({
  order: { type: Object, required: true },
  blocked: { type: Boolean, default: false },
  commercialLocked: { type: Boolean, default: false },
});
const emit = defineEmits(['changed']);
const session = inject('sessionUser', ref({}));
const orderEditing = inject('orderEditing', null);
const source = ref(null);
const busy = ref(false);
const editing = ref(false);
const conflict = ref(false);
const denied = ref(false);
const error = ref('');
const message = ref('');
const heading = ref(null);
const notice = ref(null);
const form = ref(null);
const editButton = ref(null);
const subtotals = ref({});
const deliveryOn = ref('');
const applications = ref({});
const registration = ref({});
const fields = [
  { key: 'document', label: 'CPF ou CNPJ', max: 18 },
  { key: 'legalName', label: 'Nome ou razão social', max: 150 },
  { key: 'stateRegistration', label: 'Inscrição estadual ou ISENTO', max: 30 },
  { key: 'postalCode', label: 'CEP', max: 9 },
  { key: 'city', label: 'Cidade', max: 80 },
  { key: 'state', label: 'UF', max: 2 },
  { key: 'street', label: 'Logradouro', max: 150 },
  { key: 'district', label: 'Bairro', max: 80 },
  { key: 'number', label: 'Número ou S/N', max: 10 },
  { key: 'complement', label: 'Complemento (opcional)', max: 80 },
  { key: 'instagram', label: 'Instagram (opcional)', max: 50 },
];
let controller;
let disposed = false;
const isStore = computed(() => props.order.origin === 'loja');
const canWrite = computed(() => {
  const user = session.value;
  const admin = (user.capabilities ?? []).includes('COMMERCIAL_ADMIN');
  return (
    !denied.value &&
    !props.commercialLocked &&
    !props.order.cancelledAt &&
    (isStore.value || Boolean(props.order.confirmedAt)) &&
    (isStore.value ? admin : admin || props.order.seller?.id === user.id)
  );
});
const base = computed(
  () => `/api/v1/orders/${encodeURIComponent(props.order.id)}/price-breakdown`,
);
const available = computed(
  () => source.value && source.value.mode !== 'managed',
);
const needsInitialize = computed(
  () => source.value && !source.value.sourceValid,
);
const canSubmit = computed(
  () =>
    canWrite.value && !blockedElsewhere.value && !busy.value && !conflict.value,
);
const blockedElsewhere = computed(
  () =>
    props.blocked && orderEditing?.editingSection.value !== 'price-breakdown',
);

function stopEditing() {
  editing.value = false;
  if (orderEditing?.editingSection.value === 'price-breakdown')
    orderEditing.stop();
}

/** @param {string} groupId */
function groupSubtotal(groupId) {
  const cents = source.value?.pricing?.groups?.find(
    (group) => group.id === groupId,
  )?.subtotalCents;
  return Number.isSafeInteger(cents) && cents > 0
    ? `R$ ${formatBrl(cents)}`
    : 'A conferir';
}

/** @param {import('vue').Ref<any>} target */
async function focus(target) {
  await nextTick();
  if (!disposed) target.value?.focus();
}

function copyDraft() {
  subtotals.value = Object.fromEntries(
    (source.value?.groups ?? []).flatMap((group) =>
      group.lines.map((line) => [
        line.id,
        line.subtotalCents === null ? '' : formatBrl(line.subtotalCents),
      ]),
    ),
  );
  const details = source.value?.details;
  deliveryOn.value = details?.deliveryOn ?? '';
  applications.value = Object.fromEntries(
    (source.value?.groups ?? []).map((group) => [
      group.id,
      details?.applications?.find((entry) => entry.groupId === group.id)
        ?.application ?? '',
    ]),
  );
  registration.value = {
    personType: details?.registration?.personType ?? '',
    ...Object.fromEntries(
      fields.map((field) => [
        field.key,
        details?.registration?.[field.key] ?? '',
      ]),
    ),
  };
}

/** @param {any} cause */
function failure(cause) {
  if (cause?.status === 401 || cause?.status === 403) {
    denied.value = true;
    source.value = null;
    stopEditing();
    return 'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.';
  }
  if (cause?.code === 'SIZE_PRICING_AMOUNT_MISMATCH')
    return 'A soma dos subtotais deve ser igual ao valor histórico do pedido. Confira cada tamanho.';
  if (
    cause?.code === 'ORDER_SOURCE_LOCKED' ||
    cause?.code === 'ORDER_CANCELLED'
  ) {
    conflict.value = true;
    return 'O pedido está bloqueado para alteração. Atualize os dados para conferir a situação.';
  }
  if (cause?.status === 409) {
    conflict.value = true;
    return 'O pedido ou complemento mudou em outra sessão. Cancele a edição e confira os dados atuais.';
  }
  if (cause?.status === 422 || cause?.status === 400)
    return 'Confira os subtotais e os dados do cadastro. Use valores positivos em reais e datas válidas.';
  if (cause?.status === 429)
    return 'Aguarde um momento antes de consultar novamente.';
  return 'Não foi possível confirmar a alteração. Atualize os dados antes de continuar.';
}

async function load(moveFocus = false) {
  if (busy.value) return;
  controller?.abort();
  const own = new AbortController();
  controller = own;
  busy.value = true;
  error.value = '';
  message.value = '';
  source.value = null;
  stopEditing();
  conflict.value = false;
  try {
    const response = await request(base.value, { signal: own.signal });
    if (disposed || own.signal.aborted || controller !== own) return;
    source.value = response.data;
    copyDraft();
  } catch (cause) {
    if (disposed || own.signal.aborted || controller !== own) return;
    error.value = failure(cause);
  } finally {
    if (!disposed && controller === own) {
      busy.value = false;
      if (moveFocus) await focus(error.value ? notice : heading);
    }
  }
}

async function beginEdit() {
  if (!canSubmit.value) return;
  copyDraft();
  error.value = '';
  message.value = '';
  editing.value = true;
  orderEditing?.start('price-breakdown');
  await nextTick();
  form.value?.querySelector('input, select')?.focus();
}

async function cancel() {
  if (busy.value) return;
  stopEditing();
  if (conflict.value) await load(true);
  else {
    copyDraft();
    error.value = '';
    await focus(editButton);
  }
}

/** @param {Record<string, any>} value */
async function write(value) {
  if (!canSubmit.value || !source.value) return;
  const own = new AbortController();
  controller?.abort();
  controller = own;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const response = await request(base.value, {
      method: 'POST',
      body: { expectedVersion: source.value.orderVersion, value },
      idempotencyKey: commandKey(),
      signal: own.signal,
    });
    if (disposed || own.signal.aborted || controller !== own) return;
    source.value = response.data;
    stopEditing();
    copyDraft();
    message.value = 'Complemento salvo. Confira novamente a prévia Olist.';
    emit('changed');
  } catch (cause) {
    if (disposed || own.signal.aborted || controller !== own) return;
    error.value = failure(cause);
    // A lost response may already have committed. A fresh GET is required
    // before a new key can write; no automatic replay or blind retry.
    if (!cause?.status || cause.status >= 500) conflict.value = true;
  } finally {
    if (!disposed && controller === own) {
      busy.value = false;
      await focus(notice);
    }
  }
}

async function save() {
  if (!canSubmit.value) return;
  if (isStore.value) {
    await write({
      action: 'set_store_details',
      deliveryOn: deliveryOn.value || null,
      applications: source.value.groups.map((group) => ({
        groupId: group.id,
        application: applications.value[group.id]?.trim() || null,
      })),
      registration: Object.fromEntries(
        Object.entries(registration.value).map(([key, value]) => [
          key,
          String(value).trim() || null,
        ]),
      ),
    });
    return;
  }
  const lines = source.value.groups.flatMap((group) =>
    group.lines.map((line) => ({
      groupId: group.id,
      lineId: line.id,
      subtotalCents: subtotals.value[line.id]?.trim()
        ? parseBrl(subtotals.value[line.id])
        : null,
    })),
  );
  if (
    lines.some(
      (line) =>
        subtotals.value[line.lineId]?.trim() && line.subtotalCents === null,
    )
  ) {
    error.value =
      'Use subtotais positivos em reais, como 1.250,00. Deixe vazio somente o que ainda falta conferir.';
    await focus(notice);
    return;
  }
  await write({ action: 'set_subtotals', lines });
}

watch(
  () => props.commercialLocked,
  (locked) => {
    if (!locked) return;
    const wasEditing = editing.value;
    controller?.abort();
    busy.value = false;
    conflict.value = true;
    stopEditing();
    subtotals.value = {};
    deliveryOn.value = '';
    applications.value = {};
    registration.value = {};
    message.value = '';
    error.value =
      'Existe uma operação Olist para este pedido. O complemento está bloqueado para alteração.';
    if (wasEditing) void focus(notice);
  },
);
watch(
  () => [
    props.order.id,
    props.order.version,
    session.value.id,
    JSON.stringify(session.value.capabilities),
  ],
  () => {
    controller?.abort();
    busy.value = false;
    denied.value = false;
    source.value = null;
    stopEditing();
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  stopEditing();
});
</script>

<template>
  <section
    v-if="available || busy || error"
    class="op-sheet op-price-breakdown"
    aria-labelledby="order-complement-title"
    :aria-busy="busy"
  >
    <div class="op-sheet-body">
      <h2 id="order-complement-title" ref="heading" tabindex="-1">
        Complemento para o Olist
      </h2>
      <p class="op-hint">
        Os dados complementares preservam a ficha, o pagamento e o valor
        histórico do pedido.
      </p>
      <p v-if="busy" role="status">Carregando complemento…</p>
      <p
        v-if="error || message"
        ref="notice"
        :class="error ? 'op-alert' : 'op-hint'"
        :role="error ? 'alert' : 'status'"
        tabindex="-1"
      >
        {{ error || message }}
      </p>
      <template v-if="available">
        <p v-if="!canWrite" class="op-hint">
          Peça ao responsável pelo pedido ou a um administrador para completar
          os dados. Na loja, somente um administrador pode completar o cadastro.
        </p>
        <p v-if="needsInitialize" class="op-hint">
          {{
            source.revision
              ? 'O pedido mudou. Inicie uma nova composição e confira os valores por tamanho.'
              : 'Este pedido ainda precisa de uma composição complementar para a prévia Olist.'
          }}
        </p>
        <button
          v-if="needsInitialize && canWrite"
          type="button"
          class="secondary"
          :disabled="!canSubmit"
          @click="write({ action: 'initialize' })"
        >
          Iniciar complemento
        </button>
        <template v-if="!needsInitialize">
          <p class="op-hint">
            {{
              source.pricing?.complete && !source.issues?.length
                ? 'Complemento completo para conferência.'
                : 'Confira os subtotais e os dados que ainda faltam antes da prévia.'
            }}
          </p>
          <div
            v-for="(group, index) in source.groups"
            :key="group.id"
            class="op-complement-group"
          >
            <h3>Grupo {{ index + 1 }}</h3>
            <dl class="op-complement-lines">
              <template v-for="line in group.lines" :key="line.id">
                <dt>{{ line.size }} · {{ line.quantity }} peças</dt>
                <dd>
                  {{
                    line.subtotalCents === null
                      ? 'Subtotal não informado'
                      : `R$ ${formatBrl(line.subtotalCents)}`
                  }}
                </dd>
              </template>
            </dl>
            <p>
              Subtotal do grupo: <strong>{{ groupSubtotal(group.id) }}</strong>
            </p>
          </div>
          <p v-if="source.pricing?.complete">
            <strong
              >Total: R$ {{ formatBrl(source.pricing.totalCents) }}</strong
            >
          </p>
          <dl v-if="isStore" class="op-complement-lines">
            <dt>Previsão de entrega complementar</dt>
            <dd>{{ source.details?.deliveryOn || 'Não informada' }}</dd>
            <template
              v-for="(entry, index) in source.details?.applications ?? []"
              :key="entry.groupId"
            >
              <dt>Aplicação complementar do grupo {{ index + 1 }}</dt>
              <dd>{{ entry.application || 'Não informada' }}</dd>
            </template>
            <dt>Nome ou razão social do cadastro</dt>
            <dd>
              {{ source.details?.registration?.legalName || 'Não informado' }}
            </dd>
          </dl>
          <button
            v-if="canWrite && !editing"
            ref="editButton"
            type="button"
            class="secondary"
            :disabled="!canSubmit"
            @click="beginEdit"
          >
            Editar complemento
          </button>
          <form v-if="editing" ref="form" @submit.prevent="save">
            <fieldset
              :disabled="busy || conflict || blockedElsewhere || !canWrite"
              class="op-complement-fields"
            >
              <legend>
                {{
                  isStore
                    ? 'Cadastro complementar da loja'
                    : 'Subtotais por tamanho'
                }}
              </legend>
              <template v-if="!isStore">
                <template
                  v-for="(group, index) in source.groups"
                  :key="group.id"
                >
                  <div
                    v-for="line in group.lines"
                    :key="line.id"
                    class="op-field"
                  >
                    <label :for="`complement-subtotal-${line.id}`"
                      >Subtotal do grupo {{ index + 1 }}, tamanho
                      {{ line.size }} (R$)</label
                    >
                    <input
                      :id="`complement-subtotal-${line.id}`"
                      v-model="subtotals[line.id]"
                      type="text"
                      inputmode="decimal"
                      autocomplete="off"
                      maxlength="22"
                    />
                    <p class="op-hint">
                      Valor das {{ line.quantity }} peças deste tamanho.
                    </p>
                  </div>
                </template>
              </template>
              <template v-else>
                <div class="op-field">
                  <label for="complement-delivery">Previsão de entrega</label>
                  <input
                    id="complement-delivery"
                    v-model="deliveryOn"
                    type="date"
                  />
                </div>
                <div
                  v-for="(group, index) in source.groups"
                  :key="group.id"
                  class="op-field"
                >
                  <label :for="`complement-application-${group.id}`"
                    >Aplicação do grupo {{ index + 1 }}</label
                  >
                  <input
                    :id="`complement-application-${group.id}`"
                    v-model="applications[group.id]"
                    type="text"
                    maxlength="200"
                  />
                </div>
                <p class="op-hint">
                  Preencha somente dados conferidos com o cliente. Dados já
                  presentes no pedido devem ser preservados.
                </p>
                <div class="op-field">
                  <label for="complement-person-type">Tipo de pessoa</label>
                  <select
                    id="complement-person-type"
                    v-model="registration.personType"
                  >
                    <option value="">Não informado</option>
                    <option value="individual">Pessoa física</option>
                    <option value="company">Pessoa jurídica</option>
                  </select>
                </div>
                <div v-for="field in fields" :key="field.key" class="op-field">
                  <label :for="`complement-${field.key}`">{{
                    field.label
                  }}</label>
                  <input
                    :id="`complement-${field.key}`"
                    v-model="registration[field.key]"
                    type="text"
                    :maxlength="field.max"
                    autocomplete="off"
                  />
                </div>
              </template>
            </fieldset>
            <div class="op-form-actions">
              <button type="submit" class="primary" :disabled="!canSubmit">
                {{ busy ? 'Salvando…' : 'Salvar complemento' }}
              </button>
              <button type="button" :disabled="busy" @click="cancel">
                Cancelar
              </button>
            </div>
          </form>
        </template>
      </template>
      <button
        v-if="error && !editing && !denied"
        type="button"
        class="secondary"
        :disabled="busy || blocked"
        @click="load(true)"
      >
        Atualizar complemento
      </button>
    </div>
  </section>
</template>

<style scoped>
.op-price-breakdown h2 {
  margin-block: 0 var(--space-3);
}
.op-complement-group {
  margin-block: var(--space-4);
}
.op-complement-lines {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
.op-complement-lines dd {
  margin: 0;
  text-align: end;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.op-complement-fields {
  border: 0;
  padding: 0;
  margin-block: var(--space-4);
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.op-complement-fields legend {
  margin-bottom: var(--space-3);
  font-weight: 600;
}
.op-complement-fields .op-field {
  min-width: 0;
}
.op-complement-fields input,
.op-complement-fields select {
  width: 100%;
  min-width: 0;
}
</style>
