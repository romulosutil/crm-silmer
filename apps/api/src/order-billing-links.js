import { createHash, randomBytes } from 'node:crypto';
import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  BillingError,
  billingPercent,
  billingSplit,
  decryptOrderPrivateJson,
  encryptOrderPrivateJson,
} from '@crm-silmer/orders';
import { readBaseUrl } from './store-order-runtime.js';

// LPC (RFC 074 / ADR 098): the CRM link and the reservation rule shared by the
// seller runtime, the conversation send runtime and the public page.
export const LINK_RESERVING = Object.freeze([
  'open',
  'checkout_requested',
  'checkout_open',
  'unknown',
]);
export const CHARGE_ACTIVE = Object.freeze([
  'queued',
  'creating',
  'waiting',
  'unknown',
]);
const UNCERTAIN_AFTER_MS = 120000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/** 26 Crockford base32 characters = 130 random bits. */
export function newLinkToken() {
  const bytes = randomBytes(17);
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, 26);
}

/** Malformed tokens read as null so they get the uniform unavailable answer.
 * @param {unknown} value */
export function readLinkToken(value) {
  if (typeof value !== 'string' || value.length !== 26) return null;
  const token = value.toUpperCase();
  return TOKEN.test(token) ? token : null;
}

/** @param {string} token */
export function linkTokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** `APP_BASE_URL` is the public CRM origin of `/pagar/{token}`.
 * @param {Record<string,string|undefined>} environment */
export function paymentLinkBase(environment) {
  return readBaseUrl(environment.APP_BASE_URL);
}

/** @param {string} base @param {any} link @param {Buffer} envelopeKey */
export function linkUrl(base, link, envelopeKey) {
  // Without an absolute public origin the client could not open the link.
  if (!base) throw new Error('APP_BASE_URL is required for CRM payment links');
  const { token } = decryptOrderPrivateJson(
    link.token_envelope,
    `billing-link:${link.id}`,
    envelopeKey,
  );
  return `${base}/pagar/${token}`;
}

/** @param {string} kind */
export function linkKindLabel(kind) {
  return kind === 'signal'
    ? 'sinal'
    : kind === 'balance'
      ? 'saldo'
      : kind === 'installment'
        ? 'parcela'
        : 'pagamento integral';
}

/** @param {any} order @param {any} snapshot */
export function agreementMatches(order, snapshot) {
  return (
    order.status === 'confirmado' &&
    !order.cancelled_at &&
    Number(order.final_amount_cents) ===
      Number(snapshot.order_amount_cents ?? snapshot.final_amount_cents) &&
    new Date(order.confirmed_at).getTime() ===
      new Date(snapshot.confirmed_at).getTime() &&
    order.payment_condition === snapshot.payment_condition
  );
}

/** Caller holds plan; links precede charges in the lock order.
 * @param {any} client @param {string} orderId @returns {Promise<any[]>} */
export async function lockLinks(client, orderId) {
  return (
    await client.query(
      'SELECT * FROM crm.order_billing_links WHERE order_id=$1 ORDER BY id FOR UPDATE',
      [orderId],
    )
  ).rows;
}

/** @param {any} client @param {string} orderId @returns {Promise<any[]>} */
async function lockLinkCharges(client, orderId) {
  return (
    await client.query(
      `SELECT c.*,j.status AS job_status FROM crm.order_billing_charges c
       LEFT JOIN crm.outbox_jobs j ON j.job_type='billing.checkout.create' AND j.idempotency_key=c.id::text
       WHERE c.order_id=$1 AND c.link_id IS NOT NULL ORDER BY c.created_sequence FOR UPDATE OF c`,
      [orderId],
    )
  ).rows;
}

/** The lazy transition due for one link, or null. Pure: the locked refresh
 * applies it and the lock-free public read uses it to decide whether it must
 * lock at all. `unknown` never reopens by itself (decision 11).
 * @param {any} link @param {any[]} own its attempts, oldest first (with job_status)
 * @param {Date} now
 * @returns {null|{chargeId:string|null,close?:boolean,reopen?:string,unknown?:boolean,opened?:boolean}} */
