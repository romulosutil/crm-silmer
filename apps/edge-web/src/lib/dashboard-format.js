// Painel (pesquisa de UX de 15/10/2026, achado 2): textos dos indicadores.
// Os números e o relógio vêm do servidor; aqui só se escolhem as palavras.

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  style: 'currency',
});
const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  weekday: 'long',
});

export const PERIODS = Object.freeze([
  Object.freeze({ key: 'hoje', label: 'Hoje', sold: 'Vendido hoje' }),
  Object.freeze({ key: '7dias', label: '7 dias', sold: 'Vendido em 7 dias' }),
  Object.freeze({ key: 'mes', label: 'Mês', sold: 'Vendido no mês' }),
]);

/** @param {unknown} cents */
export function money(cents) {
  return moneyFormatter.format(Number(cents || 0) / 100);
}

/** @param {number} count @param {string} one @param {string} many */
export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** @param {unknown} value */
function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/**
 * "há 25 min", "há 3 h", "há 2 dias", read between two server instants so a
 * wrong clock on the phone does not change the answer.
 *
 * @param {unknown} since @param {unknown} now
 */
export function elapsedLabel(since, now) {
  const from = Date.parse(String(since ?? ''));
  const to = Date.parse(String(now ?? ''));
  if (Number.isNaN(from) || Number.isNaN(to)) return '';
  const minutes = Math.max(0, Math.floor((to - from) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${plural(Math.floor(hours / 24), 'dia', 'dias')}`;
}

/** "10/10" for a YYYY-MM-DD day. @param {unknown} day */
export function shortDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(day ?? ''));
  return match ? `${match[3]}/${match[2]}` : '';
}

/** "quinta-feira, 15 de outubro" for a YYYY-MM-DD day. @param {unknown} day */
export function longDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(day ?? ''));
  if (!match) return '';
  const label = weekdayFormatter.format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ),
  );
  return label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1);
}

/**
 * @typedef {{value: string, detail: string, tone: 'error'|'warning'|'success'|null, badge: string}} Indicator
 */

/**
 * The reader's own open conversations and how many end on the client.
 *
 * @param {Record<string, any>|undefined} mine @param {unknown} now
 * @returns {Indicator}
 */
export function mineIndicator(mine, now) {
  const total = count(mine?.count);
  const awaiting = count(mine?.awaitingReplyCount);
  if (awaiting > 0) {
    const oldest = elapsedLabel(mine?.oldestAwaitingSince, now);
    return {
      badge: 'Cliente esperando',
      detail: `${plural(awaiting, 'cliente espera', 'clientes esperam')} sua resposta${oldest ? `; o primeiro escreveu ${oldest}` : ''}`,
      tone: 'warning',
      value: String(total),
    };
  }
  return {
    badge: '',
    detail: total
      ? 'Nenhum cliente esperando sua resposta'
      : 'Nenhuma conversa com você agora',
    tone: null,
    value: String(total),
  };
}

/**
 * Handoffs nobody took yet. The SLA (`due_at`) is the server's.
 *
 * @param {Record<string, any>|undefined} waiting @param {unknown} now
 * @returns {Indicator}
 */
export function waitingIndicator(waiting, now) {
  const total = count(waiting?.count);
  const overdue = count(waiting?.overdueCount);
  if (!total) {
    return {
      badge: '',
      detail: 'Nenhuma conversa esperando por uma pessoa',
      tone: null,
      value: '0',
    };
  }
  const oldest = elapsedLabel(waiting?.oldestSince, now);
  const since = oldest ? `A mais antiga chegou ${oldest}` : '';
  return {
    badge: overdue ? 'Fora do prazo' : '',
    detail: overdue
      ? `${plural(overdue, 'passou', 'passaram')} do prazo de resposta${since ? `. ${since}` : ''}`
      : since || 'Dentro do prazo de resposta',
    tone: overdue ? 'error' : 'warning',
    value: String(total),
  };
}

/**
 * The assistant's health: conversations it holds, client messages it left
 * unanswered past the server's threshold and sends that failed in 24 hours.
 *
 * @param {Record<string, any>|undefined} assistant @param {unknown} now
 * @returns {Indicator}
 */
export function assistantIndicator(assistant, now) {
  const active = count(assistant?.activeCount);
  const stalled = count(assistant?.stalledCount);
  const failed = count(assistant?.failedDeliveryCount);
  const lastReply = elapsedLabel(assistant?.lastReplyAt, now);
  if (stalled || failed) {
    const problems = [];
    if (stalled) {
      problems.push(
        `${plural(stalled, 'conversa', 'conversas')} sem resposta há mais de ${Number(assistant?.stallMinutes) || 10} min`,
      );
    }
    if (failed) {
      problems.push(
        `${plural(failed, 'conversa', 'conversas')} com envio falho nas últimas 24 h`,
      );
    }
    return {
      badge: 'Atenção',
      detail: problems.join('; '),
      tone: 'warning',
      value: 'Pede atenção',
    };
  }
  const reply = lastReply ? `última resposta ${lastReply}` : '';
  if (active) {
    return {
      badge: '',
      detail: [
        `${plural(active, 'conversa', 'conversas')} com o assistente`,
        reply,
      ]
        .filter(Boolean)
        .join('; '),
      tone: 'success',
      value: 'Respondendo',
    };
  }
  return {
    badge: '',
    detail: reply ? `Ú${reply.slice(1)}` : 'Nenhuma resposta nas últimas 24 h',
    tone: null,
    value: 'Sem conversas agora',
  };
}

/**
 * Confirmed sales of the chosen period, with the period's average ticket.
 *
 * @param {Record<string, any>|undefined} period
 * @returns {Indicator}
 */
export function soldIndicator(period) {
  const confirmed = count(period?.confirmedCount);
  const amount = Number(period?.soldAmountCents || 0);
  return {
    badge: '',
    detail: confirmed
      ? `${plural(confirmed, 'pedido confirmado', 'pedidos confirmados')}; ticket médio ${money(Math.round(amount / confirmed))}`
      : 'Nenhum pedido confirmado no período',
    tone: null,
    value: money(amount),
  };
}

/** @param {unknown} pending @returns {Indicator} */
export function pendingIndicator(pending) {
  const total = count(pending);
  return {
    badge: '',
    detail: total
      ? 'Ainda sem valor e condição confirmados'
      : 'Nenhum pedido esperando confirmação',
    tone: null,
    value: String(total),
  };
}

/** @param {Record<string, any>|undefined} deliveries @returns {Indicator} */
export function overdueIndicator(deliveries) {
  const total = count(deliveries?.overdueCount);
  const oldest = shortDay(deliveries?.oldestOverdueOn);
  // The label already says "atrasadas"; the value carries the error tone.
  return {
    badge: '',
    detail: total
      ? oldest
        ? `A mais antiga era para ${oldest}`
        : 'Prometidas para antes de hoje e ainda não entregues'
      : 'Nenhuma entrega prometida passou do dia',
    tone: total ? 'error' : null,
    value: String(total),
  };
}

/** @param {Record<string, any>|undefined} deliveries @returns {Indicator} */
export function dueSoonIndicator(deliveries) {
  const total = count(deliveries?.dueSoonCount);
  const until = shortDay(deliveries?.dueSoonUntil);
  return {
    badge: '',
    detail: total
      ? `Prometidas de hoje${until ? ` até ${until}` : ''}`
      : 'Nenhuma entrega prometida para os próximos 7 dias',
    tone: null,
    value: String(total),
  };
}
