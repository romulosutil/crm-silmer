import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantIndicator,
  dueSoonIndicator,
  elapsedLabel,
  longDay,
  mineIndicator,
  myOrdersIndicator,
  nextStep,
  overdueIndicator,
  pendingIndicator,
  replyIndicator,
  shortDay,
  soldIndicator,
  unavailableIndicator,
  waitingIndicator,
} from '../apps/edge-web/src/lib/dashboard-format.js';

const NOW = '2026-10-15T15:00:00.000Z';

test('Painel: elapsed time is read between two server instants', () => {
  assert.equal(elapsedLabel('2026-10-15T14:59:30.000Z', NOW), 'agora');
  assert.equal(elapsedLabel('2026-10-15T14:35:00.000Z', NOW), 'há 25 min');
  assert.equal(elapsedLabel('2026-10-15T12:00:00.000Z', NOW), 'há 3 h');
  assert.equal(elapsedLabel('2026-10-14T14:00:00.000Z', NOW), 'há 1 dia');
  assert.equal(elapsedLabel('2026-10-12T15:00:00.000Z', NOW), 'há 3 dias');
  // A future instant (clock skew) never reads as negative.
  assert.equal(elapsedLabel('2026-10-15T15:05:00.000Z', NOW), 'agora');
  assert.equal(elapsedLabel(null, NOW), '');
  assert.equal(elapsedLabel('x', NOW), '');
});

test('Painel: days read as the operation writes them', () => {
  assert.equal(shortDay('2026-10-09'), '09/10');
  assert.equal(shortDay(null), '');
  assert.equal(longDay('2026-10-15'), 'Quinta-feira, 15 de outubro');
  assert.equal(longDay('15/10/2026'), '');
});

test('Painel: my queue says who waits for my answer', () => {
  assert.deepEqual(mineIndicator(undefined, NOW), {
    badge: '',
    detail: 'Nenhuma conversa com você agora',
    tone: null,
    value: '0',
  });
  assert.equal(
    mineIndicator({ awaitingReplyCount: 0, count: 2 }, NOW).detail,
    'Nenhum cliente esperando sua resposta',
  );
  const waiting = mineIndicator(
    {
      awaitingReplyCount: 2,
      count: 3,
      oldestAwaitingSince: '2026-10-15T14:20:00.000Z',
    },
    NOW,
  );
  assert.equal(waiting.value, '3');
  assert.equal(waiting.tone, 'warning');
  assert.equal(
    waiting.detail,
    '2 clientes esperam sua resposta; o primeiro escreveu há 40 min',
  );
});

test('Painel: the seller home says what to answer now and their own orders', () => {
  assert.deepEqual(
    replyIndicator(
      {
        awaitingReplyCount: 2,
        count: 3,
        oldestAwaitingSince: '2026-10-15T14:35:00.000Z',
      },
      NOW,
    ),
    {
      badge: '',
      detail: 'O primeiro cliente escreveu há 25 min',
      tone: 'warning',
      value: '2',
    },
  );
  assert.equal(
    replyIndicator({ awaitingReplyCount: 0, count: 3 }, NOW).detail,
    'Ninguém esperando; 3 conversas suas em andamento',
  );
  assert.equal(replyIndicator(undefined, NOW).value, '0');
  assert.equal(myOrdersIndicator(2).value, '2');
  assert.equal(
    myOrdersIndicator(undefined).detail,
    'Nenhum pedido seu esperando confirmação',
  );
});

test('Painel: handoffs past the server SLA are an error with a text badge', () => {
  assert.equal(waitingIndicator({ count: 0 }, NOW).tone, null);
  const onTime = waitingIndicator(
    { count: 1, oldestSince: '2026-10-15T14:50:00.000Z', overdueCount: 0 },
    NOW,
  );
  assert.equal(onTime.tone, 'warning');
  assert.equal(onTime.badge, '');
  assert.equal(onTime.detail, 'A mais antiga está parada há 10 min');
  const late = waitingIndicator(
    { count: 3, oldestSince: '2026-10-15T09:00:00.000Z', overdueCount: 2 },
    NOW,
  );
  assert.equal(late.tone, 'error');
  assert.equal(late.badge, '2 fora do prazo');
  assert.equal(late.detail, 'A mais antiga está parada há 6 h');
});

