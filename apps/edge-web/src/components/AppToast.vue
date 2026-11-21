<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

// Pesquisa UX 2026-10-15, achado 6: a change the person asked for is also
// seen, not only heard. One notice at a time; a newer one replaces it. The
// notice waits while the pointer or the focus is on it (WCAG 2.2.1), and an
// optional action ("Desfazer") runs once. The shell announces the message
// in its own live region, so the buttons here are not read with it.
const DISMISS_AFTER_MS = 8000;

const notice = ref(null);
let timer = 0;
let hovering = false;
let focused = false;
/** @type {HTMLElement|null} */
let trigger = null;

function clearTimer() {
  if (timer) globalThis.clearTimeout(timer);
  timer = 0;
}

function schedule() {
  clearTimer();
  if (hovering || focused || document.hidden || !notice.value) return;
  timer = globalThis.setTimeout(dismiss, DISMISS_AFTER_MS);
}

function dismiss() {
  clearTimer();
  notice.value = null;
  hovering = false;
  focused = false;
}

/**
 * @param {string} message
 * @param {{actionLabel?: string, onAction?: () => unknown, informational?: boolean}} [options]
 */
function notify(message, options = {}) {
  if (!message) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && !active.closest('.notice-toast'))
    trigger = active;
  notice.value = {
    confirmed: !options.informational,
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

async function closeNotice() {
  const target = trigger;
  dismiss();
  await nextTick();
  if (
    target?.isConnected &&
    target !== document.body &&
    !target.matches(':disabled')
  ) {
    target.focus();
    if (document.activeElement === target) return;
  }
  const main = document.querySelector('#main-content');
  (main?.querySelector('h1[tabindex]') ?? main)?.focus();
}

/** @param {FocusEvent} event */
function leaveFocus(event) {
  focused =
    event.relatedTarget instanceof Node &&
    event.currentTarget instanceof HTMLElement &&
    event.currentTarget.contains(event.relatedTarget);
  schedule();
}

onMounted(() => document.addEventListener('visibilitychange', schedule));
onBeforeUnmount(() => {
  clearTimer();
  document.removeEventListener('visibilitychange', schedule);
});

defineExpose({ dismiss, notify });
</script>

<template>
  <!-- Screen readers hear the message through the shell's status region
       (App.vue announces it); this is what the eyes see. -->
  <!-- A labelled landmark: the notice sits outside <main> (axe "region"). -->
  <section class="notice-toast-region" aria-label="Avisos">
    <div
      v-if="notice"
      :key="notice.id"
      class="notice-toast"
      @mouseenter="
        hovering = true;
        schedule();
      "
      @mouseleave="
        hovering = false;
        schedule();
      "
      @focusin="
        focused = true;
        schedule();
      "
      @focusout="leaveFocus"
    >
      <AppIcon v-if="notice.confirmed" name="check" />
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
        @click="closeNotice()"
      >
        <AppIcon name="close" />
      </button>
    </div>
  </section>
</template>
