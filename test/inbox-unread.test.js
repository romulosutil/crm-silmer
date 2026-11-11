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

/**
 * @param {string} id @param {string} messageId
 */
function inbound(id, messageId) {
  return {
    id,
    lastMessage: { direction: /** @type {const} */ ('inbound'), id: messageId },
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
  const { arrived, state } = observeConversations(emptyUnreadState(), [
    inbound('c1', 'm1'),
    inbound('c2', 'm2'),
  ]);
  assert.deepEqual(state, { seen: { c1: 'm1', c2: 'm2' }, unread: {} });
  assert.deepEqual(arrived, []);
  assert.equal(unreadCount(state), 0);
});

test('mensagem nova do cliente marca a conversa e entra em arrived', () => {
  const first = observeConversations(emptyUnreadState(), [
    inbound('c1', 'm1'),
    inbound('c2', 'm2'),
  ]).state;
  const { arrived, state } = observeConversations(first, [
    inbound('c1', 'm3'),
    inbound('c2', 'm2'),
  ]);
  assert.deepEqual(state, {
    seen: { c1: 'm3', c2: 'm2' },
    unread: { c1: 'm3' },
  });
  assert.deepEqual(arrived, ['c1']);
  assert.equal(isConversationUnread(state, 'c1'), true);
  assert.equal(isConversationUnread(state, 'c2'), false);
});

test('a mesma mensagem observada de novo não entra em arrived outra vez', () => {
  const first = observeConversations(emptyUnreadState(), [inbound('c1', 'm1')]);
  const marked = observeConversations(first.state, [inbound('c1', 'm2')]);
  assert.deepEqual(marked.arrived, ['c1']);

  const again = observeConversations(marked.state, [inbound('c1', 'm2')]);
  assert.deepEqual(again.arrived, []);
  assert.deepEqual(again.state.unread, { c1: 'm2' });

  // Uma mensagem ainda mais nova numa conversa já marcada também não avisa de novo.
  const newer = observeConversations(again.state, [inbound('c1', 'm3')]);
  assert.deepEqual(newer.arrived, []);
  assert.deepEqual(newer.state.unread, { c1: 'm3' });
});

test('a conversa aberta não fica marcada e perde a marca antiga', () => {
  const start = observeConversations(emptyUnreadState(), [
    inbound('c1', 'm1'),
  ]).state;

  const opened = observeConversations(start, [inbound('c1', 'm2')], {
    openId: 'c1',
  });
  assert.deepEqual(opened.state, { seen: { c1: 'm2' }, unread: {} });
  assert.deepEqual(opened.arrived, []);

  const marked = observeConversations(start, [inbound('c1', 'm2')]).state;
  assert.deepEqual(marked.unread, { c1: 'm2' });
  const cleared = observeConversations(marked, [inbound('c1', 'm3')], {
    openId: 'c1',
  });
  assert.deepEqual(cleared.state.unread, {});
  assert.deepEqual(cleared.state.seen, { c1: 'm3' });
});

test('resposta outbound remove a marca e não mexe em seen', () => {
  const start = observeConversations(emptyUnreadState(), [
    inbound('c1', 'm1'),
  ]).state;
  const marked = observeConversations(start, [inbound('c1', 'm2')]).state;
  const answered = observeConversations(marked, [outbound('c1', 'm3')]).state;
  assert.deepEqual(answered.unread, {});
  assert.deepEqual(answered.seen, { c1: 'm2' });
});

test('markConversationRead remove a marca e é idempotente', () => {
  const marked = { seen: { c1: 'm2' }, unread: { c1: 'm2' } };
  const conversation = inbound('c1', 'm2');

  const read = markConversationRead(marked, conversation);
  assert.deepEqual(read, { seen: { c1: 'm2' }, unread: {} });
  assert.equal(markConversationRead(read, conversation), read);
  assert.deepEqual(marked.unread, { c1: 'm2' }, 'o estado de entrada não muda');

  // Uma conversa ainda não conhecida passa a ter a última mensagem registrada.
  const unseen = markConversationRead(emptyUnreadState(), inbound('c9', 'm5'));
  assert.deepEqual(unseen, { seen: { c9: 'm5' }, unread: {} });
});

test('o mesmo objeto de estado é devolvido quando nada muda', () => {
  const state = observeConversations(emptyUnreadState(), [
    inbound('c1', 'm1'),
  ]).state;
  assert.equal(observeConversations(state, [inbound('c1', 'm1')]).state, state);
  assert.equal(observeConversations(state, [outbound('c2', 'x')]).state, state);
  assert.equal(
    observeConversations(state, [inbound('c1', 'm1')], { openId: 'c1' }).state,
    state,
  );
  assert.equal(observeConversations(state, null).state, state);
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
  const result = observeConversations(state, junk);
  assert.equal(result.state, state);
  assert.deepEqual(result.arrived, []);
  assert.equal(observeConversations(state, 'lista').state, state);
  assert.equal(observeConversations(state, undefined).state, state);
});

test('o limite de 500 descarta as mais antigas e preserva os não lidos', () => {
  const five = Array.from({ length: 5 }, (_, i) => `c${i}`);
  let state = observeConversations(
    emptyUnreadState(),
    five.map((id) => inbound(id, 'a')),
  ).state;
  state = observeConversations(
    state,
    five.map((id) => inbound(id, 'b')),
  ).state;
  assert.equal(unreadCount(state), 5);

  const crowd = Array.from({ length: INBOX_UNREAD_LIMIT + 100 }, (_, i) =>
    inbound(`n${i}`, 'x'),
  );
  state = observeConversations(state, crowd).state;
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
  const state = { seen: { c1: 'm2', c2: 'm9' }, unread: { c1: 'm2' } };
  const text = serializeUnreadState(state);
  assert.equal(
    text,
    '{"v":1,"seen":{"c1":"m2","c2":"m9"},"unread":{"c1":"m2"}}',
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
  });
});
