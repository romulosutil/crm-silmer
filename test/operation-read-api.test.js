import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

function harness(overrides = {}) {
  const calls = /** @type {Array<[string, any]>} */ ([]);
  const operations = {
    async authorizeRead(/** @type {any} */ input) {
      calls.push(['authorize', input]);
      return { actor: { functionName: 'Atendimento', id: 'operator-1' } };
    },
    async getContact(/** @type {any} */ input) {
      calls.push(['contact', input]);
      return { contact: { id: input.contactId } };
    },
    async getConversation(/** @type {any} */ input) {
      calls.push(['conversation', input]);
      return { conversation: { id: input.conversationId } };
    },
    async listContacts(/** @type {any} */ input) {
      calls.push(['contacts', input]);
      return { items: [], nextCursor: null, totalCount: 0 };
    },
    async listInbox(/** @type {any} */ input) {
      calls.push(['inbox', input]);
      return { items: [], nextCursor: null, totalCount: 0 };
    },
    ...overrides,
  };
  const api = createApi(
    {},
    {
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
      operations,
    },
  );
  const headers = {
    cookie: 'crm_session=session',
    origin: 'https://crm.example.test',
  };
  return { api, calls, headers };
}

test('publishes authorized Inbox list and detail read models', async () => {
  const { api, calls, headers } = harness();
  const list = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/inbox/conversations?state=requer_atencao&channel=whatsapp&automationState=human&assignedUserId=operator-1&limit=25&cursor=signed',
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['cache-control'], 'private, no-cache');
  assert.equal(list.headers.vary, 'Origin, Cookie');
  assert.deepEqual(calls[0][0], 'authorize');
  assert.equal(calls[0][1].action, 'conversation.read');
  assert.deepEqual(calls[1], [
    'inbox',
    {
      assignedUserId: 'operator-1',
      automationState: 'human',
      channel: 'whatsapp',
      cursor: 'signed',
      limit: 25,
      state: 'requer_atencao',
    },
  ]);

  const detail = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/inbox/conversations/conversation-1',
  });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(calls[2][0], 'authorize');
  assert.deepEqual(calls[3], [
    'conversation',
    { conversationId: 'conversation-1' },
  ]);
  await api.close();
});

test('publishes authorized Contact list and detail read models', async () => {
  const { api, calls, headers } = harness();
  const list = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/contacts?limit=50&cursor=signed',
  });
  assert.equal(list.statusCode, 200);
  assert.equal(calls[0][1].action, 'contact.read');
  assert.deepEqual(calls[1], ['contacts', { cursor: 'signed', limit: 50 }]);

  const detail = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/contacts/contact-1',
  });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(calls[2][1].action, 'contact.read');
  assert.deepEqual(calls[3], ['contact', { contactId: 'contact-1' }]);
  await api.close();
});

test('rejects unknown read filters before querying a projection', async () => {
  const { api, calls, headers } = harness();
  const response = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/inbox/conversations?rawPayload=true',
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(calls, []);
  assert.equal(response.json().error.code, 'INVALID_REQUEST');
  await api.close();
});

test('maps missing projections without leaking repository details', async () => {
  const { api, headers } = harness({
    async getContact() {
      throw Object.assign(new Error('secret database detail'), {
        code: 'CONTACT_NOT_FOUND',
        statusCode: 404,
      });
    },
  });
  const response = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/contacts/missing',
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'CONTACT_NOT_FOUND');
  assert.doesNotMatch(response.body, /secret database detail/u);
  await api.close();
});
