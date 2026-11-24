import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decimal,
  deriveBillingView,
  linkKind,
  messageText,
  nextCharge,
  outsidePlan,
  outsidePrimary,
  outsideReview,
  parseAmount,
  reconcileOptions,
  reviewCheck,
  reviewSource,
  cancelReview,
  LINK_URL_BLOCKED,
  sendFlash,
  sendProgress,
  sendSteps,
  valueSub,
} from '../apps/edge-web/src/lib/order-billing-view.js';
import {
  dateBR,
  dateTimeCommaBR,
  dayMonthTimeBR,
  timeBR,
  todayISO,
} from '../apps/edge-web/src/lib/format.js';
import { billingLinkUrl } from '../apps/edge-web/src/lib/order-billing.js';

// Synthetic order 07-CRM · R$ 4.800,00 · "now" 23/11/2026, 14:05 (UTC−3).
/** @param {number} d @param {number} h @param {number} m */
const at = (d, h, m) => new Date(Date.UTC(2026, 10, d, h + 3, m)).toISOString();
const ORIGIN = 'https://crm.example.test';
const url = (/** @type {string} */ code) =>
  `${ORIGIN}/pagar/${code}0000000000000000000000`;

/** @param {Record<string, any>} o */
function link(o) {
  return {
    id: 'l1',
    kind: 'signal',
    amountCents: 240000,
    state: 'open',
    origin: 'sent',
    url: url('7Q4K'),
    chargeId: null,
    createdAt: at(23, 13, 44),
    createdBy: 'Ana R.',
    sentAt: null,
    deliveredAt: null,
    pageOpenedAt: null,
    clickedAt: null,
    providerValidUntil: null,
    paidAt: null,
    payMethod: 'pix',
    refundedCents: 0,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    verifying: null,
    inReview: false,
    ...o,
  };
}
const paidSignal = () =>
  link({
    id: 'sig',
    state: 'paid',
    chargeId: 'ch-sig',
    createdAt: at(22, 9, 12),
    sentAt: at(22, 9, 13),
    deliveredAt: at(22, 9, 13),
    pageOpenedAt: at(22, 10, 25),
    clickedAt: at(22, 10, 28),
    providerValidUntil: at(23, 10, 28),
    paidAt: at(22, 10, 30),
  });

/** @param {Record<string, any>} o */
function billing(o = {}) {
  return {
    canOperate: true,
    ownerName: 'Ana R.',
    condition: { percent: 50 },
    totalAmountCents: 480000,
    review: null,
    settledAt: null,
    links: [],
    receipts: [],
    charges: [],
    payments: [],
    ...o,
  };
}
/** Server figures for a set of links (the API sends them). */
function withFigures(/** @type {any} */ b) {
  const view = deriveBillingView({ ...b, figures: undefined });
  return {
    ...b,
    figures: {
      totalCents: view.figures.total,
      receivedCents: view.figures.received,
      remainingCents: view.figures.remaining,
      heldCents: view.figures.held,
      reservedCents: view.figures.reserved,
      freeCents: view.figures.free,
    },
  };
}
/** @param {any} b @param {any} [ctx] */
const derive = (b, ctx = {}) =>
  deriveBillingView(withFigures(b), {
    orderNumber: '07-CRM',
    destination: 'Escola Aurora (WhatsApp)',
    conv: true,
    ...ctx,
  });
/** @param {any} p */
const text = (p) =>
  p.parts
    .map((/** @type {any} */ x) => (typeof x === 'string' ? x : x.strong))
    .join('');
/** @param {any} model */
const body = (model) => model.body.map(text).join(' ');

// Intl puts a no-break space after "R$"; the assertions read plain spaces.
/** @param {unknown} value */
const plain = (value) =>
  JSON.parse(JSON.stringify(value ?? null).replaceAll('\u00a0', ' '));
/** @param {unknown} actual @param {unknown} expected */
const eq = (actual, expected) => assert.equal(plain(actual), plain(expected));
/** @param {unknown} actual @param {unknown} expected */
const deq = (actual, expected) =>
  assert.deepEqual(plain(actual), plain(expected));

test.before(() => {
  globalThis.location = /** @type {any} */ ({ origin: ORIGIN });
});

test('format: store clock helpers', () => {
  eq(timeBR(at(23, 14, 5)), '14:05');
  eq(dayMonthTimeBR(at(23, 14, 5)), '23/11, 14:05');
  eq(dateTimeCommaBR(at(23, 14, 5)), '23/11/2026, 14:05');
  eq(dateBR('2026-11-23'), '23/11/2026');
  eq(timeBR(null), '');
  eq(todayISO(new Date(at(23, 23, 30))), '2026-11-23');
});

test('LPC-01: only same-origin /pagar/ links are shown', () => {
  eq(billingLinkUrl(url('7Q4K'), ORIGIN), url('7Q4K'));
  eq(billingLinkUrl('https://evil.test/pagar/7Q4K2M', ORIGIN), '');
  eq(billingLinkUrl(`${ORIGIN}/admin`, ORIGIN), '');
  eq(billingLinkUrl(`${url('7Q4K')}?x=1`, ORIGIN), '');
});

