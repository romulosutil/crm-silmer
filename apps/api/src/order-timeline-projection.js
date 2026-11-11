import { operationalDay } from '@crm-silmer/orders';

/** @param {any} value */
const timestamp = (value) => (value ? new Date(value).toISOString() : null);
/** @param {any} value */
const recordedDay = (value) => operationalDay(new Date(value));

/** Read-only projection of the receipt ledger; never derive financial totals here.
 * @param {{payments:any[],external:any[],refunds:any[],reviewRequired:boolean}} input
 */
export function orderTimelineEvents({
  payments,
  external,
  refunds,
  reviewRequired,
}) {
  const externalById = new Map(external.map((row) => [row.id, row]));
  const unique = new Map(
    payments.map((row) => [`${row.source}:${row.id}`, row]),
  );
  const gatewayById = new Map(
    payments
      .filter((row) => row.source === 'infinitepay')
      .map((row) => [row.id, row]),
  );
  /** @type {any[]} */
  const events = [];
  for (const payment of unique.values()) {
    const manual = payment.source === 'external';
    const original = manual ? externalById.get(payment.id) : null;
    const amount = Number(payment.principal_amount_cents);
    const refunded = Number(payment.refunded_amount_cents);
    const applied = payment.application_valid
      ? Math.max(0, Number(payment.applied_amount_cents) - refunded)
      : 0;
    const reversed = Boolean(original?.reversed_at);
    const status = reversed
      ? 'reversed'
      : refunded >= amount
        ? 'refunded'
        : refunded > 0
          ? 'partially_refunded'
          : !payment.application_valid || applied === 0
            ? reviewRequired
              ? 'review'
              : 'not_applied'
            : 'active';
    const recordedAt = timestamp(payment.verified_at);
    events.push({
      id: `receipt:${payment.source}:${payment.id}`,
      kind: 'receipt',
      source: payment.source,
      receiptId: payment.id,
      chargeId: payment.charge_id ?? null,
      day: manual
        ? String(payment.received_on).slice(0, 10)
        : recordedDay(payment.verified_at),
      occurredAt: manual ? null : recordedAt,
      dateBasis: manual ? 'effective_day' : 'crm_verification',
      amountCents: amount,
      appliedAmountCents: applied,
      method: payment.method,
      installments: Number(payment.installments),
      status,
      recordedAt,
      actorName: manual ? (original?.recorded_by_name ?? null) : null,
    });
    if (original?.reversed_at)
      events.push({
        id: `external_reversal:${original.reversal_id}`,
        kind: 'external_reversal',
        source: 'external',
        receiptId: payment.id,
        chargeId: null,
        day: recordedDay(original.reversed_at),
        occurredAt: timestamp(original.reversed_at),
        dateBasis: 'recorded_at',
        amountCents: amount,
        appliedAmountCents: 0,
        method: payment.method,
        installments: 1,
        status: 'reversed',
        recordedAt: timestamp(original.reversed_at),
        actorName: original.reversed_by_name ?? null,
      });
  }
  for (const refund of refunds) {
    const payment = gatewayById.get(refund.payment_id);
    if (!payment) continue;
    events.push({
      id: `refund:${refund.id}`,
      kind: 'refund',
      source: 'infinitepay',
      receiptId: payment.id,
      chargeId: payment.charge_id,
      day: recordedDay(refund.created_at),
      occurredAt: timestamp(refund.created_at),
      dateBasis: 'recorded_at',
      amountCents: Number(refund.amount_cents),
      appliedAmountCents: 0,
      method: payment.method,
      installments: Number(payment.installments),
      status: 'refunded',
      recordedAt: timestamp(refund.created_at),
      actorName: refund.actor_name ?? null,
    });
  }
  return events.sort(
    (left, right) =>
      left.day.localeCompare(right.day) ||
      (left.occurredAt ?? left.recordedAt ?? '').localeCompare(
        right.occurredAt ?? right.recordedAt ?? '',
      ) ||
      left.id.localeCompare(right.id),
  );
}
