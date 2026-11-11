import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyUnreadState,
  INBOX_UNREAD_LIMIT,
  isConversationUnread,
  markConversationRead,
  observeConversations,
  parseUnreadState,
  serializeUnreadState,
  unreadCount,
  unreadNoticeText,
  unreadTitle,
} from '../apps/edge-web/src/lib/inbox-unread.js';

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-01-01T10:05:00.000Z';
const T_BEFORE = '2026-01-01T09:00:00.000Z';
const T_AFTER = '2026-01-01T10:02:00.000Z';

/**
 * Observa com um relógio fixo, para o teste mandar no tempo.
 * @param {any} state
 * @param {any} list
 * @param {{openId?: string|null, now?: string}} [options]
 */
function observe(state, list, options = {}) {
  return observeConversations(state, list, { now: T0, ...options });
}

/**
 * @param {string} id @param {string} messageId
 * @param {{bucket?: string, occurredAt?: string}} [extra]
 */
function inbound(id, messageId, extra = {}) {
  const { bucket, occurredAt } = extra;
  return {
    id,
    ...(bucket ? { bucket } : {}),
    lastMessage: {
      direction: /** @type {const} */ ('inbound'),
      id: messageId,
      ...(occurredAt ? { occurredAt } : {}),
    },
  };
}

/**
 * @param {string} id @param {string} messageId
 */
function outbound(id, messageId) {
  return {
    id,
    lastMessage: {
      direction: /** @type {const} */ ('outbound'),
      id: messageId,
    },
  };
}

test('a primeira carga não marca nenhuma conversa', () => {
  const { arrived, state } = observe(emptyUnreadState(), [
    inbound('c1', 'm1'),
    inbound('c2', 'm2'),
  ]);
  assert.deepEqual(state, {
    seen: { c1: 'm1', c2: 'm2' },
    unread: {},
    since: T0,
  });
  assert.deepEqual(arrived, []);
  assert.equal(unreadCount(state), 0);
});

test('mensagem nova do cliente marca a conversa e entra em arrived', () => {
  const first = observe(emptyUnreadState(), [
    inbound('c1', 'm1'),
    inbound('c2', 'm2'),
  ]).state;
  const { arrived, state } = observe(first, [
    inbound('c1', 'm3'),
    inbound('c2', 'm2'),
  ]);
  assert.deepEqual(state, {
    seen: { c1: 'm3', c2: 'm2' },
    unread: { c1: 'm3' },
    since: T0,
  });
  assert.deepEqual(arrived, ['c1']);
  assert.equal(isConversationUnread(state, 'c1'), true);
  assert.equal(isConversationUnread(state, 'c2'), false);
});

test('a mesma mensagem observada de novo não entra em arrived outra vez', () => {
  const first = observe(emptyUnreadState(), [inbound('c1', 'm1')]);
  const marked = observe(first.state, [inbound('c1', 'm2')]);
  assert.deepEqual(marked.arrived, ['c1']);

  const again = observe(marked.state, [inbound('c1', 'm2')]);
  assert.deepEqual(again.arrived, []);
  assert.deepEqual(again.state.unread, { c1: 'm2' });

  // Uma mensagem ainda mais nova numa conversa já marcada também não avisa de novo.
  const newer = observe(again.state, [inbound('c1', 'm3')]);
  assert.deepEqual(newer.arrived, []);
  assert.deepEqual(newer.state.unread, { c1: 'm3' });
});

test('a conversa aberta não fica marcada e perde a marca antiga', () => {
  const start = observe(emptyUnreadState(), [inbound('c1', 'm1')]).state;

  const opened = observe(start, [inbound('c1', 'm2')], {
    openId: 'c1',
  });
  assert.deepEqual(opened.state, { seen: { c1: 'm2' }, unread: {}, since: T0 });
  assert.deepEqual(opened.arrived, []);

  const marked = observe(start, [inbound('c1', 'm2')]).state;
  assert.deepEqual(marked.unread, { c1: 'm2' });
  const cleared = observe(marked, [inbound('c1', 'm3')], {
    openId: 'c1',
  });
  assert.deepEqual(cleared.state.unread, {});
  assert.deepEqual(cleared.state.seen, { c1: 'm3' });
});

test('resposta outbound remove a marca e grava seen', () => {
  const start = observe(emptyUnreadState(), [inbound('c1', 'm1')]).state;
  const marked = observe(start, [inbound('c1', 'm2')]).state;
  const answered = observe(marked, [outbound('c1', 'm3')]).state;
  assert.deepEqual(answered.unread, {});
  assert.deepEqual(answered.seen, { c1: 'm3' });
});

test('markConversationRead remove a marca e é idempotente', () => {
  const marked = { seen: { c1: 'm2' }, unread: { c1: 'm2' }, since: T0 };
  const conversation = inbound('c1', 'm2');

  const read = markConversationRead(marked, conversation);
  assert.deepEqual(read, { seen: { c1: 'm2' }, unread: {}, since: T0 });
  assert.equal(markConversationRead(read, conversation), read);
  assert.deepEqual(marked.unread, { c1: 'm2' }, 'o estado de entrada não muda');

  // Uma conversa ainda não conhecida passa a ter a última mensagem registrada.
  const unseen = markConversationRead(emptyUnreadState(), inbound('c9', 'm5'));
  assert.deepEqual(unseen, { seen: { c9: 'm5' }, unread: {}, since: null });
});

