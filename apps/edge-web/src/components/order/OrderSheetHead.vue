<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
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
 *
 * PFI-18: on a phone the title and the state become the button that opens
 * and closes the section (aria-expanded, aria-controls). The region is still
 * named by the title alone, and "Editar <seção>" stays a sibling of the h2,
 * shown only while the section is open. While any section is in edit the
 * heads wait like the "Editar" buttons do, so nothing closes over a draft.
 */
const props = defineProps({
  blocked: { type: Boolean, default: false },
  /** PFI-18: the id of the body this head opens and closes on a phone. */
  bodyId: { type: String, default: '' },
  canEdit: { type: Boolean, default: false },
  editLabel: { type: String, default: '' },
  editing: { type: Boolean, default: false },
  /** PFI-18: the section key the order page opens and closes. */
  section: { type: String, default: '' },
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

const orderEditing = inject('orderEditing', null);
const reasonId = computed(() => `${props.titleId}-edit-reason`);
const tried = ref(false);

const accordion = computed(() =>
  Boolean(props.section && props.bodyId && orderEditing?.isPhone?.value),
);
const expanded = computed(
  () =>
    !accordion.value ||
    Boolean(orderEditing?.isSectionOpen?.(props.section) ?? true),
);
const toggleBlocked = computed(
  () => accordion.value && (orderEditing?.editingSection?.value ?? '') !== '',
);
const toggleReasonId = computed(() => `${props.titleId}-toggle-reason`);
const toggleTried = ref(false);
const toggleButton = ref(null);

watch(
  () => props.blocked,
  (blocked) => {
    if (!blocked) tried.value = false;
  },
);
watch(toggleBlocked, (blocked) => {
  if (!blocked) toggleTried.value = false;
});

function activate() {
  if (props.blocked) {
    tried.value = true;
    return;
  }
  emit('edit');
}

/**
 * A native button: Enter and Space toggle it and the focus stays on it. When
 * the section above closes, the head moves up; it is brought back into view.
 */
async function toggle() {
  if (toggleBlocked.value) {
    toggleTried.value = true;
    return;
  }
  orderEditing?.toggleSection?.(props.section);
  await nextTick();
  toggleButton.value?.scrollIntoView?.({ block: 'nearest' });
}
</script>

<template>
  <div
    class="op-sheet-head"
    :data-accordion="accordion || undefined"
    :data-collapsed="!expanded || undefined"
  >
    <h2 v-if="accordion" class="op-sheet-title">
      <button
        ref="toggleButton"
        type="button"
        class="op-sheet-toggle"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="bodyId"
        :aria-disabled="toggleBlocked || undefined"
        :aria-describedby="toggleBlocked ? toggleReasonId : undefined"
        @click="toggle"
      >
        <span class="op-sheet-toggle-text">
          <span :id="titleId" class="op-sheet-toggle-title">{{ title }}</span>
          <span v-if="state" class="op-visually-hidden">, </span>
          <span v-if="state" class="op-sheet-state op-num" :data-tone="tone">
            <OrderIcon v-if="tone === 'ok'" name="check" />
            <OrderIcon v-else-if="tone === 'missing'" name="alert" />
            {{ state }}
          </span>
        </span>
        <OrderIcon name="chevron" class="op-sheet-chevron" />
      </button>
    </h2>
    <template v-else>
      <h2 :id="titleId">{{ title }}</h2>
      <p v-if="state" class="op-sheet-state op-num" :data-tone="tone">
        <OrderIcon v-if="tone === 'ok'" name="check" />
        <OrderIcon v-else-if="tone === 'missing'" name="alert" />
        {{ state }}
      </p>
    </template>
    <p
      v-if="toggleBlocked"
      :id="toggleReasonId"
      class="op-edit-reason"
      :class="{ 'op-visually-hidden': !toggleTried }"
    >
      Salve ou cancele a edição aberta.
    </p>
    <template v-if="expanded">
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
    </template>
  </div>
</template>
