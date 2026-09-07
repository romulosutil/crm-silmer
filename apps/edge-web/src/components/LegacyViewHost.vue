<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createDealDetailView } from '../features/deal-detail-view.js';
import { createKanbanView } from '../features/kanban-view.js';

const props = defineProps({
  dealId: { type: String, default: '' },
  kind: { type: String, required: true },
  announce: { type: Function, required: true },
  onCursor: { type: Function, required: true },
  showError: { type: Function, required: true },
});
const emit = defineEmits(['active-view']);
const host = ref(null);
const router = useRouter();
let view = null;

onMounted(() => {
  const context = {
    announce: props.announce,
    navigate: (path) => router.push(path),
    onCursor: props.onCursor,
    showError: props.showError,
  };
  view =
    props.kind === 'deal'
      ? createDealDetailView(host.value, props.dealId, context)
      : createKanbanView(host.value, context);
  emit('active-view', view);
});

onBeforeUnmount(() => {
  view?.dispose();
  emit('active-view', null);
  view = null;
});
</script>

<template><div ref="host"></div></template>
