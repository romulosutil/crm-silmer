<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import OrderIcon from './OrderIcon.vue';

// PED-RD-02 item 3: "Mais ações do pedido", the page header's disclosure for
// the actions that are not "Abrir conversa" or "Gerar PDF". Same menu markup,
// keys and focus rules as the item menu in OrderItemsSection (EDIT-01). The
// page decides which actions exist; with none, no button is drawn at all.
const props = defineProps({
  canCancel: { type: Boolean, default: false },
  // A section in edit: the item stays, but waits (it explains why).
  cancelDisabled: { type: Boolean, default: false },
  cancelHint: { type: String, default: '' },
  canShare: { type: Boolean, default: false },
  shareDisabled: { type: Boolean, default: false },
});
const emit = defineEmits(['cancel', 'share']);

const open = ref(false);
/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null);
/** @type {import('vue').Ref<HTMLButtonElement|null>} */
const button = ref(null);

function items() {
  return [
    ...(root.value?.querySelectorAll(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    ) ?? []),
  ];
}

async function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  open.value = true;
  await nextTick();
  items()[0]?.focus();
}

/** Esc and a chosen action close the menu and leave the focus on its button. */
function close({ restoreFocus = true } = {}) {
  open.value = false;
  if (restoreFocus) button.value?.focus();
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (!open.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  const list = [
    ...(root.value?.querySelectorAll('[role="menuitem"]') ?? []),
  ].filter((item) => !(item instanceof HTMLButtonElement && item.disabled));
  const at = list.indexOf(/** @type {Element} */ (event.target));
  const next = {
    ArrowDown: list[(at + 1) % list.length],
    ArrowUp: list[(at - 1 + list.length) % list.length],
    End: list.at(-1),
    Home: list[0],
  }[event.key];
  if (!next || at === -1) return;
  event.preventDefault();
  /** @type {HTMLElement} */ (next).focus();
}

/** @param {FocusEvent} event */
function onFocusOut(event) {
  if (!open.value) return;
  const target = event.relatedTarget;
  if (!(target instanceof Node) || !root.value?.contains(target)) {
    open.value = false;
  }
}

/** @param {PointerEvent} event */
function onOutsidePointer(event) {
  if (open.value && !root.value?.contains(/** @type {Node} */ (event.target))) {
    open.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen)
    globalThis.document?.addEventListener('pointerdown', onOutsidePointer);
  else
    globalThis.document?.removeEventListener('pointerdown', onOutsidePointer);
});
onBeforeUnmount(() =>
  globalThis.document?.removeEventListener('pointerdown', onOutsidePointer),
);

function share() {
  if (props.shareDisabled) return;
  close();
  emit('share');
}

function cancel() {
  if (props.cancelDisabled) return;
  // The dialog returns the focus to this button, where the menu was opened.
  open.value = false;
  emit('cancel', button.value);
}
</script>

<template>
  <div
    v-if="canCancel || canShare"
    ref="root"
    class="op-more"
    @focusout="onFocusOut"
    @keydown="onKeydown"
  >
    <button
      ref="button"
      type="button"
      class="op-icon-button op-more-button"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? 'order-more-menu' : undefined"
      @click="toggle"
    >
      <OrderIcon name="more" />
      <span class="op-visually-hidden">Mais ações do pedido</span>
    </button>
    <div
      v-if="open"
      id="order-more-menu"
      class="op-more-list"
      role="menu"
      aria-label="Mais ações do pedido"
    >
      <button
        v-if="canShare"
        type="button"
        role="menuitem"
        :disabled="shareDisabled"
        @click="share"
      >
        Compartilhar PDF
      </button>
      <button
        v-if="canCancel"
        id="order-cancel-item"
        type="button"
        role="menuitem"
        data-danger
        :aria-disabled="cancelDisabled || undefined"
        :aria-describedby="cancelDisabled ? 'order-cancel-hint' : undefined"
        @click="cancel"
      >
        Cancelar pedido
      </button>
      <p
        v-if="canCancel && cancelDisabled"
        id="order-cancel-hint"
        class="op-hint"
      >
        {{ cancelHint }}
      </p>
    </div>
  </div>
</template>
