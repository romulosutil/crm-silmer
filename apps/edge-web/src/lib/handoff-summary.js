/**
 * INBOX-HANDOFF-01 / AGT-03: the n8n agent writes the handoff summary as one
 * line of sentences ("Motivo: …. Atenção: …. Ficha: 5 de 9 (56%). Dica: ….").
 * The Inbox shows each sentence on its own line, and the customer's questions
 * (ADR 051, "Perguntas do cliente: • … • …") as a list of their own.
 */

/** Openings of the agent's sentences, in the order its summary writes them. */
const OPENINGS = [
  'Motivo',
  'Cliente cobra retorno',
  'Simulação do cliente',
  'Responder valor e prazo solicitados juntos',
  'Alternativas para orçamento',
  'Perguntas do cliente',
  'Perguntou o valor',
  'Vendedor pedido',
  'Pessoa pedida',
  'Atenção',
  'Faltam',
  'Pré-ficha completa',
  'Nome',
  'Ficha',
  'Para o vendedor definir',
  'Dica',
  'IA',
];
/** Sentences the agent writes without a label. */
const PRICE_AND_TIME = 'Responder valor e prazo solicitados juntos';
const UNLABELLED = new Set([
  'Perguntou o valor',
  'Pré-ficha completa',
  PRICE_AND_TIME,
]);
const LABELLED = new Set(
  OPENINGS.filter((opening) => !UNLABELLED.has(opening)),
);
const NEXT = `(?=(?:${OPENINGS.join('|')})(?::|\\.))`;
const BOUNDARY = new RegExp(`(?<=[.!?])\\s+${NEXT}`, 'u');
/**
 * A question topic may end without punctuation ("quero revender", or cut
 * with "..."), so the list ends at the next opening that does not start a
 * topic ("• Nome …" is still the customer's words).
 */
const QUESTIONS_END = new RegExp(`(?<![•\\s])\\s+${NEXT}`, 'u');
const TONES = /** @type {Record<string, string>} */ ({
  Atenção: 'warning',
  Dica: 'info',
});

/**
 * @typedef {{key: string, label: string, text: string, items: string[], tone: string}} SummaryLine
 */

/**
 * Splits the summary into its lines. A summary written by a person (no known
 * opening) stays one line with no label; nothing is ever dropped.
 *
 * @param {unknown} summary
 * @returns {SummaryLine[]}
 */
export function handoffSummaryLines(summary) {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (!text) return [];
  const parts = [];
  let rest = text;
  for (;;) {
    // The agent's own reasoning comes last and is free text: it is never split.
    if (/^IA:/u.test(rest)) {
      parts.push(rest);
      break;
    }
    const match = (
      rest.startsWith('Perguntas do cliente:') ? QUESTIONS_END : BOUNDARY
    ).exec(rest);
    if (!match) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  return parts.map((part, index) => lineOf(part.trim(), index));
}

/**
 * Only the producer's explicit handoff markers describe a pending reply.
 * Free summaries, customer question lists and model reasoning stay in the disclosure.
 * @param {SummaryLine[]} lines
 */
export function handoffPendingReply(lines) {
  if (lines[0]?.label !== 'Motivo') return '';
  const actions = [];
  for (const line of lines) {
    if (line.label === 'Cliente cobra retorno')
      actions.push(
        /\borçamento\b/iu.test(line.text)
          ? 'Retomar o orçamento solicitado'
          : 'Dar o retorno solicitado',
      );
    if (line.label === 'Simulação do cliente')
      actions.push('Confirmar o valor da alteração simulada');
    if (!line.label && line.text === PRICE_AND_TIME + '.')
      actions.push('Informar valor e prazo');
    if (line.label === 'Alternativas para orçamento') {
      const volumes =
        /^(\d{1,5} e \d{1,5} (?:pe[cç]as?|unidades?|camisas?|camisetas?)); quantidade não confirmada\.$/iu.exec(
          line.text,
        );
      if (volumes) actions.push('Cotar ' + volumes[1].replace(/peca/u, 'peça'));
    }
  }
  return actions.join(' · ');
}

/** @param {string} part @param {number} index @returns {SummaryLine} */
function lineOf(part, index) {
  const colon = part.indexOf(':');
  const label = colon > 0 ? part.slice(0, colon) : '';
  if (!LABELLED.has(label)) {
    return { items: [], key: `${index}`, label: '', text: part, tone: '' };
  }
  const body = part.slice(colon + 1).trim();
  if (label === 'Perguntas do cliente') {
    const items = body
      .split(/\s*•\s*/u)
      .map((item) => item.trim())
      .filter(Boolean);
    return { items, key: `${index}`, label, text: '', tone: '' };
  }
  return {
    items: [],
    key: `${index}`,
    label,
    text: body,
    tone: TONES[label] ?? '',
  };
}
