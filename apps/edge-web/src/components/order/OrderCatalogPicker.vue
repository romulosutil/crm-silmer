<script setup>
import { computed, nextTick, ref } from 'vue';
import { commandKey } from '../../lib/api-client.js';
import { colorSwatch } from '../../lib/order-catalog.js';
import OrderIcon from './OrderIcon.vue';

const props = defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  value: { type: String, default: '' },
  options: { type: Array, required: true },
  kind: { type: String, required: true },
  describedBy: { type: String, default: undefined },
  createOption: { type: Function, required: true },
  invalid: Boolean,
});
const emit = defineEmits(['choose']);
const root = ref(null);
const trigger = ref(null);
const queryInput = ref(null);
const newInput = ref(null);
const panel = ref(null);
const open = ref(false);
const above = ref(false);
const adding = ref(false);
const query = ref('');
const draft = ref('');
const error = ref('');
const saving = ref(false);
let attempt = null;
const isColor = computed(() => props.kind === 'color');
const addLabel = computed(
  () =>
    ({
      color: 'Outra cor',
      fabric: 'Adicionar nova malha',
      size: 'Adicionar novo tamanho',
    })[props.kind],
);
const fold = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
const matches = computed(() => {
  const terms = fold(query.value).split(' ');
  return props.options.filter((label) =>
    terms.every((term) => fold(label).includes(term)),
  );
});

function close(restore = false) {
  open.value = false;
  adding.value = false;
  query.value = '';
  draft.value = '';
  error.value = '';
  attempt = null;
  if (restore) trigger.value?.focus({ preventScroll: true });
}

async function show() {
  if (saving.value) return;
  if (open.value) {
    close();
    return;
  }
  const bounds = trigger.value.getBoundingClientRect();
  above.value =
    globalThis.innerHeight - bounds.bottom < 280 &&
    bounds.top > globalThis.innerHeight - bounds.bottom;
  open.value = true;
  await nextTick();
  (queryInput.value ?? panel.value?.querySelector('[data-choice]'))?.focus({
    preventScroll: true,
  });
}

async function addOption() {
  draft.value = query.value.trim();
  adding.value = true;
  await nextTick();
  newInput.value?.focus();
}

function choose(label) {
  close(true);
  emit('choose', label);
}

async function saveOption() {
  if (saving.value) return;
  const label = draft.value.trim().replace(/\s+/gu, ' ');
  if (!label) {
    error.value = 'Digite o nome da opção.';
    newInput.value?.focus();
    return;
  }
  if (attempt?.label !== label) attempt = { label, key: commandKey() };
  error.value = '';
  saving.value = true;
  try {
    const saved = await props.createOption(label, attempt.key);
    if (!root.value) return;
    close(root.value.contains(globalThis.document.activeElement));
    emit('choose', saved);
  } catch (failure) {
    error.value =
      failure?.code === 'ORDER_ITEM_OPTION_INVALID'
        ? 'Informe um nome de opção válido, sem dados de clientes.'
        : 'Não foi possível adicionar. Tente novamente.';
  } finally {
    saving.value = false;
  }
}

function onFocusOut(event) {
  if (saving.value) return;
  if (root.value?.contains(event.relatedTarget)) return;
  if (event.relatedTarget) {
    close();
    return;
  }
  globalThis.requestAnimationFrame(() => {
    if (
      !saving.value &&
      !root.value?.contains(globalThis.document.activeElement)
    )
      close();
  });
}

