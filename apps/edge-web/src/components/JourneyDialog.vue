<script setup>
/**
 * Casca de jornada (INBOX-RD-06): diálogo modal nativo reutilizável para fluxos
 * de várias etapas (frete, cobrança). Só apresenta e gerencia o diálogo; quem a
 * usa decide o conteúdo, as regras e o que fazer ao fechar.
 *
 * Props
 * - `title` (obrigatória): texto do cabeçalho (`h2`), que nomeia o diálogo.
 * - `closeLabel` (obrigatória): nome acessível do botão de fechar.
 * - `describedby`: id de um elemento do conteúdo que descreve o diálogo.
 *
 * Slots
 * - padrão: corpo rolável.
 * - `footer`: ações. Mantenha uma única ação `primary` por momento. Sem este
 *   slot, o rodapé não é desenhado.
 *
 * Eventos
 * - `close`: o diálogo fechou (Esc, fundo, botão ou `close()`). Dispara depois
 *   de o foco voltar ao acionador.
 *
 * Métodos expostos
 * - `open(trigger)`: abre como modal e devolve o foco a `trigger` ao fechar.
 * - `close()`: fecha.
 * - `element`: o `<dialog>` nativo.
 *
 * Contenção de foco, Esc e inércia do fundo vêm do `showModal()` nativo.
 */
import { ref, useId } from 'vue';
import { openDialog } from '../lib/ui.js';
import AppIcon from './AppIcon.vue';

defineProps({
  title: { type: String, required: true },
  closeLabel: { type: String, required: true },
  describedby: { type: String, default: undefined },
});
const emit = defineEmits(['close']);
const element = ref(null);
const titleId = useId();
let pressedOnBackdrop = false;

function announceClose() {
  emit('close');
}
/** @param {HTMLElement} trigger */
function open(trigger) {
  const dialog = element.value;
  if (!dialog) return;
  openDialog(dialog, trigger);
  // Registered after openDialog's own listener: focus returns to the trigger
  // first, so a caller that moves focus on close wins.
  dialog.removeEventListener('close', announceClose);
  dialog.addEventListener('close', announceClose, { once: true });
}
function close() {
  element.value?.close();
}
// Only a press and a release both on the backdrop close the dialog: dragging a
// text selection out of a field must not.
/** @param {PointerEvent} event */
function pressed(event) {
  pressedOnBackdrop = event.target === element.value;
}
/** @param {MouseEvent} event */
function released(event) {
  if (pressedOnBackdrop && event.target === element.value) close();
  pressedOnBackdrop = false;
}
defineExpose({ open, close, element });
</script>

<template>
  <dialog
    ref="element"
    class="journey-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="describedby"
    @pointerdown="pressed"
    @click="released"
  >
    <header class="journey-head">
      <h2 :id="titleId">{{ title }}</h2>
      <button
        type="button"
        class="quiet journey-close"
        :aria-label="closeLabel"
        :title="closeLabel"
        @click="close"
      >
        <AppIcon name="close" />
      </button>
    </header>
    <div class="journey-body"><slot /></div>
    <footer v-if="$slots.footer" class="journey-foot">
      <slot name="footer" />
    </footer>
  </dialog>
</template>

<style scoped>
.journey-dialog {
  --journey-inline-size: 40rem;
  box-sizing: border-box;
  inline-size: min(var(--journey-inline-size), calc(100vw - var(--space-8)));
  max-inline-size: none;
  max-block-size: calc(100dvh - var(--space-8));
  padding: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--text-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-floating);
}
.journey-dialog[open] {
  display: flex;
  flex-direction: column;
  animation: journey-in var(--duration-base) var(--easing-standard);
}
.journey-dialog::backdrop {
  background: var(--color-overlay);
}
@keyframes journey-in {
  from {
    opacity: 0;
    translate: 0 var(--space-2);
  }
}
.journey-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
  border-block-end: 1px solid var(--color-border-subtle);
}
.journey-head h2 {
  min-inline-size: 0;
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}
.journey-close {
  flex: none;
  inline-size: var(--control-height);
  padding: 0;
}
.journey-body {
  display: grid;
  flex: 1;
  align-content: start;
  gap: var(--space-5);
  min-block-size: 0;
  padding: var(--space-5);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.journey-foot {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-block-start: 1px solid var(--color-border-subtle);
}
@media (pointer: coarse) {
  .journey-close {
    inline-size: var(--target-min);
    block-size: var(--target-min);
  }
}
/* Folha inferior de largura total. */
@media (width < 48rem) {
  .journey-dialog {
    inline-size: 100%;
    max-block-size: calc(100dvh - var(--space-12));
    margin: auto 0 0;
    border-inline: 0;
    border-block-end: 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .journey-head {
    padding-inline-start: var(--space-4);
  }
  .journey-close {
    inline-size: var(--target-min);
    block-size: var(--target-min);
  }
  .journey-body {
    padding: var(--space-4);
  }
  .journey-foot {
    flex-direction: column-reverse;
    align-items: stretch;
    padding: var(--space-3) var(--space-4)
      calc(var(--space-3) + env(safe-area-inset-bottom));
  }
  .journey-foot :slotted(button) {
    min-block-size: var(--target-min);
  }
}
@media (prefers-reduced-motion: reduce) {
  .journey-dialog[open] {
    animation: none;
  }
}
</style>
