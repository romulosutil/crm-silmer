import { dayLabel, operationalDay } from './order-format.js';
import { billingMoney } from './order-billing.js';

const SP_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const METHODS = Object.freeze({
  cash: 'Dinheiro',
  pix: 'Pix',
  pix_external: 'Pix externo',
  bank_transfer: 'Transferência',
  credit_card: 'Cartão',
  card_external: 'Cartão externo',
});
const STATUS = Object.freeze({
  reversed: 'Registro revertido',
  refunded: 'Devolvido integralmente',
  partially_refunded: 'Devolução parcial',
  not_applied: 'Não aplicado ao saldo',
  review: 'Em revisão',
});

/** @param {unknown} value */
function day(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? value
    : '';
}
/** @param {unknown} value */
function dateTime(value) {
  if (typeof value !== 'string') return '';
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? '' : SP_TIME.format(instant);
}

/** DTL-01..09: presentation only; paidOn and financial totals remain server-owned.
 * @param {Record<string, any>} order
 * @param {Record<string, any>|null} [billing]
 * @returns {Record<string, any>[]}
 */
export function orderTimeline(order, billing = null) {
  /** @type {Record<string, any>[]} */
  const events = [];
  const first = operationalDay(order.firstContactAt);
  if (first)
    events.push({
      id: 'milestone:first-contact',
      kind: 'milestone',
      day: first,
      title: 'Primeiro contato',
      subtitle: order.conversationId
        ? 'Conversa iniciada'
        : 'Criação do pedido',
      detailLines: [],
    });
  const confirmed = day(order.orderDate) || operationalDay(order.confirmedAt);
  if (confirmed)
    events.push({
      id: 'milestone:confirmed',
      kind: 'milestone',
      day: confirmed,
      title: 'Pedido confirmado',
      subtitle: 'Confirmação comercial vigente',
      sortStamp: order.confirmedAt ?? '',
      detailLines: dateTime(order.confirmedAt)
        ? [
            `Confirmação registrada em ${dateTime(order.confirmedAt)} (São Paulo).`,
          ]
        : [],
      detailLabel: 'Ver detalhes da confirmação do pedido',
    });
  const financial =
    billing?.canManage === false ? [] : (billing?.timelineEvents ?? []);
  const charges = new Map(
    (billing?.charges ?? []).map((/** @type {any} */ charge) => [
      charge.id,
      charge,
    ]),
  );
  for (const event of financial) {
    if (!event.id || !day(event.day)) continue;
    const correction = event.kind !== 'receipt';
    const manual = event.source === 'external';
    const charge = /** @type {any} */ (charges.get(event.chargeId));
    const title =
      event.kind === 'external_reversal'
        ? 'Registro revertido'
        : event.kind === 'refund'
          ? 'Devolução registrada'
          : manual
            ? 'Recebimento manual'
            : charge?.kind === 'signal'
              ? 'Sinal confirmado'
              : charge?.kind === 'balance'
                ? 'Saldo confirmado'
                : 'Pagamento confirmado';
    const method =
      METHODS[/** @type {keyof typeof METHODS} */ (event.method)] ??
      'Método não informado';
    const source = manual ? 'Manual' : 'InfinitePay';
    /** @type {string[]} */
    const detailLines = [];
    if (event.kind === 'receipt') {
      detailLines.push(
        manual
          ? `Recebido em ${dayLabel(event.day)}. A data efetiva foi informada no registro manual.`
          : `Confirmado no CRM em ${dateTime(event.occurredAt ?? event.recordedAt) || dayLabel(event.day)} (São Paulo). O instante efetivo da transação no provedor não está disponível.`,
      );
    } else {
      detailLines.push(
        event.kind === 'external_reversal'
          ? 'Reversão do lançamento manual. Não representa devolução de dinheiro pelo CRM.'
          : 'Devolução conciliada no CRM e vinculada ao recebimento original.',
      );
    }
    const recordedAt = dateTime(event.recordedAt);
    if (manual || correction) {
      if (recordedAt || event.actorName)
        detailLines.push(
          `Registrado${event.actorName ? ` por ${event.actorName}` : ''}${recordedAt ? ` em ${recordedAt} (São Paulo)` : ''}.`,
        );
    }
    const statusLabel =
      STATUS[/** @type {keyof typeof STATUS} */ (event.status)] ?? '';
    if (statusLabel) detailLines.push(statusLabel + '.');
    events.push({
      id: event.id,
      kind: event.kind,
      day: event.day,
      title,
      subtitle: `${source} · ${method}${event.installments > 1 ? ` · ${event.installments}x` : ''}`,
      basisLabel:
        event.kind === 'receipt'
          ? manual
            ? 'Recebido em'
            : 'Confirmado no CRM'
          : 'Registro no CRM',
      amountLabel: `${correction ? '− ' : ''}${billingMoney(event.amountCents)}`,
      statusLabel,
      detailLines,
      detailLabel: `Ver detalhes ${event.kind === 'receipt' ? 'do recebimento' : 'da correção'}: ${title}`,
      sortStamp: event.occurredAt ?? event.recordedAt ?? '',
    });
  }
  if (
    day(order.paidOn) &&
    ((!billing?.managed && financial.length === 0) || billing?.pendingDetails)
  )
    events.push({
      id: 'milestone:paid',
      kind: 'milestone',
      day: order.paidOn,
      title: 'Quitação registrada',
      subtitle: billing?.pendingDetails
        ? 'Detalhamento aguardando atualização'
        : 'Sem detalhamento de recebimentos',
      statusLabel: order.paymentReviewRequired
        ? 'Em revisão'
        : billing?.pendingDetails
          ? 'Aguardando atualização'
          : 'Registro legado',
      detailLines: [],
    });
  if (day(order.deliveredOn)) {
    const evidence =
      billing?.deliveryConfirmation?.day === order.deliveredOn
        ? billing?.deliveryConfirmation
        : null;
    const confirmedAt = dateTime(evidence?.confirmedAt);
    events.push({
      id: 'milestone:delivered',
      kind: 'delivery',
      day: order.deliveredOn,
      title: 'Pedido entregue',
      subtitle: 'Entrega registrada',
      sortStamp: evidence?.confirmedAt ?? '',
      detailLines:
        confirmedAt || evidence?.actorName
          ? [
              `Entrega confirmada${evidence?.actorName ? ` por ${evidence.actorName}` : ''}${confirmedAt ? ` em ${confirmedAt} (São Paulo)` : ''}.`,
            ]
          : [],
      detailLabel: 'Ver detalhes da entrega',
    });
  }
  return [...new Map(events.map((event) => [event.id, event])).values()]
    .sort(
      (left, right) =>
        left.day.localeCompare(right.day) ||
        (left.sortStamp ?? '').localeCompare(right.sortStamp ?? '') ||
        left.id.localeCompare(right.id),
    )
    .map((event) => ({ ...event, dateLabel: dayLabel(event.day) }));
}
