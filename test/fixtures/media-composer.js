import { createApp, h, ref } from 'vue';
import MediaComposer from '/src/components/inbox/MediaComposer.vue';
import AudioRecorder from '/src/components/inbox/AudioRecorder.vue';
import '/src/tokens.css';
import '/src/styles.css';

createApp({
  setup() {
    const conversation = ref('conversation-1'),
      disabled = ref(false),
      visible = ref(true),
      sent = ref(false);
    return () =>
      h('div', { style: 'max-width:640px;margin:24px auto;padding:16px' }, [
        h('h1', 'Revisar anexo'),
        h(
          'button',
          { onClick: () => (conversation.value = 'conversation-2') },
          'Trocar conversa',
        ),
        h(
          'button',
          { onClick: () => (disabled.value = true) },
          'Bloquear envio',
        ),
        h(
          'button',
          { onClick: () => (disabled.value = false) },
          'Reabilitar envio',
        ),
        h(
          'button',
          { onClick: () => (visible.value = false) },
          'Fechar composer',
        ),
        visible.value
          ? h(
              new globalThis.URLSearchParams(globalThis.location.search).has(
                'recorder',
              )
                ? AudioRecorder
                : MediaComposer,
              {
                conversationId: conversation.value,
                expectedVersion: 4,
                disabled: disabled.value,
                onSent: () => (sent.value = true),
              },
            )
          : null,
        sent.value ? h('p', { role: 'status' }, 'Mensagem enviada') : null,
      ]);
  },
}).mount('#app');
