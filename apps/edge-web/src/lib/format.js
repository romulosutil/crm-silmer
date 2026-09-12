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

export const CHANNEL_LABELS = Object.freeze({
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
});

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
