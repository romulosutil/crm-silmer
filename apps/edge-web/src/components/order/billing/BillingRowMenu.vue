<script setup>
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import OrderIcon from '../OrderIcon.vue';

/*
 * "Mais ações" of one Movimentações row: only the actions valid for the
 * row's state. Arrows, Home/End and Esc move inside the menu; Esc and a chosen
 * action return the focus to the button. On a phone the same list opens as a
 * bottom sheet (modal dialog) titled "Mais ações · <linha>".
 *
 * Props
 * - `items`: `[{label, act, icon}]` (row.menu).
 * - `rowTitle`: e.g. "Sinal · 50%".
 * - `noun`: "desta cobrança" · "deste recebimento".
 * - `sheet`: open as a bottom sheet (phone).
 * Events
 * - `select(act, button)`: the chosen action and the menu button, which is
 *   the focus target when a dialog opened from it closes.
 */
const props = defineProps({
  items: { type: Array, required: true },
  rowTitle: { type: String, required: true },
  noun: { type: String, default: 'desta cobrança' },
  sheet: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);
const id = useId();
const open = ref(false);
/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null);
/** @type {import('vue').Ref<HTMLButtonElement|null>} */
const button = ref(null);
/** @type {import('vue').Ref<HTMLDialogElement|null>} */
const sheetDialog = ref(null);
/** @type {import('vue').Ref<HTMLElement|null>} */
const list = ref(null);

function menuItems() {
  return /** @type {HTMLElement[]} */ ([
    ...(list.value?.querySelectorAll('[role="menuitem"]') ?? []),
  ]);
}
async function show() {
  open.value = true;
  await nextTick();
  if (props.sheet) sheetDialog.value?.showModal();
  menuItems()[0]?.focus();
}
/** @param {{restoreFocus?: boolean}} [options] */
function close({ restoreFocus = true } = {}) {
  if (!open.value) return;
  open.value = false;
  if (sheetDialog.value?.open) sheetDialog.value.close();
  if (restoreFocus) button.value?.focus();
}
function toggle() {
  if (open.value) close();
  else void show();
}
/** @param {KeyboardEvent} event */
function onButtonKey(event) {
  if (!open.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    void show();
  }
}
/** @param {KeyboardEvent} event */
function onMenuKey(event) {
  const all = menuItems();
  const at = all.indexOf(/** @type {HTMLElement} */ (event.target));
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === 'Tab' && !props.sheet) {
    close({ restoreFocus: false });
    return;
  }
  const next = {
    ArrowDown: all[(at + 1) % all.length],
    ArrowUp: all[(at - 1 + all.length) % all.length],
    Home: all[0],
    End: all.at(-1),
  }[event.key];
  if (!next || at === -1) return;
  event.preventDefault();
  next.focus();
}
/** @param {string} act */
function choose(act) {
  close();
  emit('select', act, button.value);
}
/** @param {PointerEvent} event */
function onOutside(event) {
  if (
    open.value &&
    !props.sheet &&
    !root.value?.contains(/** @type {Node} */ (event.target))
  )
    close({ restoreFocus: false });
}
/** Only a press and a release both on the sheet's backdrop close it. */
let pressedOnBackdrop = false;
/** @param {PointerEvent} event */
function sheetPressed(event) {
  pressedOnBackdrop = event.target === sheetDialog.value;
}
/** @param {MouseEvent} event */
function sheetReleased(event) {
  if (pressedOnBackdrop && event.target === sheetDialog.value) close();
  pressedOnBackdrop = false;
}
function sheetClosed() {
  if (open.value) {
    open.value = false;
    button.value?.focus();
  }
}
watch(open, (value) => {
  if (value) globalThis.document?.addEventListener('pointerdown', onOutside);
  else globalThis.document?.removeEventListener('pointerdown', onOutside);
});
onBeforeUnmount(() =>
  globalThis.document?.removeEventListener('pointerdown', onOutside),
);
</script>

<template>
  <div ref="root" class="bl-move-more">
    <button
      ref="button"
      type="button"
      class="quiet op-more-button bl-more-button"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? `${id}-menu` : undefined"
      :aria-label="`Mais ações ${noun}: ${rowTitle}`"
      :title="`Mais ações ${noun}`"
      @click="toggle"
      @keydown="onButtonKey"
    >
      <OrderIcon name="more" />
    </button>
    <ul
      v-if="open && !sheet"
      :id="`${id}-menu`"
      ref="list"
      class="op-more-list bl-more-list"
      role="menu"
      :aria-label="`Mais ações: ${rowTitle}`"
      @keydown="onMenuKey"
    >
      <li v-for="item in items" :key="item.act" role="none">
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          :data-menu="item.act"
          @click="choose(item.act)"
        >
          <OrderIcon :name="item.icon" />{{ item.label }}
        </button>
      </li>
    </ul>
    <dialog
      v-if="sheet"
      ref="sheetDialog"
      class="bl-menu-sheet"
      :aria-labelledby="`${id}-sheet-title`"
      @close="sheetClosed"
      @pointerdown="sheetPressed"
      @click="sheetReleased"
    >
      <header class="bl-menu-sheet-head">
        <h2 :id="`${id}-sheet-title`">Mais ações · {{ rowTitle }}</h2>
        <button
          type="button"
          class="quiet bl-menu-sheet-close"
          aria-label="Fechar"
          title="Fechar"
          @click="close()"
        >
          <OrderIcon name="x" />
        </button>
      </header>
      <ul
        v-if="open"
        :id="`${id}-menu`"
        ref="list"
        class="op-more-list bl-more-list bl-sheet-menu"
        role="menu"
        :aria-label="`Mais ações: ${rowTitle}`"
        @keydown="onMenuKey"
      >
        <li v-for="item in items" :key="item.act" role="none">
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            :data-menu="item.act"
            @click="choose(item.act)"
          >
            <OrderIcon :name="item.icon" />{{ item.label }}
          </button>
        </li>
      </ul>
    </dialog>
  </div>
</template>
