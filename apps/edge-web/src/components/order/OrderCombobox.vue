<script setup>
import { computed, ref } from 'vue';
import { foldText } from '../../lib/order-catalog.js';
import OrderIcon from './OrderIcon.vue';

// ARIA 1.2 editable combobox with list autocomplete (F21). The list only
// suggests: whatever is typed stays the value (F08). The list is named
// "Sugestões", not after the field, so a label finds the input alone.
const props = defineProps({
  id: { type: String, required: true },
  modelValue: { type: String, default: '' },
  groups: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '' },
  ariaDescribedby: { type: String, default: '' },
  invalid: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const filter = ref('');
const active = ref(-1);

/** @typedef {{value: string, label: string, swatch?: string}} Option */

const shown = computed(() => {
  const wanted = foldText(filter.value);
  return /** @type {{label: string, options: Option[]}[]} */ (props.groups)
    .map((group) => ({
      label: group.label,
      options: group.options.filter(
        (option) =>
          wanted === '' ||
          foldText(option.value).includes(wanted) ||
          foldText(option.label).includes(wanted),
      ),
    }))
    .filter((group) => group.options.length > 0);
});
const flat = computed(() => shown.value.flatMap((group) => group.options));
const listId = computed(() => `${props.id}-list`);
const expanded = computed(() => open.value && flat.value.length > 0);
const activeId = computed(() =>
  expanded.value && active.value >= 0
    ? `${props.id}-option-${active.value}`
    : undefined,
);

/** @param {Option} option */
function indexOf(option) {
  return flat.value.indexOf(option);
}

function close() {
  open.value = false;
  active.value = -1;
}

/** @param {boolean} fromTyping */
function show(fromTyping) {
  if (!fromTyping) filter.value = '';
  open.value = true;
}

/** @param {Event} event */
function onInput(event) {
  const value = /** @type {HTMLInputElement} */ (event.target).value;
  emit('update:modelValue', value);
  filter.value = value;
  active.value = -1;
  open.value = true;
}

/** @param {Option} option */
function pick(option) {
  emit('update:modelValue', option.value);
  close();
}

/** @param {number} delta */
function move(delta) {
  if (!open.value) show(false);
  const count = flat.value.length;
  if (count === 0) return;
  if (active.value < 0) active.value = delta > 0 ? 0 : count - 1;
  else active.value = (active.value + delta + count) % count;
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && expanded.value && active.value >= 0) {
    // Enter picks the highlighted option instead of submitting the form.
    event.preventDefault();
    pick(flat.value[active.value]);
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    close();
  }
}

function toggle() {
  if (open.value) close();
  else show(false);
}
</script>

<template>
  <div class="op-combo">
    <input
      :id="id"
      type="text"
      role="combobox"
      autocomplete="off"
      autocapitalize="characters"
      aria-autocomplete="list"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      :aria-label="ariaLabel || undefined"
      :aria-describedby="ariaDescribedby || undefined"
      :aria-invalid="invalid || undefined"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput"
      @keydown="onKeydown"
      @blur="close"
    />
    <button
      type="button"
      class="op-combo-toggle"
      tabindex="-1"
      :disabled="disabled"
      @mousedown.prevent
      @click="toggle"
    >
      <OrderIcon name="chevron" />
      <span class="op-visually-hidden">Mostrar sugestões</span>
    </button>
    <div
      v-show="expanded"
      :id="listId"
      role="listbox"
      class="op-combo-list"
      aria-label="Sugestões"
    >
      <div
        v-for="(group, groupIndex) in shown"
        :key="group.label"
        role="group"
        :aria-labelledby="`${id}-group-${groupIndex}`"
      >
        <div
          :id="`${id}-group-${groupIndex}`"
          role="presentation"
          class="op-combo-group"
        >
          {{ group.label }}
        </div>
        <div
          v-for="option in group.options"
          :id="`${id}-option-${indexOf(option)}`"
          :key="option.value"
          role="option"
          class="op-combo-option"
          :aria-selected="indexOf(option) === active ? 'true' : 'false'"
          @mousedown.prevent="pick(option)"
        >
          <span
            v-if="option.swatch"
            class="op-swatch"
            :style="{ background: option.swatch }"
            aria-hidden="true"
          ></span>
          <span>{{ option.value }}</span>
          <small
            v-if="foldText(option.label) !== foldText(option.value)"
            class="op-combo-note"
            >{{ option.label }}</small
          >
        </div>
      </div>
    </div>
  </div>
</template>
