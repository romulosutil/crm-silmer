<script setup>
import { computed, ref } from 'vue';
import {
  NOT_APPLICABLE,
  colorSwatch,
  fieldOptions,
} from '../../lib/order-catalog.js';
import { joinComposite, splitComposite } from '../../lib/order-items.js';
import OrderCombobox from './OrderCombobox.vue';
import OrderIcon from './OrderIcon.vue';

// One field of an item card, drawn by its kind (design → Campos do item). It
// emits the new value; the items section owns the draft.
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { type: [String, Array], default: '' },
  productId: { type: String, default: null },
  inputId: { type: String, required: true },
  // PFI-07 survives only for a product outside the catalog (F14).
  allowNotApplicable: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const options = computed(() => fieldOptions(props.field.list, props.productId));
const colorOptions = computed(() =>
  props.field.colorList
    ? fieldOptions(props.field.colorList, props.productId)
    : [],
);
const isColor = computed(() => props.field.list === 'cores');
const text = computed(() =>
  Array.isArray(props.modelValue) ? '' : String(props.modelValue ?? ''),
);
const entries = computed(() => {
  const list = Array.isArray(props.modelValue) ? props.modelValue : [];
  return list.length > 0 ? list.map(String) : [''];
});
const parts = computed(() => splitComposite(text.value));
const notApplicable = computed(() => text.value === NOT_APPLICABLE);
const previous = ref('');

/** @param {number} index @param {string} value */
function setEntry(index, value) {
  const next = [...entries.value];
  next[index] = value;
  emit('update:modelValue', next);
}

function addEntry() {
  emit('update:modelValue', [...entries.value, '']);
}

/** @param {number} index */
function removeEntry(index) {
  emit(
    'update:modelValue',
    entries.value.filter((_entry, at) => at !== index),
  );
}

/**
 * Unchecking restores what was typed before, because an unchecked box means
 * "there is a colour here", not "erase it".
 *
 * @param {boolean} checked
 */
function toggleNotApplicable(checked) {
  if (checked) {
    previous.value = text.value;
    emit('update:modelValue', NOT_APPLICABLE);
    return;
  }
  emit('update:modelValue', previous.value);
}
</script>

<template>
  <div
    class="op-field"
    :class="{
      'op-field--wide': field.kind !== 'text' || field.placement === 'wide',
    }"
  >
    <template v-if="field.kind === 'multi'">
      <span class="op-label">{{ field.label }}</span>
      <div v-for="(entry, index) in entries" :key="index" class="op-input-row">
        <OrderCombobox
          :id="`${inputId}-${index}`"
          :model-value="entry"
          :groups="options"
          :aria-label="`${field.label} ${index + 1}`"
          @update:model-value="(value) => setEntry(index, value)"
        />
        <button
          v-if="entries.length > 1"
          type="button"
          class="op-icon-button"
          @click="removeEntry(index)"
        >
          <OrderIcon name="x" />
          <span class="op-visually-hidden">{{
            `Remover ${field.label.toLowerCase()} ${index + 1}`
          }}</span>
        </button>
      </div>
      <button type="button" class="op-add-inline" @click="addEntry">
        <OrderIcon name="plus" />{{ field.addLabel }}
      </button>
    </template>

    <template v-else-if="field.kind === 'composite'">
      <span :id="`${inputId}-label`" class="op-label">{{ field.label }}</span>
      <div
        class="op-input-pair"
        role="group"
        :aria-labelledby="`${inputId}-label`"
      >
        <OrderCombobox
          :id="inputId"
          :model-value="notApplicable ? NOT_APPLICABLE_LABEL : parts[0]"
          :groups="options"
          :aria-label="`${field.label}: acabamento`"
          :disabled="notApplicable"
          @update:model-value="
            (value) => emit('update:modelValue', joinComposite(value, parts[1]))
          "
        />
        <div class="op-input-swatch">
          <span
            v-if="!notApplicable && colorSwatch(parts[1])"
            class="op-swatch"
            :style="{ background: colorSwatch(parts[1]) }"
            aria-hidden="true"
          ></span>
          <OrderCombobox
            :id="`${inputId}-cor`"
            :model-value="notApplicable ? '' : parts[1]"
            :groups="colorOptions"
            :aria-label="`${field.label}: cor`"
            :disabled="notApplicable"
            @update:model-value="
              (value) =>
                emit('update:modelValue', joinComposite(parts[0], value))
            "
          />
        </div>
      </div>
    </template>

    <template v-else>
      <label :for="inputId">{{ field.label }}</label>
      <div :class="{ 'op-input-swatch': isColor }">
        <span
          v-if="isColor && !notApplicable && colorSwatch(text)"
          class="op-swatch"
          :style="{ background: colorSwatch(text) }"
          aria-hidden="true"
        ></span>
        <OrderCombobox
          :id="inputId"
          :model-value="notApplicable ? NOT_APPLICABLE_LABEL : text"
          :groups="options"
          :disabled="notApplicable"
          @update:model-value="(value) => emit('update:modelValue', value)"
        />
      </div>
    </template>

    <label v-if="allowNotApplicable && field.kind !== 'multi'" class="op-check">
      <input
        type="checkbox"
        :checked="notApplicable"
        :aria-label="`${field.label} não se aplica`"
        @change="toggleNotApplicable($event.target.checked)"
      />
      <span aria-hidden="true">Não aplicável</span>
    </label>
  </div>
</template>