export function linkTransition(link, own, now) {
  if (!['checkout_requested', 'checkout_open'].includes(link.state))
    return null;
  const active = own.filter((c) => CHARGE_ACTIVE.includes(c.status)).at(-1);
  const latest = own.at(-1);
  if (!active)
    // An attempt in review stays with its link until the review is resolved.
    return latest?.status === 'review'
      ? null
      : { chargeId: latest?.id ?? null, reopen: 'checkout_expired' };
  // Known outcomes only: never reserved (fence) or a provider checkout that
  // expired. A reserved attempt without answer becomes `unknown`.
  if (
    ['queued', 'waiting'].includes(active.status) &&
    new Date(active.valid_until) <= now
  )
    return { chargeId: active.id, close: true, reopen: 'checkout_expired' };
  // The reservation fence: closed before reserve, n8n can never create it.
  if (
    active.status === 'queued' &&
    !active.execution_id &&
    ['dead_letter', 'outcome_unknown'].includes(active.job_status)
  )
    return { chargeId: active.id, close: true, reopen: 'checkout_failed' };
  if (
    link.state === 'checkout_requested' &&
    (active.status === 'unknown' ||
      (active.status === 'creating' &&
        (['dead_letter', 'outcome_unknown'].includes(active.job_status) ||
          (active.reserved_at &&
            now.getTime() - new Date(active.reserved_at).getTime() >
              UNCERTAIN_AFTER_MS))))
  )
    return { chargeId: active.id, unknown: true };
  if (
    link.state === 'checkout_requested' &&
    active.status === 'waiting' &&
    active.checkout_envelope
  )
    return { chargeId: active.id, opened: true };
  return null;
}

/** Read-only, no locks (decision F): attempts of one link with job status.
 * @param {any} client @param {string} linkId */
export async function linkAttempts(client, linkId) {
  return (
    await client.query(
      `SELECT c.*,j.status AS job_status FROM crm.order_billing_charges c
       LEFT JOIN crm.outbox_jobs j ON j.job_type='billing.checkout.create' AND j.idempotency_key=c.id::text
       WHERE c.link_id=$1 ORDER BY c.created_sequence`,
      [linkId],
    )
  ).rows;
}

