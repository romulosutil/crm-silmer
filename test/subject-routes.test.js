import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';

const headers = {
  cookie: 'crm_session=synthetic; crm_csrf=synthetic',
  origin: 'https://crm.example.test',
  'x-csrf-token': 'synthetic',
  'idempotency-key': 'subject-command-1',
};

test('subject routes authorize reads and writes and keep explicit order and message targets', async (t) => {
  /** @type {Array<any[]>} */
  const calls = [];
  const actor = { id: 'seller-1', kind: 'human', functionName: 'Vendedor' };
  const subjects = {
    async authorizeRead(/** @type {any} */ input) {
      calls.push(['read-auth', input]);
      return { actor };
    },
    async authorizeWrite(/** @type {any} */ input) {
      calls.push(['write-auth', input]);
      return { actor };
    },
    async list(/** @type {any} */ id, /** @type {any} */ orderQuery) {
      calls.push(['list', id, orderQuery]);
      return {
        currentSubjectId: null,
        subjects: [],
        orders: [],
        links: [],
        ordersHasMore: false,
      };
    },
    async create(/** @type {any} */ input) {
      calls.push(['create', input]);
      return { subject: { id: 'subject-1' } };
    },
    async select(/** @type {any} */ input) {
      calls.push(['select', input]);
      return { currentSubjectId: input.subjectId };
    },
    async tagMessage(/** @type {any} */ input) {
      calls.push(['tag', input]);
      return { messageId: input.messageId, subjectIds: input.subjectIds };
    },
  };
  const api = createApi({}, { subjects });
  t.after(() => api.close());
  const base = '/api/v1/inbox/conversations/conversation-1';
  const read = await api.inject({
    headers,
    method: 'GET',
    url: `${base}/subjects?order=12-CRM`,
  });
  assert.equal(read.statusCode, 200);
  assert.equal(calls[0][1].action, 'conversation.read');
  assert.deepEqual(calls[1], ['list', 'conversation-1', '12-CRM']);

  const created = await api.inject({
    headers,
    method: 'POST',
    url: `${base}/subjects`,
    payload: { orderId: 'order-1' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(calls[2][1].action, 'conversation.subject.manage');
  assert.equal(calls[3][1].orderId, 'order-1');
  assert.equal(calls[3][1].actor.id, actor.id);

  const selected = await api.inject({
    headers,
    method: 'POST',
    url: `${base}/subjects/subject-1/select`,
    payload: {},
  });
  assert.equal(selected.statusCode, 200);
  assert.equal(calls[5][1].subjectId, 'subject-1');

  const tagged = await api.inject({
    headers,
    method: 'PUT',
    url: `${base}/messages/message-1/subjects`,
    payload: { subjectIds: ['subject-1', 'subject-2'] },
  });
  assert.equal(tagged.statusCode, 200);
  assert.deepEqual(calls[7][1].subjectIds, ['subject-1', 'subject-2']);
  const invalid = await api.inject({
    headers,
    method: 'PUT',
    url: `${base}/messages/message-1/subjects`,
    payload: { subjectIds: 'subject-1' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 8);
});
