<script setup>
import { nextTick, ref, watch } from 'vue';
import OrderIcon from '../OrderIcon.vue';
import BillingRich from './BillingRich.vue';
import BillingSendSteps from './BillingSendSteps.vue';
import BillingTermsPicker from './BillingTermsPicker.vue';

/*
 * RFC 074, Próximo passo: one sentence, at most one primary action with the
 * amount and two secondaries (§16). In attention it says the cause and what
 * is blocked. The feedback of every action lands here, in a status region.
 * Another seller reads a single locked line instead.
 *
 * Props
 * - `step`: `view.next` from lib/order-billing-view.js.
 * - `titleId`: id of the heading (focus target after an action).
 * - `noActions`: the Inbox variant draws only the sentence (its actions live
 *   in the dialog footer).
 * - `status`: `{text, tone}` feedback, or null. Filled one frame after the
 *   region exists so screen readers announce it.
 * - `statusId`: id of the status region; '' omits it.
 * - `termsName`: radio name of the condition picker.
 * Slot
 * - default: extra content after the sentence (the Inbox's own condition
 *   picker).
 * Events
 * - `act(action, event)`: an action button or the quiet link was pressed and
 *   is not aria-disabled.
 * - `pick(value)`: the condition picker changed.
 */
const props = defineProps({
  step: { type: Object, required: true },
  titleId: { type: String, default: 'order-billing-next-title' },
  noActions: { type: Boolean, default: false },
  status: { type: Object, default: null },
  statusId: { type: String, default: 'order-billing-next-status' },
  termsName: { type: String, default: 'order-billing-terms' },
});
const emit = defineEmits(['act', 'pick']);
const reasonId = `${props.titleId}-reason`;
/** @type {import('vue').Ref<{text: string, tone: string}|null>} */
const shown = ref(null);

watch(
  () => props.status,
  async (value) => {
    if (!value) {
      shown.value = null;
      return;
    }
    await nextTick();
    const frame = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn));
    frame(() => {
      shown.value = value;
    });
  },
  { immediate: true },
);

/** @param {any} action @param {Event} event */
function press(action, event) {
  if (action.disabled || action.busy) return;
  emit('act', action, event);
}
</script>

<template>
  <p v-if="step.lock" class="op-readonly bl-readonly">
    <OrderIcon name="lock" /><span>{{ step.lock }}</span>
  </p>
  <section
    v-else
    class="bl-next"
    :data-tone="step.tone"
    :aria-labelledby="titleId"
  >
    <h3 :id="titleId" class="bl-next-title" tabindex="-1">
      <OrderIcon v-if="step.tone === 'attention'" name="alert" /><OrderIcon
        v-else-if="step.tone === 'success'"
        name="check"
      />{{ step.title }}
    </h3>
    <div class="bl-next-text">
      <BillingRich :paragraphs="step.body" />
      <BillingSendSteps
        v-if="step.sending"
        :steps="step.sending.steps"
        :index="step.sending.index"
      />
      <slot />
      <template v-if="step.terms && !noActions">
        <BillingTermsPicker
          :terms="step.terms"
          :name="termsName"
          @pick="emit('pick', $event)"
        />
        <BillingRich :paragraphs="step.after" />
      </template>
    </div>
    <div
      v-if="!noActions && (step.primary || step.secondary.length)"
      class="bl-actions"
    >
      <button
        v-if="step.primary"
        type="button"
        class="primary"
        data-next-primary
        :aria-disabled="
          step.primary.disabled || step.primary.busy ? 'true' : undefined
        "
        :aria-describedby="step.primary.disabled ? reasonId : undefined"
        :aria-busy="step.primary.busy ? 'true' : undefined"
        @click="press(step.primary, $event)"
      >
        <OrderIcon v-if="step.primary.icon" :name="step.primary.icon" />{{
          step.primary.label
        }}
      </button>
      <button
        v-for="action in step.secondary"
        :key="action.act"
        type="button"
        :data-act="action.act"
        @click="press(action, $event)"
      >
        <OrderIcon v-if="action.icon" :name="action.icon" />{{ action.label }}
      </button>
    </div>
    <p
      v-if="!noActions && step.primary?.disabled"
      :id="reasonId"
      class="bl-reason"
    >
      {{ step.primary.disabled }}
    </p>
    <BillingRich v-if="!step.terms" :paragraphs="step.after" />
    <p v-if="step.quiet && !noActions" class="bl-quiet">
      <span>{{ step.quiet.q }}</span
      ><button
        type="button"
        class="link-button bl-link-target"
        @click="press(step.quiet, $event)"
      >
        {{ step.quiet.label }}
      </button>
    </p>
    <p
      v-if="statusId"
      :id="statusId"
      class="bl-next-status"
      role="status"
      :data-tone="shown?.tone || undefined"
    >
      <template v-if="shown"
        ><OrderIcon
          :name="
            shown.tone === 'error'
              ? 'alert'
              : shown.tone === 'info'
                ? 'info'
                : 'check'
          "
        /><span>{{ shown.text }}</span></template
      >
    </p>
  </section>
</template>