test('Painel: the assistant reports trouble before activity', () => {
  assert.deepEqual(
    assistantIndicator(
      {
        activeCount: 4,
        failedDeliveryCount: 1,
        lastReplyAt: '2026-10-15T14:58:00.000Z',
        stallMinutes: 10,
        stalledCount: 2,
      },
      NOW,
    ),
    {
      badge: 'Atenção',
      detail: '2 sem resposta há 10 min ou mais; 1 com envio falho em 24 h',
      tone: 'warning',
      value: 'Pede atenção',
    },
  );
  const healthy = assistantIndicator(
    { activeCount: 1, lastReplyAt: '2026-10-15T14:57:00.000Z' },
    NOW,
  );
  assert.equal(healthy.value, 'Respondendo');
  assert.equal(healthy.tone, 'success');
  assert.equal(
    healthy.detail,
    '1 conversa com o assistente; última resposta há 3 min',
  );
  assert.equal(
    assistantIndicator({ lastReplyAt: '2026-10-15T13:00:00.000Z' }, NOW).detail,
    'Última resposta há 2 h',
  );
  assert.deepEqual(assistantIndicator(undefined, NOW), {
    badge: '',
    detail: 'Nenhuma resposta nas últimas 24 h',
    tone: null,
    value: 'Sem conversas agora',
  });
});

test('Painel: sales, pending orders and deliveries tolerate a missing field', () => {
  const sold = soldIndicator({ confirmedCount: 2, soldAmountCents: 250000 });
  assert.equal(sold.value.replace(/\s/gu, ' '), 'R$ 2.500,00');
  assert.match(sold.detail, /^2 pedidos confirmados; ticket médio R\$/u);
  assert.equal(
    soldIndicator(undefined).detail,
    'Nenhum pedido confirmado no período',
  );
  assert.equal(pendingIndicator(1).value, '1');
  assert.equal(pendingIndicator(undefined).value, '0');
  assert.deepEqual(
    overdueIndicator({ oldestOverdueOn: '2026-10-09', overdueCount: 2 }),
    {
      badge: '',
      detail: 'A mais antiga era para 09/10',
      tone: 'error',
      value: '2',
    },
  );
  assert.equal(overdueIndicator(undefined).tone, null);
  assert.equal(
    dueSoonIndicator({ dueSoonCount: 3, dueSoonUntil: '2026-10-21' }).detail,
    'Prometidas de hoje até 21/10',
  );
});

// PNL-01 e PNL-03 (RFC 024, proposta D): one next step per role, first rule
// with something pending wins; the queue rules are skipped while it fails.
const CALM_QUEUE = Object.freeze({
  assistant: { activeCount: 2, failedDeliveryCount: 0, stalledCount: 0 },
  mine: { awaitingReplyCount: 0, count: 1, pendingOrderCount: 0 },
  waitingHandoff: { count: 0, overdueCount: 0 },
});
const CALM_SUMMARY = Object.freeze({
  deliveries: { overdueCount: 0 },
  pendingCount: 0,
});

/**
 * @param {Record<string, any>} base
 * @param {Record<string, any>} changes
 */
function withChanges(base, changes) {
  /** @type {Record<string, any>} */
  const copy = structuredClone(base);
  for (const [group, values] of Object.entries(changes)) {
    copy[group] =
      values && typeof values === 'object'
        ? { ...copy[group], ...values }
        : values;
  }
  return copy;
}

/**
 * @param {boolean} isManager
 * @param {{queue?: Record<string, any>, summary?: Record<string, any>, queueError?: string}} [changes]
 */
function stepFor(
  isManager,
  { queue = {}, summary = {}, queueError = '' } = {},
) {
  return nextStep({
    isManager,
    queue: withChanges(CALM_QUEUE, queue),
    queueError,
    summary: withChanges(CALM_SUMMARY, summary),
  });
}

test('Painel: the seller next step follows the priority of the queue', () => {
  const all = {
    queue: {
      mine: { awaitingReplyCount: 3, pendingOrderCount: 2 },
      waitingHandoff: { count: 4 },
    },
    summary: { deliveries: { overdueCount: 2 } },
  };
  assert.deepEqual(stepFor(false, all), {
    key: 'reply',
    label: 'Responder 3 conversas',
    to: { path: '/inbox', query: { fila: 'minhas' } },
  });
  assert.equal(
    stepFor(false, { queue: { mine: { awaitingReplyCount: 1 } } }).label,
    'Responder 1 conversa',
  );

  const takeOver = stepFor(false, {
    queue: { mine: { pendingOrderCount: 2 }, waitingHandoff: { count: 4 } },
    summary: { deliveries: { overdueCount: 2 } },
  });
  assert.equal(takeOver.label, 'Assumir 4 conversas em espera');
  assert.deepEqual(takeOver.to, {
    path: '/inbox',
    query: { situacao: 'aguardando' },
  });

  const myPending = stepFor(false, {
    queue: { mine: { pendingOrderCount: 1 } },
    summary: { deliveries: { overdueCount: 2 } },
  });
  assert.equal(myPending.label, 'Completar 1 pedido pendente');
  assert.deepEqual(myPending.to, {
    path: '/pedidos',
    query: { status: 'pendente', vendedor: 'eu' },
  });

  const late = stepFor(false, { summary: { deliveries: { overdueCount: 2 } } });
  assert.equal(late.label, 'Conferir 2 entregas atrasadas');
  assert.deepEqual(late.to, {
    path: '/pedidos',
    query: { entrega: 'atrasada' },
  });

  // Store orders have their own notice; the manager's pending orders and the
  // assistant are not the seller's next step.
  assert.deepEqual(
    stepFor(false, {
      queue: { assistant: { stalledCount: 3 } },
      summary: { pendingCount: 5, storeNewCount: 2 },
    }),
    { key: 'calm', label: 'Nada urgente agora.', to: null },
  );
});

