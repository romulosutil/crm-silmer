/** Presentation identities only; financial totals always come from billing.
 * @param {any} billing @param {any[]} [history] */
export function billingOperations(billing, history = []) {
  const rows = new Map();
  /** @param {string} id @param {any} fields */
  const add = (id, fields) => {
    const row = {
      id,
      charge: null,
      external: null,
      payments: [],
      events: [],
      ...fields,
    };
    rows.set(id, row);
    return row;
  };
  for (const charge of billing?.charges ?? [])
    add(`charge:${charge.id}`, {
      charge,
      amountCents: charge.amountCents,
      date: charge.createdAt,
    });
  const external = new Map(
    (billing?.externalReceipts ?? []).map((/** @type {any} */ item) => [
      item.id,
      item,
    ]),
  );
  for (const payment of billing?.payments ?? []) {
    if (payment.source === 'external') {
      const details = external.get(payment.id) ?? payment;
      const id = `external:${payment.id}`;
      const row =
        rows.get(id) ??
        add(id, {
          external: details,
          amountCents: details.amountCents,
          date: details.receivedOn,
        });
      if (
        !row.payments.some((/** @type {any} */ item) => item.id === payment.id)
      )
        row.payments.push(payment);
    } else {
      const row =
        rows.get(`charge:${payment.chargeId}`) ??
        add(`payment:${payment.id}`, {
          amountCents: payment.amountCents,
          date: payment.receivedOn,
        });
      row.payments.push(payment);
    }
  }
  for (const item of external.values())
    if (!rows.has(`external:${item.id}`))
      add(`external:${item.id}`, {
        external: item,
        amountCents: item.amountCents,
        date: item.receivedOn,
      });
  for (const event of history) {
    const id = event.externalReceiptId
      ? `external:${event.externalReceiptId}`
      : event.chargeId
        ? `charge:${event.chargeId}`
        : `movement:${event.id}`;
    const row =
      rows.get(id) ??
      add(id, { amountCents: event.amountCents, date: event.occurredAt });
    if (!row.events.some((/** @type {any} */ item) => item.id === event.id))
      row.events.push(event);
  }
  for (const row of rows.values())
    row.events.sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    );
  return [...rows.values()].sort(
    (a, b) =>
      String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
      a.id.localeCompare(b.id),
  );
}
