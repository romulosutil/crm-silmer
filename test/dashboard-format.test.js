import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantIndicator,
  dueSoonIndicator,
  elapsedLabel,
  longDay,
  mineIndicator,
  myOrdersIndicator,
  overdueIndicator,
  pendingIndicator,
  replyIndicator,
  shortDay,
  soldIndicator,
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