test('Painel: the manager next step starts from the SLA', () => {
  const all = {
    queue: {
      assistant: { failedDeliveryCount: 1, stalledCount: 1 },
      mine: { awaitingReplyCount: 5 },
      waitingHandoff: { count: 3, overdueCount: 2 },
    },
    summary: { deliveries: { overdueCount: 1 }, pendingCount: 6 },
  };
  assert.deepEqual(stepFor(true, all), {
    key: 'out-of-sla',
    label: 'Atender 2 conversas fora do prazo',
    to: { path: '/inbox', query: { situacao: 'aguardando' } },
  });

  const late = stepFor(true, {
    queue: { assistant: { stalledCount: 1 }, waitingHandoff: { count: 3 } },
    summary: { deliveries: { overdueCount: 1 }, pendingCount: 6 },
  });
  assert.equal(late.label, 'Conferir 1 entrega atrasada');

  for (const assistant of [{ stalledCount: 1 }, { failedDeliveryCount: 2 }]) {
    const step = stepFor(true, {
      queue: { assistant },
      summary: { pendingCount: 6 },
    });
    assert.equal(step.label, 'Verificar as conversas do assistente');
    assert.deepEqual(step.to, {
      path: '/inbox',
      query: { situacao: 'agente' },
    });
  }

  const pending = stepFor(true, { summary: { pendingCount: 6 } });
  assert.equal(pending.label, 'Confirmar 6 pedidos pendentes');
  assert.deepEqual(pending.to, {
    path: '/pedidos',
    query: { status: 'pendente' },
  });

  // Waiting within the SLA and the manager's own conversations are not it.
  assert.equal(
    stepFor(true, {
      queue: {
        mine: { awaitingReplyCount: 4 },
        waitingHandoff: { count: 2 },
      },
    }).label,
    'Nada urgente agora.',
  );
});

test('Painel: with the queue failing, the next step invents nothing', () => {
  const busyQueue = {
    assistant: { stalledCount: 2 },
    mine: { awaitingReplyCount: 3, pendingOrderCount: 2 },
    waitingHandoff: { count: 4, overdueCount: 2 },
  };
  const queueError = 'Não foi possível consultar a fila agora.';
  // Stale numbers of an earlier read are skipped as well.
  assert.equal(
    stepFor(false, {
      queue: busyQueue,
      queueError,
      summary: { deliveries: { overdueCount: 2 } },
    }).label,
    'Conferir 2 entregas atrasadas',
  );
  assert.equal(
    stepFor(true, {
      queue: busyQueue,
      queueError,
      summary: { pendingCount: 3 },
    }).label,
    'Confirmar 3 pedidos pendentes',
  );
  for (const isManager of [false, true]) {
    assert.deepEqual(stepFor(isManager, { queue: busyQueue, queueError }), {
      key: 'queue-unavailable',
      label: 'A fila não respondeu; tente de novo mais abaixo.',
      to: null,
    });
    assert.equal(
      nextStep({ isManager, queue: null, queueError: '', summary: {} }).key,
      'queue-unavailable',
    );
  }
  assert.deepEqual(unavailableIndicator(), {
    badge: '',
    detail: 'Sem dados da fila agora',
    tone: null,
    value: '—',
  });
});

test('Painel: no next step link is named like an indicator', () => {
  const steps = [false, true].flatMap((isManager) =>
    [
      { queue: { mine: { awaitingReplyCount: 2 } } },
      { queue: { waitingHandoff: { count: 2, overdueCount: 1 } } },
      { queue: { mine: { pendingOrderCount: 2 } } },
      { queue: { assistant: { stalledCount: 1 } } },
      { summary: { deliveries: { overdueCount: 2 }, pendingCount: 2 } },
      { summary: { pendingCount: 2 } },
    ].map((changes) => stepFor(isManager, changes)),
  );
  for (const step of steps) {
    assert.doesNotMatch(
      step.label,
      /^(Vendido|Minhas conversas|Responder agora|Esperando vendedor|Assistente|Entregas atrasadas|Meus pedidos pendentes|Pedidos a confirmar)/u,
    );
  }
});
