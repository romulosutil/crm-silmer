<script setup>
import { onBeforeUnmount, ref } from 'vue';
import AppIcon from './AppIcon.vue';

// Pesquisa UX 2026-10-15, achado 6: a change the person asked for is also
// seen, not only heard. One notice at a time; a newer one replaces it. The
// notice waits while the pointer or the focus is on it (WCAG 2.2.1), and an
// optional action ("Desfazer") runs once. The shell announces the message
// in its own live region, so the buttons here are not read with it.
const DISMISS_AFTER_MS = 8000;

const notice = ref(null);
let timer = 0;
let paused = false;

function clearTimer() {
  if (timer) globalThis.clearTimeout(timer);
  timer = 0;
}

function schedule() {
  clearTimer();
  if (paused || !notice.value) return;
  timer = globalThis.setTimeout(dismiss, DISMISS_AFTER_MS);
}

function dismiss() {
  clearTimer();
  notice.value = null;
  paused = false;
}

/**
 * @param {string} message
 * @param {{actionLabel?: string, onAction?: () => unknown}} [options]
 */
function notify(message, options = {}) {
  if (!message) return;
  notice.value = {
    actionLabel: options.onAction ? options.actionLabel || 'Desfazer' : '',
    id: Date.now(),
    message,
    onAction: options.onAction ?? null,
  };
  schedule();
}

function runAction() {
  const action = notice.value?.onAction;
  dismiss();
  if (action) void action();
}

/** @param {boolean} value */
function pause(value) {
  paused = value;
  if (value) clearTimer();
  else schedule();
}

/** @param {FocusEvent} event */
function leaveFocus(event) {
  const next = /** @type {Node|null} */ (event.relatedTarget);
  if (next && /** @type {HTMLElement} */ (event.currentTarget).contains(next))
    return;
  pause(false);
}

onBeforeUnmount(clearTimer);

defineExpose({ dismiss, notify });
</script>

<template>
  <!-- Screen readers hear the message through the shell's status region
       (App.vue announces it); this is what the eyes see. -->
  <div class="notice-toast-region">
    <div
      v-if="notice"
      :key="notice.id"
      class="notice-toast"
      @mouseenter="pause(true)"
      @mouseleave="pause(false)"
      @focusin="pause(true)"
      @focusout="leaveFocus"
    >
      <AppIcon name="check" />
      <p class="notice-toast-message">{{ notice.message }}</p>
      <button
        v-if="notice.actionLabel"
        type="button"
        class="notice-toast-action"
        @click="runAction"
      >
        {{ notice.actionLabel }}
      </button>
      <button
        type="button"
        class="notice-toast-close"
        aria-label="Fechar aviso"
        @click="dismiss"
      >
        <AppIcon name="close" />
      </button>
    </div>
  </div>
</template>
