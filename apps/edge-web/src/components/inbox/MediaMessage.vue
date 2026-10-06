<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  media: { type: Object, required: true },
});
const failed = ref(false);
const player = ref(null),
  noticeElement = ref(null);
const contentUrl = computed(() => {
  const url = props.media.contentUrl;
  return typeof url === 'string' &&
    /^\/api\/v1\/conversations\/[^/?#]+\/media\/[^/?#]+\/content$/.test(url)
    ? url
    : null;
});
const unavailable = computed(
  () => failed.value || !contentUrl.value || props.media.state !== 'attached',
);
const notice = computed(() =>
  props.media.state === 'lost'
    ? 'Arquivo perdido. O histórico da mensagem foi preservado.'
    : 'Arquivo indisponível no momento.',
);
watch(unavailable, async (value) => {
  if (!value || !player.value?.contains(document.activeElement)) return;
  await nextTick();
  noticeElement.value?.focus();
});
watch(
  () => [props.media.mediaId, props.media.state, props.media.contentUrl],
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <section class="media-message" aria-label="Mídia da mensagem">
    <p
      v-if="unavailable"
      ref="noticeElement"
      tabindex="-1"
      role="status"
      aria-live="polite"
    >
      {{ notice }}
    </p>
    <img
      v-else-if="media.kind === 'image'"
      ref="player"
      :src="contentUrl"
      alt="Imagem da conversa"
      @error="failed = true"
    />
    <audio
      v-else-if="media.kind === 'audio'"
      ref="player"
      :src="contentUrl"
      controls
      preload="metadata"
      aria-label="Áudio da conversa"
      @error="failed = true"
    ></audio>
    <video
      v-else-if="media.kind === 'video'"
      ref="player"
      :src="contentUrl"
      controls
      preload="metadata"
      aria-label="Vídeo da conversa"
      @error="failed = true"
    ></video>
  </section>
</template>

<style scoped>
.media-message {
  min-width: 0;
}
img,
video {
  display: block;
  max-width: 100%;
  max-height: 20rem;
  object-fit: contain;
}
audio {
  max-width: 100%;
}
</style>
