import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBillingView,
  money,
} from '../apps/edge-web/src/lib/order-billing-view.js';

/*
 * QA PR 457 (LPC-06, LPC-07, LPC-09): property test of the seller's billing
 * view. A hand-written seeded PRNG (no dependency) draws hundreds of synthetic
 * billings — links in every state, receipts, condition, conferência, a
 * cancelled order, operator or not, with or without a conversation — and
 * checks invariants that must hold for any of them. A failure prints the seed
 * and the case; `BILLING_PROP_SEED=<n>` replays one seed.
 */

const ORIGIN = 'https://crm.example.test';
const CASES = 400;
const SEEDS = process.env.BILLING_PROP_SEED
  ? [Number(process.env.BILLING_PROP_SEED)]
  : [1, 7, 457, 20261124];

/** mulberry32: small, fast, deterministic. @param {number} seed */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATES = [
  'open',
  'checkout_requested',
  'checkout_open',
  'unknown',
  'paid',
  'cancelled',
];
const KINDS = ['signal', 'balance', 'full', 'installment'];
const REASONS = [
  'order_changed',
  'refund',
  'late_payment',
  'outside_agreement',
];
const CANCEL = [
  'seller',
  'order_changed',
  'order_cancelled',
  'external_receipt',
  'reconcile',
  null,
];
const METHODS = ['cash', 'pix_external', 'bank_transfer', 'card_external'];

/** @param {() => number} r */
function draw(r) {
  /** @template T @param {readonly T[]} list @returns {T} */
  const pick = (list) => list[Math.floor(r() * list.length)];
  const int = (/** @type {number} */ lo, /** @type {number} */ hi) =>
    lo + Math.floor(r() * (hi - lo + 1));
  const at = (/** @type {number} */ d, /** @type {number} */ h) =>
    new Date(Date.UTC(2026, 10, d, h + 3, int(0, 59))).toISOString();
  const total = int(1, 2000) * 500;
  const review = r() < 0.3;
  const cancelled = r() < 0.15;
  const links = Array.from({ length: int(0, 5) }, (_, i) => {
    const state = pick(STATES);
    const amountCents = int(100, Math.max(100, Math.floor(total / 2)));
    const clicked = ['checkout_requested', 'checkout_open', 'unknown', 'paid'];
    const sent = r() < 0.6;
    return {
      id: `l${i}`,
      kind: pick(KINDS),
      amountCents,
      state,
      origin: sent ? 'sent' : 'generated',
      url:
        r() < 0.85
          ? `${ORIGIN}/pagar/${`L${i}`.padEnd(26, '0')}`
          : r() < 0.5
            ? `https://outro.example.test/pagar/${`L${i}`.padEnd(26, '0')}`
            : null,
      chargeId: clicked.includes(state) ? `c${i}` : null,
      createdAt: at(22, int(8, 12)),
      createdBy: 'Vendedor Teste',
      sentAt: sent ? at(22, 13) : null,
      deliveredAt: sent && r() < 0.5 ? at(22, 14) : null,
      pageOpenedAt: r() < 0.4 ? at(22, 15) : null,
      clickedAt: clicked.includes(state) ? at(23, 9) : null,
      providerValidUntil: state === 'checkout_open' ? at(24, 9) : null,
      paidAt: state === 'paid' ? at(23, 10) : null,
      payMethod: pick(['pix', 'credit_card', null]),
      refundedCents: state === 'paid' && r() < 0.2 ? int(0, amountCents) : 0,
      cancelledAt: state === 'cancelled' ? at(23, 11) : null,
      cancelledBy: state === 'cancelled' && r() < 0.5 ? 'Vendedor Teste' : null,
      cancelReason: state === 'cancelled' ? pick(CANCEL) : null,
      verifying: r() < 0.2 ? { state: 'queued', nextAt: at(23, 12) } : null,
      inReview: review && state === 'paid' && r() < 0.6,
      history: null,
    };
  });
  const externalReceipts = Array.from({ length: int(0, 2) }, (_, i) => ({
    id: `r${i}`,
    amountCents: int(100, Math.max(100, Math.floor(total / 3))),
    receivedOn: '2026-11-22',
    method: pick(METHODS),
    recordedByName: 'Vendedor Teste',
    recordedAt: at(22, 16),
    applicationValid: review ? r() < 0.5 : true,
    reversedAt: r() < 0.15 ? at(23, 8) : null,
  }));
  const billing = {
    canOperate: r() < 0.85,
    ownerName: 'Vendedor Teste',
    condition: { percent: pick([null, 0, 50, 100]) },
    totalAmountCents: total,
    blockedReason: cancelled && r() < 0.5 ? 'ORDER_CANCELLED' : null,
    review: review
      ? {
          reason: pick(REASONS),
          previousTotalCents: r() < 0.5 ? int(1, 2000) * 500 : null,
          heldCents: null,
          refundedCents: null,
        }
      : null,
    settledAt: null,
    links,
    externalReceipts,
    charges: [],
    payments: [],
  };
  const ctx = {
    conv: r() < 0.5,
    pick: /** @type {0|50|100} */ (pick([0, 50, 100])),
    orderNumber: '07-CRM',
    destination: 'Cliente Teste (WhatsApp)',
    cancelled: cancelled && !billing.blockedReason,
  };
  return { billing, ctx, cancelled };
}

/** Every string leaf of a value (raw API data under `item` skipped). @param {unknown} value */
function strings(value, out = /** @type {string[]} */ ([])) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value)) {
      if (['item', 'id', 'act', 'icon', 'tone'].includes(key)) continue;
      strings(v, out);
    }
  return out;
}
/** @param {{parts: Array<string|{strong: string}>}} p */
const text = (p) =>
  p.parts.map((x) => (typeof x === 'string' ? x : x.strong)).join('');