/** @param {{clock:()=>Date,idFactory:()=>string}} deps */
export function linkStore(deps) {
  const { clock, idFactory } = deps;
  /** @param {any} client @param {{linkId:string,kind:string,chargeId?:string|null,actorId?:string|null,reason?:string|null,at?:Date}} event */
  async function linkEvent(client, event) {
    await client.query(
      `INSERT INTO crm.order_billing_link_events(id,link_id,kind,charge_id,actor_id,reason,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        idFactory(),
        event.linkId,
        event.kind,
        event.chargeId ?? null,
        event.actorId ?? null,
        event.reason ?? null,
        event.at ?? clock(),
      ],
    );
  }
  /** @param {any} client @param {any} link @param {string} action @param {string|null} actorId @param {string} correlationId */
  async function linkAudit(client, link, action, actorId, correlationId) {
    await new PostgresAuditTrail(client, { clock }).append({
      actor: actorId ?? 'system:payment-link',
      action: `billing.link.${action}`,
      target: { type: 'billing-link', id: link.id },
      version: Number(link.version),
      reason: `BILLING_LINK_${action.toUpperCase()}`,
      correlationId,
    });
  }
  /** @param {any} client @param {any} link @param {Record<string,any>} patch */
  async function setLink(client, link, patch) {
    const keys = Object.keys(patch);
    const sets = keys.map((name, index) => `${name}=$${index + 2}`);
    const row = (
      await client.query(
        `UPDATE crm.order_billing_links SET ${sets.join(',')},version=version+1,updated_at=$${keys.length + 2}
         WHERE id=$1 RETURNING *`,
        [link.id, ...keys.map((name) => patch[name]), clock()],
      )
    ).rows[0];
    Object.assign(link, row);
    return row;
  }
  /** Back to open, or cancelled when the agreement it was made under is gone.
   * @param {any} client @param {any} order @param {any} link @param {string} kind @param {string|null} chargeId @param {string} correlationId */
  async function reopen(client, order, link, kind, chargeId, correlationId) {
    await linkEvent(client, { linkId: link.id, kind, chargeId });
    if (agreementMatches(order, link)) {
      await setLink(client, link, { state: 'open', clicked_at: null });
      await linkAudit(client, link, kind, null, correlationId);
      return;
    }
    const now = clock();
    await setLink(client, link, { state: 'open', clicked_at: null });
    await setLink(client, link, {
      state: 'cancelled',
      cancel_reason: 'order_changed',
      cancelled_at: now,
    });
    await linkEvent(client, {
      linkId: link.id,
      kind: 'cancelled',
      reason: 'order_changed',
      at: now,
    });
    await linkAudit(client, link, 'cancelled', null, correlationId);
  }
  /** Lazy, under the shared locks. `unknown` never reopens by itself (decision 11).
   * @param {any} client @param {any} order @param {any} plan @param {string} correlationId */
  async function refresh(client, order, plan, correlationId) {
    const links = await lockLinks(client, order.id);
    if (!plan || !links.some((l) => LINK_RESERVING.includes(l.state)))
      return links;
    const charges = await lockLinkCharges(client, order.id);
    const now = clock();
    let changed = false;
    for (const link of links) {
      const own = charges.filter((c) => c.link_id === link.id);
      const step = linkTransition(link, own, now);
      if (!step) continue;
      changed = true;
      if (step.close)
        await client.query(
          "UPDATE crm.order_billing_charges SET status='closed',updated_at=$2 WHERE id=$1",
          [step.chargeId, now],
        );
      if (step.reopen) {
        await reopen(
          client,
          order,
          link,
          step.reopen,
          step.chargeId,
          correlationId,
        );
      } else if (step.unknown) {
        await client.query(
          "UPDATE crm.order_billing_charges SET status='unknown',updated_at=$2 WHERE id=$1",
          [step.chargeId, now],
        );
        await setLink(client, link, { state: 'unknown' });
        await linkEvent(client, {
          linkId: link.id,
          kind: 'checkout_unknown',
          chargeId: step.chargeId,
        });
        await linkAudit(client, link, 'checkout_unknown', null, correlationId);
      } else if (step.opened) {
        await setLink(client, link, { state: 'checkout_open' });
      }
    }
    if (changed)
      await client.query(
        'UPDATE crm.order_billing_plans SET version=version+1,updated_at=$2 WHERE order_id=$1',
        [order.id, now],
      );
    return links;
  }
  /** Money figures under the locks: links reserve, legacy active charges too.
   * @param {any} client @param {any} order @param {any[]} links */
  async function figures(client, order, links) {
    const ledger = (
      await client.query(
        'SELECT * FROM crm.order_billing_receipt_ledger WHERE order_id=$1',
        [order.id],
      )
    ).rows;
    const legacy = (
      await client.query(
        `SELECT amount_cents FROM crm.order_billing_charges WHERE order_id=$1 AND link_id IS NULL
         AND status IN ('queued','creating','waiting','unknown')`,
        [order.id],
      )
    ).rows;
    let received = 0;
    let held = 0;
    for (const p of ledger) {
      const net = Math.max(
        0,
        (p.application_valid
          ? Number(p.applied_amount_cents)
          : p.source === 'external'
            ? Number(p.applied_amount_cents)
            : Number(p.principal_amount_cents)) -
          Number(p.refunded_amount_cents),
      );
      if (p.application_valid) received += net;
      else held += net;
    }
    const reservingLinks = links.filter((l) =>
      LINK_RESERVING.includes(l.state),
    );
    const reserved = reservingLinks.reduce(
      (sum, l) => sum + Number(l.amount_cents),
      0,
    );
    // A legacy (pre-LPC) unresolved charge keeps ADR 077 for receipts, but a
    // new link may not overlap it.
    const legacyReserved = legacy.reduce(
      (/** @type {number} */ sum, /** @type {any} */ c) =>
        sum + Number(c.amount_cents),
      0,
    );
    const total = Number(order.final_amount_cents ?? 0);
    const remaining = Math.max(0, total - received);
    return {
      totalCents: total,
      receivedCents: received,
      remainingCents: remaining,
      heldCents: held,
      reservedCents: reserved,
      freeCents: Math.max(0, remaining - reserved),
      linkFreeCents: Math.max(0, remaining - reserved - legacyReserved),
      openLinks: reservingLinks.length + legacy.length,
    };
  }
  /** @param {any} client @param {any} link @param {{reason:string,actorId:string|null,correlationId:string}} input */
  async function cancel(client, link, input) {
    const now = clock();
    await setLink(client, link, {
      state: 'cancelled',
      cancel_reason: input.reason,
      cancelled_at: now,
      cancelled_by: input.actorId,
    });
    await linkEvent(client, {
      linkId: link.id,
      kind: 'cancelled',
      actorId: input.actorId,
      reason: input.reason,
      at: now,
    });
    await linkAudit(
      client,
      link,
      'cancelled',
      input.actorId,
      input.correlationId,
    );
  }
  /** LPC-06: validated against the free amount in the same transaction.
   * @param {any} client
   * @param {{order:any,plan:any,actor:any,amountCents:unknown,percent?:unknown,origin:'sent'|'generated',envelopeKey:Buffer,correlationId:string}} input
   * @returns {Promise<{link:any,plan:any}>} */
  async function create(client, input) {
    const { order, actor } = input;
    let { plan } = input;
    if (order.cancelled_at) throw new BillingError(409, 'ORDER_CANCELLED');
    if (order.origin === 'loja')
      throw new BillingError(409, 'BILLING_STORE_ORDER');
    if (order.status !== 'confirmado')
      throw new BillingError(409, 'BILLING_ORDER_NOT_CONFIRMED');
    const total = Number(order.final_amount_cents);
    if (!Number.isSafeInteger(total) || total < 100)
      throw new BillingError(422, 'BILLING_INVALID_AMOUNT');
    if (!plan && (order.paid_on || order.finance_payment_review_required))
      throw new BillingError(409, 'BILLING_LEGACY_PAYMENT');
    if (plan && (plan.review_required || !agreementMatches(order, plan)))
      throw new BillingError(409, 'BILLING_REVIEW_REQUIRED');
    const amount = input.amountCents;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 100
    )
      throw new BillingError(422, 'BILLING_LINK_AMOUNT_INVALID');
    const links = await refresh(client, order, plan, input.correlationId);
    const figure = await figures(client, order, links);
    if (figure.remainingCents <= 0)
      throw new BillingError(409, 'BILLING_ALREADY_PAID');
    if (amount > figure.linkFreeCents)
      throw new BillingError(409, 'BILLING_LINK_EXCEEDS_FREE');
    const now = clock();
    if (input.percent !== undefined && input.percent !== null) {
      const percent = billingPercent(input.percent);
      if (plan && percent !== plan.percent) {
        const issued = (
          await client.query(
            'SELECT 1 FROM crm.order_billing_charges WHERE order_id=$1 LIMIT 1',
            [order.id],
          )
        ).rows.length;
        if (issued || links.length || figure.receivedCents || figure.heldCents)
          throw new BillingError(409, 'BILLING_CONDITION_LOCKED');
        billingSplit(total, percent);
        plan = (
          await client.query(
            'UPDATE crm.order_billing_plans SET percent=$2,version=version+1,updated_at=$3 WHERE order_id=$1 RETURNING *',
            [order.id, percent, now],
          )
        ).rows[0];
      }
      if (!plan) {
        billingSplit(total, percent);
        plan = (
          await client.query(
            `INSERT INTO crm.order_billing_plans(order_id,percent,confirmed_at,final_amount_cents,payment_condition,created_by,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
            [
              order.id,
              percent,
              order.confirmed_at,
              order.final_amount_cents,
              order.payment_condition,
              actor.id,
              now,
            ],
          )
        ).rows[0];
      }
    }
    if (!plan) throw new BillingError(400, 'BILLING_INVALID_PERCENT');
    const pristine =
      figure.receivedCents === 0 &&
      figure.heldCents === 0 &&
      figure.openLinks === 0;
    let signal = null;
    try {
      signal =
        plan.percent === 50 ? billingSplit(total, 50).signalAmountCents : null;
    } catch {
      signal = null;
    }
    const kind =
      pristine && signal !== null && amount === signal
        ? 'signal'
        : pristine && amount === figure.remainingCents
          ? 'full'
          : figure.openLinks === 0 && amount === figure.linkFreeCents
            ? 'balance'
            : 'installment';
    const id = idFactory();
    const token = newLinkToken();
    const link = (
      await client.query(
        `INSERT INTO crm.order_billing_links(id,order_id,token_hash,token_envelope,amount_cents,kind,origin,confirmed_at,order_amount_cents,payment_condition,created_by,created_at,updated_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [
          id,
          order.id,
          linkTokenHash(token),
          JSON.stringify(
            encryptOrderPrivateJson(
              { token },
              `billing-link:${id}`,
              input.envelopeKey,
            ),
          ),
          amount,
          kind,
          input.origin,
          order.confirmed_at,
          order.final_amount_cents,
          order.payment_condition,
          actor.id,
          now,
        ],
      )
    ).rows[0];
    await linkEvent(client, {
      linkId: link.id,
      kind: 'created',
      actorId: actor.id,
      at: now,
    });
    await linkAudit(client, link, 'created', actor.id, input.correlationId);
    plan = (
      await client.query(
        'UPDATE crm.order_billing_plans SET version=version+1,updated_at=$2 WHERE order_id=$1 RETURNING *',
        [order.id, now],
      )
    ).rows[0];
    return { link, plan };
  }
  return Object.freeze({
    refresh,
    figures,
    cancel,
    create,
    setLink,
    linkEvent,
    linkAudit,
    reopen,
  });
}