function onKeys(event) {
  if (!open.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void show();
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (!saving.value) close(true);
    return;
  }
  if (adding.value || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(
    panel.value?.querySelectorAll('[data-choice]') ?? [],
  );
  const index = buttons.indexOf(event.target);
  const next =
    event.key === 'ArrowDown'
      ? index + 1
      : index < 0
        ? buttons.length - 1
        : index - 1;
  if (next < 0) queryInput.value?.focus();
  else buttons[Math.min(next, buttons.length - 1)]?.focus();
}
</script>

<template>
  <div
    ref="root"
    class="catalog-picker"
    :data-open="open || undefined"
    @focusout="onFocusOut"
    @keydown="onKeys"
  >
    <button
      :id="id"
      ref="trigger"
      type="button"
      class="catalog-picker-trigger"
      :aria-label="label + (value ? `, ${value}` : '')"
      :aria-expanded="open"
      :aria-controls="open ? `${id}-opcoes` : undefined"
      :aria-describedby="describedBy"
      :aria-invalid="invalid || undefined"
      @click="show"
    >
      <span :class="{ 'catalog-picker-placeholder': !value }">{{
        value || (kind === 'size' ? 'Tamanho' : 'Selecionar')
      }}</span>
      <OrderIcon name="chevron" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      :id="`${id}-opcoes`"
      ref="panel"
      class="catalog-picker-panel"
      :data-above="above || undefined"
      role="group"
      :aria-label="`Opções de ${label}`"
    >
      <form
        v-if="adding"
        class="catalog-picker-add"
        @submit.prevent="saveOption"
      >
        <label :for="`${id}-novo`">{{
          isColor
            ? 'Nome da cor'
            : kind === 'fabric'
              ? 'Nome da malha'
              : 'Nome do tamanho'
        }}</label>
        <input
          :id="`${id}-novo`"
          ref="newInput"
          v-model="draft"
          maxlength="80"
          autocomplete="off"
          :readonly="saving"
          :aria-invalid="Boolean(error) || undefined"
          @input="error = ''"
        />
        <p v-if="error" class="op-field-error" role="alert">{{ error }}</p>
        <p v-else class="op-hint">
          A opção ficará disponível nos próximos pedidos.
        </p>
        <div class="catalog-picker-actions">
          <button
            type="button"
            class="catalog-picker-option"
            :disabled="saving"
            @click="close(true)"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="catalog-picker-submit"
            :disabled="saving"
          >
            {{ saving ? 'Adicionando…' : 'Adicionar' }}
          </button>
        </div>
      </form>
      <template v-else>
        <input
          v-if="isColor"
          ref="queryInput"
          v-model="query"
          type="search"
          aria-label="Buscar cor"
          placeholder="Buscar cor"
          autocomplete="off"
        />
        <p
          v-if="matches.length === 0"
          class="op-hint catalog-picker-empty"
          role="status"
        >
          Nenhuma cor encontrada.
        </p>
        <div class="catalog-picker-list">
          <button
            v-for="option in matches"
            :key="option"
            type="button"
            class="catalog-picker-option"
            :aria-pressed="option === value"
            data-choice
            @click="choose(option)"
          >
            <span
              v-if="isColor && colorSwatch(option)"
              class="op-swatch"
              :style="{ background: colorSwatch(option) }"
              aria-hidden="true"
            ></span>
            {{ option }}
          </button>
        </div>
        <button
          type="button"
          class="catalog-picker-option catalog-picker-new"
          data-choice
          @click="addOption"
        >
          <OrderIcon name="plus" aria-hidden="true" />{{ addLabel }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.catalog-picker {
  position: relative;
  inline-size: 100%;
  min-inline-size: 0;
}
.catalog-picker[data-open] {
  z-index: 12;
}
:global(.op-inline-input) > .catalog-picker {
  flex: 1 1 4.5rem;
}
.catalog-picker-trigger,
.catalog-picker-option,
.catalog-picker-submit {
  min-block-size: var(--control-height);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text);
  font: inherit;
}
.catalog-picker-trigger {
  justify-content: space-between;
  inline-size: 100%;
  padding-inline: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: start;
}
.catalog-picker-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-picker-trigger svg,
.catalog-picker-option svg {
  flex: none;
  inline-size: 1em;
  block-size: 1em;
}
.catalog-picker-placeholder {
  color: var(--color-text-muted);
}
.catalog-picker-panel {
  position: absolute;
  inset-block-start: calc(100% + var(--space-1));
  inset-inline-start: 0;
  inline-size: max(100%, min(14rem, 55vw));
  padding: var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}
.catalog-picker-panel[data-above] {
  inset-block: auto calc(100% + var(--space-1));
}
.catalog-picker-panel input {
  inline-size: 100%;
  min-inline-size: 0;
  font-size: var(--text-base);
}
.catalog-picker-list {
  max-block-size: min(12rem, 28vh);
  overflow: auto;
}
.catalog-picker-option {
  inline-size: 100%;
  justify-content: flex-start;
  padding-inline: var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: start;
  overflow-wrap: anywhere;
}
.catalog-picker-option:hover,
.catalog-picker-option[aria-pressed='true'] {
  background: var(--color-surface-muted);
}
.catalog-picker-new {
  color: var(--color-text);
  font-weight: var(--weight-semibold);
  border-block-start: 1px solid var(--color-border-strong);
  border-start-start-radius: 0;
  border-start-end-radius: 0;
}
.catalog-picker-empty,
.catalog-picker-add {
  padding: var(--space-2);
}
.catalog-picker-add label {
  display: block;
  margin-block-end: var(--space-1);
}
.catalog-picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-block-start: var(--space-2);
}
.catalog-picker-actions .catalog-picker-option,
.catalog-picker-submit {
  inline-size: auto;
}
.catalog-picker-submit {
  padding-inline: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.catalog-picker-trigger:focus-visible,
.catalog-picker-option:focus-visible,
.catalog-picker-submit:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
.catalog-picker-trigger[aria-invalid='true'] {
  border-color: var(--status-error-text);
}
</style>