test('o mesmo objeto de estado é devolvido quando nada muda', () => {
  const state = observe(emptyUnreadState(), [inbound('c1', 'm1')]).state;
  assert.equal(observe(state, [inbound('c1', 'm1')]).state, state);
  // Uma resposta nossa numa conversa nova só entra em seen.
  assert.deepEqual(observe(state, [outbound('c2', 'x')]).state.seen, {
    c1: 'm1',
    c2: 'x',
  });
  assert.equal(
    observe(state, [inbound('c1', 'm1')], { openId: 'c1' }).state,
    state,
  );
  assert.equal(observe(state, null).state, state);
  assert.equal(
    markConversationRead(state, { id: 'zz', lastMessage: null }),
    state,
  );
});

test('entradas inválidas da lista são ignoradas', () => {
  const state = emptyUnreadState();
  const junk = [
    null,
    undefined,
    'c1',
    7,
    {},
    { id: '' },
    { id: 5, lastMessage: { direction: 'inbound', id: 'm1' } },
    { id: 'c2' },
    { id: 'c3', lastMessage: null },
    { id: 'c4', lastMessage: { direction: 'inbound' } },
    { id: 'c5', lastMessage: { direction: 'inbound', id: 42 } },
    { id: '__proto__', lastMessage: { direction: 'inbound', id: 'm1' } },
  ];
  const result = observe(state, junk);
  assert.deepEqual(result.state, { seen: {}, unread: {}, since: T0 });
  assert.deepEqual(result.arrived, []);
  assert.deepEqual(observe(state, 'lista').state.seen, {});
  assert.deepEqual(observe(state, undefined).state.seen, {});
});

test('o limite de 500 descarta as mais antigas e preserva os não lidos', () => {
  const five = Array.from({ length: 5 }, (_, i) => `c${i}`);
  let state = observe(
    emptyUnreadState(),
    five.map((id) => inbound(id, 'a')),
  ).state;
  state = observe(
    state,
    five.map((id) => inbound(id, 'b')),
  ).state;
  assert.equal(unreadCount(state), 5);

  const crowd = Array.from({ length: INBOX_UNREAD_LIMIT + 100 }, (_, i) =>
    inbound(`n${i}`, 'x'),
  );
  state = observe(state, crowd).state;
  assert.equal(Object.keys(state.seen).length, INBOX_UNREAD_LIMIT);
  assert.equal(unreadCount(state), 5);
  for (const id of five) assert.equal(isConversationUnread(state, id), true);
  assert.equal(state.seen.n0, undefined, 'a mais antiga lida sai');
  assert.equal(state.seen.n599, 'x');
});

test('unreadTitle põe a contagem no título e ignora valores inválidos', () => {
  assert.equal(unreadTitle('Responder', 0), 'Responder');
  assert.equal(unreadTitle('Responder', 1), '(1) Responder');
  assert.equal(unreadTitle('Responder', 2), '(2) Responder');
  assert.equal(unreadTitle('Responder', 99), '(99) Responder');
  assert.equal(unreadTitle('Responder', 100), '(99+) Responder');
  for (const bad of [-1, 1.5, Number.NaN, '2', null, undefined]) {
    assert.equal(unreadTitle('Responder', bad), 'Responder');
  }
});

test('unreadNoticeText para 0 é vazio', () => {
  assert.equal(unreadNoticeText(0), '');
});

test('unreadNoticeText para 1 usa o singular', () => {
  assert.equal(
    unreadNoticeText(1),
    '1 conversa com mensagem nova em Responder',
  );
});

test('unreadNoticeText para 2 usa o plural', () => {
  assert.equal(
    unreadNoticeText(2),
    '2 conversas com mensagem nova em Responder',
  );
});

test('unreadNoticeText para 100 usa o plural com o número inteiro', () => {
  assert.equal(
    unreadNoticeText(100),
    '100 conversas com mensagem nova em Responder',
  );
});

test('serialize e parse fazem ida e volta', () => {
  const state = {
    seen: { c1: 'm2', c2: 'm9' },
    unread: { c1: 'm2' },
    since: T0,
  };
  const text = serializeUnreadState(state);
  assert.equal(
    text,
    `{"v":1,"seen":{"c1":"m2","c2":"m9"},"unread":{"c1":"m2"},"since":"${T0}"}`,
  );
  assert.deepEqual(parseUnreadState(text), state);
});

test('parse com lixo nunca lança e devolve o estado vazio', () => {
  const garbage = [
    null,
    undefined,
    '',
    '{',
    'null',
    '"x"',
    '[]',
    '[1]',
    '{"v":2}',
    '{"v":"1"}',
    '{"v":1}',
    '{"v":1,"seen":[],"unread":"x"}',
  ];
  for (const text of garbage) {
    assert.doesNotThrow(() => parseUnreadState(text));
    assert.deepEqual(parseUnreadState(text), emptyUnreadState(), String(text));
  }
});