test('parseAmount: empty, invalid and pt-BR amounts', () => {
  eq(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  eq(parseAmount('1.200,00'), 120000);
  eq(parseAmount('R$ 2.400'), 240000);
  eq(parseAmount('0,5'), 50);
  eq(decimal(120000), '1.200,00');
});

test('scenario 1: sem cobrança, condition still to agree', () => {
  const v = derive(billing({ condition: null }), { pick: 50 });
  eq(v.badge.label, 'Sem cobrança');
  eq(v.terms.strong, 'ainda não combinada');
  eq(body(v.next), 'Combine a condição com o cliente.');
  deq(
    v.next.terms.cards.map((/** @type {any} */ c) => c.detail),
    [
      'R$ 0,00 agora · R$ 4.800,00 depois',
      'R$ 2.400,00 agora · R$ 2.400,00 depois',
      'R$ 4.800,00 agora',
    ],
  );
  eq(v.next.primary?.label, 'Enviar link de R$ 2.400,00 na conversa');
  eq(v.next.secondary[0].label, 'Só gerar o link');
  const zero = derive(billing({ condition: null }), { pick: 0 });
  eq(zero.next.primary?.label, 'Salvar sem entrada');
  eq(zero.next.secondary.length, 0);
  const noConv = derive(billing({ condition: null }), {
    pick: 100,
    conv: false,
  });
  eq(noConv.next.primary?.label, 'Gerar link de R$ 4.800,00');
  eq(v.rows.length, 0);
});

test('scenario 2: send review figures for the first link', () => {
  const v = derive(billing({ condition: null }));
  const nc = nextCharge(v, 50);
  deq(nc, {
    kind: 'signal',
    amountCents: 240000,
    fromPick: true,
    condition: 50,
  });
  eq(valueSub('signal', v.figures), 'Sinal · 50% de R$ 4.800,00');
  eq(
    messageText('07-CRM', 'signal', 240000, url('7Q4K')),
    `Pedido 07-CRM — sinal de R$ 2.400,00. Link para pagamento: ${url('7Q4K')}`,
  );
  deq(sendSteps('send', false), [
    'Gerando link',
    'Enviando',
    'Enviado',
    'Entregue',
  ]);
  deq(sendSteps('send', true), ['Enviando', 'Enviado', 'Entregue']);
  deq(sendProgress(sendSteps('send', false), 'sent'), {
    index: 2,
    done: false,
    failed: '',
  });
  eq(sendProgress(['Enviando'], 'delivered').done, true);
  eq(sendProgress(['Enviando'], 'failed').failed, 'failed');
  eq(
    sendFlash('send', 'signal', at(23, 14, 6)),
    'Link do sinal enviado na conversa e entregue às 14:06. Você pode cancelá-lo enquanto o cliente não clicar em Pagar.',
  );
});

test('scenario 2b: while sending, the next step tracks the steps', () => {
  const steps = sendSteps('send', false);
  const v = derive(billing(), {
    sending: {
      mode: 'send',
      kind: 'signal',
      amountCents: 240000,
      steps,
      index: 1,
    },
  });
  eq(
    body(v.next),
    'Enviando o link do sinal de R$ 2.400,00 para Escola Aurora (WhatsApp).',
  );
  deq(v.next.sending, { steps, index: 1 });
  eq(v.badge.label, 'Sem cobrança');
});

const waitingSignal = () =>
  link({
    sentAt: at(23, 13, 45),
    deliveredAt: at(23, 13, 46),
    pageOpenedAt: at(23, 13, 50),
  });

test('scenario 3: aguardando o cliente', () => {
  const v = derive(billing({ links: [waitingSignal()] }));
  deq(v.badge, { label: 'Aguardando o cliente', tone: 'info', icon: 'clock' });
  eq(v.figures.reserved, 240000);
  eq(v.figures.free, 240000);
  eq(v.figures.pctRes, 50);
  eq(
    body(v.next),
    'Link do sinal enviado na conversa · Entregue às 13:46. O cliente ainda não clicou em Pagar.',
  );
  // PO 2026-11-24: another link up to the free amount is offered here too.
  deq(plain(v.next.primary), {
    label: 'Enviar outro link de até R$ 2.400,00',
    act: 'send-another',
  });
  deq(
    v.next.secondary.map((/** @type {any} */ a) => a.label),
    ['Copiar link', 'Cancelar link'],
  );
  eq(v.next.quiet?.q, 'Recebeu por outro meio?');
  const [row] = v.rows;
  eq(row.title, 'Sinal · 50%');
  eq(
    row.meta,
    'Enviado na conversa · 23/11, 13:45 · cliente abriu a página às 13:50, sem clicar em Pagar',
  );
  deq(
    row.menu.map((/** @type {any} */ m) => m.label),
    ['Copiar link', 'Cancelar link'],
  );
  deq(
    row.events.map((/** @type {any} */ e) => e.label),
    [
      'Link do CRM criado por Ana R.',
      'Enviado na conversa',
      'Entregue',
      'Cliente abriu a página',
    ],
  );
});

test('scenario 4: em pagamento', () => {
  const paying = link({
    state: 'checkout_open',
    chargeId: 'ch1',
    sentAt: at(23, 13, 45),
    deliveredAt: at(23, 13, 46),
    pageOpenedAt: at(23, 13, 50),
    clickedAt: at(23, 14, 2),
    providerValidUntil: at(24, 14, 2),
  });
  const v = derive(
    billing({
      links: [paying],
      charges: [
        { id: 'ch1', checkoutUrl: 'https://checkout.infinitepay.io/x' },
      ],
    }),
  );
  eq(v.badge.label, 'Em pagamento');
  eq(
    body(v.next),
    'O cliente abriu o pagamento na InfinitePay às 14:02. Este link não pode mais ser cancelado.',
  );
  eq(
    text(v.next.after[0]),
    'Se não pagar até 24/11, 14:02, o link volta a aceitar um novo clique.',
  );
  eq(v.next.quiet?.label, 'Verificar pagamento na InfinitePay');
  eq(v.next.secondary[0].label, 'Registrar pagamento por fora');
  eq(v.rows[0].meta, 'Aberto na InfinitePay às 14:02 · vale até 24/11, 14:02');
  deq(
    v.rows[0].menu.map((/** @type {any} */ m) => m.label),
    ['Abrir na InfinitePay', 'Verificar pagamento na InfinitePay'],
  );
  const verifying = derive(
    billing({ links: [{ ...paying, verifying: { nextAt: at(23, 14, 10) } }] }),
  );
  eq(verifying.next.quiet, null);
  eq(
    verifying.rows[0].badge.label,
    'Verificando na InfinitePay · nova consulta às 14:10',
  );
});

test('scenario 5: link sent with the wrong amount', () => {
  const wrong = link({
    kind: 'installment',
    amountCents: 200000,
    createdAt: at(23, 13, 40),
    sentAt: at(23, 13, 40),
    deliveredAt: at(23, 13, 41),
  });
  const v = derive(billing({ links: [wrong] }));
  eq(v.next.tone, 'attention');
  eq(
    body(v.next),
    'O link enviado às 13:40 cobra R$ 2.000,00, mas o sinal combinado é R$ 2.400,00. O cliente ainda não clicou em Pagar. Enviou o valor errado? Cancele antes que o cliente clique em Pagar.',
  );
  eq(v.next.primary?.label, 'Cancelar link de R$ 2.000,00');
  eq(v.figures.free, 280000);
  eq(v.rows[0].title, 'Parcela');
});

const part1200 = () =>
  link({
    id: 'p1',
    kind: 'installment',
    amountCents: 120000,
    createdAt: at(23, 10, 15),
    sentAt: at(23, 10, 15),
    deliveredAt: at(23, 10, 16),
  });

test('scenario 6: several links summing', () => {
  const v = derive(billing({ links: [paidSignal(), part1200()] }));
  eq(v.badge.label, 'Aguardando o cliente');
  deq(
    [
      v.figures.received,
      v.figures.reserved,
      v.figures.free,
      v.figures.pct,
      v.figures.pctRes,
    ],
    [240000, 120000, 120000, 50, 25],
  );
  eq(
    body(v.next),
    'Sinal de R$ 2.400,00 recebido por Pix em 22/11. A parcela de R$ 1.200,00 aguarda o cliente desde 23/11, 10:15. Livre para cobrar R$ 1.200,00.',
  );
  eq(v.next.primary?.label, 'Enviar outro link de até R$ 1.200,00');
  eq(linkKind(v, 120000), 'part');
  eq(linkKind(v, 50000), 'part');
  const gen = derive(billing({ links: [paidSignal(), part1200()] }), {
    conv: false,
  });
  eq(gen.next.primary?.label, 'Gerar outro link de até R$ 1.200,00');
});

test('scenario 7: pago por fora com link aberto cancels it in the same step', () => {
  const balance = link({
    id: 'bal',
    kind: 'balance',
    amountCents: 240000,
    createdAt: at(23, 9, 10),
    sentAt: at(23, 9, 10),
    deliveredAt: at(23, 9, 11),
  });
  const v = derive(billing({ links: [paidSignal(), balance] }));
  eq(v.figures.free, 0);
  eq(v.next.primary?.label, 'Registrar pagamento por fora');
  const plan = outsidePlan(240000, v);
  deq(
    plan.cancel.map((l) => l.id),
    ['bal'],
  );
  eq(
    outsidePrimary(240000, plan),
    'Cancelar o link do saldo e registrar R$ 2.400,00',
  );
  eq(
    text({ parts: outsideReview(240000, plan, v.figures) }),
    'Link do saldo: cancelado · Recebido passa a R$ 4.800,00 · Quitado',
  );
  // Em pagamento: refuse, with the reason.
  const paying = derive(
    billing({
      links: [
        paidSignal(),
        { ...balance, state: 'checkout_open', clickedAt: at(23, 14, 3) },
      ],
    }),
  );
  const refused = outsidePlan(240000, paying);
  eq(refused.ok, false);
  eq(
    refused.refuse,
    'Link do saldo (R$ 2.400,00) está Em pagamento. O cliente está pagando este link na InfinitePay. Aguarde ou verifique o pagamento.',
  );
  eq(outsidePlan(500000, v).ok, false);
  eq(outsidePlan(240000, v).refuse, '');
});

test('scenario 8: precisa de conferência after the value changed', () => {
  const held = link({
    id: 'held',
    state: 'paid',
    inReview: true,
    amountCents: 225000,
    chargeId: 'ch-held',
    clickedAt: at(22, 10, 28),
    paidAt: at(22, 10, 30),
  });
  const cancelled = link({
    id: 'bal',
    kind: 'balance',
    amountCents: 225000,
    state: 'cancelled',
    sentAt: at(22, 11, 0),
    cancelledAt: at(23, 9, 0),
    cancelReason: 'order_changed',
  });
  const v = derive(
    billing({
      links: [held, cancelled],
      review: {
        reason: 'order_changed',
        previousTotalCents: 450000,
        heldCents: 225000,
      },
    }),
  );
  deq(v.badge, {
    label: 'Precisa de conferência',
    tone: 'warning',
    icon: 'alert',
  });
  eq(v.next.tone, 'attention');
  eq(
    text(v.next.body[0]),
    'O valor do pedido mudou de R$ 4.500,00 para R$ 4.800,00 depois que o sinal foi pago. O sinal de R$ 2.250,00 está guardado, mas ainda não conta no recebido.',
  );
  eq(
    text(v.next.body[1]),
    'Se o valor do pedido muda, links que o cliente ainda não clicou são cancelados sozinhos. Aqui, o link do saldo de R$ 2.250,00, que o cliente ainda não clicou, foi cancelado.',
  );
  eq(v.next.primary?.label, 'Resolver conferência');
  eq(v.heldHint, 'Guardado para conferência: R$ 2.250,00, fora do recebido.');
  eq(v.rows[0].badge.label, 'Precisa de conferência');
  eq(v.rows[1].sub, 'fora da soma');
  const r = reconcileOptions(v);
  eq(r.apply.ok, true);
  eq(r.apply.detail, 'Recebido passa a R$ 2.250,00 · falta R$ 2.550,00');
  eq(r.cancel.ok, false);
  eq(r.cancel.reason, 'Não há link que o cliente ainda não clicou.');
  // A refund review states the refund.
  const refund = derive(
    billing({
      links: [{ ...paidSignal(), refundedCents: 50000 }],
      review: { reason: 'refund', heldCents: 0 },
    }),
  );
  assert.match(
    plain(text(refund.next.body[0])),
    /^Foi registrada uma devolução de R\$ 500,00 no sinal\./,
  );
});

test('scenario 8b: a link Em pagamento blocks only the cancel option', () => {
  const held = link({
    id: 'held',
    state: 'paid',
    inReview: true,
    amountCents: 225000,
    paidAt: at(22, 10, 30),
  });
  const paying = link({
    id: 'bal',
    kind: 'balance',
    amountCents: 225000,
    state: 'checkout_open',
    clickedAt: at(23, 14, 2),
  });
  const v = derive(
    billing({
      links: [held, paying],
      review: {
        reason: 'order_changed',
        previousTotalCents: 450000,
        heldCents: 225000,
      },
    }),
  );
  const r = reconcileOptions(v);
  eq(r.apply.ok, true);
  eq(r.cancel.ok, false);
  eq(
    r.cancel.reason,
    'O cliente está pagando o link do saldo na InfinitePay (aberto às 14:02).',
  );
});

test('scenario 9: resultado a conferir locks the link', () => {
  const u = link({
    state: 'unknown',
    sentAt: at(23, 13, 45),
    clickedAt: at(23, 14, 2),
    history: [
      { kind: 'created', at: at(23, 13, 44), actor: 'Ana R.' },
      { kind: 'clicked', at: at(23, 14, 2) },
      { kind: 'checkout_unknown', at: at(23, 14, 3) },
    ],
  });
  const v = derive(billing({ links: [u] }));
  deq(v.badge, {
    label: 'Resultado a conferir',
    tone: 'warning',
    icon: 'alert',
  });
  eq(
    body(v.next),
    'O cliente clicou em Pagar às 14:02, mas não sabemos se a InfinitePay abriu o pagamento. O link fica travado até confirmar.',
  );
  eq(v.next.primary?.label, 'Confirmar resultado na InfinitePay');
  eq(
    text(v.next.after[0]),
    'Sem resposta da InfinitePay desde 14:03. O link não reabre sozinho e nenhum pagamento novo é criado até você confirmar o resultado.',
  );
  // Decision 7 + 11: it reserves, but is never counted as aberto.
  eq(v.figures.reserved, 240000);
  eq(v.figures.checking, 240000);
  eq(v.figures.opened, 0);
  deq(v.summary.legend, [
    'A conferir ',
    { strong: 'R$ 2.400,00' },
    ' · ',
    'Livre para cobrar ',
    { strong: 'R$ 2.400,00' },
  ]);
  deq(
    v.rows[0].events.map((/** @type {any} */ e) => e.label),
    [
      'Link do CRM criado por Ana R.',
      'Cliente clicou em Pagar',
      'Sem resposta da InfinitePay · o link fica travado até confirmar o resultado',
    ],
  );
  const busy = derive(
    billing({ links: [{ ...u, verifying: { nextAt: at(23, 14, 10) } }] }),
  );
  eq(busy.next.primary?.label, 'Confirmando resultado…');
  eq(busy.next.primary?.busy, true);
  eq(busy.rows[0].menu.length, 0);
});

test('scenario 10: quitado by links and an outside receipt', () => {
  const v = derive(
    billing({
      links: [
        paidSignal(),
        link({
          id: 'c',
          kind: 'installment',
          amountCents: 200000,
          state: 'cancelled',
          createdAt: at(23, 9, 0),
          sentAt: at(23, 9, 0),
          cancelledAt: at(23, 9, 4),
          cancelledBy: 'Ana R.',
          cancelReason: 'seller',
        }),
        link({
          id: 'p',
          kind: 'installment',
          amountCents: 120000,
          state: 'paid',
          chargeId: 'ch-p',
          payMethod: 'credit_card',
          createdAt: at(23, 10, 15),
          sentAt: at(23, 10, 15),
          paidAt: at(23, 10, 42),
        }),
      ],
      receipts: [
        {
          id: 'r1',
          amountCents: 120000,
          receivedOn: '2026-11-23',
          method: 'bank_transfer',
          recordedByName: 'Ana R.',
          recordedAt: at(23, 11, 30),
          note: '',
        },
      ],
      settledAt: at(23, 11, 30),
    }),
  );
  deq(v.badge, { label: 'Quitado', tone: 'success', icon: 'check' });
  eq(v.next.tone, 'success');
  eq(v.next.title, 'Tudo recebido');
  eq(
    body(v.next),
    'Pedido quitado em 23/11: 3 recebimentos somam R$ 4.800,00.',
  );
  deq(
    v.rows.map((r) => r.title),
    ['Sinal · 50%', 'Parcela', 'Parcela', 'Recebido por fora · Transferência'],
  );
  const cancelledRow = v.rows[1];
  eq(cancelledRow.struck, true);
  eq(
    cancelledRow.meta,
    'Enviado na conversa · 23/11, 09:00 · cancelado por Ana R. às 09:04',
  );
  eq(v.rows[2].meta, 'Pago por Cartão pela InfinitePay · 23/11/2026, 10:42');
  deq(
    v.rows[2].menu.map((m) => m.label),
    ['Ver comprovante', 'Registrar devolução'],
  );
  eq(v.rows[3].meta, 'Registrado por Ana R. · recebido em 23/11/2026');
  deq(
    v.rows[3].menu.map((m) => m.label),
    ['Estornar registro'],
  );
});

test('other seller: numbers, badge and rows; no actions, no links', () => {
  const v = derive(
    billing({ canOperate: false, links: [{ ...waitingSignal(), url: null }] }),
  );
  eq(v.badge.label, 'Aguardando o cliente');
  eq(
    v.next.lock,
    'Só Ana R. (responsável) ou um administrador opera as cobranças deste pedido.',
  );
  eq(v.rows[0].menu.length, 0);
  eq(v.rows[0].item.url, '');
});

test('generated link without a conversation: copy the message', () => {
  const v = derive(billing({ links: [link({ origin: 'generated' })] }), {
    conv: false,
  });
  eq(v.next.primary?.label, 'Copiar mensagem');
  eq(
    text(v.next.body[1]),
    `Pedido 07-CRM — sinal de R$ 2.400,00. Link para pagamento: ${url('7Q4K')}`,
  );
  const conv = derive(billing({ links: [link({ origin: 'generated' })] }));
  eq(conv.next.primary?.label, 'Enviar link na conversa');
});

test('balance smaller than R$ 1,00 explains why the link is unavailable', () => {
  const v = derive(
    billing({
      totalAmountCents: 240050,
      condition: { percent: 100 },
      links: [{ ...paidSignal(), kind: 'full' }],
    }),
  );
  eq(
    v.next.primary?.disabled,
    'O saldo é menor que R$ 1,00, o mínimo de um link. Registre-o como pagamento por fora.',
  );
});

test('condition 0: no link, change terms offered', () => {
  const v = derive(billing({ condition: { percent: 0 } }), { conv: false });
  eq(v.terms.strong, 'Sem entrada');
  deq(
    v.next.secondary.map((a) => a.label),
    ['Gerar link de R$ 4.800,00', 'Registrar pagamento por fora'],
  );
  eq(v.next.quiet?.label, 'Mudar condição');
});

test('a finished payment check no longer reads as Verificando', () => {
  const paying = link({
    state: 'checkout_open',
    chargeId: 'ch1',
    clickedAt: at(23, 14, 2),
    verifying: { state: 'not_paid', nextAt: null },
  });
  const v = derive(billing({ links: [paying] }));
  eq(v.rows[0].badge.label, 'Em pagamento');
  eq(v.next.quiet?.label, 'Verificar pagamento na InfinitePay');
});

test('contract fields: review.refundedCents, invoiceCode and the link checkout', () => {
  const refund = derive(
    billing({
      links: [{ ...paidSignal(), refundedCents: 50000 }],
      review: { reason: 'refund', heldCents: 0, refundedCents: 30000 },
    }),
  );
  assert.match(
    plain(text(refund.next.body[0])),
    /^Foi registrada uma devolução de R\$ 300,00 no sinal\./,
  );
  const v = derive(
    billing({
      links: [
        link({
          state: 'unknown',
          chargeId: 'ch1',
          clickedAt: at(23, 14, 2),
          checkoutUrl: 'https://checkout.infinitepay.io/x',
          invoiceCode: 'FAT-SINTETICA',
        }),
      ],
    }),
  );
  eq(v.links[0].invoiceCode, 'FAT-SINTETICA');
  eq(v.providerUrl(v.links[0]), 'https://checkout.infinitepay.io/x');
  eq(v.next.primary?.act, 'confirm-unknown');
  eq(v.next.primary?.label, 'Confirmar resultado na InfinitePay');
});

test('reconcile: reserving links count before applying the payments', () => {
  const held = link({
    id: 'held',
    state: 'paid',
    inReview: true,
    amountCents: 225000,
    paidAt: at(22, 10, 30),
  });
  const open = link({
    id: 'open',
    kind: 'installment',
    amountCents: 300000,
    sentAt: at(23, 9, 0),
  });
  const review = {
    reason: 'order_changed',
    previousTotalCents: 450000,
    heldCents: 225000,
  };
  const tipped = reconcileOptions(
    derive(billing({ links: [held, open], review })),
  );
  eq(tipped.apply.ok, false);
  eq(
    tipped.apply.reason,
    'Os pagamentos e os links abertos somam R$ 5.250,00, mais que o total de R$ 4.800,00. Cancele links que o cliente ainda não clicou antes de aplicar.',
  );
  eq(tipped.cancel.ok, true);
  eq(tipped.initial, 'cancel');
  const paying = reconcileOptions(
    derive(
      billing({
        links: [
          held,
          { ...open, state: 'checkout_open', clickedAt: at(23, 14, 2) },
        ],
        review,
      }),
    ),
  );
  eq(paying.apply.ok, false);
  eq(paying.cancel.ok, false);
  const alone = reconcileOptions(
    derive(
      billing({
        links: [{ ...held, amountCents: 500000 }],
        review: { ...review, heldCents: 500000 },
      }),
    ),
  );
  eq(
    alone.apply.reason,
    'Os pagamentos somam R$ 5.000,00, mais que o total de R$ 4.800,00.',
  );
});

test('cancelled link rows say why the link was cancelled', () => {
  const cancelled = (
    /** @type {string} */ id,
    /** @type {string} */ cancelReason,
    /** @type {string|null} */ cancelledBy,
  ) =>
    link({
      id,
      kind: 'installment',
      amountCents: 100000,
      state: 'cancelled',
      createdAt: at(23, 9, 0),
      cancelledAt: at(23, 9, 4),
      cancelledBy,
      cancelReason,
      history: [
        { kind: 'created', at: at(23, 9, 0), actor: 'Ana R.' },
        { kind: 'cancelled', at: at(23, 9, 4), actor: cancelledBy },
      ],
    });
  const v = derive(
    billing({
      links: [
        cancelled('a', 'order_cancelled', null),
        cancelled('b', 'order_changed', null),
        cancelled('c', 'external_receipt', 'Ana R.'),
        cancelled('d', 'reconcile', 'Ana R.'),
        cancelled('e', 'seller', 'Ana R.'),
      ],
    }),
  );
  const how = 'Link gerado, não enviado · 23/11, 09:00 · cancelado';
  deq(
    v.rows.map((r) => r.meta),
    [
      `${how} às 09:04: o pedido foi cancelado`,
      `${how} às 09:04: o valor do pedido mudou`,
      `${how} por Ana R. às 09:04: pagamento registrado por fora`,
      `${how} por Ana R. às 09:04: resolvido na conferência`,
      `${how} por Ana R. às 09:04`,
    ],
  );
  deq(
    v.rows.map((r) => r.events.map((/** @type {any} */ e) => e.label).at(-1)),
    [
      'Link cancelado sozinho: o pedido foi cancelado',
      'Link cancelado sozinho: o valor do pedido mudou',
      'Link cancelado por Ana R. ao registrar pagamento por fora',
      'Link cancelado por Ana R. na conferência',
      'Link cancelado por Ana R.',
    ],
  );
});

// QA findings on PR 457 (LPC-09). Synthetic data only.

test('QA 6: conferência held by a Pix registered outside speaks of it, not of the InfinitePay', () => {
  const pix = {
    id: 'r1',
    amountCents: 150000,
    receivedOn: '2026-11-22',
    method: 'pix_external',
    recordedByName: 'Ana R.',
    recordedAt: at(22, 15, 0),
    applicationValid: false,
  };
  const v = deriveBillingView(
    billing({
      externalReceipts: [pix],
      receipts: undefined,
      review: {
        reason: 'order_changed',
        previousTotalCents: 450000,
        heldCents: 150000,
      },
      figures: {
        totalCents: 480000,
        receivedCents: 0,
        remainingCents: 480000,
        heldCents: 150000,
        reservedCents: 0,
        freeCents: 480000,
      },
    }),
    { orderNumber: '07-CRM', conv: true },
  );
  eq(reviewSource(v), 'outside');
  const all = body(v.next);
  eq(
    text(v.next.body[0]),
    'O valor do pedido mudou de R$ 4.500,00 para R$ 4.800,00 depois que um pagamento por fora (Pix) foi registrado. O recebimento de R$ 1.500,00 está guardado, mas ainda não conta no recebido.',
  );
  assert.doesNotMatch(all, /confirmad|InfinitePay/u);
  eq(
    text(v.next.body.at(-1)),
    'Resolver pede que você confira o que foi registrado por fora e escolha o que fazer com esses pagamentos.',
  );
  eq(v.rows[0].badge.label, 'Guardado para conferência');
  assert.doesNotMatch(reviewCheck('outside').lead, /InfinitePay/u);
  // QA 9: nothing is "livre para cobrar" during conferência.
  eq(v.summary.legend, null);
  // Without previousTotalCents the sentence never invents R$ 0,00.
  const noPrev = deriveBillingView(
    billing({
      externalReceipts: [pix],
      receipts: undefined,
      review: { reason: 'order_changed', heldCents: 150000 },
    }),
  );
  assert.match(text(noPrev.next.body[0]), /^O acordo do pedido mudou depois/u);
  // A link payment held keeps the InfinitePay wording; both say both.
  const held = link({ id: 'h', state: 'paid', inReview: true });
  const both = deriveBillingView(
    billing({
      links: [held],
      externalReceipts: [pix],
      receipts: undefined,
      review: { reason: 'outside_agreement', heldCents: 390000 },
    }),
  );
  eq(reviewSource(both), 'both');
  assert.match(
    text(both.next.body.at(-1)),
    /InfinitePay e os registrados por fora/u,
  );
  const late = deriveBillingView(
    billing({
      externalReceipts: [pix],
      receipts: undefined,
      review: { reason: 'outside_agreement', heldCents: 150000 },
    }),
  );
  eq(
    text(late.next.body[0]),
    'Um pagamento registrado por fora (Pix) não cabe no acordo atual do pedido. R$ 1.500,00 está guardado, mas ainda não conta no recebido.',
  );
});

test('QA 7/8: a link A conferir is apart from the open links and never said to retry', () => {
  const v = derive(
    billing({
      links: [
        paidSignal(),
        link({
          id: 'u',
          kind: 'installment',
          amountCents: 120000,
          state: 'unknown',
          clickedAt: at(23, 14, 2),
        }),
        link({
          id: 'w',
          kind: 'installment',
          amountCents: 60000,
          sentAt: at(23, 13, 45),
        }),
      ],
    }),
  );
  eq(v.figures.reserved, 180000);
  eq(v.figures.opened, 60000);
  eq(v.figures.checking, 120000);
  deq(v.summary.legend, [
    'Em links abertos ',
    { strong: 'R$ 600,00' },
    ' · ',
    'A conferir ',
    { strong: 'R$ 1.200,00' },
    ' · ',
    'Livre para cobrar ',
    { strong: 'R$ 600,00' },
  ]);
  const words = JSON.stringify(plain(v.next)) + JSON.stringify(plain(v.rows));
  assert.doesNotMatch(words, /tenta de novo|tentativa automática/u);
  // Cancelling the waiting link frees only the open part.
  eq(cancelReview(v.groups.waiting[0], v.figures).reserved, 0);
});

test('QA 9: during conferência the legend never offers a free amount', () => {
  const v = deriveBillingView(
    billing({
      links: [
        link({ id: 'h', state: 'paid', inReview: true, amountCents: 150000 }),
        link({
          id: 'p',
          kind: 'balance',
          state: 'checkout_open',
          amountCents: 120000,
          clickedAt: at(23, 14, 2),
        }),
      ],
      review: { reason: 'late_payment', heldCents: 150000 },
      figures: {
        totalCents: 480000,
        receivedCents: 0,
        remainingCents: 480000,
        heldCents: 150000,
        reservedCents: 120000,
        freeCents: 360000,
      },
    }),
  );
  deq(v.summary.legend, ['Em links abertos ', { strong: 'R$ 1.200,00' }]);
  assert.doesNotMatch(
    JSON.stringify(plain(v.next)),
    /Livre para cobrar|outro link/u,
  );
});

test('QA 10: a cancelled order owes nothing and offers no charge', () => {
  for (const ctx of [
    { cancelled: true },
    { readOnly: 'Pedido cancelado.' },
    {},
  ]) {
    const v = deriveBillingView(
      billing({
        blockedReason: ctx.cancelled || ctx.readOnly ? null : 'ORDER_CANCELLED',
        links: [link({ state: 'cancelled', cancelReason: 'order_cancelled' })],
      }),
      { ...ctx, cancelled: ctx.cancelled || Boolean(ctx.readOnly) },
    );
    deq(v.summary.due, { label: 'Pedido cancelado', value: 'Nada a receber' });
    eq(v.summary.legend, null);
    eq(v.next.primary, null);
    deq(v.next.secondary, []);
    assert.ok(v.next.lock);
    assert.doesNotMatch(v.announce, /Falta receber/u);
  }
});

test('QA 11: a link from another CRM origin is said, never copied empty', () => {
  const foreign =
    'https://crm-oficial.example.test/pagar/G10000000000000000000000';
  for (const conv of [false, true]) {
    const v = derive(
      billing({ links: [link({ origin: 'generated', url: foreign })] }),
      { conv },
    );
    eq(v.links[0].url, '');
    eq(v.links[0].urlBlocked, true);
    const all = plain(v.next);
    assert.ok(
      all.body.some(
        (/** @type {any} */ p) =>
          p.tone === 'warning' && text(p) === plain(LINK_URL_BLOCKED),
      ),
    );
    assert.ok(!all.body.some((/** @type {any} */ p) => p.tone === 'message'));
    assert.doesNotMatch(JSON.stringify(all), /Link para pagamento: ?["\]]/u);
    assert.ok(
      ![all.primary, ...all.secondary].some(
        (/** @type {any} */ a) => a && /^copy-/u.test(a.act),
      ),
    );
    assert.doesNotMatch(JSON.stringify(all), /crm-oficial/u);
  }
  // Another seller gets no URL at all: no warning for them.
  const other = derive(
    billing({
      canOperate: false,
      links: [link({ origin: 'generated', url: null })],
    }),
  );
  eq(other.links[0].urlBlocked, false);
});

test('QA 12 (PO 2026-11-24): one link not sent yet also offers another link up to the free amount', () => {
  /** @param {any} v */
  const acts = (v) =>
    plain([
      v.next.primary && [v.next.primary.act, v.next.primary.label],
      ...v.next.secondary.map((/** @type {any} */ a) => [a.act, a.label]),
    ]);
  const generated = billing({ links: [link({ origin: 'generated' })] });
  // Without a conversation: Gerar, as in the case of several links.
  const plainView = derive(generated, { conv: false });
  deq(acts(plainView), [
    ['copy-message', 'Copiar mensagem'],
    ['cancel-link', 'Cancelar link'],
    ['send-another', 'Gerar outro link de até R$ 2.400,00'],
  ]);
  // With a conversation the two secondaries are full: Cancelar link stays in
  // the row's "Mais ações" menu, where it already is (§16, nothing lost).
  const conv = derive(generated);
  deq(acts(conv), [
    ['send-existing', 'Enviar link na conversa'],
    ['copy-message', 'Copiar mensagem'],
    ['send-another', 'Enviar outro link de até R$ 2.400,00'],
  ]);
  deq(
    conv.rows[0].menu.map((/** @type {any} */ m) => m.act),
    ['copy-link', 'cancel-link'],
  );
  // The Inbox carries only copy/cancel in its footer: it keeps Cancelar link.
  deq(acts(derive(generated, { inbox: true })), [
    ['send-existing', 'Enviar link na conversa'],
    ['copy-message', 'Copiar mensagem'],
    ['cancel-link', 'Cancelar link'],
  ]);
  // Never below R$ 1,00 free, in conferência, cancelled or for another seller.
  /** @param {any} v */
  const offers = (v) =>
    [v.next.primary, ...v.next.secondary].some(
      (a) => a?.act === 'send-another',
    );
  const full = billing({
    condition: { percent: 100 },
    links: [link({ origin: 'generated', kind: 'full', amountCents: 479950 })],
  });
  eq(derive(full).figures.free, 50);
  eq(offers(derive(full)), false);
  eq(
    offers(
      derive({
        ...generated,
        review: { reason: 'late_payment', heldCents: 0 },
      }),
    ),
    false,
  );
  eq(offers(derive(generated, { cancelled: true })), false);
  eq(offers(derive({ ...generated, canOperate: false })), false);
});
