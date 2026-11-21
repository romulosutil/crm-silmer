import { onBeforeUnmount, ref } from 'vue';
import { ApiError, request } from './api-client.js';

const saoPauloTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
});

/** @param {string|number} value */
export function liveTime(value) {
  return saoPauloTime.format(new Date(value));
}

/** Each protected resource retains its own last successful server read. */
export function useDashboardRegion() {
  const data = ref(null);
  const readAt = ref(null);
  const loading = ref(false);
  const error = ref('');
  /** @type {AbortController|undefined} */
  let controller;
  let key = '';
  /** @param {string} url */
  async function load(url) {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    if (key !== url) {
      data.value = null;
      readAt.value = null;
      error.value = '';
    }
    key = url;
    loading.value = true;
    try {
      const result = await request(url, { signal: current.signal });
      if (current.signal.aborted) return false;
      data.value = result.data;
      readAt.value = result.serverTime ?? result.data.generatedAt ?? null;
      error.value = '';
      return true;
    } catch (cause) {
      if (current.signal.aborted) return false;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        data.value = null;
        readAt.value = null;
      }
      error.value = data.value
        ? 'Falha ao atualizar. Exibindo a última leitura válida.'
        : 'Consulta indisponível.';
      return false;
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }
  onBeforeUnmount(() => controller?.abort());
  return { data, readAt, loading, error, load };
}

export const checkpointDeliveryLabels = Object.freeze({
  not_generated: 'Aguardando preparação',
  pending: 'Aguardando reserva',
  reserved: 'Envio reservado',
  sent: 'Aceito pelo provedor · entrega não confirmada',
  failed: 'Falha antes do envio',
  outcome_unknown: 'Resultado desconhecido · exige reconciliação',
});
