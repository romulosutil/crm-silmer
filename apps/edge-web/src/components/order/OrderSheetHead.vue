<script setup>
import { computed, ref, watch } from 'vue';
import OrderIcon from './OrderIcon.vue';

/*
 * PFI-17 (RFC 024): the head of every section of the order — the title, the
 * state in words and "Editar <seção>". The h2 holds only the title, so the
 * region keeps the title as its name; the state is plain text next to it,
 * with an icon and never only a colour.
 *
 * PFI-06: while another section is in edit the button stays focusable with
 * aria-disabled and says why; activating it opens nothing and keeps the open
 * edit. The reason shows on screen once someone tries it.
 */
const props = defineProps({
  blocked: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  editLabel: { type: String, default: '' },
  editing: { type: Boolean, default: false },
  state: { type: String, default: '' },
  title: { type: String, required: true },
  titleId: { type: String, required: true },
  tone: {
    type: String,
    default: 'neutral',
    validator: (value) => ['ok', 'missing', 'neutral'].includes(String(value)),
  },
});
const emit = defineEmits(['edit']);

const reasonId = computed(() => `${props.titleId}-edit-reason`);
const tried = ref(false);

watch(
  () => props.blocked,
  (blocked) => {
    if (!blocked) tried.value = false;
  },
);

function activate() {
  if (props.blocked) {
    tried.value = true;
    return;
  }
  emit('edit');
}
</script>

<template>
  <div class="op-sheet-head">
    <h2 :id="titleId">{{ title }}</h2>
    <p v-if="state" class="op-sheet-state op-num" :data-tone="tone">
      <OrderIcon v-if="tone === 'ok'" name="check" />
      <OrderIcon v-else-if="tone === 'missing'" name="alert" />
      {{ state }}
    </p>
    <span v-if="editing" class="op-editing-tag">Editando</span>
    <template v-else-if="canEdit">
      <button
        type="button"
        class="op-edit"
        :aria-disabled="blocked || undefined"
        :aria-describedby="blocked ? reasonId : undefined"
        @click="activate"
      >
        <OrderIcon name="pencil" />{{ editLabel }}
      </button>
      <p
        v-if="blocked"
        :id="reasonId"
        class="op-edit-reason"
        :class="{ 'op-visually-hidden': !tried }"
      >
        Salve ou cancele a edição aberta.
      </p>
    </template>
  </div>
</template>
