import { brand } from '../brand/index.js';

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
  encerrada: 'Conversa encerrada',
});

/**
 * Who is serving the conversation, in the same words as the Inbox filter
 * ("Com o agente" · "Com vendedor"), so a badge never contradicts its tab.
 *
 * @param {{automationState?: unknown, state?: unknown}|null|undefined} conversation
 */
export function conversationLabel(conversation) {
  if (conversation?.state === 'em_atendimento') {
    return conversation.automationState === 'human'
      ? 'Com vendedor'
      : `Com ${brand.assistant.reference}`;
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
  instagram: 'Instagram',
  site_chat: 'Chat do site',
  whatsapp: 'WhatsApp',
});

/** @param {unknown} value the first word of a person's name, or ''. */
function holderFirstName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().split(/\s+/u)[0] ?? '';
  return name.length <= 40 && !/[\p{Cc}<>]/u.test(name) ? name : '';
}

/**
 * WAP-09: which WhatsApp a conversation belongs to and which one a reply
 * leaves by, in words (never color alone). A personal line belongs to the
 * seller who holds it, who is always the conversation's owner (it cannot be
 * transferred): its row carries a badge and its header says so. Any other
 * WhatsApp conversation is the company's general line, which keeps the row
 * and the header as they were (`badge` empty, `identity` the channel) and
 * only says where a reply leaves. Only the holder sends from a personal line
 * (WHATSAPP_SEND_UNAVAILABLE for anyone else), so the others read that
 * instead of an exit. Other channels have no line.
 *
 * @param {{channel?: unknown, personalLine?: unknown, assignedUser?: {id?: unknown, name?: unknown}|null}|null|undefined} conversation
 * @param {{actorId?: string, holderName?: string|null}} [context]
 *   `holderName` names the holder when the conversation does not.
 * @returns {{badge: string, identity: string, sendHint: string}|null}
 */
export function conversationLine(conversation, context = {}) {
  if (conversation?.channel !== 'whatsapp') return null;
  const company = brand.companyName;
  if (conversation.personalLine !== true) {
    return {
      badge: '',
      identity: CHANNEL_LABELS.whatsapp,
      sendHint: `Sai pela linha ${company}`,
    };
  }
  const holder = conversation.assignedUser ?? null;
  if (holder?.id && holder.id === context.actorId) {
    return {
      badge: 'Seu WhatsApp',
      identity: 'WhatsApp pessoal',
      sendHint: 'Sai pelo seu WhatsApp',
    };
  }
  const name = holderFirstName(holder?.name ?? context.holderName);
  return {
    badge: name ? `WhatsApp de ${name}` : 'WhatsApp pessoal',
    identity: name ? `WhatsApp pessoal de ${name}` : 'WhatsApp pessoal',
    sendHint: 'Envio só pelo titular da linha',
  };
}

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