/** @param {number[]} list */
const sum = (list) => list.reduce((s, n) => s + n, 0);

/** @param {ReturnType<typeof draw>} sample */
function check(sample) {
  const v = deriveBillingView(sample.billing, sample.ctx);
  const k = v.figures;
  const shown = [
    ...strings(v.next),
    ...strings(v.summary),
    ...strings(v.rows),
    v.announce,
    v.heldHint,
    ...strings(v.terms),
  ];
  const all = shown.join('\n');

  // 1. No leaked JS values in any text.
  for (const s of shown)
    assert.doesNotMatch(s, /undefined|NaN|\bnull\b|\[object/u, s);
  // Nothing held is never said to be held.
  assert.doesNotMatch(all, /R\$\s0,00 está guardad/u);
  // A money() of an invalid amount prints "—"; never as a figure.
  for (const s of strings(v.summary)) assert.notEqual(s, '—');

  // 2. Displayed values equal the sums of the cents.
  /** @type {any[]} */
  const links = v.links;
  /** @type {any[]} */
  const receipts = v.receipts;
  /** @type {any[]} */
  const waiting = v.groups.waiting;
  const received =
    sum(
      links
        .filter((l) => l.status === 'paid')
        .map((l) => l.amountCents - l.refundedCents),
    ) +
    sum(
      receipts.filter((r) => !r.reversed && !r.held).map((r) => r.amountCents),
    );
  assert.equal(k.received, links.length ? received : k.received);
  assert.equal(k.remaining, Math.max(0, k.total - k.received));
  const open = links.filter((l) =>
    ['waiting', 'paying', 'unknown'].includes(l.status),
  );
  assert.equal(
    k.reserved,
    Math.min(k.remaining, sum(open.map((l) => l.amountCents))),
  );
  assert.equal(k.opened + k.checking, k.reserved);
  assert.equal(k.free, Math.max(0, k.remaining - k.reserved));
  if (!v.cancelled) assert.equal(v.summary.due.value, money(k.remaining));
  if (v.summary.legend) {
    const legend = text({ parts: v.summary.legend });
    if (k.opened > 0)
      assert.ok(legend.includes(`Em links abertos ${money(k.opened)}`), legend);
    if (k.checking > 0)
      assert.ok(legend.includes(`A conferir ${money(k.checking)}`), legend);
    if (legend.includes('Livre para cobrar'))
      assert.ok(legend.includes(`Livre para cobrar ${money(k.free)}`), legend);
  } else assert.ok(v.cancelled || k.reserved === 0);

  // 3. A cancelled order never owes nor charges.
  if (sample.cancelled) {
    assert.equal(v.cancelled, true);
    assert.equal(v.summary.due.label, 'Pedido cancelado');
    assert.doesNotMatch(all, /Falta receber|Livre para cobrar|Falta o saldo/u);
    assert.equal(v.next.primary, null);
    assert.deepEqual(v.next.secondary, []);
    assert.equal(v.next.quiet, null);
  }

  // 4. Resultado a conferir is never counted as aberto.
  const unknownCents = sum(
    links.filter((l) => l.status === 'unknown').map((l) => l.amountCents),
  );
  assert.equal(k.checking, Math.min(k.reserved, unknownCents));
  assert.ok(
    k.opened <=
      sum(
        links
          .filter((l) => ['waiting', 'paying'].includes(l.status))
          .map((l) => l.amountCents),
      ),
  );
  if (k.opened === 0)
    assert.doesNotMatch(
      text({ parts: v.summary.legend ?? [] }),
      /Em links abertos/u,
    );

  // 5. During conferência nothing is free to charge, and no action charges.
  const actions = [v.next.primary, ...v.next.secondary, v.next.quiet].filter(
    Boolean,
  );
  const charging = [
    'send',
    'send-another',
    'send-amount',
    'send-existing',
    'generate',
    'external',
  ];
  if (v.review) {
    assert.doesNotMatch(
      [...strings(v.summary), ...strings(v.next)].join('\n'),
      /Livre para cobrar|livre para cobrar/u,
    );
    for (const a of actions)
      assert.ok(!charging.includes(/** @type {any} */ (a).act), a?.label);
  }

  // 6. Never a message with an empty link; a refused address is said.
  for (const p of v.next.body)
    if (p.tone === 'message')
      assert.match(text(p), /Link para pagamento: https:\/\/\S+\/pagar\//u);
  if (!v.next.lock && !v.next.sending && waiting.some((l) => l.urlBlocked))
    assert.ok(v.next.body.some((p) => p.tone === 'warning'));
  for (const a of actions)
    if (/^copy-/u.test(/** @type {any} */ (a).act)) {
      const target = /** @type {any} */ (a).id
        ? links.find((l) => l.id === /** @type {any} */ (a).id)
        : waiting[0];
      assert.ok(target?.url, `copy action without a URL: ${a?.label}`);
    }

  // 7. §16: one primary, at most two secondaries.
  assert.ok(v.next.secondary.length <= 2);
}

test.before(() => {
  globalThis.location = /** @type {any} */ ({ origin: ORIGIN });
});

for (const seed of SEEDS)
  test(`property: billing view invariants hold (seed ${seed}, ${CASES} cases)`, () => {
    const r = prng(seed);
    for (let i = 0; i < CASES; i += 1) {
      const sample = draw(r);
      try {
        check(sample);
      } catch (error) {
        const cause = /** @type {Error} */ (error);
        throw new Error(
          `seed=${seed} case=${i} — replay with BILLING_PROP_SEED=${seed}\n${cause.message}\nsample: ${JSON.stringify(sample)}`,
          { cause },
        );
      }
    }
  });
