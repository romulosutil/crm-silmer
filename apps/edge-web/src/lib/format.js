const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export const CONVERSATION_LABELS = Object.freeze({
  convertida_em_lead: 'Atendimento concluído',
  em_analise: 'Em análise',
  em_atendimento: 'Em atendimento',
  nova: 'Nova',
  requer_atencao: 'Requer atenção',
  sem_lead: 'Atendimento encerrado',
});

/** @param {{automationState?: unknown, state?: unknown}|null|undefined} conversation */
export function conversationLabel(conversation) {
  if (conversation?.state === 'em_atendimento') {
    return conversation.automationState === 'human'
      ? 'Em atendimento por vendedor'
      : 'Em atendimento por IA';
  }
  return (
    CONVERSATION_LABELS[
      /** @type {keyof typeof CONVERSATION_LABELS} */ (conversation?.state)
    ] ??
    conversation?.state ??
    'Não informado'
  );
}

export const CHANNEL_LABELS = Object.freeze({
  whatsapp: 'WhatsApp',
});

/** @param {unknown} value */
export function formatPhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/gu, '');
  const national = digits.startsWith('55') ? digits.slice(2) : digits;
  if (national.length === 11) {
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return String(value ?? 'Não informado');
}

/** @param {unknown} value */
export function dateTimeBR(value) {
  if (!value) return 'Não informado';
  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    return 'Não informado';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Não informado'
    : DATE_TIME.format(date);
}

/** @param {Record<string, any>|null|undefined} message */
export function messageText(message) {
  return message?.preview ?? 'Sem mensagem';
}