test('parse não aceita chave __proto__ nem polui Object.prototype', () => {
  const named = parseUnreadState(
    '{"v":1,"seen":{"__proto__":"x"},"unread":{}}',
  );
  assert.deepEqual(named, emptyUnreadState());
  assert.equal(
    /** @type {Record<string, unknown>} */ (Object.prototype).x,
    undefined,
  );

  const hostile = parseUnreadState(
    '{"v":1,"seen":{"__proto__":{"polluted":"yes"}},"unread":{"__proto__":"x"}}',
  );
  assert.deepEqual(hostile, emptyUnreadState());
  assert.equal(
    /** @type {Record<string, unknown>} */ (Object.prototype).polluted,
    undefined,
  );
  assert.equal(/** @type {Record<string, unknown>} */ ({}).polluted, undefined);
});

test('parse descarta só as entradas inválidas e completa seen de unread', () => {
  const parsed = parseUnreadState(
    '{"v":1,"seen":{"a":"m1","b":3,"c":""},"unread":{"a":"m2","z":"m9"}}',
  );
  assert.deepEqual(parsed, {
    seen: { a: 'm1', z: 'm9' },
    unread: { a: 'm2', z: 'm9' },
    since: null,
  });
});

test('o cliente responde depois de uma resposta nossa: marca', () => {
  const state = observe(emptyUnreadState(), [outbound('c1', 'm1')]).state;
  assert.deepEqual(state.seen, { c1: 'm1' });
  const result = observe(state, [inbound('c1', 'm2')], { now: T1 });
  assert.deepEqual(result.arrived, ['c1']);
  assert.deepEqual(result.state.unread, { c1: 'm2' });
  assert.equal(result.state.since, T1);
});

test('conversa desconhecida: marca só com mensagem posterior ao since', () => {
  const base = observe(emptyUnreadState(), [inbound('c0', 'm0')]).state;
  const later = observe(base, [inbound('c1', 'm1', { occurredAt: T_AFTER })], {
    now: T1,
  });
  assert.deepEqual(later.arrived, ['c1']);
  assert.deepEqual(later.state.unread, { c1: 'm1' });

  const earlier = observe(
    base,
    [inbound('c2', 'm1', { occurredAt: T_BEFORE })],
    { now: T1 },
  );
  assert.deepEqual(earlier.arrived, []);
  assert.equal(earlier.state.seen.c2, 'm1');
  assert.deepEqual(earlier.state.unread, {});

  for (const occurredAt of [undefined, 'ontem']) {
    const item = inbound('c3', 'm1', occurredAt ? { occurredAt } : {});
    const result = observe(base, [item], { now: T1 });
    assert.deepEqual(result.arrived, [], String(occurredAt));
    assert.deepEqual(result.state.unread, {});
    assert.equal(result.state.seen.c3, 'm1');
  }
});

test('a primeira observação (since nulo) nunca marca, mesmo com data', () => {
  const result = observe(
    emptyUnreadState(),
    [inbound('c1', 'm1', { occurredAt: T1 })],
    { now: T0 },
  );
  assert.deepEqual(result.arrived, []);
  assert.deepEqual(result.state.unread, {});
  assert.equal(result.state.since, T0);
});

test('conversa fora de Responder nunca é marcada, mas seen é atualizado', () => {
  const base = observe(emptyUnreadState(), [inbound('c1', 'm1')]).state;
  const result = observe(base, [inbound('c1', 'm2', { bucket: 'awaiting' })]);
  assert.deepEqual(result.arrived, []);
  assert.deepEqual(result.state.unread, {});
  assert.deepEqual(result.state.seen, { c1: 'm2' });
  const respond = observe(base, [inbound('c1', 'm2', { bucket: 'respond' })]);
  assert.deepEqual(respond.arrived, ['c1']);
});

test('since só avança quando muda mais de 1 s', () => {
  const base = observe(emptyUnreadState(), [inbound('c1', 'm1')]).state;
  const near = observe(base, [inbound('c1', 'm1')], {
    now: '2026-01-01T10:00:00.500Z',
  });
  assert.equal(near.state, base);
  const far = observe(base, [inbound('c1', 'm1')], { now: T1 });
  assert.equal(far.state.since, T1);
});

test('ida e volta com since, e estado antigo sem since', () => {
  const state = { seen: { c1: 'm1' }, unread: {}, since: T0 };
  assert.deepEqual(parseUnreadState(serializeUnreadState(state)), state);
  const old = parseUnreadState('{"v":1,"seen":{"c1":"m1"},"unread":{}}');
  assert.deepEqual(old, { seen: { c1: 'm1' }, unread: {}, since: null });
  assert.equal(
    parseUnreadState('{"v":1,"seen":{},"unread":{},"since":"lixo"}').since,
    null,
  );
});
